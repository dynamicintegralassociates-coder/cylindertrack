# CylinderTrack — Compliance Changelog

This file tracks compliance-related changes to CylinderTrack.
Each step corresponds to one item in the compliance roadmap.

---

## Step 4 — Complete backup & restore (complete, out of sequence)

**Why out of sequence:** we discovered during step 1 deployment
that production was running without a persistent Railway volume,
meaning the SQLite database would be wiped on the next redeploy.
The existing `/api/backup` and `/api/restore` endpoints only
covered 5 of the 17 database tables (customers, cylinder_types,
transactions, customer_pricing, settings), so even if someone
had been using them, they would have lost orders, invoices,
payments, credit notes, audit log, and more on every restore.
Step 4 was brought forward so a complete backup could be taken
before attaching a Railway volume.

### Files added
- `backup.js` — new core module with `exportFullBackup(db)`,
  `restoreFullBackup(db, backup)`, `validateBackup(backup)`,
  and `BACKUP_TABLES` (the canonical list of tables handled).
- `test_backup.js` — smoke test with 8 test cases (58
  assertions). Covers export row counts, validation, JSON
  round-trip, restore into a fresh DB, row count fidelity,
  content fidelity on representative rows, and idempotency.
- `client/src/BackupRestore.jsx` — admin-only React UI with
  row count display, download button, upload-and-validate,
  and destructive-restore flow with double confirmation.

### Files modified
- `routes.js` — replaced `/api/backup` and `/api/restore` with
  new implementations backed by `backup.js`. Added
  `/api/backup/counts` (for the row count display) and
  `/api/backup/validate` (dry-run validation). All four routes
  are admin-only and audit-logged.
- `client/src/api.js` — added `getBackupCounts`,
  `validateBackup`, `restoreBackup` methods. Kept `getBackup`
  and `restore` for backward compatibility.
- `client/src/App.jsx` — imported `BackupRestore` component,
  rendered it inside `AdministratorView` above the email log
  section.

### Tables covered

All 17 tables exported and restored in a specific order that
respects foreign key dependencies:

1. `users` — admin accounts (hashes exported as-is)
2. `cylinder_types` — master data
3. `settings` — all sequence counters and app settings
4. `customers` — customer records including cc_encrypted
5. `customer_pricing` — customer-specific prices
6. `price_history` — historical price trail
7. `orders` — order headers
8. `order_lines` — multi-line order contents
9. `transactions` — delivery/return/rental transactions
10. `invoices` — all invoices including void/pending
11. `payments` — payment records
12. `credit_notes` — credit notes with approval status
13. `optimoroute_orders` — OptimoRoute mapping
14. `optimoroute_sync_log` — sync history
15. `email_log` — sent invoice email log
16. `audit_log` — the compliance audit trail itself
17. `sessions` — exported for completeness, not restored
    (would log out the user running the restore)

### Design rules

1. **Lossless export.** Every column of every row is included.
   No filtering, no transformation, no truncation.
2. **Schema-flexible restore.** If the backup has columns the
   current schema doesn't (or vice versa), only columns present
   in both are restored. Warnings are returned to the caller.
3. **FK-safe restore.** Foreign keys are disabled before the
   wipe-and-reload transaction and re-enabled after. This has
   to happen outside the transaction because SQLite silently
   ignores `PRAGMA foreign_keys` changes inside transactions.
4. **All-or-nothing restore.** The wipe and reload happen in
   a single transaction. If any row fails to insert, the whole
   restore rolls back and the database is unchanged.
5. **Admin-only.** All four routes require `req.user.role === 'admin'`.
6. **Audit-logged.** `/backup` logs a `backup_export` event,
   `/restore` logs `restore_start` before the wipe and
   `restore_complete` after, `/restore` logs `restore_failed`
   on error (best-effort, since audit_log may be in an
   inconsistent state after a partial restore).
7. **Destructive action gate.** The UI requires the user to
   click OK on a warning dialog AND type "RESTORE" in a prompt
   before the restore runs. A fat-finger can't wipe the
   database.

### Security notes

The backup file contains every row of sensitive data in the
database, including:
- `customers.cc_encrypted` (credit card ciphertext)
- `users.password` (bcrypt hashes)
- Full audit trail
- Customer contact details

**The backup file should be treated exactly like the database
file itself.** Specifically:
- Never email a backup file
- Never commit a backup file to git
- Store copies only on encrypted disks
- Delete old backups when no longer needed
- If a backup is ever exposed, treat it as a data breach

### Out of scope for step 4

- **Automated off-Railway backup** (a scheduled daily dump to
  S3/Backblaze/Google Drive) — this is part of the original
  step 4 but was not built in this pass. The current
  implementation requires an admin to click Download manually.
  Automating this is the next piece of work.
- **Encryption at rest for backup files** — backups are plain
  JSON. If you want encrypted backups, either encrypt the
  destination disk/bucket or add a pass-phrase-based encryption
  layer on top. Not done in this pass.

---

## Step 1 — Audit Log (complete)

**Goal:** Provide an append-only record of every change to financial
and master data so that the system can stand up to an audit. No edit
to customers, orders, invoices, payments, credit notes, pricing,
settings, or users should be untraceable.

### Files added
- `audit.js` — new core module with `logAudit()`, `logCreate()`,
  `logUpdate()`, `logDelete()`, `snapshot()`, and `ensureSchema()`.
- `test_audit.js` — smoke test covering schema creation, row
  insertion, redaction of sensitive fields, crash-safety, index
  presence, and the `snapshot()` helper. Run with `node test_audit.js`.
- `client/src/AuditLog.jsx` — admin-only React view with filters
  (date range, user, table, action, record id, free-text search),
  pagination, before/after drill-down, and CSV export.
- `COMPLIANCE_CHANGELOG.md` — this file.

### Files modified
- `db.js` — calls `ensureAuditSchema(db)` on boot. Creates the
  `audit_log` table and its indexes if they don't already exist.
- `auth.js` — audit events emitted for:
  - initial admin setup (`setup`)
  - successful login (`login`)
  - failed login — unknown username (`login_failed`)
  - failed login — bad password (`login_failed`)
  - logout (`logout`)
  - admin creating a new user (`create`)
  - any password change (`password_change`)
- `routes.js` — audit events emitted for:
  - `POST /customers` (create)
  - `PUT /customers/:id` (update, with before/after snapshot)
  - `DELETE /customers/:id/cc` (cc_removed)
  - `DELETE /customers/:id`
  - `POST /cylinder-types`, `PUT /cylinder-types/:id`, `DELETE /cylinder-types/:id`
  - `POST /transactions` (plus the auto-overflow rental row if created)
  - `DELETE /transactions/:id`
  - `POST /orders` (and the linked invoice created alongside)
  - `PUT /orders/:id`
  - `DELETE /orders/:id` (and the voiding of the linked invoice)
  - `POST /invoices/:id/payment` (action: `payment`)
  - `POST /credits` (create)
  - `POST /credits/:id/approve`
  - `POST /credits/:id/reject`
  - `PUT /pricing/:custId/:typeId`
  - `DELETE /pricing/:custId/:typeId`
  - `POST /pricing/bulk`
  - `PUT /settings`
  - `PUT /admin/settings/round3`
- `routes.js` — new admin-only read endpoints:
  - `GET /api/audit-log?from&to&username&table&action&record_id&q&limit&offset`
  - `GET /api/audit-log/facets` — distinct users, tables, actions
  - `GET /api/audit-log/record/:table/:id` — full history for one record
- `client/src/api.js` — three new methods: `getAuditLog`,
  `getAuditFacets`, `getAuditRecordHistory`.
- `client/src/App.jsx` — imports `AuditLogView`, adds admin-only
  "Audit Log" sidebar entry and route case.

### Schema

```sql
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  user_id     TEXT DEFAULT '',
  username    TEXT DEFAULT '',
  user_role   TEXT DEFAULT '',
  ip          TEXT DEFAULT '',
  action      TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  record_id   TEXT DEFAULT '',
  before_json TEXT DEFAULT '',
  after_json  TEXT DEFAULT '',
  summary     TEXT DEFAULT ''
);
CREATE INDEX idx_audit_ts     ON audit_log(ts);
CREATE INDEX idx_audit_user   ON audit_log(user_id);
CREATE INDEX idx_audit_table  ON audit_log(table_name);
CREATE INDEX idx_audit_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_action ON audit_log(action);
```

### Design rules

1. **Append-only.** No `UPDATE` or `DELETE` against `audit_log` is
   performed anywhere in the app. The viewer endpoint is read-only.
2. **Crash-safe.** `logAudit()` is wrapped in try/catch and will
   never throw. Audit failures are logged to the server console but
   never break the main operation.
3. **Sensitive field redaction.** `cc_encrypted` and `password`
   columns are replaced with `[REDACTED]` before the row is
   serialized into `before_json` / `after_json`.
4. **IP capture.** Reads `x-forwarded-for` first (for Railway /
   Nginx), falls back to `req.ip`.
5. **Table whitelist.** The `snapshot()` helper only accepts a
   fixed set of table names, preventing SQL injection via the
   `table` parameter.
6. **User context.** Every entry captures `user_id`, `username`,
   and `role` from `req.user` (set by `requireAuth()` middleware).

### Operational notes

- The `audit_log` table grows unbounded. For a small business this
  should be fine for several years, but you should revisit after
  ~1 million rows (expect tens of MB per million).
- To archive old audit rows, dump them to a file and delete them
  via a direct SQL operation — this should be a manual, documented
  process performed by an admin, not an app feature.
- The CSV export in the viewer only exports the currently loaded
  page. For a full extract, widen the date range and increase the
  page size to 500 before clicking export.

### Out of scope for step 1 (tracked for later steps)

- **Immutable posted invoices** (step 2) — there is still no
  `posted` flag preventing edits to finalized invoices, only the
  `status = 'void'` soft-delete path used by `DELETE /orders/:id`.
- **Valid tax invoices** (step 3) — GST is still only applied at
  display time in the client (`grossOf()` in App.jsx); it is not
  stored per line in the database.
- **Off-Railway backup** (step 4) — backup is still Railway-volume
  only, plus manual JSON export.
- **Password hashing** (step 5) — **already complete**. `auth.js`
  uses `bcryptjs.hashSync(password, 10)` throughout. The `password`
  column name is legacy but stores a bcrypt hash.

### Known compliance concerns not addressed by step 1

- **Credit card storage.** Customers still have a `cc_encrypted`
  column and a `/reveal-cc` admin endpoint. Storing PANs — even
  encrypted — puts CylinderTrack in PCI-DSS scope. Audit logging
  now records CC reveal and removal events, but the core issue
  remains: the app should not store PANs at all. Recommended fix:
  remove `cc_encrypted`, `/reveal-cc`, and the CC branches in
  `crypto.js`, and replace with a payment processor token
  (Stripe/Square) if card-on-file functionality is needed.
