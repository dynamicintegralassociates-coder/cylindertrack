#!/usr/bin/env node
// CylinderTrack backfill — write missing linked-rental delivery transactions for
// historical orders that were delivered before 3.0.18 wired the auto-link logic into
// createDeliveryTransactionsForOrder / manual completion / Optimo sync.
//
// For each delivered/invoiced/paid order:
//   for each delivered SALE line with a linked rental cylinder type:
//     if no delivery transaction exists with order_line_id = sale_line.id:
//       compute overflow against current rental on-hand (taking historical order into account
//       by computing on-hand AS OF the day BEFORE the order date, so existing pre-order
//       on-hand is the baseline)
//       residential: prepaid_until = '9999-12-31', also write rental_invoice + invoice row
//       commercial:  prepaid_until = '' (scheduler picks it up next end-of-month)
//
// Usage:
//   node backfill_linked_rentals.js /path/to/cylindertrack.db [--dry-run] [--commit]
//
// Always pass --commit explicitly to write — default is dry-run.

const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const dbPath = args.find(a => !a.startsWith("--"));
const commit = args.includes("--commit");
if (!dbPath) {
  console.error("Usage: node backfill_linked_rentals.js <db-path> [--commit]");
  process.exit(1);
}

const db = new Database(dbPath);
const uid = () => crypto.randomBytes(8).toString("hex");

// Mirror addFrequency from routes.js (just enough for prepaid_until calc — we use sentinel for residential)
function addFrequency(dateStr, freq) {
  const d = new Date(dateStr);
  const f = (freq || "monthly").toLowerCase();
  if (f.startsWith("week")) d.setDate(d.getDate() + 7);
  else if (f.startsWith("fortnight") || f.startsWith("biweek")) d.setDate(d.getDate() + 14);
  else if (f.startsWith("quarter")) d.setMonth(d.getMonth() + 3);
  else if (f.startsWith("annual") || f.startsWith("year")) d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly default
  return d.toISOString().split("T")[0];
}

function getPriceForDate(custId, ctId, date, fallback) {
  // Try customer-specific price first (active on date), fall back to default.
  try {
    const row = db.prepare(
      `SELECT price FROM customer_prices
       WHERE customer_id = ? AND cylinder_type = ?
         AND (effective_from IS NULL OR effective_from <= ?)
         AND (effective_to   IS NULL OR effective_to   >= ?)
       ORDER BY effective_from DESC LIMIT 1`
    ).get(custId, ctId, date, date);
    if (row && row.price != null) return row.price;
  } catch (e) { /* table may not exist or different shape — ignore */ }
  return fallback || 0;
}

function getOnHandAsOf(custId, rentalCtId, asOfDate) {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN type='delivery' THEN qty ELSE 0 END) -
      SUM(CASE WHEN type='return'   THEN qty ELSE 0 END) as on_hand
    FROM transactions
    WHERE customer_id = ? AND cylinder_type = ? AND date < ?
  `).get(custId, rentalCtId, asOfDate);
  return row?.on_hand || 0;
}

function nextInvoiceNumber() {
  const row = db.prepare("SELECT value FROM sequences WHERE key = 'invoice'").get();
  const cur = parseInt(row?.value || "0", 10);
  const next = cur + 1;
  if (commit) db.prepare("INSERT OR REPLACE INTO sequences (key, value) VALUES ('invoice', ?)").run(String(next));
  return `INV-${String(next).padStart(6, "0")}`;
}

const orders = db.prepare(`
  SELECT o.id, o.order_number, o.customer_id, o.order_date, o.invoice_id, o.status,
         c.customer_category, c.rental_frequency
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.status IN ('delivered', 'invoiced', 'paid')
  ORDER BY o.order_date ASC, o.created ASC
`).all();

let scanned = 0, saleLinesProcessed = 0, deliveryRowsWritten = 0, invoicesCreated = 0, totalAdj = 0;

console.log(`[backfill] mode=${commit ? "COMMIT" : "DRY-RUN"} orders=${orders.length}`);

const run = db.transaction(() => {
  for (const o of orders) {
    scanned++;
    const lines = db.prepare(`
      SELECT ol.id, ol.cylinder_type_id, ol.qty, ol.delivered_qty, ol.status,
             ct.item_type, ct.label
      FROM order_lines ol
      LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
      WHERE ol.order_id = ?
    `).all(o.id);

    for (const l of lines) {
      if (l.item_type !== "sale") continue;
      if (l.status === "cancelled") continue;
      const dq = l.delivered_qty > 0 ? l.delivered_qty : (l.qty || 0);
      if (dq <= 0) continue;
      saleLinesProcessed++;

      const linkedRental = db.prepare(
        "SELECT * FROM cylinder_types WHERE item_type = 'cylinder' AND linked_sale_item_id = ?"
      ).get(l.cylinder_type_id);
      if (!linkedRental) continue;

      // Idempotency: skip if a delivery row for this sale line already exists.
      const exists = db.prepare(
        "SELECT 1 FROM transactions WHERE order_line_id = ? AND type = 'delivery' LIMIT 1"
      ).get(l.id);
      if (exists) continue;

      // On-hand baseline = customer's rental on-hand as of the day BEFORE this order.
      const onHand = getOnHandAsOf(o.customer_id, linkedRental.id, o.order_date);
      const overflow = Math.max(0, dq - onHand);
      if (overflow <= 0) continue;

      const isCommercial = (o.customer_category || "").toLowerCase() === "commercial";
      const prepaidUntil = isCommercial ? "" : "9999-12-31";

      console.log(`  ${o.order_number} ${isCommercial ? "[COM]" : "[RES]"} sale_line=${l.id} sold=${dq} on_hand=${onHand} → write delivery ${overflow} of ${linkedRental.label}`);

      if (commit) {
        db.prepare(
          `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, prepaid_until, order_line_id)
           VALUES (?, ?, ?, 'delivery', ?, ?, ?, 'order', ?, ?, ?)`
        ).run(
          uid(), o.customer_id, linkedRental.id, overflow, o.order_date,
          `BACKFILL: auto linked rental from sale line on order ${o.order_number} (overflow ${overflow} of ${dq} sold)`,
          o.id, prepaidUntil, l.id
        );
      }
      deliveryRowsWritten++;

      // Residential: also create the prepaid rental invoice for the overflow units.
      if (!isCommercial) {
        const unitPrice = getPriceForDate(o.customer_id, linkedRental.id, o.order_date, linkedRental.default_price || 0);
        const lineTotal = Math.round(unitPrice * overflow * 100) / 100;
        if (lineTotal > 0) {
          if (commit) {
            const invId = uid();
            const invNum = nextInvoiceNumber();
            db.prepare(
              `INSERT INTO invoices (id, invoice_number, customer_id, order_id, po_number, total, amount_paid, status, invoice_date)
               VALUES (?, ?, ?, '', '', ?, 0, 'open', ?)`
            ).run(invId, invNum, o.customer_id, lineTotal, o.order_date);
            db.prepare(
              `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, auto_generated)
               VALUES (?, ?, ?, 'rental_invoice', ?, ?, ?, 'order_linked_rental_backfill', 1)`
            ).run(
              uid(), o.customer_id, linkedRental.id, overflow, o.order_date,
              `BACKFILL: residential prepay for ${overflow} × ${linkedRental.label} from order ${o.order_number}`
            );
          }
          invoicesCreated++;
          totalAdj += lineTotal;
          console.log(`    → residential rental invoice $${lineTotal.toFixed(2)} (${overflow} × $${unitPrice})`);
        }
      }
    }
  }
});

if (commit) {
  run();
} else {
  // Run inside a savepoint we always rollback so prints are accurate but no writes persist
  db.exec("BEGIN");
  try { run(); } finally { db.exec("ROLLBACK"); }
}

console.log("\n[backfill] summary");
console.log(`  orders scanned:           ${scanned}`);
console.log(`  sale lines processed:     ${saleLinesProcessed}`);
console.log(`  delivery rows ${commit ? "written" : "would write"}:    ${deliveryRowsWritten}`);
console.log(`  rental invoices ${commit ? "created" : "would create"}: ${invoicesCreated}`);
console.log(`  total residential adjustment: $${totalAdj.toFixed(2)}`);
console.log(`  mode: ${commit ? "COMMITTED" : "DRY-RUN (no changes written — re-run with --commit to apply)"}`);
