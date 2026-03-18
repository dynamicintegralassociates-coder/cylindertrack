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

  // --- OPTIMOROUTE SETTINGS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

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

  return db;
}

module.exports = { initDB };
