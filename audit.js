// ============================================================
// audit.js — Append-only audit log for compliance
// ============================================================
// This module provides a single entry point, `logAudit()`, that
// records every mutation of financial / master data to the
// `audit_log` table. The table is append-only: rows are never
// updated or deleted by the application, only inserted.
//
// Each entry captures:
//   - who    : user_id, username, role, ip
//   - when   : ts (ISO 8601 UTC)
//   - what   : action (create|update|delete|void|approve|reject|login|...)
//              table_name, record_id
//   - before : full row JSON before the change (null for creates)
//   - after  : full row JSON after the change  (null for deletes)
//   - summary: short human-readable description
//
// Design notes:
//   - Audit failures must NEVER break the main operation. All
//     calls are wrapped in try/catch and errors are logged to
//     the console only.
//   - Before/after snapshots are stored as JSON strings. For
//     deletes, callers should pass the row they just read.
//   - The helper `snapshot(db, table, id)` returns the current
//     row for a given primary key, to make before/after capture
//     trivial in route handlers.
// ============================================================

const nodeCrypto = require("crypto");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          TEXT    NOT NULL DEFAULT (datetime('now')),
      user_id     TEXT    DEFAULT '',
      username    TEXT    DEFAULT '',
      user_role   TEXT    DEFAULT '',
      ip          TEXT    DEFAULT '',
      action      TEXT    NOT NULL,
      table_name  TEXT    NOT NULL,
      record_id   TEXT    DEFAULT '',
      before_json TEXT    DEFAULT '',
      after_json  TEXT    DEFAULT '',
      summary     TEXT    DEFAULT ''
    )
  `);
  // Indexes for the filters the audit viewer uses.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_ts         ON audit_log(ts)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_log(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_table      ON audit_log(table_name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_record     ON audit_log(table_name, record_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_log(action)`);
}

// Extract a trustable client IP. Behind Railway/Nginx we rely on
// x-forwarded-for; fall back to req.ip.
function clientIp(req) {
  if (!req) return "";
  const fwd = req.headers?.["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.ip || req.connection?.remoteAddress || "";
}

// Serialize a row to JSON safely. We blank-out encrypted columns
// to avoid leaking ciphertext into the audit log (the audit log
// should contain what changed, not the card itself).
const REDACT_KEYS = new Set(["cc_encrypted", "password"]);
function toJson(row) {
  if (row === null || row === undefined) return "";
  try {
    const clone = { ...row };
    for (const k of Object.keys(clone)) {
      if (REDACT_KEYS.has(k) && clone[k]) clone[k] = "[REDACTED]";
    }
    return JSON.stringify(clone);
  } catch (e) {
    return String(row);
  }
}

// Take a snapshot of a row by primary key. Returns null if not found.
// Safe to call with pk='id' for most tables; callers can override.
function snapshot(db, table, recordId, pkColumn = "id") {
  try {
    // Whitelist table names — SQL identifiers can't be parameterized.
    // This is the complete list of tables we audit.
    const allowed = new Set([
      "customers", "orders", "order_lines", "transactions",
      "invoices", "payments", "credit_notes",
      "cylinder_types", "customer_pricing", "price_history",
      "users", "settings", "optimoroute_orders",
    ]);
    if (!allowed.has(table)) return null;
    const pkWhitelist = new Set(["id", "key", "token"]);
    if (!pkWhitelist.has(pkColumn)) return null;
    const row = db.prepare(`SELECT * FROM ${table} WHERE ${pkColumn} = ?`).get(recordId);
    return row || null;
  } catch (e) {
    console.error("[audit] snapshot failed:", table, recordId, e.message);
    return null;
  }
}

// Main entry point. All args are optional except action + table_name.
// Usage:
//   logAudit(db, req, {
//     action: "update",
//     table: "customers",
//     record_id: custId,
//     before, after,                  // either row objects or JSON strings
//     summary: "Updated customer XYZ",
//   });
function logAudit(db, req, opts = {}) {
  try {
    const {
      action,
      table,
      record_id = "",
      before = null,
      after = null,
      summary = "",
    } = opts;
    if (!action || !table) {
      console.warn("[audit] missing action or table:", opts);
      return;
    }
    const user = req?.user || {};
    const beforeJson = typeof before === "string" ? before : toJson(before);
    const afterJson  = typeof after  === "string" ? after  : toJson(after);
    db.prepare(`
      INSERT INTO audit_log (
        user_id, username, user_role, ip,
        action, table_name, record_id,
        before_json, after_json, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id || "",
      user.username || "",
      user.role || "",
      clientIp(req),
      String(action),
      String(table),
      String(record_id || ""),
      beforeJson,
      afterJson,
      String(summary || "").slice(0, 500),
    );
  } catch (e) {
    // NEVER throw — audit failures must not break writes.
    console.error("[audit] logAudit failed:", e.message, opts?.action, opts?.table);
  }
}

// Convenience wrappers for common patterns.
function logCreate(db, req, table, recordId, afterRow, summary) {
  logAudit(db, req, { action: "create", table, record_id: recordId, after: afterRow, summary });
}
function logUpdate(db, req, table, recordId, beforeRow, afterRow, summary) {
  logAudit(db, req, { action: "update", table, record_id: recordId, before: beforeRow, after: afterRow, summary });
}
function logDelete(db, req, table, recordId, beforeRow, summary) {
  logAudit(db, req, { action: "delete", table, record_id: recordId, before: beforeRow, summary });
}

module.exports = {
  ensureSchema,
  logAudit,
  logCreate,
  logUpdate,
  logDelete,
  snapshot,
  clientIp,
};
