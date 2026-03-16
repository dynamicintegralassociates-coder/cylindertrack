const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_DIR = process.env.DB_DIR || __dirname;
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, "cylindertrack.db");

function initDB() {
  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // --- USERS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      created TEXT DEFAULT (datetime('now'))
    )
  `);

  // --- SESSIONS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created TEXT DEFAULT (datetime('now')),
      expires TEXT NOT NULL
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
      created TEXT DEFAULT (date('now')),
      updated TEXT DEFAULT (datetime('now'))
    )
  `);

  // --- CYLINDER TYPES ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS cylinder_types (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      default_price REAL NOT NULL DEFAULT 0,
      gas_group TEXT DEFAULT '',
      item_type TEXT NOT NULL DEFAULT 'cylinder' CHECK(item_type IN ('cylinder', 'service')),
      sort_order INTEGER DEFAULT 0,
      created TEXT DEFAULT (datetime('now'))
    )
  `);

  // --- TRANSACTIONS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      customer_name TEXT DEFAULT '',
      cylinder_type TEXT NOT NULL REFERENCES cylinder_types(id),
      type TEXT NOT NULL CHECK(type IN ('delivery', 'return', 'sale')),
      qty INTEGER NOT NULL DEFAULT 1,
      date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created TEXT DEFAULT (datetime('now'))
    )
  `);

  // --- CUSTOMER PRICING (overrides) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_pricing (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      cylinder_type_id TEXT NOT NULL REFERENCES cylinder_types(id) ON DELETE CASCADE,
      price REAL NOT NULL,
      updated TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (customer_id, cylinder_type_id)
    )
  `);

  // --- INDEX for fast on-hand queries ---
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tx_customer ON transactions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);
  `);

  // Seed default cylinder types if table is empty
  const count = db.prepare("SELECT COUNT(*) as c FROM cylinder_types").get().c;
  if (count === 0) {
    const insert = db.prepare(
      "INSERT INTO cylinder_types (id, label, default_price, gas_group, item_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const seeds = [
      ["oxy_g", "Oxygen G Size", 45.0, "Oxygen", "cylinder", 1],
      ["oxy_e", "Oxygen E Size", 32.0, "Oxygen", "cylinder", 2],
      ["acet_g", "Acetylene G Size", 55.0, "Acetylene", "cylinder", 3],
      ["argon_d", "Argon D Size", 40.0, "Argon", "cylinder", 4],
      ["co2_e", "CO₂ E Size", 28.0, "CO₂", "cylinder", 5],
      ["nit_g", "Nitrogen G Size", 38.0, "Nitrogen", "cylinder", 6],
      ["lpg_45", "LPG 45kg", 85.0, "LPG", "cylinder", 7],
      ["lpg_9", "LPG 9kg", 35.0, "LPG", "cylinder", 8],
      ["gas_supply", "Gas Supply Service", 65.0, "Other", "service", 9],
    ];
    const insertMany = db.transaction((rows) => {
      for (const row of rows) insert.run(...row);
    });
    insertMany(seeds);
    console.log("  Seeded default cylinder types");
  }

  console.log("✓ Database initialized:", DB_PATH);
  return db;
}

module.exports = { initDB };
