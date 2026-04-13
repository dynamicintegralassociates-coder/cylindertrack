const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function initDB() {
  const dbDir = process.env.DB_DIR || path.join(__dirname);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "cylindertrack.db");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // --- USERS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created TEXT DEFAULT (datetime('now'))
    )
  `);

  // --- SESSIONS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // --- CUSTOMERS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      onedrive_link TEXT DEFAULT '',
      payment_ref TEXT DEFAULT '',
      cc_encrypted TEXT DEFAULT '',
      account_customer INTEGER DEFAULT 0,
      created TEXT DEFAULT (date('now')),
      updated TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration: add columns if missing
  try { db.exec("ALTER TABLE customers ADD COLUMN onedrive_link TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN payment_ref TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN cc_encrypted TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN account_customer INTEGER DEFAULT 0"); } catch(e) { /* exists */ }

  // New customer fields
  try { db.exec("ALTER TABLE customers ADD COLUMN account_number TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN state TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN internal_notes TEXT DEFAULT '[]'"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN accounts_contact TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN accounts_email TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN accounts_phone TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN compliance_number TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN pressure_test TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN abn TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN duration TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN milk_run_days TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN milk_run_frequency TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN rental_frequency TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN customer_type TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN customer_type_start TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN customer_type_end TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN rep_name TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN payment_terms TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN next_rental_date TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN last_rental_date TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN balance REAL DEFAULT 0"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN credit_balance REAL DEFAULT 0"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN customer_category TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN chain INTEGER DEFAULT 0"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN alternative_contact_name TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN alternative_contact_phone TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customers ADD COLUMN compliance_not_required INTEGER DEFAULT 0"); } catch(e) { /* exists */ }

  // --- ORDERS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      address TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      order_detail TEXT DEFAULT '',
      cylinder_type_id TEXT DEFAULT '',
      qty INTEGER DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total_price REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      order_date TEXT NOT NULL,
      payment TEXT DEFAULT '',
      payment_ref TEXT DEFAULT '',
      payment_confirmed INTEGER DEFAULT 0,
      optimoroute_id TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      created TEXT DEFAULT (datetime('now')),
      updated TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);

  // Migration for orders
  try { db.exec("ALTER TABLE orders ADD COLUMN payment_confirmed INTEGER DEFAULT 0"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN optimoroute_id TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN cylinder_type_id TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN price REAL DEFAULT 0"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN qty INTEGER DEFAULT 1"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN unit_price REAL DEFAULT 0"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN total_price REAL DEFAULT 0"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN order_number TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN collection INTEGER DEFAULT 0"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN paid INTEGER DEFAULT 0"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN po_number TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN duration INTEGER DEFAULT 5"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN invoice_id TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN payment_amount REAL DEFAULT 0"); } catch(e) { /* exists */ }

  // --- CYLINDER TYPES ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS cylinder_types (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      default_price REAL DEFAULT 0,
      gas_group TEXT DEFAULT '',
      item_type TEXT DEFAULT 'cylinder',
      sort_order INTEGER DEFAULT 0
    )
  `);

  // Migration: add item_type if missing
  try { db.exec("ALTER TABLE cylinder_types ADD COLUMN item_type TEXT DEFAULT 'cylinder'"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE cylinder_types ADD COLUMN linked_sale_item_id TEXT DEFAULT ''"); } catch(e) { /* exists */ }

  // --- TRANSACTIONS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      cylinder_type TEXT NOT NULL,
      type TEXT NOT NULL,
      qty INTEGER NOT NULL,
      date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      source TEXT DEFAULT 'manual',
      optimoroute_order TEXT DEFAULT '',
      created TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (cylinder_type) REFERENCES cylinder_types(id)
    )
  `);

  // Migrations for OptimoRoute fields
  try { db.exec("ALTER TABLE transactions ADD COLUMN source TEXT DEFAULT 'manual'"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE transactions ADD COLUMN optimoroute_order TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE transactions ADD COLUMN auto_generated INTEGER DEFAULT 0"); } catch(e) { /* exists */ }
  // Round 3: prepaid first cycle marker for cylinders that were billed on a delivery order.
  // The rental scheduler skips cylinders whose prepaid_until covers the current cycle.
  try { db.exec("ALTER TABLE transactions ADD COLUMN prepaid_until TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  // Link a delivery transaction back to the order line that produced it (for audit + reconciliation)
  try { db.exec("ALTER TABLE transactions ADD COLUMN order_line_id TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  // 3.0.10: For 'return_other' transactions, store the foreign company name (e.g. "BOC", "Coregas")
  // who actually owns the cylinder we picked up. Empty for normal delivery/return rows.
  try { db.exec("ALTER TABLE transactions ADD COLUMN foreign_owner TEXT DEFAULT ''"); } catch(e) { /* exists */ }

  // --- CUSTOMER PRICING (with price history + fixed price contracts) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_pricing (
      customer_id TEXT NOT NULL,
      cylinder_type TEXT NOT NULL,
      price REAL NOT NULL,
      fixed_price INTEGER DEFAULT 0,
      fixed_from TEXT DEFAULT '',
      fixed_to TEXT DEFAULT '',
      PRIMARY KEY (customer_id, cylinder_type),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (cylinder_type) REFERENCES cylinder_types(id)
    )
  `);

  // Migrations for fixed price fields
  try { db.exec("ALTER TABLE customer_pricing ADD COLUMN fixed_price INTEGER DEFAULT 0"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customer_pricing ADD COLUMN fixed_from TEXT DEFAULT ''"); } catch(e) { /* exists */ }
  try { db.exec("ALTER TABLE customer_pricing ADD COLUMN fixed_to TEXT DEFAULT ''"); } catch(e) { /* exists */ }

  // --- PRICE HISTORY (locked-in prices per effective date) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      cylinder_type TEXT NOT NULL,
      price REAL NOT NULL,
      effective_from TEXT NOT NULL,
      created TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (cylinder_type) REFERENCES cylinder_types(id)
    )
  `);

  // --- INVOICES ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT DEFAULT '',
      customer_id TEXT NOT NULL,
      order_id TEXT DEFAULT '',
      po_number TEXT DEFAULT '',
      total REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'open',
      invoice_date TEXT NOT NULL,
      due_date TEXT DEFAULT '',
      created TEXT DEFAULT (datetime('now')),
      updated TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);

  // --- PAYMENTS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      invoice_id TEXT DEFAULT '',
      credit_id TEXT DEFAULT '',
      amount REAL NOT NULL,
      method TEXT DEFAULT '',
      reference TEXT DEFAULT '',
      date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);

  // --- CREDIT NOTES ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY,
      credit_number TEXT DEFAULT '',
      customer_id TEXT NOT NULL,
      amount REAL NOT NULL,
      remaining_amount REAL NOT NULL,
      reason TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_by TEXT DEFAULT '',
      created TEXT DEFAULT (datetime('now')),
      approved_by TEXT DEFAULT '',
      approved_date TEXT DEFAULT '',
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);

  // --- OPTIMOROUTE SETTINGS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Seed default number-sequence settings (only if not already set)
  const seedSetting = (key, value) => {
    const existing = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    if (!existing) db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(key, String(value));
  };
  seedSetting("customer_seq_prefix", "CUST-");
  seedSetting("customer_seq_padding", "5");
  seedSetting("customer_seq_next", "1");
  seedSetting("order_seq_prefix", "ORD-");
  seedSetting("order_seq_padding", "5");
  seedSetting("order_seq_next", "1");
  seedSetting("invoice_seq_prefix", "INV-");
  seedSetting("invoice_seq_padding", "5");
  seedSetting("invoice_seq_next", "1");
  seedSetting("credit_seq_prefix", "CR-");
  seedSetting("credit_seq_padding", "5");
  seedSetting("credit_seq_next", "1");
  // Round 3 settings
  seedSetting("auto_push_enabled", "1");        // 1 = auto-push to Optimo per round 3 rules, 0 = manual mode
  seedSetting("auto_close_days", "14");         // Days before an unfulfilled order auto-closes

  // --- OPTIMOROUTE SYNC LOG ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS optimoroute_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_date TEXT NOT NULL,
      orders_fetched INTEGER DEFAULT 0,
      orders_imported INTEGER DEFAULT 0,
      orders_skipped INTEGER DEFAULT 0,
      errors TEXT DEFAULT '',
      created TEXT DEFAULT (datetime('now'))
    )
  `);

  // --- OPTIMOROUTE ORDER MAPPING ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS optimoroute_orders (
      order_no TEXT PRIMARY KEY,
      customer_id TEXT,
      status TEXT DEFAULT '',
      order_type TEXT DEFAULT '',
      order_date TEXT DEFAULT '',
      location_name TEXT DEFAULT '',
      location_address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      custom_fields TEXT DEFAULT '{}',
      completion_status TEXT DEFAULT '',
      completed_at TEXT DEFAULT '',
      driver_name TEXT DEFAULT '',
      raw_json TEXT DEFAULT '{}',
      imported INTEGER DEFAULT 0,
      created TEXT DEFAULT (datetime('now')),
      updated TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);

  // --- EMAIL LOG ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at TEXT DEFAULT (datetime('now')),
      invoice_id TEXT,
      invoice_number TEXT,
      customer_id TEXT,
      customer_name TEXT,
      recipient TEXT,
      subject TEXT,
      status TEXT,
      provider_message_id TEXT DEFAULT '',
      error TEXT DEFAULT '',
      attempted_by TEXT DEFAULT ''
    )
  `);

  // --- ORDER LINES (multi-line orders) ---
  // Each order can have multiple lines, one per cylinder type. The orders table
  // remains the header record (customer, dates, status, paid, invoice_id, etc).
  // Existing single-line orders are migrated below.
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_lines (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      cylinder_type_id TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 1,
      delivered_qty REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id)"); } catch (e) { /* exists */ }

  // One-time migration: copy any single-line orders that don't yet have a matching
  // order_lines row into the new table. Idempotent — safe to re-run on every boot.
  // We detect "needs migration" by: order has cylinder_type_id set AND no order_lines rows for it.
  try {
    const ordersToMigrate = db.prepare(`
      SELECT o.id, o.cylinder_type_id, o.qty, o.unit_price, o.total_price
      FROM orders o
      WHERE o.cylinder_type_id IS NOT NULL AND o.cylinder_type_id != ''
        AND NOT EXISTS (SELECT 1 FROM order_lines WHERE order_id = o.id)
    `).all();

    if (ordersToMigrate.length > 0) {
      console.log(`[migration] Converting ${ordersToMigrate.length} single-line orders to multi-line schema...`);
      const insertLine = db.prepare(`
        INSERT INTO order_lines (id, order_id, cylinder_type_id, qty, delivered_qty, unit_price, line_total, status, sort_order)
        VALUES (?, ?, ?, ?, 0, ?, ?, 'open', 0)
      `);
      const nodeCrypto = require("crypto");
      const tx = db.transaction(() => {
        for (const o of ordersToMigrate) {
          const lineId = nodeCrypto.randomBytes(6).toString("hex");
          const qty = o.qty || 1;
          const unitPrice = o.unit_price || 0;
          // Use stored total_price if present, otherwise compute
          const lineTotal = (o.total_price && o.total_price > 0) ? o.total_price : Math.round(qty * unitPrice * 100) / 100;
          insertLine.run(lineId, o.id, o.cylinder_type_id, qty, unitPrice, lineTotal);
        }
      });
      tx();
      console.log(`[migration] Done. Migrated ${ordersToMigrate.length} orders.`);
    }
  } catch (err) {
    console.error("[migration] order_lines migration failed:", err);
    throw err;
  }

  // Round 3: status migration. Maps legacy order statuses to the new 7-state model.
  // 3.0.2: this migration is now ALWAYS run on boot (idempotent — only updates rows
  // with invalid statuses). The status_migrated_v3 flag is kept for diagnostic logging
  // (so we know whether this is the first run or a re-run).
  try {
    const migFlag = db.prepare("SELECT value FROM settings WHERE key = 'status_migrated_v3'").get();
    const isFirstRun = !migFlag;
    const tx = db.transaction(() => {
      // 1. paid=1 with optimoroute_id → 'paid'
      const r1 = db.prepare(
        `UPDATE orders SET status = 'paid'
         WHERE paid = 1 AND optimoroute_id IS NOT NULL AND optimoroute_id != ''
           AND status IN ('confirmed', 'fulfilled', 'completed', 'invoiced')`
      ).run();
      // 2. paid=1 without optimoroute_id and old status → 'awaiting_dispatch'
      const r2 = db.prepare(
        `UPDATE orders SET status = 'awaiting_dispatch'
         WHERE paid = 1 AND (optimoroute_id IS NULL OR optimoroute_id = '')
           AND status IN ('confirmed', 'fulfilled', 'completed', 'invoiced')`
      ).run();
      // 3. legacy in-flight states ('confirmed', 'fulfilled', 'delivered', 'completed') and not paid → 'dispatched'
      const r3 = db.prepare(
        `UPDATE orders SET status = 'dispatched'
         WHERE (paid IS NULL OR paid = 0)
           AND status IN ('confirmed', 'fulfilled', 'completed')`
      ).run();
      // 4. Anything else with an invalid status → 'open'
      const r4 = db.prepare(
        `UPDATE orders SET status = 'open'
         WHERE status NOT IN ('open', 'awaiting_dispatch', 'dispatched', 'delivered', 'invoiced', 'paid', 'cancelled')
            OR status IS NULL`
      ).run();

      if (isFirstRun) {
        db.prepare("INSERT INTO settings (key, value) VALUES ('status_migrated_v3', '1')").run();
      }
      const totalChanges = r1.changes + r2.changes + r3.changes + r4.changes;
      if (isFirstRun || totalChanges > 0) {
        console.log(`[migration v3] ${isFirstRun ? 'first run' : 're-run'}: paid+pushed→paid: ${r1.changes}, paid+notpushed→awaiting: ${r2.changes}, in-flight→dispatched: ${r3.changes}, invalid→open: ${r4.changes}`);
      }
    });
    tx();
  } catch (err) {
    console.error("[migration v3] status migration failed:", err);
    throw err;
  }

  return db;
}

module.exports = { initDB };
