# CylinderTrack — Compliance Changelog

This file tracks compliance-related changes to CylinderTrack.
Each step corresponds to one item in the compliance roadmap.

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
