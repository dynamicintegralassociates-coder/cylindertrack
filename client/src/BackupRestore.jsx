// ============================================================
// BackupRestore.jsx — Admin-only backup and restore widget
// ============================================================
// Drops into the Administrator page. Lets admins:
//   - See current row counts per table
//   - Download a complete JSON backup of every table
//   - Upload a backup file and restore it (with a confirmation)
//   - Validate a backup file without restoring it (dry-run)
//
// The backup is a complete database dump and should be treated
// as sensitive data. Store copies on encrypted disks only, never
// commit to git, never email.
// ============================================================

import React, { useState, useEffect, useCallback } from "react";
import api from "./api";

const C = {
  bg: "#0f1117", panel: "#161820", border: "#23262f", card: "#1a1d27",
  text: "#e2e4ea", muted: "#6b7280", accent: "#f59e0b",
  red: "#ef4444", green: "#22c55e", blue: "#3b82f6", purple: "#8b5cf6",
  input: "#1e2130", inputBorder: "#2d3148",
};
const btn = (color = C.accent) => ({
  padding: "9px 18px", background: color, border: "none", borderRadius: 6,
  color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
});
const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, marginBottom: 16 };

export default function BackupRestore({ showToast }) {
  const [counts, setCounts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [validation, setValidation] = useState(null);
  const [restoreResult, setRestoreResult] = useState(null);

  const loadCounts = useCallback(async () => {
    try {
      const res = await api.getBackupCounts();
      setCounts(res);
    } catch (e) {
      if (showToast) showToast(`Could not load row counts: ${e.message}`, "error");
    }
  }, [showToast]);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  // Download the backup. We hit /api/backup directly with fetch
  // so we can stream the response to a blob and save it client-side.
  const downloadBackup = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/backup", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `cylindertrack-full-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (showToast) showToast("Backup downloaded — store it somewhere safe", "success");
    } catch (e) {
      if (showToast) showToast(`Backup failed: ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  // Read the uploaded file into memory and validate it (no restore yet)
  const handleFile = async (file) => {
    if (!file) return;
    setRestoreFile(null);
    setValidation(null);
    setRestoreResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setRestoreFile({ name: file.name, size: file.size, data: parsed });
      // Send to server for validation
      const v = await api.validateBackup(parsed);
      setValidation(v);
    } catch (e) {
      if (showToast) showToast(`Could not parse backup file: ${e.message}`, "error");
    }
  };

  // Run the actual restore — with a confirm() gate because this is destructive
  const runRestore = async () => {
    if (!restoreFile) return;
    const totalRows = validation?.total_rows || 0;
    const msg = `RESTORE WARNING\n\nThis will WIPE every customer, order, invoice, payment, credit note, pricing record, and audit log entry currently in the database, and replace them with the contents of "${restoreFile.name}".\n\n` +
      `The backup contains ${totalRows.toLocaleString()} rows across ${Object.keys(validation?.row_counts || {}).length} tables, exported at ${validation?.exported_at}.\n\n` +
      `This cannot be undone without another backup.\n\n` +
      `Type RESTORE in the next prompt to confirm.`;
    if (!window.confirm(msg)) return;
    const typed = window.prompt('Type RESTORE (all caps) to confirm:');
    if (typed !== "RESTORE") {
      if (showToast) showToast("Restore cancelled", "info");
      return;
    }
    setBusy(true);
    setRestoreResult(null);
    try {
      const res = await api.restoreBackup(restoreFile.data);
      setRestoreResult(res);
      if (showToast) showToast(`Restored ${res.total_rows} rows across ${res.tables_restored} tables`, "success");
      await loadCounts();
    } catch (e) {
      if (showToast) showToast(`Restore failed: ${e.message}`, "error");
      setRestoreResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: C.text }}>Backup & Restore</h3>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
        Download a complete JSON dump of every table in the database, or restore from a previous backup.
        Always download a fresh backup before making significant changes or before attaching/changing storage volumes.
      </div>

      {/* Row counts */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Current database contents</div>
          <button onClick={loadCounts} style={{ ...btn(C.muted), padding: "5px 10px", fontSize: 11 }}>Refresh</button>
        </div>
        {counts ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, fontSize: 11 }}>
              {Object.entries(counts.counts).map(([table, count]) => (
                <div key={table} style={{ padding: "6px 10px", background: C.input, borderRadius: 4, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: C.muted }}>{table}</span>
                  <span style={{ color: count > 0 ? C.text : C.muted, fontWeight: 600, fontFamily: "monospace" }}>{count === null ? "—" : count.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: C.muted, textAlign: "right" }}>
              Total rows: <span style={{ color: C.text, fontWeight: 600 }}>{counts.total?.toLocaleString()}</span>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.muted }}>Loading...</div>
        )}
      </div>

      {/* Download */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>Download backup</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          Produces a single JSON file containing every row of every table. This is your disaster recovery snapshot.
          <br /><br />
          <b style={{ color: C.red }}>Important:</b> the file contains sensitive data (customer details, audit logs, encrypted CC ciphertext, password hashes).
          Treat it like the database itself. Store copies on encrypted disks only. Never email, never commit to git.
        </div>
        <button onClick={downloadBackup} disabled={busy} style={{ ...btn(C.green), opacity: busy ? 0.6 : 1 }}>
          {busy ? "Working..." : "Download Full Backup"}
        </button>
      </div>

      {/* Restore */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>Restore from backup</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          Upload a backup file to see what it contains. The actual restore requires a second confirmation and will wipe every table before loading the backup.
        </div>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => handleFile(e.target.files?.[0])}
          style={{
            padding: "8px 12px", background: C.input, border: `1px solid ${C.inputBorder}`,
            borderRadius: 6, color: C.text, fontSize: 12, marginBottom: 12, width: "100%",
          }}
        />

        {validation && (
          <div style={{ marginTop: 8, padding: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: validation.valid ? C.green : C.red, marginBottom: 6 }}>
              {validation.valid ? "✓ Backup file is valid" : "✗ Backup file has problems"}
            </div>
            {validation.problems?.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, color: C.red }}>
                {validation.problems.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            )}
            {validation.valid && (
              <div style={{ color: C.muted, fontSize: 11 }}>
                <div>Format: <span style={{ color: C.text }}>{validation.format}</span></div>
                <div>Exported: <span style={{ color: C.text }}>{validation.exported_at}</span></div>
                <div>Total rows: <span style={{ color: C.text, fontWeight: 600 }}>{validation.total_rows?.toLocaleString()}</span></div>
                {validation.row_counts && (
                  <div style={{ marginTop: 6 }}>
                    {Object.entries(validation.row_counts).filter(([, c]) => c > 0).map(([t, c]) =>
                      <span key={t} style={{ marginRight: 10, color: C.text }}>{t}: <b>{c}</b></span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {validation?.valid && (
          <button onClick={runRestore} disabled={busy} style={{ ...btn(C.red), marginTop: 12, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Restoring..." : "Restore from this backup (DESTRUCTIVE)"}
          </button>
        )}

        {restoreResult && !restoreResult.error && (
          <div style={{ marginTop: 12, padding: 12, background: C.green + "22", border: `1px solid ${C.green}`, borderRadius: 6, fontSize: 12, color: C.text }}>
            <b style={{ color: C.green }}>✓ Restore complete.</b> {restoreResult.total_rows} rows restored across {restoreResult.tables_restored} tables.
            {restoreResult.warnings?.length > 0 && (
              <ul style={{ margin: "6px 0 0 16px" }}>
                {restoreResult.warnings.map((w, i) => <li key={i} style={{ color: C.muted }}>{w}</li>)}
              </ul>
            )}
          </div>
        )}
        {restoreResult?.error && (
          <div style={{ marginTop: 12, padding: 12, background: C.red + "22", border: `1px solid ${C.red}`, borderRadius: 6, fontSize: 12, color: C.text }}>
            <b style={{ color: C.red }}>✗ Restore failed:</b> {restoreResult.error}
          </div>
        )}
      </div>
    </div>
  );
}
