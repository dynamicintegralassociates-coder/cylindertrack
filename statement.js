// CylinderTrack — Account Statement PDF Generator
// Produces a multi-page PDF statement matching commercial gas account format:
//   Page 1  : Account Statement Summary
//   Page 2+ : Delivery Transaction Detail (grouped by cylinder type section)
//   Last    : Cylinder Holdings as at statement date
//
// All stored invoice/payment amounts are treated as ex-GST.
// Display amounts on the statement are inc-GST (stored × 1.1).

"use strict";
const PDFDocument = require("pdfkit");

// ── Helpers ─────────────────────────────────────────────────────────────────

const GST_RATE = 0.10;

function fmtMoney(n, incGst = false) {
  const v = Number(n || 0) * (incGst ? (1 + GST_RATE) : 1);
  return `$${Math.round(v * 100) / 100 >= 0 ? "" : "-"}${Math.abs(Math.round(v * 100) / 100).toFixed(2)}`;
}

function fmtMoneyRaw(n) {
  const v = Number(n || 0);
  return `$${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(2)}`;
}

function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = String(d).split("-");
  return `${day}/${m}/${y}`;
}

function fmtDateShort(d) {
  if (!d) return "—";
  const [y, m, day] = String(d).split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${Number(day)} ${months[Number(m) - 1]} ${y}`;
}

function statementDueDate(toDate, paymentTerms) {
  const pt = (paymentTerms || "").toLowerCase().trim();
  const d = new Date(toDate + "T00:00:00");
  if (!pt || pt === "cod") return toDate;
  if (pt.startsWith("eom")) {
    const days = parseInt(pt) || 14;
    const eom = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    eom.setDate(eom.getDate() + days);
    return eom.toISOString().split("T")[0];
  }
  const days = parseInt(pt) || 30;
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ── Data Collection ─────────────────────────────────────────────────────────

function generateStatementData(db, customerId, fromDate, toDate) {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
  if (!customer) return null;

  const settingsRows = db.prepare("SELECT key, value FROM settings").all();
  const settings = {};
  for (const r of settingsRows) settings[r.key] = r.value;

  // ── Balance Brought Forward ──────────────────────────────────────────────
  // Outstanding balance as at the day before `fromDate`
  const bbfInv = db.prepare(`
    SELECT COALESCE(SUM(total), 0) as v
    FROM invoices WHERE customer_id = ? AND invoice_date < ? AND status NOT IN ('void','pending')
  `).get(customerId, fromDate).v;

  const bbfPay = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as v
    FROM payments WHERE customer_id = ? AND date < ?
  `).get(customerId, fromDate).v;

  const bbf = Math.round((bbfInv - bbfPay) * 100) / 100;

  // ── Payments received in period ──────────────────────────────────────────
  const payRows = db.prepare(`
    SELECT amount, method, reference, date
    FROM payments WHERE customer_id = ? AND date >= ? AND date <= ?
    ORDER BY date
  `).all(customerId, fromDate, toDate);
  const paymentsTotal = payRows.reduce((s, p) => s + (p.amount || 0), 0);

  // Group payment descriptions for summary line
  const payDesc = payRows.length > 0
    ? payRows.map(p => `${p.method || "Payment"}${p.reference ? " " + p.reference : ""} ${fmtDate(p.date)}`).join(", ")
    : null;

  // ── Invoices in period ───────────────────────────────────────────────────
  const invoicesInPeriod = db.prepare(`
    SELECT i.*, o.order_number
    FROM invoices i
    LEFT JOIN orders o ON o.id = i.order_id
    WHERE i.customer_id = ? AND i.invoice_date >= ? AND i.invoice_date <= ?
      AND i.status NOT IN ('void','pending')
    ORDER BY i.invoice_date
  `).all(customerId, fromDate, toDate);

  const currentChargesExGst = invoicesInPeriod.reduce((s, i) => s + (i.total || 0), 0);

  // ── Transaction Detail ───────────────────────────────────────────────────
  // Fetch all delivered order lines in the period.
  // Group by cylinder type section (rental vs sale).
  const orderLines = db.prepare(`
    SELECT
      o.id as order_id, o.order_date, o.order_number, o.po_number,
      ol.id as line_id, ol.cylinder_type_id, ol.delivered_qty,
      ol.unit_price, ol.line_total, ol.status,
      ct.label as cylinder_label, ct.item_type,
      COALESCE(sale_ct.label, ct.label) as display_label,
      sale_ct.label as sale_label
    FROM orders o
    JOIN order_lines ol ON ol.order_id = o.id
    JOIN cylinder_types ct ON ct.id = ol.cylinder_type_id
    LEFT JOIN cylinder_types sale_ct
      ON sale_ct.id = ct.linked_sale_item_id AND sale_ct.item_type = 'sale'
    WHERE o.customer_id = ?
      AND o.order_date >= ? AND o.order_date <= ?
      AND ol.delivered_qty > 0
      AND ol.status NOT IN ('cancelled')
    ORDER BY o.order_date, o.created, ol.sort_order
  `).all(customerId, fromDate, toDate);

  const retStmt = db.prepare(`
    SELECT COALESCE(SUM(qty), 0) as qty
    FROM transactions WHERE order_line_id = ? AND type = 'return'
  `);

  // Build transaction rows
  const txRows = orderLines.map(l => {
    const retQty = retStmt.get(l.line_id).qty || 0;
    const lineExGst = Math.round((l.line_total || (l.unit_price * l.delivered_qty) || 0) * 100) / 100;
    const gst = Math.round(lineExGst * GST_RATE * 100) / 100;
    return {
      date: l.order_date,
      reference: l.po_number || l.order_number || "",
      description: l.display_label || l.cylinder_label,
      qty_delivered: l.delivered_qty,
      qty_return: retQty > 0 ? -retQty : 0,
      line_total_ex_gst: lineExGst,
      gst,
      total_inc_gst: Math.round((lineExGst + gst) * 100) / 100,
      item_type: l.item_type,
    };
  });

  const delivExGst = Math.round(txRows.reduce((s, t) => s + t.line_total_ex_gst, 0) * 100) / 100;
  const delivGst   = Math.round(delivExGst * GST_RATE * 100) / 100;
  const delivIncGst = Math.round((delivExGst + delivGst) * 100) / 100;

  // ── Cylinder Holdings ────────────────────────────────────────────────────
  // Opening: as at day before fromDate
  const holdingQuery = `
    SELECT
      ct.id,
      COALESCE(NULLIF(sale_ct.label,''), ct.label) as label,
      SUM(CASE WHEN t.type='delivery' THEN t.qty ELSE 0 END) -
      SUM(CASE WHEN t.type='return'   THEN t.qty ELSE 0 END) AS on_hand
    FROM transactions t
    JOIN cylinder_types ct ON ct.id = t.cylinder_type
    LEFT JOIN cylinder_types sale_ct
      ON sale_ct.id = ct.linked_sale_item_id AND sale_ct.item_type = 'sale'
    WHERE t.customer_id = ? AND ct.item_type = 'cylinder' AND t.date <= ?
    GROUP BY ct.id HAVING on_hand != 0
    ORDER BY COALESCE(NULLIF(sale_ct.label,''), ct.label)
  `;

  const openingOnHand = db.prepare(holdingQuery).all(customerId, fromDate + " 00:00:00")
    .filter(r => r.on_hand > 0);
  const closingOnHand = db.prepare(holdingQuery).all(customerId, toDate + " 23:59:59")
    .filter(r => r.on_hand > 0);

  // Merge into a holdings map
  const holdMap = {};
  for (const h of openingOnHand) holdMap[h.id] = { label: h.label, opening_qty: h.on_hand, qty_held: 0 };
  for (const h of closingOnHand) {
    if (holdMap[h.id]) holdMap[h.id].qty_held = h.on_hand;
    else holdMap[h.id] = { label: h.label, opening_qty: 0, qty_held: h.on_hand };
  }
  const cylinderHoldings = Object.values(holdMap).filter(h => h.opening_qty > 0 || h.qty_held > 0);

  // ── Summary ──────────────────────────────────────────────────────────────
  const balAfterPayments = Math.round((bbf - paymentsTotal) * 100) / 100;
  const totalBalDue = Math.round((balAfterPayments + currentChargesExGst) * 100) / 100;
  const totalGst = Math.round(currentChargesExGst * GST_RATE * 100) / 100;

  const toDateObj = new Date(toDate);
  const accountCode = customer.account_number || customer.id.substring(0, 8).toUpperCase();
  const docRef = `${accountCode}-${toDateObj.getMonth() + 1}-${toDateObj.getFullYear()}`;

  // Use the latest actual due_date from invoices in the period; fall back to calculating from toDate
  const latestInvDueDate = invoicesInPeriod
    .map(i => i.due_date)
    .filter(Boolean)
    .sort()
    .pop();
  const dueDate = latestInvDueDate || statementDueDate(toDate, customer.payment_terms);

  return {
    customer,
    settings,
    period: { from: fromDate, to: toDate },
    statement_date: toDate,
    due_date: dueDate,
    document_reference: docRef,
    account_code: accountCode,
    summary: {
      balance_brought_forward: bbf,
      payments_received: Math.round(paymentsTotal * 100) / 100,
      payments_desc: payDesc,
      balance_after_payments: balAfterPayments,
      current_charges_ex_gst: Math.round(currentChargesExGst * 100) / 100,
      current_charges_gst: totalGst,
      current_charges_inc_gst: Math.round(currentChargesExGst * 1.1 * 100) / 100,
      total_balance_due: totalBalDue,
      overdue_amount: balAfterPayments > 0 ? balAfterPayments : 0,
      current_bill: Math.round(currentChargesExGst * 100) / 100,
      total_gst_on_statement: totalGst,
    },
    transactions: txRows,
    deliveries_subtotal: { ex_gst: delivExGst, gst: delivGst, inc_gst: delivIncGst },
    cylinder_holdings: cylinderHoldings,
    invoices_in_period: invoicesInPeriod,
  };
}

// ── PDF Generation ───────────────────────────────────────────────────────────

const COLORS = {
  black: "#000000",
  dark: "#1a1a1a",
  mid: "#444444",
  muted: "#888888",
  light: "#cccccc",
  accent: "#1e40af",
  headerBg: "#1e3a5f",
  altRow: "#f5f7fa",
  totalRow: "#e8edf5",
};

function generateStatementPdf(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const M = 45; // page margin
      const W = 595 - M * 2; // usable width

      // ── Page 1: Account Statement Summary ─────────────────────────────────
      drawPage1(doc, data, M, W);

      // ── Page 2+: Transaction Detail ────────────────────────────────────────
      if (data.transactions.length > 0) {
        doc.addPage({ margin: 0 });
        drawTransactionPages(doc, data, M, W);
      }

      // ── Cylinder Holdings ──────────────────────────────────────────────────
      if (data.cylinder_holdings.length > 0) {
        doc.addPage({ margin: 0 });
        drawHoldingsPage(doc, data, M, W);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Page header band ─────────────────────────────────────────────────────────
function drawPageHeader(doc, data, M, W, subtitle) {
  const bizName = data.settings.business_name || "CylinderTrack";
  const bizAbn  = data.settings.abn ? `ABN: ${data.settings.abn}` : "";

  // Top colour band
  doc.rect(0, 0, 595, 58).fill(COLORS.headerBg);

  doc.fontSize(16).font("Helvetica-Bold").fillColor("#ffffff");
  doc.text(bizName, M, 16, { width: 320 });
  if (bizAbn) {
    doc.fontSize(8).font("Helvetica").fillColor("#b0c4de").text(bizAbn, M, 36);
  }

  // Right-side subtitle
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#ffffff");
  doc.text(subtitle || "ACCOUNT STATEMENT", M + 260, 20, { width: 250, align: "right" });
  doc.fontSize(8).font("Helvetica").fillColor("#b0c4de");
  doc.text(`Period: ${fmtDateShort(data.period.from)} – ${fmtDateShort(data.period.to)}`,
    M + 260, 35, { width: 250, align: "right" });

  return 70; // Y position after header
}

// ── Page 1 ───────────────────────────────────────────────────────────────────
function drawPage1(doc, data, M, W) {
  const { customer, summary } = data;

  let y = drawPageHeader(doc, data, M, W, "ACCOUNT STATEMENT SUMMARY");

  doc.fontSize(14).font("Helvetica-Bold").fillColor(COLORS.dark);
  doc.text("ACCOUNT STATEMENT SUMMARY", M, y + 8);
  y += 30;

  // Two-column info block
  const col1 = M;
  const col2 = M + 220;
  const infoW = 180;

  const infoLines = [
    ["Statement Date:", fmtDateShort(data.statement_date)],
    ["Customer:", customer.name || "—"],
    ["Address:", customer.address || "—"],
    ["Account Code:", data.account_code],
    ["Document Reference:", data.document_reference],
    ["Due Date:", fmtDateShort(data.due_date)],
  ];

  doc.fontSize(9);
  for (const [label, value] of infoLines) {
    doc.font("Helvetica-Bold").fillColor(COLORS.mid).text(label, col1, y, { width: 130 });
    doc.font("Helvetica").fillColor(COLORS.dark).text(value, col1 + 135, y, { width: infoW });
    y += 15;
  }

  y += 12;

  // ── Account Summary table ─────────────────────────────────────────────────
  doc.fontSize(10).font("Helvetica-Bold").fillColor(COLORS.dark);
  doc.text("ACCOUNT SUMMARY", M, y);
  y += 14;

  // Table header
  doc.rect(M, y, W, 18).fill(COLORS.headerBg);
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
  doc.text("Description", M + 8, y + 4, { width: W - 130 });
  doc.text("Amount", M + W - 120, y + 4, { width: 112, align: "right" });
  y += 18;

  const summaryRows = [
    ["Balance Brought Forward", summary.balance_brought_forward, false],
    [summary.payments_desc
      ? `Payments Received (${summary.payments_desc})`
      : "Payments Received",
      -summary.payments_received, false],
    ["Balance After Payments", summary.balance_after_payments, true],
    ["Current Charges (ex GST)", summary.current_charges_ex_gst, false],
    ["GST (10%)", summary.current_charges_gst, false],
    ["Total Current Charges (inc GST)", summary.current_charges_inc_gst, false],
  ];

  let odd = false;
  for (const [label, amount, isSubtotal] of summaryRows) {
    if (isSubtotal) {
      doc.rect(M, y, W, 18).fill(COLORS.totalRow);
    } else if (odd) {
      doc.rect(M, y, W, 18).fill(COLORS.altRow);
    }
    doc.fontSize(9).font(isSubtotal ? "Helvetica-Bold" : "Helvetica").fillColor(COLORS.dark);
    doc.text(label, M + 8, y + 4, { width: W - 130 });
    const amtStr = amount < 0
      ? `(${fmtMoneyRaw(Math.abs(amount))})`
      : fmtMoneyRaw(amount);
    doc.text(amtStr, M + W - 120, y + 4, { width: 112, align: "right" });
    y += 18;
    odd = !odd;
  }

  // TOTAL row
  doc.rect(M, y, W, 22).fill(COLORS.headerBg);
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#ffffff");
  doc.text("TOTAL BALANCE DUE", M + 8, y + 5, { width: W - 130 });
  doc.text(fmtMoneyRaw(summary.total_balance_due), M + W - 120, y + 5, { width: 112, align: "right" });
  y += 22;

  y += 20;

  // Bottom summary trio
  const trio = [
    ["Overdue Amount", summary.overdue_amount],
    ["Current Bill (ex GST)", summary.current_bill],
    ["Total GST on Statement", summary.total_gst_on_statement],
  ];
  const trioW = W / 3;
  for (let i = 0; i < trio.length; i++) {
    const bx = M + i * trioW;
    doc.rect(bx + 4, y, trioW - 8, 44).fillAndStroke(COLORS.altRow, COLORS.light);
    doc.fontSize(8).font("Helvetica").fillColor(COLORS.muted);
    doc.text(trio[i][0], bx + 10, y + 6, { width: trioW - 20 });
    doc.fontSize(13).font("Helvetica-Bold").fillColor(COLORS.accent);
    doc.text(fmtMoneyRaw(trio[i][1]), bx + 10, y + 20, { width: trioW - 20 });
  }
}

// ── Transaction Detail Pages ──────────────────────────────────────────────────
function drawTransactionPages(doc, data, M, W) {
  let y = drawPageHeader(doc, data, M, W, "DELIVERY TRANSACTIONS");

  doc.fontSize(11).font("Helvetica-Bold").fillColor(COLORS.dark);
  doc.text("DELIVERY TRANSACTIONS", M, y + 4);
  doc.fontSize(8).font("Helvetica").fillColor(COLORS.muted);
  doc.text(`${fmtDateShort(data.period.from)} to ${fmtDateShort(data.period.to)}`, M, y + 18);
  y += 34;

  // Column layout
  const cols = {
    date:   { x: M,           w: 55 },
    ref:    { x: M + 55,      w: 65 },
    desc:   { x: M + 120,     w: 120 },
    del:    { x: M + 240,     w: 35 },
    ret:    { x: M + 275,     w: 35 },
    exgst:  { x: M + 310,     w: 70 },
    gst:    { x: M + 380,     w: 60 },
    incgst: { x: M + 440,     w: W - 440 + M - M },
  };
  cols.incgst.w = M + W - cols.incgst.x;

  function drawTxHeader(yy) {
    doc.rect(M, yy, W, 16).fill(COLORS.headerBg);
    doc.fontSize(7.5).font("Helvetica-Bold").fillColor("#ffffff");
    doc.text("Date",          cols.date.x + 3,  yy + 3, { width: cols.date.w });
    doc.text("Reference",     cols.ref.x + 3,   yy + 3, { width: cols.ref.w });
    doc.text("Description",   cols.desc.x + 3,  yy + 3, { width: cols.desc.w });
    doc.text("Del",           cols.del.x,        yy + 3, { width: cols.del.w, align: "right" });
    doc.text("Ret",           cols.ret.x,        yy + 3, { width: cols.ret.w, align: "right" });
    doc.text("Ex GST",        cols.exgst.x,      yy + 3, { width: cols.exgst.w, align: "right" });
    doc.text("GST",           cols.gst.x,        yy + 3, { width: cols.gst.w, align: "right" });
    doc.text("Inc GST",       cols.incgst.x,     yy + 3, { width: cols.incgst.w, align: "right" });
    return yy + 16;
  }

  y = drawTxHeader(y);

  let odd = false;
  for (const tx of data.transactions) {
    if (y > 770) {
      doc.addPage({ margin: 0 });
      drawPageHeader(doc, data, M, W, "DELIVERY TRANSACTIONS (cont'd)");
      y = 75;
      y = drawTxHeader(y);
      odd = false;
    }

    if (odd) doc.rect(M, y, W, 14).fill(COLORS.altRow);

    doc.fontSize(7.5).font("Helvetica").fillColor(COLORS.dark);
    doc.text(fmtDate(tx.date),           cols.date.x + 3,  y + 3, { width: cols.date.w - 3 });
    doc.text(String(tx.reference || "—").substring(0, 14), cols.ref.x + 3, y + 3, { width: cols.ref.w - 3 });
    doc.text(tx.description || "—",     cols.desc.x + 3,  y + 3, { width: cols.desc.w - 3 });
    doc.text(String(tx.qty_delivered),   cols.del.x,        y + 3, { width: cols.del.w, align: "right" });
    doc.text(tx.qty_return !== 0 ? String(tx.qty_return) : "—",
                                         cols.ret.x,        y + 3, { width: cols.ret.w, align: "right" });
    doc.text(fmtMoneyRaw(tx.line_total_ex_gst), cols.exgst.x, y + 3, { width: cols.exgst.w, align: "right" });
    doc.text(fmtMoneyRaw(tx.gst),        cols.gst.x,        y + 3, { width: cols.gst.w, align: "right" });
    doc.text(fmtMoneyRaw(tx.total_inc_gst), cols.incgst.x,  y + 3, { width: cols.incgst.w, align: "right" });

    y += 14;
    odd = !odd;
  }

  // Subtotal row
  y += 4;
  doc.moveTo(M, y).lineTo(M + W, y).strokeColor(COLORS.light).lineWidth(0.5).stroke();
  y += 6;
  doc.rect(M, y, W, 18).fill(COLORS.totalRow);
  doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.dark);
  doc.text("Deliveries Subtotal",        M + 8,             y + 4, { width: 200 });
  doc.text(fmtMoneyRaw(data.deliveries_subtotal.ex_gst),
                                         cols.exgst.x,      y + 4, { width: cols.exgst.w, align: "right" });
  doc.text(fmtMoneyRaw(data.deliveries_subtotal.gst),
                                         cols.gst.x,        y + 4, { width: cols.gst.w, align: "right" });
  doc.text(fmtMoneyRaw(data.deliveries_subtotal.inc_gst),
                                         cols.incgst.x,     y + 4, { width: cols.incgst.w, align: "right" });
  y += 28;

  // ── Section Total ───────────────────────────────────────────────────────
  doc.rect(M, y, W, 20).fill(COLORS.headerBg);
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
  doc.text("DELIVERY TOTAL",             M + 8, y + 5, { width: 200 });
  doc.text(fmtMoneyRaw(data.deliveries_subtotal.ex_gst), cols.exgst.x, y + 5, { width: cols.exgst.w, align: "right" });
  doc.text(fmtMoneyRaw(data.deliveries_subtotal.gst),    cols.gst.x,   y + 5, { width: cols.gst.w,   align: "right" });
  doc.text(fmtMoneyRaw(data.deliveries_subtotal.inc_gst),cols.incgst.x,y + 5, { width: cols.incgst.w, align: "right" });
}

// ── Cylinder Holdings Page ───────────────────────────────────────────────────
function drawHoldingsPage(doc, data, M, W) {
  let y = drawPageHeader(doc, data, M, W, "CYLINDER HOLDINGS");

  doc.fontSize(11).font("Helvetica-Bold").fillColor(COLORS.dark);
  doc.text(`CYLINDER HOLDINGS AS AT ${fmtDateShort(data.statement_date).toUpperCase()}`, M, y + 4);
  y += 28;

  // Table header
  const cols = {
    type:    { x: M,           w: 200 },
    opening: { x: M + 200,     w: 120 },
    held:    { x: M + 320,     w: 185 },
  };

  doc.rect(M, y, W, 18).fill(COLORS.headerBg);
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
  doc.text("Cylinder Type",  cols.type.x + 8,    y + 4, { width: cols.type.w });
  doc.text("Opening Qty",    cols.opening.x,      y + 4, { width: cols.opening.w, align: "center" });
  doc.text("Qty Held",       cols.held.x,         y + 4, { width: cols.held.w, align: "center" });
  y += 18;

  let odd = false;
  for (const h of data.cylinder_holdings) {
    if (odd) doc.rect(M, y, W, 18).fill(COLORS.altRow);
    doc.fontSize(9).font("Helvetica").fillColor(COLORS.dark);
    doc.text(h.label || "—",            cols.type.x + 8,  y + 4, { width: cols.type.w });
    doc.text(String(h.opening_qty || 0),cols.opening.x,   y + 4, { width: cols.opening.w, align: "center" });
    doc.text(String(h.qty_held || 0),   cols.held.x,      y + 4, { width: cols.held.w, align: "center" });
    y += 18;
    odd = !odd;
  }

  // Footer note
  y += 20;
  doc.fontSize(8).font("Helvetica").fillColor(COLORS.muted);
  doc.text("Opening Qty = Cylinder count as at beginning of statement period. Qty Held = Count as at statement date.", M, y, { width: W });
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { generateStatementData, generateStatementPdf };
