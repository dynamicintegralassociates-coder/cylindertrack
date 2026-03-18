const express = require("express");
const nodeCrypto = require("crypto");
const { OptimoRouteClient } = require("./optimoroute");
const { encrypt, decrypt, maskCard } = require("./crypto");

const uid = () => nodeCrypto.randomBytes(6).toString("hex");

module.exports = function createRoutes(db) {
  const router = express.Router();

  // ============================================================
  // SEARCH (global)
  // ============================================================
  router.get("/search", (req, res) => {
    const q = req.query.q || "";
    const term = `%${q}%`;
    const customers = db.prepare(
      "SELECT * FROM customers WHERE address LIKE ? OR name LIKE ? ORDER BY address, name"
    ).all(term, term);
    const customerIds = customers.map(c => c.id);
    let transactions = [];
    if (customerIds.length > 0) {
      const placeholders = customerIds.map(() => "?").join(",");
      transactions = db.prepare(
        `SELECT * FROM transactions WHERE customer_id IN (${placeholders}) ORDER BY date DESC LIMIT 50`
      ).all(...customerIds);
    }
    res.json({ customers, transactions });
  });

  // ============================================================
  // CUSTOMERS
  // ============================================================
  router.get("/customers", (req, res) => {
    const rows = db.prepare("SELECT * FROM customers ORDER BY name").all();
    // Return masked CC — never send encrypted blob to client
    const safe = rows.map(c => ({
      ...c,
      cc_masked: maskCard(decrypt(c.cc_encrypted, db)),
      cc_encrypted: undefined, // strip encrypted data
    }));
    res.json(safe);
  });

  router.post("/customers", (req, res) => {
    const { name, contact, phone, email, address, notes, onedrive_link, payment_ref, cc_number, account_customer } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    const id = uid();
    const ccEnc = cc_number ? encrypt(cc_number.replace(/\D/g, ""), db) : "";
    db.prepare(
      "INSERT INTO customers (id, name, contact, phone, email, address, notes, onedrive_link, payment_ref, cc_encrypted, account_customer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, name.trim(), contact || "", phone || "", email || "", address || "", notes || "", onedrive_link || "", payment_ref || "", ccEnc, account_customer ? 1 : 0);
    res.json({ id, name: name.trim() });
  });

  router.put("/customers/:id", (req, res) => {
    const { name, contact, phone, email, address, notes, onedrive_link, payment_ref, cc_number, account_customer } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    if (cc_number && cc_number.replace(/\D/g, "").length >= 4) {
      const ccEnc = encrypt(cc_number.replace(/\D/g, ""), db);
      db.prepare(
        "UPDATE customers SET name=?, contact=?, phone=?, email=?, address=?, notes=?, onedrive_link=?, payment_ref=?, cc_encrypted=?, account_customer=?, updated=datetime('now') WHERE id=?"
      ).run(name.trim(), contact || "", phone || "", email || "", address || "", notes || "", onedrive_link || "", payment_ref || "", ccEnc, account_customer ? 1 : 0, req.params.id);
    } else {
      db.prepare(
        "UPDATE customers SET name=?, contact=?, phone=?, email=?, address=?, notes=?, onedrive_link=?, payment_ref=?, account_customer=?, updated=datetime('now') WHERE id=?"
      ).run(name.trim(), contact || "", phone || "", email || "", address || "", notes || "", onedrive_link || "", payment_ref || "", account_customer ? 1 : 0, req.params.id);
    }
    res.json({ success: true });
  });

  // Reveal full CC number (admin only, one customer at a time)
  router.get("/customers/:id/reveal-cc", (req, res) => {
    const cust = db.prepare("SELECT cc_encrypted FROM customers WHERE id = ?").get(req.params.id);
    if (!cust) return res.status(404).json({ error: "Customer not found" });
    if (!cust.cc_encrypted) return res.json({ cc_number: "" });
    const decrypted = decrypt(cust.cc_encrypted, db);
    // Format as groups of 4
    const formatted = decrypted.replace(/(\d{4})(?=\d)/g, "$1 ");
    res.json({ cc_number: formatted });
  });

  // Delete CC from file
  router.delete("/customers/:id/cc", (req, res) => {
    db.prepare("UPDATE customers SET cc_encrypted = '' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  router.delete("/customers/:id", (req, res) => {
    const txCount = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE customer_id = ?").get(req.params.id).c;
    if (txCount > 0) return res.status(400).json({ error: "Cannot delete customer with transactions" });
    db.prepare("DELETE FROM customer_pricing WHERE customer_id = ?").run(req.params.id);
    db.prepare("DELETE FROM customers WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // ============================================================
  // CYLINDER TYPES
  // ============================================================
  router.get("/cylinder-types", (req, res) => {
    res.json(db.prepare("SELECT * FROM cylinder_types ORDER BY sort_order, label").all());
  });

  router.post("/cylinder-types", (req, res) => {
    const { label, default_price, gas_group, item_type, sort_order } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: "Label is required" });
    const id = uid();
    db.prepare(
      "INSERT INTO cylinder_types (id, label, default_price, gas_group, item_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, label.trim(), default_price || 0, gas_group || "", item_type || "cylinder", sort_order || 0);
    res.json({ id, label: label.trim() });
  });

  router.put("/cylinder-types/:id", (req, res) => {
    const { label, default_price, gas_group, item_type, sort_order } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: "Label is required" });
    db.prepare(
      "UPDATE cylinder_types SET label=?, default_price=?, gas_group=?, item_type=?, sort_order=? WHERE id=?"
    ).run(label.trim(), default_price || 0, gas_group || "", item_type || "cylinder", sort_order || 0, req.params.id);
    res.json({ success: true });
  });

  router.delete("/cylinder-types/:id", (req, res) => {
    const txCount = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE cylinder_type = ?").get(req.params.id).c;
    if (txCount > 0) return res.status(400).json({ error: "Cannot delete cylinder type with transactions" });
    db.prepare("DELETE FROM customer_pricing WHERE cylinder_type = ?").run(req.params.id);
    db.prepare("DELETE FROM cylinder_types WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // ============================================================
  // TRANSACTIONS
  // ============================================================
  router.get("/transactions", (req, res) => {
    const { customer_id, cylinder_type, type, from, to, source, limit } = req.query;
    let sql = "SELECT * FROM transactions WHERE 1=1";
    const params = [];
    if (customer_id) { sql += " AND customer_id = ?"; params.push(customer_id); }
    if (cylinder_type) { sql += " AND cylinder_type = ?"; params.push(cylinder_type); }
    if (type) { sql += " AND type = ?"; params.push(type); }
    if (from) { sql += " AND date >= ?"; params.push(from); }
    if (to) { sql += " AND date <= ?"; params.push(to); }
    if (source) { sql += " AND source = ?"; params.push(source); }
    sql += " ORDER BY date DESC, created DESC";
    if (limit) { sql += " LIMIT ?"; params.push(parseInt(limit)); }
    res.json(db.prepare(sql).all(...params));
  });

  router.post("/transactions", (req, res) => {
    const { customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order } = req.body;
    if (!customer_id || !cylinder_type || !type || !qty || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const id = uid();
    db.prepare(
      "INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, customer_id, cylinder_type, type, parseInt(qty), date, notes || "", source || "manual", optimoroute_order || "");
    res.json({ id });
  });

  router.delete("/transactions/:id", (req, res) => {
    db.prepare("DELETE FROM transactions WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // ============================================================
  // ORDERS
  // ============================================================
  router.get("/orders", (req, res) => {
    const { status, customer_id, from, to, limit } = req.query;
    let sql = "SELECT o.*, c.name as customer_name_lookup, c.address as customer_address_lookup FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE 1=1";
    const params = [];
    if (status) { sql += " AND o.status = ?"; params.push(status); }
    if (customer_id) { sql += " AND o.customer_id = ?"; params.push(customer_id); }
    if (from) { sql += " AND o.order_date >= ?"; params.push(from); }
    if (to) { sql += " AND o.order_date <= ?"; params.push(to); }
    sql += " ORDER BY o.order_date DESC, o.created DESC";
    if (limit) { sql += " LIMIT ?"; params.push(parseInt(limit)); }
    res.json(db.prepare(sql).all(...params));
  });

  // Lookup price for a customer + order field (e.g. "2x45")
  router.get("/orders/lookup-price", (req, res) => {
    const { customer_id, order_detail } = req.query;
    if (!order_detail) return res.json({ lines: [], total: 0 });

    const cylinderTypes = db.prepare("SELECT * FROM cylinder_types").all();
    
    // Split by comma into individual items
    const items = order_detail.split(",").map(s => s.trim()).filter(Boolean);
    const lines = [];
    let total = 0;

    // Get all customer prices in one query
    let custPriceMap = {};
    if (customer_id) {
      const rows = db.prepare("SELECT * FROM customer_pricing WHERE customer_id = ?").all(customer_id);
      for (const r of rows) custPriceMap[r.cylinder_type] = r.price;
    }

    for (const item of items) {
      const parsed = parseCylinderFromText(item, cylinderTypes);
      if (!parsed.cylinderType) {
        lines.push({ raw: item, matched: false, cylinder_label: "", cylinder_type_id: "", qty: 0, unit_price: 0, line_total: 0 });
        continue;
      }
      const ct = parsed.cylinderType;
      const qty = parsed.qty || 1;
      const unitPrice = custPriceMap[ct.id] !== undefined ? custPriceMap[ct.id] : ct.default_price;
      const lineTotal = Math.round(unitPrice * qty * 100) / 100;
      total += lineTotal;
      lines.push({
        raw: item,
        matched: true,
        cylinder_label: ct.label,
        cylinder_type_id: ct.id,
        qty,
        unit_price: unitPrice,
        line_total: lineTotal,
      });
    }

    // For backwards compat, also return first item's data as top-level fields
    const first = lines.find(l => l.matched) || {};
    res.json({
      lines,
      total: Math.round(total * 100) / 100,
      // First matched item (for cylinder tracking transaction)
      unit_price: first.unit_price || 0,
      qty: first.qty || 0,
      cylinder_type_id: first.cylinder_type_id || "",
      cylinder_label: first.cylinder_label || "",
    });
  });

  router.post("/orders", (req, res) => {
    const { customer_id, address, customer_name, order_detail, cylinder_type_id, qty, unit_price, total_price, notes, order_date, payment, payment_ref } = req.body;
    if (!customer_id) return res.status(400).json({ error: "Customer is required" });
    if (!order_date) return res.status(400).json({ error: "Order date is required" });
    const id = uid();
    db.prepare(
      "INSERT INTO orders (id, customer_id, address, customer_name, order_detail, cylinder_type_id, qty, unit_price, total_price, notes, order_date, payment, payment_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, customer_id, address || "", customer_name || "", order_detail || "", cylinder_type_id || "", qty || 1, unit_price || 0, total_price || 0, notes || "", order_date, payment || "", payment_ref || "");
    res.json({ id });
  });

  router.put("/orders/:id", (req, res) => {
    const { customer_id, address, customer_name, order_detail, cylinder_type_id, qty, unit_price, total_price, notes, order_date, payment, payment_ref, status } = req.body;
    db.prepare(
      "UPDATE orders SET customer_id=?, address=?, customer_name=?, order_detail=?, cylinder_type_id=?, qty=?, unit_price=?, total_price=?, notes=?, order_date=?, payment=?, payment_ref=?, status=?, updated=datetime('now') WHERE id=?"
    ).run(customer_id, address || "", customer_name || "", order_detail || "", cylinder_type_id || "", qty || 1, unit_price || 0, total_price || 0, notes || "", order_date, payment || "", payment_ref || "", status || "open", req.params.id);
    res.json({ success: true });
  });

  // Update customer price from order
  router.post("/orders/update-customer-price", (req, res) => {
    const { customer_id, cylinder_type_id, price } = req.body;
    if (!customer_id || !cylinder_type_id || price === undefined) return res.status(400).json({ error: "Missing fields" });
    const today = new Date().toISOString().split("T")[0];

    // Check if there's an active fixed price contract — don't overwrite it
    const existing = db.prepare("SELECT * FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?").get(customer_id, cylinder_type_id);
    if (existing?.fixed_price && existing.fixed_from && existing.fixed_to && today >= existing.fixed_from && today <= existing.fixed_to) {
      return res.status(400).json({ error: "Cannot update — customer has an active fixed price contract until " + existing.fixed_to });
    }

    // Preserve fixed price fields if they exist
    db.prepare(
      "INSERT OR REPLACE INTO customer_pricing (customer_id, cylinder_type, price, fixed_price, fixed_from, fixed_to) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(customer_id, cylinder_type_id, price, existing?.fixed_price || 0, existing?.fixed_from || "", existing?.fixed_to || "");
    db.prepare("INSERT INTO price_history (customer_id, cylinder_type, price, effective_from) VALUES (?, ?, ?, ?)").run(customer_id, cylinder_type_id, price, today);
    res.json({ success: true });
  });

  router.delete("/orders/:id", (req, res) => {
    db.prepare("DELETE FROM orders WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Confirm payment → push order to OptimoRoute + create delivery transactions
  router.post("/orders/:id/confirm-payment", async (req, res) => {
    try {
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });

      const apiKey = getApiKey(db);
      if (!apiKey) return res.status(400).json({ error: "OptimoRoute API key not configured" });
      const client = new OptimoRouteClient(apiKey);

      let orResult;
      if (order.optimoroute_id) {
        orResult = await client.syncOrder({
          id: order.optimoroute_id,
          customerName: order.customer_name,
          address: order.address,
          payment: order.payment,
          order: order.order_detail,
          notes: order.notes,
          date: order.order_date,
        });
      } else {
        orResult = await client.createOrder({
          customerName: order.customer_name,
          address: order.address,
          payment: order.payment,
          order: order.order_detail,
          notes: order.notes,
          date: order.order_date,
        });
      }

      const orId = orResult.id || order.optimoroute_id || "";
      db.prepare(
        "UPDATE orders SET payment_confirmed = 1, optimoroute_id = ?, status = 'confirmed', updated = datetime('now') WHERE id = ?"
      ).run(orId, req.params.id);

      // Auto-create delivery transaction from order qty + cylinder type
      let txCreated = 0;
      if (order.cylinder_type_id && order.qty > 0) {
        const txId = uid();
        db.prepare(
          "INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(txId, order.customer_id, order.cylinder_type_id, "delivery", order.qty, order.order_date, `Order: ${order.order_detail}`, "order", req.params.id);
        txCreated = 1;
      }

      res.json({ success: true, optimoroute: orResult, transactionsCreated: txCreated });
    } catch (err) {
      console.error("[OR Push] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Resend/update an already-confirmed order to OptimoRoute
  router.post("/orders/:id/resend", async (req, res) => {
    try {
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (!order.optimoroute_id) return res.status(400).json({ error: "Order has not been pushed to OptimoRoute yet" });

      const apiKey = getApiKey(db);
      if (!apiKey) return res.status(400).json({ error: "OptimoRoute API key not configured" });
      const client = new OptimoRouteClient(apiKey);

      const orResult = await client.syncOrder({
        id: order.optimoroute_id,
        customerName: order.customer_name,
        address: order.address,
        payment: order.payment,
        order: order.order_detail,
        notes: order.notes,
        date: order.order_date,
      });

      db.prepare("UPDATE orders SET updated = datetime('now') WHERE id = ?").run(req.params.id);
      res.json({ success: true, optimoroute: orResult });
    } catch (err) {
      console.error("[OR Resend] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // OPENING BALANCES
  // ============================================================
  // Add single opening balance
  router.post("/opening-balance", (req, res) => {
    const { customer_id, cylinder_type, qty, date } = req.body;
    if (!customer_id || !cylinder_type || !qty || !date) return res.status(400).json({ error: "All fields required" });
    const id = uid();
    db.prepare(
      "INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, customer_id, cylinder_type, "delivery", parseInt(qty), date, "Opening balance", "opening_balance");
    res.json({ id, success: true });
  });

  // Bulk import opening balances
  router.post("/opening-balance/bulk", (req, res) => {
    const { entries } = req.body; // [{ customer_id, cylinder_type, qty, date }]
    if (!entries?.length) return res.status(400).json({ error: "No entries provided" });
    let imported = 0;
    const stmt = db.prepare(
      "INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    db.transaction(() => {
      for (const e of entries) {
        if (e.customer_id && e.cylinder_type && e.qty > 0) {
          stmt.run(uid(), e.customer_id, e.cylinder_type, "delivery", parseInt(e.qty), e.date || new Date().toISOString().split("T")[0], "Opening balance", "opening_balance");
          imported++;
        }
      }
    })();
    res.json({ success: true, imported });
  });

  // ============================================================
  // ON-HAND
  // ============================================================
  router.get("/on-hand", (req, res) => {
    res.json(db.prepare(`
      SELECT t.customer_id, t.cylinder_type,
        SUM(CASE WHEN t.type='delivery' THEN t.qty ELSE 0 END) -
        SUM(CASE WHEN t.type='return' THEN t.qty ELSE 0 END) as on_hand
      FROM transactions t
      JOIN cylinder_types ct ON ct.id = t.cylinder_type
      WHERE ct.item_type = 'cylinder'
      GROUP BY t.customer_id, t.cylinder_type
      HAVING on_hand != 0
    `).all());
  });

  // On-hand as at a specific date (point-in-time)
  router.get("/on-hand/as-at", (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date is required" });
    const rows = db.prepare(`
      SELECT t.customer_id, t.cylinder_type,
        SUM(CASE WHEN t.type='delivery' THEN t.qty ELSE 0 END) -
        SUM(CASE WHEN t.type='return' THEN t.qty ELSE 0 END) as on_hand
      FROM transactions t
      JOIN cylinder_types ct ON ct.id = t.cylinder_type
      WHERE ct.item_type = 'cylinder' AND t.date <= ?
      GROUP BY t.customer_id, t.cylinder_type
      HAVING on_hand != 0
    `).all(date);

    // Enrich with customer name, cylinder label, and pricing
    const customers = db.prepare("SELECT id, name, address, account_customer FROM customers").all();
    const custMap = {};
    for (const c of customers) custMap[c.id] = c;

    const cylinderTypes = db.prepare("SELECT id, label, default_price FROM cylinder_types WHERE item_type = 'cylinder'").all();
    const ctMap = {};
    for (const ct of cylinderTypes) ctMap[ct.id] = ct;

    const enriched = rows.map(r => {
      const cust = custMap[r.customer_id] || {};
      const ct = ctMap[r.cylinder_type] || {};
      const unitPrice = getPriceForDate(db, r.customer_id, r.cylinder_type, date, ct.default_price || 0);
      return {
        customer_id: r.customer_id,
        customer_name: cust.name || "Unknown",
        customer_address: cust.address || "",
        account_customer: cust.account_customer || 0,
        cylinder_type: r.cylinder_type,
        cylinder_label: ct.label || r.cylinder_type,
        on_hand: r.on_hand,
        unit_price: unitPrice,
        line_total: Math.round(unitPrice * r.on_hand * 100) / 100,
      };
    });

    res.json(enriched);
  });

  // Generate rental invoices — creates billing transactions for selected customers
  router.post("/on-hand/generate-invoices", (req, res) => {
    const { date, customers: customerIds } = req.body;
    if (!date || !customerIds?.length) return res.status(400).json({ error: "date and customers are required" });

    const cylinderTypes = db.prepare("SELECT * FROM cylinder_types WHERE item_type = 'cylinder'").all();
    const ctMap = {};
    for (const ct of cylinderTypes) ctMap[ct.id] = ct;

    const txStmt = db.prepare(
      "INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    let totalTx = 0;
    const invoices = [];

    db.transaction(() => {
      for (const custId of customerIds) {
        // Calculate on-hand as at date for this customer
        const rows = db.prepare(`
          SELECT t.cylinder_type,
            SUM(CASE WHEN t.type='delivery' THEN t.qty ELSE 0 END) -
            SUM(CASE WHEN t.type='return' THEN t.qty ELSE 0 END) as on_hand
          FROM transactions t
          JOIN cylinder_types ct ON ct.id = t.cylinder_type
          WHERE ct.item_type = 'cylinder' AND t.customer_id = ? AND t.date <= ?
          GROUP BY t.cylinder_type
          HAVING on_hand > 0
        `).all(custId, date);

        const lines = [];
        for (const r of rows) {
          const ct = ctMap[r.cylinder_type];
          if (!ct) continue;
          const unitPrice = getPriceForDate(db, custId, r.cylinder_type, date, ct.default_price || 0);
          const lineTotal = Math.round(unitPrice * r.on_hand * 100) / 100;

          // Create a rental billing transaction
          const txId = uid();
          txStmt.run(txId, custId, r.cylinder_type, "rental_invoice", r.on_hand, date, `Rental invoice as at ${date}`, "rental_invoice");
          totalTx++;

          lines.push({
            cylinder_type: r.cylinder_type,
            cylinder_label: ct.label,
            on_hand: r.on_hand,
            unit_price: unitPrice,
            line_total: lineTotal,
          });
        }

        if (lines.length > 0) {
          invoices.push({ customer_id: custId, lines, total: Math.round(lines.reduce((s, l) => s + l.line_total, 0) * 100) / 100 });
        }
      }
    })();

    res.json({ success: true, invoicesGenerated: invoices.length, transactionsCreated: totalTx, invoices });
  });

  // ============================================================
  // PRICING
  // ============================================================
  router.get("/pricing", (req, res) => {
    res.json(db.prepare("SELECT * FROM customer_pricing").all());
  });

  // Get full price list for a specific customer (all cylinder types with their prices)
  router.get("/pricing/customer/:custId", (req, res) => {
    const cylinderTypes = db.prepare("SELECT * FROM cylinder_types ORDER BY sort_order, label").all();
    const custPrices = db.prepare("SELECT * FROM customer_pricing WHERE customer_id = ?").all(req.params.custId);
    const priceMap = {};
    for (const p of custPrices) priceMap[p.cylinder_type] = p;

    const list = cylinderTypes.map(ct => {
      const cp = priceMap[ct.id];
      return {
        cylinder_type: ct.id,
        label: ct.label,
        default_price: ct.default_price,
        item_type: ct.item_type,
        customer_price: cp?.price ?? null,
        effective_price: cp?.price ?? ct.default_price,
        is_custom: !!cp,
        fixed_price: cp?.fixed_price || 0,
        fixed_from: cp?.fixed_from || "",
        fixed_to: cp?.fixed_to || "",
      };
    });
    res.json(list);
  });

  // Set individual customer price (with optional fixed price contract)
  router.put("/pricing/:custId/:typeId", (req, res) => {
    const { price, fixed_price, fixed_from, fixed_to } = req.body;
    const today = new Date().toISOString().split("T")[0];
    db.prepare(
      "INSERT OR REPLACE INTO customer_pricing (customer_id, cylinder_type, price, fixed_price, fixed_from, fixed_to) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(req.params.custId, req.params.typeId, price, fixed_price ? 1 : 0, fixed_from || "", fixed_to || "");
    db.prepare("INSERT INTO price_history (customer_id, cylinder_type, price, effective_from) VALUES (?, ?, ?, ?)").run(req.params.custId, req.params.typeId, price, today);
    res.json({ success: true });
  });

  router.delete("/pricing/:custId/:typeId", (req, res) => {
    db.prepare("DELETE FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?").run(req.params.custId, req.params.typeId);
    res.json({ success: true });
  });

  router.get("/pricing/history/:custId/:typeId", (req, res) => {
    res.json(db.prepare("SELECT * FROM price_history WHERE customer_id = ? AND cylinder_type = ? ORDER BY effective_from DESC").all(req.params.custId, req.params.typeId));
  });

  // Bulk pricing — skips customers with active fixed price contracts
  router.post("/pricing/bulk", (req, res) => {
    const { cylinder_type, price, customer_ids, mode, percentage } = req.body;
    if (!cylinder_type || !customer_ids?.length) return res.status(400).json({ error: "Missing fields" });
    const today = new Date().toISOString().split("T")[0];
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO customer_pricing (customer_id, cylinder_type, price, fixed_price, fixed_from, fixed_to) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const histStmt = db.prepare("INSERT INTO price_history (customer_id, cylinder_type, price, effective_from) VALUES (?, ?, ?, ?)");
    const cylinderTypeData = db.prepare("SELECT default_price FROM cylinder_types WHERE id = ?").get(cylinder_type);
    let updated = 0;
    let skippedFixed = 0;
    const apply = db.transaction(() => {
      for (const custId of customer_ids) {
        // Check if customer has an active fixed price contract
        const existing = db.prepare("SELECT * FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?").get(custId, cylinder_type);
        if (existing?.fixed_price && existing.fixed_from && existing.fixed_to) {
          if (today >= existing.fixed_from && today <= existing.fixed_to) {
            skippedFixed++;
            continue; // Skip — fixed price is active
          }
        }

        let newPrice;
        if (mode === "percentage" && percentage) {
          const basePrice = existing ? existing.price : (cylinderTypeData?.default_price || 0);
          newPrice = Math.round(basePrice * (1 + percentage / 100) * 100) / 100;
        } else {
          newPrice = price;
        }
        // Preserve fixed price fields if they exist but are expired
        stmt.run(custId, cylinder_type, newPrice, existing?.fixed_price || 0, existing?.fixed_from || "", existing?.fixed_to || "");
        histStmt.run(custId, cylinder_type, newPrice, today);
        updated++;
      }
    });
    apply();
    res.json({ success: true, updated, skippedFixed });
  });

  // ============================================================
  // BILLING (supports date range, rental/sales grouping, historical prices)
  // ============================================================
  router.get("/billing", (req, res) => {
    // Accepts either ?month=YYYY-MM or ?from=YYYY-MM-DD&to=YYYY-MM-DD
    let dateFrom, dateTo;
    if (req.query.from && req.query.to) {
      dateFrom = req.query.from;
      dateTo = req.query.to;
    } else {
      const month = req.query.month;
      if (!month) return res.status(400).json({ error: "month or from/to required" });
      const [year, mon] = month.split("-");
      const lastDay = new Date(year, mon, 0).getDate();
      dateFrom = `${month}-01`;
      dateTo = `${month}-${String(lastDay).padStart(2, "0")}`;
    }

    const filterCustomer = req.query.customer_id || null;
    const customers = filterCustomer
      ? db.prepare("SELECT * FROM customers WHERE id = ?").all(filterCustomer)
      : db.prepare("SELECT * FROM customers ORDER BY name").all();
    const allCylinderTypes = db.prepare("SELECT * FROM cylinder_types ORDER BY sort_order, label").all();
    const rentalTypes = allCylinderTypes.filter(ct => ct.item_type === "cylinder");
    const saleTypes = allCylinderTypes.filter(ct => ct.item_type === "sale");

    const bills = [];
    for (const cust of customers) {
      const rentalLines = [];
      const saleLines = [];

      // RENTAL: based on on-hand at end of period
      for (const ct of rentalTypes) {
        const onHand = db.prepare(`
          SELECT COALESCE(SUM(CASE WHEN type='delivery' THEN qty ELSE 0 END) - SUM(CASE WHEN type='return' THEN qty ELSE 0 END), 0) as oh
          FROM transactions WHERE customer_id = ? AND cylinder_type = ? AND date <= ?
        `).get(cust.id, ct.id, dateTo).oh;

        if (onHand > 0) {
          const unitPrice = getPriceForDate(db, cust.id, ct.id, dateTo, ct.default_price);
          rentalLines.push({ cylinder_type: ct.id, label: ct.label, qty: onHand, unit_price: unitPrice, total: onHand * unitPrice, item_type: "cylinder" });
        }
      }

      // SALES: count deliveries of sale-type items in the date range (not tracked for on-hand)
      for (const ct of saleTypes) {
        const deliveredInRange = db.prepare(`
          SELECT COALESCE(SUM(qty), 0) as total_qty
          FROM transactions WHERE customer_id = ? AND cylinder_type = ? AND type = 'delivery' AND date >= ? AND date <= ?
        `).get(cust.id, ct.id, dateFrom, dateTo).total_qty;

        if (deliveredInRange > 0) {
          const unitPrice = getPriceForDate(db, cust.id, ct.id, dateTo, ct.default_price);
          saleLines.push({ cylinder_type: ct.id, label: ct.label, qty: deliveredInRange, unit_price: unitPrice, total: deliveredInRange * unitPrice, item_type: "sale" });
        }
      }

      const rentalTotal = rentalLines.reduce((s, l) => s + l.total, 0);
      const salesTotal = saleLines.reduce((s, l) => s + l.total, 0);

      if (rentalLines.length > 0 || saleLines.length > 0) {
        bills.push({
          customer: cust,
          rentalLines,
          saleLines,
          rentalTotal,
          salesTotal,
          total: rentalTotal + salesTotal,
        });
      }
    }

    res.json({
      dateFrom,
      dateTo,
      bills,
      grand_rental: bills.reduce((s, b) => s + b.rentalTotal, 0),
      grand_sales: bills.reduce((s, b) => s + b.salesTotal, 0),
      grand_total: bills.reduce((s, b) => s + b.total, 0),
    });
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
        SELECT SUM(CASE WHEN t.type='delivery' THEN t.qty ELSE 0 END) - SUM(CASE WHEN t.type='return' THEN t.qty ELSE 0 END) as oh
        FROM transactions t JOIN cylinder_types ct ON ct.id = t.cylinder_type
        WHERE ct.item_type = 'cylinder' GROUP BY t.customer_id, t.cylinder_type HAVING oh > 0
      )
    `).get();
    const recentTx = db.prepare("SELECT * FROM transactions ORDER BY date DESC, created DESC LIMIT 10").all();
    const lastSync = db.prepare("SELECT * FROM optimoroute_sync_log ORDER BY created DESC LIMIT 1").get();
    const orImported = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE source = 'optimoroute'").get().c;

    // Order stats
    const ordersOpen = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'open'").get().c;
    const ordersConfirmed = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'confirmed'").get().c;
    const ordersCompleted = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'completed'").get().c;
    const ordersTotal = db.prepare("SELECT COUNT(*) as c FROM orders").get().c;
    const recentOrders = db.prepare("SELECT o.*, c.name as customer_name_lookup FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ORDER BY o.order_date DESC, o.created DESC LIMIT 10").all();

    res.json({
      total_customers: totalCustomers, total_on_hand: onHandResult.total,
      total_deliveries: totalDeliveries, total_returns: totalReturns, total_sales: totalSales,
      recent_transactions: recentTx,
      optimoroute: { last_sync: lastSync || null, total_imported: orImported },
      orders: { open: ordersOpen, confirmed: ordersConfirmed, completed: ordersCompleted, total: ordersTotal, recent: recentOrders },
    });
  });

  // ============================================================
  // SETTINGS
  // ============================================================
  router.get("/settings", (req, res) => {
    const rows = db.prepare("SELECT * FROM settings").all();
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    res.json(obj);
  });

  router.put("/settings", (req, res) => {
    const entries = Object.entries(req.body);
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    db.transaction(() => { for (const [key, value] of entries) stmt.run(key, String(value)); })();
    res.json({ success: true });
  });

  // ============================================================
  // OPTIMOROUTE INTEGRATION
  // ============================================================

  router.post("/optimoroute/test", async (req, res) => {
    try {
      const apiKey = getApiKey(db);
      if (!apiKey) return res.status(400).json({ error: "OptimoRoute API key not configured" });
      const client = new OptimoRouteClient(apiKey);
      res.json(await client.testConnection());
    } catch (err) { res.json({ success: false, message: err.message }); }
  });

  router.get("/optimoroute/routes", async (req, res) => {
    try {
      const apiKey = getApiKey(db);
      if (!apiKey) return res.status(400).json({ error: "OptimoRoute API key not configured" });
      const client = new OptimoRouteClient(apiKey);
      res.json(await client.getRoutes(req.query.date || new Date().toISOString().split("T")[0]));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get("/optimoroute/search", async (req, res) => {
    try {
      const apiKey = getApiKey(db);
      if (!apiKey) return res.status(400).json({ error: "OptimoRoute API key not configured" });
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: "from and to dates required" });
      const client = new OptimoRouteClient(apiKey);
      res.json(await client.searchOrders(from, to));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Debug: raw API response preview ──────────────────────────
  router.post("/optimoroute/debug", async (req, res) => {
    try {
      const apiKey = getApiKey(db);
      if (!apiKey) return res.status(400).json({ error: "OptimoRoute API key not configured" });
      const client = new OptimoRouteClient(apiKey);
      const { dateFrom, dateTo } = req.body;

      // Try search_orders (fixed params)
      let searchResult = null;
      try { searchResult = await client.searchOrders(dateFrom, dateTo); } catch (e) { searchResult = { error: e.message }; }

      // Try get_routes for first date
      let routesResult = null;
      try { routesResult = await client.getRoutes(dateFrom); } catch (e) { routesResult = { error: e.message }; }

      // Collect stop IDs from routes (since orderNo is empty)
      let completionResult = null;
      let orderDataResult = null;
      if (routesResult?.routes?.length > 0) {
        const stopIds = [];
        for (const route of routesResult.routes) {
          for (const stop of (route.stops || [])) {
            if (stop.id) stopIds.push(stop.id);
          }
        }
        if (stopIds.length > 0) {
          const sample = stopIds.slice(0, 5);
          // Use id field instead of orderNo
          try { completionResult = await client.getCompletionDetailsById(sample); } catch (e) { completionResult = { error: e.message }; }
          try { orderDataResult = await client.getOrdersById(sample); } catch (e) { orderDataResult = { error: e.message }; }
        }
      }

      res.json({
        search_orders: searchResult,
        get_routes: routesResult,
        get_completion_details_sample: completionResult,
        get_orders_sample: orderDataResult,
        _hint: "Orders use 'id' field, not 'orderNo'"
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────
  // MAIN SYNC: search_orders → get_completion_details (by id for POD)
  // ─────────────────────────────────────────────────────────────────
  router.post("/optimoroute/sync", async (req, res) => {
    try {
      const apiKey = getApiKey(db);
      if (!apiKey) return res.status(400).json({ error: "OptimoRoute API key not configured" });
      const client = new OptimoRouteClient(apiKey);

      const { dateFrom, dateTo } = req.body;
      if (!dateFrom || !dateTo) return res.status(400).json({ error: "dateFrom and dateTo required" });

      // Step 1: search_orders (returns order data + customFields + schedule)
      let allOrders = [];
      try {
        const searchResult = await client.searchOrders(dateFrom, dateTo);
        allOrders = searchResult.orders || [];
      } catch (err) {
        return res.status(500).json({ error: `search_orders failed: ${err.message}` });
      }

      console.log(`[OR Sync] search_orders returned ${allOrders.length} orders`);

      if (allOrders.length === 0) {
        return res.json({
          success: true,
          summary: { dateRange: `${dateFrom} to ${dateTo}`, totalFetched: 0, imported: 0, skipped: 0 },
          importedOrders: [], skippedOrders: [],
        });
      }

      // Step 2: get_completion_details by id (for POD form data)
      const allIds = allOrders.map(o => o.id).filter(Boolean);
      const completionMap = {};
      for (let i = 0; i < allIds.length; i += 50) {
        try {
          const compResult = await client.getCompletionDetailsById(allIds.slice(i, i + 50));
          if (compResult.orders) {
            for (const o of compResult.orders) {
              if (o.id) completionMap[o.id] = o;
            }
          }
        } catch (e) { console.error("[OR Sync] completion batch:", e.message); }
      }

      // Step 3: Load CylinderTrack reference data
      const customers = db.prepare("SELECT * FROM customers").all();
      const cylinderTypes = db.prepare("SELECT * FROM cylinder_types").all();

      // Step 4: Process each order
      let imported = 0;
      let skipped = 0;
      const importedOrders = [];
      const skippedOrders = [];

      const insertTx = db.prepare(
        "INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order) VALUES (?, ?, ?, ?, ?, ?, ?, 'optimoroute', ?)"
      );
      const upsertOR = db.prepare(`
        INSERT OR REPLACE INTO optimoroute_orders
        (order_no, customer_id, status, order_type, order_date, location_name, location_address, notes, custom_fields, completion_status, completed_at, driver_name, raw_json, imported, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      const doImport = db.transaction(() => {
        for (const order of allOrders) {
          const orderId = order.id;
          if (!orderId) continue;

          const orderData = order.data || {};
          const customFields = orderData.customFields || {};
          const location = orderData.location || {};
          const schedule = order.scheduleInformation || {};
          const driverName = schedule.driverName || "";
          const orderDate = orderData.date || dateFrom;
          const locAddress = location.address || "";
          const locName = location.locationName || "";
          const orderNotes = orderData.notes || "";

          // Completion: check status and get POD
          const completion = completionMap[orderId] || {};
          const compData = completion.data || {};
          const completionStatus = compData.status || "";

          if (completionStatus !== "success") {
            skipped++;
            skippedOrders.push({ orderNo: orderId, reason: `Status: ${completionStatus || "not completed"}`, address: locAddress, customerName: customFields.customer_name || "" });
            continue;
          }

          // Skip if already imported
          const existing = db.prepare(
            "SELECT id FROM transactions WHERE optimoroute_order = ? AND source = 'optimoroute'"
          ).get(orderId);
          if (existing) {
            skipped++;
            skippedOrders.push({ orderNo: orderId, reason: "Already imported" });
            continue;
          }

          // POD: form.number = delivered, form.number_2 = returned
          const form = compData.form || {};
          const podDelivered = parseQty(form.number ?? 0);
          const podReturned = parseQty(form.number_2 ?? 0);

          // Cylinder type from customFields.order (e.g. "1x45", "2x15")
          const orderFieldValue = (customFields.order || "").toString().trim();
          const textToSearch = orderFieldValue || locName;
          const parsed = parseCylinderFromText(textToSearch, cylinderTypes);
          let cylinderType = parsed.cylinderType;

          // Match customer by address
          const customer = matchCustomerByAddress(locAddress, customers);

          // Save to optimoroute_orders table
          const wasImported = customer && cylinderType && (podDelivered > 0 || podReturned > 0);
          upsertOR.run(
            orderId, customer?.id || null, "fetched", "task", orderDate,
            locName, locAddress, orderNotes,
            JSON.stringify(customFields), completionStatus,
            compData.endTime?.localTime || "", driverName,
            JSON.stringify({ order, completion }),
            wasImported ? 1 : 0
          );

          if (!customer) {
            skipped++;
            skippedOrders.push({
              orderNo: orderId, reason: "No matching customer (address)",
              locationAddress: locAddress, customerName: customFields.customer_name || "",
              orderField: orderFieldValue, podDelivered, podReturned,
            });
            continue;
          }

          if (!cylinderType) {
            skipped++;
            skippedOrders.push({
              orderNo: orderId, reason: `No matching cylinder type for "${orderFieldValue}"`,
              customer: customer.name, locationAddress: locAddress,
              orderField: orderFieldValue, podDelivered, podReturned,
            });
            continue;
          }

          if (podDelivered === 0 && podReturned === 0) {
            skipped++;
            skippedOrders.push({
              orderNo: orderId, reason: "Both Delivered and Returned are 0",
              customer: customer.name, cylinderType: cylinderType.label,
            });
            continue;
          }

          const baseNote = `OR: ${orderId.substring(0, 8)}` +
            (driverName ? ` | ${driverName}` : "") +
            (customFields.customer_name ? ` | ${customFields.customer_name}` : "") +
            (orderFieldValue ? ` | ${orderFieldValue}` : "");

          if (podDelivered > 0) {
            insertTx.run(uid(), customer.id, cylinderType.id, "delivery", podDelivered, orderDate, baseNote + ` | Del:${podDelivered}`, orderId);
            imported++;
            importedOrders.push({ orderNo: orderId, customer: customer.name, type: "delivery", cylinderType: cylinderType.label, qty: podDelivered, date: orderDate, customerName: customFields.customer_name || "" });
          }

          if (podReturned > 0) {
            insertTx.run(uid(), customer.id, cylinderType.id, "return", podReturned, orderDate, baseNote + ` | Ret:${podReturned}`, orderId + "_ret");
            imported++;
            importedOrders.push({ orderNo: orderId, customer: customer.name, type: "return", cylinderType: cylinderType.label, qty: podReturned, date: orderDate, customerName: customFields.customer_name || "" });
          }
        }
      });

      doImport();

      // ── Also update CylinderTrack orders that have been completed in OptimoRoute ──
      let ordersCompleted = 0;
      const ctOrders = db.prepare("SELECT * FROM orders WHERE optimoroute_id != '' AND status != 'completed'").all();
      for (const ctOrder of ctOrders) {
        const completion = completionMap[ctOrder.optimoroute_id];
        if (completion?.data?.status === "success") {
          db.prepare("UPDATE orders SET status = 'completed', updated = datetime('now') WHERE id = ?").run(ctOrder.id);
          ordersCompleted++;
        }
      }

      db.prepare(
        "INSERT INTO optimoroute_sync_log (sync_date, orders_fetched, orders_imported, orders_skipped, errors) VALUES (?, ?, ?, ?, ?)"
      ).run(`${dateFrom} to ${dateTo}`, allOrders.length, imported, skipped, ordersCompleted > 0 ? `${ordersCompleted} orders marked completed` : "");

      res.json({
        success: true,
        summary: { dateRange: `${dateFrom} to ${dateTo}`, totalFetched: allOrders.length, imported, skipped, ordersCompleted },
        importedOrders, skippedOrders,
      });
    } catch (err) {
      console.error("[OR Sync] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });


  // Get unmatched orders
  router.get("/optimoroute/unmatched", (req, res) => {
    res.json(db.prepare(
      "SELECT * FROM optimoroute_orders WHERE imported = 0 ORDER BY order_date DESC, created DESC"
    ).all());
  });

  // Manually import an unmatched order
  router.post("/optimoroute/import-manual", (req, res) => {
    const { order_no, customer_id, cylinder_type, type, qty, date } = req.body;
    if (!order_no || !customer_id || !cylinder_type || !type || !qty || !date) {
      return res.status(400).json({ error: "All fields required" });
    }
    const existing = db.prepare(
      "SELECT id FROM transactions WHERE optimoroute_order = ? AND source = 'optimoroute'"
    ).get(order_no);
    if (existing) return res.status(400).json({ error: "Order already imported" });

    const orOrder = db.prepare("SELECT * FROM optimoroute_orders WHERE order_no = ?").get(order_no);
    const txId = uid();
    const notes = `OR: ${order_no} (manual)` + (orOrder?.driver_name ? ` | ${orOrder.driver_name}` : "");
    db.prepare(
      "INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order) VALUES (?, ?, ?, ?, ?, ?, ?, 'optimoroute', ?)"
    ).run(txId, customer_id, cylinder_type, type, parseInt(qty), date, notes, order_no);
    db.prepare("UPDATE optimoroute_orders SET imported = 1, customer_id = ? WHERE order_no = ?").run(customer_id, order_no);
    res.json({ success: true, transactionId: txId });
  });

  // Sync history
  router.get("/optimoroute/sync-log", (req, res) => {
    res.json(db.prepare("SELECT * FROM optimoroute_sync_log ORDER BY created DESC LIMIT 20").all());
  });

  // ============================================================
  // BACKUP / EXPORT
  // ============================================================
  router.get("/backup", (req, res) => {
    const backup = {
      exported_at: new Date().toISOString(), version: "2.1",
      data: {
        customers: db.prepare("SELECT * FROM customers ORDER BY name").all(),
        cylinder_types: db.prepare("SELECT * FROM cylinder_types ORDER BY sort_order, label").all(),
        transactions: db.prepare("SELECT * FROM transactions ORDER BY date DESC, created DESC").all(),
        customer_pricing: db.prepare("SELECT * FROM customer_pricing").all(),
        settings: db.prepare("SELECT * FROM settings").all(),
      }
    };
    res.setHeader("Content-Disposition", `attachment; filename=cylindertrack-backup-${new Date().toISOString().split("T")[0]}.json`);
    res.json(backup);
  });

  router.post("/restore", (req, res) => {
    const { data } = req.body;
    if (!data?.customers || !data?.cylinder_types || !data?.transactions) {
      return res.status(400).json({ error: "Invalid backup file" });
    }
    db.transaction(() => {
      db.prepare("DELETE FROM customer_pricing").run();
      db.prepare("DELETE FROM transactions").run();
      db.prepare("DELETE FROM customers").run();
      db.prepare("DELETE FROM cylinder_types").run();
      const ctStmt = db.prepare("INSERT INTO cylinder_types (id, label, default_price, gas_group, item_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
      for (const ct of data.cylinder_types) ctStmt.run(ct.id, ct.label, ct.default_price || 0, ct.gas_group || "", ct.item_type || "cylinder", ct.sort_order || 0);
      const cStmt = db.prepare("INSERT INTO customers (id, name, contact, phone, email, address, notes, onedrive_link, payment_ref, cc_encrypted, account_customer, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const c of data.customers) cStmt.run(c.id, c.name, c.contact || "", c.phone || "", c.email || "", c.address || "", c.notes || "", c.onedrive_link || "", c.payment_ref || "", c.cc_encrypted || "", c.account_customer || 0, c.created || new Date().toISOString());
      const tStmt = db.prepare("INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const t of data.transactions) tStmt.run(t.id, t.customer_id, t.cylinder_type, t.type, t.qty, t.date, t.notes || "", t.source || "manual", t.optimoroute_order || "", t.created || new Date().toISOString());
      if (data.customer_pricing) {
        const pStmt = db.prepare("INSERT INTO customer_pricing (customer_id, cylinder_type, price, fixed_price, fixed_from, fixed_to) VALUES (?, ?, ?, ?, ?, ?)");
        for (const p of data.customer_pricing) pStmt.run(p.customer_id, p.cylinder_type, p.price, p.fixed_price || 0, p.fixed_from || "", p.fixed_to || "");
      }
      if (data.settings) {
        const sStmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
        for (const s of data.settings) sStmt.run(s.key, s.value);
      }
    })();
    res.json({ success: true });
  });

  return router;
};

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════

function getApiKey(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'optimoroute_api_key'").get();
  return row?.value || null;
}

function getDateRange(from, to) {
  const dates = [];
  const d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (d <= end) {
    dates.push(d.toISOString().split("T")[0]);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function parseQty(val) {
  if (val === null || val === undefined || val === "") return 0;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

/**
 * Parse cylinder type from text like "2x45", "1x9", "3x45 Paid", "45kg", etc.
 * Matches the extracted number against cylinder type labels.
 *
 * Examples:
 *   "2x45"  → finds "45" in "45kg LPG" → { cylinderType, qty: 2 }
 *   "1x9"   → finds "9" in "9kg LPG"   → { cylinderType, qty: 1 }
 *   "Bond, Maria 470 Peppertree Dr, Jimboomba 2x45 Paid" → finds "45"
 *
 * Strategy:
 *   1. Look for NxN pattern (e.g. 2x45, 1x9, 3x45)
 *   2. Extract the size number (after the x)
 *   3. Match that number against cylinder type labels
 *   4. Fallback: look for any cylinder type label directly in the text
 */
function parseCylinderFromText(text, cylinderTypes) {
  if (!text || cylinderTypes.length === 0) return { cylinderType: null, qty: 0 };

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Pattern 1: NxSIZE with decimals (e.g. "2x45", "1x8.5", "3x45")
  const nxMatch = lower.match(/^(\d+)\s*x\s*([\d.]+)/);
  if (nxMatch) {
    const qty = parseInt(nxMatch[1]);
    const size = nxMatch[2]; // e.g. "45", "8.5"

    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      const sizeRegex = new RegExp(`\\b${size.replace('.', '\\.')}\\b|^${size.replace('.', '\\.')}kg|^${size.replace('.', '\\.')}\\s*kg`);
      if (sizeRegex.test(label) || label === size || label.startsWith(size + "kg") || label.startsWith(size + " kg") || label.startsWith(size + " ")) {
        return { cylinderType: ct, qty };
      }
    }
    // Looser: label contains the size
    for (const ct of cylinderTypes) {
      if (ct.label.toLowerCase().includes(size)) return { cylinderType: ct, qty };
    }
  }

  // Pattern 2: "N WORD" or "N WORD extra" (e.g. "2 Cage", "2 Cage acc", "1 cage")
  const nWordMatch = lower.match(/^(\d+)\s+([a-z][a-z\s]*)/);
  if (nWordMatch) {
    const qty = parseInt(nWordMatch[1]);
    const word = nWordMatch[2].trim();
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      if (label.includes(word) || word.includes(label)) {
        return { cylinderType: ct, qty };
      }
    }
  }

  // Pattern 3: Just a size like "45kg" or "8.5kg"
  const kgMatch = lower.match(/([\d.]+)\s*kg/);
  if (kgMatch) {
    const size = kgMatch[1];
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      if (label.includes(size + "kg") || label.includes(size + " kg") || label === size) {
        return { cylinderType: ct, qty: 1 };
      }
    }
  }

  // Pattern 4: Direct label match (e.g. "Cage", "Oxygen")
  for (const ct of cylinderTypes) {
    if (lower.includes(ct.label.toLowerCase()) || ct.label.toLowerCase().includes(lower)) {
      return { cylinderType: ct, qty: 1 };
    }
  }

  return { cylinderType: null, qty: 0 };
}

/**
 * Fuzzy-match an OptimoRoute address to a CylinderTrack customer.
 *
 * The OptimoRoute address field looks like:
 *   "Bond, Maria 470 Peppertree Dr, Jimboomba 2x45 Paid"
 *
 * The CylinderTrack customer address is something like:
 *   "470 Peppertree Dr, Jimboomba"
 *
 * Strategy:
 *   1. Normalise both addresses (lowercase, strip extra spaces)
 *   2. Extract the "street core" from the CT address (e.g. "470 peppertree dr")
 *   3. Check if the OR address contains that street core
 *   4. Score by how specific the match is (prefer longer CT addresses)
 */
function matchCustomerByAddress(orAddress, customers) {
  if (!orAddress) return null;

  const orNorm = normaliseAddress(orAddress);
  let bestMatch = null;
  let bestScore = 0;

  for (const cust of customers) {
    if (!cust.address) continue;
    const ctNorm = normaliseAddress(cust.address);
    if (!ctNorm) continue;

    // Extract the street core: "470 peppertree dr" from "470 Peppertree Dr, Jimboomba QLD 4280"
    const ctStreetCore = extractStreetCore(ctNorm);

    if (!ctStreetCore || ctStreetCore.length < 5) continue;

    // Check if the OptimoRoute address contains the CT street core
    if (orNorm.includes(ctStreetCore)) {
      // Score by length of match — longer = more specific = better
      const score = ctStreetCore.length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = cust;
      }
    }
  }

  return bestMatch;
}

function normaliseAddress(addr) {
  return addr
    .toLowerCase()
    .replace(/[,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract street number + street name from a normalised address.
 * e.g. "470 peppertree dr jimboomba qld 4280" → "470 peppertree dr"
 *
 * Approach: find the first number, then grab up to the street type
 * (st, rd, dr, ave, cr, cres, ct, pl, tce, trc, ln, way, blvd, hwy, etc.)
 */
function extractStreetCore(norm) {
  // Match: <number> <words> <street-type>
  const streetTypes = /\b(st|street|rd|road|dr|drive|ave|avenue|cr|cres|crescent|ct|court|pl|place|tce|terrace|trc|trace|ln|lane|way|blvd|boulevard|hwy|highway|cl|close|pde|parade|cct|circuit|loop|grv|grove|pk|parkway)\b/;
  const match = norm.match(/(\d+[a-z]?\s+.+)/);
  if (!match) return norm;

  const fromNumber = match[1];
  const typeMatch = fromNumber.match(streetTypes);
  if (typeMatch) {
    // Return everything from the number to the end of the street type word
    return fromNumber.substring(0, typeMatch.index + typeMatch[0].length).trim();
  }

  // No street type found — just use first 3-4 words from the number
  const words = fromNumber.split(" ");
  return words.slice(0, Math.min(4, words.length)).join(" ");
}

/**
 * Get the effective price for a customer+cylinder type at a given date.
 * Looks up price_history for the most recent entry on or before the date.
 * Falls back to current customer_pricing, then to the cylinder type default.
 */
function getPriceForDate(db, customerId, cylinderTypeId, date, defaultPrice) {
  // Check if customer has a fixed price contract active for this date
  const fixedEntry = db.prepare(
    "SELECT price, fixed_price, fixed_from, fixed_to FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?"
  ).get(customerId, cylinderTypeId);
  if (fixedEntry?.fixed_price && fixedEntry.fixed_from && fixedEntry.fixed_to && date >= fixedEntry.fixed_from && date <= fixedEntry.fixed_to) {
    return fixedEntry.price; // Fixed contract price takes priority
  }

  // Check price history — find the latest entry effective on or before this date
  const histEntry = db.prepare(`
    SELECT price FROM price_history
    WHERE customer_id = ? AND cylinder_type = ? AND effective_from <= ?
    ORDER BY effective_from DESC LIMIT 1
  `).get(customerId, cylinderTypeId, date);
  if (histEntry) return histEntry.price;

  // Fallback to current pricing table
  if (fixedEntry) return fixedEntry.price;

  return defaultPrice || 0;
}
