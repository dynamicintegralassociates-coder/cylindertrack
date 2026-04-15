// ============================================================
// test_audit.js — Smoke test for the audit log system
// ============================================================
// Creates a throwaway SQLite DB in /tmp, initializes the schema
// via the real initDB() path (to confirm the audit table is
// created on boot), then exercises logAudit() with a few
// representative calls and queries the rows back.
//
// Run with:
//   node test_audit.js
//
// Exits non-zero on failure so it can be wired into CI later.
// ============================================================

const fs = require("fs");
const path = require("path");
const os = require("os");

// Point db.js at a temp directory so we don't clobber the real DB
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-audit-test-"));
process.env.DB_DIR = tmpDir;

const { initDB } = require("./db");
const { logAudit, logCreate, logUpdate, logDelete, snapshot } = require("./audit");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("  ✗ FAIL:", msg);
    failed++;
  } else {
    console.log("  ✓", msg);
  }
}

console.log(`\n[setup] Using temp DB dir: ${tmpDir}\n`);
const db = initDB();

// --- Test 1: audit_log table exists with expected columns ---
console.log("[test 1] audit_log schema");
const cols = db.prepare("PRAGMA table_info(audit_log)").all().map(c => c.name);
const expected = ["id", "ts", "user_id", "username", "user_role", "ip", "action", "table_name", "record_id", "before_json", "after_json", "summary"];
for (const c of expected) assert(cols.includes(c), `column ${c} exists`);

// --- Test 2: logAudit inserts a row ---
console.log("\n[test 2] logAudit inserts a row");
const fakeReq = {
  user: { id: "u1", username: "testuser", role: "admin" },
  headers: { "x-forwarded-for": "1.2.3.4" },
};
logAudit(db, fakeReq, {
  action: "create",
  table: "customers",
  record_id: "cust-001",
  after: { id: "cust-001", name: "Test Co", balance: 0 },
  summary: "Created Test Co",
});
const row = db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1").get();
assert(row, "row inserted");
assert(row.user_id === "u1", "user_id captured");
assert(row.username === "testuser", "username captured");
assert(row.user_role === "admin", "role captured");
assert(row.ip === "1.2.3.4", "IP captured from x-forwarded-for");
assert(row.action === "create", "action captured");
assert(row.table_name === "customers", "table_name captured");
assert(row.record_id === "cust-001", "record_id captured");
assert(row.summary === "Created Test Co", "summary captured");
assert(row.after_json.includes("Test Co"), "after_json contains payload");

// --- Test 3: cc_encrypted and password fields are redacted ---
console.log("\n[test 3] sensitive fields are redacted");
logAudit(db, fakeReq, {
  action: "update",
  table: "customers",
  record_id: "cust-002",
  after: { id: "cust-002", name: "Sensitive Co", cc_encrypted: "SECRET_CIPHERTEXT", password: "hashvalue" },
  summary: "redaction test",
});
const redacted = db.prepare("SELECT after_json FROM audit_log WHERE record_id = ?").get("cust-002");
assert(!redacted.after_json.includes("SECRET_CIPHERTEXT"), "cc_encrypted redacted");
assert(!redacted.after_json.includes("hashvalue"), "password redacted");
assert(redacted.after_json.includes("[REDACTED]"), "redaction marker present");

// --- Test 4: snapshot() returns the row, rejects unknown tables ---
console.log("\n[test 4] snapshot helper");
db.prepare("INSERT INTO customers (id, name) VALUES (?, ?)").run("real-001", "Real Customer");
const snap = snapshot(db, "customers", "real-001");
assert(snap && snap.name === "Real Customer", "snapshot returns row by id");
const bad = snapshot(db, "evil_table", "real-001");
assert(bad === null, "snapshot rejects non-whitelisted table");

// --- Test 5: logAudit never throws on bad input ---
console.log("\n[test 5] logAudit is crash-safe");
let threw = false;
try {
  logAudit(db, fakeReq, { /* missing action + table */ });
  logAudit(db, null, { action: "x", table: "y" });
  logAudit(db, fakeReq, { action: "x", table: "y", before: { circular: null } });
} catch (e) {
  threw = true;
}
assert(!threw, "logAudit does not throw on missing/bad inputs");

// --- Test 6: audit rows are ordered newest first when queried DESC ---
console.log("\n[test 6] rows ordered by id");
logAudit(db, fakeReq, { action: "update", table: "customers", record_id: "cust-001", summary: "second write" });
const last = db.prepare("SELECT summary FROM audit_log WHERE record_id = ? ORDER BY id DESC LIMIT 1").get("cust-001");
assert(last.summary === "second write", "newest row surfaces first");

// --- Test 7: indexes exist on ts, user, table, record ---
console.log("\n[test 7] indexes created");
const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_log'").all().map(r => r.name);
assert(idx.includes("idx_audit_ts"), "idx_audit_ts present");
assert(idx.includes("idx_audit_user"), "idx_audit_user present");
assert(idx.includes("idx_audit_table"), "idx_audit_table present");
assert(idx.includes("idx_audit_record"), "idx_audit_record present");
assert(idx.includes("idx_audit_action"), "idx_audit_action present");

db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n[done] ${failed === 0 ? "ALL TESTS PASSED" : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
