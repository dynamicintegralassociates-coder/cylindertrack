// CylinderTrack — email helper module
// Wraps the Resend REST API and provides a simple text-based PDF generator
// for rental invoices. No SDK dependency — uses node-fetch directly.

const fetch = require("node-fetch");
const PDFDocument = require("pdfkit");

// ────────────────────────────────────────────────────────────────────────────
// Configuration — read from environment with safe defaults.
// ────────────────────────────────────────────────────────────────────────────
function getConfig() {
  return {
    apiKey:    process.env.RESEND_API_KEY || "",
    fromAddr:  process.env.EMAIL_FROM_ADDRESS || "",
    fromName:  process.env.EMAIL_FROM_NAME || "CylinderTrack",
    // When true, the from-address is forced to onboarding@resend.dev (Resend's sandbox).
    // Used while DNS verification is still in progress.
    testMode:  process.env.EMAIL_TEST_MODE === "1",
    enabled:   !!process.env.RESEND_API_KEY,
  };
}

function isEmailEnabled() {
  return getConfig().enabled;
}

// ────────────────────────────────────────────────────────────────────────────
// PDF generation — clean, simple text-based invoice.
// Returns a Buffer.
// ────────────────────────────────────────────────────────────────────────────
function generateInvoicePdf(invoice, customer) {
  return new Promise((resolve, reject) => {
    try {
      const GST_RATE = 0.10;
      const isCommercial = (customer?.customer_category || "").toLowerCase() === "commercial";
      const gross = (net) => Math.round((net || 0) * (1 + GST_RATE) * 100) / 100;
      const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;

      const BRAND   = "#1d4ed8"; // deep blue
      const BRAND_L = "#dbeafe"; // light blue (stripe)
      const DARK    = "#1e293b";
      const MID     = "#475569";
      const PAID_G  = "#16a34a";

      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // ── Coloured header band ─────────────────────────────────────────────
      doc.rect(0, 0, 595, 72).fill(BRAND);
      doc.fontSize(22).font("Helvetica-Bold").fillColor("#ffffff")
        .text("TAX INVOICE", 50, 22, { align: "left" });
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#bfdbfe")
        .text(`${invoice.invoice_number || ""}`, 50, 46, { align: "right", width: 495 });

      // ── Invoice meta (below band) ────────────────────────────────────────
      let y = 84;
      doc.fontSize(9).font("Helvetica").fillColor(MID);
      doc.text(`Invoice Date: ${invoice.invoice_date || ""}`, 50, y);
      doc.text(isCommercial ? "Prices EXCLUDING GST" : "Prices INCLUDING GST", 50, y + 11);

      // ── Customer block ───────────────────────────────────────────────────
      doc.fontSize(8).font("Helvetica-Bold").fillColor(BRAND)
        .text("BILL TO", 350, y);
      doc.fontSize(11).font("Helvetica-Bold").fillColor(DARK);
      if (customer?.name) doc.text(customer.name, 350, y + 10);
      doc.fontSize(10).font("Helvetica").fillColor(MID);
      if (customer?.company_name) doc.text(customer.company_name, 350, doc.y, { lineBreak: false });
      if (customer?.address) doc.text(customer.address, 350);
      if (customer?.account_number) doc.text(`Account: ${customer.account_number}`, 350);

      // ── Divider ──────────────────────────────────────────────────────────
      y = Math.max(doc.y, y + 40) + 10;
      doc.moveTo(50, y).lineTo(545, y).strokeColor(BRAND_L).lineWidth(1.5).stroke();
      y += 12;

      // ── Line items table header ──────────────────────────────────────────
      const colX = { desc: 50, qty: 320, unit: 380, total: 470 };
      doc.rect(50, y, 495, 16).fill(BRAND);
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
      doc.text("Description",                                  colX.desc, y + 3, { width: 260 });
      doc.text("Qty",                                          colX.qty,  y + 3, { width: 50,  align: "right" });
      doc.text(isCommercial ? "Unit (ex GST)" : "Unit (inc GST)", colX.unit, y + 3, { width: 80, align: "right" });
      doc.text(isCommercial ? "Amount (ex)"  : "Amount (inc)", colX.total, y + 3, { width: 75, align: "right" });
      y += 20;

      // ── Line item rows ───────────────────────────────────────────────────
      const lines = invoice.lines || [];
      let rowOdd = true;
      for (const line of lines) {
        if (y > 720) { doc.addPage(); y = 50; }
        if (!rowOdd) {
          doc.rect(50, y - 2, 495, 16).fill(BRAND_L);
        }
        rowOdd = !rowOdd;
        const desc = `${line.cylinder_label || line.label || "Cylinder"} — Cylinder Rental`;
        const qty = String(line.qty || line.on_hand || 0);
        const netUnit  = Number(line.unit_price || 0);
        const netTotal = Number(line.line_total || (netUnit * (line.qty || line.on_hand)) || 0);
        const displayUnit  = isCommercial ? fmt(netUnit)  : fmt(gross(netUnit));
        const displayTotal = isCommercial ? fmt(netTotal) : fmt(gross(netTotal));
        doc.fontSize(10).font("Helvetica").fillColor(DARK);
        doc.text(desc,         colX.desc, y, { width: 260 });
        doc.text(qty,          colX.qty,  y, { width: 50,  align: "right" });
        doc.text(displayUnit,  colX.unit, y, { width: 80,  align: "right" });
        doc.text(displayTotal, colX.total, y, { width: 75,  align: "right" });
        y += 18;
      }

      // ── Totals ───────────────────────────────────────────────────────────
      y += 8;
      doc.moveTo(360, y).lineTo(545, y).strokeColor(BRAND).lineWidth(1).stroke();
      y += 10;
      const subtotal   = Number(invoice.subtotal || invoice.total || 0);
      const gst        = Math.round(subtotal * GST_RATE * 100) / 100;
      const grandTotal = Math.round((subtotal + gst) * 100) / 100;

      if (isCommercial) {
        doc.fontSize(10).font("Helvetica").fillColor(MID);
        doc.text("Subtotal (excl. GST):", 360, y, { width: 110, align: "right" });
        doc.text(fmt(subtotal), 470, y, { width: 75, align: "right" });
        y += 16;
        doc.text("GST (10%):", 360, y, { width: 110, align: "right" });
        doc.text(fmt(gst), 470, y, { width: 75, align: "right" });
        y += 16;
        doc.fontSize(12).font("Helvetica-Bold").fillColor(BRAND);
        doc.text("TOTAL (incl. GST):", 360, y, { width: 110, align: "right" });
        doc.text(fmt(grandTotal), 470, y, { width: 75, align: "right" });
      } else {
        doc.fontSize(12).font("Helvetica-Bold").fillColor(BRAND);
        doc.text("TOTAL (incl. GST):", 360, y, { width: 110, align: "right" });
        doc.text(fmt(grandTotal), 470, y, { width: 75, align: "right" });
        y += 16;
        doc.fontSize(8).font("Helvetica").fillColor(MID);
        doc.text(`Includes GST of ${fmt(gst)}`, 360, y, { width: 185, align: "right" });
        doc.fontSize(10);
      }

      // ── Footer ───────────────────────────────────────────────────────────
      doc.fontSize(9).font("Helvetica").fillColor(PAID_G);
      doc.text("Thank you for your business.", 50, 760, { align: "center", width: 495 });
      doc.fontSize(8).fillColor(MID);
      doc.text("Please remit payment as per your usual arrangement.", 50, 773, { align: "center", width: 495 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Send via Resend REST API.
// Returns { success, message_id, error }.
// ────────────────────────────────────────────────────────────────────────────
async function sendViaResend({ to, subject, text, html, attachments }) {
  const cfg = getConfig();
  if (!cfg.apiKey) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }
  if (!to) return { success: false, error: "Missing recipient" };

  // In test mode override the from to Resend's sandbox.
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
    // Resend expects { filename, content (base64) }
    payload.attachments = attachments.map(a => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content.toString("base64") : a.content,
    }));
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        error: data?.message || data?.error || `HTTP ${res.status}`,
      };
    }
    return { success: true, message_id: data?.id || "" };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Build a plain-text rental invoice body (mirrors the App.jsx mailto version
// so the email looks consistent regardless of whether mailto or server is used).
// ────────────────────────────────────────────────────────────────────────────
function buildInvoiceText(invoice, customer, options = {}) {
  const { paymentUrl } = options;
  const lines = [];
  lines.push(`Hi${customer?.name ? ` ${customer.name}` : ""},`);
  lines.push("");
  lines.push("Please find your rental invoice attached.");
  lines.push("");
  lines.push(`Invoice Number: ${invoice.invoice_number || "—"}`);
  lines.push(`Invoice Date:   ${invoice.invoice_date || ""}`);
  lines.push("");
  lines.push("Summary:");
  for (const l of (invoice.lines || [])) {
    const desc = `${l.cylinder_label || l.label || "Cylinder"} — Cylinder Rental`;
    const qty = l.qty || l.on_hand || 0;
    const unit = Number(l.unit_price || 0).toFixed(2);
    const total = Number(l.line_total || 0).toFixed(2);
    lines.push(`  ${desc}`);
    lines.push(`    Qty ${qty} @ $${unit} = $${total}`);
  }
  lines.push("");
  const subtotal = Number(invoice.subtotal || invoice.total || 0).toFixed(2);
  const gst = Number(invoice.gst || 0).toFixed(2);
  const grandTotal = Number(invoice.grandTotal || 0).toFixed(2);
  lines.push(`Subtotal:           $${subtotal}`);
  lines.push(`GST (10%):          $${gst}`);
  lines.push(`TOTAL (incl. GST):  $${grandTotal}`);
  lines.push("");
  if (paymentUrl) {
    lines.push("────────────────────────────────");
    lines.push("Pay online now:");
    lines.push(paymentUrl);
    lines.push("────────────────────────────────");
    lines.push("");
  }
  lines.push("Please remit payment as per your usual arrangement.");
  lines.push("");
  lines.push("Thanks,");
  lines.push("CylinderTrack");
  return lines.join("\n");
}

module.exports = {
  getConfig,
  isEmailEnabled,
  generateInvoicePdf,
  sendViaResend,
  buildInvoiceText,
};
