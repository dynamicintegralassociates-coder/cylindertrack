// ============================================================
// audit_cylinder_types.js — Report on item_type configuration
// ============================================================
// Lists every cylinder_type in the database and flags ones that
// look likely to be misconfigured. A "sale item" (gas supply,
// refill, one-off sale) should have item_type='sale'. A "rental
// cylinder" (the physical cylinder itself) should have item_type='cylinder'.
//
// This script does NOT modify anything. Run it first to see what's
// there, then use fix_cylinder_types.js to make corrections after
// reviewing.
//
// Run: node audit_cylinder_types.js
// ============================================================

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Use DB_DIR env var if set (matches the app's own convention),
// otherwise fall back to the project directory.
const dbDir = process.env.DB_DIR || __dirname;
const dbPath = path.join(dbDir, "cylindertrack.db");

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`);
  console.error(`Set DB_DIR if your database is elsewhere.`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

console.log(`\nDatabase: ${dbPath}\n`);

const types = db.prepare(`
  SELECT id, label, default_price, gas_group, item_type, sort_order, linked_sale_item_id
  FROM cylinder_types
  ORDER BY item_type, sort_order, label
`).all();

if (types.length === 0) {
  console.log("No cylinder_types defined.");
  process.exit(0);
}

console.log(`${types.length} cylinder_type(s) defined:\n`);

// Print header
console.log(
  "ITEM_TYPE".padEnd(10) +
  "LABEL".padEnd(35) +
  "PRICE".padEnd(10) +
  "GAS_GROUP".padEnd(15) +
  "LINKED_TO".padEnd(20) +
  "FLAG"
);
console.log("-".repeat(110));

const suspicious = [];

for (const t of types) {
  // Heuristic: a cylinder_type that has "refill", "supply", "gas", "fill",
  // or similar words in its label, but is tagged item_type='cylinder',
  // is likely misconfigured.
  const label = (t.label || "").toLowerCase();
  const suspiciousLabels = ["refill", "supply", "fill", "gas sale", "purchase"];
  const looksLikeSale = suspiciousLabels.some(w => label.includes(w));

  let flag = "";
  if (t.item_type === "cylinder" && looksLikeSale) {
    flag = "LIKELY_MISCONFIGURED (label suggests sale)";
    suspicious.push(t);
  }
  if (t.item_type === "sale" && !looksLikeSale && !label.includes("kg") === false) {
    // Saleable item with a plausible size label — probably correct.
  }
  if (!t.item_type) {
    flag = "MISSING_ITEM_TYPE";
    suspicious.push(t);
  }

  console.log(
    (t.item_type || "?").padEnd(10) +
    (t.label || "").substring(0, 34).padEnd(35) +
    `$${(t.default_price || 0).toFixed(2)}`.padEnd(10) +
    (t.gas_group || "").substring(0, 14).padEnd(15) +
    (t.linked_sale_item_id || "").substring(0, 19).padEnd(20) +
    flag
  );
}

console.log("");

// Now check: how many order_lines are currently on orders with status='open' or
// 'awaiting_dispatch' that reference cylinder_types whose item_type is 'cylinder'
// BUT the label looks like it should be a sale? Those are the orders that will
// break on confirm-payment.
const atRiskOrders = db.prepare(`
  SELECT DISTINCT o.id, o.order_number, o.status, o.customer_name, ol.cylinder_type_id, ct.label, ct.item_type
  FROM orders o
  JOIN order_lines ol ON ol.order_id = o.id
  JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
  WHERE o.status IN ('open', 'awaiting_dispatch')
    AND ct.item_type = 'cylinder'
    AND (
      LOWER(ct.label) LIKE '%refill%'
      OR LOWER(ct.label) LIKE '%supply%'
      OR LOWER(ct.label) LIKE '%fill%'
    )
  ORDER BY o.order_number
`).all();

if (atRiskOrders.length > 0) {
  console.log(`\nAT-RISK ORDERS (${atRiskOrders.length}):`);
  console.log(`These open/awaiting orders reference cylinder_types that are tagged 'cylinder'`);
  console.log(`but have labels that suggest they should be 'sale'. They will auto-invoice`);
  console.log(`incorrectly on confirm-payment if you don't fix the cylinder_type first.\n`);
  for (const r of atRiskOrders) {
    console.log(`  ${r.order_number} (${r.status}) — ${r.customer_name}: ${r.label} [${r.cylinder_type_id}]`);
  }
}

console.log("\nReview the LIKELY_MISCONFIGURED entries above.");
console.log("If they are correct, run:");
console.log("  node fix_cylinder_types.js --dry-run    # preview");
console.log("  node fix_cylinder_types.js              # apply");
console.log("");

db.close();
