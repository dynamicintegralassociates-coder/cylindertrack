import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import api, { setAuthFailHandler } from "./api";
import AuditLogView from "./AuditLog";
import BackupRestore from "./BackupRestore";

// ==================== STYLES ====================
const C = {
  bg: "#0f1117", panel: "#161820", border: "#23262f", card: "#1a1d27",
  text: "#e2e4ea", muted: "#6b7280", accent: "#f59e0b", accentHover: "#d97706",
  red: "#ef4444", green: "#22c55e", blue: "#3b82f6", purple: "#8b5cf6",
  input: "#1e2130", inputBorder: "#2d3148",
};

const btnStyle = (color = C.accent) => ({
  padding: "8px 16px", background: color, border: "none", borderRadius: 6,
  color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
});
const inputStyle = {
  padding: "8px 12px", background: C.input, border: `1px solid ${C.inputBorder}`,
  borderRadius: 6, color: C.text, fontSize: 13, width: "100%", boxSizing: "border-box",
};
const cardStyle = {
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
  padding: 20, marginBottom: 16,
};
const labelStyle = { fontSize: 11, color: C.muted, marginBottom: 4, display: "block", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };

// Money formatting. The database stores all monetary values as NET (excluding GST).
// fmtCurrency: raw display, no GST math. Use for line items, unit prices, per-item displays.
// fmtMoney: customer-facing display. By default returns gross (net + 10% GST) so the user
// sees what the customer actually pays. Used for: customer balances, invoice totals,
// outstanding amounts, billing summaries, the order form total, dashboard money cards.
// Date formatting — always yyyy-mm-dd or yyyy-mm-dd HH:MM
const fmtDate = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
};
const fmtDateTime = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 16).replace("T", " ");
};

const GST_RATE = 0.10;
const fmtCurrency = (v) => `$${(v || 0).toFixed(2)}`;
const grossOf = (net) => Math.round((net || 0) * (1 + GST_RATE) * 100) / 100;
const fmtMoney = (netValue, opts) => {
  const o = opts || {};
  if (o.net) return fmtCurrency(netValue);
  return fmtCurrency(grossOf(netValue));
};
// For places where we want to show "$X.XX inc GST" with the label inline
const fmtMoneyLabel = (netValue) => `${fmtCurrency(grossOf(netValue))} inc GST`;

// Shared customer display formatter. Company name wins, falls back to contact
// person. Optionally append the delivery address (used on the orders screen
// header; omitted in the compact bottom list).
function formatCustomerDisplay(customer) {
  if (!customer) return "";
  const name = (customer.name || "").trim();
  if (name) return name;
  const contact = (customer.contact || "").trim();
  const address = (customer.address || "").trim();
  if (contact && address) return `${contact} — ${address}`;
  return contact || address || "";
}

// Round 3: 7-state order status model. Maps each status to a label, badge color, and bg.
// Falls back to a sensible default for any unknown status.
function orderStatusStyle(status) {
  const s = (status || "").toLowerCase();
  const map = {
    open:              { label: "OPEN",              bg: "#f59e0b22", fg: C.accent },
    awaiting_dispatch: { label: "AWAITING DISPATCH", bg: "#a855f722", fg: "#a855f7" },
    dispatched:        { label: "DISPATCHED",        bg: "#3b82f622", fg: C.blue },
    delivered:         { label: "DELIVERED",         bg: "#06b6d422", fg: "#06b6d4" },
    invoiced:          { label: "INVOICED",          bg: "#8b5cf622", fg: C.purple },
    closed:            { label: "CLOSED",             bg: "#22c55e22", fg: C.green },
    cancelled:         { label: "CANCELLED",         bg: "#6b728022", fg: C.muted },
    // Legacy fallthrough — shouldn't appear after migration but render gracefully
    confirmed:         { label: "CONFIRMED",         bg: "#3b82f622", fg: C.blue },
    completed:         { label: "COMPLETED",         bg: "#22c55e22", fg: C.green },
    fulfilled:         { label: "FULFILLED",         bg: "#8b5cf622", fg: C.purple },
  };
  return map[s] || { label: s.toUpperCase() || "—", bg: "#f59e0b22", fg: C.accent };
}

function Card({ children, style }) {
  return <div style={{ ...cardStyle, ...style }}>{children}</div>;
}

function StatCard({ label, value, color, icon }) {
  return (
    <Card style={{ flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.text, letterSpacing: "-0.02em" }}>{value}</div>
    </Card>
  );
}

function useApi(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await fn()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload, setData };
}

// ==================== AUTH SCREENS ====================
function SetupScreen({ onDone }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const submit = async () => {
    try { const r = await api.setup(u, p); onDone(r.user); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: C.bg }}>
      <Card style={{ width: 360, textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.accent, marginBottom: 4 }}>CylinderTrack</div>
        <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>Create your admin account</div>
        {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
        <input placeholder="Username" value={u} onChange={e => setU(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
        <input placeholder="Password" type="password" value={p} onChange={e => setP(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} onKeyDown={e => e.key === "Enter" && submit()} />
        <button onClick={submit} style={{ ...btnStyle(), width: "100%" }}>Create Admin Account</button>
      </Card>
    </div>
  );
}

function LoginScreen({ onDone }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const submit = async () => {
    try { const r = await api.login(u, p); onDone(r.user); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: C.bg }}>
      <Card style={{ width: 360, textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.accent, marginBottom: 4 }}>CylinderTrack</div>
        <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>Sign in to continue</div>
        {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
        <input placeholder="Username" value={u} onChange={e => setU(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
        <input placeholder="Password" type="password" value={p} onChange={e => setP(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} onKeyDown={e => e.key === "Enter" && submit()} />
        <button onClick={submit} style={{ ...btnStyle(), width: "100%" }}>Sign In</button>
      </Card>
    </div>
  );
}

// ==================== ICONS ====================
const Icons = {
  dashboard: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  customers: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  settings: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  delivery: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  cylinders: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/></svg>,
  billing: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  pricing: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  route: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>,
  sync: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
};

// ==================== OPTIMOROUTE VIEW ====================
function OptimoRouteView({ customers, cylinderTypes, showToast, refreshAll }) {
  const [tab, setTab] = useState("sync"); // sync | unmatched | log | settings
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [debugResult, setDebugResult] = useState(null);
  const [debugging, setDebugging] = useState(false);
  const [unmatched, setUnmatched] = useState([]);
  const [syncLog, setSyncLog] = useState([]);
  const [matchModal, setMatchModal] = useState(null);

  // Load settings on mount
  useEffect(() => {
    api.getSettings().then(s => {
      if (s.optimoroute_api_key) {
        setApiKey(s.optimoroute_api_key);
        setApiKeySaved(true);
      }
    }).catch(() => {});
  }, []);

  // Load unmatched orders
  useEffect(() => {
    if (tab === "unmatched") {
      api.orGetUnmatched().then(setUnmatched).catch(() => {});
    }
    if (tab === "log") {
      api.orGetSyncLog().then(setSyncLog).catch(() => {});
    }
  }, [tab]);

  const saveApiKey = async () => {
    try {
      await api.updateSettings({ optimoroute_api_key: apiKey });
      setApiKeySaved(true);
      showToast("API key saved");
    } catch (e) { showToast(e.message, "error"); }
  };

  const testConnection = async () => {
    setTestResult(null);
    try {
      const r = await api.orTestConnection();
      setTestResult(r);
    } catch (e) { setTestResult({ success: false, message: e.message }); }
  };

  const runSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await api.orSync(dateFrom, dateTo);
      setSyncResult(r);
      refreshAll();
      showToast(`Imported ${r.summary.imported} orders`);
    } catch (e) {
      setSyncResult({ success: false, error: e.message });
      showToast(e.message, "error");
    } finally {
      setSyncing(false);
    }
  };

  const doManualImport = async (orderNo, custId, ctId, type, qty, date) => {
    try {
      await api.orImportManual({ order_no: orderNo, customer_id: custId, cylinder_type: ctId, type, qty, date });
      showToast("Order imported");
      setMatchModal(null);
      api.orGetUnmatched().then(setUnmatched);
      refreshAll();
    } catch (e) { showToast(e.message, "error"); }
  };

  const runDebug = async () => {
    setDebugging(true);
    setDebugResult(null);
    try {
      const r = await api.orDebug(dateFrom, dateTo);
      setDebugResult(r);
    } catch (e) { setDebugResult({ error: e.message }); }
    finally { setDebugging(false); }
  };

  const tabs = [
    { id: "sync", label: "Sync Orders" },
    { id: "unmatched", label: `Unmatched (${unmatched.length})` },
    { id: "log", label: "Sync History" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        {Icons.sync} OptimoRoute Integration
      </h2>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: C.panel, borderRadius: 8, padding: 4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer",
            background: tab === t.id ? C.accent : "transparent",
            color: tab === t.id ? "#000" : C.muted, fontWeight: 600, fontSize: 13,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ─── SYNC TAB ──────────────────────────────── */}
      {tab === "sync" && (
        <div>
          {!apiKeySaved && (
            <Card>
              <div style={{ color: C.accent, fontWeight: 700, marginBottom: 8 }}>Setup Required</div>
              <p style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>
                Enter your OptimoRoute API key to enable auto-import. Find it in OptimoRoute → Administration → Settings → WS API.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste API key here" style={{ ...inputStyle, flex: 1 }} />
                <button onClick={saveApiKey} style={btnStyle()}>Save Key</button>
              </div>
            </Card>
          )}

          {apiKeySaved && (
            <>
              <Card>
                <div style={{ fontWeight: 700, marginBottom: 12 }}>Import Completed Deliveries & Returns</div>
                <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
                  Fetch completed orders from OptimoRoute and auto-create delivery/return transactions. Orders are matched to customers by location name or address.
                </p>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div>
                    <label style={labelStyle}>From Date</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inputStyle, width: 160 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>To Date</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inputStyle, width: 160 }} />
                  </div>
                  <button onClick={runSync} disabled={syncing} style={{ ...btnStyle(syncing ? C.muted : C.green), minWidth: 140 }}>
                    {syncing ? "⏳ Syncing..." : "🔄 Sync Now"}
                  </button>
                  <button onClick={() => {
                    const d = new Date(); d.setDate(d.getDate() - 1);
                    setDateFrom(d.toISOString().split("T")[0]);
                    setDateTo(d.toISOString().split("T")[0]);
                  }} style={{ ...btnStyle(C.blue), fontSize: 12 }}>Yesterday</button>
                  <button onClick={() => {
                    const d = new Date();
                    setDateFrom(d.toISOString().split("T")[0]);
                    setDateTo(d.toISOString().split("T")[0]);
                  }} style={{ ...btnStyle(C.blue), fontSize: 12 }}>Today</button>
                  <button onClick={() => {
                    const d = new Date();
                    const day = d.getDay();
                    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                    const mon = new Date(d.setDate(diff));
                    const fri = new Date(mon);
                    fri.setDate(fri.getDate() + 4);
                    setDateFrom(mon.toISOString().split("T")[0]);
                    setDateTo(fri.toISOString().split("T")[0]);
                  }} style={{ ...btnStyle(C.blue), fontSize: 12 }}>This Week</button>
                  <button onClick={runDebug} disabled={debugging} style={{ ...btnStyle(debugging ? C.muted : C.purple), fontSize: 12 }}>
                    {debugging ? "⏳ Loading..." : "🔍 Debug Preview"}
                  </button>
                </div>
              </Card>

              {/* Debug Raw Response */}
              {debugResult && (
                <Card style={{ borderColor: C.purple }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, color: C.purple }}>🔍 Raw API Response</div>
                    <button onClick={() => setDebugResult(null)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>✕ Close</button>
                  </div>
                  <p style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                    This shows what OptimoRoute returns. Send a screenshot to Claude if sync isn't working.
                  </p>
                  <pre style={{ background: C.input, padding: 12, borderRadius: 6, fontSize: 11, color: C.text, maxHeight: 400, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {JSON.stringify(debugResult, null, 2)}
                  </pre>
                </Card>
              )}

              {/* Sync Result */}
              {syncResult && (
                <Card style={{ borderColor: syncResult.success ? C.green : C.red }}>
                  <div style={{ fontWeight: 700, color: syncResult.success ? C.green : C.red, marginBottom: 8 }}>
                    {syncResult.success ? "✅ Sync Complete" : "❌ Sync Failed"}
                  </div>

                  {syncResult.summary && (
                    <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color: C.text }}>{syncResult.summary.totalFetched}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>Orders Found</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color: C.green }}>{syncResult.summary.imported}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>Imported</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color: C.accent }}>{syncResult.summary.skipped}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>Skipped</div>
                      </div>
                    </div>
                  )}

                  {syncResult.importedOrders?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: C.green, marginBottom: 6 }}>Imported Orders:</div>
                      <div style={{ maxHeight: 200, overflowY: "auto" }}>
                        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                              <th style={{ textAlign: "left", padding: "4px 8px", color: C.muted }}>Order</th>
                              <th style={{ textAlign: "left", padding: "4px 8px", color: C.muted }}>Customer</th>
                              <th style={{ textAlign: "left", padding: "4px 8px", color: C.muted }}>Type</th>
                              <th style={{ textAlign: "left", padding: "4px 8px", color: C.muted }}>Cylinder</th>
                              <th style={{ textAlign: "right", padding: "4px 8px", color: C.muted }}>Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {syncResult.importedOrders.map((o, i) => (
                              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                                <td style={{ padding: "4px 8px" }}>{o.orderNo}</td>
                                <td style={{ padding: "4px 8px" }}>{o.customer}</td>
                                <td style={{ padding: "4px 8px" }}>
                                  <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: o.type === "delivery" ? "#22c55e22" : "#ef444422", color: o.type === "delivery" ? C.green : C.red }}>
                                    {o.type}
                                  </span>
                                </td>
                                <td style={{ padding: "4px 8px" }}>{o.cylinderType}</td>
                                <td style={{ padding: "4px 8px", textAlign: "right" }}>{o.qty}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {syncResult.skippedOrders?.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", fontSize: 13, color: C.accent, fontWeight: 600 }}>
                        Skipped Orders ({syncResult.skippedOrders.length})
                      </summary>
                      <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 8 }}>
                        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                              <th style={{ textAlign: "left", padding: "4px 8px", color: C.muted }}>Order</th>
                              <th style={{ textAlign: "left", padding: "4px 8px", color: C.muted }}>Reason</th>
                              <th style={{ textAlign: "left", padding: "4px 8px", color: C.muted }}>Location</th>
                            </tr>
                          </thead>
                          <tbody>
                            {syncResult.skippedOrders.map((o, i) => (
                              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                                <td style={{ padding: "4px 8px" }}>{o.orderNo}</td>
                                <td style={{ padding: "4px 8px", color: C.accent }}>{o.reason}</td>
                                <td style={{ padding: "4px 8px", color: C.muted }}>{o.locationName || o.locationAddress || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}

                  {syncResult.error && (
                    <div style={{ color: C.red, fontSize: 13 }}>{syncResult.error}</div>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── UNMATCHED TAB ─────────────────────────── */}
      {tab === "unmatched" && (
        <div>
          <Card>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Unmatched Orders</div>
            <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
              These orders were fetched from OptimoRoute but couldn't be auto-matched to a customer or cylinder type. You can manually assign them.
            </p>

            {unmatched.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: C.muted }}>No unmatched orders — all caught up!</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {["Order #", "Date", "Location", "Address", "Driver", "Notes", "Action"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {unmatched.map(o => (
                      <tr key={o.order_no} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "6px 8px", fontWeight: 600 }}>{o.order_no}</td>
                        <td style={{ padding: "6px 8px" }}>{o.order_date}</td>
                        <td style={{ padding: "6px 8px" }}>{o.location_name}</td>
                        <td style={{ padding: "6px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{o.location_address}</td>
                        <td style={{ padding: "6px 8px" }}>{o.driver_name}</td>
                        <td style={{ padding: "6px 8px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>{o.notes}</td>
                        <td style={{ padding: "6px 8px" }}>
                          <button onClick={() => setMatchModal(o)} style={{ ...btnStyle(C.blue), padding: "4px 10px", fontSize: 11 }}>
                            Match & Import
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Match Modal */}
          {matchModal && (
            <MatchModal
              order={matchModal}
              customers={customers}
              cylinderTypes={cylinderTypes}
              onImport={doManualImport}
              onClose={() => setMatchModal(null)}
            />
          )}
        </div>
      )}

      {/* ─── SYNC LOG TAB ──────────────────────────── */}
      {tab === "log" && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Sync History</div>
          {syncLog.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: C.muted }}>No syncs yet</div>
          ) : (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["Date Range", "Fetched", "Imported", "Skipped", "Synced At"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {syncLog.map(l => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 8px" }}>{l.sync_date}</td>
                    <td style={{ padding: "6px 8px" }}>{l.orders_fetched}</td>
                    <td style={{ padding: "6px 8px", color: C.green, fontWeight: 600 }}>{l.orders_imported}</td>
                    <td style={{ padding: "6px 8px", color: C.accent }}>{l.orders_skipped}</td>
                    <td style={{ padding: "6px 8px", color: C.muted }}>{fmtDateTime(l.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* ─── SETTINGS TAB ──────────────────────────── */}
      {tab === "settings" && (
        <div>
          <Card>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>OptimoRoute API Key</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setApiKeySaved(false); }}
                placeholder="Paste your OptimoRoute API key"
                style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }}
              />
              <button onClick={saveApiKey} style={btnStyle()}>Save</button>
              <button onClick={testConnection} style={btnStyle(C.blue)}>Test</button>
            </div>
            {testResult && (
              <div style={{ padding: "8px 12px", borderRadius: 6, fontSize: 13, background: testResult.success ? "#22c55e15" : "#ef444415", color: testResult.success ? C.green : C.red }}>
                {testResult.success ? "✅ " : "❌ "}{testResult.message}
              </div>
            )}
          </Card>

          <Card>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>How Auto-Matching Works</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.8 }}>
              <p>When you sync, CylinderTrack fetches completed orders from OptimoRoute and tries to auto-match each order to a customer and cylinder type:</p>
              <p><strong style={{ color: C.text }}>Customer matching:</strong> The order's location name is compared to your customer names, and the delivery address is compared to customer addresses. Partial matches are also checked.</p>
              <p><strong style={{ color: C.text }}>Cylinder type matching:</strong> The order's custom fields (cylinder_type, product, gas_type, item) and notes are checked against your cylinder type labels.</p>
              <p><strong style={{ color: C.text }}>Transaction type:</strong> OptimoRoute Pickup (P) orders become Returns. Delivery (D) and Task (T) orders become Deliveries.</p>
              <p><strong style={{ color: C.text }}>Quantity:</strong> Extracted from custom fields (quantity, qty, count) or parsed from notes (e.g. "2x Oxygen").</p>
              <p>Orders that can't be auto-matched appear in the Unmatched tab for manual assignment.</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Match Modal ────────────────────────────────────────────
function MatchModal({ order, customers, cylinderTypes, onImport, onClose }) {
  const [custId, setCustId] = useState("");
  const [ctId, setCtId] = useState("");
  const [type, setType] = useState(order.order_type || "delivery");
  const [qty, setQty] = useState(1);
  const [search, setSearch] = useState("");

  const filteredCustomers = useMemo(() => {
    if (!search) return customers;
    const s = search.toLowerCase();
    return customers.filter(c =>
      (c.name || "").toLowerCase().includes(s) ||
      (c.address || "").toLowerCase().includes(s) ||
      (c.contact || "").toLowerCase().includes(s) ||
      (c.phone || "").toLowerCase().includes(s) ||
      (c.account_number || "").toLowerCase().includes(s)
    );
  }, [customers, search]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
      <Card style={{ width: 520, maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Match Order: {order.order_no}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        {/* Order info */}
        <div style={{ background: C.input, borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
          <div><strong>Date:</strong> {order.order_date}</div>
          <div><strong>Location:</strong> {order.location_name}</div>
          <div><strong>Address:</strong> {order.location_address}</div>
          <div><strong>Driver:</strong> {order.driver_name}</div>
          {order.notes && <div><strong>Notes:</strong> {order.notes}</div>}
        </div>

        {/* Customer search */}
        <label style={labelStyle}>Customer</label>
        <input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
        <select value={custId} onChange={e => setCustId(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
          <option value="">Select customer...</option>
          {filteredCustomers.map(c => (
            <option key={c.id} value={c.id}>{c.name} — {c.address}</option>
          ))}
        </select>

        {/* Cylinder type */}
        <label style={labelStyle}>Cylinder Type</label>
        <select value={ctId} onChange={e => setCtId(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
          <option value="">Select cylinder type...</option>
          {cylinderTypes.map(ct => (
            <option key={ct.id} value={ct.id}>{ct.label}</option>
          ))}
        </select>

        {/* Type & Qty */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Type</label>
            <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
              <option value="delivery">Delivery</option>
              <option value="return">Return</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Quantity</label>
            <input type="number" min="1" value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)} style={inputStyle} />
          </div>
        </div>

        <button
          onClick={() => onImport(order.order_no, custId, ctId, type, qty, order.order_date)}
          disabled={!custId || !ctId}
          style={{ ...btnStyle(!custId || !ctId ? C.muted : C.green), width: "100%" }}
        >
          Import Transaction
        </button>
      </Card>
    </div>
  );
}

// ==================== DASHBOARD VIEW ====================
function DashboardView({ stats }) {
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Dashboard</h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard label="Customers" value={stats?.total_customers || 0} color={C.blue} />
        <StatCard label="Cylinders On-Hand" value={stats?.total_on_hand || 0} color={C.accent} />
        <StatCard label="Deliveries" value={stats?.total_deliveries || 0} color={C.green} />
        <StatCard label="Returns" value={stats?.total_returns || 0} color={C.red} />
      </div>

      {/* Order stats */}
      {stats?.orders && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <StatCard label="Orders Open" value={stats.orders.open || 0} color={C.accent} />
          <StatCard label="Orders Confirmed" value={stats.orders.confirmed || 0} color={C.blue} />
          <StatCard label="Orders Completed" value={stats.orders.completed || 0} color={C.green} />
          <StatCard label="Orders Total" value={stats.orders.total || 0} color={C.text} />
        </div>
      )}

      {stats?.optimoroute?.last_sync && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>{Icons.sync} OptimoRoute</div>
          <div style={{ fontSize: 13, color: C.muted }}>
            Last sync: {fmtDateTime(stats.optimoroute.last_sync.created)} · {stats.optimoroute.total_imported} total imported
          </div>
        </Card>
      )}

      {/* Recent Orders */}
      {stats?.orders?.recent?.length > 0 && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Recent Orders</div>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Date", "Customer", "Order", "Unit $", "Total $", "Payment", "Status"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.orders.recent.map(o => (
                <tr key={o.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "4px 8px" }}>{o.order_date}</td>
                  <td style={{ padding: "4px 8px", fontWeight: 600 }}>{o.customer_name || o.customer_name_lookup || o.address || "—"}</td>
                  <td style={{ padding: "4px 8px" }}>{o.order_detail || "—"}</td>
                  <td style={{ padding: "4px 8px" }}>{o.unit_price ? fmtCurrency(o.unit_price) : "—"}</td>
                  <td style={{ padding: "4px 8px", color: C.green, fontWeight: 600 }} title="Includes GST">{o.total_price ? fmtMoney(o.total_price) : "—"}</td>
                  <td style={{ padding: "4px 8px" }}>{o.payment || "—"}</td>
                  <td style={{ padding: "4px 8px" }}>
                    {(() => {
                      const ss = orderStatusStyle(o.status);
                      return <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: ss.bg, color: ss.fg }}>{ss.label}</span>;
                    })()}
                    {o.optimoroute_id && <span style={{ padding: "2px 5px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "#8b5cf622", color: C.purple, marginLeft: 4 }}>OR</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {stats?.recent_transactions?.length > 0 && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Recent Transactions</div>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Date", "Type", "Qty", "Source", "Notes"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.recent_transactions.map(tx => (
                <tr key={tx.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "4px 8px" }}>{tx.date}</td>
                  <td style={{ padding: "4px 8px" }}>
                    <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: tx.type === "delivery" ? "#22c55e22" : tx.type === "return" ? "#ef444422" : "#3b82f622", color: tx.type === "delivery" ? C.green : tx.type === "return" ? C.red : C.blue }}>
                      {tx.type}
                    </span>
                  </td>
                  <td style={{ padding: "4px 8px" }}>{tx.qty}</td>
                  <td style={{ padding: "4px 8px" }}>
                    {tx.source === "optimoroute" ? (
                      <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: "#8b5cf622", color: C.purple }}>OptimoRoute</span>
                    ) : (
                      <span style={{ color: C.muted, fontSize: 11 }}>manual</span>
                    )}
                  </td>
                  <td style={{ padding: "4px 8px", color: C.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ==================== CC REVEAL COMPONENT ====================
function CCReveal({ customerId, masked }) {
  const [revealed, setRevealed] = useState(null);
  const [loading, setLoading] = useState(false);

  const reveal = async () => {
    if (revealed) { setRevealed(null); return; } // toggle off
    setLoading(true);
    try {
      const r = await api.revealCC(customerId);
      setRevealed(r.cc_number);
      // Auto-hide after 10 seconds
      setTimeout(() => setRevealed(null), 10000);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontFamily: "monospace", fontSize: 11 }}>{revealed || masked}</span>
      <button onClick={reveal} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}>
        {loading ? "..." : revealed ? "Hide" : "Show"}
      </button>
    </span>
  );
}

// ==================== CUSTOMERS VIEW ====================
// ==================== CUSTOMERS VIEW ====================
const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
const MILK_RUN_DAYS = [
  { key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }, { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" }, { key: "fri", label: "Fri" },
];
const RENTAL_FREQUENCIES = ["Daily", "Weekly", "Monthly", "Quarterly", "Annually"];
const CUSTOMER_TYPES = ["Variable", "Fixed", "Formula"];
const CUSTOMER_CATEGORIES = ["Residential", "Commercial"];

const EMPTY_CUSTOMER_FORM = {
  name: "", contact: "", phone: "", email: "", address: "", notes: "",
  onedrive_link: "", payment_ref: "", cc_number: "", account_customer: false,
  state: "", accounts_contact: "", accounts_email: "", accounts_phone: "",
  compliance_number: "", pressure_test: "", abn: "", duration: "",
  milk_run_days: "", milk_run_frequency: "", rental_frequency: "",
  customer_type: "", customer_type_start: "", customer_type_end: "",
  rep_name: "", payment_terms: "", invoice_frequency: "", new_internal_note: "", customer_category: "",
  chain: false, alternative_contact_name: "", alternative_contact_phone: "",
  compliance_not_required: false, archived: false,
};

function parseInternalNotes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}

// Client-side ABN checksum validator. Mirrors the backend logic.
// Returns { valid, reason }. Blank input is valid (ABN is optional).
function validateABNClient(input) {
  if (!input || !String(input).trim()) return { valid: true, reason: "" };
  const digits = String(input).replace(/\D/g, "");
  if (digits.length !== 11) return { valid: false, reason: "ABN must be 11 digits" };
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const arr = digits.split("").map(Number);
  arr[0] = arr[0] - 1;
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += arr[i] * weights[i];
  if (sum % 89 !== 0) return { valid: false, reason: "ABN checksum failed (likely a typo)" };
  return { valid: true, reason: "" };
}

// Resolve a customer's invoice email — accounts_email first, fall back to email.
function resolveInvoiceEmail(customer) {
  if (!customer) return "";
  return (customer.accounts_email || customer.email || "").trim();
}

// Build a plain-text invoice body suitable for mailto:.
// Returns { subject, body } both as plain strings (NOT URI-encoded).
function buildInvoiceEmailBody(invoice, asAtDate) {
  const lines = [];
  lines.push(`Hi${invoice.customer_name ? ` ${invoice.customer_name}` : ""},`);
  lines.push("");
  lines.push(`Please find your rental invoice details below.`);
  lines.push("");
  lines.push(`Invoice Date: ${asAtDate}`);
  lines.push(`Billing Period: As at ${asAtDate}`);
  if (invoice.invoice_number) lines.push(`Invoice Number: ${invoice.invoice_number}`);
  lines.push("");
  lines.push("─────────────────────────────────────");
  lines.push("ITEMS");
  lines.push("─────────────────────────────────────");
  for (const l of (invoice.lines || [])) {
    const desc = `${l.cylinder_label} — Cylinder Rental`;
    const qty = `Qty ${l.on_hand}`;
    const unit = `@ ${fmtCurrency(l.unit_price)}`;
    const total = fmtCurrency(l.line_total);
    lines.push(`  ${desc}`);
    lines.push(`    ${qty}  ${unit}  =  ${total}`);
  }
  lines.push("");
  lines.push("─────────────────────────────────────");
  lines.push(`Subtotal:           ${fmtCurrency(invoice.subtotal)}`);
  lines.push(`GST (10%):          ${fmtCurrency(invoice.gst)}`);
  lines.push(`TOTAL (incl. GST):  ${fmtCurrency(invoice.grandTotal)}`);
  lines.push("─────────────────────────────────────");
  lines.push("");
  lines.push("Please remit payment as per your usual arrangement.");
  lines.push("");
  lines.push("Thanks,");
  lines.push("CylinderTrack");
  return {
    subject: `Rental Invoice${invoice.invoice_number ? ` ${invoice.invoice_number}` : ""} — ${asAtDate}`,
    body: lines.join("\n"),
  };
}

// Open the user's mail client with a pre-filled mailto link.
function openMailto(to, subject, body) {
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body)    params.push(`body=${encodeURIComponent(body)}`);
  const href = `mailto:${encodeURIComponent(to)}${params.length ? "?" + params.join("&") : ""}`;
  // Cap at ~1900 chars to avoid Windows mailto: length limits truncating
  if (href.length > 1900) {
    // Truncate body to fit, leaving "..." sentinel
    const cap = 1900 - href.length + body.length - 20;
    const trunc = body.slice(0, cap) + "\n\n[…truncated, see full invoice in app]";
    return openMailto(to, subject, trunc);
  }
  window.location.href = href;
}

// Tiny CSV parser that handles quoted fields, embedded commas and escaped quotes ("").
// Returns { headers, rows } where rows is an array of objects keyed by header (lowercased).
function parseCSV(text) {
  if (!text) return { headers: [], rows: [] };
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { record.push(field); field = ""; i++; continue; }
    if (ch === "\n") { record.push(field); records.push(record); record = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  // Final field/record
  if (field !== "" || record.length > 0) { record.push(field); records.push(record); }
  // Drop trailing empty records
  while (records.length > 0 && records[records.length - 1].every(c => c === "")) records.pop();

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map(h => String(h || "").trim());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.every(c => String(c || "").trim() === "")) continue; // skip blank lines
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c].toLowerCase();
      if (!key) continue;
      obj[key] = (rec[c] !== undefined ? String(rec[c]) : "").trim();
    }
    rows.push(obj);
  }
  return { headers, rows };
}

function CustomersView({ customers, reload, showToast, onOpenOrder, cylinderTypes, userRole }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_CUSTOMER_FORM);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [archivedList, setArchivedList] = useState([]);

  useEffect(() => {
    if (!showArchived) { setArchivedList([]); return; }
    api.getCustomers({ include_archived: true })
      .then(all => setArchivedList((all || []).filter(c => c.archived)))
      .catch(() => {});
  }, [showArchived]);

  const startEdit = (c) => {
    setEditing(c?.id || "new");
    if (!c) { setForm(EMPTY_CUSTOMER_FORM); return; }
    setForm({
      name: c.name || "", contact: c.contact || "", phone: c.phone || "", email: c.email || "",
      address: c.address || "", notes: c.notes || "", onedrive_link: c.onedrive_link || "",
      payment_ref: c.payment_ref || "", cc_number: "", account_customer: !!c.account_customer,
      state: c.state || "", accounts_contact: c.accounts_contact || "", accounts_email: c.accounts_email || "",
      accounts_phone: c.accounts_phone || "", compliance_number: c.compliance_number || "",
      pressure_test: c.pressure_test || "", abn: c.abn || "", duration: c.duration || "",
      milk_run_days: c.milk_run_days || "", milk_run_frequency: c.milk_run_frequency || "",
      rental_frequency: c.rental_frequency || "", customer_type: c.customer_type || "",
      customer_type_start: c.customer_type_start || "", customer_type_end: c.customer_type_end || "",
      rep_name: c.rep_name || "", payment_terms: c.payment_terms || "", invoice_frequency: c.invoice_frequency || "", new_internal_note: "",
      customer_category: c.customer_category || "",
      chain: !!c.chain,
      alternative_contact_name: c.alternative_contact_name || "",
      alternative_contact_phone: c.alternative_contact_phone || "",
      compliance_not_required: !!c.compliance_not_required,
      archived: !!c.archived,
    });
  };

  const save = async () => {
    try {
      const isResidential = form.customer_category === "Residential";
      if (!isResidential && !form.name?.trim()) {
        showToast("Company name is required for non-residential customers", "error");
        return;
      }
      if (isResidential && !form.name?.trim() && !form.address?.trim()) {
        showToast("Either name or address is required", "error");
        return;
      }
      if (form.customer_type === "Fixed" && (!form.customer_type_start || !form.customer_type_end)) {
        showToast("Fixed customer type requires start and end dates", "error");
        return;
      }
      if (editing === "new") await api.createCustomer(form);
      else await api.updateCustomer(editing, form);
      reload();
      setEditing(null);
      showToast(editing === "new" ? "Customer created" : "Customer updated");
    } catch (e) { showToast(e.message, "error"); }
  };

  const del = async (id) => {
    if (!confirm("Delete this customer?")) return;
    try { await api.deleteCustomer(id); reload(); showToast("Customer deleted"); }
    catch (e) { showToast(e.message, "error"); }
  };

  const displayCustomers = showArchived ? archivedList : (customers || []);

  const filtered = useMemo(() => {
    if (!search) return displayCustomers;
    const s = search.toLowerCase();
    return displayCustomers.filter(c =>
      (c.name || "").toLowerCase().includes(s) ||
      (c.address || "").toLowerCase().includes(s) ||
      (c.contact || "").toLowerCase().includes(s) ||
      (c.phone || "").toLowerCase().includes(s) ||
      (c.account_number || "").toLowerCase().includes(s)
    );
  }, [displayCustomers, search]);

  const editingCust = editing && editing !== "new" ? (customers || []).find(c => c.id === editing) : null;
  const existingNotes = parseInternalNotes(editingCust?.internal_notes);

  // Load this customer's orders + balance + last sale price + price list whenever the edit panel opens
  const [custOrders, setCustOrders] = useState([]);
  const [custBalance, setCustBalance] = useState(null);
  const [lastSalePrice, setLastSalePrice] = useState(null);
  const [custPriceList, setCustPriceList] = useState([]);
  useEffect(() => {
    if (editing && editing !== "new") {
      let cancelled = false;
      api.getCustomerOrders(editing).then(o => { if (!cancelled) setCustOrders(o || []); }).catch(() => { if (!cancelled) setCustOrders([]); });
      api.getCustomerBalance(editing).then(b => { if (!cancelled) setCustBalance(b); }).catch(() => { if (!cancelled) setCustBalance(null); });
      api.getLastSalePrice(editing).then(p => { if (!cancelled) setLastSalePrice(p); }).catch(() => { if (!cancelled) setLastSalePrice(null); });
      api.getCustomerPriceList(editing).then(p => { if (!cancelled) setCustPriceList(p || []); }).catch(() => { if (!cancelled) setCustPriceList([]); });
      return () => { cancelled = true; };
    } else {
      setCustOrders([]);
      setCustBalance(null);
      setLastSalePrice(null);
      setCustPriceList([]);
    }
  }, [editing]);

  const saveCustPrice = async (ct_id, price, fixed_price, fixed_from, fixed_to) => {
    try {
      await api.setPrice(editing, ct_id, { price, fixed_price, fixed_from, fixed_to });
      const updated = await api.getCustomerPriceList(editing);
      setCustPriceList(updated || []);
      showToast("Price saved");
    } catch (e) { showToast(e.message, "error"); }
  };

  const toggleMilkDay = (dayKey) => {
    const set = new Set((form.milk_run_days || "").split(",").filter(Boolean));
    if (set.has(dayKey)) set.delete(dayKey); else set.add(dayKey);
    // Preserve weekday order
    const ordered = MILK_RUN_DAYS.map(d => d.key).filter(k => set.has(k));
    setForm(p => ({ ...p, milk_run_days: ordered.join(",") }));
  };

  const sectionStyle = { gridColumn: "1/-1", marginTop: 8, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.08em" };

  return (
    <div>
      {editing ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={() => setEditing(null)} style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer", fontSize: 13, padding: "6px 12px", borderRadius: 6 }}>
              ← Back to Customers
            </button>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>
              {editing === "new" ? "New Customer" : "Edit Customer"}
              {editingCust?.account_number && (
                <span style={{ marginLeft: 12, padding: "2px 10px", borderRadius: 4, fontSize: 13, fontWeight: 600, background: "#f59e0b22", color: C.accent }}>
                  {editingCust.account_number}
                </span>
              )}
            </h2>
          </div>
          {editing !== "new" && custBalance && (
            <div style={{ display: "flex", gap: 24, alignItems: "center", padding: "8px 16px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Outstanding (inc GST)</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: custBalance.balance > 0 ? C.red : C.muted }}>
                  {fmtMoney(custBalance.balance)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Credit Available (inc GST)</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: custBalance.credit_balance > 0 ? C.green : C.muted }}>
                  {fmtMoney(custBalance.credit_balance)}
                </div>
              </div>
              <div style={{ fontSize: 11, color: C.muted, textAlign: "right" }}>
                {(custBalance.open_invoices?.length || 0)} open invoice{(custBalance.open_invoices?.length || 0) === 1 ? "" : "s"}<br />
                {(custBalance.active_credits?.length || 0)} active credit{(custBalance.active_credits?.length || 0) === 1 ? "" : "s"}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>Customers</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowArchived(v => !v)} style={{ ...btnStyle(showArchived ? C.accent : undefined), fontSize: 13 }}>
                {showArchived ? "Showing Archived" : "Show Archived"}
              </button>
              {!showArchived && <button onClick={() => startEdit(null)} style={btnStyle()}>+ Add Customer</button>}
            </div>
          </div>
          <input placeholder="Search by account #, name, address, contact..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, marginBottom: 16, maxWidth: 400 }} />
        </>
      )}

      {editing && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

            {/* Company basics */}
            <div>
              <label style={labelStyle}>
                Company Name {form.customer_category === "Residential" ? <span style={{ color: C.muted, fontWeight: 500 }}>(optional)</span> : "*"}
              </label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} style={inputStyle} placeholder={form.customer_category === "Residential" ? "Optional for residential" : ""} />
            </div>
            <div>
              <label style={labelStyle}>ABN</label>
              <input value={form.abn} onChange={e => setForm(p => ({ ...p, abn: e.target.value }))} style={inputStyle} />
              {(() => {
                const c = validateABNClient(form.abn);
                if (!form.abn || !form.abn.trim()) return null;
                if (c.valid) return <div style={{ fontSize: 10, color: C.green, marginTop: 3 }}>✓ Valid ABN format</div>;
                return <div style={{ fontSize: 10, color: C.accent, marginTop: 3 }}>⚠ {c.reason}</div>;
              })()}
            </div>
            <div>
              <label style={labelStyle}>Contact Person</label>
              <input value={form.contact} onChange={e => setForm(p => ({ ...p, contact: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Rep Name</label>
              <input value={form.rep_name} onChange={e => setForm(p => ({ ...p, rep_name: e.target.value }))} placeholder="First Last" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Alternative Contact Name</label>
              <input value={form.alternative_contact_name} onChange={e => setForm(p => ({ ...p, alternative_contact_name: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Alternative Contact Phone</label>
              <input value={form.alternative_contact_phone} onChange={e => setForm(p => ({ ...p, alternative_contact_phone: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Delivery Address</label>
              <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>State</label>
              <select value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} style={inputStyle}>
                <option value="">— Select —</option>
                {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Duration</label>
              <input value={form.duration} onChange={e => setForm(p => ({ ...p, duration: e.target.value }))} style={inputStyle} />
            </div>
            {/* Last sale price (read-only display, only on existing customers) */}
            {editing !== "new" && lastSalePrice && (
              <div style={{ gridColumn: "1/-1", padding: "8px 12px", background: C.input, borderRadius: 6, fontSize: 12 }}>
                <span style={{ color: C.muted, fontWeight: 600, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em" }}>Last sale price: </span>
                {lastSalePrice.found ? (
                  <span>
                    <strong style={{ color: C.green }}>{fmtCurrency(lastSalePrice.unit_price)}</strong>
                    {" "}for <strong>{lastSalePrice.cylinder_label}</strong>
                    {" "}on <span style={{ color: C.muted }}>{lastSalePrice.order_date}</span>
                    {lastSalePrice.order_number && <span style={{ color: C.accent, marginLeft: 6 }}>({lastSalePrice.order_number})</span>}
                  </span>
                ) : (
                  <span style={{ color: C.muted }}>No sale orders yet</span>
                )}
              </div>
            )}

            {/* Accounts contact */}
            <div style={sectionStyle}>Accounts Contact</div>
            <div>
              <label style={labelStyle}>Account Contact Person</label>
              <input value={form.accounts_contact} onChange={e => setForm(p => ({ ...p, accounts_contact: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Accounts Phone</label>
              <input value={form.accounts_phone} onChange={e => setForm(p => ({ ...p, accounts_phone: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Accounts Email</label>
              <input value={form.accounts_email} onChange={e => setForm(p => ({ ...p, accounts_email: e.target.value }))} style={inputStyle} />
            </div>

            {/* Compliance */}
            <div style={sectionStyle}>Compliance</div>
            <div>
              <label style={labelStyle}>Compliance Number (max 300)</label>
              <input maxLength={300} value={form.compliance_number} onChange={e => setForm(p => ({ ...p, compliance_number: e.target.value }))} style={inputStyle} disabled={form.compliance_not_required} />
            </div>
            <div>
              <label style={labelStyle}>Pressure Test (max 10)</label>
              <input maxLength={10} value={form.pressure_test} onChange={e => setForm(p => ({ ...p, pressure_test: e.target.value }))} style={inputStyle} disabled={form.compliance_not_required} />
            </div>
            <div style={{ gridColumn: "1/-1", display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <input type="checkbox" id="compliance_nr" checked={form.compliance_not_required} onChange={e => setForm(p => ({ ...p, compliance_not_required: e.target.checked }))} />
              <label htmlFor="compliance_nr" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Compliance not required</label>
              <span style={{ fontSize: 11, color: C.muted }}>(suppresses the red highlight on the customer list)</span>
            </div>
            <div>
              <label style={labelStyle}>Chain on Gas Bottle</label>
              <select value={form.chain ? "yes" : "no"} onChange={e => setForm(p => ({ ...p, chain: e.target.value === "yes" }))} style={inputStyle}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>Does the customer have a chain securing their gas bottle?</div>
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Customer Documents</label>
              <input value={form.onedrive_link} onChange={e => setForm(p => ({ ...p, onedrive_link: e.target.value }))} placeholder="https://..." style={inputStyle} />
            </div>

            {/* Rental & contract */}
            <div style={sectionStyle}>Rental & Contract</div>
            <div>
              <label style={labelStyle}>Rental Frequency</label>
              <select value={form.rental_frequency} onChange={e => setForm(p => ({ ...p, rental_frequency: e.target.value }))} style={inputStyle}>
                <option value="">— Select —</option>
                {RENTAL_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Invoice Frequency</label>
              <select value={form.invoice_frequency} onChange={e => setForm(p => ({ ...p, invoice_frequency: e.target.value }))} style={inputStyle}>
                <option value="">— Select —</option>
                <option value="Weekly">Weekly</option>
                <option value="Fortnightly">Fortnightly (Friday evening)</option>
                <option value="Monthly">Monthly</option>
              </select>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>Controls when PDF invoices are sent to the customer, regardless of when they are generated.</div>
            </div>
            <div>
              <label style={labelStyle}>Customer Type</label>
              <select value={form.customer_type} onChange={e => setForm(p => ({ ...p, customer_type: e.target.value }))} style={inputStyle}>
                <option value="">— Select —</option>
                {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Residential / Commercial</label>
              <select value={form.customer_category} onChange={e => setForm(p => ({ ...p, customer_category: e.target.value }))} style={inputStyle}>
                <option value="">— Select —</option>
                {CUSTOMER_CATEGORIES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {form.customer_type === "Fixed" && (
              <>
                <div>
                  <label style={labelStyle}>Fixed Start Date *</label>
                  <input type="date" value={form.customer_type_start} onChange={e => setForm(p => ({ ...p, customer_type_start: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Fixed End Date *</label>
                  <input type="date" value={form.customer_type_end} onChange={e => setForm(p => ({ ...p, customer_type_end: e.target.value }))} style={inputStyle} />
                </div>
              </>
            )}
            <div>
              <label style={labelStyle}>Payment Terms</label>
              <select value={form.payment_terms} onChange={e => setForm(p => ({ ...p, payment_terms: e.target.value }))} style={inputStyle}>
                <option value="">— Select —</option>
                <option value="COD">COD (due on invoice date)</option>
                <option value="14 days">14 days</option>
                <option value="30 days">30 days</option>
                <option value="EOM 14 days">EOM 14 days (end of month + 14)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Payment Reference</label>
              <input value={form.payment_ref} onChange={e => setForm(p => ({ ...p, payment_ref: e.target.value }))} placeholder="e.g. Visa 4521, Cash" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>CC on File</label>
              <input
                value={form.cc_number}
                onChange={e => setForm(p => ({ ...p, cc_number: e.target.value.replace(/[^\d\s]/g, "") }))}
                placeholder={editing !== "new" ? "Leave blank to keep existing" : "Card number (encrypted)"}
                style={inputStyle}
                inputMode="numeric"
              />
              {editing !== "new" && editingCust?.cc_masked && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Current: {editingCust.cc_masked}</div>
              )}
            </div>

            {/* Milk Run */}
            <div style={sectionStyle}>Milk Run</div>
            <div style={{ gridColumn: "1/-1", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {MILK_RUN_DAYS.map(d => {
                  const active = (form.milk_run_days || "").split(",").includes(d.key);
                  return (
                    <label key={d.key} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 13, padding: "6px 10px", borderRadius: 6, background: active ? "#f59e0b22" : C.input, border: `1px solid ${active ? C.accent : C.inputBorder}` }}>
                      <input type="checkbox" checked={active} onChange={() => toggleMilkDay(d.key)} style={{ margin: 0 }} />
                      {d.label}
                    </label>
                  );
                })}
              </div>
              <div>
                <select value={form.milk_run_frequency} onChange={e => setForm(p => ({ ...p, milk_run_frequency: e.target.value }))} style={{ ...inputStyle, width: "auto" }}>
                  <option value="">— Frequency —</option>
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Fortnightly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>

            {/* General notes + account customer */}
            <div style={sectionStyle}>Notes</div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Driver's Notes</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>

            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Add Internal Note (timestamped on save)</label>
              <textarea value={form.new_internal_note} onChange={e => setForm(p => ({ ...p, new_internal_note: e.target.value }))} rows={2} placeholder="Type a new internal note..." style={{ ...inputStyle, resize: "vertical" }} />
            </div>

            {existingNotes.length > 0 && (
              <div style={{ gridColumn: "1/-1" }}>
                <label style={labelStyle}>Internal Notes History ({existingNotes.length})</label>
                <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.inputBorder}`, borderRadius: 6, background: C.input }}>
                  {existingNotes.map((n, i) => (
                    <div key={i} style={{ padding: "8px 12px", borderBottom: i < existingNotes.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 4 }}>
                        {n.date ? fmtDateTime(n.date) : ""}
                      </div>
                      <div style={{ fontSize: 13, color: C.text, whiteSpace: "pre-wrap" }}>{n.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ gridColumn: "1/-1", display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
              <input type="checkbox" id="account_cust" checked={form.account_customer} onChange={e => setForm(p => ({ ...p, account_customer: e.target.checked }))} />
              <label htmlFor="account_cust" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Account Customer</label>
              <span style={{ fontSize: 11, color: C.muted }}>(rental cylinder tracking & billing)</span>
            </div>

            {editing !== "new" && (
              <div style={{ gridColumn: "1/-1", display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
                <input type="checkbox" id="archived_cust" checked={!!form.archived} onChange={e => setForm(p => ({ ...p, archived: e.target.checked }))} />
                <label htmlFor="archived_cust" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer", color: form.archived ? C.red : C.text }}>Archived</label>
                <span style={{ fontSize: 11, color: C.muted }}>(hides this customer from the active customer list)</span>
              </div>
            )}

            {/* Pricing panel — only on existing customers */}
            {editing !== "new" && custPriceList.length > 0 && (
              <>
                <div style={sectionStyle}>Customer Pricing</div>
                <div style={{ gridColumn: "1/-1", overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        {["Item", "Type", "Default $", "Customer $", "Fixed", "Fixed From", "Fixed To", ""].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {custPriceList.map(cp => (
                        <CustPriceRow key={cp.cylinder_type} cp={cp} onSave={saveCustPrice} />
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                    Prices in <span style={{ color: C.accent }}>amber</span> are custom for this customer. Leave at default to use the standard price.
                  </div>
                </div>
              </>
            )}

            {/* Orders & Balance panel — only on existing customers */}
            {editing !== "new" && (
              <>
                <div style={{ ...sectionStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Orders & Balance</span>
                  {onOpenOrder && <button onClick={() => onOpenOrder(null, editing)} style={{ ...btnStyle(C.green), padding: "4px 12px", fontSize: 11, fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>+ New Order</button>}
                </div>
<div style={{ gridColumn: "1/-1" }}>
                  <label style={labelStyle}>Customer Orders ({custOrders.length})</label>
                  {custOrders.length === 0 ? (
                    <div style={{ padding: 16, textAlign: "center", background: C.input, borderRadius: 6, color: C.muted, fontSize: 12 }}>No orders yet for this customer</div>
                  ) : (
                    <div style={{ maxHeight: 300, overflowY: "auto", border: `1px solid ${C.inputBorder}`, borderRadius: 6 }}>
                      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0 }}>
                            {["Order #", "Date", "PO#", "Order", "Total", "Paid", "Status"].map(h => (
                              <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {custOrders.map(o => (
                            <tr
                              key={o.id}
                              onClick={() => onOpenOrder && onOpenOrder(o.id)}
                              style={{ borderBottom: `1px solid ${C.border}`, cursor: onOpenOrder ? "pointer" : "default" }}
                              title={onOpenOrder ? "Click to open in Orders" : ""}
                            >
                              <td style={{ padding: "6px 8px", color: C.accent, fontWeight: 600 }}>{o.order_number || "—"}</td>
                              <td style={{ padding: "6px 8px" }}>{o.order_date}</td>
                              <td style={{ padding: "6px 8px", color: C.muted }}>{o.po_number || "—"}</td>
                              <td style={{ padding: "6px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.order_detail || "—"}</td>
                              <td style={{ padding: "6px 8px", fontWeight: 700, color: C.green }} title="Includes GST">{o.total_price ? fmtMoney(o.total_price) : "—"}</td>
                              <td style={{ padding: "6px 8px" }}>
                                {o.paid ? <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#22c55e22", color: C.green }}>PAID</span> : <span style={{ color: C.muted }}>—</span>}
                              </td>
                              <td style={{ padding: "6px 8px", color: C.muted }}>{o.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button onClick={save} style={btnStyle(C.green)}>Save</button>
            <button onClick={() => setEditing(null)} style={btnStyle(C.muted)}>Cancel</button>
          </div>
        </Card>
      )}

      {!editing && (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Account #", "Address", "Company", "Contact", "Phone", "State", "Acct", "CC on File", "Documents", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px", color: C.muted, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const missingCompliance = !c.compliance_not_required && (!(c.compliance_number || "").trim() || !(c.pressure_test || "").trim());
              return (
              <tr key={c.id} title={missingCompliance ? "Missing compliance number and/or pressure test" : ""} style={{
                borderBottom: `1px solid ${C.border}`,
                background: missingCompliance ? "#ef444415" : "transparent",
                borderLeft: missingCompliance ? `3px solid ${C.red}` : "3px solid transparent",
              }}>
                <td style={{ padding: "8px", color: C.accent, fontWeight: 600 }}>{c.account_number || "—"}</td>
                <td style={{ padding: "8px", color: C.accent, fontWeight: 500 }}>{c.address || "—"}</td>
                <td style={{ padding: "8px", fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: "8px" }}>{c.contact}</td>
                <td style={{ padding: "8px" }}>{c.phone}</td>
                <td style={{ padding: "8px" }}>{c.state || "—"}</td>
                <td style={{ padding: "8px" }}>
                  {c.account_customer ? <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: "#3b82f622", color: C.blue }}>ACC</span> : "—"}
                </td>
                <td style={{ padding: "8px" }}>
                  {c.cc_masked ? <CCReveal customerId={c.id} masked={c.cc_masked} /> : <span style={{ color: C.muted }}>—</span>}
                </td>
                <td style={{ padding: "8px" }}>
                  {c.onedrive_link ? <a href={c.onedrive_link} target="_blank" rel="noreferrer" style={{ color: C.blue, textDecoration: "none", fontWeight: 600 }}>Docs ↗</a> : "—"}
                </td>
                <td style={{ padding: "8px" }}>
                  <button onClick={() => startEdit(c)} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12, marginRight: 8 }}>Edit</button>
                  <button onClick={() => del(c.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12 }}>Delete</button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ textAlign: "center", padding: 32, color: C.muted }}>No customers found</div>}
      </div>
      )}
    </div>
  );
}

// ==================== CYLINDER TYPES VIEW ====================
function CylinderTypesView({ cylinderTypes, reload, showToast }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ label: "", default_price: 0, gas_group: "", item_type: "cylinder", sort_order: 0, linked_sale_item_id: "", litres: 0 });

  const startEdit = (ct) => {
    setEditing(ct?.id || "new");
    setForm(ct
      ? { label: ct.label, default_price: ct.default_price, gas_group: ct.gas_group || "", item_type: ct.item_type || "cylinder", sort_order: ct.sort_order || 0, linked_sale_item_id: ct.linked_sale_item_id || "", litres: ct.litres || 0 }
      : { label: "", default_price: 0, gas_group: "", item_type: "cylinder", sort_order: 0, linked_sale_item_id: "", litres: 0 });
  };

  const save = async () => {
    try {
      // Clear link if user switched to sale type
      const payload = { ...form, linked_sale_item_id: form.item_type === "cylinder" ? form.linked_sale_item_id : "" };
      if (editing === "new") await api.createCylinderType(payload);
      else await api.updateCylinderType(editing, payload);
      reload(); setEditing(null);
      showToast(editing === "new" ? "Type created" : "Type updated");
    } catch (e) { showToast(e.message, "error"); }
  };

  const del = async (id) => {
    if (!confirm("Delete this cylinder type?")) return;
    try { await api.deleteCylinderType(id); reload(); showToast("Type deleted"); }
    catch (e) { showToast(e.message, "error"); }
  };

  // Sale items available to link (exclude the one currently being edited just in case)
  const saleItems = (cylinderTypes || []).filter(ct => ct.item_type === "sale");
  // Build a label lookup for the table
  const typeLabel = (id) => (cylinderTypes || []).find(ct => ct.id === id)?.label || "";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Cylinder Types</h2>
        <button onClick={() => startEdit(null)} style={btnStyle()}>+ Add Type</button>
      </div>
      {editing && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <div><label style={labelStyle}>Label *</label><input value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>Default Price</label><input type="number" step="0.01" value={form.default_price} onChange={e => setForm(p => ({ ...p, default_price: parseFloat(e.target.value) || 0 }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>Gas Group</label><input value={form.gas_group} onChange={e => setForm(p => ({ ...p, gas_group: e.target.value }))} style={inputStyle} /></div>
            <div>
              <label style={labelStyle}>Item Type</label>
              <select value={form.item_type} onChange={e => setForm(p => ({ ...p, item_type: e.target.value }))} style={inputStyle}>
                <option value="cylinder">Cylinder (rental)</option>
                <option value="sale">Sale item</option>
              </select>
            </div>
            {form.item_type === "sale" && (
              <div>
                <label style={labelStyle}>Litres</label>
                <input type="number" step="0.1" value={form.litres} onChange={e => setForm(p => ({ ...p, litres: parseFloat(e.target.value) || 0 }))} style={inputStyle} placeholder="e.g. 88.2" />
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Used for per-litre price calculations in Pricing Manager.</div>
              </div>
            )}
            {form.item_type === "cylinder" && (
              <div style={{ gridColumn: "1/-1" }}>
                <label style={labelStyle}>Linked Sale Item</label>
                <select value={form.linked_sale_item_id} onChange={e => setForm(p => ({ ...p, linked_sale_item_id: e.target.value }))} style={inputStyle}>
                  <option value="">— None —</option>
                  {saleItems.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  When a customer buys the linked sale item, their sale qty is capped at their current on-hand of this rental.
                  If they exceed it, the system will auto-create additional rental charges for the overflow.
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={save} style={btnStyle(C.green)}>Save</button>
            <button onClick={() => setEditing(null)} style={btnStyle(C.muted)}>Cancel</button>
          </div>
        </Card>
      )}
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
          {["Label", "Default Price", "Gas Group", "Type", "Litres", "Linked Sale", "Actions"].map(h => <th key={h} style={{ textAlign: "left", padding: "8px", color: C.muted, fontWeight: 600 }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {(cylinderTypes || []).map(ct => (
            <tr key={ct.id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px", fontWeight: 600 }}>{ct.label}</td>
              <td style={{ padding: "8px" }}>{fmtCurrency(ct.default_price)}</td>
              <td style={{ padding: "8px" }}>{ct.gas_group || "—"}</td>
              <td style={{ padding: "8px" }}>{ct.item_type}</td>
              <td style={{ padding: "8px", color: ct.item_type === "sale" && ct.litres ? C.text : C.muted }}>
                {ct.item_type === "sale" ? (ct.litres ? `${ct.litres}L` : "—") : "—"}
              </td>
              <td style={{ padding: "8px", color: ct.linked_sale_item_id ? C.blue : C.muted }}>
                {ct.item_type === "cylinder" ? (ct.linked_sale_item_id ? typeLabel(ct.linked_sale_item_id) : "—") : "—"}
              </td>
              <td style={{ padding: "8px" }}>
                <button onClick={() => startEdit(ct)} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12, marginRight: 8 }}>Edit</button>
                <button onClick={() => del(ct.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12 }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==================== DELIVER/RETURN VIEW ====================
function DeliveryView({ customers, cylinderTypes, showToast, refreshAll }) {
  const [form, setForm] = useState({
    customer_id: "", cylinder_type: "", delivered: 0, returned: 0,
    date: new Date().toISOString().split("T")[0], notes: ""
  });
  const [saleCap, setSaleCap] = useState(null); // { linked, cap, rental_label } or null

  const selectedType = (cylinderTypes || []).find(ct => ct.id === form.cylinder_type);
  const isSaleItem = selectedType?.item_type === "sale";

  // Look up the current cap whenever customer+sale item combo changes
  useEffect(() => {
    if (form.customer_id && isSaleItem) {
      api.getSaleCap(form.customer_id, form.cylinder_type)
        .then(r => setSaleCap(r))
        .catch(() => setSaleCap(null));
    } else {
      setSaleCap(null);
    }
  }, [form.customer_id, form.cylinder_type, isSaleItem]);

  const overflowQty = (isSaleItem && saleCap?.linked && form.delivered > (saleCap.cap || 0))
    ? form.delivered - (saleCap.cap || 0)
    : 0;

  const submit = async () => {
    try {
      const promises = [];
      if (form.delivered > 0) {
        promises.push(api.createTransaction({
          customer_id: form.customer_id, cylinder_type: form.cylinder_type,
          type: "delivery", qty: form.delivered, date: form.date, notes: form.notes,
        }));
      }
      if (form.returned > 0) {
        promises.push(api.createTransaction({
          customer_id: form.customer_id, cylinder_type: form.cylinder_type,
          type: "return", qty: form.returned, date: form.date, notes: form.notes,
        }));
      }
      if (promises.length === 0) return showToast("Enter at least one quantity", "error");
      await Promise.all(promises);
      const parts = [];
      if (form.delivered > 0) parts.push(`${form.delivered} delivered`);
      if (form.returned > 0) parts.push(`${form.returned} returned`);
      if (overflowQty > 0) parts.push(`+${overflowQty} auto-rental`);
      showToast(`Recorded: ${parts.join(", ")}`);
      setForm(f => ({ ...f, customer_id: "", cylinder_type: "", delivered: 0, returned: 0, notes: "" }));
      setSaleCap(null);
      refreshAll();
    } catch (e) { showToast(e.message, "error"); }
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Deliver / Return</h2>
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Customer</label>
            <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} style={inputStyle}>
              <option value="">Select customer...</option>
              {(customers || []).map(c => <option key={c.id} value={c.id}>{c.name} — {c.address}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Cylinder Type</label>
            <select value={form.cylinder_type} onChange={e => setForm(p => ({ ...p, cylinder_type: e.target.value }))} style={inputStyle}>
              <option value="">Select type...</option>
              {(cylinderTypes || []).map(ct => <option key={ct.id} value={ct.id}>{ct.label}{ct.item_type === "sale" ? " (sale)" : ""}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Delivered</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min="0" value={form.delivered} onChange={e => setForm(p => ({ ...p, delivered: parseInt(e.target.value) || 0 }))} style={{ ...inputStyle, flex: 1 }} />
              <span style={{ fontSize: 20, color: C.green, fontWeight: 800 }}>↓</span>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Returned</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min="0" value={form.returned} onChange={e => setForm(p => ({ ...p, returned: parseInt(e.target.value) || 0 }))} style={{ ...inputStyle, flex: 1 }} />
              <span style={{ fontSize: 20, color: C.red, fontWeight: 800 }}>↑</span>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Date</label>
            <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Notes (docket/PO)</label>
            <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} style={inputStyle} />
          </div>
        </div>

        {/* Sale cap info */}
        {isSaleItem && saleCap && (
          <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 6, fontSize: 12, background: saleCap.linked ? (overflowQty > 0 ? "#f59e0b22" : "#3b82f622") : C.input, border: `1px solid ${saleCap.linked ? (overflowQty > 0 ? C.accent : C.blue) : C.inputBorder}` }}>
            {saleCap.linked ? (
              <>
                <div style={{ fontWeight: 600, color: overflowQty > 0 ? C.accent : C.blue }}>
                  Linked to rental: <strong>{saleCap.rental_label}</strong> — customer currently has <strong>{saleCap.cap}</strong> on hire
                </div>
                {overflowQty > 0 && (
                  <div style={{ marginTop: 4, color: C.accent }}>
                    ⚠ Delivering {form.delivered} exceeds cap by <strong>{overflowQty}</strong>. An extra rental delivery will be auto-created for the overflow.
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: C.muted }}>This sale item is not linked to a rental cylinder — no cap applies.</div>
            )}
          </div>
        )}

        {/* Summary preview */}
        {(form.delivered > 0 || form.returned > 0) && (
          <div style={{ marginTop: 12, padding: "8px 12px", background: C.input, borderRadius: 6, fontSize: 13, display: "flex", gap: 16 }}>
            {form.delivered > 0 && <span style={{ color: C.green, fontWeight: 600 }}>↓ {form.delivered} delivery</span>}
            {form.returned > 0 && <span style={{ color: C.red, fontWeight: 600 }}>↑ {form.returned} return</span>}
            <span style={{ color: C.muted }}>Net: {form.delivered - form.returned}</span>
          </div>
        )}

        <button
          onClick={submit}
          disabled={!form.customer_id || !form.cylinder_type || (form.delivered === 0 && form.returned === 0)}
          style={{ ...btnStyle(C.accent), marginTop: 16, width: "100%" }}
        >
          Record Transaction
        </button>
      </Card>
    </div>
  );
}

// ==================== TRACKING VIEW ====================
function TrackingView({ customers, cylinderTypes }) {
  const [filter, setFilter] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const onHand = useApi(() => api.getOnHand());
  const txs = useApi(() => api.getTransactions(filter ? { customer_id: filter, limit: 50 } : { limit: 50 }), [filter]);

  // 3.0.18: fetch customers locally as a fallback when the parent-provided prop is empty
  // (e.g. on first mount before the global customers hook resolves). Keeps the dropdown
  // usable regardless of parent data-fetch timing.
  const localCustomers = useApi(() => api.getCustomers());
  const effectiveCustomers = (customers && customers.length > 0) ? customers : (localCustomers.data || []);

  const customerMap = useMemo(() => {
    const m = {}; effectiveCustomers.forEach(c => m[c.id] = c); return m;
  }, [effectiveCustomers]);
  const ctMap = useMemo(() => {
    const m = {}; (cylinderTypes || []).forEach(ct => m[ct.id] = ct); return m;
  }, [cylinderTypes]);

  // Filtered customer list for the autocomplete — matches on name, address, account_number, or contact.
  const matchingCustomers = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return effectiveCustomers.slice(0, 50);
    return effectiveCustomers.filter(c => (
      (c.name || "").toLowerCase().includes(q) ||
      (c.address || "").toLowerCase().includes(q) ||
      (c.account_number || "").toLowerCase().includes(q) ||
      (c.contact || "").toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q)
    )).slice(0, 50);
  }, [effectiveCustomers, filterQuery]);

  // Only show cylinder-type items (not sales)
  const cylinderTypeIds = useMemo(() => new Set((cylinderTypes || []).filter(ct => ct.item_type === "cylinder").map(ct => ct.id)), [cylinderTypes]);
  const filteredTxs = useMemo(() => (txs.data || []).filter(tx => cylinderTypeIds.has(tx.cylinder_type)), [txs.data, cylinderTypeIds]);

  const selectedLabel = filter
    ? (() => {
        const c = customerMap[filter];
        if (!c) return "(selected)";
        return [c.account_number, c.name, c.address].filter(Boolean).join(" — ");
      })()
    : "";

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Cylinder Tracking</h2>

      {/* 3.0.18: autocomplete customer filter — searches name, address, account # and contact */}
      <div style={{ position: "relative", maxWidth: 420, marginBottom: 16 }}>
        <input
          placeholder="All customers — type to search by name, address or account #"
          value={filterOpen ? filterQuery : (selectedLabel || filterQuery)}
          onFocus={() => { setFilterOpen(true); setFilterQuery(""); }}
          onBlur={() => setTimeout(() => setFilterOpen(false), 150)}
          onChange={e => { setFilterQuery(e.target.value); setFilterOpen(true); }}
          style={{ ...inputStyle, width: "100%" }}
        />
        {filter && (
          <button onClick={() => { setFilter(""); setFilterQuery(""); }}
            style={{ position: "absolute", right: 8, top: 6, background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16 }}>×</button>
        )}
        {filterOpen && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1a1d24", border: `1px solid ${C.border}`, borderRadius: 6, marginTop: 4, maxHeight: 320, overflowY: "auto", zIndex: 10 }}>
            <div onMouseDown={() => { setFilter(""); setFilterOpen(false); }}
              style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 12 }}>
              All customers
            </div>
            {matchingCustomers.length === 0 && (
              <div style={{ padding: "8px 12px", color: C.muted, fontSize: 12 }}>No matches</div>
            )}
            {matchingCustomers.map(c => (
              <div key={c.id} onMouseDown={() => { setFilter(c.id); setFilterOpen(false); }}
                style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>{formatCustomerDisplay(c) || "(no name)"}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>
                  {[c.account_number, c.address].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>On-Hand Summary</div>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
            {["Customer", "Cylinder Type", "On-Hand"].map(h => <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {(onHand.data || []).filter(r => !filter || r.customer_id === filter).map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "6px 8px" }}>{formatCustomerDisplay(customerMap[r.customer_id]) || r.customer_name || r.address || r.customer_id}</td>
                <td style={{ padding: "6px 8px" }}>{r.cylinder_label || ctMap[r.cylinder_type]?.label || r.cylinder_type}</td>
                <td style={{ padding: "6px 8px", fontWeight: 700, color: r.on_hand > 0 ? C.accent : C.green }}>{r.on_hand}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Transaction History</div>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
            {["Date", "Customer", "Type", "Cylinder", "Qty", "Source", "Notes"].map(h => <th key={h} style={{ textAlign: "left", padding: "4px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filteredTxs.map(tx => (
              <tr key={tx.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "4px 8px" }}>{tx.date}</td>
                <td style={{ padding: "4px 8px" }}>{formatCustomerDisplay(customerMap[tx.customer_id]) || tx.customer_name || tx.address || "?"}</td>
                <td style={{ padding: "4px 8px" }}>
                  <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: tx.type === "delivery" ? "#22c55e22" : "#ef444422", color: tx.type === "delivery" ? C.green : C.red }}>{tx.type}</span>
                </td>
                <td style={{ padding: "4px 8px" }}>{ctMap[tx.cylinder_type]?.label || "?"}</td>
                <td style={{ padding: "4px 8px", fontWeight: 600 }}>{tx.qty}</td>
                <td style={{ padding: "4px 8px" }}>
                  {tx.source === "optimoroute" ? <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: "#8b5cf622", color: C.purple }}>OR</span> : <span style={{ color: C.muted, fontSize: 11 }}>manual</span>}
                </td>
                <td style={{ padding: "4px 8px", color: C.muted, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ==================== BILLING VIEW ====================
// Shared rental scheduler controls — used by both Billing and Rental History.
// Provides Initialize, Run Due Now, Force Generate All, and Generate For Selected.
function RentalSchedulerControls({ customers, showToast, onComplete }) {
  const [busy, setBusy] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");

  const accountCustomers = useMemo(
    () => (customers || []).filter(c => c.account_customer),
    [customers]
  );
  const filteredAccountCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accountCustomers;
    return accountCustomers.filter(c =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.address || "").toLowerCase().includes(q) ||
      (c.account_number || "").toLowerCase().includes(q) ||
      (c.contact || "").toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q)
    );
  }, [accountCustomers, search]);

  const initializeRentals = async () => {
    if (!confirm("Seed rental cycles for all account customers based on their most recent rental delivery? Safe to re-run.")) return;
    setBusy(true);
    try {
      const r = await api.initializeRentals();
      showToast(`Initialized ${r.seeded || 0} customer(s)`);
      onComplete?.();
    } catch (e) { showToast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const runDue = async () => {
    if (!confirm("Run the rental scheduler now? This bills any account customer whose cycle is due (residential = per frequency, commercial = end of month).")) return;
    setBusy(true);
    try {
      const r = await api.runDueRentals();
      showToast(`${r.customersBilled} customers billed, ${r.invoicesCreated} invoices, ${r.transactionsCreated} transactions`);
      onComplete?.();
    } catch (e) { showToast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const forceAll = async () => {
    if (!confirm(`Force-generate rental invoices for ALL ${accountCustomers.length} account customers, dated today? This bypasses the cycle and bills everyone with on-hand cylinders. Use with care.`)) return;
    setBusy(true);
    try {
      const r = await api.generateRentalsForce(null);
      showToast(`${r.customersBilled} customers billed, ${r.invoicesCreated} invoices, ${r.transactionsCreated} transactions`);
      onComplete?.();
    } catch (e) { showToast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const forceSalesAll = async () => {
    if (!confirm(`Force-generate sales invoices for ALL commercial account customers now? This collects all pending delivered orders into one invoice per customer.`)) return;
    setBusy(true);
    try {
      const r = await api.generateSalesForce(null);
      showToast(`${r.customersBilled} customers billed, ${r.invoicesCreated} invoices created`);
      onComplete?.();
    } catch (e) { showToast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const forceSelected = async () => {
    if (selected.length === 0) return;
    if (!confirm(`Force-generate rental invoices for ${selected.length} selected customer(s), dated today?`)) return;
    setBusy(true);
    try {
      const r = await api.generateRentalsForce(selected);
      showToast(`${r.customersBilled} customers billed, ${r.invoicesCreated} invoices, ${r.transactionsCreated} transactions`);
      setSelected([]);
      setShowSelector(false);
      onComplete?.();
    } catch (e) { showToast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const forceSalesSelected = async () => {
    if (selected.length === 0) return;
    if (!confirm(`Force-generate sales invoices for ${selected.length} selected customer(s)?`)) return;
    setBusy(true);
    try {
      const r = await api.generateSalesForce(selected);
      showToast(`${r.customersBilled} customers billed, ${r.invoicesCreated} invoices created`);
      setSelected([]);
      setShowSelector(false);
      onComplete?.();
    } catch (e) { showToast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const toggleSel = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Rental Scheduler</div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
        Residential customers bill per their rental frequency. Commercial customers bill on the last day of each month, regardless of frequency.
        The scheduler runs automatically every 6 hours — these buttons let you trigger it manually or force a billing run outside the cycle.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={initializeRentals} disabled={busy} style={btnStyle(C.muted)}>Initialize Rental Cycles</button>
        <button onClick={runDue} disabled={busy} style={btnStyle(C.blue)}>{busy ? "Working..." : "Run Due Rentals Now"}</button>
        <button onClick={forceAll} disabled={busy} style={btnStyle(C.accent)}>Force Rental Invoices (All)</button>
        <button onClick={forceSalesAll} disabled={busy} style={btnStyle(C.green)}>Force Sales Invoices (All)</button>
        <button onClick={() => setShowSelector(s => !s)} disabled={busy} style={btnStyle(C.muted)}>
          {showSelector ? "Hide Selector" : "Generate For Selected..."}
        </button>
      </div>

      {showSelector && (
        <div style={{ marginTop: 12, padding: 12, background: C.input, borderRadius: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <input
              placeholder="Search account customers..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...inputStyle, maxWidth: 260, padding: "6px 10px", fontSize: 12 }}
            />
            <div style={{ fontSize: 12, color: C.muted }}>{selected.length} selected</div>
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 4 }}>
            {filteredAccountCustomers.length === 0 ? (
              <div style={{ padding: 12, color: C.muted, fontSize: 12, textAlign: "center" }}>No account customers found</div>
            ) : (
              filteredAccountCustomers.map(c => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", fontSize: 12 }}>
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleSel(c.id)} />
                  <span style={{ color: C.accent, fontWeight: 600, minWidth: 80 }}>{c.account_number || "—"}</span>
                  <span style={{ fontWeight: 500 }}>{formatCustomerDisplay(c) || "(no name)"}</span>
                  <span style={{ color: C.muted, marginLeft: "auto", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.address}</span>
                  <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: (c.customer_category || "").toLowerCase() === "commercial" ? "#3b82f622" : "#22c55e22", color: (c.customer_category || "").toLowerCase() === "commercial" ? C.blue : C.green }}>
                    {(c.customer_category || "?").toUpperCase().slice(0, 4)}
                  </span>
                </label>
              ))
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={forceSelected} disabled={busy || selected.length === 0} style={btnStyle(C.accent)}>
              Rental Invoice — {selected.length} Selected
            </button>
            <button onClick={forceSalesSelected} disabled={busy || selected.length === 0} style={btnStyle(C.green)}>
              Sales Invoice — {selected.length} Selected
            </button>
            <button onClick={() => setSelected([])} disabled={selected.length === 0} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>Clear</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function BillingView({ customers, cylinderTypes, showToast, reloadCustomers, emailEnabled, emailConfig }) {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [statusFilter, setStatusFilter] = useState("all"); // all | open | paid | void
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null); // for detail modal
  const [detailData, setDetailData] = useState(null);
  // Round 3: payment recording form state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "manual", reference: "", date: new Date().toISOString().split("T")[0], notes: "" });

  const customerMap = useMemo(() => {
    const m = {};
    for (const c of (customers || [])) m[c.id] = c;
    return m;
  }, [customers]);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter !== "all") params.status = statusFilter;
      const all = await api.getInvoices(params);
      // Filter by date range on the client (invoice_date)
      const filtered = (all || []).filter(inv => {
        if (!inv.invoice_date) return true;
        if (dateFrom && inv.invoice_date < dateFrom) return false;
        if (dateTo && inv.invoice_date > dateTo) return false;
        return true;
      });
      setInvoices(filtered);
    } catch (e) {
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dateFrom, dateTo, statusFilter]);

  // Group by customer; account customers first
  const grouped = useMemo(() => {
    const m = {};
    for (const inv of invoices) {
      const cust = customerMap[inv.customer_id];
      const key = inv.customer_id;
      if (!m[key]) m[key] = {
        customer_id: key,
        customer_name: formatCustomerDisplay(cust) || inv.customer_name || "(unknown)",
        account_number: cust?.account_number || inv.account_number || "",
        account_customer: !!cust?.account_customer,
        category: cust?.customer_category || "",
        invoices: [],
        total: 0,
        paid: 0,
        owed: 0,
      };
      m[key].invoices.push(inv);
      m[key].total += inv.total || 0;
      m[key].paid += inv.amount_paid || 0;
      if (inv.status !== "void") m[key].owed += (inv.total || 0) - (inv.amount_paid || 0);
    }
    for (const k of Object.keys(m)) {
      m[k].total = Math.round(m[k].total * 100) / 100;
      m[k].paid = Math.round(m[k].paid * 100) / 100;
      m[k].owed = Math.round(m[k].owed * 100) / 100;
    }
    return Object.values(m).sort((a, b) => {
      if (a.account_customer !== b.account_customer) return b.account_customer - a.account_customer;
      return (a.customer_name || "").localeCompare(b.customer_name || "");
    });
  }, [invoices, customerMap]);

  const accountGroups = grouped.filter(g => g.account_customer);
  const otherGroups = grouped.filter(g => !g.account_customer);

  // Grand totals
  const grandTotals = useMemo(() => {
    let total = 0, paid = 0, owed = 0;
    for (const inv of invoices) {
      total += inv.total || 0;
      paid += inv.amount_paid || 0;
      if (inv.status !== "void") owed += (inv.total || 0) - (inv.amount_paid || 0);
    }
    return {
      total: Math.round(total * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      owed: Math.round(owed * 100) / 100,
    };
  }, [invoices]);

  const openDetail = async (inv) => {
    setSelectedInvoice(inv);
    setDetailData(null);
    setShowPaymentForm(false);
    setPaymentForm({ amount: "", method: "manual", reference: "", date: new Date().toISOString().split("T")[0], notes: "" });
    try {
      const data = await api.getInvoice(inv.id);
      setDetailData(data);
    } catch (e) { /* tolerate */ }
  };

  const recordPayment = async () => {
    if (!selectedInvoice) return;
    const amt = parseFloat(paymentForm.amount);
    if (!amt || amt <= 0) { showToast("Enter a payment amount", "error"); return; }
    try {
      const r = await api.recordInvoicePayment(selectedInvoice.id, paymentForm);
      let msg = "Payment recorded";
      if (r?.push_attempted && r.push_success) msg += " — order pushed to OptimoRoute";
      else if (r?.push_attempted && !r.push_success) msg += ` — but Optimo push failed: ${r.push_error || "unknown error"}`;
      showToast(msg, r?.push_attempted && !r.push_success ? "error" : "success");
      // Refresh invoice list and detail
      await load();
      await openDetail({ ...selectedInvoice });
      // Refresh customer balances since payment changes them
      try { reloadCustomers && reloadCustomers(); } catch (e) {}
    } catch (e) { showToast(e.message, "error"); }
  };

  const statusBadge = (status) => {
    const colors = {
      open:    { bg: "#f59e0b22", fg: C.accent },
      paid:    { bg: "#22c55e22", fg: C.green },
      void:    { bg: "#6b728022", fg: C.muted },
      pending: { bg: "#a855f722", fg: "#a855f7" },  // round 3: not yet delivered
    };
    const c = colors[status] || { bg: C.input, fg: C.muted };
    return <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: c.bg, color: c.fg, textTransform: "uppercase" }}>{status}</span>;
  };

  const renderGroupSection = (title, groups, badgeColor) => groups.length > 0 && (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${badgeColor}22`, color: badgeColor }}>{title.toUpperCase()}</span>
        <span style={{ color: C.muted, fontSize: 12 }}>({groups.length} customer{groups.length === 1 ? "" : "s"})</span>
      </div>
      {groups.map(g => (
        <div key={g.customer_id} style={{ marginBottom: 16, padding: 12, background: C.input, borderRadius: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>
              {g.account_number && <span style={{ color: C.accent, marginRight: 8 }}>{g.account_number}</span>}
              {g.customer_name}
              {g.category && <span style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: C.panel, color: C.muted }}>{g.category}</span>}
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
              <span style={{ color: C.muted }}>Total <strong style={{ color: C.text }}>{fmtMoney(g.total)}</strong></span>
              <span style={{ color: C.muted }}>Paid <strong style={{ color: C.green }}>{fmtMoney(g.paid)}</strong></span>
              <span style={{ color: C.muted }}>Owed <strong style={{ color: g.owed > 0 ? C.red : C.muted }}>{fmtMoney(g.owed)}</strong></span>
              <span style={{ color: C.muted, fontSize: 10 }}>(inc GST)</span>
            </div>
          </div>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Invoice #", "Date", "Due Date", "PO#", "Total", "Paid", "Owed", "Status", ""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 6px", color: C.muted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.invoices.map(inv => {
                const owed = (inv.total || 0) - (inv.amount_paid || 0);
                const overdue = inv.due_date && inv.due_date < new Date().toISOString().split("T")[0] && inv.status === "open";
                return (
                  <tr key={inv.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "4px 6px", color: C.accent, fontWeight: 600 }}>{inv.invoice_number || "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{inv.invoice_date}</td>
                    <td style={{ padding: "4px 6px", color: overdue ? C.red : C.text, fontWeight: overdue ? 700 : 400 }}>{inv.due_date || "—"}</td>
                    <td style={{ padding: "4px 6px", color: C.muted }}>{inv.po_number || "—"}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 600 }} title="Includes GST">{fmtMoney(inv.total)}</td>
                    <td style={{ padding: "4px 6px", color: C.green }} title="Includes GST">{fmtMoney(inv.amount_paid)}</td>
                    <td style={{ padding: "4px 6px", color: owed > 0 && inv.status !== "void" ? C.red : C.muted }} title="Includes GST">
                      {inv.status === "void" ? "—" : fmtMoney(owed)}
                    </td>
                    <td style={{ padding: "4px 6px" }}>{statusBadge(inv.status)}</td>
                    <td style={{ padding: "4px 6px" }}>
                      <button onClick={() => openDetail(inv)} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 11 }}>View</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </Card>
  );

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Billing</h2>

      <RentalSchedulerControls customers={customers} showToast={showToast || (() => {})} onComplete={load} />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={labelStyle}>From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <div style={{ display: "flex", gap: 4 }}>
              {[
                { id: "all", label: "All", color: C.muted },
                { id: "open", label: "Open", color: C.accent },
                { id: "paid", label: "Paid", color: C.green },
                { id: "void", label: "Void", color: C.muted },
              ].map(chip => {
                const active = statusFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    onClick={() => setStatusFilter(chip.id)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: `1px solid ${active ? chip.color : C.border}`,
                      background: active ? `${chip.color}22` : C.card,
                      color: active ? chip.color : C.muted,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>
          <button onClick={load} style={btnStyle(C.blue)}>{loading ? "Loading..." : "Refresh"}</button>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
          Reads directly from the invoices table — includes order invoices and auto-generated rental cycle invoices.
        </div>
      </Card>

      {/* Grand totals (inc GST) */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <StatCard label="Total Billed (inc GST)" value={fmtMoney(grandTotals.total)} color={C.text} />
        <StatCard label="Total Paid (inc GST)" value={fmtMoney(grandTotals.paid)} color={C.green} />
        <StatCard label="Total Outstanding (inc GST)" value={fmtMoney(grandTotals.owed)} color={C.red} />
      </div>

      {grouped.length === 0 && !loading && (
        <Card><div style={{ textAlign: "center", padding: 32, color: C.muted }}>No invoices in this period</div></Card>
      )}

      {renderGroupSection("Account Customers", accountGroups, C.blue)}
      {renderGroupSection("Other Customers", otherGroups, C.muted)}

      {/* Detail modal */}
      {selectedInvoice && (
        <div onClick={() => { setSelectedInvoice(null); setDetailData(null); }} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: 24, maxWidth: 640, width: "100%", maxHeight: "90vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Invoice</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.accent }}>{selectedInvoice.invoice_number}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {emailEnabled && (() => {
                  const cust = customerMap[selectedInvoice.customer_id];
                  const recipient = (cust?.accounts_email || cust?.email || "").trim();
                  if (!recipient) {
                    return <span style={{ fontSize: 11, color: C.muted, fontStyle: "italic" }}>No email on customer</span>;
                  }
                  return (
                    <button
                      onClick={async () => {
                        if (!confirm(`Send invoice ${selectedInvoice.invoice_number} to ${recipient}${emailConfig?.test_mode ? "\n\nTEST MODE: emails go to Resend sandbox, not the customer." : ""}?`)) return;
                        try {
                          const r = await api.sendInvoiceEmail(selectedInvoice.id);
                          showToast(`Sent to ${r.recipient}${emailConfig?.test_mode ? " (TEST)" : ""}`);
                        } catch (e) { showToast(e.message, "error"); }
                      }}
                      style={{ ...btnStyle(C.green), padding: "6px 12px", fontSize: 12 }}
                    >
                      Send Email
                    </button>
                  );
                })()}
                <button
                  onClick={() => window.open(`/api/invoices/${selectedInvoice.id}/print`, "_blank")}
                  style={{ ...btnStyle("#6b7280"), padding: "6px 12px", fontSize: 12 }}
                >
                  Print / PDF
                </button>
                <button onClick={() => { setSelectedInvoice(null); setDetailData(null); }} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 20 }}>✕</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Customer</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{formatCustomerDisplay(customerMap[selectedInvoice.customer_id]) || selectedInvoice.customer_name || selectedInvoice.address || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Invoice Date</div>
                <div style={{ fontSize: 13 }}>{selectedInvoice.invoice_date}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Due Date</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: selectedInvoice.due_date && selectedInvoice.due_date < new Date().toISOString().split("T")[0] && selectedInvoice.status === "open" ? C.red : C.text }}>
                  {selectedInvoice.due_date || "—"}
                  {selectedInvoice.due_date && selectedInvoice.due_date < new Date().toISOString().split("T")[0] && selectedInvoice.status === "open" && (
                    <span style={{ marginLeft: 6, fontSize: 10, background: C.red, color: "#fff", borderRadius: 3, padding: "1px 5px" }}>OVERDUE</span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Status</div>
                <div>{statusBadge(selectedInvoice.status)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Subtotal (net)</div>
                <div style={{ fontSize: 13, color: C.text }}>{fmtCurrency(selectedInvoice.total)}</div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>+ GST {fmtCurrency(Math.round((selectedInvoice.total || 0) * 0.10 * 100) / 100)}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginTop: 4 }}>{fmtMoney(selectedInvoice.total)} <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>inc GST</span></div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Paid (inc GST)</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{fmtMoney(selectedInvoice.amount_paid)}</div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Outstanding (inc GST)</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: ((selectedInvoice.total || 0) - (selectedInvoice.amount_paid || 0)) > 0 ? C.red : C.muted }}>
                  {fmtMoney((selectedInvoice.total || 0) - (selectedInvoice.amount_paid || 0))}
                </div>
              </div>
            </div>

            {/* Linked Orders — one section per order with its own line items */}
            {detailData?.orderSections?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Linked Orders</div>
                {detailData.orderSections.map((section, si) => (
                  <div key={section.order?.id || si} style={{ marginBottom: 12, background: C.panel, borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                    <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: C.accent }}>{section.order?.order_number || "—"}</span>
                      <span style={{ fontSize: 12, color: C.muted }}>{section.order?.order_date || ""}</span>
                      {section.order?.order_detail && (
                        <span style={{ fontSize: 12, color: C.text }}>{section.order.order_detail}</span>
                      )}
                      {section.order?.po_number && (
                        <span style={{ fontSize: 12, color: C.muted }}>PO: {section.order.po_number}</span>
                      )}
                    </div>
                    {section.lines?.length > 0 ? (
                      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                            <th style={{ textAlign: "left", padding: "5px 10px", color: C.muted, fontWeight: 600 }}>Item</th>
                            <th style={{ textAlign: "right", padding: "5px 10px", color: C.muted, fontWeight: 600 }}>Qty</th>
                            <th style={{ textAlign: "right", padding: "5px 10px", color: C.muted, fontWeight: 600 }}>Unit Price</th>
                            <th style={{ textAlign: "right", padding: "5px 10px", color: C.muted, fontWeight: 600 }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.lines.map((l, i) => (
                            <tr key={l.id || i} style={{ borderBottom: `1px solid ${C.border}` }}>
                              <td style={{ padding: "5px 10px", fontWeight: 600 }}>{l.cylinder_label || "—"}</td>
                              <td style={{ padding: "5px 10px", textAlign: "right" }}>{l.qty}</td>
                              <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmtCurrency(l.unit_price)}</td>
                              <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 600 }}>{fmtCurrency(l.line_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ padding: "8px 12px", fontSize: 12, color: C.muted }}>No line items</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Rental Charges section */}
            {detailData?.rentalLines?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Rental Charges</div>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", background: C.panel, borderRadius: 8, border: `1px solid ${C.border}` }}>
                  <thead>
                    <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                      <th style={{ textAlign: "left", padding: "5px 10px", color: C.muted, fontWeight: 600 }}>Cylinder</th>
                      <th style={{ textAlign: "right", padding: "5px 10px", color: C.muted, fontWeight: 600 }}>Qty on Hand</th>
                      <th style={{ textAlign: "right", padding: "5px 10px", color: C.muted, fontWeight: 600 }}>Rate</th>
                      <th style={{ textAlign: "right", padding: "5px 10px", color: C.muted, fontWeight: 600 }}>Charge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailData.rentalLines.map((l, i) => (
                      <tr key={l.id || i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "5px 10px", fontWeight: 600 }}>{l.cylinder_label || l.notes || "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right" }}>{l.qty != null ? l.qty : "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right" }}>{l.unit_price != null ? fmtCurrency(l.unit_price) : "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 600 }}>{fmtCurrency(l.line_total != null ? l.line_total : l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Fallback: flat line items for older invoices without orderSections */}
            {!detailData?.orderSections?.length && !detailData?.rentalLines?.length && detailData?.lines?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Line Items</div>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", border: `1px solid ${C.border}`, borderRadius: 6 }}>
                  <thead>
                    <tr style={{ background: C.panel, borderBottom: `1px solid ${C.border}` }}>
                      <th style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>Item</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>Qty</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>Unit Price</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailData.lines.map((l, i) => (
                      <tr key={l.id || i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "6px 8px", fontWeight: 600 }}>{l.cylinder_label || "—"}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{l.qty}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtCurrency(l.unit_price)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmtCurrency(l.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Payments</div>
              {detailData?.payments?.length > 0 ? (
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {["Date", "Method", "Reference", "Amount"].map(h => <th key={h} style={{ textAlign: "left", padding: "4px 6px", color: C.muted }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {detailData.payments.map(p => (
                      <tr key={p.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "4px 6px" }}>{p.date}</td>
                        <td style={{ padding: "4px 6px" }}>{p.method || "—"}</td>
                        <td style={{ padding: "4px 6px", color: C.muted }}>{p.reference || "—"}</td>
                        <td style={{ padding: "4px 6px", fontWeight: 600, color: C.green }}>{fmtCurrency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 12, color: C.muted, fontSize: 12, background: C.input, borderRadius: 6 }}>
                  {detailData ? "No payments recorded" : "Loading..."}
                </div>
              )}

              {/* Round 3: Record Payment form (issue 4) */}
              {selectedInvoice.status !== "void" && (
                <div style={{ marginTop: 12 }}>
                  {!showPaymentForm ? (
                    <button
                      onClick={() => {
                        const owed = Math.max(0, (selectedInvoice.total || 0) - (selectedInvoice.amount_paid || 0));
                        setPaymentForm(f => ({ ...f, amount: owed > 0 ? owed.toFixed(2) : "" }));
                        setShowPaymentForm(true);
                      }}
                      style={{ ...btnStyle(C.green), padding: "8px 16px", fontSize: 13 }}
                    >
                      + Record Payment
                    </button>
                  ) : (
                    <div style={{ padding: 12, background: C.input, borderRadius: 6, border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>New Payment</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                        <div>
                          <label style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>Amount *</label>
                          <input
                            type="number" step="0.01" min="0"
                            value={paymentForm.amount}
                            onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                            style={{ width: "100%", padding: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>Date</label>
                          <input
                            type="date"
                            value={paymentForm.date}
                            onChange={e => setPaymentForm(f => ({ ...f, date: e.target.value }))}
                            style={{ width: "100%", padding: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>Method</label>
                          <select
                            value={paymentForm.method}
                            onChange={e => setPaymentForm(f => ({ ...f, method: e.target.value }))}
                            style={{ width: "100%", padding: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }}
                          >
                            <option value="manual">Manual</option>
                            <option value="cash">Cash</option>
                            <option value="eft">EFT / Bank Transfer</option>
                            <option value="credit_card">Credit Card</option>
                            <option value="cheque">Cheque</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>Reference</label>
                          <input
                            type="text"
                            value={paymentForm.reference}
                            onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))}
                            placeholder="optional"
                            style={{ width: "100%", padding: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13 }}
                          />
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>Notes</label>
                        <input
                          type="text"
                          value={paymentForm.notes}
                          onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))}
                          placeholder="optional"
                          style={{ width: "100%", padding: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, marginBottom: 8 }}
                        />
                      </div>
                      {selectedInvoice.status === "pending" && (
                        <div style={{ fontSize: 11, color: "#a855f7", marginBottom: 8, padding: 6, background: "#a855f722", borderRadius: 4 }}>
                          ℹ This invoice is pending (order not yet delivered). Payment will be held as a prepayment and the order will dispatch once paid in full.
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={recordPayment} style={{ ...btnStyle(C.green), padding: "6px 14px", fontSize: 12 }}>Save Payment</button>
                        <button onClick={() => setShowPaymentForm(false)} style={{ ...btnStyle(C.muted), padding: "6px 14px", fontSize: 12 }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== RENTAL INVOICES VIEW ====================
function RentalHistoryView({ customers, cylinderTypes, showToast, emailEnabled, emailConfig }) {
  const GST_RATE = 0.10;
  const [tab, setTab] = useState("history"); // history | generate
  // Invoice detail modal (reuse the same pattern as InvoicesView)
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const openInvoiceDetail = async (inv) => {
    setSelectedInvoice(inv);
    setDetailData(null);
    try { const d = await api.getInvoice(inv.invoice_id || inv.id); setDetailData(d); } catch (e) { /* tolerate */ }
  };

  // 3.0.18: fallback customer fetch when parent prop is empty (same pattern as TrackingView)
  // and customer search filter for the history tab.
  const localCustomers = useApi(() => api.getCustomers());
  const effectiveCustomers = (customers && customers.length > 0) ? customers : (localCustomers.data || []);
  const [custFilter, setCustFilter] = useState("");

  // Lookup maps
  const customerMap = useMemo(() => {
    const m = {};
    for (const c of effectiveCustomers) m[c.id] = c;
    return m;
  }, [effectiveCustomers]);
  const ctMap = useMemo(() => {
    const m = {};
    for (const ct of (cylinderTypes || [])) m[ct.id] = ct;
    return m;
  }, [cylinderTypes]);

  // ====== HISTORY TAB ======
  const today = new Date().toISOString().split("T")[0];
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
  const [histFrom, setHistFrom] = useState(ninetyDaysAgo);
  const [histTo, setHistTo] = useState(today);
  const [historyRows, setHistoryRows] = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  const loadHistory = async () => {
    setHistLoading(true);
    try {
      const rows = await api.getTransactions({ type: "rental_invoice", from: histFrom, to: histTo });
      setHistoryRows(rows || []);
    } catch (e) { showToast(e.message, "error"); }
    finally { setHistLoading(false); }
  };
  useEffect(() => { if (tab === "history") loadHistory(); /* eslint-disable-next-line */ }, [tab, histFrom, histTo]);

  // Group history by customer; account customers first. Prefer enriched customer_name
  // from the /transactions API response (present after 3.0.18 backend patch), fall back
  // to the local customer map lookup, then "(unknown)".
  const historyByCustomer = useMemo(() => {
    const m = {};
    for (const r of historyRows) {
      const cust = customerMap[r.customer_id];
      const key = r.customer_id;
      if (!m[key]) m[key] = {
        customer_id: key,
        customer_name: formatCustomerDisplay(cust) || r.customer_name || "(unknown)",
        account_number: cust?.account_number || "",
        account_customer: !!cust?.account_customer,
        category: cust?.customer_category || "",
        address: cust?.address || r.customer_address || "",
        rows: [],
        total_qty: 0,
      };
      m[key].rows.push(r);
      m[key].total_qty += r.qty || 0;
    }
    const arr = Object.values(m);
    arr.sort((a, b) => {
      // Account customers first
      if (a.account_customer !== b.account_customer) return b.account_customer - a.account_customer;
      return (a.customer_name || "").localeCompare(b.customer_name || "");
    });
    // 3.0.18: apply customer filter (search by name, account #, address)
    const q = custFilter.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter(g => (
      (g.customer_name || "").toLowerCase().includes(q) ||
      (g.account_number || "").toLowerCase().includes(q) ||
      (g.address || "").toLowerCase().includes(q)
    ));
  }, [historyRows, customerMap, custFilter]);

  const accountGroups = historyByCustomer.filter(g => g.account_customer);
  const otherGroups  = historyByCustomer.filter(g => !g.account_customer);

  // ====== GENERATE TAB (legacy manual flow) ======
  const [asAtDate, setAsAtDate] = useState(today);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [invoices, setInvoices] = useState(null);

  const loadGenData = async () => {
    setLoading(true);
    try {
      const rows = await api.getOnHandAsAt(asAtDate);
      setData(rows);
      setSelected([]);
      setInvoices(null);
    } catch(e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (tab === "generate") loadGenData(); /* eslint-disable-next-line */ }, [tab, asAtDate]);

  const byCustomer = useMemo(() => {
    const m = {};
    for (const r of data) {
      if (!m[r.customer_id]) m[r.customer_id] = { customer_id: r.customer_id, customer_name: formatCustomerDisplay(customerMap[r.customer_id]) || r.customer_name, customer_address: r.customer_address, account_customer: r.account_customer, lines: [], subtotal: 0 };
      m[r.customer_id].lines.push(r);
      m[r.customer_id].subtotal += r.line_total;
    }
    for (const k of Object.keys(m)) {
      m[k].subtotal = Math.round(m[k].subtotal * 100) / 100;
      m[k].gst = Math.round(m[k].subtotal * GST_RATE * 100) / 100;
      m[k].total = Math.round((m[k].subtotal + m[k].gst) * 100) / 100;
    }
    // Account customers first, then alphabetical
    return Object.values(m).sort((a, b) => {
      if (a.account_customer !== b.account_customer) return b.account_customer - a.account_customer;
      return (a.customer_name || "").localeCompare(b.customer_name || "");
    });
  }, [data]);

  const toggleSelect = (custId) => {
    setSelected(s => s.includes(custId) ? s.filter(x => x !== custId) : [...s, custId]);
  };
  const selectAll = () => {
    if (selected.length === byCustomer.length) setSelected([]);
    else setSelected(byCustomer.map(c => c.customer_id));
  };

  const generateInvoices = async () => {
    try {
      const r = await api.generateRentalInvoices(asAtDate, selected);
      const skippedCount = (r.skipped || []).length;
      let msg = `${r.invoicesGenerated} invoices generated, ${r.transactionsCreated} transactions created`;
      if (skippedCount > 0) msg += ` · ${skippedCount} skipped (already billed for ${asAtDate})`;
      showToast(msg, skippedCount > 0 ? "warning" : "success");
      if (skippedCount > 0 && r.invoicesGenerated === 0) {
        // Nothing was generated — show details so the user knows why
        const lookup = {};
        for (const c of (customers || [])) lookup[c.id] = c;
        const detail = (r.skipped || []).slice(0, 5).map(s => `· ${formatCustomerDisplay(lookup[s.customer_id]) || s.customer_id}: ${s.reason}`).join("\n");
        alert(`No invoices generated.\n\n${detail}${r.skipped.length > 5 ? `\n…and ${r.skipped.length - 5} more` : ""}`);
        return;
      }
      const inv = r.invoices.map(i => {
        const cust = byCustomer.find(c => c.customer_id === i.customer_id);
        const subtotal = i.total;
        const gst = Math.round(subtotal * GST_RATE * 100) / 100;
        const grandTotal = Math.round((subtotal + gst) * 100) / 100;
        return { ...i, customer_name: cust?.customer_name || formatCustomerDisplay(customerMap[i.customer_id]) || "Unknown", customer_address: cust?.customer_address || "", subtotal, gst, grandTotal };
      });
      setInvoices(inv);
    } catch(e) { showToast(e.message, "error"); }
  };

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{
      padding: "8px 16px", borderRadius: 6, border: `1px solid ${tab === id ? C.accent : C.border}`,
      background: tab === id ? "#f59e0b22" : C.card, color: tab === id ? C.accent : C.muted,
      cursor: "pointer", fontSize: 13, fontWeight: 600,
    }}>{label}</button>
  );

  const renderGroupSection = (title, groups, badgeColor) => groups.length > 0 && (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${badgeColor}22`, color: badgeColor }}>{title.toUpperCase()}</span>
        <span style={{ color: C.muted, fontSize: 12 }}>({groups.length} customer{groups.length === 1 ? "" : "s"})</span>
      </div>
      {groups.map(g => (
        <div key={g.customer_id} style={{ marginBottom: 16, padding: 12, background: C.input, borderRadius: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>
              {g.account_number && <span style={{ color: C.accent, marginRight: 8 }}>{g.account_number}</span>}
              {g.customer_name}
              {g.category && <span style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: C.panel, color: C.muted }}>{g.category}</span>}
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>{g.rows.length} entries · {g.total_qty} cylinders billed</div>
          </div>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Date", "Cylinder", "Qty on Hand", "Invoice", "Due Date", "Source", "Invoice"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 6px", color: C.muted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.rows.map(r => {
                const today = new Date().toISOString().split("T")[0];
                const overdue = r.invoice_due_date && r.invoice_due_date < today && r.invoice_status === "open";
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "4px 6px" }}>{r.date}</td>
                    <td style={{ padding: "4px 6px" }}>{ctMap[r.cylinder_type]?.label || r.cylinder_type}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{r.qty}</td>
                    <td style={{ padding: "4px 6px", color: C.accent, fontWeight: 600 }}>{r.invoice_number || <span style={{ color: C.muted }}>—</span>}</td>
                    <td style={{ padding: "4px 6px", color: overdue ? C.red : C.text, fontWeight: overdue ? 700 : 400 }}>
                      {r.invoice_due_date || <span style={{ color: C.muted }}>—</span>}
                      {overdue && <span style={{ marginLeft: 4, fontSize: 9, background: C.red, color: "#fff", borderRadius: 3, padding: "1px 4px" }}>OVERDUE</span>}
                    </td>
                    <td style={{ padding: "4px 6px", color: C.muted }}>
                      {r.source === "auto_rental" ? "Auto (scheduler)" : r.source === "order_linked_rental" ? "Order linked" : r.source === "rental_invoice" ? "Manual" : r.source}
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      {r.invoice_id ? (
                        <button
                          onClick={() => openInvoiceDetail(r)}
                          style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}
                        >
                          View
                        </button>
                      ) : <span style={{ color: C.muted }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </Card>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Rental History</h2>
      </div>

      <RentalSchedulerControls customers={customers} showToast={showToast} onComplete={() => { loadHistory(); loadGenData(); }} />

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {tabBtn("history", "History")}
        {tabBtn("generate", "Generate Now (manual)")}
      </div>

      {tab === "history" && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label style={labelStyle}>From</label>
                <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>To</label>
                <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)} style={inputStyle} />
              </div>
              <button onClick={loadHistory} style={btnStyle(C.blue)}>{histLoading ? "Loading..." : "Refresh"}</button>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={labelStyle}>Search customer</label>
                <input
                  placeholder="Name, account # or address"
                  value={custFilter}
                  onChange={e => setCustFilter(e.target.value)}
                  style={{ ...inputStyle, width: "100%" }}
                />
              </div>
              <div style={{ fontSize: 11, color: C.muted, alignSelf: "center" }}>
                Read-only audit of past rental_invoice transactions. The scheduler runs every 6 hours and auto-bills due rentals.
              </div>
            </div>
          </Card>

          {historyByCustomer.length === 0 && !histLoading && (
            <Card><div style={{ textAlign: "center", padding: 32, color: C.muted }}>No rental invoices in this date range</div></Card>
          )}

          {renderGroupSection("Account Customers", accountGroups, C.blue)}
          {renderGroupSection("Other Customers", otherGroups, C.muted)}
        </>
      )}

      {tab === "generate" && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label style={labelStyle}>On-Hand As At Date</label>
                <input type="date" value={asAtDate} onChange={e => setAsAtDate(e.target.value)} style={inputStyle} />
              </div>
              <button onClick={loadGenData} style={btnStyle(C.blue)}>{loading ? "Loading..." : "Refresh"}</button>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
              Manual catch-up billing. Normally the scheduler handles this every 6 hours — only use this for one-off backfills or testing.
            </div>
          </Card>

          {!invoices && byCustomer.length > 0 && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 700 }}>Customers with On-Hand Cylinders ({byCustomer.length})</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={selectAll} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12 }}>
                    {selected.length === byCustomer.length ? "Deselect All" : "Select All"}
                  </button>
                  <span style={{ fontSize: 12, color: C.muted }}>{selected.length} selected</span>
                  <button onClick={generateInvoices} disabled={selected.length === 0} style={btnStyle(C.green)}>Generate Invoices</button>
                </div>
              </div>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: "6px 8px", width: 30 }}></th>
                    {["Customer", "Address", "Items", "Subtotal", "GST", "Total"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byCustomer.map(c => (
                    <tr key={c.customer_id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px 8px" }}>
                        <input type="checkbox" checked={selected.includes(c.customer_id)} onChange={() => toggleSelect(c.customer_id)} />
                      </td>
                      <td style={{ padding: "6px 8px", fontWeight: 600 }}>
                        {c.customer_name}
                        {c.account_customer ? <span style={{ padding: "2px 5px", borderRadius: 4, fontSize: 9, fontWeight: 600, background: "#3b82f622", color: C.blue, marginLeft: 6 }}>ACC</span> : null}
                      </td>
                      <td style={{ padding: "6px 8px", color: C.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.customer_address}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {c.lines.map(l => `${l.on_hand}×${l.cylinder_label}`).join(", ")}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{fmtCurrency(c.subtotal)}</td>
                      <td style={{ padding: "6px 8px", color: C.muted }}>{fmtCurrency(c.gst)}</td>
                      <td style={{ padding: "6px 8px", fontWeight: 700, color: C.green }}>{fmtCurrency(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {byCustomer.length === 0 && !loading && (
            <Card><div style={{ textAlign: "center", padding: 32, color: C.muted }}>No on-hand cylinders as at {asAtDate}</div></Card>
          )}

          {invoices && (
            <div>
              <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Generated Invoices ({invoices.length})</h3>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={async () => {
                    // Backend path: server sends with PDF attachments via Resend
                    if (emailEnabled) {
                      const ids = invoices.map(i => i.id || i.invoice_id).filter(Boolean);
                      if (ids.length === 0) {
                        showToast("No invoice IDs available — re-generate first", "error");
                        return;
                      }
                      const proceed = confirm(`Send ${ids.length} invoice${ids.length === 1 ? "" : "s"} via server email${emailConfig?.test_mode ? " (TEST MODE — emails go to Resend sandbox, not customers)" : ""}?`);
                      if (!proceed) return;
                      try {
                        const r = await api.sendInvoiceEmailBulk(ids);
                        showToast(`${r.sent} sent, ${r.skipped} skipped (no email), ${r.errors} errors`);
                      } catch (e) { showToast(e.message, "error"); }
                      return;
                    }
                    // Mailto fallback — opens mail client one at a time
                    const missing = [];
                    const ready = [];
                    for (const inv of invoices) {
                      const cust = customerMap[inv.customer_id];
                      const to = resolveInvoiceEmail(cust);
                      if (!to) missing.push(inv.customer_name || "(unknown)");
                      else ready.push({ inv, to });
                    }
                    if (ready.length === 0) {
                      showToast("No customers with email addresses found", "error");
                      return;
                    }
                    const proceed = confirm(
                      `Email ${ready.length} invoice${ready.length === 1 ? "" : "s"}?\n` +
                      (missing.length > 0 ? `\n${missing.length} customer(s) skipped (no email on file): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}\n` : "") +
                      `\nYour email client will open ${ready.length} time${ready.length === 1 ? "" : "s"}, one per invoice.`
                    );
                    if (!proceed) return;
                    let i = 0;
                    const next = () => {
                      if (i >= ready.length) {
                        showToast(`Opened ${ready.length} email draft${ready.length === 1 ? "" : "s"}${missing.length > 0 ? `, ${missing.length} skipped` : ""}`);
                        return;
                      }
                      const { inv, to } = ready[i];
                      const { subject, body } = buildInvoiceEmailBody(inv, asAtDate);
                      openMailto(to, subject, body);
                      i++;
                      setTimeout(next, 800);
                    };
                    next();
                  }} style={btnStyle(C.green)}>{emailEnabled ? "Email All (Server)" : "Email All (Mailto)"}</button>
                  <button onClick={() => window.print()} style={btnStyle(C.blue)}>Print All</button>
                  <button onClick={() => setInvoices(null)} style={btnStyle(C.muted)}>Back to Selection</button>
                </div>
              </div>
              <style>{`
                @media print {
                  .no-print, nav, header, [data-no-print] { display: none !important; }
                  body { background: white !important; color: black !important; }
                  .invoice-page { background: white !important; color: black !important; border: none !important; box-shadow: none !important; page-break-after: always; padding: 40px !important; }
                  .invoice-page table { color: black !important; }
                  .invoice-page th, .invoice-page td { color: black !important; border-color: #ddd !important; }
                }
              `}</style>
              {invoices.map(inv => {
                const cust = customerMap[inv.customer_id];
                const emailTo = resolveInvoiceEmail(cust);
                return (
                <div key={inv.customer_id} className="invoice-page" style={{ background: "#fff", color: "#111", borderRadius: 8, padding: 32, marginBottom: 24, pageBreakAfter: "always" }}>
                  <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                    {emailTo ? (
                      <button onClick={async () => {
                        if (emailEnabled) {
                          const invoiceId = inv.id || inv.invoice_id;
                          if (!invoiceId) { showToast("No invoice ID available", "error"); return; }
                          try {
                            const r = await api.sendInvoiceEmail(invoiceId);
                            showToast(`Sent to ${r.recipient}${emailConfig?.test_mode ? " (TEST MODE)" : ""}`);
                          } catch (e) { showToast(e.message, "error"); }
                          return;
                        }
                        const { subject, body } = buildInvoiceEmailBody(inv, asAtDate);
                        openMailto(emailTo, subject, body);
                      }} style={{ ...btnStyle(C.green), padding: "4px 12px", fontSize: 11 }}>
                        {emailEnabled ? "Send Email" : "Email"} → {emailTo}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: "#999", fontStyle: "italic" }}>No email on customer record</span>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 32 }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 24, color: "#111" }}>RENTAL INVOICE</div>
                      <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Invoice Date: {asAtDate}</div>
                      <div style={{ fontSize: 13, color: "#666" }}>Billing Period: As at {asAtDate}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 18, color: "#111" }}>{inv.customer_name}</div>
                      <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{inv.customer_address}</div>
                    </div>
                  </div>
                  <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse", marginBottom: 24 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #333" }}>
                        {["Description", "Qty", "Unit Price (ex GST)", "Amount"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "10px 8px", color: "#555", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inv.lines.map((l, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                          <td style={{ padding: "10px 8px", fontWeight: 500 }}>{l.cylinder_label} — Cylinder Rental</td>
                          <td style={{ padding: "10px 8px" }}>{l.on_hand}</td>
                          <td style={{ padding: "10px 8px" }}>{fmtCurrency(l.unit_price)}</td>
                          <td style={{ padding: "10px 8px", fontWeight: 600 }}>{fmtCurrency(l.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div style={{ width: 280 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #ddd" }}>
                        <span style={{ color: "#555" }}>Subtotal</span>
                        <span style={{ fontWeight: 600 }}>{fmtCurrency(inv.subtotal)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #ddd" }}>
                        <span style={{ color: "#555" }}>GST (10%)</span>
                        <span style={{ fontWeight: 600 }}>{fmtCurrency(inv.gst)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderTop: "2px solid #333", marginTop: 4 }}>
                        <span style={{ fontWeight: 800, fontSize: 16 }}>TOTAL (incl. GST)</span>
                        <span style={{ fontWeight: 800, fontSize: 18 }}>{fmtCurrency(inv.grandTotal)}</span>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Invoice detail modal — triggered from rental history "View" button */}
      {selectedInvoice && (
        <div onClick={() => { setSelectedInvoice(null); setDetailData(null); }} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: 24, maxWidth: 640, width: "100%", maxHeight: "90vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Invoice</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.accent }}>{detailData?.invoice_number || selectedInvoice.invoice_number || "…"}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {detailData && (
                  <button onClick={() => window.open(`/api/invoices/${detailData.id}/print`, "_blank")} style={{ ...btnStyle("#6b7280"), padding: "6px 12px", fontSize: 12 }}>Print / PDF</button>
                )}
                <button onClick={() => { setSelectedInvoice(null); setDetailData(null); }} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 20 }}>✕</button>
              </div>
            </div>
            {!detailData ? (
              <div style={{ padding: 32, textAlign: "center", color: C.muted }}>Loading…</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <div><div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Invoice Date</div><div style={{ fontSize: 13 }}>{detailData.invoice_date}</div></div>
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Due Date</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: detailData.due_date && detailData.due_date < new Date().toISOString().split("T")[0] && detailData.status === "open" ? C.red : C.text }}>
                      {detailData.due_date || "—"}
                    </div>
                  </div>
                  <div><div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Status</div>
                    <div style={{ marginTop: 2 }}>
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: detailData.status === "paid" ? "#22c55e22" : "#f59e0b22", color: detailData.status === "paid" ? C.green : C.accent }}>{(detailData.status || "open").toUpperCase()}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Total (inc GST)</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtMoney(detailData.total)}</div>
                    <div style={{ fontSize: 11, color: (detailData.total || 0) - (detailData.amount_paid || 0) > 0 ? C.red : C.green }}>
                      Balance: {fmtMoney((detailData.total || 0) - (detailData.amount_paid || 0))}
                    </div>
                  </div>
                </div>

                {/* Linked Orders */}
                {detailData.orderSections?.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Linked Orders</div>
                    {detailData.orderSections.map((s, i) => (
                      <div key={i} style={{ marginBottom: 8, background: C.panel, borderRadius: 6, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                        <div style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, color: C.accent }}>{s.order?.order_number}</span>
                          <span style={{ color: C.muted }}>{s.order?.order_date}</span>
                          {s.order?.po_number && <span style={{ color: C.muted }}>PO: {s.order.po_number}</span>}
                        </div>
                        {s.lines?.map((l, j) => (
                          <div key={j} style={{ padding: "4px 10px", fontSize: 11, display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${C.border}` }}>
                            <span>{l.cylinder_label} × {l.qty}</span>
                            <span style={{ fontWeight: 600 }}>{fmtCurrency(l.line_total)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* Rental lines */}
                {detailData.rentalLines?.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Rental Charges</div>
                    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", background: C.panel, borderRadius: 6, border: `1px solid ${C.border}` }}>
                      <thead><tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                        <th style={{ padding: "4px 8px", textAlign: "left", color: C.muted, fontWeight: 600 }}>Cylinder</th>
                        <th style={{ padding: "4px 8px", textAlign: "right", color: C.muted, fontWeight: 600 }}>Qty</th>
                        <th style={{ padding: "4px 8px", textAlign: "right", color: C.muted, fontWeight: 600 }}>Rate</th>
                        <th style={{ padding: "4px 8px", textAlign: "right", color: C.muted, fontWeight: 600 }}>Charge</th>
                      </tr></thead>
                      <tbody>
                        {detailData.rentalLines.map((l, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                            <td style={{ padding: "4px 8px" }}>{l.cylinder_label}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right" }}>{l.qty}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmtCurrency(l.unit_price)}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600 }}>{fmtCurrency(l.line_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Payments */}
                {detailData.payments?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Payments</div>
                    {detailData.payments.map(p => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ color: C.muted }}>{p.date} · {p.method}</span>
                        <span style={{ color: C.green, fontWeight: 600 }}>{fmtCurrency(grossOf(p.amount))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== MANUAL COMPLETION PANEL (3.0.10 — Optimo failsafe) ====================
// Per-line Del/Ret/Roth buttons for when the driver forgot to mark POD on the mobile app
// or OptimoRoute is unavailable. Renders inline in the order edit form when the order is
// in awaiting_dispatch or dispatched status.
// ==================== MANUAL COMPLETION PANEL (3.0.10 — Optimo failsafe, redesigned 3.0.12) ====================
// Grid layout: each sale line gets one row with three qty inputs (Del/Ret/Roth) plus an
// Owner field that's only enabled when Roth has a value. A single Save All button at the
// bottom commits every pending row in one atomic backend call.
//
// 3.0.12: only sale-type lines appear here. Cylinder rental lines are handled by the
// existing rental flow elsewhere — they don't need driver POD because they're not
// dispatched the same way.
function ManualCompletionPanel({ orderId, orderNumber, lines, showToast, onCompleted }) {
  // Filter to sale-type lines only. Cylinder lines never appear in the failsafe panel.
  const saleLines = (lines || []).filter(l => l.item_type === "sale");

  // Per-line input state: { [lineId]: { del, ret, roth, owner } }
  // del/ret/roth are qty strings; owner is the foreign company name for Roth.
  const [grid, setGrid] = useState({});
  const [busy, setBusy] = useState(false);
  const [batchNotes, setBatchNotes] = useState("");

  const cellState = (lineId) => grid[lineId] || { del: "", ret: "", roth: "", owner: "" };
  const setCell = (lineId, patch) => {
    setGrid(g => ({ ...g, [lineId]: { ...cellState(lineId), ...patch } }));
  };

  // 3.0.12 BUG FIX: useMemo MUST be called on every render (Rules of Hooks).
  // Previously the saleLines.length === 0 early return came before this, which
  // caused React to throw on cylinder-only orders and the entire panel to silently
  // break. Now both useMemo calls run unconditionally and the empty-state guard
  // is the LAST thing that happens before render.

  // Build the list of pending completions. 3.0.16: each row can produce MULTIPLE
  // completion entries — e.g. Del 4 + Ret 1 on the same line means a swap-out delivery
  // (4 cylinders went out, 1 came back). Each non-zero column on a row generates one
  // completion entry. The backend creates one transaction per entry and the line's
  // final status is determined by the order of preference (Del > Ret > Roth) since the
  // line itself can only be in one terminal status.
  const pendingCompletions = useMemo(() => {
    const out = [];
    for (const ln of saleLines) {
      const isTerminal = ["delivered", "returned", "return_other", "cancelled"].includes(ln.status);
      if (isTerminal) continue;
      const c = cellState(ln.id);
      const delQty = parseFloat(c.del) || 0;
      const retQty = parseFloat(c.ret) || 0;
      const rothQty = parseFloat(c.roth) || 0;
      if (delQty > 0) {
        out.push({ line_id: ln.id, line_label: ln.cylinder_label, action: "delivered", qty: delQty });
      }
      if (retQty > 0) {
        out.push({ line_id: ln.id, line_label: ln.cylinder_label, action: "returned", qty: retQty });
      }
      if (rothQty > 0) {
        out.push({
          line_id: ln.id, line_label: ln.cylinder_label, action: "returned_other",
          qty: rothQty, foreign_owner: (c.owner || "").trim(),
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, saleLines]);

  // Validation: any Roth entry needs an owner. That's the only validation now —
  // multiple actions per line are allowed (Del+Ret is the normal swap-out case).
  const validationError = useMemo(() => {
    for (const p of pendingCompletions) {
      if (p.action === "returned_other" && !p.foreign_owner) {
        return `${p.line_label}: Owner is required when entering a Roth quantity`;
      }
    }
    return null;
  }, [pendingCompletions]);

  const submitAll = async () => {
    if (validationError) {
      showToast(validationError, "error");
      return;
    }
    if (pendingCompletions.length === 0) {
      showToast("Nothing to save — enter at least one quantity", "error");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        notes: batchNotes || "",
        completions: pendingCompletions.map(p => ({
          line_id: p.line_id,
          action: p.action,
          qty: p.qty,
          foreign_owner: p.foreign_owner || "",
        })),
      };
      const r = await api.manualCompletionBatch(orderId, payload);
      const summary = `${r.completed || pendingCompletions.length} line${(r.completed || pendingCompletions.length) === 1 ? "" : "s"} saved` +
        (r.order_transitioned ? ` — order now ${r.order_status}` : "");
      showToast(summary);
      // Clear the grid and refresh
      setGrid({});
      setBatchNotes("");
      if (onCompleted) onCompleted();
    } catch (e) {
      showToast(e.message || "Manual completion save failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const lineStatusBadge = (status) => {
    const map = {
      open:          { label: "OPEN",          bg: "#f59e0b22", fg: C.accent },
      delivered:     { label: "DELIVERED",     bg: "#06b6d422", fg: "#06b6d4" },
      returned:      { label: "RETURNED",      bg: "#3b82f622", fg: C.blue },
      return_other:  { label: "ROTH",          bg: "#a855f722", fg: "#a855f7" },
      cancelled:     { label: "CANCELLED",     bg: "#6b728022", fg: C.muted },
    };
    const m = map[status] || { label: (status || "—").toUpperCase(), bg: "#6b728022", fg: C.muted };
    return <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: m.bg, color: m.fg }}>{m.label}</span>;
  };

  // Tiny qty input — same style for all three columns
  const qtyInput = (lineId, field, isTerminal) => {
    const c = cellState(lineId);
    return (
      <input
        type="number"
        step="1"
        min="0"
        disabled={isTerminal || busy}
        value={c[field]}
        onChange={(e) => setCell(lineId, { [field]: e.target.value })}
        style={{
          width: 60, padding: "4px 6px", fontSize: 12, textAlign: "center",
          background: C.input, border: `1px solid ${C.inputBorder}`,
          borderRadius: 4, color: C.text,
          opacity: isTerminal ? 0.4 : 1,
        }}
      />
    );
  };

  return (
    <div style={{ marginBottom: 12, padding: 12, background: "#f59e0b08", border: `1px solid ${C.accent}33`, borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, marginBottom: 4 }}>
        ⚠ Manual Completion (Optimo failsafe)
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
        Use this if the driver forgot to mark POD on the mobile app, or if Optimo is unreachable.
        Enter a quantity in <strong style={{ color: "#06b6d4" }}>Del</strong> (delivered),{" "}
        <strong style={{ color: C.blue }}>Ret</strong> (returned to us), or{" "}
        <strong style={{ color: "#a855f7" }}>Roth</strong> (foreign cylinder picked up — fill the Owner field).
        One column per line. Click <strong>Save All</strong> when done.
      </div>

      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>Item</th>
            <th style={{ textAlign: "center", padding: "6px 8px", color: C.muted, fontWeight: 600, width: 70 }}>Qty</th>
            <th style={{ textAlign: "center", padding: "6px 8px", color: C.muted, fontWeight: 600, width: 70 }}>Status</th>
            <th style={{ textAlign: "center", padding: "6px 8px", color: "#06b6d4", fontWeight: 700, width: 80 }}>Del</th>
            <th style={{ textAlign: "center", padding: "6px 8px", color: C.blue, fontWeight: 700, width: 80 }}>Ret</th>
            <th style={{ textAlign: "center", padding: "6px 8px", color: "#a855f7", fontWeight: 700, width: 80 }}>Roth</th>
            <th style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>Owner (Roth)</th>
          </tr>
        </thead>
        <tbody>
          {saleLines.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: 16, textAlign: "center", color: C.muted, fontSize: 12 }}>
                This order has no sale-type items. Manual completion only applies to sale items
                (Cage, Regulator, Hose, etc.). Cylinder lines use the Deliver/Return screen instead.
              </td>
            </tr>
          )}
          {saleLines.map((ln) => {
            const isTerminal = ["delivered", "returned", "return_other", "cancelled"].includes(ln.status);
            const c = cellState(ln.id);
            const rothActive = parseFloat(c.roth) > 0;
            return (
              <tr key={ln.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: isTerminal ? 0.5 : 1 }}>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{ln.cylinder_label || ln.cylinder_type_id}</td>
                <td style={{ padding: "6px 8px", textAlign: "center", color: C.muted }}>{ln.qty}</td>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>{lineStatusBadge(ln.status)}</td>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>{qtyInput(ln.id, "del", isTerminal)}</td>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>{qtyInput(ln.id, "ret", isTerminal)}</td>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>{qtyInput(ln.id, "roth", isTerminal)}</td>
                <td style={{ padding: "6px 8px" }}>
                  <input
                    type="text"
                    placeholder={rothActive ? "Required (e.g. BOC)" : "—"}
                    disabled={isTerminal || !rothActive || busy}
                    value={c.owner}
                    onChange={(e) => setCell(ln.id, { owner: e.target.value })}
                    style={{
                      width: "100%", padding: "4px 8px", fontSize: 11,
                      background: C.input, border: `1px solid ${rothActive && !c.owner.trim() ? C.red : C.inputBorder}`,
                      borderRadius: 4, color: C.text, opacity: rothActive ? 1 : 0.4,
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Notes (optional, applies to all lines)"
          value={batchNotes}
          onChange={(e) => setBatchNotes(e.target.value)}
          disabled={busy}
          style={{ ...inputStyle, flex: 1, minWidth: 200, fontSize: 12, padding: "6px 10px" }}
        />
        <div style={{ fontSize: 11, color: C.muted, padding: "0 8px" }}>
          {pendingCompletions.length} line{pendingCompletions.length === 1 ? "" : "s"} pending
        </div>
        <button
          type="button"
          onClick={submitAll}
          disabled={busy || pendingCompletions.length === 0}
          style={{
            ...btnStyle(C.green), padding: "6px 16px", fontSize: 12,
            opacity: (busy || pendingCompletions.length === 0) ? 0.5 : 1,
          }}
        >
          {busy ? "Saving..." : "Save All Completions"}
        </button>
      </div>

      {validationError && (
        <div style={{ marginTop: 8, padding: 6, fontSize: 11, color: C.red, background: "#ef444411", borderRadius: 4 }}>
          ⚠ {validationError}
        </div>
      )}
    </div>
  );
}


// ==================== COMPLETION HISTORY PANEL ====================
// Read-only view of Del/Ret/Roth transactions recorded against each line.
// Shown in the order form when status is delivered/invoiced/closed.
function CompletionHistoryPanel({ orderId, lines }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!orderId) return;
    api.getOrderCompletions(orderId)
      .then(r => setData(r && typeof r === "object" && "perLine" in r ? r : { perLine: r || [], optimoLevel: [] }))
      .catch(() => setData({ perLine: [], optimoLevel: [] }));
  }, [orderId]);

  if (!data) return <div style={{ padding: 12, color: C.muted, fontSize: 12 }}>Loading completion history…</div>;

  const { perLine = [], optimoLevel = [] } = data;

  // Group per-line transactions by order_line_id
  const byLine = {};
  for (const t of perLine) {
    if (!byLine[t.order_line_id]) byLine[t.order_line_id] = [];
    byLine[t.order_line_id].push(t);
  }

  const typeLabel = { delivery: "DEL", return: "RET", return_other: "ROTH" };
  const typeColor = { delivery: C.green, return: C.accent, return_other: C.purple };
  const sourceLabel = { manual: "Manual", order: "Optimo (auto)", optimoroute: "Optimo (POD)" };

  const statusBadge = (s) => {
    const map = {
      delivered:    { label: "DELIVERED", fg: C.green },
      returned:     { label: "RETURNED",  fg: C.accent },
      return_other: { label: "ROTH",      fg: C.purple },
      cancelled:    { label: "CANCELLED", fg: C.muted },
      open:         { label: "OPEN",      fg: C.muted },
    };
    const st = map[s] || { label: s?.toUpperCase() || "—", fg: C.muted };
    return <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700, background: `${st.fg}22`, color: st.fg }}>{st.label}</span>;
  };

  const txnChips = (txns) => txns.map(t => (
    <span key={t.id} style={{
      padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
      background: `${typeColor[t.type] || C.muted}22`, color: typeColor[t.type] || C.muted,
    }}>
      {typeLabel[t.type] || t.type}: {t.qty}
      {t.foreign_owner ? ` (${t.foreign_owner})` : ""}
      <span style={{ fontSize: 9, color: C.muted, marginLeft: 4 }}>{sourceLabel[t.source] || t.source}</span>
    </span>
  ));

  const hasAny = perLine.length > 0 || optimoLevel.length > 0;

  return (
    <div style={{ marginTop: 16, padding: 14, background: C.panel, borderRadius: 8, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
        Delivery Completion Record
      </div>

      {!hasAny && (
        <div style={{ fontSize: 12, color: C.muted, padding: "6px 0" }}>
          No completion transactions recorded yet. These are written when lines are delivered via the Manual Completion panel or when OptimoRoute syncs back.
        </div>
      )}

      {/* Per-line rows */}
      {(lines || []).map(ln => {
        const lineTxns = byLine[ln.id] || [];
        if (lineTxns.length === 0 && !ln.delivered_qty && ln.status === "open") return null;
        return (
          <div key={ln.id} style={{ marginBottom: 8, padding: "8px 10px", background: C.input, borderRadius: 6, border: `1px solid ${C.inputBorder}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: lineTxns.length > 0 ? 6 : 0 }}>
              <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>{ln.cylinder_label || ln.cylinder_type_id || "—"}</span>
              <span style={{ fontSize: 11, color: C.muted }}>Ordered: {ln.qty}</span>
              {ln.delivered_qty > 0 && <span style={{ fontSize: 11, color: C.green }}>Delivered: {ln.delivered_qty}</span>}
              {statusBadge(ln.status)}
            </div>
            {lineTxns.length > 0 ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{txnChips(lineTxns)}</div>
            ) : (
              <div style={{ fontSize: 11, color: C.muted }}>Status updated — no raw transaction linked to this line</div>
            )}
          </div>
        );
      })}

      {/* Optimo order-level POD row (no order_line_id — shown separately) */}
      {optimoLevel.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 10px", background: "#8b5cf611", borderRadius: 6, border: `1px solid #8b5cf633` }}>
          <div style={{ fontSize: 11, color: C.purple, fontWeight: 700, marginBottom: 6 }}>
            OptimoRoute POD (order-level — not per line)
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{txnChips(optimoLevel)}</div>
        </div>
      )}
    </div>
  );
}

// ==================== ORDERS VIEW ====================
function OrdersView({ customers, cylinderTypes, showToast, reloadCustomers, pendingOrderId, onPendingOrderHandled, pendingNewOrderCustomerId, onPendingNewOrderHandled }) {
  const [orders, setOrders] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [custSearch, setCustSearch] = useState("");
  const [showNewCust, setShowNewCust] = useState(false);
  const [listCustomerFilter, setListCustomerFilter] = useState(""); // bottom orders list: filter by customer id
  const [custBalance, setCustBalance] = useState(null); // { balance, credit_balance, open_invoices, active_credits }
  const emptyForm = {
    customer_id: "", address: "", customer_name: "", order_detail: "", cylinder_type_id: "",
    qty: 1, unit_price: 0, total_price: 0, notes: "",
    order_date: new Date().toISOString().split("T")[0], payment: "", payment_ref: "",
    collection: false, paid: false, po_number: "", duration: 5, payment_amount: 0,
    lines: [], // multi-line: [{ cylinder_type_id, cylinder_label, qty, unit_price, line_total, is_fixed, original_price }]
  };
  const [form, setForm] = useState({ ...emptyForm });
  const [priceLines, setPriceLines] = useState([]); // multi-item breakdown (raw from lookup)
  const [showLineEditor, setShowLineEditor] = useState(false);
  const [newCust, setNewCust] = useState({ name: "", contact: "", phone: "", email: "", address: "", payment_ref: "" });

  const loadOrders = async () => {
    try { setOrders(await api.getOrders({ limit: 100 })); } catch(e) {}
  };
  useEffect(() => { loadOrders(); }, []);

  // Open a specific order when navigated from another view (e.g. customer form)
  useEffect(() => {
    if (!pendingOrderId) return;
    api.getOrder(pendingOrderId)
      .then(o => { if (o) startEdit(o); })
      .catch(() => {})
      .finally(() => { if (onPendingOrderHandled) onPendingOrderHandled(); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOrderId]);

  // Pre-populate a new order for a specific customer (from the customer form)
  useEffect(() => {
    if (!pendingNewOrderCustomerId) return;
    const c = (customers || []).find(x => x.id === pendingNewOrderCustomerId);
    if (c) {
      setEditing(null);
      setCreating(true);
      selectCustomer(c);
    }
    if (onPendingNewOrderHandled) onPendingNewOrderHandled();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewOrderCustomerId]);

  // Load customer balance whenever the selected customer changes
  useEffect(() => {
    if (!form.customer_id) { setCustBalance(null); return; }
    let cancelled = false;
    api.getCustomerBalance(form.customer_id)
      .then(r => { if (!cancelled) setCustBalance(r); })
      .catch(() => { if (!cancelled) setCustBalance(null); });
    return () => { cancelled = true; };
  }, [form.customer_id]);

  // Price lookup when customer or order_detail changes — multi-item.
  // 3.0.12: When editing an existing order whose lines came from the database (have IDs),
  // we must NOT rebuild form.lines from a lookup-price call — that would strip the line IDs
  // needed by the manual completion failsafe panel. Lookup only runs when the user actually
  // changes order_detail in the form (which clears the IDs as a side effect, indicating
  // intent to rebuild lines from scratch).
  const lookupRef = useRef(0);
  const editingDetailRef = useRef(""); // tracks the order_detail value at the moment startEdit ran
  const [lookupError, setLookupError] = useState(null);
  useEffect(() => {
    if (!form.order_detail) { setPriceLines([]); setForm(f => ({ ...f, lines: [] })); setLookupError(null); return; }
    // 3.0.12: if editing an existing order AND the order_detail hasn't been changed by the
    // user since opening the form, skip the lookup. The lines we have are authoritative
    // (they came from the database with their IDs intact).
    if (editing && form.order_detail === editingDetailRef.current && (form.lines || []).some(l => l.id)) {
      return;
    }
    const thisLookup = ++lookupRef.current;
    const timer = setTimeout(async () => {
      try {
        const r = await api.lookupPrice(form.customer_id, form.order_detail);
        if (thisLookup !== lookupRef.current) return;
        setLookupError(null);
        setPriceLines(r.lines || []);
        // Build form.lines from matched price lines (round 2: rebuilt on every lookup)
        const matched = (r.lines || []).filter(l => l.matched);
        const formLines = matched.map((l, i) => ({
          cylinder_type_id: l.cylinder_type_id,
          cylinder_label: l.cylinder_label,
          qty: l.qty,
          unit_price: l.unit_price,
          line_total: l.line_total,
          original_price: l.unit_price, // remember for write-back detection
          is_fixed: !!l.is_fixed,
          fixed_until: l.fixed_until || "",
          sort_order: i,
        }));
        // Set totals and first item's cylinder_type_id for backward-compat fields
        setForm(f => ({
          ...f,
          cylinder_type_id: r.cylinder_type_id || "",
          qty: r.qty || 1,
          unit_price: r.unit_price || 0,
          total_price: r.total || 0,
          lines: formLines,
        }));
      } catch(e) {
        // 3.0.7: surface the error instead of silently swallowing it
        if (thisLookup !== lookupRef.current) return;
        setLookupError(e.message || "Price lookup failed");
        console.error("[lookupPrice] failed:", e);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [form.customer_id, form.order_detail]);

  // Recompute total whenever any line in form.lines changes (price editor)
  useEffect(() => {
    if (!form.lines || form.lines.length === 0) return;
    const newTotal = Math.round(form.lines.reduce((s, l) => s + (l.line_total || 0), 0) * 100) / 100;
    if (Math.abs(newTotal - (form.total_price || 0)) > 0.001) {
      setForm(f => ({ ...f, total_price: newTotal }));
    }
  }, [form.lines]);

  // Update a single line's unit_price (recomputes line_total)
  const updateLinePrice = (idx, newPrice) => {
    setForm(f => {
      const lines = [...f.lines];
      const ln = { ...lines[idx] };
      ln.unit_price = parseFloat(newPrice) || 0;
      ln.line_total = Math.round(ln.unit_price * (ln.qty || 0) * 100) / 100;
      lines[idx] = ln;
      return { ...f, lines };
    });
  };

  const filteredCustomers = useMemo(() => {
    if (!custSearch) return customers || [];
    const s = custSearch.toLowerCase();
    return (customers || []).filter(c =>
      (c.name || "").toLowerCase().includes(s) ||
      (c.address || "").toLowerCase().includes(s) ||
      (c.account_number || "").toLowerCase().includes(s) ||
      (c.contact || "").toLowerCase().includes(s) ||
      (c.phone || "").toLowerCase().includes(s)
    );
  }, [customers, custSearch]);

  const selectCustomer = (c) => {
    // Parse customer.duration (free text) into integer minutes
    const parsedDur = (() => {
      const s = String(c.duration || "").toLowerCase();
      const h = s.match(/(\d+(?:\.\d+)?)\s*h/);
      if (h) return Math.max(1, Math.round(parseFloat(h[1]) * 60));
      const n = s.match(/(\d+(?:\.\d+)?)/);
      if (n) return Math.max(1, Math.round(parseFloat(n[1])));
      return 5;
    })();
    setForm(f => ({
      ...f,
      customer_id: c.id, address: c.address || "", customer_name: formatCustomerDisplay(c),
      payment_ref: c.payment_ref || "", notes: c.notes || "", duration: parsedDur,
    }));
    setCustSearch("");
  };

  const createInlineCustomer = async () => {
    try {
      const result = await api.createCustomer(newCust);
      showToast("Customer created");
      reloadCustomers();
      setForm(f => ({ ...f, customer_id: result.id, address: newCust.address || "", customer_name: formatCustomerDisplay(newCust), payment_ref: newCust.payment_ref || "" }));
      setShowNewCust(false);
      setNewCust({ name: "", contact: "", phone: "", email: "", address: "", payment_ref: "" });
    } catch (e) { showToast(e.message, "error"); }
  };

  const submitOrder = async () => {
    try {
      // Detect price edits that need write-back (only on create, not edit)
      // Per round 2 pricing rule: edit at create → confirm prompt → write back
      // Edit existing → no write-back
      // Fixed contract → already non-editable in UI, but defensive check here
      if (!editing && form.lines && form.lines.length > 0) {
        const editedLines = form.lines.filter(l =>
          !l.is_fixed &&
          l.cylinder_type_id &&
          Math.abs((l.unit_price || 0) - (l.original_price || 0)) > 0.001
        );
        if (editedLines.length > 0) {
          const labels = editedLines.map(l => `  • ${l.cylinder_label}: $${(l.original_price || 0).toFixed(2)} → $${(l.unit_price || 0).toFixed(2)}`).join("\n");
          const proceed = confirm(
            `You've changed the unit price on ${editedLines.length} line${editedLines.length === 1 ? "" : "s"}:\n\n${labels}\n\n` +
            `Save this as the customer's new standing price? Future orders will use the new price.\n\n` +
            `OK = save as standing price\nCancel = use the original price`
          );
          if (proceed) {
            // Write each edited line back to customer pricing
            for (const ln of editedLines) {
              try {
                await api.updateCustomerPrice({
                  customer_id: form.customer_id,
                  cylinder_type_id: ln.cylinder_type_id,
                  price: ln.unit_price,
                });
              } catch (e) {
                showToast(`Could not save price for ${ln.cylinder_label}: ${e.message}`, "error");
              }
            }
          } else {
            // Revert to original prices
            setForm(f => ({
              ...f,
              lines: f.lines.map(l => ({
                ...l,
                unit_price: l.original_price || 0,
                line_total: Math.round((l.original_price || 0) * (l.qty || 0) * 100) / 100,
              })),
            }));
            // Don't proceed with save — user can re-click after deciding
            return;
          }
        }
      }

      if (editing) {
        // Round 3: PUT now does its own Optimo sync inline; result includes push_attempted/success/error
        const r = await api.updateOrder(editing, form);
        if (r?.push_attempted && !r.push_success) {
          showToast(`Order updated. Optimo push failed: ${r.push_error || "unknown error"}`, "error");
        } else if (r?.push_attempted && r.push_success) {
          showToast("Order updated & dispatched to OptimoRoute");
        } else if (r?.status) {
          showToast(`Order updated (status: ${r.status})`);
        } else {
          showToast("Order updated");
        }
        setEditing(null);
      } else {
        const r = await api.createOrder(form);
        if (r?.push_attempted && !r.push_success) {
          showToast(`Order created. Optimo push failed: ${r.push_error || "unknown error"}. Use the Push to Optimo button to retry.`, "error");
        } else if (r?.push_attempted && r.push_success) {
          showToast("Order created & dispatched to OptimoRoute");
        } else if (r?.status) {
          showToast(`Order created (status: ${r.status})`);
        } else {
          showToast("Order created");
        }
        setCreating(false);
      }
      setForm({ ...emptyForm });
      setPriceLines([]);
      setShowLineEditor(false);
      loadOrders();
      reloadCustomers(); // balance may have changed
    } catch (e) { showToast(e.message, "error"); }
  };

  const startEdit = (o) => {
    setEditing(o.id);
    setCreating(true);
    // 3.0.12: stash the order_detail value at edit-open time so the lookup useEffect
    // can detect "user hasn't changed it yet" and skip the destructive rebuild that
    // would strip line IDs.
    editingDetailRef.current = o.order_detail || "";
    // Load lines from the order — GET /orders now joins order_lines and returns them inline
    const lines = (o.lines || []).map((l, i) => ({
      id: l.id, // 3.0.10: needed for manual completion failsafe
      status: l.status || "open", // 3.0.10
      delivered_qty: l.delivered_qty || 0, // 3.0.10
      item_type: l.item_type || "cylinder", // 3.0.12: needed to filter sale lines for failsafe
      cylinder_type_id: l.cylinder_type_id,
      cylinder_label: l.cylinder_label || "",
      qty: l.qty,
      unit_price: l.unit_price,
      line_total: l.line_total,
      original_price: l.unit_price,
      is_fixed: false, // editing existing → never fixed (round 2 simplification)
      sort_order: l.sort_order || i,
    }));
    setForm({
      customer_id: o.customer_id, address: o.address || "", customer_name: o.customer_name || "",
      order_detail: o.order_detail || "", cylinder_type_id: o.cylinder_type_id || "",
      qty: o.qty || 1, unit_price: o.unit_price || 0, total_price: o.total_price || 0,
      notes: o.notes || "", order_date: o.order_date || "",
      payment: o.payment || "", payment_ref: o.payment_ref || "",
      collection: !!o.collection, paid: !!o.paid, po_number: o.po_number || "", duration: o.duration || 5,
      payment_amount: parseFloat(o.payment_amount) || 0,
      lines,
      // 3.0.10: stash the order's status so the manual completion panel can show/hide
      _editing_order_id: o.id,
      _editing_order_number: o.order_number || "",
      _editing_status: o.status || "",
    });
    // Build priceLines display from order lines so the table shows right away
    setPriceLines(lines.map(l => ({
      raw: `${l.qty}× ${l.cylinder_label}`,
      matched: true,
      cylinder_label: l.cylinder_label,
      cylinder_type_id: l.cylinder_type_id,
      qty: l.qty,
      unit_price: l.unit_price,
      line_total: l.line_total,
      is_fixed: false,
    })));
  };

  const matchCreditToOrder = async (orderId) => {
    try {
      const r = await api.matchCreditToOrder(orderId);
      if (r.amount_applied > 0) {
        showToast(`Applied ${fmtCurrency(r.amount_applied)} credit to order`);
      } else {
        showToast("No available credit to apply", "error");
      }
      loadOrders();
      reloadCustomers();
      if (form.customer_id) {
        api.getCustomerBalance(form.customer_id).then(setCustBalance).catch(() => {});
      }
    } catch (e) { showToast(e.message, "error"); }
  };

  const cancelEdit = () => {
    setEditing(null);
    setCreating(false);
    setForm({ ...emptyForm });
    setPriceLines([]);
    setShowLineEditor(false);
    editingDetailRef.current = ""; // 3.0.12
  };

  const cancelOrder = async (id) => {
    if (!confirm("Cancel this order? This cannot be undone.")) return;
    try {
      const result = await api.cancelOrder(id);
      loadOrders();
      if (result.creditAmount > 0) {
        showToast(`Order cancelled — credit note ${result.creditNumber} ($${result.creditAmount.toFixed(2)}) applied to account`);
      } else {
        showToast("Order cancelled");
      }
    } catch (e) { showToast(e.message, "error"); }
  };

  const confirmPayment = async (id) => {
    try {
      await api.confirmPayment(id);
      showToast("Payment confirmed — pushed to OptimoRoute");
      loadOrders();
    } catch (e) { showToast(e.message, "error"); }
  };

  const updateCustomerPrice = async () => {
    if (!form.customer_id || !form.cylinder_type_id || !form.unit_price) return;
    try {
      await api.updateCustomerPrice({ customer_id: form.customer_id, cylinder_type_id: form.cylinder_type_id, price: form.unit_price });
      showToast("Customer price updated");
    } catch (e) { showToast(e.message, "error"); }
  };

  const filteredOrders = useMemo(() => {
    let list = orders;
    // 3.0.11: When a customer is selected in the create/edit form, narrow the orders
    // list at the bottom to that customer only. Stops the dispatcher seeing every
    // order in the system while they're in the middle of editing one.
    // `editing` is an id string (or "new"/null), so treat any truthy non-"new"
    // value as an active edit session and apply the same narrowing.
    const isEditingExisting = editing && editing !== "new";
    if ((creating || isEditingExisting) && form.customer_id) {
      list = list.filter(o => o.customer_id === form.customer_id);
    }
    // Explicit bottom-of-screen customer filter (independent of the form).
    if (listCustomerFilter) {
      list = list.filter(o => o.customer_id === listCustomerFilter);
    }
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter(o =>
      (o.customer_name || "").toLowerCase().includes(s) ||
      (o.address || "").toLowerCase().includes(s) ||
      (o.order_detail || "").toLowerCase().includes(s) ||
      (o.po_number || "").toLowerCase().includes(s) ||
      (o.order_number || "").toLowerCase().includes(s) ||
      (o.customer_contact_lookup || "").toLowerCase().includes(s) ||
      (o.customer_phone_lookup || "").toLowerCase().includes(s)
    );
  }, [orders, search, creating, editing, form.customer_id, listCustomerFilter]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Orders</h2>
        <button onClick={() => { if (creating) cancelEdit(); else { setCreating(true); setEditing(null); setForm({ ...emptyForm }); } }} style={btnStyle()}>
          {creating ? "Cancel" : "+ New Order"}
        </button>
      </div>

      {/* CREATE / EDIT ORDER FORM */}
      {creating && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>{editing ? "Edit Order" : "New Order"}</div>

          {/* Customer search */}
          {!editing && (
            <>
              <label style={labelStyle}>Search Customer (by name or address)</label>
              <div style={{ position: "relative", marginBottom: 12 }}>
                <input
                  value={form.customer_id ? form.customer_name : custSearch}
                  onChange={e => { setCustSearch(e.target.value); setForm(f => ({ ...f, customer_id: "", customer_name: "", address: "", payment_ref: "" })); }}
                  placeholder="Type to search customers..."
                  style={inputStyle}
                />
                {custSearch && !form.customer_id && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, maxHeight: 200, overflowY: "auto", zIndex: 10 }}>
                    {filteredCustomers.map(c => (
                      <div key={c.id} onClick={() => selectCustomer(c)} style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                        <strong>{c.name}</strong> <span style={{ color: C.muted }}>— {c.address}</span>
                      </div>
                    ))}
                    {filteredCustomers.length === 0 && (
                      <div style={{ padding: "8px 12px" }}>
                        <span style={{ color: C.muted, fontSize: 13 }}>No customers found — </span>
                        <button onClick={() => { setShowNewCust(true); setNewCust(n => ({ ...n, name: custSearch })); }} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                          Create new customer
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {form.customer_id && (
            <div style={{ padding: "6px 10px", background: "#22c55e15", borderRadius: 6, fontSize: 13, color: C.green, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Customer: <strong>{form.customer_name}</strong> — {form.address}</span>
              {!editing && <button onClick={() => setForm(f => ({ ...f, customer_id: "", customer_name: "", address: "", payment_ref: "" }))} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>✕</button>}
            </div>
          )}

          {/* Inline new customer form */}
          {showNewCust && (
            <Card style={{ marginBottom: 12, background: C.input, borderColor: C.accent }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: C.accent, marginBottom: 8 }}>Quick-Create Customer</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><label style={labelStyle}>Name *</label><input value={newCust.name} onChange={e => setNewCust(p => ({ ...p, name: e.target.value }))} style={inputStyle} /></div>
                <div><label style={labelStyle}>Address</label><input value={newCust.address} onChange={e => setNewCust(p => ({ ...p, address: e.target.value }))} style={inputStyle} /></div>
                <div><label style={labelStyle}>Phone</label><input value={newCust.phone} onChange={e => setNewCust(p => ({ ...p, phone: e.target.value }))} style={inputStyle} /></div>
                <div><label style={labelStyle}>Email</label><input value={newCust.email} onChange={e => setNewCust(p => ({ ...p, email: e.target.value }))} style={inputStyle} /></div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={createInlineCustomer} disabled={!newCust.name?.trim()} style={btnStyle(C.green)}>Create & Select</button>
                <button onClick={() => setShowNewCust(false)} style={btnStyle(C.muted)}>Cancel</button>
              </div>
            </Card>
          )}

          {/* Order fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Address</label>
              <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} style={inputStyle} placeholder="Auto-filled from customer" />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Order</label>
              <input value={form.order_detail} onChange={e => setForm(p => ({ ...p, order_detail: e.target.value }))} style={inputStyle} placeholder="e.g. 1x45, 1x8.5, 2 Cage acc" />
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>Separate multiple items with commas — or click a type below to add it</div>
              {(cylinderTypes || []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {(cylinderTypes || []).map(ct => (
                    <button
                      key={ct.id}
                      type="button"
                      onClick={() => {
                        const token = `1x${ct.label}`;
                        setForm(p => ({
                          ...p,
                          order_detail: p.order_detail ? `${p.order_detail.trimEnd()}, ${token}` : token,
                        }));
                      }}
                      style={{
                        padding: "3px 10px", borderRadius: 12, fontSize: 11, cursor: "pointer", border: "none",
                        background: ct.item_type === "cylinder" ? "#3b82f622" : "#f59e0b22",
                        color: ct.item_type === "cylinder" ? C.blue : C.accent,
                        fontWeight: 600,
                      }}
                      title={`Add 1x${ct.label} (${ct.item_type === "cylinder" ? "rental" : "sale"})`}
                    >
                      + {ct.label}
                    </button>
                  ))}
                </div>
              )}
              {lookupError && (
                <div style={{ marginTop: 6, padding: 8, background: "#ef444422", border: `1px solid ${C.red}`, borderRadius: 6, fontSize: 12, color: C.red }}>
                  ⚠ Price lookup failed: {lookupError}
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
                    Check that the server is running and reachable. If this persists, the /api/orders/lookup-price endpoint may be unavailable on your backend.
                  </div>
                </div>
              )}
            </div>

            {/* Multi-item price breakdown */}
            {priceLines.length > 0 && (
              <div style={{ gridColumn: "1/-1" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginBottom: 8, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                  <thead>
                    <tr style={{ background: C.panel, borderBottom: `1px solid ${C.border}` }}>
                      {["Item", "Matched", "Qty", "Unit Price", "Line Total"].map(h => (
                        <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: C.muted, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {priceLines.map((line, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{line.raw}</td>
                        <td style={{ padding: "6px 8px", color: line.matched ? C.blue : C.red, fontWeight: 600 }}>
                          {line.matched ? line.cylinder_label : "No match"}
                        </td>
                        <td style={{ padding: "6px 8px" }}>{line.matched ? line.qty : "—"}</td>
                        <td style={{ padding: "6px 8px" }}>{line.matched ? fmtCurrency(line.unit_price) : "—"}</td>
                        <td style={{ padding: "6px 8px", fontWeight: 600 }}>{line.matched ? fmtCurrency(line.line_total) : "—"}</td>
                      </tr>
                    ))}
                    <tr style={{ background: C.panel }}>
                      <td colSpan={4} style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>Subtotal</td>
                      <td style={{ padding: "6px 8px", fontWeight: 600 }}>{fmtCurrency(form.total_price)}</td>
                    </tr>
                    <tr style={{ background: C.panel }}>
                      <td colSpan={4} style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: C.muted }}>GST (10%)</td>
                      <td style={{ padding: "6px 8px", fontWeight: 600, color: C.muted }}>{fmtCurrency(Math.round(form.total_price * 0.10 * 100) / 100)}</td>
                    </tr>
                    <tr style={{ background: C.panel }}>
                      <td colSpan={4} style={{ padding: "8px", textAlign: "right", fontWeight: 800 }}>TOTAL (incl. GST)</td>
                      <td style={{ padding: "8px", fontWeight: 800, color: C.green, fontSize: 16 }}>{fmtCurrency(Math.round(form.total_price * 1.10 * 100) / 100)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Per-line price editor */}
                {form.lines && form.lines.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <button
                      type="button"
                      onClick={() => setShowLineEditor(s => !s)}
                      style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}
                    >
                      {showLineEditor ? "▼" : "▶"} Adjust line prices
                      {form.lines.some(l => Math.abs((l.unit_price || 0) - (l.original_price || 0)) > 0.001) && (
                        <span style={{ marginLeft: 8, color: C.accent, fontWeight: 700 }}>● modified</span>
                      )}
                    </button>
                    {showLineEditor && (
                      <div style={{ padding: 12, background: C.input, borderRadius: 6, border: `1px solid ${C.border}` }}>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                          {editing
                            ? "Editing existing order — price changes apply to this line only, NOT customer's standing price."
                            : "Editing line price will prompt to save as the customer's new standing price for that cylinder type."}
                        </div>
                        {form.lines.map((ln, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
                            <div style={{ minWidth: 140, fontSize: 12, fontWeight: 600 }}>
                              {ln.cylinder_label || ln.cylinder_type_id}
                              {ln.is_fixed && (
                                <span style={{ marginLeft: 6, padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: "#3b82f622", color: C.blue }}>
                                  FIXED until {ln.fixed_until}
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: 12, color: C.muted }}>Qty {ln.qty}</span>
                            <span style={{ fontSize: 12, color: C.muted }}>@</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={ln.unit_price}
                              onChange={e => updateLinePrice(i, e.target.value)}
                              disabled={ln.is_fixed}
                              style={{ ...inputStyle, width: 100, padding: "4px 8px", fontSize: 12 }}
                            />
                            <span style={{ fontSize: 12, color: C.muted }}>=</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: C.green, minWidth: 80 }}>
                              {fmtCurrency(ln.line_total)}
                            </span>
                            {Math.abs((ln.unit_price || 0) - (ln.original_price || 0)) > 0.001 && (
                              <span style={{ fontSize: 10, color: C.accent }}>
                                (was {fmtCurrency(ln.original_price)})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3.0.10: Manual Completion (Optimo failsafe) panel.
                    3.0.13: Widened render condition to include 'open' status so the
                    panel is available before the order has been dispatched too.
                    Lets the dispatcher record per-line outcomes when the driver
                    forgot to mark POD on the mobile app or Optimo is down. */}
                {editing && form.lines && form.lines.length > 0 &&
                 ["open", "awaiting_dispatch", "dispatched"].includes(form._editing_status) && (
                  <ManualCompletionPanel
                    orderId={form._editing_order_id}
                    orderNumber={form._editing_order_number}
                    lines={form.lines}
                    showToast={showToast}
                    onCompleted={async () => {
                      // Reload the order so the panel reflects new line statuses
                      try {
                        const fresh = await api.getOrder(form._editing_order_id);
                        setForm(f => ({
                          ...f,
                          lines: f.lines.map(ln => {
                            const updated = (fresh.lines || []).find(x => x.id === ln.id);
                            return updated ? { ...ln, status: updated.status, delivered_qty: updated.delivered_qty } : ln;
                          }),
                          _editing_status: fresh.status || f._editing_status,
                        }));
                        loadOrders();
                        reloadCustomers();
                      } catch (e) { /* tolerate */ }
                    }}
                  />
                )}

                {/* Completion history — read-only view for delivered/invoiced/closed orders */}
                {editing && ["delivered", "invoiced", "closed"].includes(form._editing_status) && (
                  <CompletionHistoryPanel orderId={form._editing_order_id} lines={form.lines} />
                )}
              </div>
            )}

            <div>
              <label style={labelStyle}>Order Date</label>
              <input type="date" value={form.order_date} onChange={e => setForm(p => ({ ...p, order_date: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Payment</label>
              <input value={form.payment} onChange={e => setForm(p => ({ ...p, payment: e.target.value }))} style={inputStyle} placeholder="e.g. Paid, CC, Cash, Acc" />
            </div>
            <div>
              <label style={labelStyle}>Payment Reference</label>
              <input value={form.payment_ref} onChange={e => setForm(p => ({ ...p, payment_ref: e.target.value }))} style={inputStyle} placeholder="Auto-filled from customer" />
            </div>
            {form.customer_id && (() => {
              const cust = customers.find(c => c.id === form.customer_id);
              return cust?.cc_masked ? (
                <div>
                  <label style={labelStyle}>CC on File</label>
                  <CCReveal customerId={form.customer_id} masked={cust.cc_masked} />
                </div>
              ) : null;
            })()}
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Notes</label>
              <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} style={inputStyle} placeholder="Delivery instructions, special requests..." />
            </div>

            {/* New: PO / Duration */}
            <div>
              <label style={labelStyle}>PO Number</label>
              <input value={form.po_number} onChange={e => setForm(p => ({ ...p, po_number: e.target.value }))} style={inputStyle} placeholder="Customer PO reference" />
            </div>
            <div>
              <label style={labelStyle}>Duration (minutes)</label>
              <input type="number" min="1" value={form.duration} onChange={e => setForm(p => ({ ...p, duration: parseInt(e.target.value) || 5 }))} style={inputStyle} />
              <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>Sent to OptimoRoute. Auto-filled from customer.</div>
            </div>

            {/* New: Collection + Paid flags */}
            <div style={{ gridColumn: "1/-1", display: "flex", gap: 20, padding: "8px 12px", background: C.input, borderRadius: 6, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={form.collection} onChange={e => setForm(p => ({ ...p, collection: e.target.checked }))} />
                <span style={{ fontWeight: 600 }}>Collection</span>
                <span style={{ color: C.muted, fontSize: 11 }}>(manual fulfilment — won't push to OptimoRoute)</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={form.paid} onChange={e => setForm(p => ({ ...p, paid: e.target.checked }))} disabled={form.payment_amount > 0 && form.payment_amount < (parseFloat(form.total_price) || 0)} />
                <span style={{ fontWeight: 600 }}>Paid in Full</span>
                <span style={{ color: C.muted, fontSize: 11 }}>(marks invoice fully paid)</span>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Partial Payment $</span>
                <input
                  type="number" step="0.01" min="0"
                  value={form.payment_amount || ""}
                  onChange={e => setForm(p => ({ ...p, payment_amount: parseFloat(e.target.value) || 0 }))}
                  disabled={form.paid}
                  placeholder="0.00"
                  style={{ ...inputStyle, width: 100, padding: "4px 8px" }}
                />
                {form.payment_amount > 0 && (parseFloat(form.total_price) || 0) > 0 && (
                  (() => {
                    const total = parseFloat(form.total_price) || 0;
                    const willBeInvoiced = form.payment_amount >= total;
                    return (
                      <span style={{ fontSize: 11, color: willBeInvoiced ? C.green : C.muted }}>
                        {willBeInvoiced ? "✓ Will trigger dispatch" : `${fmtCurrency(total - form.payment_amount)} remaining`}
                      </span>
                    );
                  })()
                )}
              </div>
            </div>

            {/* Customer balance panel */}
            {form.customer_id && custBalance && (
              <div style={{ gridColumn: "1/-1", padding: "10px 12px", borderRadius: 6, background: C.panel, border: `1px solid ${C.border}`, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Outstanding (inc GST)</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: custBalance.balance > 0 ? C.red : C.muted }}>
                    {fmtMoney(custBalance.balance)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Credit Available (inc GST)</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: custBalance.credit_balance > 0 ? C.green : C.muted }}>
                    {fmtMoney(custBalance.credit_balance)}
                  </div>
                </div>
                {custBalance.open_invoices?.length > 0 && (
                  <div style={{ fontSize: 11, color: C.muted }}>
                    {custBalance.open_invoices.length} open invoice{custBalance.open_invoices.length > 1 ? "s" : ""}
                  </div>
                )}
                {custBalance.active_credits?.length > 0 && (
                  <div style={{ fontSize: 11, color: C.muted }}>
                    {custBalance.active_credits.length} active credit{custBalance.active_credits.length > 1 ? "s" : ""}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={submitOrder} disabled={!form.customer_id || !form.order_date} style={{ ...btnStyle(C.green), flex: 1 }}>
              {(() => {
                if (!editing) return "Create Order";
                const o = orders.find(o => o.id === editing);
                // 3.0.11: Once an order is past delivered/invoiced/paid, syncing back to
                // Optimo doesn't make sense — the work is already done. Just show "Save Order".
                const lockedFromOptimo = o && ["delivered", "invoiced", "closed", "cancelled"].includes(o.status);
                if (o?.optimoroute_id && !lockedFromOptimo) return "Save & Sync to OptimoRoute";
                return "Save Order";
              })()}
            </button>
            {editing && <button onClick={cancelEdit} style={btnStyle(C.muted)}>Cancel</button>}
          </div>
        </Card>
      )}

      {/* ORDER LIST */}
      <input placeholder="Search by customer, address, contact, phone, PO#, order#..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, marginBottom: 16, maxWidth: 480 }} />

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Order #", "Date", "Customer", "PO#", "Order", "Total $", "Paid", "Due Date", "Status", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map(o => (
              <tr key={o.id} style={{ borderBottom: `1px solid ${C.border}`, background: editing === o.id ? "#f59e0b08" : "transparent", opacity: o.status === "cancelled" ? 0.5 : 1 }}>
                <td style={{ padding: "6px 8px", color: C.accent, fontWeight: 600 }}>{o.order_number || "—"}</td>
                <td style={{ padding: "6px 8px" }}>{o.order_date}</td>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{o.customer_name || o.customer_name_lookup || o.address || "—"}</td>
                <td style={{ padding: "6px 8px", color: C.muted }}>{o.po_number || "—"}</td>
                <td style={{ padding: "6px 8px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.order_detail || "—"}</td>
                <td style={{ padding: "6px 8px", fontWeight: 700, color: C.green }}>{o.total_price ? fmtCurrency(o.total_price) : "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  {o.paid ? <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#22c55e22", color: C.green }}>PAID</span> : <span style={{ color: C.muted }}>—</span>}
                </td>
                <td style={{ padding: "6px 8px", color: o.invoice_due_date ? C.text : C.muted }}>
                  {o.invoice_due_date || "—"}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {(() => {
                    const ss = orderStatusStyle(o.status);
                    return <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: ss.bg, color: ss.fg }}>{ss.label}</span>;
                  })()}
                  {o.collection ? <span style={{ padding: "2px 5px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "#6b728022", color: C.muted, marginLeft: 4 }}>COLL</span> : null}
                  {o.optimoroute_id && <span style={{ padding: "2px 5px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "#8b5cf622", color: C.purple, marginLeft: 4 }}>OR</span>}
                </td>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                  <button onClick={() => startEdit(o)} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12, marginRight: 6 }}>Edit</button>
                  {!o.paid && (
                    <button onClick={() => matchCreditToOrder(o.id)} title="Apply available customer credit to this order" style={{ background: "none", border: "none", color: C.purple, cursor: "pointer", fontSize: 12, marginRight: 6, fontWeight: 600 }}>
                      Match Credit
                    </button>
                  )}
                  {/* Round 3: show Push/Fulfil button for orders in open or awaiting_dispatch only */}
                  {(o.status === "open" || o.status === "awaiting_dispatch") && (
                    <button onClick={() => confirmPayment(o.id)} style={{ ...btnStyle(C.green), padding: "3px 8px", fontSize: 11, marginRight: 6 }}>
                      {o.collection ? "Fulfil" : (o.status === "awaiting_dispatch" ? "Push to Optimo" : "Confirm & Push")}
                    </button>
                  )}
                  {o.status !== "cancelled" && (
                    <button onClick={() => cancelOrder(o.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12 }}>Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredOrders.length === 0 && <div style={{ textAlign: "center", padding: 32, color: C.muted }}>No orders yet</div>}
      </div>
    </div>
  );
}

// ==================== OPENING BALANCES VIEW ====================
function OpeningBalancesView({ customers, cylinderTypes, showToast }) {
  const accountCustomers = useMemo(() => (customers || []).filter(c => c.account_customer), [customers]);
  const otherCustomers   = useMemo(() => (customers || []).filter(c => !c.account_customer), [customers]);
  const [form, setForm] = useState({ customer_id: "", cylinder_type: "", qty: "", date: new Date().toISOString().split("T")[0] });
  const [bulkText, setBulkText] = useState("");
  const [mode, setMode] = useState("single"); // single | bulk

  const submitSingle = async () => {
    try {
      await api.addOpeningBalance(form);
      showToast("Opening balance added");
      setForm(f => ({ ...f, cylinder_type: "", qty: "" }));
    } catch(e) { showToast(e.message, "error"); }
  };

  const submitBulk = async () => {
    try {
      // Parse text: each line = "customer name, cylinder type label, qty"
      const lines = bulkText.split("\n").filter(l => l.trim());
      const entries = [];
      for (const line of lines) {
        const parts = line.split(/[,\t]/).map(s => s.trim());
        if (parts.length < 3) continue;
        const cust = (customers || []).find(c => c.name.toLowerCase() === parts[0].toLowerCase() || (c.address || "").toLowerCase().includes(parts[0].toLowerCase()));
        const ct = (cylinderTypes || []).find(t => t.label.toLowerCase() === parts[1].toLowerCase() || t.id === parts[1]);
        const qty = parseInt(parts[2]);
        if (cust && ct && qty > 0) {
          entries.push({ customer_id: cust.id, cylinder_type: ct.id, qty, date: form.date });
        }
      }
      if (entries.length === 0) return showToast("No valid entries found. Format: Customer Name, Cylinder Type, Qty", "error");
      const r = await api.bulkOpeningBalance(entries);
      showToast(`${r.imported} opening balances imported`);
      setBulkText("");
    } catch(e) { showToast(e.message, "error"); }
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Opening Balances</h2>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
        Load starting on-hand cylinder quantities when going live. Account customers are listed first.
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: C.panel, borderRadius: 8, padding: 4 }}>
        <button onClick={() => setMode("single")} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", background: mode === "single" ? C.accent : "transparent", color: mode === "single" ? "#000" : C.muted, fontWeight: 600, fontSize: 13 }}>Single Entry</button>
        <button onClick={() => setMode("bulk")} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", background: mode === "bulk" ? C.accent : "transparent", color: mode === "bulk" ? "#000" : C.muted, fontWeight: 600, fontSize: 13 }}>Bulk Import</button>
      </div>

      {mode === "single" && (
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Customer</label>
              <select value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))} style={inputStyle}>
                <option value="">Select...</option>
                {accountCustomers.length > 0 && (
                  <optgroup label="── Account Customers ──">
                    {accountCustomers.map(c => <option key={c.id} value={c.id}>{c.account_number ? `${c.account_number} · ` : ""}{c.name} — {c.address}</option>)}
                  </optgroup>
                )}
                {otherCustomers.length > 0 && (
                  <optgroup label="── Other Customers ──">
                    {otherCustomers.map(c => <option key={c.id} value={c.id}>{c.account_number ? `${c.account_number} · ` : ""}{c.name} — {c.address}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Cylinder Type</label>
              <select value={form.cylinder_type} onChange={e => setForm(f => ({ ...f, cylinder_type: e.target.value }))} style={inputStyle}>
                <option value="">Select...</option>
                {(cylinderTypes || []).filter(ct => ct.item_type === "cylinder").map(ct => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Quantity On-Hand</label>
              <input type="number" min="1" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} style={inputStyle} placeholder="e.g. 5" />
            </div>
            <div>
              <label style={labelStyle}>Effective Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <button onClick={submitSingle} disabled={!form.customer_id || !form.cylinder_type || !form.qty} style={{ ...btnStyle(C.green), marginTop: 16 }}>
            Add Opening Balance
          </button>
        </Card>
      )}

      {mode === "bulk" && (
        <Card>
          <label style={labelStyle}>Effective Date (for all entries)</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ ...inputStyle, maxWidth: 200, marginBottom: 12 }} />

          <label style={labelStyle}>Paste data (one per line: Customer Name, Cylinder Type, Qty)</label>
          <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={10}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
            placeholder={"Marsha, 45, 3\nU2 100 Mooroondu Rd, 15, 2\nJohn Smith, 45kg LPG, 5"} />
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4, marginBottom: 12 }}>
            Customer can be matched by name or address. Cylinder type by label or ID. Comma or tab separated.
          </div>
          <button onClick={submitBulk} disabled={!bulkText.trim()} style={btnStyle(C.green)}>
            Import Opening Balances
          </button>
        </Card>
      )}

      {(customers || []).length === 0 && (
        <Card>
          <div style={{ textAlign: "center", padding: 24, color: C.muted }}>
            No customers yet. Add some in the Customers view first.
          </div>
        </Card>
      )}
    </div>
  );
}

// ==================== PRICING VIEW (simplified) ====================
function PricingView({ customers, cylinderTypes, showToast, userRole }) {
  const pricing = useApi(() => api.getPricing());
  const isAdmin = userRole === "admin";

  // Bulk pricing tab
  const [bulkMode, setBulkMode] = useState("fixed");
  const [selCT, setSelCT] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [pct, setPct] = useState("");
  const [centsPerLitre, setCentsPerLitre] = useState("");
  const [selCustomers, setSelCustomers] = useState([]);

  // Customer price list tab
  const [tab, setTab] = useState("bulk"); // bulk | customer | formula
  const [custSearch, setCustSearch] = useState("");
  const [bulkSearch, setBulkSearch] = useState("");
  const [selCustId, setSelCustId] = useState("");
  const [custPrices, setCustPrices] = useState([]);

  // Formula customers (customer_type = 'formula')
  const formulaCustomers = useMemo(() => (customers || []).filter(c => (c.customer_type || "").toLowerCase() === "formula"), [customers]);
  const [formulaSelCT, setFormulaSelCT] = useState("");
  const [formulaCents, setFormulaCents] = useState("");
  const [formulaSelCustomers, setFormulaSelCustomers] = useState([]);

  const pricingMap = useMemo(() => {
    const m = {};
    if (pricing.data) for (const p of pricing.data) m[`${p.customer_id}:${p.cylinder_type}`] = p;
    return m;
  }, [pricing.data]);

  const getCustomerPrice = (custId) => {
    if (!selCT || !custId) return null;
    const cp = pricingMap[`${custId}:${selCT}`];
    if (cp) return { price: cp.price, isCustom: true, isFixed: cp.fixed_price && cp.fixed_from && cp.fixed_to && new Date().toISOString().split("T")[0] >= cp.fixed_from && new Date().toISOString().split("T")[0] <= cp.fixed_to };
    const ct = (cylinderTypes || []).find(c => c.id === selCT);
    return ct ? { price: ct.default_price, isCustom: false, isFixed: false } : null;
  };

  const filteredCustomers = useMemo(() => {
    if (!custSearch) return customers || [];
    const s = custSearch.toLowerCase();
    return (customers || []).filter(c =>
      (c.name || "").toLowerCase().includes(s) ||
      (c.address || "").toLowerCase().includes(s) ||
      (c.account_number || "").toLowerCase().includes(s) ||
      (c.contact || "").toLowerCase().includes(s) ||
      (c.phone || "").toLowerCase().includes(s)
    );
  }, [customers, custSearch]);

  const bulkFilteredCustomers = useMemo(() => {
    if (!bulkSearch) return customers || [];
    const s = bulkSearch.toLowerCase();
    return (customers || []).filter(c =>
      (c.name || "").toLowerCase().includes(s) ||
      (c.address || "").toLowerCase().includes(s) ||
      (c.account_number || "").toLowerCase().includes(s) ||
      (c.contact || "").toLowerCase().includes(s) ||
      (c.phone || "").toLowerCase().includes(s)
    );
  }, [customers, bulkSearch]);

  // Load customer price list
  const loadCustPrices = async (custId) => {
    setSelCustId(custId);
    try { setCustPrices(await api.getCustomerPriceList(custId)); } catch(e) { setCustPrices([]); }
  };

  const saveCustPrice = async (ct_id, price, fixed_price, fixed_from, fixed_to) => {
    try {
      await api.setPrice(selCustId, ct_id, { price, fixed_price, fixed_from, fixed_to });
      pricing.reload();
      await loadCustPrices(selCustId);
      showToast("Price saved");
    } catch (e) { showToast(e.message, "error"); }
  };

  const applyBulk = async () => {
    try {
      const data = { cylinder_type: selCT, customer_ids: selCustomers };
      if (bulkMode === "percentage") { data.mode = "percentage"; data.percentage = parseFloat(pct); }
      else if (bulkMode === "per_litre") { data.mode = "per_litre"; data.cents_per_litre = parseFloat(centsPerLitre); }
      else { data.price = parseFloat(bulkPrice); }
      const r = await api.bulkPrice(data);
      pricing.reload();
      let msg = `${r.updated} customers updated`;
      if (r.skippedFixed > 0) msg += `, ${r.skippedFixed} skipped (fixed price active)`;
      showToast(msg);
    } catch (e) { showToast(e.message, "error"); }
  };

  const applyFormulaBulk = async () => {
    if (!formulaSelCT || !formulaSelCustomers.length || !formulaCents) return;
    try {
      const r = await api.bulkPrice({ cylinder_type: formulaSelCT, customer_ids: formulaSelCustomers, mode: "per_litre", cents_per_litre: parseFloat(formulaCents) });
      pricing.reload();
      let msg = `${r.updated} formula customers updated`;
      if (r.skippedFixed > 0) msg += `, ${r.skippedFixed} skipped (fixed price active)`;
      showToast(msg);
    } catch (e) { showToast(e.message, "error"); }
  };

  const toggleAll = () => {
    if (selCustomers.length === (customers || []).length) setSelCustomers([]);
    else setSelCustomers((customers || []).map(c => c.id));
  };

  const toggleAllFormula = () => {
    if (formulaSelCustomers.length === formulaCustomers.length) setFormulaSelCustomers([]);
    else setFormulaSelCustomers(formulaCustomers.map(c => c.id));
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Pricing Manager</h2>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: C.panel, borderRadius: 8, padding: 4 }}>
        <button onClick={() => setTab("bulk")} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", background: tab === "bulk" ? C.accent : "transparent", color: tab === "bulk" ? "#000" : C.muted, fontWeight: 600, fontSize: 13 }}>Bulk Update</button>
        <button onClick={() => setTab("customer")} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", background: tab === "customer" ? C.accent : "transparent", color: tab === "customer" ? "#000" : C.muted, fontWeight: 600, fontSize: 13 }}>Customer Price List</button>
        <button onClick={() => setTab("formula")} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", background: tab === "formula" ? C.accent : "transparent", color: tab === "formula" ? "#000" : C.muted, fontWeight: 600, fontSize: 13 }}>Formula Customers</button>
      </div>

      {/* ─── BULK UPDATE TAB ─── */}
      {tab === "bulk" && (
        <Card>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setBulkMode("fixed")} style={btnStyle(bulkMode === "fixed" ? C.accent : C.muted)}>Set Fixed Price</button>
            <button onClick={() => setBulkMode("percentage")} style={btnStyle(bulkMode === "percentage" ? C.accent : C.muted)}>% Increase</button>
            <button onClick={() => setBulkMode("per_litre")} style={btnStyle(bulkMode === "per_litre" ? C.accent : C.muted)}>Increase per ltr</button>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Cylinder Type</label>
              <select value={selCT} onChange={e => setSelCT(e.target.value)} style={{ ...inputStyle, width: 240 }}>
                <option value="">Select...</option>
                {(cylinderTypes || []).map(ct => <option key={ct.id} value={ct.id}>{ct.label} (default: {fmtCurrency(ct.default_price)}){ct.item_type === "sale" && ct.litres ? ` · ${ct.litres}L` : ""}</option>)}
              </select>
            </div>
            {bulkMode === "fixed" ? (
              <div><label style={labelStyle}>New Price ($)</label><input type="number" step="0.01" value={bulkPrice} onChange={e => setBulkPrice(e.target.value)} style={{ ...inputStyle, width: 120 }} /></div>
            ) : bulkMode === "percentage" ? (
              <div><label style={labelStyle}>Increase %</label><input type="number" step="0.1" value={pct} onChange={e => setPct(e.target.value)} style={{ ...inputStyle, width: 120 }} /></div>
            ) : (
              <div>
                <label style={labelStyle}>Cents per litre</label>
                <input type="number" step="0.001" value={centsPerLitre} onChange={e => setCentsPerLitre(e.target.value)} style={{ ...inputStyle, width: 140 }} placeholder="e.g. 0.05" />
                {selCT && (() => { const ct = (cylinderTypes || []).find(c => c.id === selCT); return ct?.litres ? <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>+${(ct.litres * (parseFloat(centsPerLitre) || 0)).toFixed(4)} per unit</div> : <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>No litres set on this type</div>; })()}
              </div>
            )}
            <button onClick={applyBulk} disabled={!selCT || selCustomers.length === 0} style={btnStyle(C.green)}>Apply</button>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>
            Customers with active fixed-price contracts will be skipped automatically.
          </div>
          <div style={{ fontSize: 12, marginBottom: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              placeholder="Search customers by name, address, or account #"
              value={bulkSearch}
              onChange={e => setBulkSearch(e.target.value)}
              style={{ ...inputStyle, maxWidth: 320, padding: "6px 10px", fontSize: 12 }}
            />
            <button onClick={toggleAll} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12 }}>
              {selCustomers.length === (customers || []).length ? "Deselect All" : "Select All"}
            </button>
            <span>· {selCustomers.length} selected · {bulkFilteredCustomers.length} shown</span>
          </div>
          <div style={{ maxHeight: 400, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: C.card }}>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: "6px 10px", width: 30 }}></th>
                  <th style={{ padding: "6px 10px", textAlign: "left", color: C.muted, fontWeight: 600 }}>Customer</th>
                  {isAdmin && selCT && <th style={{ padding: "6px 10px", textAlign: "right", color: C.muted, fontWeight: 600 }}>Current Price</th>}
                  {isAdmin && selCT && <th style={{ padding: "6px 10px", textAlign: "center", color: C.muted, fontWeight: 600 }}>Fixed</th>}
                </tr>
              </thead>
              <tbody>
                {bulkFilteredCustomers.map(c => {
                  const pd = selCT ? getCustomerPrice(c.id) : null;
                  return (
                    <tr key={c.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "4px 10px" }}>
                        <input type="checkbox" checked={selCustomers.includes(c.id)} onChange={() => setSelCustomers(s => s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id])} />
                      </td>
                      <td style={{ padding: "4px 10px" }}>
                        {c.account_number && <span style={{ color: C.accent, fontWeight: 600, marginRight: 8 }}>{c.account_number}</span>}
                        <span style={{ fontWeight: c.name ? 600 : 400 }}>{c.name || c.address || "(unnamed)"}</span>
                        {c.name && c.address && <span style={{ color: C.muted, marginLeft: 8, fontSize: 11 }}>— {c.address}</span>}
                      </td>
                      {isAdmin && selCT && (
                        <td style={{ padding: "4px 10px", textAlign: "right", fontWeight: 600, color: pd?.isCustom ? C.accent : C.muted }}>
                          {pd ? fmtCurrency(pd.price) : "—"}
                          {pd?.isCustom && <span style={{ fontSize: 9, marginLeft: 4, color: C.accent }}>●</span>}
                        </td>
                      )}
                      {isAdmin && selCT && (
                        <td style={{ padding: "4px 10px", textAlign: "center" }}>
                          {pd?.isFixed && <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: "#3b82f622", color: C.blue }}>FIXED</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {isAdmin && selCT && (
            <div style={{ marginTop: 8, fontSize: 11, color: C.muted }}>
              <span style={{ color: C.accent }}>●</span> = Custom price · <span style={{ color: C.blue }}>FIXED</span> = Protected from bulk updates
            </div>
          )}
        </Card>
      )}

      {/* ─── CUSTOMER PRICE LIST TAB ─── */}
      {tab === "customer" && (
        <div>
          <Card>
            <label style={labelStyle}>Search Customer</label>
            <div style={{ position: "relative", marginBottom: 12 }}>
              <input
                value={selCustId ? (customers || []).find(c => c.id === selCustId)?.name || "" : custSearch}
                onChange={e => { setCustSearch(e.target.value); setSelCustId(""); setCustPrices([]); }}
                placeholder="Type customer name or address..."
                style={inputStyle}
              />
              {custSearch && !selCustId && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, maxHeight: 200, overflowY: "auto", zIndex: 10 }}>
                  {filteredCustomers.map(c => (
                    <div key={c.id} onClick={() => { loadCustPrices(c.id); setCustSearch(""); }} style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                      <strong>{c.name}</strong> <span style={{ color: C.muted }}>— {c.address}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selCustId && (
              <div style={{ padding: "6px 10px", background: "#22c55e15", borderRadius: 6, fontSize: 13, color: C.green, marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
                <span>Viewing prices for: <strong>{(customers || []).find(c => c.id === selCustId)?.name}</strong></span>
                <button onClick={() => { setSelCustId(""); setCustPrices([]); }} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>✕</button>
              </div>
            )}
          </Card>

          {selCustId && custPrices.length > 0 && (
            <Card>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Price List</div>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Item", "Type", "Default", "Customer Price", "Fixed", "From", "To", "Actions"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {custPrices.map(cp => (
                    <CustPriceRow key={cp.cylinder_type} cp={cp} onSave={saveCustPrice} />
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {/* ─── FORMULA CUSTOMERS TAB ─── */}
      {tab === "formula" && (
        <Card>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
            Customers with <strong>customer type = formula</strong> ({formulaCustomers.length} customers). Apply a per-litre price increase across all or selected formula customers.
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Sale Item (with litres)</label>
              <select value={formulaSelCT} onChange={e => setFormulaSelCT(e.target.value)} style={{ ...inputStyle, width: 240 }}>
                <option value="">Select...</option>
                {(cylinderTypes || []).filter(ct => ct.item_type === "sale" && ct.litres).map(ct => (
                  <option key={ct.id} value={ct.id}>{ct.label} · {ct.litres}L · default {fmtCurrency(ct.default_price)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Cents per litre</label>
              <input type="number" step="0.001" value={formulaCents} onChange={e => setFormulaCents(e.target.value)} style={{ ...inputStyle, width: 140 }} placeholder="e.g. 0.05" />
              {formulaSelCT && formulaCents && (() => {
                const ct = (cylinderTypes || []).find(c => c.id === formulaSelCT);
                return ct?.litres ? <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>+${(ct.litres * (parseFloat(formulaCents) || 0)).toFixed(4)} per unit</div> : null;
              })()}
            </div>
            <button onClick={applyFormulaBulk} disabled={!formulaSelCT || !formulaCents || formulaSelCustomers.length === 0} style={btnStyle(C.green)}>Apply Increase</button>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={toggleAllFormula} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12 }}>
              {formulaSelCustomers.length === formulaCustomers.length ? "Deselect All" : "Select All"}
            </button>
            <span>· {formulaSelCustomers.length} selected · {formulaCustomers.length} formula customers</span>
          </div>
          {formulaCustomers.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13, padding: 16 }}>No customers with customer type "formula" found.</div>
          ) : (
            <div style={{ maxHeight: 400, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: C.card }}>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: "6px 10px", width: 30 }}></th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: C.muted, fontWeight: 600 }}>Customer</th>
                    {formulaSelCT && <th style={{ padding: "6px 10px", textAlign: "right", color: C.muted, fontWeight: 600 }}>Current Price</th>}
                  </tr>
                </thead>
                <tbody>
                  {formulaCustomers.map(c => {
                    const cp = formulaSelCT ? pricingMap[`${c.id}:${formulaSelCT}`] : null;
                    const ct = formulaSelCT ? (cylinderTypes || []).find(x => x.id === formulaSelCT) : null;
                    const displayPrice = cp ? cp.price : ct?.default_price;
                    return (
                      <tr key={c.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "4px 10px" }}>
                          <input type="checkbox" checked={formulaSelCustomers.includes(c.id)} onChange={() => setFormulaSelCustomers(s => s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id])} />
                        </td>
                        <td style={{ padding: "4px 10px" }}>
                          {c.account_number && <span style={{ color: C.accent, fontWeight: 600, marginRight: 8 }}>{c.account_number}</span>}
                          <span style={{ fontWeight: c.name ? 600 : 400 }}>{c.name || c.address || "(unnamed)"}</span>
                          {c.name && c.address && <span style={{ color: C.muted, marginLeft: 8, fontSize: 11 }}>— {c.address}</span>}
                        </td>
                        {formulaSelCT && (
                          <td style={{ padding: "4px 10px", textAlign: "right", fontWeight: 600, color: cp ? C.accent : C.muted }}>
                            {displayPrice != null ? fmtCurrency(displayPrice) : "—"}
                            {cp && <span style={{ fontSize: 9, marginLeft: 4, color: C.accent }}>●</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {formulaSelCT && (
            <div style={{ marginTop: 8, fontSize: 11, color: C.muted }}>
              <span style={{ color: C.accent }}>●</span> = Custom price · Customers with active fixed-price contracts are skipped automatically.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// Individual customer price row with inline editing
function CustPriceRow({ cp, onSave }) {
  const [price, setPrice] = useState(cp.customer_price ?? cp.default_price);
  const [fixed, setFixed] = useState(!!cp.fixed_price);
  const [from, setFrom] = useState(cp.fixed_from || "");
  const [to, setTo] = useState(cp.fixed_to || "");
  const [dirty, setDirty] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const isActive = fixed && from && to && today >= from && today <= to;

  const save = () => {
    onSave(cp.cylinder_type, price, fixed, from, to);
    setDirty(false);
  };

  return (
    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
      <td style={{ padding: "6px 8px", fontWeight: 600 }}>{cp.label}</td>
      <td style={{ padding: "6px 8px" }}>{cp.item_type}</td>
      <td style={{ padding: "6px 8px", color: C.muted }}>{fmtCurrency(cp.default_price)}</td>
      <td style={{ padding: "6px 8px" }}>
        <input type="number" step="0.01" value={price} onChange={e => { setPrice(parseFloat(e.target.value) || 0); setDirty(true); }}
          style={{ ...inputStyle, width: 100, padding: "4px 8px", fontWeight: 600, color: cp.is_custom ? C.accent : C.text }} />
      </td>
      <td style={{ padding: "6px 8px", textAlign: "center" }}>
        <input type="checkbox" checked={fixed} onChange={e => { setFixed(e.target.checked); setDirty(true); }} />
        {isActive && <span style={{ fontSize: 9, color: C.blue, marginLeft: 4 }}>ACTIVE</span>}
      </td>
      <td style={{ padding: "6px 8px" }}>
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); setDirty(true); }} disabled={!fixed}
          style={{ ...inputStyle, width: 130, padding: "3px 6px", fontSize: 11, opacity: fixed ? 1 : 0.4 }} />
      </td>
      <td style={{ padding: "6px 8px" }}>
        <input type="date" value={to} onChange={e => { setTo(e.target.value); setDirty(true); }} disabled={!fixed}
          style={{ ...inputStyle, width: 130, padding: "3px 6px", fontSize: 11, opacity: fixed ? 1 : 0.4 }} />
      </td>
      <td style={{ padding: "6px 8px" }}>
        {dirty && <button onClick={save} style={{ ...btnStyle(C.green), padding: "3px 10px", fontSize: 11 }}>Save</button>}
      </td>
    </tr>
  );
}

// ==================== USERS VIEW ====================
// ==================== ADMINISTRATOR VIEW ====================
// ==================== CREDITS VIEW ====================
function CreditsView({ customers, showToast, userRole }) {
  const [credits, setCredits] = useState([]);
  const [filter, setFilter] = useState("all"); // all | pending | approved | applied | rejected
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ customer_id: "", amount: "", reason: "" });
  const [custSearch, setCustSearch] = useState("");

  const isAdmin = userRole === "admin";

  const load = async () => {
    try {
      const params = filter === "all" ? {} : { status: filter };
      setCredits(await api.getCredits(params));
    } catch (e) { showToast(e.message, "error"); }
  };

  useEffect(() => { load(); }, [filter]);

  const filteredCustomers = useMemo(() => {
    if (!custSearch) return customers || [];
    const s = custSearch.toLowerCase();
    return (customers || []).filter(c =>
      (c.name || "").toLowerCase().includes(s) ||
      (c.account_number || "").toLowerCase().includes(s)
    );
  }, [customers, custSearch]);

  const selectedCustomer = (customers || []).find(c => c.id === form.customer_id);

  const create = async () => {
    try {
      const amt = parseFloat(form.amount);
      if (!form.customer_id) return showToast("Select a customer", "error");
      if (!amt || amt <= 0) return showToast("Amount must be greater than zero", "error");
      if (!form.reason.trim()) return showToast("Reason is required", "error");
      await api.createCredit({ customer_id: form.customer_id, amount: amt, reason: form.reason.trim() });
      showToast("Credit note created — pending approval");
      setForm({ customer_id: "", amount: "", reason: "" });
      setCustSearch("");
      setCreating(false);
      load();
    } catch (e) { showToast(e.message, "error"); }
  };

  const approve = async (id) => {
    if (!confirm("Approve this credit? It will be automatically applied to the customer's oldest open invoices.")) return;
    try {
      await api.approveCredit(id);
      showToast("Credit approved and applied");
      load();
    } catch (e) { showToast(e.message, "error"); }
  };

  const reject = async (id) => {
    if (!confirm("Reject this credit note?")) return;
    try {
      await api.rejectCredit(id);
      showToast("Credit rejected");
      load();
    } catch (e) { showToast(e.message, "error"); }
  };

  const statusBadge = (s) => {
    const colors = {
      pending:  { bg: "#f59e0b22", fg: C.accent },
      approved: { bg: "#3b82f622", fg: C.blue },
      applied:  { bg: "#22c55e22", fg: C.green },
      rejected: { bg: "#ef444422", fg: C.red },
    };
    const c = colors[s] || { bg: C.input, fg: C.muted };
    return <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: c.bg, color: c.fg, textTransform: "uppercase" }}>{s}</span>;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Credit Notes</h2>
        <button onClick={() => setCreating(!creating)} style={btnStyle()}>{creating ? "Cancel" : "+ New Credit Note"}</button>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["all", "pending", "approved", "applied", "rejected"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "6px 12px", borderRadius: 6, border: `1px solid ${filter === f ? C.accent : C.border}`,
            background: filter === f ? "#f59e0b22" : C.card, color: filter === f ? C.accent : C.muted,
            cursor: "pointer", fontSize: 12, fontWeight: 600, textTransform: "uppercase",
          }}>{f}</button>
        ))}
      </div>

      {creating && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>New Credit Note</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Customer Account *</label>
              <div style={{ position: "relative" }}>
                <input
                  value={form.customer_id ? `${selectedCustomer?.account_number || ""} ${selectedCustomer?.name || ""}`.trim() : custSearch}
                  onChange={e => { setCustSearch(e.target.value); setForm(f => ({ ...f, customer_id: "" })); }}
                  placeholder="Search by account number or name..."
                  style={inputStyle}
                />
                {custSearch && !form.customer_id && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, maxHeight: 200, overflowY: "auto", zIndex: 10 }}>
                    {filteredCustomers.slice(0, 20).map(c => (
                      <div key={c.id} onClick={() => { setForm(f => ({ ...f, customer_id: c.id })); setCustSearch(""); }} style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                        <strong style={{ color: C.accent }}>{c.account_number || "—"}</strong> {c.name}
                      </div>
                    ))}
                    {filteredCustomers.length === 0 && <div style={{ padding: "8px 12px", color: C.muted, fontSize: 13 }}>No customers found</div>}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label style={labelStyle}>Amount *</label>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <div style={{ padding: "8px 12px", background: C.input, borderRadius: 6, fontSize: 12, color: C.muted }}>
                Will be created as <strong style={{ color: C.accent }}>PENDING</strong> — requires admin approval.
              </div>
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>Reason *</label>
              <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={3} style={{ ...inputStyle, resize: "vertical" }} placeholder="Why is this credit being issued?" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={create} style={btnStyle(C.green)}>Create Credit</button>
            <button onClick={() => { setCreating(false); setForm({ customer_id: "", amount: "", reason: "" }); }} style={btnStyle(C.muted)}>Cancel</button>
          </div>
        </Card>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Credit #", "Customer", "Amount", "Remaining", "Reason", "Status", "Created By", "Created", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px", color: C.muted, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {credits.map(cn => (
              <tr key={cn.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px", color: C.accent, fontWeight: 600 }}>{cn.credit_number || "—"}</td>
                <td style={{ padding: "8px", fontWeight: 600 }}>
                  {cn.account_number && <span style={{ color: C.muted, fontWeight: 500, marginRight: 6 }}>{cn.account_number}</span>}
                  {cn.customer_name || "—"}
                </td>
                <td style={{ padding: "8px", fontWeight: 700, color: C.green }}>{fmtCurrency(cn.amount)}</td>
                <td style={{ padding: "8px", color: cn.remaining_amount > 0 ? C.accent : C.muted }}>{fmtCurrency(cn.remaining_amount)}</td>
                <td style={{ padding: "8px", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={cn.reason}>{cn.reason || "—"}</td>
                <td style={{ padding: "8px" }}>{statusBadge(cn.status)}</td>
                <td style={{ padding: "8px", color: C.muted }}>{cn.created_by || "—"}</td>
                <td style={{ padding: "8px", color: C.muted }}>{cn.created ? fmtDate(cn.created) : "—"}</td>
                <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                  {cn.status === "pending" && isAdmin && (
                    <>
                      <button onClick={() => approve(cn.id)} style={{ ...btnStyle(C.green), padding: "3px 10px", fontSize: 11, marginRight: 6 }}>Approve</button>
                      <button onClick={() => reject(cn.id)} style={{ ...btnStyle(C.red), padding: "3px 10px", fontSize: 11 }}>Reject</button>
                    </>
                  )}
                  {cn.status === "pending" && !isAdmin && <span style={{ color: C.muted, fontSize: 11 }}>Awaiting admin</span>}
                  {cn.status === "approved" && cn.approved_by && <span style={{ color: C.muted, fontSize: 11 }}>by {cn.approved_by}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {credits.length === 0 && <div style={{ textAlign: "center", padding: 32, color: C.muted }}>No credit notes</div>}
      </div>
    </div>
  );
}

function AdministratorView({ showToast }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rentalStatus, setRentalStatus] = useState(null);
  const [rentalBusy, setRentalBusy] = useState(false);

  // Customer import state
  const [importFileName, setImportFileName] = useState("");
  const [importHeaders, setImportHeaders] = useState([]);
  const [importRows, setImportRows] = useState([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  // Recognized customer field aliases (used to flag unmatched headers)
  const KNOWN_CUSTOMER_HEADERS = new Set([
    "address", "delivery_address", "delivery address",
    "name", "company_name", "company name", "customer_name",
    "contact", "contact_person", "contact person",
    "phone", "telephone", "tel",
    "email", "email_address",
    "notes", "general_notes", "general notes",
    "onedrive_link", "customer_documents", "documents", "onedrive",
    "payment_ref", "payment_reference",
    "account_customer", "account customer", "account",
    "state",
    "accounts_contact", "accounts contact", "account_contact_person",
    "accounts_email", "accounts email",
    "accounts_phone", "accounts phone",
    "compliance_number", "compliance number", "compliance",
    "pressure_test", "pressure test",
    "abn",
    "duration",
    "milk_run_days", "milk run days", "milk_run",
    "milk_run_frequency", "milk run frequency",
    "rental_frequency", "rental frequency",
    "customer_type", "customer type",
    "customer_type_start", "fixed_start", "fixed start date",
    "customer_type_end", "fixed_end", "fixed end date",
    "rep_name", "rep name",
    "payment_terms", "payment terms",
    "customer_category", "customer category", "category",
    "chain",
    "alternative_contact_name", "alt_contact_name", "alternative contact name", "alternate contact name",
    "alternative_contact_phone", "alt_contact_phone", "alternative contact phone", "alternate contact phone",
    "add internal note", "internal note", "internal_note",
    "compliance_not_required", "compliance not required",
    // Recognized but ignored (not stored on the customer record)
    "last price", "last_price",
  ]);

  // Headers that we recognize but deliberately don't import (display-only / derived)
  const IGNORED_CUSTOMER_HEADERS = new Set([
    "last price", "last_price",
  ]);

  const handleFile = (file) => {
    if (!file) return;
    setImportFileName(file.name);
    setImportResult(null);

    const isXlsx = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();

    if (isXlsx) {
      // Parse with SheetJS (loaded from CDN in index.html as window.XLSX)
      reader.onload = () => {
        try {
          if (!window.XLSX) {
            showToast("Spreadsheet library not loaded — refresh the page and try again", "error");
            return;
          }
          const data = new Uint8Array(reader.result);
          const wb = window.XLSX.read(data, { type: "array" });
          const sheetName = wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          // header: 1 → array of arrays. defval: '' → blank cells become empty strings.
          const aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false, raw: false });
          if (aoa.length === 0) { setImportHeaders([]); setImportRows([]); return; }
          const headers = aoa[0].map(h => String(h || "").trim());
          const rows = [];
          for (let r = 1; r < aoa.length; r++) {
            const rec = aoa[r];
            if (!rec || rec.every(c => String(c || "").trim() === "")) continue;
            const obj = {};
            for (let c = 0; c < headers.length; c++) {
              const key = headers[c].toLowerCase();
              if (!key) continue;
              obj[key] = (rec[c] !== undefined && rec[c] !== null ? String(rec[c]) : "").trim();
            }
            rows.push(obj);
          }
          setImportHeaders(headers);
          setImportRows(rows);
        } catch (err) {
          showToast("Failed to parse spreadsheet: " + err.message, "error");
          setImportHeaders([]); setImportRows([]);
        }
      };
      reader.onerror = () => showToast("Failed to read file", "error");
      reader.readAsArrayBuffer(file);
    } else {
      // CSV path (text)
      reader.onload = () => {
        try {
          const { headers, rows } = parseCSV(String(reader.result || ""));
          setImportHeaders(headers);
          setImportRows(rows);
        } catch (err) {
          showToast("Failed to parse CSV: " + err.message, "error");
          setImportHeaders([]); setImportRows([]);
        }
      };
      reader.onerror = () => showToast("Failed to read file", "error");
      reader.readAsText(file);
    }
  };

  const onFileChange = (e) => handleFile(e.target.files?.[0]);

  const clearImport = () => {
    setImportFileName("");
    setImportHeaders([]);
    setImportRows([]);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const runImport = async () => {
    if (importRows.length === 0) return;
    if (!confirm(`Import ${importRows.length} row(s)? Existing customers (matched by delivery address) will be updated in place.`)) return;
    setImportBusy(true);
    try {
      const r = await api.importCustomers(importRows);
      setImportResult(r);
      showToast(`Import complete: ${r.created} created, ${r.updated} updated, ${r.skipped} skipped`);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setImportBusy(false);
    }
  };

  useEffect(() => {
    api.getSettings().then(s => { setSettings(s || {}); setLoading(false); }).catch(e => { showToast(e.message, "error"); setLoading(false); });
  }, []);

  const update = (key, value) => setSettings(p => ({ ...p, [key]: value }));

  const save = async () => {
    try {
      const payload = {
        customer_seq_prefix: settings.customer_seq_prefix || "",
        customer_seq_padding: String(parseInt(settings.customer_seq_padding, 10) || 5),
        customer_seq_next: String(parseInt(settings.customer_seq_next, 10) || 1),
        order_seq_prefix: settings.order_seq_prefix || "",
        order_seq_padding: String(parseInt(settings.order_seq_padding, 10) || 5),
        order_seq_next: String(parseInt(settings.order_seq_next, 10) || 1),
        business_name: settings.business_name || "",
        business_abn: settings.business_abn || "",
        business_address: settings.business_address || "",
        business_phone: settings.business_phone || "",
        business_email: settings.business_email || "",
        business_bank: settings.business_bank || "",
        business_logo: settings.business_logo || "",
      };
      await api.updateSettings(payload);
      showToast("Settings saved");
    } catch (e) { showToast(e.message, "error"); }
  };

  const initializeRentals = async () => {
    if (!confirm("Seed rental cycles for all account customers based on their most recent rental delivery? This is safe to run repeatedly — it only touches customers with no next rental date set.")) return;
    setRentalBusy(true);
    try {
      const r = await api.initializeRentals();
      setRentalStatus({ kind: "init", ...r });
      showToast(`Initialized ${r.seeded} customer(s)`);
    } catch (e) { showToast(e.message, "error"); }
    finally { setRentalBusy(false); }
  };

  const runDueRentals = async () => {
    if (!confirm("Run the due-rentals job now? Any customer whose next rental date has arrived will be billed immediately.")) return;
    setRentalBusy(true);
    try {
      const r = await api.runDueRentals();
      setRentalStatus({ kind: "run", ...r });
      showToast(`Billed ${r.customersBilled} customer(s), created ${r.invoicesCreated} invoice line(s)`);
    } catch (e) { showToast(e.message, "error"); }
    finally { setRentalBusy(false); }
  };

  if (loading || !settings) return <div style={{ color: C.muted }}>Loading...</div>;

  const preview = (prefix, padding, next) => {
    const p = parseInt(padding, 10) || 5;
    const n = parseInt(next, 10) || 1;
    return (prefix || "") + String(n).padStart(p, "0");
  };

  const SeqEditor = ({ title, prefixKey, paddingKey, nextKey }) => (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 12 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Prefix</label>
          <input value={settings[prefixKey] || ""} onChange={e => update(prefixKey, e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Padding (digits)</label>
          <input type="number" min="1" max="12" value={settings[paddingKey] || ""} onChange={e => update(paddingKey, e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Next Number</label>
          <input type="number" min="1" value={settings[nextKey] || ""} onChange={e => update(nextKey, e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: C.muted }}>
        Next will be: <span style={{ color: C.accent, fontWeight: 700, fontFamily: "monospace" }}>
          {preview(settings[prefixKey], settings[paddingKey], settings[nextKey])}
        </span>
      </div>
    </Card>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Administrator</h2>
        <button onClick={save} style={btnStyle(C.green)}>Save Changes</button>
      </div>

      {/* Business / Invoice settings */}
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Business Details</h3>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
        These details appear on printed/PDF invoices. Leave blank to omit.
      </div>
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          {/* Logo upload — spans both columns, sits at the top */}
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "flex-start", gap: 20, padding: "12px 14px", background: C.input, borderRadius: 8, border: `1px solid ${C.inputBorder}` }}>
            <div style={{ flexShrink: 0 }}>
              {settings.business_logo ? (
                <img
                  src={settings.business_logo}
                  alt="Business logo"
                  style={{ maxHeight: 80, maxWidth: 200, objectFit: "contain", borderRadius: 4, background: "#fff", padding: 4 }}
                />
              ) : (
                <div style={{ width: 160, height: 72, borderRadius: 6, border: `2px dashed ${C.inputBorder}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12 }}>
                  No logo
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Business Logo</label>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                PNG, JPG or SVG — recommended max width 400px. Appears top-left on printed invoices.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label style={{ ...btnStyle(C.blue), padding: "6px 14px", fontSize: 12, cursor: "pointer", display: "inline-block" }}>
                  {settings.business_logo ? "Replace Logo" : "Upload Logo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/gif,image/webp"
                    style={{ display: "none" }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 2 * 1024 * 1024) { showToast("Logo must be under 2 MB", "error"); return; }
                      const reader = new FileReader();
                      reader.onload = ev => update("business_logo", ev.target.result);
                      reader.readAsDataURL(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {settings.business_logo && (
                  <button
                    onClick={() => { if (confirm("Remove the logo?")) update("business_logo", ""); }}
                    style={{ ...btnStyle(C.red), padding: "6px 14px", fontSize: 12 }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Business Name</label>
            <input value={settings.business_name || ""} onChange={e => update("business_name", e.target.value)} style={inputStyle} placeholder="e.g. Acme Gas Pty Ltd" />
          </div>
          <div>
            <label style={labelStyle}>ABN</label>
            <input value={settings.business_abn || ""} onChange={e => update("business_abn", e.target.value)} style={inputStyle} placeholder="12 345 678 901" />
          </div>
          <div>
            <label style={labelStyle}>Phone</label>
            <input value={settings.business_phone || ""} onChange={e => update("business_phone", e.target.value)} style={inputStyle} placeholder="(07) 1234 5678" />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input value={settings.business_email || ""} onChange={e => update("business_email", e.target.value)} style={inputStyle} placeholder="accounts@yourbusiness.com.au" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Address</label>
            <input value={settings.business_address || ""} onChange={e => update("business_address", e.target.value)} style={inputStyle} placeholder="123 Main St, Brisbane QLD 4000" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Bank / Payment Details <span style={{ color: C.muted, fontWeight: 400, textTransform: "none" }}>(shown at bottom of invoice — use line breaks for BSB, account, etc.)</span></label>
            <textarea
              value={settings.business_bank || ""}
              onChange={e => update("business_bank", e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
              placeholder={"BSB: 123-456\nAccount: 789 012 345\nAccount Name: Acme Gas Pty Ltd"}
            />
          </div>
        </div>
      </Card>

      <h3 style={{ fontSize: 16, fontWeight: 700, margin: "20px 0 8px" }}>Number Sequences</h3>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
        New customers and orders will be assigned the next number automatically and the counter will increment.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <SeqEditor title="Customer Number Sequence" prefixKey="customer_seq_prefix" paddingKey="customer_seq_padding" nextKey="customer_seq_next" />
        <SeqEditor title="Order Number Sequence" prefixKey="order_seq_prefix" paddingKey="order_seq_padding" nextKey="order_seq_next" />
      </div>

      {/* Rental cycle controls */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Rental Cycles</h3>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
          The scheduler runs automatically every 6 hours and bills any account customer whose next rental date has arrived.
          Use these controls to seed cycles for existing customers or to run the job on demand.
        </div>
        <Card>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button onClick={initializeRentals} disabled={rentalBusy} style={{ ...btnStyle(C.blue), opacity: rentalBusy ? 0.6 : 1 }}>
              Initialize Rental Cycles
            </button>
            <button onClick={runDueRentals} disabled={rentalBusy} style={{ ...btnStyle(C.accent), opacity: rentalBusy ? 0.6 : 1 }}>
              Run Due Rentals Now
            </button>
          </div>
          {rentalStatus && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: C.input, borderRadius: 6, fontSize: 12, color: C.text }}>
              {rentalStatus.kind === "init" ? (
                <div><strong style={{ color: C.blue }}>Initialize:</strong> seeded next rental date for <strong>{rentalStatus.seeded}</strong> customer(s).</div>
              ) : (
                <>
                  <div><strong style={{ color: C.accent }}>Run due rentals:</strong> billed <strong>{rentalStatus.customersBilled}</strong> customer(s), created <strong>{rentalStatus.invoicesCreated}</strong> invoice line(s).</div>
                  {rentalStatus.errors?.length > 0 && (
                    <div style={{ marginTop: 6, color: C.red }}>
                      {rentalStatus.errors.length} error(s): {rentalStatus.errors.map(e => e.error).join("; ")}
                    </div>
                  )}
                  {rentalStatus.ranAt && <div style={{ marginTop: 4, color: C.muted }}>Ran at {fmtDateTime(rentalStatus.ranAt)}</div>}
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Import Customers */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Import Customers</h3>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
          Upload a CSV. The first row must be a header row. Delivery address is required for every row.
          Existing customers are matched by address (case-insensitive) and updated in place — order history, balance and account number are preserved.
          New addresses get a fresh account number from the sequence.
        </div>
        <Card>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFileChange} style={{ fontSize: 12, color: C.text }} />
            {importFileName && (
              <button onClick={clearImport} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>Clear</button>
            )}
          </div>

          {importRows.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                <strong style={{ color: C.text }}>{importFileName}</strong> · {importRows.length} row{importRows.length === 1 ? "" : "s"} · {importHeaders.length} column{importHeaders.length === 1 ? "" : "s"}
              </div>

              {/* Headers row with recognized/ignored/unknown markers */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {importHeaders.map(h => {
                  const lc = h.toLowerCase();
                  const ignored = IGNORED_CUSTOMER_HEADERS.has(lc);
                  const recognized = KNOWN_CUSTOMER_HEADERS.has(lc);
                  let bg, fg, label, title;
                  if (ignored) {
                    bg = "#6b728022"; fg = C.muted; label = `${h} (ignored)`;
                    title = "Recognized but not stored — derived from order history";
                  } else if (recognized) {
                    bg = "#22c55e22"; fg = C.green; label = h;
                    title = "Recognized";
                  } else {
                    bg = "#f59e0b22"; fg = C.accent; label = `${h} ⚠`;
                    title = "Not a known customer field — will be ignored";
                  }
                  return (
                    <span key={h} style={{
                      padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: bg, color: fg, border: `1px solid ${fg}`,
                    }} title={title}>
                      {label}
                    </span>
                  );
                })}
              </div>

              {/* Validation: missing address column */}
              {!importHeaders.some(h => ["address", "delivery_address", "delivery address"].includes(h.toLowerCase())) && (
                <div style={{ padding: "8px 12px", background: "#ef444422", border: `1px solid ${C.red}`, borderRadius: 6, color: C.red, fontSize: 12, marginBottom: 12 }}>
                  ⚠ No delivery address column found. The file must include an "address" or "delivery_address" column.
                </div>
              )}

              {/* Preview first 5 rows */}
              <div style={{ marginBottom: 12, fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase" }}>Preview (first 5 rows)</div>
              <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: C.panel, borderBottom: `1px solid ${C.border}` }}>
                      {importHeaders.map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "4px 8px", color: C.muted, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 5).map((row, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        {importHeaders.map(h => (
                          <td key={h} style={{ padding: "4px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {row[h.toLowerCase()] || <span style={{ color: C.muted }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={runImport}
                disabled={importBusy || !importHeaders.some(h => ["address", "delivery_address", "delivery address"].includes(h.toLowerCase()))}
                style={{ ...btnStyle(C.green), marginTop: 12, opacity: importBusy ? 0.6 : 1 }}
              >
                {importBusy ? "Importing..." : `Import ${importRows.length} Row${importRows.length === 1 ? "" : "s"}`}
              </button>
            </div>
          )}

          {importResult && (
            <div style={{ marginTop: 16, padding: "10px 12px", background: C.input, borderRadius: 6, fontSize: 12 }}>
              <div style={{ marginBottom: 6 }}>
                <strong style={{ color: C.green }}>{importResult.created}</strong> created ·{" "}
                <strong style={{ color: C.blue }}>{importResult.updated}</strong> updated ·{" "}
                <strong style={{ color: importResult.skipped > 0 ? C.red : C.muted }}>{importResult.skipped}</strong> skipped
                {" "}<span style={{ color: C.muted }}>(of {importResult.total} total)</span>
              </div>
              {importResult.errors?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: C.red, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
                    Errors ({importResult.errors.length})
                  </div>
                  <div style={{ maxHeight: 200, overflowY: "auto", background: C.card, borderRadius: 4, padding: 8 }}>
                    {importResult.errors.slice(0, 50).map((e, i) => (
                      <div key={i} style={{ fontSize: 11, color: C.muted, padding: "2px 0" }}>
                        Row {e.row}: {e.address ? <strong style={{ color: C.text }}>{e.address}</strong> : <em>(no address)</em>} — {e.reason}
                      </div>
                    ))}
                    {importResult.errors.length > 50 && (
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 4, fontStyle: "italic" }}>
                        ... and {importResult.errors.length - 50} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Backup & Restore — added for step 4 compliance work */}
      <BackupRestore showToast={showToast} />

      {/* Email Log */}
      <EmailLogSection showToast={showToast} />
    </div>
  );
}

function EmailLogSection({ showToast }) {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all"); // all | sent | error | skipped

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getEmailLog(200);
      setLog(r || []);
    } catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return log;
    return log.filter(r => r.status === statusFilter);
  }, [log, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: log.length, sent: 0, error: 0, skipped: 0 };
    for (const r of log) {
      if (c[r.status] !== undefined) c[r.status]++;
    }
    return c;
  }, [log]);

  const statusBadge = (status) => {
    const map = {
      sent:    { bg: "#22c55e22", fg: C.green },
      error:   { bg: "#ef444422", fg: C.red },
      skipped: { bg: "#6b728022", fg: C.muted },
    };
    const c = map[status] || { bg: C.input, fg: C.muted };
    return (
      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: c.bg, color: c.fg, textTransform: "uppercase" }}>
        {status}
      </span>
    );
  };

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Email Log</h3>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
        Audit trail of every email send attempt. Shows recipient, status, and any error messages from the email provider.
      </div>
      <Card>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          {[
            { id: "all", label: `All (${counts.all})`, color: C.muted },
            { id: "sent", label: `Sent (${counts.sent})`, color: C.green },
            { id: "error", label: `Errors (${counts.error})`, color: C.red },
            { id: "skipped", label: `Skipped (${counts.skipped})`, color: C.muted },
          ].map(chip => {
            const active = statusFilter === chip.id;
            return (
              <button
                key={chip.id}
                onClick={() => setStatusFilter(chip.id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: `1px solid ${active ? chip.color : C.border}`,
                  background: active ? `${chip.color}22` : C.card,
                  color: active ? chip.color : C.muted,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {chip.label}
              </button>
            );
          })}
          <button onClick={load} disabled={loading} style={{ ...btnStyle(C.blue), padding: "6px 12px", fontSize: 12, marginLeft: "auto" }}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>
            {loading ? "Loading..." : "No email log entries yet"}
          </div>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: 420 }}>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: C.card }}>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["Sent At", "Status", "Invoice #", "Customer", "Recipient", "Subject", "Error"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 8px", color: C.muted, whiteSpace: "nowrap" }}>{r.sent_at}</td>
                    <td style={{ padding: "6px 8px" }}>{statusBadge(r.status)}</td>
                    <td style={{ padding: "6px 8px", color: C.accent, fontWeight: 600 }}>{r.invoice_number || "—"}</td>
                    <td style={{ padding: "6px 8px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.customer_name || "—"}</td>
                    <td style={{ padding: "6px 8px", color: C.text, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.recipient || "—"}</td>
                    <td style={{ padding: "6px 8px", color: C.muted, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subject || "—"}</td>
                    <td style={{ padding: "6px 8px", color: C.red, fontSize: 10, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.error || ""}>{r.error || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function UsersView({ showToast }) {
  const users = useApi(() => api.getUsers());
  const [form, setForm] = useState({ username: "", password: "", role: "user" });
  const [adding, setAdding] = useState(false);

  const addUser = async () => {
    try {
      await api.addUser(form.username, form.password, form.role);
      users.reload();
      setForm({ username: "", password: "", role: "user" });
      setAdding(false);
      showToast("User added");
    } catch (e) { showToast(e.message, "error"); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Manage Users</h2>
        <button onClick={() => setAdding(!adding)} style={btnStyle()}>{adding ? "Cancel" : "+ Add User"}</button>
      </div>
      {adding && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <input placeholder="Username" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} style={inputStyle} />
            <input placeholder="Password" type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} style={inputStyle} />
            <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} style={{ ...inputStyle, width: 120 }}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button onClick={addUser} style={btnStyle(C.green)}>Add</button>
          </div>
        </Card>
      )}
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
          {["Username", "Role", "Created"].map(h => <th key={h} style={{ textAlign: "left", padding: "8px", color: C.muted }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {(users.data || []).map(u => (
            <tr key={u.id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px", fontWeight: 600 }}>{u.username}</td>
              <td style={{ padding: "8px" }}><span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: u.role === "admin" ? "#f59e0b22" : "#3b82f622", color: u.role === "admin" ? C.accent : C.blue }}>{u.role}</span></td>
              <td style={{ padding: "8px", color: C.muted }}>{u.created}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==================== MAIN APP ====================
export default function App() {
  const [authState, setAuthState] = useState("loading"); // loading | setup | login | app
  const [user, setUser] = useState(null);
  const [view, setView] = useState("dashboard");
  const [pendingOrderId, setPendingOrderId] = useState(null);
  const [pendingNewOrderCustomerId, setPendingNewOrderCustomerId] = useState(null);
  // 3.0.18: global search — results + selection for navigation
  const [globalSearchResults, setGlobalSearchResults] = useState(null);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [globalSearch, setGlobalSearch] = useState("");

  // 3.0.18: debounced global search — fires api.search(q) 250ms after typing stops.
  useEffect(() => {
    const q = globalSearch.trim();
    if (!q) { setGlobalSearchResults(null); setGlobalSearchLoading(false); return; }
    setGlobalSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.search(q);
        setGlobalSearchResults(res);
      } catch (e) {
        setGlobalSearchResults({ customers: [], orders: [], transactions: [] });
      } finally {
        setGlobalSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [globalSearch]);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailConfig, setEmailConfig] = useState(null);

  const customers = useApi(() => api.getCustomers());
  const cylinderTypes = useApi(() => api.getCylinderTypes());
  const stats = useApi(() => api.getStats());

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const refreshAll = () => {
    customers.reload();
    cylinderTypes.reload();
    stats.reload();
  };

  // Check auth on mount
  useEffect(() => {
    setAuthFailHandler(() => setAuthState("login"));
    api.authStatus().then(r => {
      if (r.needsSetup) setAuthState("setup");
      else if (r.user) { setUser(r.user); setAuthState("app"); }
      else setAuthState("login");
    }).catch(() => setAuthState("login"));
  }, []);

  // Load email config once authed (so we know whether to show backend Email buttons)
  useEffect(() => {
    if (authState !== "app") return;
    api.getEmailConfig()
      .then(cfg => { setEmailConfig(cfg); setEmailEnabled(!!cfg?.enabled); })
      .catch(() => { setEmailConfig(null); setEmailEnabled(false); });
  }, [authState]);

  const logout = async () => {
    await api.logout();
    setUser(null);
    setAuthState("login");
  };

  if (authState === "loading") return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: C.bg, color: C.muted }}>Loading...</div>;
  if (authState === "setup") return <SetupScreen onDone={u => { setUser(u); setAuthState("app"); }} />;
  if (authState === "login") return <LoginScreen onDone={u => { setUser(u); setAuthState("app"); }} />;

 const isAdmin = user?.role === "admin";

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: Icons.dashboard },
    { id: "orders", label: "Orders", icon: Icons.route },
    { id: "customers", label: "Customers", icon: Icons.customers },
    { id: "cylindertypes", label: "Cylinder Types", icon: Icons.settings },
    { id: "optimoroute", label: "OptimoRoute", icon: Icons.sync },
    { id: "delivery", label: "Deliver / Return", icon: Icons.delivery },
    { id: "tracking", label: "Cylinder Tracking", icon: Icons.cylinders },
    { id: "openingbalances", label: "Opening Balances", icon: Icons.cylinders },
    { id: "billing", label: "Billing", icon: Icons.billing },
    { id: "rentalhistory", label: "Rental History", icon: Icons.billing },
    { id: "credits", label: "Credit Notes", icon: Icons.billing },
    ...(isAdmin ? [{ id: "pricing", label: "Pricing Manager", icon: Icons.pricing }] : []),
    ...(isAdmin ? [{ id: "users", label: "Manage Users", icon: Icons.users }] : []),
    ...(isAdmin ? [{ id: "auditlog", label: "Audit Log", icon: Icons.settings }] : []),
    ...(isAdmin ? [{ id: "administrator", label: "Administrator", icon: Icons.settings }] : []),
  ];

  const renderView = () => {
    switch (view) {
      case "dashboard": return <DashboardView stats={stats.data} />;
      case "orders": return <OrdersView customers={customers.data || []} cylinderTypes={cylinderTypes.data || []} showToast={showToast} reloadCustomers={customers.reload} pendingOrderId={pendingOrderId} onPendingOrderHandled={() => setPendingOrderId(null)} pendingNewOrderCustomerId={pendingNewOrderCustomerId} onPendingNewOrderHandled={() => setPendingNewOrderCustomerId(null)} />;
      case "customers": return <CustomersView customers={customers.data} reload={customers.reload} showToast={showToast} onOpenOrder={(orderId, customerId) => { if (orderId) { setPendingOrderId(orderId); } else { setPendingNewOrderCustomerId(customerId); } setView("orders"); }} cylinderTypes={cylinderTypes.data || []} userRole={user?.role} />;
      case "cylindertypes": return <CylinderTypesView cylinderTypes={cylinderTypes.data} reload={cylinderTypes.reload} showToast={showToast} />;
      case "delivery": return <DeliveryView customers={customers.data} cylinderTypes={cylinderTypes.data} showToast={showToast} refreshAll={refreshAll} />;
      case "tracking": return <TrackingView customers={customers.data} cylinderTypes={cylinderTypes.data} />;
      case "billing": return <BillingView customers={customers.data} cylinderTypes={cylinderTypes.data} showToast={showToast} reloadCustomers={customers.reload} emailEnabled={emailEnabled} emailConfig={emailConfig} />;
      case "rentalhistory": return <RentalHistoryView customers={customers.data || []} cylinderTypes={cylinderTypes.data || []} showToast={showToast} emailEnabled={emailEnabled} emailConfig={emailConfig} />;
      case "pricing": return isAdmin ? <PricingView customers={customers.data} cylinderTypes={cylinderTypes.data} showToast={showToast} userRole={user?.role} /> : null;
      case "openingbalances": return <OpeningBalancesView customers={customers.data || []} cylinderTypes={cylinderTypes.data || []} showToast={showToast} />;
      case "optimoroute": return <OptimoRouteView customers={customers.data || []} cylinderTypes={cylinderTypes.data || []} showToast={showToast} refreshAll={refreshAll} />;
      case "users": return isAdmin ? <UsersView showToast={showToast} /> : null;
      case "credits": return <CreditsView customers={customers.data || []} showToast={showToast} userRole={user?.role} />;
      case "auditlog": return user?.role === "admin" ? <AuditLogView showToast={showToast} /> : null;
      case "administrator": return user?.role === "admin" ? <AdministratorView showToast={showToast} /> : null;
      default: return null;
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: C.bg, color: C.text }}>
      {/* SIDEBAR */}
      <nav style={{ width: 240, background: C.panel, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px 20px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #f59e0b, #ef4444)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: "#fff" }}>CT</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>CylinderTrack</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>Gas Rental Manager</div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: "12px 12px 4px", position: "relative" }}>
          <input
            placeholder="Search orders, POs, customers..."
            value={globalSearch}
            onChange={e => { setGlobalSearch(e.target.value); setGlobalSearchOpen(true); }}
            onFocus={() => setGlobalSearchOpen(true)}
            onBlur={() => setTimeout(() => setGlobalSearchOpen(false), 200)}
            style={{ ...inputStyle, fontSize: 12, padding: "6px 10px", width: "100%" }}
          />
          {globalSearchOpen && globalSearch.trim() && (
            <div style={{ position: "absolute", top: "100%", left: 12, right: 12, background: "#1a1d24", border: `1px solid ${C.border}`, borderRadius: 6, marginTop: 4, maxHeight: 400, overflowY: "auto", zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
              {globalSearchLoading && (
                <div style={{ padding: "10px 12px", color: C.muted, fontSize: 11 }}>Searching…</div>
              )}
              {!globalSearchLoading && globalSearchResults && (
                <>
                  {(globalSearchResults.customers || []).length === 0 && (globalSearchResults.orders || []).length === 0 && (
                    <div style={{ padding: "10px 12px", color: C.muted, fontSize: 11 }}>No matches</div>
                  )}
                  {(globalSearchResults.customers || []).length > 0 && (
                    <div>
                      <div style={{ padding: "6px 12px", fontSize: 10, textTransform: "uppercase", color: C.muted, background: "#15171d", letterSpacing: 0.5 }}>
                        Customers ({globalSearchResults.customers.length})
                      </div>
                      {globalSearchResults.customers.slice(0, 10).map(c => (
                        <div key={c.id}
                          onMouseDown={() => { setView("customers"); setGlobalSearchOpen(false); setGlobalSearch(""); }}
                          style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{formatCustomerDisplay(c) || "(no name)"}</div>
                          <div style={{ fontSize: 10, color: C.muted }}>
                            {[c.account_number, c.address].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(globalSearchResults.orders || []).length > 0 && (
                    <div>
                      <div style={{ padding: "6px 12px", fontSize: 10, textTransform: "uppercase", color: C.muted, background: "#15171d", letterSpacing: 0.5 }}>
                        Orders ({globalSearchResults.orders.length})
                      </div>
                      {globalSearchResults.orders.slice(0, 10).map(o => (
                        <div key={o.id}
                          onMouseDown={() => { setView("orders"); setGlobalSearchOpen(false); setGlobalSearch(""); }}
                          style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                            {o.order_number}{o.po_number ? ` · PO ${o.po_number}` : ""}
                          </div>
                          <div style={{ fontSize: 10, color: C.muted }}>
                            {[o.customer_name, o.order_date, o.status].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: "4px 8px", flex: 1, overflowY: "auto" }}>
          {navItems.map(item => {
            const active = view === item.id;
            return (
              <button key={item.id} onClick={() => setView(item.id)} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", marginBottom: 2,
                background: active ? "#23262f" : "transparent", border: "none", borderRadius: 8, cursor: "pointer",
                color: active ? C.accent : "#9ca3af", fontSize: 13, fontWeight: active ? 700 : 500, transition: "all 0.15s",
              }}>
                {item.icon} {item.label}
                {item.id === "optimoroute" && <span style={{ marginLeft: "auto", fontSize: 9, padding: "2px 5px", borderRadius: 4, background: "#8b5cf622", color: C.purple, fontWeight: 700 }}>API</span>}
              </button>
            );
          })}
        </div>

        {/* User info */}
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.username}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{user?.role}</div>
          </div>
          <button onClick={logout} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 11 }}>Sign out</button>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main style={{ flex: 1, overflowY: "auto", padding: 32 }}>
        {renderView()}
      </main>

      {/* TOAST */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 8,
          background: toast.type === "error" ? C.red : C.green, color: "#fff", fontWeight: 600, fontSize: 13,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)", zIndex: 1000,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
