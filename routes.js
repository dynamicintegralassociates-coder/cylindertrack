const express = require("express");
const nodeCrypto = require("crypto");
const { OptimoRouteClient } = require("./optimoroute");
const { encrypt, decrypt, maskCard } = require("./crypto");
const emailModule = require("./email");
const { parseCylinderFromText } = require("./parser"); // 3.0.18: extracted for unit testing
const { logAudit, logCreate, logUpdate, logDelete, snapshot } = require("./audit");
const { exportFullBackup, restoreFullBackup, validateBackup, BACKUP_TABLES } = require("./backup");

const uid = () => nodeCrypto.randomBytes(6).toString("hex");

// Atomically generate the next number from a sequence stored in settings.
// Returns formatted string like "CUST-00001". Increments next counter.
function nextSequenceNumber(db, kind /* "customer" | "order" */) {
  const prefixKey = `${kind}_seq_prefix`;
  const paddingKey = `${kind}_seq_padding`;
  const nextKey = `${kind}_seq_next`;
  return db.transaction(() => {
    const get = (k, fallback) => {
      const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k);
      return r ? r.value : fallback;
    };
    const prefix = get(prefixKey, kind === "customer" ? "CUST-" : "ORD-");
    const padding = parseInt(get(paddingKey, "5"), 10) || 5;
    const next = parseInt(get(nextKey, "1"), 10) || 1;
    const formatted = prefix + String(next).padStart(padding, "0");
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(nextKey, String(next + 1));
    return formatted;
  })();
}

// Advance a YYYY-MM-DD date by the given rental frequency.
// Returns new YYYY-MM-DD string.
function addFrequency(dateStr, frequency) {
  const d = new Date(dateStr + "T00:00:00Z");
  switch ((frequency || "").toLowerCase()) {
    case "daily":     d.setUTCDate(d.getUTCDate() + 1); break;
    case "weekly":    d.setUTCDate(d.getUTCDate() + 7); break;
    case "monthly":   d.setUTCMonth(d.getUTCMonth() + 1); break;
    case "quarterly": d.setUTCMonth(d.getUTCMonth() + 3); break;
    case "annually":  d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default:          d.setUTCMonth(d.getUTCMonth() + 1); // safe fallback
  }
  return d.toISOString().split("T")[0];
}

// Read a setting value with a default fallback
function getSetting(db, key, defaultValue) {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row?.value !== undefined ? row.value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// Current on-hand count of a specific rental cylinder type for a customer.
function getOnHand(db, customerId, cylinderTypeId) {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN type='delivery' THEN qty ELSE 0 END) -
      SUM(CASE WHEN type='return'   THEN qty ELSE 0 END) as on_hand
    FROM transactions
    WHERE customer_id = ? AND cylinder_type = ?
  `).get(customerId, cylinderTypeId);
  return row?.on_hand || 0;
}

// Parse a customer.duration string into integer minutes.
// Accepts "15", "15 min", "15 minutes", "1h", etc. Falls back to 5.
function parseDurationMinutes(str) {
  if (str === null || str === undefined) return 5;
  const s = String(str).trim().toLowerCase();
  if (!s) return 5;
  // Hours
  const hMatch = s.match(/(\d+(?:\.\d+)?)\s*h/);
  if (hMatch) return Math.max(1, Math.round(parseFloat(hMatch[1]) * 60));
  // Plain integer or "15 min"
  const nMatch = s.match(/(\d+(?:\.\d+)?)/);
  if (nMatch) return Math.max(1, Math.round(parseFloat(nMatch[1])));
  return 5;
}

// Validate an Australian Business Number using the ABR checksum algorithm.
// Returns { valid, normalized, reason }.
//   - normalized strips spaces/punctuation
//   - valid is true only if the digits pass the official checksum
//   - blank input is treated as valid (ABN is optional)
function validateABN(input) {
  if (input === null || input === undefined || String(input).trim() === "") {
    return { valid: true, normalized: "", reason: "" };
  }
  const digits = String(input).replace(/\D/g, "");
  if (digits.length !== 11) {
    return { valid: false, normalized: digits, reason: "ABN must be 11 digits" };
  }
  // Official ABR algorithm: subtract 1 from the first digit, multiply each by its weight, sum, mod 89 must be 0.
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const arr = digits.split("").map(Number);
  arr[0] = arr[0] - 1;
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += arr[i] * weights[i];
  if (sum % 89 !== 0) {
    return { valid: false, normalized: digits, reason: "ABN checksum failed (likely a typo)" };
  }
  return { valid: true, normalized: digits, reason: "" };
}

// Recalculate a customer's stored balance from invoices + credits.
// balance = SUM(invoices.total - invoices.amount_paid) where status != 'void'
// credit_balance = SUM(credit_notes.remaining_amount) where status = 'approved'
function recalculateCustomerBalance(db, customerId) {
  // Round 3: 'pending' invoices (created at order time but not yet delivered) are NOT
  // included in the customer balance — only open/paid invoices count.
  const invRow = db.prepare(`
    SELECT COALESCE(SUM(total - amount_paid), 0) as owed
    FROM invoices
    WHERE customer_id = ? AND status NOT IN ('void', 'pending')
  `).get(customerId);
  const crRow = db.prepare(`
    SELECT COALESCE(SUM(remaining_amount), 0) as credit
    FROM credit_notes
    WHERE customer_id = ? AND status = 'approved'
  `).get(customerId);
  const balance = Math.round((invRow.owed || 0) * 100) / 100;
  const creditBalance = Math.round((crRow.credit || 0) * 100) / 100;
  db.prepare("UPDATE customers SET balance = ?, credit_balance = ? WHERE id = ?")
    .run(balance, creditBalance, customerId);
  return { balance, credit_balance: creditBalance };
}

// Automatically consume a customer's approved credit notes against a specific invoice.
// FIFO (oldest credit first). Returns total amount applied.
function autoApplyCreditsToInvoice(db, customerId, invoiceId) {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
  if (!invoice || invoice.status === "void") return 0;
  let owed = invoice.total - invoice.amount_paid;
  if (owed <= 0) return 0;

  const credits = db.prepare(`
    SELECT * FROM credit_notes
    WHERE customer_id = ? AND status = 'approved' AND remaining_amount > 0
    ORDER BY created ASC
  `).all(customerId);

  let totalApplied = 0;
  const today = new Date().toISOString().split("T")[0];
  const paymentStmt = db.prepare(
    "INSERT INTO payments (id, customer_id, invoice_id, credit_id, amount, method, reference, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  for (const cr of credits) {
    if (owed <= 0) break;
    const applyAmt = Math.min(cr.remaining_amount, owed);
    if (applyAmt <= 0) continue;

    paymentStmt.run(
      nodeCrypto.randomBytes(6).toString("hex"),
      customerId, invoiceId, cr.id, applyAmt, "credit", cr.credit_number, today,
      `Credit applied from ${cr.credit_number}`
    );
    const newRemaining = Math.round((cr.remaining_amount - applyAmt) * 100) / 100;
    const newStatus = newRemaining <= 0 ? "applied" : cr.status;
    db.prepare("UPDATE credit_notes SET remaining_amount = ?, status = ? WHERE id = ?")
      .run(newRemaining, newStatus, cr.id);

    owed -= applyAmt;
    totalApplied += applyAmt;
  }

  if (totalApplied > 0) {
    db.prepare("UPDATE invoices SET amount_paid = amount_paid + ?, status = CASE WHEN amount_paid + ? >= total THEN 'paid' ELSE status END, updated = datetime('now') WHERE id = ?")
      .run(totalApplied, totalApplied, invoiceId);
  }
  return totalApplied;
}

module.exports = function createRoutes(db) {
  const router = express.Router();

  // ============================================================
  // SEARCH (global)
  // ============================================================
  router.get("/search", (req, res) => {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ customers: [], orders: [], transactions: [] });
    const term = `%${q}%`;
    // 3.0.18: global search now covers customers (name/address/account_number/contact)
    // AND orders (order_number/po_number). Returns customers + orders + supporting txs.
    const customers = db.prepare(
      `SELECT * FROM customers
       WHERE name LIKE ? OR address LIKE ? OR account_number LIKE ? OR contact LIKE ?
       ORDER BY name LIMIT 25`
    ).all(term, term, term, term);
    const orders = db.prepare(
      `SELECT o.id, o.order_number, o.po_number, o.customer_id, o.order_date, o.status,
              c.name as customer_name, c.address as customer_address, c.account_number
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.order_number LIKE ? OR o.po_number LIKE ?
          OR c.name LIKE ? OR c.address LIKE ? OR c.account_number LIKE ?
       ORDER BY o.order_date DESC LIMIT 25`
    ).all(term, term, term, term, term);
    const customerIds = customers.map(c => c.id);
    let transactions = [];
    if (customerIds.length > 0) {
      const placeholders = customerIds.map(() => "?").join(",");
      transactions = db.prepare(
        `SELECT * FROM transactions WHERE customer_id IN (${placeholders}) ORDER BY date DESC LIMIT 50`
      ).all(...customerIds);
    }
    res.json({ customers, orders, transactions });
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
    const {
      name, contact, phone, email, address, notes, onedrive_link, payment_ref, cc_number, account_customer,
      state, accounts_contact, accounts_email, accounts_phone, compliance_number, pressure_test, abn,
      duration, milk_run_days, milk_run_frequency, rental_frequency, customer_type,
      customer_type_start, customer_type_end, rep_name, payment_terms, internal_notes, customer_category,
      chain, alternative_contact_name, alternative_contact_phone, compliance_not_required,
    } = req.body;
    // For non-residential customers, name is required.
    // For residential customers, name OR address is required (can't both be blank).
    const isResidential = (customer_category || "").toLowerCase() === "residential";
    if (!isResidential && !name?.trim()) return res.status(400).json({ error: "Name is required" });
    if (isResidential && !name?.trim() && !address?.trim()) return res.status(400).json({ error: "Either name or address is required" });
    const id = uid();
    const ccEnc = cc_number ? encrypt(cc_number.replace(/\D/g, ""), db) : "";
    const accountNumber = nextSequenceNumber(db, "customer");
    const notesJson = Array.isArray(internal_notes) ? JSON.stringify(internal_notes) : "[]";
    db.prepare(
      `INSERT INTO customers (
        id, name, contact, phone, email, address, notes, onedrive_link, payment_ref, cc_encrypted, account_customer,
        account_number, state, internal_notes, accounts_contact, accounts_email, accounts_phone,
        compliance_number, pressure_test, abn, duration, milk_run_days, milk_run_frequency,
        rental_frequency, customer_type, customer_type_start, customer_type_end, rep_name, payment_terms, customer_category,
        chain, alternative_contact_name, alternative_contact_phone, compliance_not_required
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, (name || "").trim(), contact || "", phone || "", email || "", address || "", notes || "",
      onedrive_link || "", payment_ref || "", ccEnc, account_customer ? 1 : 0,
      accountNumber, state || "", notesJson, accounts_contact || "", accounts_email || "", accounts_phone || "",
      (compliance_number || "").slice(0, 300), (pressure_test || "").slice(0, 10), abn || "",
      duration || "", milk_run_days || "", milk_run_frequency || "",
      rental_frequency || "", customer_type || "", customer_type_start || "", customer_type_end || "",
      rep_name || "", payment_terms || "", customer_category || "",
      chain ? 1 : 0, alternative_contact_name || "", alternative_contact_phone || "", compliance_not_required ? 1 : 0
    );
    const abnCheck = validateABN(abn);
    logCreate(db, req, "customers", id, snapshot(db, "customers", id),
      `Created customer ${accountNumber} — ${(name || "").trim() || address || "(unnamed)"}`);
    res.json({
      id, name: (name || "").trim(), account_number: accountNumber,
      abn_warning: !abnCheck.valid ? abnCheck.reason : null,
    });
  });

  router.put("/customers/:id", (req, res) => {
    const {
      name, contact, phone, email, address, notes, onedrive_link, payment_ref, cc_number, account_customer,
      state, accounts_contact, accounts_email, accounts_phone, compliance_number, pressure_test, abn,
      duration, milk_run_days, milk_run_frequency, rental_frequency, customer_type,
      customer_type_start, customer_type_end, rep_name, payment_terms, internal_notes, new_internal_note, customer_category,
      chain, alternative_contact_name, alternative_contact_phone, compliance_not_required,
    } = req.body;
    const isResidential = (customer_category || "").toLowerCase() === "residential";
    if (!isResidential && !name?.trim()) return res.status(400).json({ error: "Name is required" });
    if (isResidential && !name?.trim() && !address?.trim()) return res.status(400).json({ error: "Either name or address is required" });

    // Capture before-state for audit log
    const beforeRow = snapshot(db, "customers", req.params.id);

    // Internal notes: take existing array, prepend a new note (with timestamp) if provided
    const existing = db.prepare("SELECT internal_notes FROM customers WHERE id = ?").get(req.params.id);
    let notesArr = [];
    try { notesArr = JSON.parse(existing?.internal_notes || "[]"); if (!Array.isArray(notesArr)) notesArr = []; } catch { notesArr = []; }
    if (Array.isArray(internal_notes)) {
      // Caller passed a full replacement list (rare; allowed)
      notesArr = internal_notes;
    }
    if (new_internal_note && new_internal_note.trim()) {
      notesArr.unshift({ date: new Date().toISOString(), text: new_internal_note.trim() });
    }
    const notesJson = JSON.stringify(notesArr);

    const baseCols = `name=?, contact=?, phone=?, email=?, address=?, notes=?, onedrive_link=?, payment_ref=?,
      account_customer=?, state=?, internal_notes=?, accounts_contact=?, accounts_email=?, accounts_phone=?,
      compliance_number=?, pressure_test=?, abn=?, duration=?, milk_run_days=?, milk_run_frequency=?,
      rental_frequency=?, customer_type=?, customer_type_start=?, customer_type_end=?, rep_name=?, payment_terms=?, customer_category=?,
      chain=?, alternative_contact_name=?, alternative_contact_phone=?, compliance_not_required=?,
      updated=datetime('now')`;
    const baseVals = [
      (name || "").trim(), contact || "", phone || "", email || "", address || "", notes || "",
      onedrive_link || "", payment_ref || "", account_customer ? 1 : 0,
      state || "", notesJson, accounts_contact || "", accounts_email || "", accounts_phone || "",
      (compliance_number || "").slice(0, 300), (pressure_test || "").slice(0, 10), abn || "",
      duration || "", milk_run_days || "", milk_run_frequency || "",
      rental_frequency || "", customer_type || "", customer_type_start || "", customer_type_end || "",
      rep_name || "", payment_terms || "", customer_category || "",
      chain ? 1 : 0, alternative_contact_name || "", alternative_contact_phone || "", compliance_not_required ? 1 : 0,
    ];

    if (cc_number && cc_number.replace(/\D/g, "").length >= 4) {
      const ccEnc = encrypt(cc_number.replace(/\D/g, ""), db);
      db.prepare(`UPDATE customers SET ${baseCols}, cc_encrypted=? WHERE id=?`).run(...baseVals, ccEnc, req.params.id);
    } else {
      db.prepare(`UPDATE customers SET ${baseCols} WHERE id=?`).run(...baseVals, req.params.id);
    }
    const abnCheck = validateABN(abn);
    logUpdate(db, req, "customers", req.params.id, beforeRow, snapshot(db, "customers", req.params.id),
      `Updated customer ${beforeRow?.account_number || req.params.id} — ${(name || "").trim() || "(unnamed)"}`);
    res.json({ success: true, abn_warning: !abnCheck.valid ? abnCheck.reason : null });
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
    const before = snapshot(db, "customers", req.params.id);
    db.prepare("UPDATE customers SET cc_encrypted = '' WHERE id = ?").run(req.params.id);
    logAudit(db, req, {
      action: "cc_removed",
      table: "customers",
      record_id: req.params.id,
      summary: `Removed stored credit card for ${before?.name || req.params.id}`,
    });
    res.json({ success: true });
  });

  // Get a customer's orders only (for the customer edit panel)
  router.get("/customers/:id/orders", (req, res) => {
    const rows = db.prepare(
      "SELECT * FROM orders WHERE customer_id = ? ORDER BY order_date DESC, created DESC"
    ).all(req.params.id);
    res.json(rows);
  });

  // Most recent sale price for any sale-type item this customer has bought.
  // Returns { found, unit_price, cylinder_label, order_date, order_number } or { found: false }.
  router.get("/customers/:id/last-sale-price", (req, res) => {
    const row = db.prepare(`
      SELECT o.order_date, ol.unit_price, o.order_number, ct.label as cylinder_label
      FROM orders o
      JOIN order_lines ol ON ol.order_id = o.id
      JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
      WHERE o.customer_id = ? AND ct.item_type = 'sale' AND ol.unit_price > 0
      ORDER BY o.order_date DESC, o.created DESC
      LIMIT 1
    `).get(req.params.id);
    if (!row) return res.json({ found: false });
    res.json({
      found: true,
      unit_price: row.unit_price,
      cylinder_label: row.cylinder_label,
      order_date: row.order_date,
      order_number: row.order_number,
    });
  });

  router.delete("/customers/:id", (req, res) => {
    const txCount = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE customer_id = ?").get(req.params.id).c;
    if (txCount > 0) return res.status(400).json({ error: "Cannot delete customer with transactions" });
    const before = snapshot(db, "customers", req.params.id);
    db.prepare("DELETE FROM customer_pricing WHERE customer_id = ?").run(req.params.id);
    db.prepare("DELETE FROM customers WHERE id = ?").run(req.params.id);
    logDelete(db, req, "customers", req.params.id, before,
      `Deleted customer ${before?.account_number || req.params.id} — ${before?.name || "(unnamed)"}`);
    res.json({ success: true });
  });

  // ============================================================
  // CUSTOMER IMPORT (admin only)
  // ============================================================
  // Import customers from a parsed CSV. Address-as-identity:
  //   - Match existing customer by lowercased+trimmed delivery address
  //   - If found: update in place (preserves id, account_number, balance, history)
  //   - If new: create with fresh account_number from sequence
  // All fields except address are optional. Header names accepted case-insensitive.
  router.post("/admin/customers/import", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });

    const rows = req.body?.rows;
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows array required" });

    // Boolean parser: yes/y/true/1 → 1, else 0
    const parseBool = (v) => {
      if (v === true || v === 1) return 1;
      if (v === false || v === 0 || v === null || v === undefined) return 0;
      const s = String(v).trim().toLowerCase();
      return ["yes", "y", "true", "1", "t"].includes(s) ? 1 : 0;
    };

    // Customer category normalizer
    const parseCategory = (v) => {
      const s = String(v || "").trim().toLowerCase();
      if (s === "residential") return "Residential";
      if (s === "commercial") return "Commercial";
      return "";
    };

    // Address normalizer (for identity matching)
    const normAddr = (v) => String(v || "").trim().toLowerCase();

    // Get a value from the row by trying multiple header names (case-insensitive).
    // Frontend should send lowercased keys but we tolerate either.
    const getField = (row, ...candidates) => {
      for (const c of candidates) {
        const lc = c.toLowerCase();
        for (const key of Object.keys(row)) {
          if (key.toLowerCase() === lc) {
            const v = row[key];
            if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
          }
        }
      }
      return "";
    };

    // Build a lookup of all existing customers by normalized address
    const allExisting = db.prepare("SELECT id, address, account_number FROM customers").all();
    const byAddress = {};
    for (const c of allExisting) {
      const k = normAddr(c.address);
      if (k) byAddress[k] = c;
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    const insertStmt = db.prepare(
      `INSERT INTO customers (
        id, name, contact, phone, email, address, notes, onedrive_link, payment_ref, cc_encrypted, account_customer,
        account_number, state, internal_notes, accounts_contact, accounts_email, accounts_phone,
        compliance_number, pressure_test, abn, duration, milk_run_days, milk_run_frequency,
        rental_frequency, customer_type, customer_type_start, customer_type_end, rep_name, payment_terms, customer_category,
        chain, alternative_contact_name, alternative_contact_phone, compliance_not_required
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const updateStmt = db.prepare(
      `UPDATE customers SET
        name=?, contact=?, phone=?, email=?, address=?, notes=?, onedrive_link=?, payment_ref=?, account_customer=?,
        state=?, accounts_contact=?, accounts_email=?, accounts_phone=?,
        compliance_number=?, pressure_test=?, abn=?, duration=?, milk_run_days=?, milk_run_frequency=?,
        rental_frequency=?, customer_type=?, customer_type_start=?, customer_type_end=?, rep_name=?, payment_terms=?, customer_category=?,
        chain=?, alternative_contact_name=?, alternative_contact_phone=?, compliance_not_required=?,
        updated=datetime('now')
      WHERE id=?`
    );

    db.transaction(() => {
      let rowIndex = 0;
      for (const raw of rows) {
        rowIndex++;
        try {
          const address = getField(raw, "address", "delivery_address", "delivery address");
          if (!address) {
            skipped++;
            errors.push({ row: rowIndex, address: "", reason: "Missing delivery address (required)" });
            continue;
          }

          // Pull all fields. Each accepts a few header alias variations.
          const fields = {
            name:                      getField(raw, "name", "company_name", "company name", "customer_name"),
            contact:                   getField(raw, "contact", "contact_person", "contact person"),
            phone:                     getField(raw, "phone", "telephone", "tel"),
            email:                     getField(raw, "email", "email_address"),
            notes:                     getField(raw, "notes", "general_notes", "general notes"),
            onedrive_link:             getField(raw, "onedrive_link", "customer_documents", "documents", "onedrive"),
            payment_ref:               getField(raw, "payment_ref", "payment_reference"),
            account_customer:          parseBool(getField(raw, "account_customer", "account customer", "account")),
            state:                     getField(raw, "state"),
            accounts_contact:          getField(raw, "accounts_contact", "accounts contact", "account_contact_person"),
            accounts_email:            getField(raw, "accounts_email", "accounts email"),
            accounts_phone:            getField(raw, "accounts_phone", "accounts phone"),
            compliance_number:         getField(raw, "compliance_number", "compliance number", "compliance").slice(0, 300),
            pressure_test:             getField(raw, "pressure_test", "pressure test").slice(0, 10),
            abn:                       getField(raw, "abn"),
            duration:                  getField(raw, "duration"),
            milk_run_days:             getField(raw, "milk_run_days", "milk run days", "milk_run"),
            milk_run_frequency:        getField(raw, "milk_run_frequency", "milk run frequency").toLowerCase(),
            rental_frequency:          getField(raw, "rental_frequency", "rental frequency"),
            customer_type:             getField(raw, "customer_type", "customer type"),
            customer_type_start:       getField(raw, "customer_type_start", "fixed_start", "fixed start date"),
            customer_type_end:         getField(raw, "customer_type_end", "fixed_end", "fixed end date"),
            rep_name:                  getField(raw, "rep_name", "rep name"),
            payment_terms:             getField(raw, "payment_terms", "payment terms"),
            customer_category:         parseCategory(getField(raw, "customer_category", "customer category", "category")),
            chain:                     parseBool(getField(raw, "chain")),
            alternative_contact_name:  getField(raw, "alternative_contact_name", "alt_contact_name", "alternative contact name", "alternate contact name"),
            alternative_contact_phone: getField(raw, "alternative_contact_phone", "alt_contact_phone", "alternative contact phone", "alternate contact phone"),
            compliance_not_required:   parseBool(getField(raw, "compliance_not_required", "compliance not required")),
          };

          // Optional internal note from import — seeded as a single timestamped note
          const importedNote = getField(raw, "add internal note", "internal note", "internal_note");

          // Auto-categorize: if no company name was provided AND no explicit category was set,
          // treat as Residential. This matches the convention that blank-name rows are individuals.
          if (!fields.name && !fields.customer_category) {
            fields.customer_category = "Residential";
          }

          const key = normAddr(address);
          const match = byAddress[key];

          // Build the internal_notes JSON: prepend the imported note (if any) to existing notes
          const buildNotesJson = (existingJson) => {
            let arr = [];
            try { const a = JSON.parse(existingJson || "[]"); if (Array.isArray(a)) arr = a; } catch { /* ignore */ }
            if (importedNote) {
              arr.unshift({ date: new Date().toISOString(), text: importedNote });
            }
            return JSON.stringify(arr);
          };

          if (match) {
            // Update existing in place. Preserve id, account_number, balance, history.
            // For internal notes: read existing JSON, prepend imported note if any.
            const existingNotes = db.prepare("SELECT internal_notes FROM customers WHERE id = ?").get(match.id);
            const newNotesJson = buildNotesJson(existingNotes?.internal_notes);
            // Update the notes column directly (the main updateStmt doesn't touch internal_notes)
            if (importedNote) {
              db.prepare("UPDATE customers SET internal_notes = ? WHERE id = ?").run(newNotesJson, match.id);
            }
            updateStmt.run(
              fields.name, fields.contact, fields.phone, fields.email, address, fields.notes,
              fields.onedrive_link, fields.payment_ref, fields.account_customer,
              fields.state, fields.accounts_contact, fields.accounts_email, fields.accounts_phone,
              fields.compliance_number, fields.pressure_test, fields.abn, fields.duration,
              fields.milk_run_days, fields.milk_run_frequency,
              fields.rental_frequency, fields.customer_type, fields.customer_type_start, fields.customer_type_end,
              fields.rep_name, fields.payment_terms, fields.customer_category,
              fields.chain, fields.alternative_contact_name, fields.alternative_contact_phone, fields.compliance_not_required,
              match.id
            );
            updated++;
          } else {
            // Create fresh
            const id = uid();
            const accountNumber = nextSequenceNumber(db, "customer");
            const newNotesJson = buildNotesJson("[]");
            insertStmt.run(
              id, fields.name, fields.contact, fields.phone, fields.email, address, fields.notes,
              fields.onedrive_link, fields.payment_ref, "" /* cc_encrypted */, fields.account_customer,
              accountNumber, fields.state, newNotesJson,
              fields.accounts_contact, fields.accounts_email, fields.accounts_phone,
              fields.compliance_number, fields.pressure_test, fields.abn, fields.duration,
              fields.milk_run_days, fields.milk_run_frequency,
              fields.rental_frequency, fields.customer_type, fields.customer_type_start, fields.customer_type_end,
              fields.rep_name, fields.payment_terms, fields.customer_category,
              fields.chain, fields.alternative_contact_name, fields.alternative_contact_phone, fields.compliance_not_required
            );
            // Add to lookup so a duplicate later in the same file updates this new row
            byAddress[key] = { id, address, account_number: accountNumber };
            created++;
          }
        } catch (err) {
          skipped++;
          errors.push({ row: rowIndex, address: getField(raw, "address", "delivery_address"), reason: err.message });
        }
      }
    })();

    res.json({ created, updated, skipped, total: rows.length, errors });
  });

  // ============================================================
  // CYLINDER TYPES
  // ============================================================
  router.get("/cylinder-types", (req, res) => {
    res.json(db.prepare("SELECT * FROM cylinder_types ORDER BY sort_order, label").all());
  });

  router.post("/cylinder-types", (req, res) => {
    const { label, default_price, gas_group, item_type, sort_order, linked_sale_item_id } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: "Label is required" });
    const id = uid();
    db.prepare(
      "INSERT INTO cylinder_types (id, label, default_price, gas_group, item_type, sort_order, linked_sale_item_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, label.trim(), default_price || 0, gas_group || "", item_type || "cylinder", sort_order || 0, linked_sale_item_id || "");
    logCreate(db, req, "cylinder_types", id, snapshot(db, "cylinder_types", id),
      `Created cylinder type: ${label.trim()} @ $${default_price || 0}`);
    res.json({ id, label: label.trim() });
  });

  router.put("/cylinder-types/:id", (req, res) => {
    const { label, default_price, gas_group, item_type, sort_order, linked_sale_item_id } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: "Label is required" });
    const before = snapshot(db, "cylinder_types", req.params.id);
    db.prepare(
      "UPDATE cylinder_types SET label=?, default_price=?, gas_group=?, item_type=?, sort_order=?, linked_sale_item_id=? WHERE id=?"
    ).run(label.trim(), default_price || 0, gas_group || "", item_type || "cylinder", sort_order || 0, linked_sale_item_id || "", req.params.id);
    logUpdate(db, req, "cylinder_types", req.params.id, before, snapshot(db, "cylinder_types", req.params.id),
      `Updated cylinder type: ${label.trim()}`);
    res.json({ success: true });
  });

  router.delete("/cylinder-types/:id", (req, res) => {
    const txCount = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE cylinder_type = ?").get(req.params.id).c;
    if (txCount > 0) return res.status(400).json({ error: "Cannot delete cylinder type with transactions" });
    const before = snapshot(db, "cylinder_types", req.params.id);
    db.prepare("DELETE FROM customer_pricing WHERE cylinder_type = ?").run(req.params.id);
    db.prepare("DELETE FROM cylinder_types WHERE id = ?").run(req.params.id);
    logDelete(db, req, "cylinder_types", req.params.id, before,
      `Deleted cylinder type: ${before?.label || req.params.id}`);
    res.json({ success: true });
  });

  // ============================================================
  // TRANSACTIONS
  // ============================================================
  router.get("/transactions", (req, res) => {
    const { customer_id, cylinder_type, type, from, to, source, limit } = req.query;
    // 3.0.18: enrich with customer name/address and cylinder label so the transaction
    // history grid can show readable labels instead of raw IDs.
    let sql = `
      SELECT t.*,
        c.name as customer_name,
        c.address as customer_address,
        ct.label as cylinder_label,
        ct.item_type as cylinder_item_type
      FROM transactions t
      LEFT JOIN customers c ON c.id = t.customer_id
      LEFT JOIN cylinder_types ct ON ct.id = t.cylinder_type
      WHERE 1=1`;
    const params = [];
    if (customer_id) { sql += " AND t.customer_id = ?"; params.push(customer_id); }
    if (cylinder_type) { sql += " AND t.cylinder_type = ?"; params.push(cylinder_type); }
    if (type) { sql += " AND t.type = ?"; params.push(type); }
    if (from) { sql += " AND t.date >= ?"; params.push(from); }
    if (to) { sql += " AND t.date <= ?"; params.push(to); }
    if (source) { sql += " AND t.source = ?"; params.push(source); }
    sql += " ORDER BY t.date DESC, t.created DESC";
    if (limit) { sql += " LIMIT ?"; params.push(parseInt(limit)); }
    res.json(db.prepare(sql).all(...params));
  });

  router.post("/transactions", (req, res) => {
    const { customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order } = req.body;
    if (!customer_id || !cylinder_type || !type || !qty || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const qtyNum = parseInt(qty);
    if (!qtyNum || qtyNum <= 0) return res.status(400).json({ error: "Quantity must be > 0" });

    const ct = db.prepare("SELECT * FROM cylinder_types WHERE id = ?").get(cylinder_type);
    if (!ct) return res.status(400).json({ error: "Unknown cylinder type" });

    const txStmt = db.prepare(
      "INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, auto_generated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    const result = db.transaction(() => {
      const out = { id: null, overflow: null, auto_rental_seeded: false };

      // --- SALE overflow rule ---
      // If this is a sale delivery for a sale item, find the rental cylinder that links to it.
      // If sale qty > on-hand of the linked rental, auto-create a rental delivery for the overflow.
      if (type === "delivery" && ct.item_type === "sale") {
        const linkedRental = db.prepare(
          "SELECT * FROM cylinder_types WHERE item_type = 'cylinder' AND linked_sale_item_id = ?"
        ).get(cylinder_type);

        if (linkedRental) {
          const onHand = getOnHand(db, customer_id, linkedRental.id);
          if (qtyNum > onHand) {
            const overflowQty = qtyNum - onHand;
            const autoId = uid();
            txStmt.run(
              autoId, customer_id, linkedRental.id, "delivery", overflowQty, date,
              `Auto-generated: sale of ${ct.label} exceeded on-hand rentals by ${overflowQty}`,
              "auto_overflow", optimoroute_order || "", 1
            );
            out.overflow = { rental_cylinder_type: linkedRental.id, rental_label: linkedRental.label, qty: overflowQty };
          }
        }
      }

      // Insert the actual transaction the user requested
      const id = uid();
      txStmt.run(id, customer_id, cylinder_type, type, qtyNum, date, notes || "", source || "manual", optimoroute_order || "", 0);
      out.id = id;

      // --- Seed next_rental_date on first rental delivery ---
      // If this is a rental delivery and the customer has no next_rental_date yet,
      // set it to (delivery date + their rental frequency). Also set last_rental_date.
      if (type === "delivery" && ct.item_type === "cylinder") {
        const cust = db.prepare("SELECT next_rental_date, rental_frequency FROM customers WHERE id = ?").get(customer_id);
        if (cust && !cust.next_rental_date && cust.rental_frequency) {
          const next = addFrequency(date, cust.rental_frequency);
          db.prepare("UPDATE customers SET next_rental_date = ?, last_rental_date = ? WHERE id = ?").run(next, date, customer_id);
          out.auto_rental_seeded = true;
        }
      }

      return out;
    })();

    // Audit: one entry for the primary transaction, and a second if overflow
    // created an auto-rental. Both get logged with the user who triggered them.
    try {
      const primary = snapshot(db, "transactions", result.id);
      logCreate(db, req, "transactions", result.id, primary,
        `${type} ${qtyNum} × ${ct.label} for customer ${customer_id}`);
      if (result.overflow) {
        logAudit(db, req, {
          action: "create",
          table: "transactions",
          record_id: "",
          after: { auto: true, overflow: result.overflow, source: "auto_overflow", date, customer_id },
          summary: `Auto-overflow: ${result.overflow.qty} × ${result.overflow.rental_label} rental delivery`,
        });
      }
    } catch (e) { /* audit must not break response */ }

    res.json(result);
  });

  router.delete("/transactions/:id", (req, res) => {
    const before = snapshot(db, "transactions", req.params.id);
    if (!before) return res.json({ success: true });
    db.prepare("DELETE FROM transactions WHERE id = ?").run(req.params.id);
    logDelete(db, req, "transactions", req.params.id, before,
      `Deleted transaction: ${before.type} ${before.qty} × ${before.cylinder_type} on ${before.date}`);
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
    const orders = db.prepare(sql).all(...params);

    // Attach order_lines + cylinder type label per order
    if (orders.length > 0) {
      const ids = orders.map(o => o.id);
      const placeholders = ids.map(() => "?").join(",");
      const linesRows = db.prepare(
        `SELECT ol.*, ct.label as cylinder_label, ct.item_type
         FROM order_lines ol
         LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
         WHERE ol.order_id IN (${placeholders})
         ORDER BY ol.order_id, ol.sort_order, ol.id`
      ).all(...ids);
      const byOrder = {};
      for (const l of linesRows) {
        (byOrder[l.order_id] ||= []).push(l);
      }
      for (const o of orders) o.lines = byOrder[o.id] || [];
    }
    res.json(orders);
  });

  // Lookup price for a customer + order field (e.g. "2x45").
  // IMPORTANT: This route MUST be defined BEFORE `/orders/:id` because Express
  // matches routes in declaration order. If `/orders/:id` is registered first,
  // a request to `/orders/lookup-price` would match `/orders/:id` with id="lookup-price".
  router.get("/orders/lookup-price", (req, res) => {
    const { customer_id, order_detail } = req.query;
    if (!order_detail) return res.json({ lines: [], total: 0 });

    const cylinderTypes = db.prepare("SELECT * FROM cylinder_types").all();
    const today = new Date().toISOString().split("T")[0];

    // Split by comma into individual items
    const items = order_detail.split(",").map(s => s.trim()).filter(Boolean);
    const lines = [];
    let total = 0;

    // Get all customer prices in one query
    let custPriceMap = {};
    if (customer_id) {
      const rows = db.prepare("SELECT * FROM customer_pricing WHERE customer_id = ?").all(customer_id);
      for (const r of rows) custPriceMap[r.cylinder_type] = r;
    }

    for (const item of items) {
      const parsed = parseCylinderFromText(item, cylinderTypes);
      if (!parsed.cylinderType) {
        lines.push({ raw: item, matched: false, cylinder_label: "", cylinder_type_id: "", qty: 0, unit_price: 0, line_total: 0, is_fixed: false });
        continue;
      }
      const ct = parsed.cylinderType;
      const qty = parsed.qty || 1;
      const cp = custPriceMap[ct.id];
      const unitPrice = cp ? cp.price : ct.default_price;
      const isFixed = !!(cp && cp.fixed_price && cp.fixed_from && cp.fixed_to && today >= cp.fixed_from && today <= cp.fixed_to);
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
        is_fixed: isFixed,
        fixed_until: isFixed ? cp.fixed_to : "",
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

  router.get("/orders/:id", (req, res) => {
    // 3.0.7 BULLETPROOF FALLBACK: if anything routes a /orders/lookup-price request
    // through here (e.g. route order regression, deployment cache issue), serve the
    // lookup-price response inline instead of returning a misleading 404.
    if (req.params.id === "lookup-price") {
      const { customer_id, order_detail } = req.query;
      if (!order_detail) return res.json({ lines: [], total: 0 });
      const cylinderTypes = db.prepare("SELECT * FROM cylinder_types").all();
      const today = new Date().toISOString().split("T")[0];
      const items = order_detail.split(",").map(s => s.trim()).filter(Boolean);
      const lines = [];
      let total = 0;
      let custPriceMap = {};
      if (customer_id) {
        const rows = db.prepare("SELECT * FROM customer_pricing WHERE customer_id = ?").all(customer_id);
        for (const r of rows) custPriceMap[r.cylinder_type] = r;
      }
      for (const item of items) {
        const parsed = parseCylinderFromText(item, cylinderTypes);
        if (!parsed.cylinderType) {
          lines.push({ raw: item, matched: false, cylinder_label: "", cylinder_type_id: "", qty: 0, unit_price: 0, line_total: 0, is_fixed: false });
          continue;
        }
        const ct = parsed.cylinderType;
        const qty = parsed.qty || 1;
        const cp = custPriceMap[ct.id];
        const unitPrice = cp ? cp.price : ct.default_price;
        const isFixed = !!(cp && cp.fixed_price && cp.fixed_from && cp.fixed_to && today >= cp.fixed_from && today <= cp.fixed_to);
        const lineTotal = Math.round(unitPrice * qty * 100) / 100;
        total += lineTotal;
        lines.push({
          raw: item, matched: true, cylinder_label: ct.label, cylinder_type_id: ct.id,
          qty, unit_price: unitPrice, line_total: lineTotal,
          is_fixed: isFixed, fixed_until: isFixed ? cp.fixed_to : "",
        });
      }
      const first = lines.find(l => l.matched) || {};
      return res.json({
        lines, total: Math.round(total * 100) / 100,
        unit_price: first.unit_price || 0, qty: first.qty || 0,
        cylinder_type_id: first.cylinder_type_id || "", cylinder_label: first.cylinder_label || "",
      });
    }

    const order = db.prepare(
      `SELECT o.*, c.name as customer_name_lookup, c.address as customer_address_lookup
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`
    ).get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    order.lines = db.prepare(
      `SELECT ol.*, ct.label as cylinder_label, ct.item_type
       FROM order_lines ol
       LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
       WHERE ol.order_id = ?
       ORDER BY ol.sort_order, ol.id`
    ).all(req.params.id);
    res.json(order);
  });

  // Lookup price + fixed-contract status for a single customer + cylinder type combo.
  // Used by the order edit form to know whether to allow editing the line price and
  // whether to prompt for write-back.
  router.get("/pricing/customer/:custId/cylinder/:ctId", (req, res) => {
    const { custId, ctId } = req.params;
    const today = new Date().toISOString().split("T")[0];

    const cp = db.prepare(
      "SELECT * FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?"
    ).get(custId, ctId);

    const ct = db.prepare("SELECT * FROM cylinder_types WHERE id = ?").get(ctId);
    if (!ct) return res.status(404).json({ error: "Cylinder type not found" });

    let price, isCustom, isFixed = false, fixedUntil = "";
    if (cp) {
      price = cp.price;
      isCustom = true;
      if (cp.fixed_price && cp.fixed_from && cp.fixed_to && today >= cp.fixed_from && today <= cp.fixed_to) {
        isFixed = true;
        fixedUntil = cp.fixed_to;
      }
    } else {
      price = ct.default_price || 0;
      isCustom = false;
    }
    res.json({ price, is_custom: isCustom, is_fixed: isFixed, fixed_until: fixedUntil, default_price: ct.default_price || 0, cylinder_label: ct.label });
  });

  // Helper: build a line array from incoming request body. Supports both:
  //   (a) New shape: body.lines = [{ cylinder_type_id, qty, unit_price, line_total }, ...]
  //   (b) Old shape: body.cylinder_type_id + body.qty + body.unit_price + body.total_price (one line)
  // Returns { lines: [...], total: number, legacyHeaderLine: { cylinder_type_id, qty, unit_price, total_price } }
  function normalizeOrderLines(body) {
    let lines = [];
    if (Array.isArray(body.lines) && body.lines.length > 0) {
      lines = body.lines.map((l, i) => ({
        cylinder_type_id: l.cylinder_type_id || "",
        qty: parseFloat(l.qty) || 1,
        unit_price: parseFloat(l.unit_price) || 0,
        line_total: l.line_total !== undefined && l.line_total !== null && l.line_total !== ""
          ? parseFloat(l.line_total)
          : Math.round((parseFloat(l.unit_price) || 0) * (parseFloat(l.qty) || 1) * 100) / 100,
        sort_order: l.sort_order !== undefined ? parseInt(l.sort_order, 10) : i,
      })).filter(l => l.cylinder_type_id);
    } else if (body.cylinder_type_id) {
      // Backward-compat: single-line shape
      const qty = parseFloat(body.qty) || 1;
      const unit_price = parseFloat(body.unit_price) || 0;
      lines = [{
        cylinder_type_id: body.cylinder_type_id,
        qty,
        unit_price,
        line_total: parseFloat(body.total_price) || Math.round(qty * unit_price * 100) / 100,
        sort_order: 0,
      }];
    }
    const total = Math.round(lines.reduce((s, l) => s + (l.line_total || 0), 0) * 100) / 100;
    // Legacy header fields = first line
    const first = lines[0] || {};
    return {
      lines,
      total,
      legacyHeaderLine: {
        cylinder_type_id: first.cylinder_type_id || "",
        qty: first.qty || 0,
        unit_price: first.unit_price || 0,
        total_price: total,
      },
    };
  }

  // ============================================================
  // ROUND 3 HELPERS — order lifecycle, push, delivery, invoicing
  // ============================================================

  // Get order lines + cylinder type info
  function getOrderLinesWithType(orderId) {
    return db.prepare(
      `SELECT ol.*, ct.item_type, ct.label as cylinder_label
       FROM order_lines ol
       LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
       WHERE ol.order_id = ?
       ORDER BY ol.sort_order, ol.id`
    ).all(orderId);
  }

  // Determine if an order should push to Optimo. 3.0.17: also requires the Optimo API
  // key to be configured — if there's no key, the system silently skips Optimo entirely
  // and treats every order as manual (failsafe). This prevents the "API key not configured"
  // error from showing up on every save when a user is intentionally working without Optimo.
  function orderShouldPushToOptimo(order, lines) {
    if (order.collection) return false;
    if (!getApiKey(db)) return false;
    return lines.some(l => l.item_type === "sale");
  }

  // Push (or sync) an order to OptimoRoute. Caller is responsible for status updates.
  // Returns { success: true, optimoroute_id, response } or { success: false, error }.
  async function pushOrderToOptimo(orderId) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) return { success: false, error: "Order not found" };
    const lines = getOrderLinesWithType(orderId);
    if (!orderShouldPushToOptimo(order, lines)) {
      return { success: false, error: "Order is not eligible for OptimoRoute push (no sale items or marked as collection)" };
    }
    const apiKey = getApiKey(db);
    if (!apiKey) return { success: false, error: "OptimoRoute API key not configured" };
    try {
      const client = new OptimoRouteClient(apiKey);
      const payload = {
        customerName: order.customer_name,
        address: order.address,
        payment: order.payment,
        order: order.order_detail,
        notes: order.notes,
        date: order.order_date,
        duration: order.duration || 5,
      };
      let result;
      if (order.optimoroute_id) {
        result = await client.syncOrder({ id: order.optimoroute_id, ...payload });
      } else {
        result = await client.createOrder(payload);
      }
      const orId = result.id || order.optimoroute_id || "";
      return { success: true, optimoroute_id: orId, response: result };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }

  // Set order status with timestamp
  function setOrderStatus(orderId, newStatus) {
    db.prepare("UPDATE orders SET status = ?, updated = datetime('now') WHERE id = ?").run(newStatus, orderId);
  }

  // Mark a single line as delivered with a specific qty (or full qty if not specified).
  // delivered_qty defaults to ordered qty. If markComplete is true, also sets line.status='delivered'.
  function markOrderLineDelivered(orderId, lineId, deliveredQty, markComplete) {
    const line = db.prepare("SELECT * FROM order_lines WHERE id = ? AND order_id = ?").get(lineId, orderId);
    if (!line) return { error: "Line not found" };
    const newDeliveredQty = deliveredQty !== undefined && deliveredQty !== null ? parseFloat(deliveredQty) : (line.qty || 0);
    const isComplete = markComplete || newDeliveredQty >= (line.qty || 0);
    const newStatus = isComplete ? "delivered" : "open";
    db.prepare(
      "UPDATE order_lines SET delivered_qty = ?, status = ? WHERE id = ?"
    ).run(newDeliveredQty, newStatus, lineId);
    return { success: true, delivered_qty: newDeliveredQty, status: newStatus };
  }

  // Are all lines on this order in a terminal state? Round 3 originally had only
  // delivered/cancelled. 3.0.10 adds returned and return_other as terminal states
  // (used by the manual completion failsafe panel when Optimo is unavailable).
  function allLinesComplete(orderId) {
    const lines = db.prepare("SELECT status FROM order_lines WHERE order_id = ?").all(orderId);
    if (lines.length === 0) return false;
    const terminal = new Set(["delivered", "cancelled", "returned", "return_other"]);
    return lines.every(l => terminal.has(l.status));
  }

  // Create delivery transactions for cylinder lines on the order.
  // Each cylinder line gets one transaction with prepaid_until set to (delivery_date + one cycle)
  // based on the customer's rental_frequency, marking it as prepaid so the rental scheduler skips
  // the first cycle.
  // 3.0.18: Linked-rental processing for sale lines on delivery.
  // Domain rule: when a sale line (e.g. "9kg refill") is delivered, the customer may be
  // receiving more cylinders than they currently hold on rental. The excess (overflow) means
  // new cylinders going out the door — those need a rental position established.
  //
  // Commercial customers: write the linked rental delivery with empty prepaid_until so the
  //   end-of-month scheduler picks it up immediately. Existing scheduler handles billing.
  // Residential customers: prepay model. Write the linked rental delivery with a far-future
  //   sentinel prepaid_until so the scheduler NEVER touches it, AND create a one-shot
  //   rental_invoice (separate small invoice) for the overflow units priced via getPriceForDate.
  //
  // Idempotent via order_line_id existence check. Safe to call from multiple completion paths.
  // Returns { delivered, rentalInvoiceId } for diagnostics. saleLine must have item_type='sale'.
  function processLinkedRentalOnDelivery(order, customer, saleLine, deliveredQty) {
    if (!saleLine || saleLine.item_type !== "sale" || !(deliveredQty > 0)) return null;

    // Look up the linked rental cylinder type. If none, this sale item has no rental linkage.
    const ct = db.prepare("SELECT * FROM cylinder_types WHERE id = ?").get(saleLine.cylinder_type_id);
    if (!ct || !ct.linked_sale_item_id) {
      // saleLine.cylinder_type_id may BE the sale item id; the link goes the other direction.
      // Check the reverse: find a rental cylinder whose linked_sale_item_id points to this sale type.
    }
    const linkedRental = db.prepare(
      "SELECT * FROM cylinder_types WHERE item_type = 'cylinder' AND linked_sale_item_id = ?"
    ).get(saleLine.cylinder_type_id);
    if (!linkedRental) return null;

    // Idempotency: if we already wrote a delivery row for this order_line_id, bail.
    const exists = db.prepare(
      "SELECT 1 FROM transactions WHERE order_line_id = ? AND type = 'delivery' LIMIT 1"
    ).get(saleLine.id);
    if (exists) return null;

    // Compute current rental on-hand for the customer + linked rental type.
    // Note: any return transactions written earlier in this same completion (e.g. failsafe
    // recorded a 'returned' action on a sibling line) will already be reflected in getOnHand,
    // so the overflow calc naturally nets in-flight returns.
    const onHand = getOnHand(db, order.customer_id, linkedRental.id);
    const overflow = Math.max(0, deliveredQty - onHand);
    if (overflow <= 0) return null;

    // Branch on customer category. Default = residential when null/empty/anything-not-commercial.
    const isCommercial = (customer?.customer_category || "").toLowerCase() === "commercial";
    const prepaidUntil = isCommercial ? "" : "9999-12-31";

    // Write the linked rental delivery transaction.
    const txId = uid();
    db.prepare(
      `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, prepaid_until, order_line_id)
       VALUES (?, ?, ?, 'delivery', ?, ?, ?, 'order', ?, ?, ?)`
    ).run(
      txId, order.customer_id, linkedRental.id, overflow, order.order_date,
      `Order ${order.order_number} — auto linked rental for ${ct?.label || saleLine.cylinder_type_id} (overflow ${overflow} of ${deliveredQty} sold; ${isCommercial ? "commercial — billable" : "residential prepaid sentinel"})`,
      order.id, prepaidUntil, saleLine.id
    );

    // Residential prepay: create a one-shot rental invoice for the overflow units.
    // Commercial: nothing further — the end-of-month scheduler will bill it.
    let rentalInvoiceId = null;
    if (!isCommercial) {
      const unitPrice = getPriceForDate(db, order.customer_id, linkedRental.id, order.order_date, linkedRental.default_price || 0);
      const lineTotal = Math.round(unitPrice * overflow * 100) / 100;
      if (lineTotal > 0) {
        rentalInvoiceId = uid();
        const invoiceNumber = nextSequenceNumber(db, "invoice");
        db.prepare(
          `INSERT INTO invoices (id, invoice_number, customer_id, order_id, po_number, total, amount_paid, status, invoice_date)
           VALUES (?, ?, ?, '', '', ?, 0, 'open', ?)`
        ).run(rentalInvoiceId, invoiceNumber, order.customer_id, lineTotal, order.order_date);

        // Mirror billCustomerRental's pattern: write a rental_invoice transaction for the audit trail.
        db.prepare(
          `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, auto_generated)
           VALUES (?, ?, ?, 'rental_invoice', ?, ?, ?, 'order_linked_rental', 1)`
        ).run(
          uid(), order.customer_id, linkedRental.id, overflow, order.order_date,
          `Auto rental invoice ${invoiceNumber} — residential prepay for ${overflow} × ${linkedRental.label} from order ${order.order_number}`
        );

        try { autoApplyCreditsToInvoice(db, order.customer_id, rentalInvoiceId); } catch (e) { /* tolerate */ }
      }
    }

    return { delivered: overflow, rentalInvoiceId, isCommercial };
  }

  function createDeliveryTransactionsForOrder(orderId) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) return 0;
    const customer = db.prepare("SELECT rental_frequency, customer_category FROM customers WHERE id = ?").get(order.customer_id);
    const lines = getOrderLinesWithType(orderId);
    const insTx = db.prepare(
      `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, prepaid_until, order_line_id)
       VALUES (?, ?, ?, 'delivery', ?, ?, ?, 'order', ?, ?, ?)`
    );
    // 3.0.18: idempotency guard for explicit cylinder lines. Without this, calling this
    // function twice on the same order (e.g. from order-creation auto-fast-path then from
    // tryAutoTransitionToDelivered) would double-count on-hand.
    const cylExists = db.prepare(
      "SELECT 1 FROM transactions WHERE order_line_id = ? AND type = 'delivery' LIMIT 1"
    );
    let count = 0;
    for (const l of lines) {
      // Sale lines: process linked rental (overflow against current on-hand → linked rental delivery).
      if (l.item_type === "sale") {
        const sdq = l.delivered_qty > 0 ? l.delivered_qty : (l.qty || 0);
        const r = processLinkedRentalOnDelivery(order, customer, l, sdq);
        if (r) count++;
        continue;
      }
      // Explicit cylinder rental lines: original behaviour (first cycle prepaid).
      if (l.item_type !== "cylinder") continue;
      if (cylExists.get(l.id)) continue;
      const deliveredQty = l.delivered_qty > 0 ? l.delivered_qty : (l.qty || 0);
      if (deliveredQty <= 0) continue;
      const freq = customer?.rental_frequency || "monthly";
      const prepaidUntil = addFrequency(order.order_date, freq);
      const txId = uid();
      insTx.run(
        txId, order.customer_id, l.cylinder_type_id, deliveredQty, order.order_date,
        `Order ${order.order_number} — ${l.cylinder_label || l.cylinder_type_id} × ${deliveredQty} (first cycle prepaid until ${prepaidUntil})`,
        orderId, prepaidUntil, l.id
      );
      count++;
    }
    return count;
  }

  // Create or update the invoice for an order, sized to the DELIVERED lines.
  // Round 3 rule: invoice total = sum of (delivered_qty * unit_price) for all lines.
  // If an invoice already exists for this order, update it. Otherwise create one.
  // This is called when the order transitions to 'delivered' (round 3 invoicing rule).
  function generateInvoiceForOrder(orderId) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) return null;
    const lines = getOrderLinesWithType(orderId);

    // Compute the delivered total: sum of (delivered_qty * unit_price) for non-cancelled lines.
    let deliveredTotal = 0;
    for (const l of lines) {
      if (l.status === "cancelled") continue;
      const dq = l.delivered_qty > 0 ? l.delivered_qty : 0;
      deliveredTotal += dq * (l.unit_price || 0);
    }
    deliveredTotal = Math.round(deliveredTotal * 100) / 100;

    let invoiceId = order.invoice_id;
    let existingInvoice = null;
    if (invoiceId) {
      existingInvoice = db.prepare("SELECT id FROM invoices WHERE id = ?").get(invoiceId);
      if (!existingInvoice) {
        // 3.0.4 guard: order.invoice_id points at a non-existent invoice. This is an
        // orphan from earlier buggy code paths. Treat the order as if it had no invoice
        // and create a fresh one. Logged so we can spot when this happens going forward.
        console.warn(`[generateInvoiceForOrder] order ${orderId} had orphan invoice_id ${invoiceId} — creating fresh invoice`);
        invoiceId = null;
      }
    }

    if (invoiceId) {
      // Update existing invoice's total to delivered amount
      db.prepare(
        "UPDATE invoices SET total = ?, status = CASE WHEN amount_paid >= ? THEN 'paid' ELSE 'open' END, updated = datetime('now') WHERE id = ? AND status != 'void'"
      ).run(deliveredTotal, deliveredTotal, invoiceId);
    } else {
      // Create new invoice
      invoiceId = uid();
      const invoiceNumber = nextSequenceNumber(db, "invoice");
      const today = new Date().toISOString().split("T")[0];
      db.prepare(
        `INSERT INTO invoices (id, invoice_number, customer_id, order_id, po_number, total, amount_paid, status, invoice_date)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'open', ?)`
      ).run(invoiceId, invoiceNumber, order.customer_id, orderId, order.po_number || "", deliveredTotal, today);
      db.prepare("UPDATE orders SET invoice_id = ? WHERE id = ?").run(invoiceId, orderId);
    }

    // Apply any available credit notes
    try { autoApplyCreditsToInvoice(db, order.customer_id, invoiceId); } catch (e) { /* tolerate */ }

    // Recalc balance
    recalculateCustomerBalance(db, order.customer_id);

    return invoiceId;
  }

  // Try to auto-transition an order to 'delivered' if all its lines are complete.
  // If the order moves to 'delivered', also generates the invoice and creates delivery transactions.
  function tryAutoTransitionToDelivered(orderId) {
    if (!allLinesComplete(orderId)) return false;
    const order = db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId);
    if (!order) return false;
    // Don't re-transition if already past delivered
    if (["delivered", "invoiced", "paid", "cancelled"].includes(order.status)) return false;

    setOrderStatus(orderId, "delivered");
    createDeliveryTransactionsForOrder(orderId);
    generateInvoiceForOrder(orderId);
    setOrderStatus(orderId, "invoiced");

    // Check if invoice is fully paid (e.g. customer prepaid before delivery)
    const updatedOrder = db.prepare("SELECT invoice_id FROM orders WHERE id = ?").get(orderId);
    if (updatedOrder?.invoice_id) {
      const inv = db.prepare("SELECT amount_paid, total FROM invoices WHERE id = ?").get(updatedOrder.invoice_id);
      if (inv && inv.total > 0 && inv.amount_paid >= inv.total) {
        setOrderStatus(orderId, "paid");
      }
    }
    return true;
  }

  // Decide whether to auto-push for a newly-created/updated/paid order.
  // Returns the appropriate next status given the customer category, payment, and auto-push setting.
  function determineNextStatus(order, lines, customer, isPaidNow) {
    const isCommercial = (customer?.customer_category || "").toLowerCase() === "commercial";
    const autoPushEnabled = getSetting(db, "auto_push_enabled", "1") === "1";
    const hasOptimoEligible = orderShouldPushToOptimo(order, lines);

    // Pure-cylinder orders (no sale items, not collection) skip dispatch and go straight to delivered.
    // The dispatcher records the delivery via the order edit form or the order auto-transitions.
    if (!hasOptimoEligible && !order.collection) {
      return "open"; // Will be transitioned to delivered separately by the line-deliver flow
    }

    // Collection orders never push to Optimo, they go to awaiting_dispatch and the dispatcher
    // marks lines delivered manually.
    if (order.collection) {
      return "awaiting_dispatch";
    }

    // Commercial: auto-push immediately on create (regardless of payment)
    if (isCommercial) {
      return autoPushEnabled ? "awaiting_dispatch" : "awaiting_dispatch"; // same target, push happens after status set
    }

    // Residential: auto-push when paid in full
    if (isPaidNow) {
      return autoPushEnabled ? "awaiting_dispatch" : "awaiting_dispatch";
    }

    // Residential, not yet paid: stays open
    return "open";
  }

  router.post("/orders", async (req, res) => {
    try {
    const {
      customer_id, address, customer_name, order_detail, notes, order_date, payment, payment_ref,
      collection, paid, po_number, duration, payment_amount,
    } = req.body;
    if (!customer_id) return res.status(400).json({ error: "Customer is required" });
    if (!order_date) return res.status(400).json({ error: "Order date is required" });

    const { lines, total: orderTotal, legacyHeaderLine } = normalizeOrderLines(req.body);
    if (lines.length === 0) return res.status(400).json({ error: "At least one line is required" });

    // Resolve duration — prefer order-level, fall back to customer.duration, then 5
    let resolvedDuration = parseInt(duration, 10);
    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customer_id);
    if (!customer) return res.status(400).json({ error: "Customer not found" });
    if (!resolvedDuration || resolvedDuration <= 0) {
      resolvedDuration = parseDurationMinutes(customer.duration);
    }

    const orderId = uid();
    const orderNumber = nextSequenceNumber(db, "order");
    const partialPayment = Math.max(0, parseFloat(payment_amount) || 0);
    const isPaidNow = !!paid || (partialPayment >= orderTotal && orderTotal > 0);

    // Phase 1 — synchronous DB transaction: create order, lines, invoice, payment, status
    const phase1 = db.transaction(() => {
      // Insert the order header. Status starts as 'open' and gets transitioned below.
      // Legacy fields are still written for backward-compat with code that hasn't been
      // updated to read order_lines.
      db.prepare(
        `INSERT INTO orders (
          id, customer_id, address, customer_name, order_detail, cylinder_type_id,
          qty, unit_price, total_price, notes, order_date, payment, payment_ref,
          order_number, collection, paid, po_number, duration, payment_amount, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`
      ).run(
        orderId, customer_id, address || "", customer_name || "", order_detail || "",
        legacyHeaderLine.cylinder_type_id, legacyHeaderLine.qty, legacyHeaderLine.unit_price, orderTotal,
        notes || "", order_date, payment || "", payment_ref || "",
        orderNumber, collection ? 1 : 0, paid ? 1 : 0, po_number || "", resolvedDuration, partialPayment
      );

      // Insert order_lines
      const insLine = db.prepare(
        `INSERT INTO order_lines (id, order_id, cylinder_type_id, qty, delivered_qty, unit_price, line_total, status, sort_order)
         VALUES (?, ?, ?, ?, 0, ?, ?, 'open', ?)`
      );
      for (const l of lines) {
        insLine.run(uid(), orderId, l.cylinder_type_id, l.qty, l.unit_price, l.line_total, l.sort_order);
      }

      // Round 3 invoice rule: invoice is created in 'pending' state — it doesn't count
      // toward customer balance until the order is delivered. At delivery, the invoice's
      // total is recomputed from delivered_qty * unit_price and status flips to 'open'.
      const invoiceId = uid();
      const invoiceNumber = nextSequenceNumber(db, "invoice");
      db.prepare(
        `INSERT INTO invoices (id, invoice_number, customer_id, order_id, po_number, total, amount_paid, status, invoice_date)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?)`
      ).run(
        invoiceId, invoiceNumber, customer_id, orderId, po_number || "",
        orderTotal, order_date
      );
      db.prepare("UPDATE orders SET invoice_id = ? WHERE id = ?").run(invoiceId, orderId);

      // Apply payments to the pending invoice (a "deposit" or "prepayment")
      if (paid && orderTotal > 0) {
        db.prepare(
          "INSERT INTO payments (id, customer_id, invoice_id, amount, method, reference, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          nodeCrypto.randomBytes(6).toString("hex"),
          customer_id, invoiceId, orderTotal, payment || "manual", payment_ref || "",
          order_date, `Order ${orderNumber} prepaid on create`
        );
        db.prepare("UPDATE invoices SET amount_paid = ?, updated = datetime('now') WHERE id = ?")
          .run(orderTotal, invoiceId);
      } else if (partialPayment > 0 && orderTotal > 0) {
        const applied = Math.min(partialPayment, orderTotal);
        db.prepare(
          "INSERT INTO payments (id, customer_id, invoice_id, amount, method, reference, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          nodeCrypto.randomBytes(6).toString("hex"),
          customer_id, invoiceId, applied, payment || "manual", payment_ref || "",
          order_date, `Order ${orderNumber} partial prepayment`
        );
        db.prepare("UPDATE invoices SET amount_paid = ?, updated = datetime('now') WHERE id = ?")
          .run(applied, invoiceId);
      }

      // Determine the post-create status based on customer category, payment, and push setting.
      // Note: pure-cylinder orders return "open" here but get auto-transitioned to delivered below.
      const orderRow = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
      const fullLines = getOrderLinesWithType(orderId);
      const nextStatus = determineNextStatus(orderRow, fullLines, customer, isPaidNow);
      setOrderStatus(orderId, nextStatus);

      // Pure-cylinder orders (no sale items, not collection) auto-transition to delivered
      // immediately. The dispatcher can review/edit before delivery if they want via the
      // order edit form.
      const hasSaleLine = fullLines.some(l => l.item_type === "sale");
      const isPureCylinder = !hasSaleLine && !orderRow.collection;

      // ── ISSUE 9 DIAGNOSTIC ──
      // If you're seeing mixed orders (cylinder + sale) auto-complete to invoiced/paid,
      // this log will show why. Remove this block once issue 9 is verified fixed.
      console.log(`[POST /orders DIAG] order=${orderNumber} customer=${customer_id}`);
      console.log(`[POST /orders DIAG]   customer.customer_category=${JSON.stringify(customer?.customer_category)}`);
      console.log(`[POST /orders DIAG]   paid=${paid} payment_amount=${partialPayment} orderTotal=${orderTotal} isPaidNow=${isPaidNow}`);
      console.log(`[POST /orders DIAG]   collection=${!!orderRow.collection}`);
      console.log(`[POST /orders DIAG]   line breakdown:`);
      for (const l of fullLines) {
        console.log(`[POST /orders DIAG]     line ${l.id} cylinder_type_id=${l.cylinder_type_id} item_type=${JSON.stringify(l.item_type)} qty=${l.qty} unit_price=${l.unit_price}`);
      }
      console.log(`[POST /orders DIAG]   hasSaleLine=${hasSaleLine} isPureCylinder=${isPureCylinder} nextStatus=${nextStatus}`);

      if (isPureCylinder) {
        // Auto-deliver only when we are CERTAIN this is a safe auto-delivery.
        // Safe = all lines are cylinder rentals (no sale items), not a collection,
        // AND the customer is commercial (account). Residential pure-cylinder orders
        // should wait for explicit confirmation.
        //
        // This guard exists because of the April 2026 regression: if a sale item
        // was misconfigured as item_type='cylinder' (the default), the old logic
        // would silently treat it as pure-cylinder and auto-invoice it, leaving
        // the customer with a paid-looking invoice for goods they never received.
        //
        // Residential customers are a separate safety concern: their orders
        // require explicit payment confirmation before fulfillment, so we must
        // never auto-transition on create.
        const isCommercialAccount = (customer?.customer_category || "").toLowerCase() === "commercial";
        if (!isCommercialAccount) {
          console.log(`[POST /orders DIAG]   SKIPPING auto-transition — customer is not commercial (category=${customer?.customer_category}). Order stays at ${nextStatus}.`);
        } else {
          console.log(`[POST /orders DIAG]   AUTO-TRANSITIONING (pure-cylinder commercial path)`);
          // Mark all lines delivered immediately, transition to delivered, generate invoice, etc.
          for (const l of fullLines) {
            markOrderLineDelivered(orderId, l.id, l.qty, true);
          }
          tryAutoTransitionToDelivered(orderId);
        }
      }

      // Recalculate balance (excludes pending invoices)
      const bal = recalculateCustomerBalance(db, customer_id);

      return { invoiceId, invoiceNumber, balance: bal, nextStatus };
    })();

    // Phase 2 — async Optimo push (outside the transaction). Only if status is awaiting_dispatch
    // and auto_push_enabled. Failures don't roll back the order — caller gets a warning.
    let pushResult = null;
    let pushAttempted = false;
    const autoPushEnabled = getSetting(db, "auto_push_enabled", "1") === "1";
    if (phase1.nextStatus === "awaiting_dispatch" && autoPushEnabled) {
      const orderRow = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
      const fullLines = getOrderLinesWithType(orderId);
      if (orderShouldPushToOptimo(orderRow, fullLines)) {
        pushAttempted = true;
        pushResult = await pushOrderToOptimo(orderId);
        if (pushResult.success) {
          db.prepare(
            "UPDATE orders SET optimoroute_id = ?, status = 'dispatched', updated = datetime('now') WHERE id = ?"
          ).run(pushResult.optimoroute_id, orderId);
        }
        // If push failed, order stays at awaiting_dispatch — caller handles the warning
      }
    }

    res.json({
      id: orderId,
      order_number: orderNumber,
      invoice_id: phase1.invoiceId,
      invoice_number: phase1.invoiceNumber,
      balance: phase1.balance,
      status: db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId).status,
      push_attempted: pushAttempted,
      push_success: pushResult?.success || false,
      push_error: pushResult?.error || null,
    });

    // Audit: log the new order + its invoice as a single combined entry
    try {
      const orderSnap = snapshot(db, "orders", orderId);
      logCreate(db, req, "orders", orderId, orderSnap,
        `Created order ${orderNumber} for customer ${customer_id} — $${orderTotal.toFixed(2)} (invoice ${phase1.invoiceNumber})`);
      logCreate(db, req, "invoices", phase1.invoiceId, snapshot(db, "invoices", phase1.invoiceId),
        `Created invoice ${phase1.invoiceNumber} linked to order ${orderNumber}`);
    } catch (e) { /* audit must not break response */ }
    } catch (err) {
      console.error("[POST /orders] EXCEPTION:", err);
      console.error("[POST /orders] Stack:", err.stack);
      console.error("[POST /orders] Request body was:", JSON.stringify(req.body, null, 2));
      return res.status(500).json({
        error: err.message || "Internal server error during order creation",
        details: err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : null,
      });
    }
  });

  router.put("/orders/:id", async (req, res) => {
    try {
    const {
      customer_id, address, customer_name, order_detail, notes, order_date, payment, payment_ref,
      collection, paid, po_number, duration, payment_amount,
    } = req.body;

    const existing = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Order not found" });

    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customer_id || existing.customer_id);
    if (!customer) return res.status(400).json({ error: "Customer not found" });

    // Round 3 rule: line edits are only allowed while the order is in 'open' or 'awaiting_dispatch'.
    // Once dispatched/delivered/invoiced, lines are frozen. Header field edits (notes, po, etc.)
    // are still allowed.
    const lockedStates = ["dispatched", "delivered", "invoiced", "paid", "cancelled"];
    const linesLocked = lockedStates.includes(existing.status);

    const { lines, total: newTotal, legacyHeaderLine } = normalizeOrderLines(req.body);
    if (!linesLocked && lines.length === 0) {
      return res.status(400).json({ error: "At least one line is required" });
    }

    let resolvedDuration = parseInt(duration, 10);
    if (!resolvedDuration || resolvedDuration <= 0) resolvedDuration = existing.duration || 5;

    const newPaymentAmount = Math.max(0, parseFloat(payment_amount) || 0);
    const oldPaymentAmount = parseFloat(existing.payment_amount) || 0;
    const paymentDelta = newPaymentAmount - oldPaymentAmount;
    // Was this order JUST marked paid in this edit?
    const newlyPaid = !!paid && !existing.paid;

    // 3.0.3 guard: refuse a payment-amount DECREASE on edit. The order form's payment_amount
    // field is additive (each save records the delta as a new payment) so reducing it would
    // mean amount_paid > payment_amount on the invoice forever. To reduce a recorded payment
    // the user must void the invoice or use a credit note — not edit the order.
    if (paymentDelta < -0.005) {
      return res.status(400).json({
        error: `Cannot reduce recorded payment from $${oldPaymentAmount.toFixed(2)} to $${newPaymentAmount.toFixed(2)}. ` +
               `To reverse a payment, void the invoice or issue a credit note. ` +
               `(The payment_amount field on the order form is additive — each save records the difference as a new payment.)`,
      });
    }

    // ── ISSUE-EDIT-INFLATION DIAGNOSTIC ──
    // If editing an order keeps inflating the customer balance, this log shows why.
    console.log(`[PUT /orders DIAG] order=${existing.order_number} customer=${customer.id}`);
    console.log(`[PUT /orders DIAG]   existing.status=${existing.status} existing.total_price=${existing.total_price} existing.payment_amount=${existing.payment_amount} existing.paid=${existing.paid}`);
    console.log(`[PUT /orders DIAG]   incoming newTotal=${newTotal} payment_amount=${newPaymentAmount} paid=${paid}`);
    console.log(`[PUT /orders DIAG]   paymentDelta=${paymentDelta} newlyPaid=${newlyPaid} linesLocked=${linesLocked}`);
    if (existing.invoice_id) {
      const invBefore = db.prepare("SELECT id, invoice_number, total, amount_paid, status FROM invoices WHERE id = ?").get(existing.invoice_id);
      console.log(`[PUT /orders DIAG]   invoice BEFORE: ${JSON.stringify(invBefore)}`);
    }
    const balBefore = db.prepare("SELECT balance, credit_balance FROM customers WHERE id = ?").get(customer.id);
    console.log(`[PUT /orders DIAG]   customer BEFORE: balance=${balBefore?.balance} credit=${balBefore?.credit_balance}`);
    // Also count total invoices for this customer to detect duplicates
    const allInv = db.prepare("SELECT id, invoice_number, order_id, total, amount_paid, status FROM invoices WHERE customer_id = ?").all(customer.id);
    console.log(`[PUT /orders DIAG]   ALL ${allInv.length} invoices for this customer:`);
    for (const i of allInv) {
      console.log(`[PUT /orders DIAG]     ${i.invoice_number} order=${i.order_id} total=${i.total} paid=${i.amount_paid} status=${i.status}`);
    }

    // Phase 1 — DB transaction (header + lines + payments). Phase 2 (Optimo push) runs after.
    const phase1 = db.transaction(() => {
      // Update the order header
      if (linesLocked) {
        // Locked: don't touch lines or legacy fields, only update editable header fields.
        db.prepare(
          `UPDATE orders SET
            address=?, customer_name=?, notes=?, payment=?, payment_ref=?,
            po_number=?, duration=?, payment_amount=?, paid=?, updated=datetime('now')
          WHERE id=?`
        ).run(
          address || existing.address || "", customer_name || existing.customer_name || "",
          notes || "", payment || "", payment_ref || "", po_number || "",
          resolvedDuration, newPaymentAmount, paid ? 1 : (existing.paid || 0),
          req.params.id
        );
      } else {
        // Unlocked: full update including lines
        db.prepare(
          `UPDATE orders SET
            customer_id=?, address=?, customer_name=?, order_detail=?, cylinder_type_id=?,
            qty=?, unit_price=?, total_price=?, notes=?, order_date=?, payment=?, payment_ref=?,
            collection=?, paid=?, po_number=?, duration=?, payment_amount=?, updated=datetime('now')
          WHERE id=?`
        ).run(
          customer_id, address || "", customer_name || "", order_detail || "",
          legacyHeaderLine.cylinder_type_id, legacyHeaderLine.qty, legacyHeaderLine.unit_price, newTotal,
          notes || "", order_date, payment || "", payment_ref || "",
          collection ? 1 : 0, paid ? 1 : 0, po_number || "", resolvedDuration, newPaymentAmount,
          req.params.id
        );

        // Replace order_lines: delete + reinsert (round 2 simplification)
        db.prepare("DELETE FROM order_lines WHERE order_id = ?").run(req.params.id);
        const insLine = db.prepare(
          `INSERT INTO order_lines (id, order_id, cylinder_type_id, qty, delivered_qty, unit_price, line_total, status, sort_order)
           VALUES (?, ?, ?, ?, 0, ?, ?, 'open', ?)`
        );
        for (const l of lines) {
          insLine.run(uid(), req.params.id, l.cylinder_type_id, l.qty, l.unit_price, l.line_total, l.sort_order);
        }
      }

      // Sync the invoice if the order has one
      if (existing.invoice_id) {
        const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(existing.invoice_id);
        if (inv && inv.status !== "void") {
          // Pending invoices track the prepayment amount and the projected total.
          // The total only "locks" at delivery time (generateInvoiceForOrder).
          if (!linesLocked) {
            db.prepare("UPDATE invoices SET total = ?, po_number = ?, updated = datetime('now') WHERE id = ?")
              .run(newTotal, po_number || "", existing.invoice_id);
          }

          // Newly paid via checkbox → record payment
          if (newlyPaid) {
            const totalToUse = linesLocked ? (inv.total || 0) : newTotal;
            const currentPaid = inv.amount_paid || 0;
            const remaining = Math.max(0, totalToUse - currentPaid);
            if (remaining > 0) {
              db.prepare(
                "INSERT INTO payments (id, customer_id, invoice_id, amount, method, reference, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(
                nodeCrypto.randomBytes(6).toString("hex"),
                customer.id, existing.invoice_id, remaining, payment || "manual",
                payment_ref || "", order_date || existing.order_date, `Order ${existing.order_number} marked paid`
              );
              db.prepare("UPDATE invoices SET amount_paid = amount_paid + ?, updated = datetime('now') WHERE id = ?")
                .run(remaining, existing.invoice_id);
            }
            // If invoice is no longer pending (delivered already), and is now fully paid, flip to paid status
            if (inv.status !== "pending") {
              const refreshedInv = db.prepare("SELECT amount_paid, total FROM invoices WHERE id = ?").get(existing.invoice_id);
              if (refreshedInv && refreshedInv.amount_paid >= refreshedInv.total && refreshedInv.total > 0) {
                db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").run(existing.invoice_id);
              }
            }
          } else if (paymentDelta > 0) {
            // Partial payment increased — record the delta
            db.prepare(
              "INSERT INTO payments (id, customer_id, invoice_id, amount, method, reference, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ).run(
              nodeCrypto.randomBytes(6).toString("hex"),
              customer.id, existing.invoice_id, paymentDelta, payment || "manual",
              payment_ref || "", order_date || existing.order_date, `Order ${existing.order_number} partial payment`
            );
            db.prepare("UPDATE invoices SET amount_paid = amount_paid + ?, updated = datetime('now') WHERE id = ?")
              .run(paymentDelta, existing.invoice_id);
            // Same flip-to-paid check
            if (inv.status !== "pending") {
              const refreshedInv = db.prepare("SELECT amount_paid, total FROM invoices WHERE id = ?").get(existing.invoice_id);
              if (refreshedInv && refreshedInv.amount_paid >= refreshedInv.total && refreshedInv.total > 0) {
                db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").run(existing.invoice_id);
              }
            }
          }
        }
      }

      // Round 3: if the order was 'open' and is now paid in full (residential workflow),
      // transition to awaiting_dispatch so the auto-push can fire.
      const refreshed = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
      let nextStatus = refreshed.status;
      if (refreshed.status === "open") {
        const fullLines = getOrderLinesWithType(req.params.id);
        const isPaidNow = !!paid || (newPaymentAmount >= newTotal && newTotal > 0);
        const isCommercial = (customer.customer_category || "").toLowerCase() === "commercial";
        const hasOptimoEligible = orderShouldPushToOptimo(refreshed, fullLines);
        if ((isCommercial || isPaidNow) && hasOptimoEligible) {
          nextStatus = "awaiting_dispatch";
          setOrderStatus(req.params.id, "awaiting_dispatch");
        }
      }

      recalculateCustomerBalance(db, customer.id);
      return { nextStatus };
    })();

    // ── ISSUE-EDIT-INFLATION DIAGNOSTIC (after) ──
    if (existing.invoice_id) {
      const invAfter = db.prepare("SELECT id, invoice_number, total, amount_paid, status FROM invoices WHERE id = ?").get(existing.invoice_id);
      console.log(`[PUT /orders DIAG]   invoice AFTER:  ${JSON.stringify(invAfter)}`);
    }
    const balAfter = db.prepare("SELECT balance, credit_balance FROM customers WHERE id = ?").get(customer.id);
    console.log(`[PUT /orders DIAG]   customer AFTER:  balance=${balAfter?.balance} credit=${balAfter?.credit_balance}`);
    const allInvAfter = db.prepare("SELECT id, invoice_number, order_id, total, amount_paid, status FROM invoices WHERE customer_id = ?").all(customer.id);
    console.log(`[PUT /orders DIAG]   ALL ${allInvAfter.length} invoices AFTER:`);
    for (const i of allInvAfter) {
      console.log(`[PUT /orders DIAG]     ${i.invoice_number} order=${i.order_id} total=${i.total} paid=${i.amount_paid} status=${i.status}`);
    }
    // Also dump any payments for this customer's invoices
    const allPay = db.prepare(
      `SELECT p.id, p.invoice_id, p.amount, p.method, p.date, p.notes
       FROM payments p
       WHERE p.customer_id = ?
       ORDER BY p.date DESC, p.id DESC LIMIT 20`
    ).all(customer.id);
    console.log(`[PUT /orders DIAG]   last ${allPay.length} payments for this customer:`);
    for (const p of allPay) {
      console.log(`[PUT /orders DIAG]     ${p.id} inv=${p.invoice_id} amount=${p.amount} ${p.method} ${p.date} — ${p.notes}`);
    }

    // Phase 2 — Optimo push if newly transitioned to awaiting_dispatch and auto-push enabled
    let pushResult = null;
    let pushAttempted = false;
    const autoPushEnabled = getSetting(db, "auto_push_enabled", "1") === "1";
    const refreshedOrder = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (refreshedOrder.status === "awaiting_dispatch" && !refreshedOrder.optimoroute_id && autoPushEnabled) {
      const fullLines = getOrderLinesWithType(req.params.id);
      if (orderShouldPushToOptimo(refreshedOrder, fullLines)) {
        pushAttempted = true;
        pushResult = await pushOrderToOptimo(req.params.id);
        if (pushResult.success) {
          db.prepare(
            "UPDATE orders SET optimoroute_id = ?, status = 'dispatched', updated = datetime('now') WHERE id = ?"
          ).run(pushResult.optimoroute_id, req.params.id);
        }
      }
    } else if (refreshedOrder.optimoroute_id) {
      // Already dispatched — if header was edited, sync the update to Optimo
      try {
        const r = await pushOrderToOptimo(req.params.id);
        if (r.success) pushResult = r;
      } catch (e) { /* tolerate */ }
    }

    res.json({
      success: true,
      status: db.prepare("SELECT status FROM orders WHERE id = ?").get(req.params.id).status,
      push_attempted: pushAttempted,
      push_success: pushResult?.success || false,
      push_error: pushResult?.error || null,
    });

    try {
      logUpdate(db, req, "orders", req.params.id, existing, snapshot(db, "orders", req.params.id),
        `Updated order ${existing.order_number || req.params.id}`);
    } catch (e) { /* audit must not break response */ }
    } catch (err) {
      console.error("[PUT /orders] EXCEPTION:", err);
      console.error("[PUT /orders] Stack:", err.stack);
      console.error("[PUT /orders] Request body was:", JSON.stringify(req.body, null, 2));
      return res.status(500).json({
        error: err.message || "Internal server error during order update",
        details: err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : null,
      });
    }
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
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.json({ success: true });
    const invoiceBefore = order.invoice_id
      ? db.prepare("SELECT * FROM invoices WHERE id = ?").get(order.invoice_id)
      : null;
    db.transaction(() => {
      if (order.invoice_id) {
        // Void the invoice rather than hard-delete — preserves payment history
        db.prepare("UPDATE invoices SET status = 'void', updated = datetime('now') WHERE id = ?").run(order.invoice_id);
      }
      db.prepare("DELETE FROM orders WHERE id = ?").run(req.params.id);
      recalculateCustomerBalance(db, order.customer_id);
    })();
    try {
      logDelete(db, req, "orders", req.params.id, order,
        `Deleted order ${order.order_number || req.params.id}${order.invoice_id ? ` (voided linked invoice)` : ""}`);
      if (invoiceBefore) {
        logUpdate(db, req, "invoices", invoiceBefore.id, invoiceBefore,
          snapshot(db, "invoices", invoiceBefore.id),
          `Voided invoice ${invoiceBefore.invoice_number || invoiceBefore.id} because its order was deleted`);
      }
    } catch (e) { /* audit must not break response */ }
    res.json({ success: true });
  });

  // Confirm payment → push order to OptimoRoute (if applicable) + create delivery transactions
  // RULES:
  // - If order.collection = 1, do NOT push to OptimoRoute (manual fulfillment)
  // - If ALL lines are rental cylinders, do NOT push to OptimoRoute
  // - If ANY line is a sale item AND not collection, push to OptimoRoute
  // - Duration is taken from order.duration (resolved from customer.duration at create time)
  // - One delivery transaction is created per order line (for accurate on-hand tracking)
  // Round 3: confirm-payment is now a backward-compat shim that delegates to the new
  // push-to-optimo flow. Frontend may still call this; behavior is now:
  //   - If order is in 'open' or 'awaiting_dispatch', push to Optimo (if eligible) and transition to 'dispatched'
  //   - For collection or pure-cylinder orders, mark all lines delivered (skipping dispatch)
  //   - For already-dispatched orders, no-op success
  router.post("/orders/:id/confirm-payment", async (req, res) => {
    try {
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      const lines = getOrderLinesWithType(req.params.id);
      const hasAnySaleItem = lines.some(l => l.item_type === "sale");
      const shouldPush = orderShouldPushToOptimo(order, lines);

      // Already dispatched or beyond → no-op
      if (["dispatched", "delivered", "invoiced", "paid"].includes(order.status)) {
        return res.json({
          success: true,
          message: `Order already in status '${order.status}'`,
          pushedToOptimo: false,
        });
      }

      // Not eligible for Optimo push. Two sub-cases:
      //   (a) No sale lines and not collection = pure cylinder rental.
      //       Mark lines delivered and transition to delivered/invoiced.
      //   (b) Collection order (pickup). Same as above — dispatcher marks
      //       delivered via the manual flow but this path still works.
      //   (c) Order has sale lines BUT Optimo is unavailable (no API key,
      //       or client unreachable). This is the DANGEROUS case — we
      //       must NOT auto-mark the sale line delivered because the
      //       sale hasn't actually been fulfilled yet. Instead, strand
      //       the order at awaiting_dispatch and surface the Manual
      //       Completion panel so the dispatcher records actual outcomes.
      //
      // See WORKING_FILE.md invariant #5 — this is the mixed-order trap
      // that caused the April 2026 regression where sale orders cascaded
      // to 'invoiced' without payment because Optimo was unavailable.
      if (!shouldPush) {
        if (hasAnySaleItem && !order.collection) {
          // Case (c): strand at awaiting_dispatch for manual completion
          db.prepare(
            "UPDATE orders SET status = 'awaiting_dispatch', updated = datetime('now') WHERE id = ? AND status = 'open'"
          ).run(req.params.id);
          logAudit(db, req, {
            action: "update",
            table: "orders",
            record_id: req.params.id,
            summary: `Order ${order.order_number || req.params.id} stranded at awaiting_dispatch — has sale lines but Optimo push not available. Use Manual Completion panel.`,
          });
          return res.json({
            success: true,
            pushedToOptimo: false,
            fulfillmentMode: "manual_completion_required",
            stranded: true,
            message: "Order has sale lines but is not eligible for Optimo push. Use the Manual Completion panel to record actual delivery outcomes.",
          });
        }
        // Cases (a) and (b): pure-cylinder rental or collection — safe to auto-deliver
        for (const l of lines) {
          markOrderLineDelivered(req.params.id, l.id, l.qty, true);
        }
        const transitioned = tryAutoTransitionToDelivered(req.params.id);
        return res.json({
          success: true,
          pushedToOptimo: false,
          fulfillmentMode: order.collection ? "collection" : "rental",
          transitioned,
        });
      }

      // Eligible for push → transition to awaiting_dispatch FIRST, then push,
      // then advance to dispatched only on successful push. Never jump straight
      // to 'dispatched' — see WORKING_FILE.md "Order Status State Machine"
      // invariants 1 & 2. Setting awaiting_dispatch before the push also means
      // a post-push DB failure leaves the order recoverable via the failsafe
      // Manual Completion panel rather than stuck in 'open'.
      db.prepare(
        "UPDATE orders SET payment_confirmed = 1, status = 'awaiting_dispatch', updated = datetime('now') WHERE id = ? AND status = 'open'"
      ).run(req.params.id);

      const result = await pushOrderToOptimo(req.params.id);
      if (!result.success) {
        // Leave order at awaiting_dispatch so dispatcher can retry or use the
        // Manual Completion failsafe panel. Do NOT roll back to 'open'.
        return res.status(500).json({ error: result.error, status: "awaiting_dispatch" });
      }
      db.prepare(
        "UPDATE orders SET optimoroute_id = ?, status = 'dispatched', updated = datetime('now') WHERE id = ?"
      ).run(result.optimoroute_id, req.params.id);

      res.json({
        success: true,
        optimoroute: result.response,
        pushedToOptimo: true,
        fulfillmentMode: "optimo",
      });
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
        duration: order.duration || 5,
      });

      db.prepare("UPDATE orders SET updated = datetime('now') WHERE id = ?").run(req.params.id);
      res.json({ success: true, optimoroute: orResult });
    } catch (err) {
      console.error("[OR Resend] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // INVOICES
  // ============================================================
  router.get("/invoices", (req, res) => {
    const { customer_id, status } = req.query;
    let sql = `SELECT i.*, c.name as customer_name, c.account_number FROM invoices i
               LEFT JOIN customers c ON c.id = i.customer_id WHERE 1=1`;
    const params = [];
    if (customer_id) { sql += " AND i.customer_id = ?"; params.push(customer_id); }
    if (status) { sql += " AND i.status = ?"; params.push(status); }
    sql += " ORDER BY i.created DESC";
    res.json(db.prepare(sql).all(...params));
  });

  router.get("/invoices/:id", (req, res) => {
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    const payments = db.prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY date DESC").all(req.params.id);

    // Build line items: order_lines for order-linked invoices, transactions for rental invoices
    let lines = [];
    if (inv.order_id) {
      lines = db.prepare(
        `SELECT ol.id, ol.cylinder_type_id, ol.qty, ol.unit_price, ol.line_total,
                ct.label as cylinder_label
         FROM order_lines ol
         LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
         WHERE ol.order_id = ?
         ORDER BY ol.sort_order, ol.id`
      ).all(inv.order_id);
    } else {
      // Rental invoice — derive from rental_invoice transactions on the same date
      const txns = db.prepare(`
        SELECT t.cylinder_type as cylinder_type_id, t.qty, ct.label as cylinder_label, ct.default_price
        FROM transactions t
        JOIN cylinder_types ct ON ct.id = t.cylinder_type
        WHERE t.customer_id = ? AND t.type = 'rental_invoice' AND t.date = ?
      `).all(inv.customer_id, inv.invoice_date);
      for (const t of txns) {
        const unitPrice = getPriceForDate(db, inv.customer_id, t.cylinder_type_id, inv.invoice_date, t.default_price || 0);
        lines.push({
          cylinder_type_id: t.cylinder_type_id,
          cylinder_label: t.cylinder_label,
          qty: t.qty,
          unit_price: unitPrice,
          line_total: Math.round(unitPrice * t.qty * 100) / 100,
        });
      }
    }

    res.json({ ...inv, payments, lines });
  });

  // Record a payment against an invoice
  router.post("/invoices/:id/payment", async (req, res) => {
    const { amount, method, reference, date, notes } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: "Amount must be > 0" });

    const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    if (inv.status === "void") return res.status(400).json({ error: "Cannot pay a void invoice" });

    // Phase 1 — record payment, update invoice, transition order status if applicable
    const phase1 = db.transaction(() => {
      db.prepare(
        "INSERT INTO payments (id, customer_id, invoice_id, amount, method, reference, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        nodeCrypto.randomBytes(6).toString("hex"),
        inv.customer_id, req.params.id, amt, method || "manual", reference || "",
        date || new Date().toISOString().split("T")[0], notes || ""
      );
      const newPaid = (inv.amount_paid || 0) + amt;
      const fullyCovered = newPaid >= inv.total;
      // For pending invoices (round 3): the invoice stays pending until delivery — payment
      // accumulates as a prepayment. For non-pending (live) invoices: flip to 'paid' when covered.
      let newStatus = inv.status;
      if (inv.status !== "pending" && fullyCovered) {
        newStatus = "paid";
      }
      db.prepare("UPDATE invoices SET amount_paid = ?, status = ?, updated = datetime('now') WHERE id = ?")
        .run(newPaid, newStatus, req.params.id);

      // Round 3: if this invoice is linked to an order and is now fully paid (whether it was
      // pending or live), check if we should transition the order's status.
      let orderToProbe = null;
      if (fullyCovered && inv.order_id) {
        const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(inv.order_id);
        if (order) {
          db.prepare("UPDATE orders SET paid = 1 WHERE id = ?").run(order.id);

          // If the order has been delivered/invoiced, transition to 'paid'.
          if (["delivered", "invoiced"].includes(order.status)) {
            setOrderStatus(order.id, "paid");
          }
          // If the order is still 'open' (residential awaiting payment), bump to 'awaiting_dispatch'
          // so the auto-push triggers in phase 2.
          else if (order.status === "open") {
            const customer = db.prepare("SELECT customer_category FROM customers WHERE id = ?").get(order.customer_id);
            const fullLines = getOrderLinesWithType(order.id);
            if (orderShouldPushToOptimo(order, fullLines)) {
              setOrderStatus(order.id, "awaiting_dispatch");
              orderToProbe = order.id;
            }
          }
        }
      }

      recalculateCustomerBalance(db, inv.customer_id);
      return { orderToProbe };
    })();

    // Phase 2 — Optimo push if order was just bumped to awaiting_dispatch
    let pushResult = null;
    let pushAttempted = false;
    const autoPushEnabled = getSetting(db, "auto_push_enabled", "1") === "1";
    if (phase1.orderToProbe && autoPushEnabled) {
      pushAttempted = true;
      pushResult = await pushOrderToOptimo(phase1.orderToProbe);
      if (pushResult.success) {
        db.prepare(
          "UPDATE orders SET optimoroute_id = ?, status = 'dispatched', updated = datetime('now') WHERE id = ?"
        ).run(pushResult.optimoroute_id, phase1.orderToProbe);
      }
    }

    res.json({
      success: true,
      push_attempted: pushAttempted,
      push_success: pushResult?.success || false,
      push_error: pushResult?.error || null,
    });

    try {
      logAudit(db, req, {
        action: "payment",
        table: "invoices",
        record_id: req.params.id,
        before: inv,
        after: snapshot(db, "invoices", req.params.id),
        summary: `Payment $${amt.toFixed(2)} via ${method || "manual"} on invoice ${inv.invoice_number || req.params.id}${reference ? ` (ref ${reference})` : ""}`,
      });
    } catch (e) { /* audit must not break response */ }
  });

  // ============================================================
  // ROUND 3 — order lifecycle endpoints (push, deliver, settings)
  // ============================================================

  // Manual push to Optimo (retry after a failed auto-push, or for orders in manual mode)
  router.post("/orders/:id/push-to-optimo", async (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!["open", "awaiting_dispatch"].includes(order.status)) {
      return res.status(400).json({ error: `Cannot push order in status '${order.status}'` });
    }
    const result = await pushOrderToOptimo(req.params.id);
    if (!result.success) return res.status(500).json({ error: result.error });
    db.prepare(
      "UPDATE orders SET optimoroute_id = ?, status = 'dispatched', updated = datetime('now') WHERE id = ?"
    ).run(result.optimoroute_id, req.params.id);
    res.json({ success: true, optimoroute_id: result.optimoroute_id });
  });

  // Mark a specific line on an order as delivered (or partially delivered).
  // Body: { delivered_qty?: number, mark_complete?: boolean }
  // If delivered_qty is omitted, defaults to the line's full ordered qty.
  // If mark_complete is true, line.status becomes 'delivered' even if delivered_qty < qty.
  router.post("/orders/:id/lines/:lineId/deliver", (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (["delivered", "invoiced", "paid", "cancelled"].includes(order.status)) {
      return res.status(400).json({ error: `Cannot mark line on order in status '${order.status}'` });
    }
    const { delivered_qty, mark_complete } = req.body || {};
    const result = markOrderLineDelivered(req.params.id, req.params.lineId, delivered_qty, mark_complete);
    if (result.error) return res.status(404).json({ error: result.error });
    // Try to auto-transition the order if all lines are now complete
    const transitioned = tryAutoTransitionToDelivered(req.params.id);
    res.json({ success: true, line: result, order_transitioned: transitioned });
  });

  // Cancel a single line (without affecting other lines)
  router.post("/orders/:id/lines/:lineId/cancel", (req, res) => {
    const line = db.prepare("SELECT * FROM order_lines WHERE id = ? AND order_id = ?").get(req.params.lineId, req.params.id);
    if (!line) return res.status(404).json({ error: "Line not found" });
    db.prepare("UPDATE order_lines SET status = 'cancelled' WHERE id = ?").run(req.params.lineId);
    const transitioned = tryAutoTransitionToDelivered(req.params.id);
    res.json({ success: true, order_transitioned: transitioned });
  });

  // 3.0.10: MANUAL COMPLETION (Optimo failsafe).
  // When OptimoRoute is down or the driver forgot to mark POD on the mobile app, the
  // dispatcher can manually record per-line outcomes through this endpoint:
  //
  //   action="delivered"      → line marked delivered, creates a 'delivery' transaction,
  //                             contributes to the order invoice (delivered_qty = qty).
  //   action="returned"       → line marked returned, creates a 'return' transaction
  //                             (customer's on-hand decreases). Does NOT contribute to the
  //                             order invoice (delivered_qty stays 0).
  //   action="returned_other" → line marked return_other, creates a 'return_other'
  //                             transaction with the foreign_owner field set. NO impact
  //                             on on-hand (it's not our cylinder), NO impact on invoice.
  //                             Used for traceability when the driver picks up a competitor's
  //                             cylinder (BOC, Coregas, etc.) on the same trip.
  //
  // After updating the line, the order auto-transitions if all lines are now in a terminal
  // state (delivered/returned/return_other/cancelled) — moves to delivered → invoiced
  // → maybe paid via tryAutoTransitionToDelivered.
  router.post("/orders/:id/lines/:lineId/manual-completion", (req, res) => {
    try {
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      // Same lock as the existing /deliver endpoint: only allowed while order is in
      // a pre-completion state. If it's already delivered/invoiced/paid, refuse.
      if (["delivered", "invoiced", "paid", "cancelled"].includes(order.status)) {
        return res.status(400).json({ error: `Cannot manually complete a line on an order in status '${order.status}'` });
      }

      const line = db.prepare(
        `SELECT ol.*, ct.label as cylinder_label, ct.item_type
         FROM order_lines ol
         LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
         WHERE ol.id = ? AND ol.order_id = ?`
      ).get(req.params.lineId, req.params.id);
      if (!line) return res.status(404).json({ error: "Line not found" });
      if (line.status === "cancelled") return res.status(400).json({ error: "Line already cancelled" });
      // 3.0.12: failsafe is for SALE-type items only. Cylinder lines have their own delivery flow.
      if (line.item_type !== "sale") {
        return res.status(400).json({ error: "Manual completion failsafe is only available for sale-type items" });
      }

      const { action, qty, foreign_owner, notes } = req.body || {};
      const validActions = ["delivered", "returned", "returned_other"];
      if (!validActions.includes(action)) {
        return res.status(400).json({ error: `Invalid action '${action}'. Must be one of: ${validActions.join(", ")}` });
      }
      const actionQty = parseFloat(qty);
      if (!(actionQty > 0)) return res.status(400).json({ error: "qty must be a positive number" });
      if (action === "returned_other" && !(foreign_owner || "").trim()) {
        return res.status(400).json({ error: "foreign_owner is required for returned_other" });
      }

      const customer = db.prepare("SELECT rental_frequency, customer_category FROM customers WHERE id = ?").get(order.customer_id);
      const baseNote = `Manual ${action} via failsafe — ORD ${order.order_number}` +
        (notes ? ` | ${notes}` : "");

      const tx = db.transaction(() => {
        // Branch by action
        if (action === "delivered") {
          // Create a delivery transaction (only for cylinder lines — sale lines never get tx)
          if (line.item_type === "cylinder") {
            const freq = customer?.rental_frequency || "monthly";
            const prepaidUntil = addFrequency(order.order_date, freq);
            db.prepare(
              `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, prepaid_until, order_line_id)
               VALUES (?, ?, ?, 'delivery', ?, ?, ?, 'manual', '', ?, ?)`
            ).run(
              uid(), order.customer_id, line.cylinder_type_id, actionQty, order.order_date,
              `${baseNote} | Del:${actionQty}${prepaidUntil ? ` (first cycle prepaid until ${prepaidUntil})` : ""}`,
              prepaidUntil, line.id
            );
          } else if (line.item_type === "sale") {
            // 3.0.18: sale-line manual delivery — process linked rental overflow.
            processLinkedRentalOnDelivery(order, customer, line, actionQty);
          }
          // Update line: mark as delivered with the qty actually delivered
          db.prepare(
            "UPDATE order_lines SET delivered_qty = ?, status = 'delivered' WHERE id = ?"
          ).run(actionQty, line.id);
        } else if (action === "returned") {
          // Create a return transaction (only meaningful for cylinder lines)
          if (line.item_type === "cylinder") {
            db.prepare(
              `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, order_line_id)
               VALUES (?, ?, ?, 'return', ?, ?, ?, 'manual', '', ?)`
            ).run(
              uid(), order.customer_id, line.cylinder_type_id, actionQty, order.order_date,
              `${baseNote} | Ret:${actionQty}`, line.id
            );
          }
          // Mark line as returned. delivered_qty stays 0 so the line contributes nothing
          // to the order invoice (we never delivered anything for this line).
          db.prepare(
            "UPDATE order_lines SET delivered_qty = 0, status = 'returned' WHERE id = ?"
          ).run(line.id);
        } else if (action === "returned_other") {
          // Create a return_other transaction with foreign_owner. Does NOT affect on-hand
          // because the existing on-hand SQL only sums (delivery - return). It does NOT
          // affect the order invoice. It's a pure traceability record.
          db.prepare(
            `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, order_line_id, foreign_owner)
             VALUES (?, ?, ?, 'return_other', ?, ?, ?, 'manual', '', ?, ?)`
          ).run(
            uid(), order.customer_id, line.cylinder_type_id, actionQty, order.order_date,
            `${baseNote} | Roth:${actionQty} from ${foreign_owner}`,
            line.id, foreign_owner.trim()
          );
          db.prepare(
            "UPDATE order_lines SET delivered_qty = 0, status = 'return_other' WHERE id = ?"
          ).run(line.id);
        }
      });
      tx();

      // Try to auto-transition the order if all lines are now complete
      const transitioned = tryAutoTransitionToDelivered(req.params.id);
      const refreshed = db.prepare("SELECT status FROM orders WHERE id = ?").get(req.params.id);

      res.json({
        success: true,
        action,
        line_id: line.id,
        order_status: refreshed.status,
        order_transitioned: transitioned,
      });
    } catch (err) {
      console.error("[POST /orders/:id/lines/:lineId/manual-completion] EXCEPTION:", err);
      console.error("[manual-completion] Stack:", err.stack);
      console.error("[manual-completion] Body:", JSON.stringify(req.body, null, 2));
      return res.status(500).json({
        error: err.message || "Internal server error during manual completion",
        details: err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : null,
      });
    }
  });

  // 3.0.12: BATCH manual completion. Frontend collects per-line Del/Ret/Roth quantities
  // into a single grid and submits them all at once. Atomic — either every line goes
  // through or none do (single db.transaction). Sale lines only.
  router.post("/orders/:id/manual-completion-batch", (req, res) => {
    try {
      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (["delivered", "invoiced", "paid", "cancelled"].includes(order.status)) {
        return res.status(400).json({ error: `Cannot manually complete lines on an order in status '${order.status}'` });
      }

      const { completions, notes } = req.body || {};
      if (!Array.isArray(completions) || completions.length === 0) {
        return res.status(400).json({ error: "completions array is required and must not be empty" });
      }

      // Validate every entry first so we don't half-commit
      const validActions = new Set(["delivered", "returned", "returned_other"]);
      const errors = [];
      const resolved = [];
      for (const c of completions) {
        const lineId = c.line_id;
        const action = c.action;
        const qty = parseFloat(c.qty);
        const fo = (c.foreign_owner || "").trim();
        if (!lineId) { errors.push("missing line_id"); continue; }
        if (!validActions.has(action)) { errors.push(`invalid action '${action}' for line ${lineId}`); continue; }
        if (!(qty > 0)) { errors.push(`qty must be positive for line ${lineId}`); continue; }
        if (action === "returned_other" && !fo) {
          errors.push(`foreign_owner is required for returned_other (line ${lineId})`);
          continue;
        }
        const line = db.prepare(
          `SELECT ol.*, ct.label as cylinder_label, ct.item_type
           FROM order_lines ol
           LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
           WHERE ol.id = ? AND ol.order_id = ?`
        ).get(lineId, req.params.id);
        if (!line) { errors.push(`line not found: ${lineId}`); continue; }
        if (line.status === "cancelled") { errors.push(`line already cancelled: ${line.cylinder_label || lineId}`); continue; }
        if (["delivered", "returned", "return_other"].includes(line.status)) {
          errors.push(`line already completed: ${line.cylinder_label || lineId} (${line.status})`);
          continue;
        }
        // 3.0.12: failsafe is for SALE-type items only. Cylinder lines have their own flow.
        if (line.item_type !== "sale") {
          errors.push(`line ${line.cylinder_label || lineId}: only sale items can be manually completed via the failsafe`);
          continue;
        }
        resolved.push({ line, action, qty, foreign_owner: fo });
      }
      if (errors.length > 0) {
        return res.status(400).json({ error: errors.join("; ") });
      }

      const customer = db.prepare("SELECT rental_frequency, customer_category FROM customers WHERE id = ?").get(order.customer_id);
      const baseNotePrefix = `Manual batch completion via failsafe — ORD ${order.order_number}` +
        (notes ? ` | ${notes}` : "");

      // 3.0.16: Group completions by line so we can write multiple transactions per line
      // (e.g. Del 4 + Ret 1 on the same line = swap-out delivery) and set the line's final
      // status correctly. Without this, two completions on the same line would each call
      // UPDATE order_lines and the second would clobber the first's status.
      const byLine = new Map();
      for (const r of resolved) {
        if (!byLine.has(r.line.id)) byLine.set(r.line.id, []);
        byLine.get(r.line.id).push(r);
      }

      const tx = db.transaction(() => {
        for (const [lineId, lineCompletions] of byLine) {
          const line = lineCompletions[0].line;
          const baseNote = `${baseNotePrefix} | ${line.cylinder_label || line.cylinder_type_id}`;

          let totalDelivered = 0; // sum of delivered qty across this line's actions
          let hadDelivery = false;
          let hadReturn = false;
          let hadReturnOther = false;

          // Write one transaction per completion entry
          for (const r of lineCompletions) {
            const { action, qty, foreign_owner } = r;
            if (action === "delivered") {
              hadDelivery = true;
              totalDelivered += qty;
              db.prepare(
                `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, order_line_id)
                 VALUES (?, ?, ?, 'delivery', ?, ?, ?, 'manual', '', ?)`
              ).run(
                uid(), order.customer_id, line.cylinder_type_id, qty, order.order_date,
                `${baseNote} | Del:${qty}`, line.id
              );
            } else if (action === "returned") {
              hadReturn = true;
              db.prepare(
                `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, order_line_id)
                 VALUES (?, ?, ?, 'return', ?, ?, ?, 'manual', '', ?)`
              ).run(
                uid(), order.customer_id, line.cylinder_type_id, qty, order.order_date,
                `${baseNote} | Ret:${qty}`, line.id
              );
            } else if (action === "returned_other") {
              hadReturnOther = true;
              db.prepare(
                `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, order_line_id, foreign_owner)
                 VALUES (?, ?, ?, 'return_other', ?, ?, ?, 'manual', '', ?, ?)`
              ).run(
                uid(), order.customer_id, line.cylinder_type_id, qty, order.order_date,
                `${baseNote} | Roth:${qty} from ${foreign_owner}`,
                line.id, foreign_owner
              );
            }
          }

          // Final line status: prefer delivered if anything was actually delivered, else
          // pick whichever return type was used. delivered_qty reflects what was billed.
          let finalStatus, finalDeliveredQty;
          if (hadDelivery) {
            finalStatus = "delivered";
            finalDeliveredQty = totalDelivered;
          } else if (hadReturn) {
            finalStatus = "returned";
            finalDeliveredQty = 0;
          } else {
            finalStatus = "return_other";
            finalDeliveredQty = 0;
          }
          db.prepare(
            "UPDATE order_lines SET delivered_qty = ?, status = ? WHERE id = ?"
          ).run(finalDeliveredQty, finalStatus, line.id);

          // 3.0.18: process linked rental for sale-type lines that ended in delivered.
          // Net delivered (totalDelivered) is what physically went out; any 'returned' actions
          // on the same line are already in transactions and will reduce on-hand naturally,
          // so processLinkedRentalOnDelivery's getOnHand call will see the right number.
          if (line.item_type === "sale" && hadDelivery && totalDelivered > 0) {
            processLinkedRentalOnDelivery(order, customer, line, totalDelivered);
          }
        }

        // 3.0.17: After completing all sale lines via the failsafe, auto-flip every
        // cylinder rental line on the same order to 'delivered'. The rental charge line
        // is paperwork that gets bundled with the physical delivery — there's nothing to
        // physically deliver for a rental fee, so it follows the sale line's fate.
        // Without this, the order would never satisfy allLinesComplete() because the
        // rental lines stay 'open' forever.
        const rentalLines = db.prepare(
          `SELECT ol.id, ol.qty, ol.status
           FROM order_lines ol
           LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
           WHERE ol.order_id = ? AND ct.item_type = 'cylinder' AND ol.status = 'open'`
        ).all(req.params.id);
        for (const rl of rentalLines) {
          db.prepare(
            "UPDATE order_lines SET delivered_qty = ?, status = 'delivered' WHERE id = ?"
          ).run(rl.qty, rl.id);
        }
      });
      tx();

      // Try to auto-transition the order if all lines are now complete
      const transitioned = tryAutoTransitionToDelivered(req.params.id);
      const refreshed = db.prepare("SELECT status FROM orders WHERE id = ?").get(req.params.id);

      res.json({
        success: true,
        completed: resolved.length,
        order_status: refreshed.status,
        order_transitioned: transitioned,
      });
    } catch (err) {
      console.error("[POST /orders/:id/manual-completion-batch] EXCEPTION:", err);
      console.error("[manual-completion-batch] Stack:", err.stack);
      console.error("[manual-completion-batch] Body:", JSON.stringify(req.body, null, 2));
      return res.status(500).json({
        error: err.message || "Internal server error during batch manual completion",
        details: err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : null,
      });
    }
  });

  // Settings endpoints (admin only)
  // ── DEBUG ENDPOINT (issue investigation) ──
  // GET /debug/order/:id returns the full state of an order, its lines, its invoice,
  // all payments on that invoice, and the customer's current balance. Hit it from a
  // browser to dump the state into JSON for diagnosis.
  router.get("/debug/order/:id", (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const lines = db.prepare(
      `SELECT ol.*, ct.item_type, ct.label as cylinder_label
       FROM order_lines ol
       LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
       WHERE ol.order_id = ?
       ORDER BY ol.sort_order, ol.id`
    ).all(order.id);
    const invoice = order.invoice_id
      ? db.prepare("SELECT * FROM invoices WHERE id = ?").get(order.invoice_id)
      : null;
    const payments = order.invoice_id
      ? db.prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY date, id").all(order.invoice_id)
      : [];
    const customer = db.prepare("SELECT id, name, balance, credit_balance, customer_category FROM customers WHERE id = ?").get(order.customer_id);
    // Also pull ALL invoices for this customer for the duplicate-invoice check
    const allCustomerInvoices = db.prepare(
      "SELECT id, invoice_number, order_id, total, amount_paid, status FROM invoices WHERE customer_id = ?"
    ).all(order.customer_id);
    // Sum what recalculateCustomerBalance would compute
    const balanceCheck = db.prepare(`
      SELECT COALESCE(SUM(total - amount_paid), 0) as owed
      FROM invoices
      WHERE customer_id = ? AND status NOT IN ('void', 'pending')
    `).get(order.customer_id);
    res.json({
      order,
      lines,
      invoice,
      payments,
      customer,
      all_customer_invoices: allCustomerInvoices,
      balance_check: {
        formula: "SUM(total - amount_paid) WHERE status NOT IN ('void', 'pending')",
        result: balanceCheck.owed,
        stored_on_customer: customer?.balance,
        match: Math.abs((balanceCheck.owed || 0) - (customer?.balance || 0)) < 0.01,
      },
    });
  });

  router.get("/admin/settings/round3", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    res.json({
      auto_push_enabled: getSetting(db, "auto_push_enabled", "1") === "1",
      auto_close_days: parseInt(getSetting(db, "auto_close_days", "14"), 10),
    });
  });

  router.put("/admin/settings/round3", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const { auto_push_enabled, auto_close_days } = req.body || {};
    const before = {
      auto_push_enabled: getSetting(db, "auto_push_enabled", "1"),
      auto_close_days: getSetting(db, "auto_close_days", "14"),
    };
    if (auto_push_enabled !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_push_enabled', ?)").run(auto_push_enabled ? "1" : "0");
    }
    if (auto_close_days !== undefined) {
      const n = parseInt(auto_close_days, 10);
      if (n > 0 && n <= 365) {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_close_days', ?)").run(String(n));
      }
    }
    const after = {
      auto_push_enabled: getSetting(db, "auto_push_enabled", "1"),
      auto_close_days: getSetting(db, "auto_close_days", "14"),
    };
    logAudit(db, req, {
      action: "update",
      table: "settings",
      record_id: "round3",
      before,
      after,
      summary: `Round 3 settings: auto_push=${after.auto_push_enabled}, auto_close_days=${after.auto_close_days}`,
    });
    res.json({
      success: true,
      auto_push_enabled: getSetting(db, "auto_push_enabled", "1") === "1",
      auto_close_days: parseInt(getSetting(db, "auto_close_days", "14"), 10),
    });
  });

  // ============================================================
  // ROUND 3 DEBUG ENDPOINTS (3.0.2)
  // For investigating customer/order/invoice/payment issues without SQL access.
  // Returns raw rows from the database. Admin only.
  // ============================================================

  // List all customers with non-zero balance, sorted by balance desc
  router.get("/admin/debug/customers-with-balance", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const rows = db.prepare(
      `SELECT id, name, contact, address, customer_category, balance, credit_balance
       FROM customers
       WHERE balance != 0 OR credit_balance != 0
       ORDER BY balance DESC`
    ).all();
    res.json({ count: rows.length, customers: rows });
  });

  // Full snapshot of one customer: customer record + all orders + all order_lines +
  // all invoices + all payments. Use this to investigate balance discrepancies.
  router.get("/admin/debug/customer-snapshot/:id", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    // Strip the encrypted CC blob for safety
    delete customer.cc_encrypted;

    const orders = db.prepare(
      `SELECT id, order_number, order_date, total_price, payment_amount, paid, status, collection,
              optimoroute_id, invoice_id, created, updated
       FROM orders WHERE customer_id = ?
       ORDER BY created`
    ).all(req.params.id);

    // Pull all order_lines for this customer's orders
    const orderIds = orders.map(o => o.id);
    let orderLines = [];
    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => "?").join(",");
      orderLines = db.prepare(
        `SELECT ol.*, ct.label as cylinder_label, ct.item_type
         FROM order_lines ol
         LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
         WHERE ol.order_id IN (${placeholders})
         ORDER BY ol.order_id, ol.sort_order`
      ).all(...orderIds);
    }

    const invoices = db.prepare(
      `SELECT id, invoice_number, order_id, po_number, total, amount_paid, status, invoice_date, created, updated
       FROM invoices WHERE customer_id = ?
       ORDER BY created`
    ).all(req.params.id);

    const payments = db.prepare(
      `SELECT id, invoice_id, credit_id, amount, method, reference, date, notes, created
       FROM payments WHERE customer_id = ?
       ORDER BY created`
    ).all(req.params.id);

    const transactions = db.prepare(
      `SELECT t.id, t.cylinder_type, ct.label as cylinder_label, t.type, t.qty, t.date, t.notes, t.source,
              t.optimoroute_order, t.prepaid_until, t.order_line_id, t.created
       FROM transactions t
       LEFT JOIN cylinder_types ct ON ct.id = t.cylinder_type
       WHERE t.customer_id = ?
       ORDER BY t.date, t.created`
    ).all(req.params.id);

    const creditNotes = db.prepare(
      `SELECT id, credit_number, total, remaining_amount, status, reason, created
       FROM credit_notes WHERE customer_id = ?
       ORDER BY created`
    ).all(req.params.id);

    // Recalculate what balance SHOULD be based on the data, so we can compare
    // to the stored balance
    const calculatedBalance =
      invoices
        .filter(i => i.status !== "void" && i.status !== "pending")
        .reduce((s, i) => s + ((i.total || 0) - (i.amount_paid || 0)), 0);
    const calculatedCredit =
      creditNotes
        .filter(c => c.status === "approved")
        .reduce((s, c) => s + (c.remaining_amount || 0), 0);

    res.json({
      customer,
      stored_balance: customer.balance,
      stored_credit_balance: customer.credit_balance,
      calculated_balance: Math.round(calculatedBalance * 100) / 100,
      calculated_credit_balance: Math.round(calculatedCredit * 100) / 100,
      balance_matches: Math.abs((customer.balance || 0) - calculatedBalance) < 0.01,
      orders,
      order_lines: orderLines,
      invoices,
      payments,
      transactions,
      credit_notes: creditNotes,
    });
  });

  // Force-recalculate a customer's balance from current data. Use after fixing bad data.
  router.post("/admin/debug/recalc-balance/:id", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const customer = db.prepare("SELECT id FROM customers WHERE id = ?").get(req.params.id);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    const result = recalculateCustomerBalance(db, req.params.id);
    res.json({ success: true, ...result });
  });

  // Force-recalculate ALL customer balances. Use to clean up after data fixes.
  router.post("/admin/debug/recalc-all-balances", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const customers = db.prepare("SELECT id FROM customers").all();
    let count = 0;
    for (const c of customers) {
      try { recalculateCustomerBalance(db, c.id); count++; } catch (e) { /* tolerate */ }
    }
    res.json({ success: true, recalculated: count });
  });

  // Find and report orphan/broken rows that need cleanup
  router.get("/admin/debug/orphans", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const ordersWithoutNumber = db.prepare(
      "SELECT id, customer_id, order_date, total_price, status, created FROM orders WHERE order_number IS NULL OR order_number = ''"
    ).all();
    const ordersWithLegacyStatus = db.prepare(
      "SELECT id, order_number, status FROM orders WHERE status IN ('confirmed', 'fulfilled', 'completed')"
    ).all();
    const invoicesWithoutCustomer = db.prepare(
      "SELECT id, invoice_number, total FROM invoices WHERE customer_id IS NULL OR customer_id = ''"
    ).all();
    const invoicesWithBadOrderRef = db.prepare(
      `SELECT i.id, i.invoice_number, i.order_id, i.total
       FROM invoices i
       WHERE i.order_id != '' AND i.order_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = i.order_id)`
    ).all();
    res.json({
      orders_without_number: { count: ordersWithoutNumber.length, rows: ordersWithoutNumber },
      orders_with_legacy_status: { count: ordersWithLegacyStatus.length, rows: ordersWithLegacyStatus },
      invoices_without_customer: { count: invoicesWithoutCustomer.length, rows: invoicesWithoutCustomer },
      invoices_with_dangling_order_ref: { count: invoicesWithBadOrderRef.length, rows: invoicesWithBadOrderRef },
    });
  });

  // ============================================================
  // 3.0.4 INVOICE INTEGRITY: inspect and repair customers whose orders.invoice_id
  // points at non-existent invoices (orphan IDs).
  // ============================================================

  // INSPECT (read-only): for one customer, report orders/payments with orphan invoice_ids,
  // and propose what they SHOULD be repointed to based on content matching.
  router.get("/admin/debug/customer-invoice-integrity/:id", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const customerId = req.params.id;
    const customer = db.prepare("SELECT id, name, balance FROM customers WHERE id = ?").get(customerId);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const orders = db.prepare("SELECT id, order_number, total_price, paid, status, invoice_id, order_date FROM orders WHERE customer_id = ? ORDER BY order_date").all(customerId);
    const invoices = db.prepare("SELECT id, invoice_number, order_id, total, amount_paid, status, invoice_date FROM invoices WHERE customer_id = ? ORDER BY invoice_date").all(customerId);
    const payments = db.prepare("SELECT id, invoice_id, amount, method, date, notes FROM payments WHERE customer_id = ? ORDER BY date").all(customerId);

    const invoiceById = {};
    for (const i of invoices) invoiceById[i.id] = i;

    // Track which invoices are already claimed by an order so we don't double-assign
    const claimedInvoiceIds = new Set();
    const orderIssues = [];
    for (const o of orders) {
      const linkedInv = o.invoice_id ? invoiceById[o.invoice_id] : null;
      if (o.invoice_id && !linkedInv) {
        // Orphan: try to find the best match by total + customer + not-yet-claimed
        const candidate = invoices.find(i =>
          !claimedInvoiceIds.has(i.id)
          && i.order_id === o.id // primary: invoice already references this order
        ) || invoices.find(i =>
          !claimedInvoiceIds.has(i.id)
          && Math.abs((i.total || 0) - (o.total_price || 0)) < 0.01 // secondary: total matches
        );
        orderIssues.push({
          order_id: o.id,
          order_number: o.order_number,
          total_price: o.total_price,
          status: o.status,
          current_invoice_id: o.invoice_id,
          linked_invoice_exists: false,
          proposed_invoice_id: candidate?.id || null,
          proposed_invoice_number: candidate?.invoice_number || null,
          match_basis: candidate ? (candidate.order_id === o.id ? "invoice.order_id matches" : "total matches") : "no candidate",
        });
        if (candidate) claimedInvoiceIds.add(candidate.id);
      } else if (linkedInv) {
        claimedInvoiceIds.add(linkedInv.id);
      }
    }

    const orphanPayments = [];
    for (const p of payments) {
      if (p.invoice_id && !invoiceById[p.invoice_id]) {
        // Try to find via orderIssues mapping
        const fromIssue = orderIssues.find(i => i.current_invoice_id === p.invoice_id);
        orphanPayments.push({
          payment_id: p.id,
          amount: p.amount,
          date: p.date,
          notes: p.notes,
          current_invoice_id: p.invoice_id,
          proposed_invoice_id: fromIssue?.proposed_invoice_id || null,
        });
      }
    }

    // Calculate what the balance SHOULD be vs stored
    const calculatedBalance = invoices
      .filter(i => i.status !== "void" && i.status !== "pending")
      .reduce((s, i) => s + ((i.total || 0) - (i.amount_paid || 0)), 0);

    res.json({
      customer,
      stored_balance: customer.balance,
      calculated_balance: Math.round(calculatedBalance * 100) / 100,
      balance_matches: Math.abs((customer.balance || 0) - calculatedBalance) < 0.01,
      orders_total: orders.length,
      invoices_total: invoices.length,
      payments_total: payments.length,
      orders_with_orphan_invoice_id: orderIssues.length,
      payments_with_orphan_invoice_id: orphanPayments.length,
      order_issues: orderIssues,
      orphan_payments: orphanPayments,
    });
  });

  // REPAIR (writes): apply the proposed re-pointings from the integrity check above.
  // Idempotent — if there are no orphans, does nothing.
  router.post("/admin/debug/repair-customer-invoices/:id", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const customerId = req.params.id;
    const customer = db.prepare("SELECT id, name FROM customers WHERE id = ?").get(customerId);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const changes = [];
    const tx = db.transaction(() => {
      const orders = db.prepare("SELECT id, order_number, total_price, invoice_id FROM orders WHERE customer_id = ? ORDER BY order_date").all(customerId);
      const invoices = db.prepare("SELECT id, invoice_number, order_id, total FROM invoices WHERE customer_id = ? ORDER BY invoice_date").all(customerId);
      const invoiceById = {};
      for (const i of invoices) invoiceById[i.id] = i;
      const claimedInvoiceIds = new Set();

      // First pass: claim invoices already correctly linked
      for (const o of orders) {
        if (o.invoice_id && invoiceById[o.invoice_id]) {
          claimedInvoiceIds.add(o.invoice_id);
        }
      }

      // Second pass: re-point orphans
      for (const o of orders) {
        if (!o.invoice_id) continue;
        if (invoiceById[o.invoice_id]) continue; // already valid

        // Find best candidate
        const candidate = invoices.find(i =>
          !claimedInvoiceIds.has(i.id) && i.order_id === o.id
        ) || invoices.find(i =>
          !claimedInvoiceIds.has(i.id) && Math.abs((i.total || 0) - (o.total_price || 0)) < 0.01
        );
        if (!candidate) {
          changes.push({ type: "order_orphan_no_match", order_id: o.id, order_number: o.order_number, original_invoice_id: o.invoice_id });
          continue;
        }

        // Update order's invoice_id
        db.prepare("UPDATE orders SET invoice_id = ? WHERE id = ?").run(candidate.id, o.id);
        // Update payments that referenced the old orphan id
        const paymentUpdate = db.prepare("UPDATE payments SET invoice_id = ? WHERE customer_id = ? AND invoice_id = ?").run(candidate.id, customerId, o.invoice_id);
        // Update the invoice's order_id to confirm the link
        db.prepare("UPDATE invoices SET order_id = ? WHERE id = ?").run(o.id, candidate.id);

        claimedInvoiceIds.add(candidate.id);
        changes.push({
          type: "repointed",
          order_id: o.id,
          order_number: o.order_number,
          old_invoice_id: o.invoice_id,
          new_invoice_id: candidate.id,
          new_invoice_number: candidate.invoice_number,
          payments_updated: paymentUpdate.changes,
        });
      }

      // Recalculate balance
      recalculateCustomerBalance(db, customerId);
    });
    try {
      tx();
      const newBalance = db.prepare("SELECT balance FROM customers WHERE id = ?").get(customerId);
      res.json({ success: true, customer_id: customerId, changes, new_balance: newBalance.balance });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Run integrity check across ALL customers and report counts
  router.get("/admin/debug/integrity-scan-all", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const customers = db.prepare("SELECT id, name FROM customers").all();
    const affected = [];
    for (const c of customers) {
      const orders = db.prepare("SELECT id, invoice_id FROM orders WHERE customer_id = ?").all(c.id);
      let orphans = 0;
      for (const o of orders) {
        if (!o.invoice_id) continue;
        const inv = db.prepare("SELECT id FROM invoices WHERE id = ?").get(o.invoice_id);
        if (!inv) orphans++;
      }
      if (orphans > 0) affected.push({ customer_id: c.id, name: c.name, orphan_orders: orphans });
    }
    res.json({ total_customers_with_orphans: affected.length, affected });
  });

  // ============================================================
  // EMAIL — server-side invoice delivery via Resend
  // ============================================================

  // Helper: load an invoice + its lines + customer in the shape email.js expects.
  // Pulls cylinder breakdown from rental_invoice transactions on the same date.
  function buildInvoiceForEmail(invoiceId) {
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
    if (!inv) return null;
    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(inv.customer_id);
    if (!customer) return null;

    // Try to reconstruct line items.
    // For order-linked invoices: derive from order_lines
    // For rental invoices: derive from rental_invoice transactions on invoice_date
    let lines = [];
    if (inv.order_id) {
      const orderLines = db.prepare(
        `SELECT ol.*, ct.label as cylinder_label
         FROM order_lines ol
         LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
         WHERE ol.order_id = ?
         ORDER BY ol.sort_order, ol.id`
      ).all(inv.order_id);
      for (const ol of orderLines) {
        lines.push({
          cylinder_label: ol.cylinder_label || "Item",
          qty: ol.qty,
          on_hand: ol.qty,
          unit_price: ol.unit_price || 0,
          line_total: ol.line_total || 0,
        });
      }
    } else {
      // Rental invoice: pull all rental_invoice transactions for this customer on this date
      const txns = db.prepare(`
        SELECT t.cylinder_type, t.qty, ct.label, ct.default_price
        FROM transactions t
        JOIN cylinder_types ct ON ct.id = t.cylinder_type
        WHERE t.customer_id = ? AND t.type = 'rental_invoice' AND t.date = ?
      `).all(inv.customer_id, inv.invoice_date);
      for (const t of txns) {
        const unitPrice = getPriceForDate(db, inv.customer_id, t.cylinder_type, inv.invoice_date, t.default_price || 0);
        lines.push({
          cylinder_label: t.label,
          qty: t.qty,
          on_hand: t.qty,
          unit_price: unitPrice,
          line_total: Math.round(unitPrice * t.qty * 100) / 100,
        });
      }
    }

    const subtotal = inv.total || 0;
    const gst = Math.round(subtotal * 0.10 * 100) / 100;
    const grandTotal = Math.round((subtotal + gst) * 100) / 100;

    return {
      invoice: {
        ...inv,
        lines,
        subtotal,
        gst,
        grandTotal,
      },
      customer,
    };
  }

  // GET email config — frontend uses this to know whether to show backend Email
  // buttons or fall back to mailto.
  router.get("/email/config", (req, res) => {
    const cfg = emailModule.getConfig();
    res.json({
      enabled: cfg.enabled,
      from_address: cfg.testMode ? "onboarding@resend.dev" : cfg.fromAddr,
      from_name: cfg.fromName,
      test_mode: cfg.testMode,
    });
  });

  // POST send a single invoice via email.
  // Body: { recipient_override?: "x@y.com" } — defaults to customer's accounts_email or email.
  router.post("/invoices/:id/email", async (req, res) => {
    const { recipient_override } = req.body || {};

    if (!emailModule.isEmailEnabled()) {
      return res.status(503).json({ error: "Email is not configured (RESEND_API_KEY missing)" });
    }

    const built = buildInvoiceForEmail(req.params.id);
    if (!built) return res.status(404).json({ error: "Invoice not found" });
    const { invoice, customer } = built;

    const recipient = (recipient_override || customer.accounts_email || customer.email || "").trim();
    if (!recipient) {
      // Log the failure for visibility
      db.prepare(
        "INSERT INTO email_log (invoice_id, invoice_number, customer_id, customer_name, recipient, subject, status, error, attempted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        invoice.id, invoice.invoice_number, customer.id, customer.name || "",
        "", "", "skipped", "No email on customer record", req.user?.username || ""
      );
      return res.status(400).json({ error: "No email address on customer record" });
    }

    const subject = `Rental Invoice ${invoice.invoice_number} — ${invoice.invoice_date}`;
    const text = emailModule.buildInvoiceText(invoice, customer);

    let pdfBuffer = null;
    try {
      pdfBuffer = await emailModule.generateInvoicePdf(invoice, customer);
    } catch (err) {
      db.prepare(
        "INSERT INTO email_log (invoice_id, invoice_number, customer_id, customer_name, recipient, subject, status, error, attempted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        invoice.id, invoice.invoice_number, customer.id, customer.name || "",
        recipient, subject, "error", `PDF generation failed: ${err.message}`, req.user?.username || ""
      );
      return res.status(500).json({ error: `PDF generation failed: ${err.message}` });
    }

    const result = await emailModule.sendViaResend({
      to: recipient,
      subject,
      text,
      attachments: [{
        filename: `invoice-${invoice.invoice_number || invoice.id}.pdf`,
        content: pdfBuffer,
      }],
    });

    db.prepare(
      "INSERT INTO email_log (invoice_id, invoice_number, customer_id, customer_name, recipient, subject, status, provider_message_id, error, attempted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      invoice.id, invoice.invoice_number, customer.id, customer.name || "",
      recipient, subject,
      result.success ? "sent" : "error",
      result.message_id || "",
      result.error || "",
      req.user?.username || ""
    );

    if (!result.success) return res.status(500).json({ error: result.error });
    res.json({ success: true, message_id: result.message_id, recipient });
  });

  // POST bulk send: { invoice_ids: [...] }
  router.post("/invoices/email-bulk", async (req, res) => {
    if (!emailModule.isEmailEnabled()) {
      return res.status(503).json({ error: "Email is not configured (RESEND_API_KEY missing)" });
    }
    const ids = Array.isArray(req.body?.invoice_ids) ? req.body.invoice_ids : [];
    if (ids.length === 0) return res.status(400).json({ error: "invoice_ids array required" });

    const results = { sent: 0, skipped: 0, errors: 0, details: [] };

    for (const id of ids) {
      const built = buildInvoiceForEmail(id);
      if (!built) {
        results.errors++;
        results.details.push({ invoice_id: id, status: "error", error: "Invoice not found" });
        continue;
      }
      const { invoice, customer } = built;
      const recipient = (customer.accounts_email || customer.email || "").trim();

      if (!recipient) {
        results.skipped++;
        db.prepare(
          "INSERT INTO email_log (invoice_id, invoice_number, customer_id, customer_name, recipient, subject, status, error, attempted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          invoice.id, invoice.invoice_number, customer.id, customer.name || "",
          "", "", "skipped", "No email on customer record", req.user?.username || ""
        );
        results.details.push({ invoice_id: id, status: "skipped", reason: "No email on record", customer: customer.name });
        continue;
      }

      const subject = `Rental Invoice ${invoice.invoice_number} — ${invoice.invoice_date}`;
      const text = emailModule.buildInvoiceText(invoice, customer);

      let pdfBuffer;
      try {
        pdfBuffer = await emailModule.generateInvoicePdf(invoice, customer);
      } catch (err) {
        results.errors++;
        db.prepare(
          "INSERT INTO email_log (invoice_id, invoice_number, customer_id, customer_name, recipient, subject, status, error, attempted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          invoice.id, invoice.invoice_number, customer.id, customer.name || "",
          recipient, subject, "error", `PDF: ${err.message}`, req.user?.username || ""
        );
        results.details.push({ invoice_id: id, status: "error", error: `PDF: ${err.message}` });
        continue;
      }

      const result = await emailModule.sendViaResend({
        to: recipient,
        subject,
        text,
        attachments: [{ filename: `invoice-${invoice.invoice_number || invoice.id}.pdf`, content: pdfBuffer }],
      });

      db.prepare(
        "INSERT INTO email_log (invoice_id, invoice_number, customer_id, customer_name, recipient, subject, status, provider_message_id, error, attempted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        invoice.id, invoice.invoice_number, customer.id, customer.name || "",
        recipient, subject,
        result.success ? "sent" : "error",
        result.message_id || "",
        result.error || "",
        req.user?.username || ""
      );

      if (result.success) {
        results.sent++;
        results.details.push({ invoice_id: id, status: "sent", recipient, message_id: result.message_id });
      } else {
        results.errors++;
        results.details.push({ invoice_id: id, status: "error", error: result.error });
      }

      // Tiny gap between sends so we don't slam the API
      await new Promise(r => setTimeout(r, 100));
    }

    res.json({ success: true, ...results });
  });

  // GET email log (admin)
  router.get("/admin/email-log", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const rows = db.prepare(
      "SELECT * FROM email_log ORDER BY id DESC LIMIT ?"
    ).all(limit);
    res.json(rows);
  });

  // ============================================================
  // CUSTOMER BALANCE
  // ============================================================
  router.get("/customers/:id/balance", (req, res) => {
    const bal = recalculateCustomerBalance(db, req.params.id);
    const openInvoices = db.prepare(
      "SELECT id, invoice_number, total, amount_paid, invoice_date FROM invoices WHERE customer_id = ? AND status = 'open' ORDER BY invoice_date ASC"
    ).all(req.params.id);
    const activeCredits = db.prepare(
      "SELECT id, credit_number, amount, remaining_amount, reason, created FROM credit_notes WHERE customer_id = ? AND status = 'approved' AND remaining_amount > 0 ORDER BY created ASC"
    ).all(req.params.id);
    res.json({ ...bal, open_invoices: openInvoices, active_credits: activeCredits });
  });

  // Recalculate all customer balances (reconciliation)
  router.post("/customers/recalculate-balances", (req, res) => {
    const all = db.prepare("SELECT id FROM customers").all();
    db.transaction(() => {
      for (const c of all) recalculateCustomerBalance(db, c.id);
    })();
    res.json({ success: true, recalculated: all.length });
  });

  // Match available credits to an open invoice (called from Orders screen)
  router.post("/orders/:id/match-credit", (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.invoice_id) return res.status(400).json({ error: "Order has no invoice" });

    const applied = db.transaction(() => {
      const amt = autoApplyCreditsToInvoice(db, order.customer_id, order.invoice_id);
      // If invoice now fully paid, mark order paid
      const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(order.invoice_id);
      if (inv && inv.status === "paid") {
        db.prepare("UPDATE orders SET paid = 1 WHERE id = ?").run(order.id);
      }
      recalculateCustomerBalance(db, order.customer_id);
      return amt;
    })();

    res.json({ success: true, amount_applied: applied });
  });

  // ============================================================
  // CREDIT NOTES
  // ============================================================
  router.get("/credits", (req, res) => {
    const { customer_id, status } = req.query;
    let sql = `SELECT cn.*, c.name as customer_name, c.account_number FROM credit_notes cn
               LEFT JOIN customers c ON c.id = cn.customer_id WHERE 1=1`;
    const params = [];
    if (customer_id) { sql += " AND cn.customer_id = ?"; params.push(customer_id); }
    if (status) { sql += " AND cn.status = ?"; params.push(status); }
    sql += " ORDER BY cn.created DESC";
    res.json(db.prepare(sql).all(...params));
  });

  router.post("/credits", (req, res) => {
    const { customer_id, amount, reason } = req.body;
    if (!customer_id) return res.status(400).json({ error: "Customer is required" });
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: "Amount must be > 0" });
    if (!reason?.trim()) return res.status(400).json({ error: "Reason is required" });

    const id = uid();
    const creditNumber = nextSequenceNumber(db, "credit");
    const createdBy = req.user?.username || req.user?.id || "";
    db.prepare(
      `INSERT INTO credit_notes (id, credit_number, customer_id, amount, remaining_amount, reason, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(id, creditNumber, customer_id, amt, amt, reason.trim(), createdBy);

    logCreate(db, req, "credit_notes", id, snapshot(db, "credit_notes", id),
      `Created credit note ${creditNumber} for $${amt.toFixed(2)} — ${reason.trim()}`);
    res.json({ id, credit_number: creditNumber });
  });

  router.post("/credits/:id/approve", (req, res) => {
    // Admin only
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required to approve credits" });

    const cn = db.prepare("SELECT * FROM credit_notes WHERE id = ?").get(req.params.id);
    if (!cn) return res.status(404).json({ error: "Credit note not found" });
    if (cn.status !== "pending") return res.status(400).json({ error: `Credit is already ${cn.status}` });

    const approvedBy = req.user?.username || req.user?.id || "";
    const today = new Date().toISOString().split("T")[0];

    db.transaction(() => {
      db.prepare(
        "UPDATE credit_notes SET status = 'approved', approved_by = ?, approved_date = ? WHERE id = ?"
      ).run(approvedBy, today, req.params.id);

      // Auto-apply against oldest open invoices FIFO
      const openInvoices = db.prepare(
        "SELECT id FROM invoices WHERE customer_id = ? AND status = 'open' ORDER BY invoice_date ASC"
      ).all(cn.customer_id);
      for (const inv of openInvoices) {
        const before = db.prepare("SELECT remaining_amount FROM credit_notes WHERE id = ?").get(req.params.id);
        if (!before || before.remaining_amount <= 0) break;
        autoApplyCreditsToInvoice(db, cn.customer_id, inv.id);
      }

      recalculateCustomerBalance(db, cn.customer_id);
    })();

    logUpdate(db, req, "credit_notes", req.params.id, cn, snapshot(db, "credit_notes", req.params.id),
      `Approved credit note ${cn.credit_number} for $${cn.amount.toFixed(2)}`);
    res.json({ success: true });
  });

  router.post("/credits/:id/reject", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const cn = db.prepare("SELECT * FROM credit_notes WHERE id = ?").get(req.params.id);
    if (!cn) return res.status(404).json({ error: "Credit note not found" });
    if (cn.status !== "pending") return res.status(400).json({ error: `Credit is already ${cn.status}` });

    const approvedBy = req.user?.username || req.user?.id || "";
    db.prepare(
      "UPDATE credit_notes SET status = 'rejected', approved_by = ?, approved_date = ? WHERE id = ?"
    ).run(approvedBy, new Date().toISOString().split("T")[0], req.params.id);
    logUpdate(db, req, "credit_notes", req.params.id, cn, snapshot(db, "credit_notes", req.params.id),
      `Rejected credit note ${cn.credit_number}`);
    res.json({ success: true });
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
    // 3.0.18: enrich with customer_name, customer_address, and cylinder_label so the
    // cylinder tracking screen can display human-readable labels. The '?' placeholders
    // and raw hex IDs that the frontend was showing came from this endpoint returning
    // only IDs — the frontend had no name field to render.
    res.json(db.prepare(`
      SELECT t.customer_id, t.cylinder_type,
        c.name as customer_name,
        c.address as customer_address,
        ct.label as cylinder_label,
        SUM(CASE WHEN t.type='delivery' THEN t.qty ELSE 0 END) -
        SUM(CASE WHEN t.type='return' THEN t.qty ELSE 0 END) as on_hand
      FROM transactions t
      JOIN cylinder_types ct ON ct.id = t.cylinder_type
      LEFT JOIN customers c ON c.id = t.customer_id
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
    const invStmt = db.prepare(
      `INSERT INTO invoices (id, invoice_number, customer_id, order_id, po_number, total, amount_paid, status, invoice_date)
       VALUES (?, ?, ?, '', '', ?, 0, 'open', ?)`
    );

    let totalTx = 0;
    const invoices = [];
    const skipped = []; // customers skipped because they were already billed for this date

    db.transaction(() => {
      for (const custId of customerIds) {
        // Double-bill protection: skip if a non-void rental invoice already exists
        // for this customer on this exact date (i.e. order_id = '' and invoice_date = date).
        // To regenerate, the user must void the existing invoice first.
        const existing = db.prepare(
          "SELECT id, invoice_number FROM invoices WHERE customer_id = ? AND invoice_date = ? AND order_id = '' AND status != 'void' LIMIT 1"
        ).get(custId, date);
        if (existing) {
          skipped.push({ customer_id: custId, reason: `Already billed for ${date} (invoice ${existing.invoice_number}). Void it first to regenerate.` });
          continue;
        }

        // Calculate on-hand as at date for this customer.
        // Round 3: cylinders with prepaid_until > date are excluded (prepaid first cycle).
        const rows = db.prepare(`
          SELECT t.cylinder_type,
            SUM(CASE WHEN t.type='delivery' AND (t.prepaid_until = '' OR t.prepaid_until IS NULL OR t.prepaid_until <= ?) THEN t.qty ELSE 0 END) -
            SUM(CASE WHEN t.type='return' THEN t.qty ELSE 0 END) as on_hand
          FROM transactions t
          JOIN cylinder_types ct ON ct.id = t.cylinder_type
          WHERE ct.item_type = 'cylinder' AND t.customer_id = ? AND t.date <= ?
          GROUP BY t.cylinder_type
          HAVING on_hand > 0
        `).all(date, custId, date);

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
          // Create the actual invoice record so the email flow has something to attach to
          const invoiceId = nodeCrypto.randomBytes(6).toString("hex");
          const invoiceNumber = nextSequenceNumber(db, "invoice");
          const total = Math.round(lines.reduce((s, l) => s + l.line_total, 0) * 100) / 100;
          invStmt.run(invoiceId, invoiceNumber, custId, total, date);
          try { autoApplyCreditsToInvoice(db, custId, invoiceId); } catch (e) { /* tolerate */ }
          recalculateCustomerBalance(db, custId);

          invoices.push({
            id: invoiceId,
            invoice_id: invoiceId,
            invoice_number: invoiceNumber,
            customer_id: custId,
            lines,
            total,
          });
        }
      }
    })();

    res.json({ success: true, invoicesGenerated: invoices.length, transactionsCreated: totalTx, invoices, skipped });
  });

  // ============================================================
  // RENTAL CYCLES (recurring billing)
  // ============================================================

  // Current cap for a sale item — the on-hand count of its linked rental cylinder.
  // Used by the UI to warn the user before they deliver a sale item.
  router.get("/rentals/sale-cap/:custId/:saleTypeId", (req, res) => {
    const saleCt = db.prepare("SELECT * FROM cylinder_types WHERE id = ? AND item_type = 'sale'").get(req.params.saleTypeId);
    if (!saleCt) return res.json({ linked: false, cap: null });
    const linkedRental = db.prepare(
      "SELECT * FROM cylinder_types WHERE item_type = 'cylinder' AND linked_sale_item_id = ?"
    ).get(req.params.saleTypeId);
    if (!linkedRental) return res.json({ linked: false, cap: null });
    const cap = getOnHand(db, req.params.custId, linkedRental.id);
    res.json({ linked: true, cap, rental_cylinder_type: linkedRental.id, rental_label: linkedRental.label });
  });

  // Seed next_rental_date for account customers who have at least one rental delivery
  // but no next_rental_date set. Set to (most recent rental delivery date + their frequency).
  router.post("/rentals/initialize", (req, res) => {
    const custs = db.prepare(`
      SELECT c.id, c.rental_frequency
      FROM customers c
      WHERE c.account_customer = 1
        AND (c.next_rental_date IS NULL OR c.next_rental_date = '')
        AND c.rental_frequency IS NOT NULL AND c.rental_frequency != ''
    `).all();

    let seeded = 0;
    db.transaction(() => {
      for (const c of custs) {
        const lastDelivery = db.prepare(`
          SELECT MAX(t.date) as d
          FROM transactions t
          JOIN cylinder_types ct ON ct.id = t.cylinder_type
          WHERE t.customer_id = ? AND t.type = 'delivery' AND ct.item_type = 'cylinder'
        `).get(c.id);
        if (!lastDelivery?.d) continue;
        const next = addFrequency(lastDelivery.d, c.rental_frequency);
        db.prepare("UPDATE customers SET next_rental_date = ?, last_rental_date = ? WHERE id = ?").run(next, lastDelivery.d, c.id);
        seeded++;
      }
    })();
    res.json({ success: true, seeded });
  });

  // Run the due-rentals job on demand. Returns a summary of what it did.
  router.post("/rentals/run-due", (req, res) => {
    const result = runDueRentals(db);
    res.json({ success: true, ...result });
  });

  // Force-bill all account customers (or a specific subset).
  // Body: { customer_ids?: [] } — if omitted/empty, bills everyone.
  // Always bills one cycle dated today, regardless of cycle status.
  router.post("/rentals/generate-now", (req, res) => {
    const customerIds = Array.isArray(req.body?.customer_ids) ? req.body.customer_ids : null;
    const result = runRentalsForce(db, customerIds);
    res.json({ success: true, ...result });
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
    const before = db.prepare("SELECT * FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?").get(req.params.custId, req.params.typeId);
    db.prepare(
      "INSERT OR REPLACE INTO customer_pricing (customer_id, cylinder_type, price, fixed_price, fixed_from, fixed_to) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(req.params.custId, req.params.typeId, price, fixed_price ? 1 : 0, fixed_from || "", fixed_to || "");
    db.prepare("INSERT INTO price_history (customer_id, cylinder_type, price, effective_from) VALUES (?, ?, ?, ?)").run(req.params.custId, req.params.typeId, price, today);
    logAudit(db, req, {
      action: before ? "update" : "create",
      table: "customer_pricing",
      record_id: `${req.params.custId}:${req.params.typeId}`,
      before,
      after: { customer_id: req.params.custId, cylinder_type: req.params.typeId, price, fixed_price: fixed_price ? 1 : 0, fixed_from, fixed_to },
      summary: `Set price for customer ${req.params.custId} × ${req.params.typeId}: $${Number(price).toFixed(2)}${fixed_price ? ` (fixed ${fixed_from}→${fixed_to})` : ""}`,
    });
    res.json({ success: true });
  });

  router.delete("/pricing/:custId/:typeId", (req, res) => {
    const before = db.prepare("SELECT * FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?").get(req.params.custId, req.params.typeId);
    db.prepare("DELETE FROM customer_pricing WHERE customer_id = ? AND cylinder_type = ?").run(req.params.custId, req.params.typeId);
    logAudit(db, req, {
      action: "delete",
      table: "customer_pricing",
      record_id: `${req.params.custId}:${req.params.typeId}`,
      before,
      summary: `Removed customer-specific price for ${req.params.custId} × ${req.params.typeId}`,
    });
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
    logAudit(db, req, {
      action: "bulk_update",
      table: "customer_pricing",
      record_id: cylinder_type,
      after: { cylinder_type, mode, price, percentage, customers_targeted: customer_ids.length, updated, skippedFixed },
      summary: `Bulk pricing update on ${cylinder_type}: ${mode === "percentage" ? `${percentage}%` : `$${price}`} → ${updated} customers updated, ${skippedFixed} skipped (fixed contracts)`,
    });
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

    // Order stats — round 3 status model
    const ordersOpen = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status IN ('open', 'awaiting_dispatch')").get().c;
    const ordersDispatched = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'dispatched'").get().c;
    const ordersDelivered = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status IN ('delivered', 'invoiced', 'paid')").get().c;
    const ordersTotal = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status != 'cancelled'").get().c;
    const recentOrders = db.prepare("SELECT o.*, c.name as customer_name_lookup FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ORDER BY o.order_date DESC, o.created DESC LIMIT 10").all();

    res.json({
      total_customers: totalCustomers, total_on_hand: onHandResult.total,
      total_deliveries: totalDeliveries, total_returns: totalReturns, total_sales: totalSales,
      recent_transactions: recentTx,
      optimoroute: { last_sync: lastSync || null, total_imported: orImported },
      // Keep legacy keys for backward compat with the old dashboard
      orders: {
        open: ordersOpen,
        confirmed: ordersDispatched,    // legacy alias for dispatched
        completed: ordersDelivered,     // legacy alias for delivered+invoiced+paid
        dispatched: ordersDispatched,
        delivered: ordersDelivered,
        total: ordersTotal,
        recent: recentOrders,
      },
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
    // Capture before-state for each setting being written
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    const beforeMap = {};
    for (const [key] of entries) {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      beforeMap[key] = row ? row.value : null;
    }
    db.transaction(() => { for (const [key, value] of entries) stmt.run(key, String(value)); })();
    logAudit(db, req, {
      action: "update",
      table: "settings",
      record_id: entries.map(([k]) => k).join(","),
      before: beforeMap,
      after: Object.fromEntries(entries.map(([k, v]) => [k, String(v)])),
      summary: `Updated ${entries.length} setting(s): ${entries.map(([k]) => k).join(", ")}`,
    });
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
      // Round 3: when Optimo reports an order completed, mark all lines delivered (full qty),
      // create delivery transactions, generate invoice, transition to invoiced/paid.
      let ordersCompleted = 0;
      const ctOrders = db.prepare(
        "SELECT * FROM orders WHERE optimoroute_id != '' AND status NOT IN ('delivered', 'invoiced', 'paid', 'cancelled') AND collection = 0"
      ).all();
      for (const ctOrder of ctOrders) {
        const completion = completionMap[ctOrder.optimoroute_id];
        if (completion?.data?.status !== "success") continue;

        try {
          db.transaction(() => {
            // Mark all lines as delivered with full qty
            const lines = db.prepare(
              `SELECT ol.*, ct.item_type, c.rental_frequency
               FROM order_lines ol
               LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
               LEFT JOIN orders o ON o.id = ol.order_id
               LEFT JOIN customers c ON c.id = o.customer_id
               WHERE ol.order_id = ?`
            ).all(ctOrder.id);

            for (const l of lines) {
              if (l.status === "cancelled") continue;
              db.prepare(
                "UPDATE order_lines SET delivered_qty = ?, status = 'delivered' WHERE id = ?"
              ).run(l.qty, l.id);
            }

            // Create delivery transactions for cylinder lines (with prepaid_until)
            const insTx2 = db.prepare(
              `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, prepaid_until, order_line_id)
               VALUES (?, ?, ?, 'delivery', ?, ?, ?, 'order', ?, ?, ?)`
            );
            for (const l of lines) {
              if (l.item_type !== "cylinder") continue;
              if (!(l.qty > 0)) continue;
              const existing = db.prepare(
                "SELECT id FROM transactions WHERE order_line_id = ? AND type = 'delivery'"
              ).get(l.id);
              if (existing) continue;
              const freq = l.rental_frequency || "monthly";
              const prepaidUntil = addFrequency(ctOrder.order_date, freq);
              insTx2.run(
                uid(), ctOrder.customer_id, l.cylinder_type_id, l.qty, ctOrder.order_date,
                `Order ${ctOrder.order_number} — Optimo completed, line × ${l.qty}`,
                ctOrder.id, prepaidUntil, l.id
              );
            }

            // 3.0.18: process linked rental for sale lines completed via Optimo.
            // Need customer_category for the residential vs commercial branch — fetch it
            // here since the line query doesn't include it.
            const optCust = db.prepare(
              "SELECT rental_frequency, customer_category FROM customers WHERE id = ?"
            ).get(ctOrder.customer_id);
            for (const l of lines) {
              if (l.item_type !== "sale") continue;
              if (!(l.qty > 0)) continue;
              processLinkedRentalOnDelivery(ctOrder, optCust, l, l.qty);
            }

            // Recompute invoice total based on delivered amounts
            if (ctOrder.invoice_id) {
              const refreshed = db.prepare(
                "SELECT delivered_qty, unit_price, status FROM order_lines WHERE order_id = ?"
              ).all(ctOrder.id);
              let deliveredTotal = 0;
              for (const l of refreshed) {
                if (l.status === "cancelled") continue;
                deliveredTotal += (l.delivered_qty || 0) * (l.unit_price || 0);
              }
              deliveredTotal = Math.round(deliveredTotal * 100) / 100;
              db.prepare(
                "UPDATE invoices SET total = ?, status = CASE WHEN amount_paid >= ? THEN 'paid' ELSE 'open' END, updated = datetime('now') WHERE id = ? AND status != 'void'"
              ).run(deliveredTotal, deliveredTotal, ctOrder.invoice_id);
            }

            // Order status: delivered → invoiced → maybe paid
            db.prepare("UPDATE orders SET status = 'invoiced', updated = datetime('now') WHERE id = ?").run(ctOrder.id);
            if (ctOrder.invoice_id) {
              const inv = db.prepare("SELECT amount_paid, total FROM invoices WHERE id = ?").get(ctOrder.invoice_id);
              if (inv && inv.total > 0 && inv.amount_paid >= inv.total) {
                db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(ctOrder.id);
              }
            }

            recalculateCustomerBalance(db, ctOrder.customer_id);
            ordersCompleted++;
          })();
        } catch (e) {
          console.error("[OR completion] failed for order", ctOrder.id, e.message);
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
  // BACKUP / RESTORE (complete, all tables)
  // ============================================================
  // These replace the old 5-table backup. Exports every table in
  // the database including orders, invoices, payments, credits,
  // audit log, etc. Admin only.
  //
  // Security: the backup file contains EVERY row of sensitive data
  // including cc_encrypted ciphertext, bcrypt password hashes, the
  // entire audit trail, and customer contact details. Treat it
  // like the database file itself. Never email it, never commit
  // it to git, store copies only on encrypted disks.
  router.get("/backup", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    try {
      const backup = exportFullBackup(db);
      logAudit(db, req, {
        action: "backup_export",
        table: "_system",
        record_id: "",
        summary: `Full backup exported — ${Object.values(backup.row_counts).reduce((a, b) => a + b, 0)} rows across ${Object.keys(backup.row_counts).length} tables`,
      });
      const filename = `cylindertrack-full-backup-${new Date().toISOString().replace(/[:.]/g, "-").split("T")[0]}-${new Date().toISOString().replace(/[:.]/g, "-").split("T")[1].slice(0, 8)}.json`;
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(backup, null, 2));
    } catch (err) {
      console.error("[/backup] export failed:", err);
      res.status(500).json({ error: `Backup export failed: ${err.message}` });
    }
  });

  // Dry-run validation — checks a backup file without restoring.
  // Accepts the same body as /restore but only reports what it would do.
  router.post("/backup/validate", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const backup = req.body;
    const problems = validateBackup(backup);
    const summary = {
      valid: problems.length === 0,
      problems,
      format: backup?.format,
      exported_at: backup?.exported_at,
      row_counts: backup?.row_counts || {},
      total_rows: backup?.row_counts ? Object.values(backup.row_counts).reduce((a, b) => a + b, 0) : 0,
    };
    res.json(summary);
  });

  router.post("/restore", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const backup = req.body;

    // Validate first
    const problems = validateBackup(backup);
    if (problems.length > 0) {
      return res.status(400).json({ error: "Invalid backup file", problems });
    }

    try {
      // Log the restore BEFORE we do it so the intent is captured even
      // if the audit_log table itself gets replaced mid-restore.
      logAudit(db, req, {
        action: "restore_start",
        table: "_system",
        record_id: "",
        summary: `Starting full restore from backup exported ${backup.exported_at} — ${Object.values(backup.row_counts || {}).reduce((a, b) => a + b, 0)} rows`,
      });

      const summary = restoreFullBackup(db, backup);

      // Log the completion too (this will be in the restored audit_log,
      // so it survives the restore as a marker of when it happened).
      logAudit(db, req, {
        action: "restore_complete",
        table: "_system",
        record_id: "",
        summary: `Full restore complete — ${summary.total_rows} rows across ${summary.tables_restored} tables`,
      });

      res.json({ success: true, ...summary });
    } catch (err) {
      console.error("[/restore] restore failed:", err);
      // Try to log the failure — but audit_log may be in an inconsistent
      // state after a partial restore, so swallow errors from the log call.
      try {
        logAudit(db, req, {
          action: "restore_failed",
          table: "_system",
          summary: `Restore failed: ${err.message}`,
        });
      } catch (_) { /* nothing we can do */ }
      res.status(500).json({ error: `Restore failed: ${err.message}`, hint: "Database may be in an inconsistent state. Restore from another backup or check logs." });
    }
  });

  // Return current row counts per table. Useful for the Administrator
  // page to show "you have X customers, Y orders" before/after restore
  // and to help confirm a backup looks complete before downloading.
  router.get("/backup/counts", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const counts = {};
    for (const table of BACKUP_TABLES) {
      try {
        counts[table] = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
      } catch (e) {
        counts[table] = null; // table doesn't exist
      }
    }
    res.json({ counts, total: Object.values(counts).reduce((a, b) => a + (b || 0), 0) });
  });

  // ============================================================
  // AUDIT LOG VIEWER (admin only)
  // ============================================================
  // Append-only audit trail. This endpoint is read-only; there is
  // no corresponding POST/PUT/DELETE — audit rows can only be
  // written via the logAudit() helper from inside route handlers.
  //
  // Query parameters (all optional):
  //   from         ISO date (inclusive lower bound on ts)
  //   to           ISO date (inclusive upper bound on ts)
  //   user_id      filter by user who performed the action
  //   username     filter by username (exact match)
  //   table        filter by table_name
  //   record_id    filter by record_id (exact match)
  //   action       filter by action (create|update|delete|login|...)
  //   q            free-text search on summary
  //   limit        page size (default 100, max 500)
  //   offset       pagination offset (default 0)
  //
  // Returns: { rows, total, limit, offset }
  router.get("/audit-log", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });

    const { from, to, user_id, username, table, record_id, action, q } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let where = "WHERE 1=1";
    const params = [];
    if (from)      { where += " AND ts >= ?";         params.push(from); }
    if (to)        { where += " AND ts <= ?";         params.push(to); }
    if (user_id)   { where += " AND user_id = ?";     params.push(user_id); }
    if (username)  { where += " AND username = ?";    params.push(username); }
    if (table)     { where += " AND table_name = ?";  params.push(table); }
    if (record_id) { where += " AND record_id = ?";   params.push(record_id); }
    if (action)    { where += " AND action = ?";      params.push(action); }
    if (q)         { where += " AND summary LIKE ?";  params.push(`%${q}%`); }

    const total = db.prepare(`SELECT COUNT(*) as c FROM audit_log ${where}`).get(...params).c;
    const rows = db.prepare(
      `SELECT id, ts, user_id, username, user_role, ip, action, table_name, record_id, before_json, after_json, summary
       FROM audit_log ${where}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ rows, total, limit, offset });
  });

  // Distinct users/tables/actions — populates audit viewer filter dropdowns.
  router.get("/audit-log/facets", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const users   = db.prepare("SELECT DISTINCT username FROM audit_log WHERE username != '' ORDER BY username").all().map(r => r.username);
    const tables  = db.prepare("SELECT DISTINCT table_name FROM audit_log ORDER BY table_name").all().map(r => r.table_name);
    const actions = db.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all().map(r => r.action);
    res.json({ users, tables, actions });
  });

  // Full history for a single record — useful for "show me everything that
  // ever happened to invoice INV-00042" style queries.
  router.get("/audit-log/record/:table/:id", (req, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    const rows = db.prepare(
      `SELECT * FROM audit_log WHERE table_name = ? AND record_id = ? ORDER BY id ASC`
    ).all(req.params.table, req.params.id);
    res.json({ rows });
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

/**
 * Run all due rental cycles.
 * Iterates account customers whose next_rental_date is today or earlier,
 * generates rental invoice transactions for their current on-hand count,
 * and advances next_rental_date by their rental_frequency.
 *
 * Safe to call repeatedly — the transaction advances the date, so a second
 * call the same day will be a no-op.
 */
// Returns true if the given date string (YYYY-MM-DD) is the last day of its month.
function isLastDayOfMonth(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return next.getMonth() !== d.getMonth();
}

// Bill a single customer for one or more rental cycles.
// `mode` can be "due" (only bill if cycle is actually due), "force" (bill once for today regardless),
// or "force-eom" (bill once dated end of month, used for commercial force runs).
// Returns { invoicesCreated, transactionsCreated }.
function billCustomerRental(db, cust, mode) {
  const today = new Date().toISOString().split("T")[0];
  let invoicesCreated = 0;
  let transactionsCreated = 0;

  const txStmt = db.prepare(
    "INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, auto_generated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"
  );
  const invStmt = db.prepare(
    `INSERT INTO invoices (id, invoice_number, customer_id, order_id, po_number, total, amount_paid, status, invoice_date)
     VALUES (?, ?, ?, '', '', ?, 0, 'open', ?)`
  );

  // Helper to bill exactly one cycle dated billDate
  const billOneCycle = (billDate, freqLabel) => {
    // Round 3 rule: cylinders with prepaid_until > billDate are excluded — the customer
    // already paid for the first cycle on the delivery order. Once prepaid_until expires,
    // they're billed normally.
    const rows = db.prepare(`
      SELECT t.cylinder_type,
        SUM(CASE WHEN t.type='delivery' AND (t.prepaid_until = '' OR t.prepaid_until IS NULL OR t.prepaid_until <= ?) THEN t.qty ELSE 0 END) -
        SUM(CASE WHEN t.type='return' THEN t.qty ELSE 0 END) as on_hand
      FROM transactions t
      JOIN cylinder_types ct ON ct.id = t.cylinder_type
      WHERE ct.item_type = 'cylinder' AND t.customer_id = ? AND t.date <= ?
      GROUP BY t.cylinder_type
      HAVING on_hand > 0
    `).all(billDate, cust.id, billDate);

    let cycleTotal = 0;
    const lineDetails = [];
    for (const r of rows) {
      const ct = db.prepare("SELECT * FROM cylinder_types WHERE id = ?").get(r.cylinder_type);
      if (!ct) continue;
      const unitPrice = getPriceForDate(db, cust.id, r.cylinder_type, billDate, ct.default_price || 0);
      const lineTotal = Math.round(unitPrice * r.on_hand * 100) / 100;
      cycleTotal += lineTotal;
      lineDetails.push({ ct, qty: r.on_hand, unitPrice, lineTotal });
    }
    cycleTotal = Math.round(cycleTotal * 100) / 100;

    if (lineDetails.length === 0) return null; // nothing to bill

    const invoiceId = nodeCrypto.randomBytes(6).toString("hex");
    const invoiceNumber = nextSequenceNumber(db, "invoice");
    invStmt.run(invoiceId, invoiceNumber, cust.id, cycleTotal, billDate);
    invoicesCreated++;

    for (const line of lineDetails) {
      const txId = nodeCrypto.randomBytes(6).toString("hex");
      txStmt.run(
        txId, cust.id, line.ct.id, "rental_invoice", line.qty, billDate,
        `Auto rental invoice ${invoiceNumber} — ${freqLabel} as at ${billDate}`,
        "auto_rental"
      );
      transactionsCreated++;
    }

    try { autoApplyCreditsToInvoice(db, cust.id, invoiceId); } catch (e) { /* tolerate */ }
    return invoiceId;
  };

  const isCommercial = (cust.customer_category || "").toLowerCase() === "commercial";

  if (mode === "force") {
    // Same-day duplicate check: refuse to create a second rental invoice for the same customer
    // on the same day, even in force mode. The legitimate "force" use case is catching up
    // missed cycles or billing customers the cycle didn't catch — neither of which involves
    // billing twice on the same day.
    const sameDayCount = db.prepare(
      `SELECT COUNT(*) as c FROM transactions
       WHERE customer_id = ? AND type = 'rental_invoice' AND date = ? AND source = 'auto_rental'`
    ).get(cust.id, today).c;
    if (sameDayCount > 0) {
      // Already billed today — skip silently. The caller can void existing and re-run if needed.
      return { invoicesCreated: 0, transactionsCreated: 0 };
    }

    // One cycle dated today, regardless of next_rental_date
    const billDate = today;
    billOneCycle(billDate, isCommercial ? "commercial force" : "manual force");
    db.prepare("UPDATE customers SET last_rental_date = ? WHERE id = ?").run(today, cust.id);
  } else if (mode === "due") {
    if (isCommercial) {
      // Commercial: only bill if today IS the last day of the month
      if (isLastDayOfMonth(today)) {
        // Don't double-bill — check that we haven't already run the commercial-monthly
        // scheduler for this month. We look at transactions (which carry the cycle label
        // in their notes) rather than invoices, so that force runs don't block the
        // scheduler and vice versa.
        const yearMonth = today.substring(0, 7); // YYYY-MM
        const alreadyBilled = db.prepare(
          `SELECT COUNT(*) as c FROM transactions
           WHERE customer_id = ? AND type = 'rental_invoice'
             AND substr(date, 1, 7) = ?
             AND notes LIKE '%commercial monthly%'`
        ).get(cust.id, yearMonth).c;
        if (!alreadyBilled) {
          billOneCycle(today, "commercial monthly");
          db.prepare("UPDATE customers SET last_rental_date = ?, next_rental_date = ? WHERE id = ?")
            .run(today, today, cust.id);
        }
      }
    } else {
      // Residential: existing per-frequency logic
      if (!cust.rental_frequency || !cust.next_rental_date) return { invoicesCreated, transactionsCreated };
      let billDate = cust.next_rental_date;
      let iterations = 0;
      while (billDate <= today && iterations < 24) {
        billOneCycle(billDate, cust.rental_frequency);
        billDate = addFrequency(billDate, cust.rental_frequency);
        iterations++;
      }
      db.prepare("UPDATE customers SET next_rental_date = ?, last_rental_date = ? WHERE id = ?")
        .run(billDate, today, cust.id);
    }
  }

  recalculateCustomerBalance(db, cust.id);
  return { invoicesCreated, transactionsCreated };
}

// Scheduler entry: bill all account customers whose cycle is due today.
// Residential = per rental_frequency, commercial = end-of-month.
function runDueRentals(db) {
  const eligible = db.prepare(`
    SELECT id, rental_frequency, next_rental_date, customer_category
    FROM customers
    WHERE account_customer = 1
  `).all();

  let customersBilled = 0;
  let invoicesCreated = 0;
  let transactionsCreated = 0;
  const errors = [];

  for (const cust of eligible) {
    try {
      const r = db.transaction(() => billCustomerRental(db, cust, "due"))();
      if (r.invoicesCreated > 0) {
        customersBilled++;
        invoicesCreated += r.invoicesCreated;
        transactionsCreated += r.transactionsCreated;
      }
    } catch (err) {
      errors.push({ customer_id: cust.id, error: err.message });
    }
  }

  return { customersBilled, invoicesCreated, transactionsCreated, errors, ranAt: new Date().toISOString() };
}

// Manual entry: force-bill all account customers OR a specific subset.
// Ignores cycle, bills one cycle dated today for everyone with on-hand cylinders.
function runRentalsForce(db, customerIds) {
  const sql = customerIds && customerIds.length > 0
    ? `SELECT id, rental_frequency, next_rental_date, customer_category FROM customers WHERE account_customer = 1 AND id IN (${customerIds.map(() => "?").join(",")})`
    : `SELECT id, rental_frequency, next_rental_date, customer_category FROM customers WHERE account_customer = 1`;
  const eligible = customerIds && customerIds.length > 0
    ? db.prepare(sql).all(...customerIds)
    : db.prepare(sql).all();

  let customersBilled = 0;
  let invoicesCreated = 0;
  let transactionsCreated = 0;
  const errors = [];

  for (const cust of eligible) {
    try {
      const r = db.transaction(() => billCustomerRental(db, cust, "force"))();
      if (r.invoicesCreated > 0) {
        customersBilled++;
        invoicesCreated += r.invoicesCreated;
        transactionsCreated += r.transactionsCreated;
      }
    } catch (err) {
      errors.push({ customer_id: cust.id, error: err.message });
    }
  }

  return { customersBilled, invoicesCreated, transactionsCreated, errors, ranAt: new Date().toISOString() };
}

// ============================================================
// ROUND 3: AUTO-CLOSE SCHEDULER
// Finds orders that have been sitting in 'dispatched' state for longer than
// auto_close_days, drops any undelivered lines, generates the invoice for
// whatever was delivered, and transitions to invoiced/paid.
// ============================================================
function runAutoCloseOrders(db) {
  const autoCloseDays = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'auto_close_days'").get()?.value) || "14",
    10
  );
  if (!autoCloseDays || autoCloseDays <= 0) return { closed: 0, errors: [] };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - autoCloseDays);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const candidates = db.prepare(
    `SELECT id, customer_id, order_number, order_date, updated
     FROM orders
     WHERE status = 'dispatched'
       AND substr(COALESCE(updated, created, ''), 1, 10) <= ?`
  ).all(cutoffStr);

  let closed = 0;
  const errors = [];

  for (const order of candidates) {
    try {
      db.transaction(() => {
        const lines = db.prepare(
          `SELECT ol.*, ct.item_type, ct.label as cylinder_label, c.rental_frequency
           FROM order_lines ol
           LEFT JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
           LEFT JOIN orders o ON o.id = ol.order_id
           LEFT JOIN customers c ON c.id = o.customer_id
           WHERE ol.order_id = ?`
        ).all(order.id);

        // Lines: cancel if zero delivered, otherwise mark as delivered
        for (const l of lines) {
          if (l.status === "delivered" || l.status === "cancelled") continue;
          if ((l.delivered_qty || 0) > 0) {
            db.prepare("UPDATE order_lines SET status = 'delivered' WHERE id = ?").run(l.id);
          } else {
            db.prepare("UPDATE order_lines SET status = 'cancelled' WHERE id = ?").run(l.id);
          }
        }

        // Create delivery transactions for cylinder lines that actually got delivered
        const insTx = db.prepare(
          `INSERT INTO transactions (id, customer_id, cylinder_type, type, qty, date, notes, source, optimoroute_order, prepaid_until, order_line_id)
           VALUES (?, ?, ?, 'delivery', ?, ?, ?, 'order', ?, ?, ?)`
        );
        for (const l of lines) {
          if (l.item_type !== "cylinder") continue;
          if (!(l.delivered_qty > 0)) continue;
          // Don't double-create — check if a delivery transaction already exists for this line
          const existing = db.prepare(
            "SELECT id FROM transactions WHERE order_line_id = ? AND type = 'delivery'"
          ).get(l.id);
          if (existing) continue;
          const freq = l.rental_frequency || "monthly";
          const prepaidUntil = addFrequency(order.order_date, freq);
          const txId = nodeCrypto.randomBytes(6).toString("hex");
          insTx.run(
            txId, order.customer_id, l.cylinder_type_id, l.delivered_qty, order.order_date,
            `Order ${order.order_number} — auto-closed after ${autoCloseDays}d, ${l.cylinder_label || ''} × ${l.delivered_qty}`,
            order.id, prepaidUntil, l.id
          );
        }

        // Recompute the invoice total based on delivered qty
        const orderRow = db.prepare("SELECT invoice_id, customer_id FROM orders WHERE id = ?").get(order.id);
        if (orderRow.invoice_id) {
          const refreshed = db.prepare(
            `SELECT delivered_qty, unit_price, status FROM order_lines WHERE order_id = ?`
          ).all(order.id);
          let deliveredTotal = 0;
          for (const l of refreshed) {
            if (l.status === "cancelled") continue;
            deliveredTotal += (l.delivered_qty || 0) * (l.unit_price || 0);
          }
          deliveredTotal = Math.round(deliveredTotal * 100) / 100;

          db.prepare(
            "UPDATE invoices SET total = ?, status = CASE WHEN amount_paid >= ? THEN 'paid' ELSE 'open' END, updated = datetime('now') WHERE id = ? AND status != 'void'"
          ).run(deliveredTotal, deliveredTotal, orderRow.invoice_id);
        }

        // Status: invoiced → maybe paid
        db.prepare("UPDATE orders SET status = 'invoiced', updated = datetime('now') WHERE id = ?").run(order.id);
        if (orderRow.invoice_id) {
          const inv = db.prepare("SELECT amount_paid, total FROM invoices WHERE id = ?").get(orderRow.invoice_id);
          if (inv && inv.total > 0 && inv.amount_paid >= inv.total) {
            db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id);
          }
        }

        // Recalc balance
        const balRow = db.prepare(
          "SELECT COALESCE(SUM(total - amount_paid), 0) as owed FROM invoices WHERE customer_id = ? AND status NOT IN ('void', 'pending')"
        ).get(order.customer_id);
        const credRow = db.prepare(
          "SELECT COALESCE(SUM(remaining_amount), 0) as credit FROM credit_notes WHERE customer_id = ? AND status = 'approved'"
        ).get(order.customer_id);
        db.prepare("UPDATE customers SET balance = ?, credit_balance = ? WHERE id = ?")
          .run(
            Math.round((balRow.owed || 0) * 100) / 100,
            Math.round((credRow.credit || 0) * 100) / 100,
            order.customer_id
          );

        closed++;
      })();
    } catch (err) {
      errors.push({ order_id: order.id, error: err.message });
    }
  }

  return { closed, errors, ranAt: new Date().toISOString() };
}

module.exports.runDueRentals = runDueRentals;
module.exports.runRentalsForce = runRentalsForce;
module.exports.runAutoCloseOrders = runAutoCloseOrders;
// 3.0.18: Export pure helpers so unit tests can verify them in isolation
module.exports.parseCylinderFromText = parseCylinderFromText;