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
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Header
      doc.fontSize(20).font("Helvetica-Bold").text("RENTAL INVOICE", { align: "left" });
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica").fillColor("#555");
      doc.text(`Invoice Number: ${invoice.invoice_number || "—"}`);
      doc.text(`Invoice Date:   ${invoice.invoice_date || ""}`);
      doc.moveDown();

      // Customer block
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#000");
      doc.text("Bill To:");
      doc.font("Helvetica").fillColor("#333");
      if (customer?.name) doc.text(customer.name);
      if (customer?.address) doc.text(customer.address);
      if (customer?.account_number) doc.text(`Account: ${customer.account_number}`);
      doc.moveDown();

      // Line items table
      const tableTop = doc.y;
      const colX = { desc: 50, qty: 320, unit: 380, total: 470 };
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#000");
      doc.text("Description", colX.desc, tableTop);
      doc.text("Qty", colX.qty, tableTop, { width: 50, align: "right" });
      doc.text("Unit Price", colX.unit, tableTop, { width: 80, align: "right" });
      doc.text("Amount", colX.total, tableTop, { width: 80, align: "right" });
      doc.moveTo(50, tableTop + 14).lineTo(550, tableTop + 14).strokeColor("#333").lineWidth(1).stroke();

      let y = tableTop + 22;
      doc.font("Helvetica").fillColor("#333");
      const lines = invoice.lines || [];
      for (const line of lines) {
        if (y > 720) { doc.addPage(); y = 50; }
        const desc = `${line.cylinder_label || line.label || "Cylinder"} — Cylinder Rental`;
        const qty = String(line.qty || line.on_hand || 0);
        const unit = `$${Number(line.unit_price || 0).toFixed(2)}`;
        const total = `$${Number(line.line_total || (line.unit_price * (line.qty || line.on_hand)) || 0).toFixed(2)}`;
        doc.text(desc, colX.desc, y, { width: 260 });
        doc.text(qty, colX.qty, y, { width: 50, align: "right" });
        doc.text(unit, colX.unit, y, { width: 80, align: "right" });
        doc.text(total, colX.total, y, { width: 80, align: "right" });
        y += 18;
      }

      // Totals
      y += 6;
      doc.moveTo(360, y).lineTo(550, y).strokeColor("#666").lineWidth(0.5).stroke();
      y += 8;
      const subtotal = Number(invoice.subtotal || invoice.total || 0);
      const gst = Number(invoice.gst || (subtotal * 0.10) || 0);
      const grandTotal = Number(invoice.grandTotal || (subtotal + gst) || 0);

      doc.font("Helvetica").fillColor("#333");
      doc.text("Subtotal:", 360, y, { width: 110, align: "right" });
      doc.text(`$${subtotal.toFixed(2)}`, 470, y, { width: 80, align: "right" });
      y += 16;
      doc.text("GST (10%):", 360, y, { width: 110, align: "right" });
      doc.text(`$${gst.toFixed(2)}`, 470, y, { width: 80, align: "right" });
      y += 16;
      doc.font("Helvetica-Bold").fillColor("#000");
      doc.text("TOTAL (incl. GST):", 360, y, { width: 110, align: "right" });
      doc.text(`$${grandTotal.toFixed(2)}`, 470, y, { width: 80, align: "right" });

      // Footer
      doc.font("Helvetica").fontSize(9).fillColor("#888");
      doc.text("Thank you for your business.", 50, 760, { align: "center", width: 500 });
      doc.text("Please remit payment as per your usual arrangement.", 50, 772, { align: "center", width: 500 });

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
function buildInvoiceText(invoice, customer) {
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
