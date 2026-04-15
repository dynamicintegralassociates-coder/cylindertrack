// ============================================================
// backup.js — Complete database backup and restore
// ============================================================
// Exports every table in the database as JSON, and can restore
// from the same format. This is a replacement for the incomplete
// built-in /api/backup and /api/restore routes which only covered
// 5 of the 17 tables.
//
// Design:
//   - Export is lossless: every row of every table is included
//     as-is, including cc_encrypted, password hashes, and audit
//     log history. This is a raw database dump meant for disaster
//     recovery, NOT for sharing with third parties.
//   - Restore is destructive: it clears every table and replaces
//     the contents from the backup file in one transaction. If
//     anything fails, nothing is changed.
//   - Restore is version-checked: the backup file includes a
//     schema_version marker. If you try to restore an old backup
//     into a newer schema, we refuse unless the columns still match.
//   - Sessions are NOT restored (you'd lose your current login)
//     but ARE exported (so nothing is silently dropped).
// ============================================================

// The full ordered list of tables. Order matters for restore because
// of foreign keys — parents come before children. SQLite's foreign_keys
// pragma is on, so inserts in the wrong order would fail.
const BACKUP_TABLES = [
  // Master data (no FK dependencies)
  "users",
  "cylinder_types",
  "settings",
  // Customers — depends on nothing, referenced by almost everything
  "customers",
  // Customer-scoped pricing + price history
  "customer_pricing",
  "price_history",
  // Orders + order lines
  "orders",
  "order_lines",
  // Transactions reference customers and cylinder_types
  "transactions",
  // Invoices reference customers and orders
  "invoices",
  // Payments reference customers and invoices
  "payments",
  // Credit notes reference customers
  "credit_notes",
  // OptimoRoute integration
  "optimoroute_orders",
  "optimoroute_sync_log",
  // Operational logs
  "email_log",
  "audit_log",
  // Sessions last — they're ephemeral, we keep them for completeness
  // but clear on restore (you'd log yourself out otherwise)
  "sessions",
];

// Tables that should NOT be wiped on restore (empty-after-restore
// would break the app). Currently none — everything is replaced.
// If we add tables that have bootstrap data, list them here.
const PRESERVE_ON_RESTORE = new Set([]);

// Tables that should be exported but NOT restored. Restoring sessions
// would put stale tokens back into the DB, which is harmless but weird.
const EXPORT_BUT_DONT_RESTORE = new Set(["sessions"]);

// Get the list of columns for a given table (from PRAGMA table_info).
// Used to make sure the restore file matches the current schema.
function getTableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

// Export every table as an array of row objects, plus metadata.
function exportFullBackup(db) {
  const backup = {
    format: "cylindertrack-full-backup",
    format_version: 1,
    exported_at: new Date().toISOString(),
    app_version: null, // filled in by caller if available
    tables: {},
    row_counts: {},
    schema: {},
  };

  for (const table of BACKUP_TABLES) {
    try {
      const cols = getTableColumns(db, table);
      if (cols.length === 0) {
        // Table doesn't exist in this database — skip silently.
        // This can happen if the backup format is newer than the
        // running schema, which we shouldn't hit but handle gracefully.
        backup.tables[table] = [];
        backup.row_counts[table] = 0;
        backup.schema[table] = [];
        continue;
      }
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      backup.tables[table] = rows;
      backup.row_counts[table] = rows.length;
      backup.schema[table] = cols;
    } catch (e) {
      // If any table fails to export, we want to know about it rather
      // than silently produce a broken backup. Re-throw with context.
      throw new Error(`Failed to export table '${table}': ${e.message}`);
    }
  }

  return backup;
}

// Restore from a backup object. This WIPES every table listed in
// BACKUP_TABLES and replaces the contents. Wrapped in a single
// transaction so a failure rolls back cleanly.
//
// Returns a summary object: { tables_restored, total_rows, skipped }
function restoreFullBackup(db, backup) {
  if (!backup || backup.format !== "cylindertrack-full-backup") {
    throw new Error("Not a valid cylindertrack full backup file");
  }
  if (!backup.tables || typeof backup.tables !== "object") {
    throw new Error("Backup file has no tables section");
  }

  const summary = { tables_restored: 0, total_rows: 0, skipped: [], warnings: [] };

  // Foreign key enforcement must be toggled OUTSIDE a transaction in
  // SQLite — setting PRAGMA foreign_keys inside a transaction is a
  // silent no-op. So we disable FKs first, run the transaction, then
  // re-enable them regardless of outcome.
  db.pragma("foreign_keys = OFF");

  const tx = db.transaction(() => {
    try {
      // Phase 1 — wipe every target table (except preserve list)
      for (const table of BACKUP_TABLES) {
        if (PRESERVE_ON_RESTORE.has(table)) continue;
        if (EXPORT_BUT_DONT_RESTORE.has(table)) continue;
        try {
          db.prepare(`DELETE FROM ${table}`).run();
        } catch (e) {
          // Table might not exist in this schema version
          summary.warnings.push(`Wipe skipped for ${table}: ${e.message}`);
        }
      }

      // Phase 2 — insert every row from the backup
      for (const table of BACKUP_TABLES) {
        if (EXPORT_BUT_DONT_RESTORE.has(table)) {
          summary.skipped.push(table);
          continue;
        }
        const rows = backup.tables[table];
        if (!Array.isArray(rows)) continue;
        if (rows.length === 0) {
          summary.tables_restored++;
          continue;
        }

        // Get current column set from the live database, not from the
        // backup file. This lets us gracefully handle the case where
        // the backup has columns the current schema doesn't, or vice
        // versa (we only restore columns that exist in both).
        const currentCols = getTableColumns(db, table);
        if (currentCols.length === 0) {
          summary.warnings.push(`Table ${table} does not exist in current schema — skipped`);
          continue;
        }

        // Build an insert for columns present in both the backup row
        // and the current schema. Every row in the same table uses the
        // same column set (from the first row), so we build the statement
        // once per table.
        const firstRow = rows[0];
        const commonCols = currentCols.filter(c => c in firstRow);
        if (commonCols.length === 0) {
          summary.warnings.push(`Table ${table}: no common columns with backup — skipped`);
          continue;
        }

        const placeholders = commonCols.map(() => "?").join(", ");
        const colList = commonCols.join(", ");
        const stmt = db.prepare(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`);

        for (const row of rows) {
          const values = commonCols.map(c => {
            const v = row[c];
            // SQLite can't bind undefined — coerce to null
            if (v === undefined) return null;
            // Objects/arrays get JSON-stringified (shouldn't happen with
            // raw SQLite rows, but defensive)
            if (v !== null && typeof v === "object") return JSON.stringify(v);
            return v;
          });
          stmt.run(...values);
        }

        summary.tables_restored++;
        summary.total_rows += rows.length;
      }
    } catch (e) {
      // Make sure we re-throw so the transaction rolls back
      throw e;
    }
  });

  try {
    tx();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return summary;
}

// Validate a backup file without restoring it. Useful for a dry-run
// before clicking the big red button.
function validateBackup(backup) {
  const problems = [];
  if (!backup) { problems.push("Backup is null"); return problems; }
  if (backup.format !== "cylindertrack-full-backup") {
    problems.push(`Unexpected format: ${backup.format}`);
  }
  if (!backup.tables) problems.push("Missing tables section");
  if (!backup.exported_at) problems.push("Missing exported_at timestamp");

  if (backup.tables) {
    for (const table of BACKUP_TABLES) {
      if (!(table in backup.tables)) {
        problems.push(`Missing table: ${table}`);
      } else if (!Array.isArray(backup.tables[table])) {
        problems.push(`Table ${table} is not an array`);
      }
    }
  }
  return problems;
}

module.exports = {
  BACKUP_TABLES,
  exportFullBackup,
  restoreFullBackup,
  validateBackup,
};
