// CylinderTrack — email helper module
// Wraps the Resend REST API. Generates HTML + plain-text invoice emails and
// an A4 PDF attachment using business settings stored in the database.

const fetch = require("node-fetch");
const PDFDocument = require("pdfkit");

// ── Config ────────────────────────────────────────────────────────────────────
function getConfig() {
  return {
    apiKey:   process.env.RESEND_API_KEY || "",
    fromAddr: process.env.EMAIL_FROM_ADDRESS || "",
    fromName: process.env.EMAIL_FROM_NAME || "CylinderTrack",
    testMode: process.env.EMAIL_TEST_MODE === "1",
    enabled:  !!process.env.RESEND_API_KEY,
  };
}
function isEmailEnabled() { return getConfig().enabled; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const GST_RATE = 0.10;
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const gross = (n) => Math.round((n || 0) * (1 + GST_RATE) * 100) / 100;
const esc = (s) => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// ── HTML email body ───────────────────────────────────────────────────────────
// invoice.orderSections = [{order, lines}], invoice.rentalLines = [{...}],
// invoice.lines = flat fallback, invoice.subtotal/gst/grandTotal
// settings = { business_name, business_abn, business_address, business_phone,
//              business_email, business_bank, business_logo, invoice_notes,
//              email_signature }
function buildInvoiceHtml(invoice, customer, settings = {}, options = {}) {
  const { paymentUrl } = options;
  const s = settings;
  const isCommercial = (customer?.customer_category || "").toLowerCase() === "commercial";

  const bizName    = s.business_name    || "";
  const bizABN     = s.business_abn     || "";
  const bizAddress = s.business_address || "";
  const bizPhone   = s.business_phone   || "";
  const bizEmail   = s.business_email   || "";
  const bizBank    = s.business_bank    || "";
  const bizLogo    = s.business_logo    || "";
  const invNotes   = s.invoice_notes    || "";
  const signature  = (s.email_signature || `Best regards,\n${bizName || "CylinderTrack"}`).trim();

  const custName   = (customer?.name || customer?.contact || invoice.customer_name || "").trim();
  const custAddr   = [customer?.address, customer?.state].filter(Boolean).join(", ");
  const custABN    = customer?.abn || "";
  const custAcct   = customer?.account_number || "";
  const custEmail  = customer?.accounts_email || customer?.email || "";

  const today = new Date().toISOString().split("T")[0];
  const isOverdue  = invoice.due_date && invoice.due_date < today && invoice.status === "open";

  // Build line item rows HTML
  const displayPrice = (net) => isCommercial ? fmt(net) : fmt(gross(net));
  let lineRowsHtml = "";

  const orderSections = invoice.orderSections || [];
  const rentalLines   = invoice.rentalLines   || [];
  const flatLines     = invoice.lines         || [];

  if (orderSections.length > 0 || rentalLines.length > 0) {
    for (const sec of orderSections) {
      const orderRef = [
        sec.order?.order_number ? `Order ${sec.order.order_number}` : "",
        sec.order?.order_date || "",
        sec.order?.po_number ? `PO: ${sec.order.po_number}` : "",
      ].filter(Boolean).join(" — ");
      lineRowsHtml += `<tr><td colspan="4" style="padding:8px 12px 4px; font-size:11px; font-weight:700; color:#1d4ed8; text-transform:uppercase; background:#eff6ff; border-bottom:1px solid #bfdbfe">${esc(orderRef) || "Order"}</td></tr>`;
      for (const l of (sec.lines || [])) {
        lineRowsHtml += `
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:7px 12px; font-size:12px; color:#1e293b">${esc(l.cylinder_label || "—")}</td>
            <td style="padding:7px 12px; font-size:12px; color:#1e293b; text-align:right">${l.qty}</td>
            <td style="padding:7px 12px; font-size:12px; color:#1e293b; text-align:right">${displayPrice(l.unit_price)}</td>
            <td style="padding:7px 12px; font-size:12px; font-weight:600; color:#1e293b; text-align:right">${displayPrice(l.line_total)}</td>
          </tr>`;
      }
    }
    if (rentalLines.length > 0) {
      lineRowsHtml += `<tr><td colspan="4" style="padding:8px 12px 4px; font-size:11px; font-weight:700; color:#1d4ed8; text-transform:uppercase; background:#eff6ff; border-bottom:1px solid #bfdbfe">Rental Charges</td></tr>`;
      for (const l of rentalLines) {
        lineRowsHtml += `
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:7px 12px; font-size:12px; color:#1e293b">${esc(l.cylinder_label || "—")}</td>
            <td style="padding:7px 12px; font-size:12px; color:#1e293b; text-align:right">${l.qty}</td>
            <td style="padding:7px 12px; font-size:12px; color:#1e293b; text-align:right">${l.unit_price != null ? displayPrice(l.unit_price) : "—"}</td>
            <td style="padding:7px 12px; font-size:12px; font-weight:600; color:#1e293b; text-align:right">${displayPrice(l.line_total != null ? l.line_total : l.amount)}</td>
          </tr>`;
      }
    }
  } else {
    for (const l of flatLines) {
      lineRowsHtml += `
        <tr style="border-bottom:1px solid #e2e8f0">
          <td style="padding:7px 12px; font-size:12px; color:#1e293b">${esc(l.cylinder_label || "—")}</td>
          <td style="padding:7px 12px; font-size:12px; color:#1e293b; text-align:right">${l.qty}</td>
          <td style="padding:7px 12px; font-size:12px; color:#1e293b; text-align:right">${displayPrice(l.unit_price)}</td>
          <td style="padding:7px 12px; font-size:12px; font-weight:600; color:#1e293b; text-align:right">${displayPrice(l.line_total)}</td>
        </tr>`;
    }
  }

  if (!lineRowsHtml) {
    lineRowsHtml = `<tr><td colspan="4" style="padding:12px; font-size:12px; color:#94a3b8; text-align:center">No line items</td></tr>`;
  }

  const subtotal   = Number(invoice.subtotal || invoice.total || 0);
  const gstAmt     = Math.round(subtotal * GST_RATE * 100) / 100;
  const grandTotal = Math.round((subtotal + gstAmt) * 100) / 100;
  const paid       = gross(invoice.amount_paid || 0);
  const owed       = Math.max(0, Math.round((grandTotal - paid) * 100) / 100);

  const totalsHtml = isCommercial
    ? `<tr><td style="font-size:12px;color:#475569;padding:4px 12px 4px 0">Subtotal (ex GST)</td><td style="font-size:12px;color:#1e293b;text-align:right;padding:4px 0">${fmt(subtotal)}</td></tr>
       <tr><td style="font-size:12px;color:#475569;padding:4px 12px 4px 0">GST (10%)</td><td style="font-size:12px;color:#1e293b;text-align:right;padding:4px 0">${fmt(gstAmt)}</td></tr>
       <tr style="border-top:2px solid #1d4ed8"><td style="font-size:15px;font-weight:800;color:#1d4ed8;padding:8px 12px 4px 0">TOTAL (inc GST)</td><td style="font-size:15px;font-weight:800;color:#1d4ed8;text-align:right;padding:8px 0 4px">${fmt(grandTotal)}</td></tr>`
    : `<tr><td style="font-size:11px;color:#64748b;padding:4px 12px 4px 0">Includes GST of</td><td style="font-size:11px;color:#64748b;text-align:right;padding:4px 0">${fmt(gstAmt)}</td></tr>
       <tr style="border-top:2px solid #1d4ed8"><td style="font-size:15px;font-weight:800;color:#1d4ed8;padding:8px 12px 4px 0">TOTAL (inc GST)</td><td style="font-size:15px;font-weight:800;color:#1d4ed8;text-align:right;padding:8px 0 4px">${fmt(grandTotal)}</td></tr>`;

  const paymentHtml = paymentUrl ? `
    <div style="margin:20px 0;text-align:center">
      <a href="${esc(paymentUrl)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:13px 32px;border-radius:6px;font-weight:700;font-size:14px;text-decoration:none">Pay Now Online</a>
      <div style="margin-top:6px;font-size:11px;color:#64748b">Secure payment via Stripe</div>
    </div>` : "";

  const notesHtml = invNotes ? `
    <div style="margin:16px 0;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;color:#475569;white-space:pre-wrap">${esc(invNotes)}</div>` : "";

  const bankHtml = bizBank ? `
    <div style="margin:16px 0;padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#1d4ed8;margin-bottom:6px;letter-spacing:0.05em">Payment Details</div>
      <div style="font-size:12px;color:#334155;white-space:pre-wrap">${esc(bizBank)}</div>
    </div>` : "";

  const sigLines = signature.split("\n").map(l => esc(l)).join("<br>");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:32px 0">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;max-width:100%">
  <!-- Header band -->
  <tr><td style="background:#1d4ed8;padding:22px 28px">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td>
        ${bizLogo ? `<img src="${bizLogo}" height="48" style="max-height:48px;max-width:160px;display:block;object-fit:contain;margin-bottom:8px">` : ""}
        <div style="font-size:20px;font-weight:900;color:#ffffff;line-height:1.2">${esc(bizName) || "TAX INVOICE"}</div>
        ${bizABN ? `<div style="font-size:10px;color:#bfdbfe;margin-top:2px">ABN: ${esc(bizABN)}</div>` : ""}
      </td>
      <td align="right" style="vertical-align:top">
        <div style="font-size:10px;color:#bfdbfe;text-transform:uppercase;letter-spacing:0.06em">TAX INVOICE</div>
        <div style="font-size:22px;font-weight:900;color:#ffffff">${esc(invoice.invoice_number || "")}</div>
      </td>
    </tr>
    </table>
  </td></tr>
  <!-- Sub-header: biz details + bill-to -->
  <tr><td style="background:#eff6ff;padding:14px 28px;border-bottom:1px solid #bfdbfe">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="vertical-align:top;width:50%">
        <div style="font-size:11px;color:#64748b;line-height:1.7">
          ${bizAddress ? `${esc(bizAddress)}<br>` : ""}
          ${bizPhone   ? `Ph: ${esc(bizPhone)}${bizEmail ? " &nbsp;|&nbsp; " : "<br>"}` : ""}
          ${bizEmail   ? `${esc(bizEmail)}<br>` : ""}
        </div>
      </td>
      <td style="vertical-align:top;text-align:right">
        <div style="font-size:10px;color:#1d4ed8;font-weight:700;text-transform:uppercase;margin-bottom:4px">Bill To</div>
        <div style="font-size:13px;font-weight:700;color:#1e293b">${esc(custName) || "—"}</div>
        <div style="font-size:11px;color:#475569;line-height:1.7">
          ${custABN  ? `ABN: ${esc(custABN)}<br>` : ""}
          ${custAddr ? `${esc(custAddr)}<br>` : ""}
          ${custAcct ? `Account: ${esc(custAcct)}<br>` : ""}
          ${custEmail ? `${esc(custEmail)}` : ""}
        </div>
      </td>
    </tr>
    </table>
  </td></tr>
  <!-- Invoice meta row -->
  <tr><td style="padding:14px 28px;background:#f8fafc;border-bottom:1px solid #e2e8f0">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="text-align:center;width:25%">
        <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase">Invoice Date</div>
        <div style="font-size:13px;color:#1e293b;font-weight:600;margin-top:3px">${esc(invoice.invoice_date || "")}</div>
      </td>
      <td style="text-align:center;width:25%">
        <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase">Due Date</div>
        <div style="font-size:13px;font-weight:700;margin-top:3px;color:${isOverdue ? "#dc2626" : "#1e293b"}">${esc(invoice.due_date || "—")}${isOverdue ? ' <span style="background:#dc2626;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px">OVERDUE</span>' : ""}</div>
      </td>
      <td style="text-align:center;width:25%">
        <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase">Amount Due</div>
        <div style="font-size:16px;font-weight:800;margin-top:3px;color:${owed > 0 ? "#dc2626" : "#16a34a"}">${fmt(owed)}</div>
      </td>
      <td style="text-align:center;width:25%">
        <div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase">Status</div>
        <div style="display:inline-block;margin-top:4px;padding:2px 10px;border-radius:3px;font-size:10px;font-weight:700;text-transform:uppercase;
          background:${invoice.status==="paid"?"#dcfce7":invoice.status==="void"?"#f1f5f9":"#fef3c7"};
          color:${invoice.status==="paid"?"#15803d":invoice.status==="void"?"#64748b":"#b45309"}">${esc(invoice.status||"open")}</div>
      </td>
    </tr>
    </table>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:24px 28px">
    <p style="margin:0 0 18px;font-size:14px;color:#334155">Hi ${esc(custName) || "there"},</p>
    <p style="margin:0 0 20px;font-size:13px;color:#475569">Please find your invoice details below. A PDF copy is attached to this email for your records.</p>
    <!-- Line items -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:16px">
      <thead>
        <tr style="background:#1d4ed8">
          <th align="left" style="padding:8px 12px;font-size:11px;color:#ffffff;text-transform:uppercase">Item</th>
          <th align="right" style="padding:8px 12px;font-size:11px;color:#ffffff;text-transform:uppercase">Qty</th>
          <th align="right" style="padding:8px 12px;font-size:11px;color:#ffffff;text-transform:uppercase">Unit${isCommercial ? " (ex GST)" : ""}</th>
          <th align="right" style="padding:8px 12px;font-size:11px;color:#ffffff;text-transform:uppercase">Amount</th>
        </tr>
      </thead>
      <tbody>${lineRowsHtml}</tbody>
    </table>
    <!-- Totals -->
    <table align="right" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
      ${totalsHtml}
    </table>
    <div style="clear:both"></div>
    ${paymentHtml}
    ${notesHtml}
    ${bankHtml}
    <p style="margin:24px 0 0;font-size:13px;color:#334155;white-space:pre-wrap;line-height:1.6">${sigLines}</p>
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 28px;text-align:center">
    <div style="font-size:11px;color:#94a3b8">${esc(bizName) || "CylinderTrack"}${bizEmail ? ` &nbsp;·&nbsp; ${esc(bizEmail)}` : ""}${bizPhone ? ` &nbsp;·&nbsp; ${esc(bizPhone)}` : ""}</div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Plain-text email fallback ─────────────────────────────────────────────────
function buildInvoiceText(invoice, customer, options = {}) {
  const { paymentUrl } = options;
  const custName  = (customer?.name || customer?.contact || invoice.customer_name || "").trim();
  const isCommercial = (customer?.customer_category || "").toLowerCase() === "commercial";
  const displayPrice = (net) => isCommercial ? fmt(net) : fmt(gross(net));

  const lines = [];
  lines.push(`Hi${custName ? ` ${custName}` : ""},`);
  lines.push("");
  lines.push("Please find your invoice details below. A PDF copy is attached.");
  lines.push("");
  lines.push(`Invoice Number : ${invoice.invoice_number || "—"}`);
  lines.push(`Invoice Date   : ${invoice.invoice_date  || "—"}`);
  lines.push(`Due Date       : ${invoice.due_date       || "—"}`);
  lines.push(`Status         : ${invoice.status        || "open"}`);
  lines.push("");

  const orderSections = invoice.orderSections || [];
  const rentalLines   = invoice.rentalLines   || [];
  const flatLines     = invoice.lines         || [];

  if (orderSections.length > 0 || rentalLines.length > 0) {
    for (const sec of orderSections) {
      const ref = [sec.order?.order_number && `Order ${sec.order.order_number}`, sec.order?.order_date, sec.order?.po_number && `PO: ${sec.order.po_number}`].filter(Boolean).join(" — ");
      lines.push(`── ${ref || "Order"} ──`);
      for (const l of (sec.lines || [])) {
        lines.push(`  ${l.cylinder_label || "—"}  ×${l.qty}  @ ${displayPrice(l.unit_price)}  = ${displayPrice(l.line_total)}`);
      }
      lines.push("");
    }
    if (rentalLines.length > 0) {
      lines.push("── Rental Charges ──");
      for (const l of rentalLines) {
        lines.push(`  ${l.cylinder_label || "—"}  ×${l.qty}  @ ${l.unit_price != null ? displayPrice(l.unit_price) : "—"}  = ${displayPrice(l.line_total != null ? l.line_total : l.amount)}`);
      }
      lines.push("");
    }
  } else {
    lines.push("Items:");
    for (const l of flatLines) {
      lines.push(`  ${l.cylinder_label || "—"}  ×${l.qty}  @ ${displayPrice(l.unit_price)}  = ${displayPrice(l.line_total)}`);
    }
    lines.push("");
  }

  const subtotal   = Number(invoice.subtotal || invoice.total || 0);
  const gstAmt     = Math.round(subtotal * GST_RATE * 100) / 100;
  const grandTotal = Math.round((subtotal + gstAmt) * 100) / 100;

  if (isCommercial) {
    lines.push(`Subtotal (ex GST)  : ${fmt(subtotal)}`);
    lines.push(`GST (10%)          : ${fmt(gstAmt)}`);
  }
  lines.push(`Total (inc GST)    : ${fmt(grandTotal)}`);
  if ((invoice.amount_paid || 0) > 0) {
    lines.push(`Paid               : ${fmt(gross(invoice.amount_paid))}`);
    const owed = Math.max(0, grandTotal - gross(invoice.amount_paid));
    lines.push(`Balance Due        : ${fmt(owed)}`);
  }
  lines.push("");
  if (paymentUrl) {
    lines.push("────────────────────────────");
    lines.push("Pay online now:");
    lines.push(paymentUrl);
    lines.push("────────────────────────────");
    lines.push("");
  }
  if (invoice.invoice_notes_text) {
    lines.push(invoice.invoice_notes_text);
    lines.push("");
  }
  lines.push("Please remit payment as per your usual arrangement.");
  lines.push("");
  lines.push("Thank you for your business.");
  return lines.join("\n");
}

// ── PDF attachment (attached to email AND used for print-quality PDF) ─────────
function generateInvoicePdf(invoice, customer, settings = {}) {
  return new Promise((resolve, reject) => {
    try {
      const s = settings;
      const isCommercial = (customer?.customer_category || "").toLowerCase() === "commercial";
      const displayPrice = (net) => isCommercial ? fmt(net) : fmt(gross(net));

      const bizName    = s.business_name    || "";
      const bizABN     = s.business_abn     || "";
      const bizAddress = s.business_address || "";
      const bizPhone   = s.business_phone   || "";
      const bizEmail   = s.business_email   || "";
      const bizBank    = s.business_bank    || "";
      const bizLogo    = s.business_logo    || "";
      const invNotes   = s.invoice_notes    || "";

      const custName = (customer?.name || customer?.contact || invoice.customer_name || "").trim();
      const custAddr = [customer?.address, customer?.state].filter(Boolean).join(", ");
      const custABN  = customer?.abn || "";
      const custAcct = customer?.account_number || "";

      const BRAND   = "#1d4ed8";
      const BRAND_L = "#dbeafe";
      const DARK    = "#1e293b";
      const MID     = "#475569";
      const LIGHT   = "#f0f7ff";

      const subtotal   = Number(invoice.subtotal || invoice.total || 0);
      const gstAmt     = Math.round(subtotal * GST_RATE * 100) / 100;
      const grandTotal = Math.round((subtotal + gstAmt) * 100) / 100;
      const paid       = gross(invoice.amount_paid || 0);
      const owed       = Math.max(0, Math.round((grandTotal - paid) * 100) / 100);

      const today = new Date().toISOString().split("T")[0];
      const isOverdue = invoice.due_date && invoice.due_date < today && invoice.status === "open";

      const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const M = 45, PW = 595;
      const W = PW - M * 2;

      // ── Header band ─────────────────────────────────────────────────────────
      doc.rect(0, 0, PW, 72).fill(BRAND);

      // Logo (base64 data URL)
      let logoBottom = 16;
      if (bizLogo && bizLogo.startsWith("data:image/")) {
        try {
          const logoData = Buffer.from(bizLogo.split(",")[1], "base64");
          doc.image(logoData, M, 12, { fit: [120, 44] });
          logoBottom = 60;
        } catch (e) { /* skip broken logo */ }
      }

      doc.fontSize(bizLogo ? 11 : 20).font("Helvetica-Bold").fillColor("#ffffff");
      doc.text(bizName || "TAX INVOICE", M, bizLogo ? logoBottom - 14 : 22, { width: 280 });

      // Invoice number top-right
      doc.fontSize(8).font("Helvetica").fillColor("#bfdbfe")
        .text("TAX INVOICE", M + W - 140, 16, { width: 140, align: "right" });
      doc.fontSize(18).font("Helvetica-Bold").fillColor("#ffffff")
        .text(invoice.invoice_number || "", M + W - 140, 28, { width: 140, align: "right" });

      // ── Sub-header: biz details + bill-to ───────────────────────────────────
      doc.rect(0, 72, PW, 68).fill(LIGHT);
      doc.rect(0, 139, PW, 1).fill(BRAND_L);

      let y = 78;
      doc.fontSize(8).font("Helvetica").fillColor(MID);
      if (bizAddress) { doc.text(bizAddress, M, y, { width: 240 }); y = doc.y + 2; }
      if (bizPhone)   { doc.text(`Ph: ${bizPhone}`, M, y, { width: 240 }); y = doc.y + 2; }
      if (bizEmail)   { doc.text(bizEmail, M, y, { width: 240 }); y = doc.y + 2; }
      if (bizABN)     { doc.text(`ABN: ${bizABN}`, M, y, { width: 240 }); }

      // Bill To (right column)
      doc.fontSize(7).font("Helvetica-Bold").fillColor(BRAND).text("BILL TO", M + 270, 80, { width: W - 270 });
      doc.fontSize(11).font("Helvetica-Bold").fillColor(DARK).text(custName || "—", M + 270, 92, { width: W - 270 });
      doc.fontSize(9).font("Helvetica").fillColor(MID);
      if (custABN)  doc.text(`ABN: ${custABN}`, M + 270, doc.y + 2, { width: W - 270 });
      if (custAddr) doc.text(custAddr, M + 270, doc.y + 2, { width: W - 270 });
      if (custAcct) doc.text(`Account: ${custAcct}`, M + 270, doc.y + 2, { width: W - 270 });

      // ── Meta row: date / due / amount ────────────────────────────────────────
      y = 148;
      const metaCols = [
        ["Invoice Date", invoice.invoice_date || "—", false],
        ["Due Date", (invoice.due_date || "—") + (isOverdue ? "  OVERDUE" : ""), isOverdue],
        ["Amount Due", fmt(owed), owed > 0],
        ["Status", (invoice.status || "open").toUpperCase(), false],
      ];
      const metaW = W / metaCols.length;
      doc.rect(M, y, W, 38).fill("#f8fafc");
      metaCols.forEach(([label, value, warn], i) => {
        const bx = M + i * metaW;
        doc.fontSize(7).font("Helvetica-Bold").fillColor("#64748b")
          .text(label.toUpperCase(), bx + 4, y + 5, { width: metaW - 8, align: "center" });
        doc.fontSize(10).font("Helvetica-Bold").fillColor(warn ? "#dc2626" : DARK)
          .text(value, bx + 4, y + 18, { width: metaW - 8, align: "center" });
      });

      // ── Line items ────────────────────────────────────────────────────────────
      y = 200;
      const colX = { desc: M, qty: M + 270, unit: M + 330, total: M + 420 };
      const colW = { desc: 260, qty: 55, unit: 85, total: W - (colX.total - M) };

      doc.rect(M, y, W, 16).fill(BRAND);
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff");
      doc.text("Description",                                    colX.desc,  y + 3, { width: colW.desc });
      doc.text("Qty",                                            colX.qty,   y + 3, { width: colW.qty,   align: "right" });
      doc.text(isCommercial ? "Unit (ex GST)" : "Unit (inc GST)", colX.unit, y + 3, { width: colW.unit,  align: "right" });
      doc.text(isCommercial ? "Amount (ex)"  : "Amount (inc)",   colX.total, y + 3, { width: colW.total, align: "right" });
      y += 20;

      let odd = true;
      const drawLineRow = (label, qty, unitPrice, lineTotal, isSection = false) => {
        if (y > 740) { doc.addPage({ margin: 0 }); y = 50; }
        if (isSection) {
          doc.rect(M, y - 2, W, 16).fill("#eff6ff");
          doc.fontSize(8).font("Helvetica-Bold").fillColor(BRAND)
            .text(label, M + 6, y + 2, { width: W - 12 });
          y += 18; odd = true; return;
        }
        if (!odd) doc.rect(M, y - 2, W, 16).fill(LIGHT);
        odd = !odd;
        doc.fontSize(9).font("Helvetica").fillColor(DARK);
        doc.text(label,              colX.desc,  y, { width: colW.desc });
        doc.text(String(qty),        colX.qty,   y, { width: colW.qty,   align: "right" });
        doc.text(displayPrice(unitPrice != null ? unitPrice : 0), colX.unit, y, { width: colW.unit, align: "right" });
        doc.text(displayPrice(lineTotal != null ? lineTotal : 0), colX.total, y, { width: colW.total, align: "right" });
        y += 18;
      };

      const orderSections = invoice.orderSections || [];
      const rentalLines   = invoice.rentalLines   || [];
      const flatLines     = invoice.lines         || [];

      if (orderSections.length > 0 || rentalLines.length > 0) {
        for (const sec of orderSections) {
          const ref = [sec.order?.order_number && `Order ${sec.order.order_number}`, sec.order?.order_date, sec.order?.po_number && `PO: ${sec.order.po_number}`].filter(Boolean).join(" — ");
          drawLineRow(ref || "Order", 0, 0, 0, true);
          for (const l of (sec.lines || [])) {
            drawLineRow(l.cylinder_label || "—", l.qty, l.unit_price, l.line_total);
          }
        }
        if (rentalLines.length > 0) {
          drawLineRow("Rental Charges", 0, 0, 0, true);
          for (const l of rentalLines) {
            drawLineRow(l.cylinder_label || "—", l.qty, l.unit_price, l.line_total != null ? l.line_total : l.amount);
          }
        }
      } else {
        for (const l of flatLines) {
          drawLineRow(l.cylinder_label || "—", l.qty, l.unit_price, l.line_total);
        }
      }

      // ── Totals ────────────────────────────────────────────────────────────────
      y += 6;
      doc.moveTo(M + 260, y).lineTo(M + W, y).strokeColor(BRAND_L).lineWidth(0.75).stroke();
      y += 8;

      const totRows = isCommercial
        ? [["Subtotal (excl. GST)", subtotal, false], ["GST (10%)", gstAmt, false], ["TOTAL (incl. GST)", grandTotal, true]]
        : [["TOTAL (incl. GST)", grandTotal, true], [`Includes GST of`, gstAmt, false]];

      if ((invoice.amount_paid || 0) > 0) {
        totRows.push(["Paid", -paid, false]);
        totRows.push(["Balance Due", owed, owed > 0]);
      }

      for (const [label, amount, isBig] of totRows) {
        if (y > 750) { doc.addPage({ margin: 0 }); y = 50; }
        const color = isBig ? BRAND : (amount < 0 ? "#16a34a" : MID);
        doc.font(isBig ? "Helvetica-Bold" : "Helvetica")
          .fontSize(isBig ? 12 : 10)
          .fillColor(color);
        doc.text(label, M + 260, y, { width: colW.qty + colW.unit, align: "right" });
        doc.text(amount < 0 ? `(${fmt(Math.abs(amount))})` : fmt(amount), colX.total, y, { width: colW.total, align: "right" });
        y += isBig ? 18 : 14;
      }

      // ── Invoice notes ────────────────────────────────────────────────────────
      if (invNotes) {
        y += 10;
        doc.rect(M, y, W, 1).fill(BRAND_L);
        y += 8;
        doc.fontSize(9).font("Helvetica").fillColor(MID).text(invNotes, M, y, { width: W });
        y = doc.y + 10;
      }

      // ── Bank details ─────────────────────────────────────────────────────────
      if (bizBank) {
        y += 6;
        doc.rect(M, y, W, 18).fill(LIGHT);
        doc.fontSize(8).font("Helvetica-Bold").fillColor(BRAND)
          .text("PAYMENT DETAILS", M + 8, y + 4, { width: 200 });
        y += 22;
        doc.fontSize(9).font("Helvetica").fillColor(DARK)
          .text(bizBank, M, y, { width: W });
        y = doc.y + 6;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Send via Resend ───────────────────────────────────────────────────────────
async function sendViaResend({ to, subject, text, html, attachments }) {
  const cfg = getConfig();
  if (!cfg.apiKey) return { success: false, error: "RESEND_API_KEY not configured" };
  if (!to) return { success: false, error: "Missing recipient" };

  const fromAddr = cfg.testMode ? "onboarding@resend.dev" : cfg.fromAddr;
  if (!fromAddr) return { success: false, error: "EMAIL_FROM_ADDRESS not configured (and not in test mode)" };
  const from = cfg.fromName ? `${cfg.fromName} <${fromAddr}>` : fromAddr;

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject: subject || "(no subject)",
    text: text || "",
  };
  if (html) payload.html = html;
  if (attachments && attachments.length > 0) {
    payload.attachments = attachments.map(a => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content.toString("base64") : a.content,
    }));
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data?.message || data?.error || `HTTP ${res.status}` };
    return { success: true, message_id: data?.id || "" };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

module.exports = { getConfig, isEmailEnabled, generateInvoicePdf, buildInvoiceHtml, buildInvoiceText, sendViaResend };
