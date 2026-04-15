// ============================================================
// test_backup.js — Smoke test for full backup/restore
// ============================================================
// Creates a throwaway DB, populates sample rows in several tables,
// runs exportFullBackup(), wipes the DB, runs restoreFullBackup(),
// and verifies every row came back unchanged.
//
// Run:  node test_backup.js
// ============================================================

const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-backup-test-"));
process.env.DB_DIR = tmpDir;

const { initDB } = require("./db");
const { exportFullBackup, restoreFullBackup, validateBackup, BACKUP_TABLES } = require("./backup");

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error("  ✗ FAIL:", msg); failed++; }
  else { console.log("  ✓", msg); }
}

console.log(`\n[setup] Temp DB dir: ${tmpDir}\n`);
const db = initDB();

// --- Seed sample data in 8 tables ---
console.log("[seed] Populating sample data");
db.prepare("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)").run("u1", "admin", "hashed", "admin");
db.prepare("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)").run("u2", "marsha", "hashed2", "user");

db.prepare("INSERT INTO cylinder_types (id, label, default_price, item_type) VALUES (?, ?, ?, ?)").run("ct1", "45kg LPG", 50.00, "cylinder");
db.prepare("INSERT INTO cylinder_types (id, label, default_price, item_type) VALUES (?, ?, ?, ?)").run("ct2", "9kg LPG", 25.00, "cylinder");

db.prepare("INSERT INTO customers (id, name, phone, address) VALUES (?, ?, ?, ?)").run("c1", "Test Cafe", "0400000001", "123 Test St");
db.prepare("INSERT INTO customers (id, name, phone, address) VALUES (?, ?, ?, ?)").run("c2", "Another Biz", "0400000002", "456 Biz Rd");
db.prepare("INSERT INTO customers (id, name, phone, address) VALUES (?, ?, ?, ?)").run("c3", "Third Customer", "0400000003", "789 Third Ave");

db.prepare("INSERT INTO customer_pricing (customer_id, cylinder_type, price) VALUES (?, ?, ?)").run("c1", "ct1", 45.00);
db.prepare("INSERT INTO customer_pricing (customer_id, cylinder_type, price) VALUES (?, ?, ?)").run("c2", "ct1", 48.00);

db.prepare("INSERT INTO orders (id, customer_id, order_date, total_price) VALUES (?, ?, ?, ?)").run("o1", "c1", "2026-04-01", 150.00);
db.prepare("INSERT INTO orders (id, customer_id, order_date, total_price) VALUES (?, ?, ?, ?)").run("o2", "c2", "2026-04-02", 96.00);

db.prepare("INSERT INTO order_lines (id, order_id, cylinder_type_id, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)").run("ol1", "o1", "ct1", 3, 45.00, 135.00);
db.prepare("INSERT INTO order_lines (id, order_id, cylinder_type_id, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)").run("ol2", "o2", "ct1", 2, 48.00, 96.00);

db.prepare("INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date) VALUES (?, ?, ?, ?, ?, ?)").run("t1", "c1", "ct1", "delivery", 3, "2026-04-01");
db.prepare("INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date) VALUES (?, ?, ?, ?, ?, ?)").run("t2", "c2", "ct1", "delivery", 2, "2026-04-02");
db.prepare("INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date) VALUES (?, ?, ?, ?, ?, ?)").run("t3", "c1", "ct1", "return", 2, "2026-04-10");

db.prepare("INSERT INTO invoices (id, invoice_number, customer_id, order_id, total, invoice_date) VALUES (?, ?, ?, ?, ?, ?)").run("i1", "INV-00001", "c1", "o1", 150.00, "2026-04-01");

db.prepare("INSERT INTO payments (id, customer_id, invoice_id, amount, method, date) VALUES (?, ?, ?, ?, ?, ?)").run("p1", "c1", "i1", 150.00, "bank", "2026-04-05");

db.prepare("INSERT INTO credit_notes (id, credit_number, customer_id, amount, remaining_amount) VALUES (?, ?, ?, ?, ?)").run("cn1", "CR-00001", "c2", 25.00, 25.00);

// And some audit log entries for completeness
db.prepare("INSERT INTO audit_log (action, table_name, record_id, summary, username) VALUES (?, ?, ?, ?, ?)").run("create", "customers", "c1", "Created test cafe", "admin");
db.prepare("INSERT INTO audit_log (action, table_name, record_id, summary, username) VALUES (?, ?, ?, ?, ?)").run("create", "orders", "o1", "Created order 1", "admin");

// Count rows before export
const beforeCounts = {};
for (const table of BACKUP_TABLES) {
  beforeCounts[table] = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
}
console.log("  Row counts before backup:", JSON.stringify(beforeCounts));

// --- Test 1: export ---
console.log("\n[test 1] exportFullBackup");
const backup = exportFullBackup(db);
assert(backup.format === "cylindertrack-full-backup", "format marker set");
assert(typeof backup.exported_at === "string", "exported_at timestamp set");
assert(backup.tables && typeof backup.tables === "object", "tables section present");

for (const table of BACKUP_TABLES) {
  const exported = (backup.tables[table] || []).length;
  const expected = beforeCounts[table];
  assert(exported === expected, `${table}: exported ${exported} = expected ${expected}`);
}

// --- Test 2: validation passes ---
console.log("\n[test 2] validateBackup on valid backup");
const problems = validateBackup(backup);
assert(problems.length === 0, `no validation problems (got: ${JSON.stringify(problems)})`);

// --- Test 3: validation catches garbage ---
console.log("\n[test 3] validateBackup on invalid input");
assert(validateBackup(null).length > 0, "null backup is rejected");
assert(validateBackup({}).length > 0, "empty object is rejected");
assert(validateBackup({ format: "wrong" }).length > 0, "wrong format is rejected");

// --- Test 4: round-trip via JSON (what the HTTP layer does) ---
console.log("\n[test 4] JSON round-trip");
const json = JSON.stringify(backup);
const parsed = JSON.parse(json);
const problems2 = validateBackup(parsed);
assert(problems2.length === 0, "JSON round-trip produces a valid backup");

// --- Test 5: restore into a fresh DB ---
console.log("\n[test 5] restoreFullBackup into fresh DB");
db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "ct-restore-test-"));
process.env.DB_DIR = tmpDir2;

// Re-require db.js with a cleared module cache so it picks up the new path
delete require.cache[require.resolve("./db")];
const { initDB: initDB2 } = require("./db");
const db2 = initDB2();

const summary = restoreFullBackup(db2, parsed);
console.log("  Restore summary:", JSON.stringify(summary));
assert(summary.total_rows > 0, `restore reported ${summary.total_rows} rows`);
assert(summary.tables_restored > 0, `restore reported ${summary.tables_restored} tables`);

// --- Test 6: every row count matches ---
console.log("\n[test 6] post-restore row counts match pre-backup counts");
for (const table of BACKUP_TABLES) {
  if (table === "sessions") continue; // not restored by design
  const after = db2.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
  const before = beforeCounts[table];
  assert(after === before, `${table}: before=${before} after=${after}`);
}

// --- Test 7: spot-check actual row contents ---
console.log("\n[test 7] spot-check content fidelity");
const restoredCust = db2.prepare("SELECT * FROM customers WHERE id = ?").get("c1");
assert(restoredCust?.name === "Test Cafe", "customer name preserved");
assert(restoredCust?.phone === "0400000001", "customer phone preserved");

const restoredOrder = db2.prepare("SELECT * FROM orders WHERE id = ?").get("o1");
assert(restoredOrder?.customer_id === "c1", "order.customer_id preserved");
assert(restoredOrder?.total_price === 150.00, "order.total_price preserved");

const restoredLine = db2.prepare("SELECT * FROM order_lines WHERE id = ?").get("ol1");
assert(restoredLine?.qty === 3, "order_line.qty preserved");
assert(restoredLine?.line_total === 135.00, "order_line.line_total preserved");

const restoredPayment = db2.prepare("SELECT * FROM payments WHERE id = ?").get("p1");
assert(restoredPayment?.amount === 150.00, "payment.amount preserved");

const restoredCredit = db2.prepare("SELECT * FROM credit_notes WHERE id = ?").get("cn1");
assert(restoredCredit?.credit_number === "CR-00001", "credit_note.credit_number preserved");

const restoredAudit = db2.prepare("SELECT COUNT(*) as c FROM audit_log").get().c;
assert(restoredAudit >= 2, `audit_log entries restored (got ${restoredAudit})`);

// --- Test 8: restore is idempotent (restore twice, still same counts) ---
console.log("\n[test 8] restore is idempotent");
restoreFullBackup(db2, parsed);
for (const table of BACKUP_TABLES) {
  if (table === "sessions") continue;
  const after = db2.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
  const before = beforeCounts[table];
  assert(after === before, `${table}: idempotent (before=${before} after=${after})`);
}

db2.close();
fs.rmSync(tmpDir2, { recursive: true, force: true });

console.log(`\n[done] ${failed === 0 ? "ALL TESTS PASSED" : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
