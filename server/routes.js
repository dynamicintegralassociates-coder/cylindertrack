const express = require("express");
const crypto = require("crypto");
const { OptimoRouteClient } = require("./optimoroute");

const uid = () => crypto.randomBytes(6).toString("hex");

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
    res.json(db.prepare("SELECT * FROM customers ORDER BY name").all());
  });

  router.post("/customers", (req, res) => {
    const { name, contact, phone, email, address, notes, onedrive_link } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    const id = uid();
    db.prepare(
      "INSERT INTO customers (id, name, contact, phone, email, address, notes, onedrive_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, name.trim(), contact || "", phone || "", email || "", address || "", notes || "", onedrive_link || "");
    res.json({ id, name: name.trim() });
  });

  router.put("/customers/:id", (req, res) => {
    const { name, contact, phone, email, address, notes, onedrive_link } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    const result = db.prepare(
      "UPDATE customers SET name=?, contact=?, phone=?, email=?, address=?, notes=?, onedrive_link=?, updated=datetime('now') WHERE id=?"
    ).run(name.trim(), contact || "", phone || "", email || "", address || "", notes || "", onedrive_link || "", req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Customer not found" });
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

  // ============================================================
  // PRICING
  // ============================================================
  router.get("/pricing", (req, res) => {
    res.json(db.prepare("SELECT * FROM customer_pricing").all());
  });

  router.put("/pricing/:custId/:typeId", (req, res) => {
    const { price } = req.body;
    const today = new Date().toISOString().split("T")[0];
    db.prepare("INSERT OR REPLACE INTO customer_pricing (customer_id, cylinder_type, price) VALUES (?, ?, ?)").run(req.params.custId, req.params.typeId, price);
    // Log price history
    db.prepare("INSERT INTO price_history (customer_id, cylinder_type, price, effective_from) VALUES (?, ?, ?, ?)").run(req.params.custId, req.params.typeId, price, today);
    res.json({ success: true });
  });

  router.delete("/pricing/:custId/:typeId", (req, res) => {
    db.prepare("DELETE FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?").run(req.params.custId, req.params.typeId);
    res.json({ success: true });
  });

  // Get price history for a customer/type
  router.get("/pricing/history/:custId/:typeId", (req, res) => {
    res.json(db.prepare("SELECT * FROM price_history WHERE customer_id = ? AND cylinder_type = ? ORDER BY effective_from DESC").all(req.params.custId, req.params.typeId));
  });

  router.post("/pricing/bulk", (req, res) => {
    const { cylinder_type, price, customer_ids, mode, percentage } = req.body;
    if (!cylinder_type || !customer_ids?.length) return res.status(400).json({ error: "Missing fields" });
    const today = new Date().toISOString().split("T")[0];
    const stmt = db.prepare("INSERT OR REPLACE INTO customer_pricing (customer_id, cylinder_type, price) VALUES (?, ?, ?)");
    const histStmt = db.prepare("INSERT INTO price_history (customer_id, cylinder_type, price, effective_from) VALUES (?, ?, ?, ?)");
    const cylinderTypeData = db.prepare("SELECT default_price FROM cylinder_types WHERE id = ?").get(cylinder_type);
    const apply = db.transaction(() => {
      for (const custId of customer_ids) {
        let newPrice;
        if (mode === "percentage" && percentage) {
          const existing = db.prepare("SELECT price FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?").get(custId, cylinder_type);
          const basePrice = existing ? existing.price : (cylinderTypeData?.default_price || 0);
          newPrice = Math.round(basePrice * (1 + percentage / 100) * 100) / 100;
        } else {
          newPrice = price;
        }
        stmt.run(custId, cylinder_type, newPrice);
        histStmt.run(custId, cylinder_type, newPrice, today);
      }
    });
    apply();
    res.json({ success: true, updated: customer_ids.length });
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
    res.json({
      total_customers: totalCustomers, total_on_hand: onHandResult.total,
      total_deliveries: totalDeliveries, total_returns: totalReturns, total_sales: totalSales,
      recent_transactions: recentTx,
      optimoroute: { last_sync: lastSync || null, total_imported: orImported },
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

      db.prepare(
        "INSERT INTO optimoroute_sync_log (sync_date, orders_fetched, orders_imported, orders_skipped, errors) VALUES (?, ?, ?, ?, ?)"
      ).run(`${dateFrom} to ${dateTo}`, allOrders.length, imported, skipped, "");

      res.json({
        success: true,
        summary: { dateRange: `${dateFrom} to ${dateTo}`, totalFetched: allOrders.length, imported, skipped },
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
      const cStmt = db.prepare("INSERT INTO customers (id, name, contact, phone, email, address, notes, onedrive_link, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const c of data.customers) cStmt.run(c.id, c.name, c.contact || "", c.phone || "", c.email || "", c.address || "", c.notes || "", c.onedrive_link || "", c.created || new Date().toISOString());
      const tStmt = db.prepare("INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const t of data.transactions) tStmt.run(t.id, t.customer_id, t.cylinder_type, t.type, t.qty, t.date, t.notes || "", t.source || "manual", t.optimoroute_order || "", t.created || new Date().toISOString());
      if (data.customer_pricing) {
        const pStmt = db.prepare("INSERT INTO customer_pricing (customer_id, cylinder_type, price) VALUES (?, ?, ?)");
        for (const p of data.customer_pricing) pStmt.run(p.customer_id, p.cylinder_type, p.price);
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

  const lower = text.toLowerCase();

  // Pattern 1: NxSIZE (e.g. "2x45", "1x9", "3x45")
  const nxMatch = lower.match(/(\d+)\s*x\s*(\d+)/);
  if (nxMatch) {
    const qty = parseInt(nxMatch[1]);
    const size = nxMatch[2]; // e.g. "45", "9"

    // Find a cylinder type whose label contains this size number
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      // Match "45" in "45kg lpg" — ensure it's a word boundary, not matching "245"
      const sizeRegex = new RegExp(`\\b${size}\\b|^${size}kg|^${size}\\s*kg`);
      if (sizeRegex.test(label) || label.startsWith(size + "kg") || label.startsWith(size + " kg")) {
        return { cylinderType: ct, qty };
      }
    }

    // Looser match: just check if the label contains the number
    for (const ct of cylinderTypes) {
      if (ct.label.includes(size)) {
        return { cylinderType: ct, qty };
      }
    }
  }

  // Pattern 2: Just a size like "45kg" or "9kg" in the text
  const kgMatch = lower.match(/(\d+)\s*kg/);
  if (kgMatch) {
    const size = kgMatch[1];
    for (const ct of cylinderTypes) {
      const label = ct.label.toLowerCase();
      if (label.includes(size + "kg") || label.includes(size + " kg")) {
        return { cylinderType: ct, qty: 1 };
      }
    }
  }

  // Pattern 3: Direct label match (e.g. notes say "Oxygen" and label is "Oxygen")
  for (const ct of cylinderTypes) {
    if (lower.includes(ct.label.toLowerCase())) {
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
  // Check price history — find the latest entry effective on or before this date
  const histEntry = db.prepare(`
    SELECT price FROM price_history
    WHERE customer_id = ? AND cylinder_type = ? AND effective_from <= ?
    ORDER BY effective_from DESC LIMIT 1
  `).get(customerId, cylinderTypeId, date);
  if (histEntry) return histEntry.price;

  // Fallback to current pricing table
  const currentPrice = db.prepare(
    "SELECT price FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?"
  ).get(customerId, cylinderTypeId);
  if (currentPrice) return currentPrice.price;

  return defaultPrice || 0;
}
