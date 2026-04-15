// ============================================================
// fix_cylinder_types.js — Interactively correct item_type values
// ============================================================
// Walks through every cylinder_type and asks you whether it's
// a "cylinder" (rental) or "sale" (gas refill/supply). Only
// writes to the database after you confirm at the end.
//
// Run with --dry-run to see what it would do without saving.
//
// Run: node fix_cylinder_types.js
//      node fix_cylinder_types.js --dry-run
// ============================================================

const path = require("path");
const fs = require("fs");
const readline = require("readline");
const Database = require("better-sqlite3");

const dryRun = process.argv.includes("--dry-run");

const dbDir = process.env.DB_DIR || __dirname;
const dbPath = path.join(dbDir, "cylindertrack.db");

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  if (dryRun) {
    console.log("\n=== DRY RUN MODE — no changes will be saved ===\n");
  }

  const types = db.prepare(`
    SELECT id, label, default_price, gas_group, item_type, linked_sale_item_id
    FROM cylinder_types
    ORDER BY item_type, label
  `).all();

  console.log(`Found ${types.length} cylinder_types. For each one, indicate whether it is:`);
  console.log(`  [c] Cylinder — a physical rental cylinder (charges ongoing rental)`);
  console.log(`  [s] Sale — a one-off gas refill / supply / purchase`);
  console.log(`  [k] Keep as-is (what's already set is correct)`);
  console.log(`  [q] Quit without saving`);
  console.log("");

  const changes = [];

  for (const t of types) {
    const current = t.item_type || "(none)";
    console.log(`\n  ${t.label}`);
    console.log(`    ID: ${t.id}`);
    console.log(`    Price: $${(t.default_price || 0).toFixed(2)}`);
    console.log(`    Gas group: ${t.gas_group || "(none)"}`);
    console.log(`    Currently: item_type='${current}'`);
    if (t.linked_sale_item_id) console.log(`    Linked sale item: ${t.linked_sale_item_id}`);

    let answer = "";
    while (!["c", "s", "k", "q"].includes(answer)) {
      answer = (await ask(`    [c/s/k/q]? `)).trim().toLowerCase();
    }

    if (answer === "q") {
      console.log("\nQuitting without saving.");
      rl.close();
      db.close();
      process.exit(0);
    }

    if (answer === "k") continue;

    const newType = answer === "c" ? "cylinder" : "sale";
    if (newType !== t.item_type) {
      changes.push({ id: t.id, label: t.label, from: t.item_type, to: newType });
    }
  }

  console.log("\n================================================");
  console.log("SUMMARY OF CHANGES:");
  console.log("================================================");
  if (changes.length === 0) {
    console.log("No changes.");
    rl.close();
    db.close();
    return;
  }

  for (const c of changes) {
    console.log(`  "${c.label}": ${c.from || "(none)"} → ${c.to}`);
  }

  console.log("");

  if (dryRun) {
    console.log("DRY RUN — changes would have been applied if not for --dry-run");
    rl.close();
    db.close();
    return;
  }

  const confirm = await ask(`Apply ${changes.length} change(s)? Type YES to confirm: `);
  if (confirm.trim() !== "YES") {
    console.log("Cancelled.");
    rl.close();
    db.close();
    return;
  }

  const stmt = db.prepare("UPDATE cylinder_types SET item_type = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const c of changes) stmt.run(c.to, c.id);
  });
  tx();

  console.log(`\nApplied ${changes.length} change(s). Done.`);
  console.log("\nNext steps:");
  console.log("  1. Restart the server (Ctrl+C then npm run dev)");
  console.log("  2. Hard-refresh your browser (Ctrl+Shift+R)");
  console.log("  3. Create a new test order with sale items and verify");
  console.log("     it goes to awaiting_dispatch, not invoiced");

  rl.close();
  db.close();
}

main().catch(e => {
  console.error(e);
  rl.close();
  db.close();
  process.exit(1);
});
