const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const uid = () => crypto.randomBytes(6).toString("hex");

module.exports = function createRoutes(db) {
  // ============================================================
  // CUSTOMERS
  // ============================================================

  // List all customers
  router.get("/customers", (req, res) => {
    const rows = db.prepare("SELECT * FROM customers ORDER BY name").all();
    res.json(rows);
  });

  // Get single customer
  router.get("/customers/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Customer not found" });
    res.json(row);
  });

  // Create customer
  router.post("/customers", (req, res) => {
    const { name, contact, phone, email, address, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    const id = uid();
    db.prepare(
      "INSERT INTO customers (id, name, contact, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, name.trim(), contact || "", phone || "", email || "", address || "", notes || "");
    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
    res.status(201).json(row);
  });

  // Update customer
  router.put("/customers/:id", (req, res) => {
    const { name, contact, phone, email, address, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    const result = db.prepare(
      "UPDATE customers SET name=?, contact=?, phone=?, email=?, address=?, notes=?, updated=datetime('now') WHERE id=?"
    ).run(name.trim(), contact || "", phone || "", email || "", address || "", notes || "", req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Customer not found" });
    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
    res.json(row);
  });

  // Delete customer
  router.delete("/customers/:id", (req, res) => {
    const txCount = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE customer_id = ?").get(req.params.id).c;
    if (txCount > 0) return res.status(400).json({ error: "Cannot delete customer with transactions" });
    db.prepare("DELETE FROM customers WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // ============================================================
  // CYLINDER TYPES
  // ============================================================

  router.get("/cylinder-types", (req, res) => {
    const rows = db.prepare("SELECT * FROM cylinder_types ORDER BY sort_order, label").all();
    res.json(rows);
  });

  router.post("/cylinder-types", (req, res) => {
    const { label, default_price, gas_group, item_type } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: "Label is required" });
    const id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20) + "_" + uid();
    const maxOrder = db.prepare("SELECT MAX(sort_order) as m FROM cylinder_types").get().m || 0;
    db.prepare(
      "INSERT INTO cylinder_types (id, label, default_price, gas_group, item_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, label.trim(), default_price || 0, gas_group || "", item_type || "cylinder", maxOrder + 1);
    const row = db.prepare("SELECT * FROM cylinder_types WHERE id = ?").get(id);
    res.status(201).json(row);
  });

  router.put("/cylinder-types/:id", (req, res) => {
    const { label, default_price, gas_group, item_type } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: "Label is required" });
    const result = db.prepare(
      "UPDATE cylinder_types SET label=?, default_price=?, gas_group=?, item_type=? WHERE id=?"
    ).run(label.trim(), default_price || 0, gas_group || "", item_type || "cylinder", req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Cylinder type not found" });
    const row = db.prepare("SELECT * FROM cylinder_types WHERE id = ?").get(req.params.id);
    res.json(row);
  });

  router.delete("/cylinder-types/:id", (req, res) => {
    const txCount = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE cylinder_type = ?").get(req.params.id).c;
    if (txCount > 0) return res.status(400).json({ error: "Cannot delete — has transactions" });
    db.prepare("DELETE FROM cylinder_types WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // ============================================================
  // TRANSACTIONS
  // ============================================================

  // List transactions (with optional filters)
  router.get("/transactions", (req, res) => {
    const { customer_id, from, to, type, limit } = req.query;
    let sql = "SELECT * FROM transactions WHERE 1=1";
    const params = [];

    if (customer_id) { sql += " AND customer_id = ?"; params.push(customer_id); }
    if (type) { sql += " AND type = ?"; params.push(type); }
    if (from) { sql += " AND date >= ?"; params.push(from); }
    if (to) { sql += " AND date <= ?"; params.push(to); }

    sql += " ORDER BY date DESC, created DESC";
    if (limit) { sql += " LIMIT ?"; params.push(Number(limit)); }

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  });

  // Create transaction
  router.post("/transactions", (req, res) => {
    const { customer_id, cylinder_type, type, qty, date, notes } = req.body;
    if (!customer_id || !cylinder_type || !type || !qty) {
      return res.status(400).json({ error: "customer_id, cylinder_type, type, and qty are required" });
    }
    const customer = db.prepare("SELECT name FROM customers WHERE id = ?").get(customer_id);
    if (!customer) return res.status(400).json({ error: "Customer not found" });

    const id = uid();
    db.prepare(
      "INSERT INTO transactions (id, customer_id, customer_name, cylinder_type, type, qty, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, customer_id, customer.name, cylinder_type, type, Number(qty), date || new Date().toISOString().split("T")[0], notes || "");
    const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
    res.status(201).json(row);
  });

  // ============================================================
  // ON-HAND (computed from transactions, excluding services)
  // ============================================================

  router.get("/on-hand", (req, res) => {
    const { customer_id } = req.query;
    let sql = `
      SELECT t.customer_id, c.name as customer_name, c.address,
             t.cylinder_type, ct.label as cylinder_label, ct.item_type,
             SUM(CASE WHEN t.type = 'delivery' THEN t.qty ELSE 0 END) -
             SUM(CASE WHEN t.type = 'return' THEN t.qty ELSE 0 END) as on_hand
      FROM transactions t
      JOIN customers c ON c.id = t.customer_id
      JOIN cylinder_types ct ON ct.id = t.cylinder_type
      WHERE ct.item_type = 'cylinder'
    `;
    const params = [];
    if (customer_id) { sql += " AND t.customer_id = ?"; params.push(customer_id); }
    sql += " GROUP BY t.customer_id, t.cylinder_type HAVING on_hand != 0";
    sql += " ORDER BY c.name, ct.label";

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  });

  // ============================================================
  // CUSTOMER PRICING (overrides)
  // ============================================================

  // Get all pricing overrides
  router.get("/pricing", (req, res) => {
    const rows = db.prepare("SELECT * FROM customer_pricing ORDER BY customer_id").all();
    res.json(rows);
  });

  // Set price for customer + cylinder type
  router.put("/pricing/:customerId/:cylinderTypeId", (req, res) => {
    const { price } = req.body;
    if (price === undefined || price === null) return res.status(400).json({ error: "Price is required" });
    db.prepare(
      `INSERT INTO customer_pricing (customer_id, cylinder_type_id, price, updated)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(customer_id, cylinder_type_id) DO UPDATE SET price=?, updated=datetime('now')`
    ).run(req.params.customerId, req.params.cylinderTypeId, Number(price), Number(price));
    res.json({ success: true });
  });

  // Bulk update pricing for multiple customers
  router.post("/pricing/bulk", (req, res) => {
    const { customer_ids, cylinder_type_id, price } = req.body;
    if (!customer_ids?.length || !cylinder_type_id || price === undefined) {
      return res.status(400).json({ error: "customer_ids, cylinder_type_id, and price required" });
    }
    const stmt = db.prepare(
      `INSERT INTO customer_pricing (customer_id, cylinder_type_id, price, updated)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(customer_id, cylinder_type_id) DO UPDATE SET price=?, updated=datetime('now')`
    );
    const bulkUpdate = db.transaction((ids) => {
      for (const cid of ids) stmt.run(cid, cylinder_type_id, Number(price), Number(price));
    });
    bulkUpdate(customer_ids);
    res.json({ success: true, updated: customer_ids.length });
  });

  // Delete price override (reset to default)
  router.delete("/pricing/:customerId/:cylinderTypeId", (req, res) => {
    db.prepare("DELETE FROM customer_pricing WHERE customer_id = ? AND cylinder_type_id = ?")
      .run(req.params.customerId, req.params.cylinderTypeId);
    res.json({ success: true });
  });

  // Reset all overrides for a customer
  router.delete("/pricing/:customerId", (req, res) => {
    const result = db.prepare("DELETE FROM customer_pricing WHERE customer_id = ?").run(req.params.customerId);
    res.json({ success: true, deleted: result.changes });
  });

  // ============================================================
  // BILLING (computed endpoint)
  // ============================================================

  router.get("/billing", (req, res) => {
    const { month } = req.query; // format: YYYY-MM
    if (!month) return res.status(400).json({ error: "month parameter required (YYYY-MM)" });

    const [year, m] = month.split("-").map(Number);
    const monthStart = `${month}-01`;
    const lastDay = new Date(year, m, 0).getDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

    const customers = db.prepare("SELECT * FROM customers ORDER BY name").all();
    const cylinderTypes = db.prepare("SELECT * FROM cylinder_types").all();
    const pricing = db.prepare("SELECT * FROM customer_pricing").all();

    // Build pricing lookup
    const priceMap = {};
    for (const p of pricing) priceMap[`${p.customer_id}__${p.cylinder_type_id}`] = p.price;
    const getPrice = (custId, typeId) => {
      const key = `${custId}__${typeId}`;
      if (priceMap[key] !== undefined) return priceMap[key];
      const ct = cylinderTypes.find((c) => c.id === typeId);
      return ct ? ct.default_price : 0;
    };

    // On-hand for cylinder rentals
    const onHand = db.prepare(`
      SELECT customer_id, cylinder_type,
             SUM(CASE WHEN type='delivery' THEN qty ELSE 0 END) -
             SUM(CASE WHEN type='return' THEN qty ELSE 0 END) as on_hand
      FROM transactions t
      JOIN cylinder_types ct ON ct.id = t.cylinder_type
      WHERE ct.item_type = 'cylinder'
      GROUP BY customer_id, cylinder_type
      HAVING on_hand > 0
    `).all();

    // Service sales in billing month
    const sales = db.prepare(`
      SELECT customer_id, cylinder_type, SUM(qty) as total_qty
      FROM transactions t
      JOIN cylinder_types ct ON ct.id = t.cylinder_type
      WHERE ct.item_type = 'service' AND t.type = 'sale'
        AND t.date >= ? AND t.date <= ?
      GROUP BY customer_id, cylinder_type
    `).all(monthStart, monthEnd);

    // Build billing per customer
    const billingMap = {};
    for (const row of onHand) {
      if (!billingMap[row.customer_id]) billingMap[row.customer_id] = { lines: [], total: 0 };
      const price = getPrice(row.customer_id, row.cylinder_type);
      const ct = cylinderTypes.find((c) => c.id === row.cylinder_type);
      const lineTotal = row.on_hand * price;
      const isOverride = priceMap[`${row.customer_id}__${row.cylinder_type}`] !== undefined;
      billingMap[row.customer_id].lines.push({
        cylinder_type: row.cylinder_type, label: ct?.label, qty: row.on_hand,
        price, line_total: lineTotal, is_override: isOverride, category: "rental",
      });
      billingMap[row.customer_id].total += lineTotal;
    }
    for (const row of sales) {
      if (!billingMap[row.customer_id]) billingMap[row.customer_id] = { lines: [], total: 0 };
      const price = getPrice(row.customer_id, row.cylinder_type);
      const ct = cylinderTypes.find((c) => c.id === row.cylinder_type);
      const lineTotal = row.total_qty * price;
      const isOverride = priceMap[`${row.customer_id}__${row.cylinder_type}`] !== undefined;
      billingMap[row.customer_id].lines.push({
        cylinder_type: row.cylinder_type, label: ct?.label, qty: row.total_qty,
        price, line_total: lineTotal, is_override: isOverride, category: "service",
      });
      billingMap[row.customer_id].total += lineTotal;
    }

    const result = customers
      .filter((c) => billingMap[c.id])
      .map((c) => ({ ...c, ...billingMap[c.id] }));
    const grand_total = result.reduce((sum, c) => sum + c.total, 0);

    res.json({ month, customers: result, grand_total });
  });

  // ============================================================
  // DASHBOARD STATS
  // ============================================================

  router.get("/stats", (req, res) => {
    const totalCustomers = db.prepare("SELECT COUNT(*) as c FROM customers").get().c;
    const totalDeliveries = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE type='delivery'").get().c;
    const totalReturns = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE type='return'").get().c;
    const totalSales = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE type='sale'").get().c;

    const onHandResult = db.prepare(`
      SELECT COALESCE(SUM(oh), 0) as total FROM (
        SELECT SUM(CASE WHEN t.type='delivery' THEN t.qty ELSE 0 END) -
               SUM(CASE WHEN t.type='return' THEN t.qty ELSE 0 END) as oh
        FROM transactions t
        JOIN cylinder_types ct ON ct.id = t.cylinder_type
        WHERE ct.item_type = 'cylinder'
        GROUP BY t.customer_id, t.cylinder_type
        HAVING oh > 0
      )
    `).get();

    const recentTx = db.prepare(
      "SELECT * FROM transactions ORDER BY date DESC, created DESC LIMIT 10"
    ).all();

    res.json({
      total_customers: totalCustomers,
      total_on_hand: onHandResult.total,
      total_deliveries: totalDeliveries,
      total_returns: totalReturns,
      total_sales: totalSales,
      recent_transactions: recentTx,
    });
  });

  // ============================================================
  // BACKUP / EXPORT
  // ============================================================

  // Export all data as JSON
  router.get("/backup", (req, res) => {
    const customers = db.prepare("SELECT * FROM customers ORDER BY name").all();
    const cylinderTypes = db.prepare("SELECT * FROM cylinder_types ORDER BY sort_order, label").all();
    const transactions = db.prepare("SELECT * FROM transactions ORDER BY date DESC, created DESC").all();
    const pricing = db.prepare("SELECT * FROM customer_pricing").all();

    const backup = {
      exported_at: new Date().toISOString(),
      version: "1.0",
      data: { customers, cylinder_types: cylinderTypes, transactions, customer_pricing: pricing }
    };

    res.setHeader("Content-Disposition", `attachment; filename=cylindertrack-backup-${new Date().toISOString().split("T")[0]}.json`);
    res.json(backup);
  });

  // Import data from JSON backup
  router.post("/restore", (req, res) => {
    const { data } = req.body;
    if (!data || !data.customers || !data.cylinder_types || !data.transactions) {
      return res.status(400).json({ error: "Invalid backup file" });
    }

    const runRestore = db.transaction(() => {
      // Clear existing data
      db.prepare("DELETE FROM customer_pricing").run();
      db.prepare("DELETE FROM transactions").run();
      db.prepare("DELETE FROM customers").run();
      db.prepare("DELETE FROM cylinder_types").run();

      // Restore cylinder types
      const ctStmt = db.prepare("INSERT INTO cylinder_types (id, label, default_price, gas_group, item_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
      for (const ct of data.cylinder_types) {
        ctStmt.run(ct.id, ct.label, ct.default_price, ct.gas_group || "", ct.item_type || "cylinder", ct.sort_order || 0);
      }

      // Restore customers
      const cStmt = db.prepare("INSERT INTO customers (id, name, contact, phone, email, address, notes, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const c of data.customers) {
        cStmt.run(c.id, c.name, c.contact || "", c.phone || "", c.email || "", c.address || "", c.notes || "", c.created || new Date().toISOString());
      }

      // Restore transactions
      const txStmt = db.prepare("INSERT INTO transactions (id, customer_id, customer_name, cylinder_type, type, qty, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const tx of data.transactions) {
        txStmt.run(tx.id, tx.customer_id, tx.customer_name || "", tx.cylinder_type, tx.type, tx.qty, tx.date, tx.notes || "");
      }

      // Restore pricing
      if (data.customer_pricing) {
        const pStmt = db.prepare("INSERT INTO customer_pricing (customer_id, cylinder_type_id, price) VALUES (?, ?, ?)");
        for (const p of data.customer_pricing) {
          pStmt.run(p.customer_id, p.cylinder_type_id, p.price);
        }
      }
    });

    try {
      runRestore();
      res.json({ success: true, message: "Data restored successfully" });
    } catch (e) {
      res.status(500).json({ error: "Restore failed: " + e.message });
    }
  });

  return router;
};
