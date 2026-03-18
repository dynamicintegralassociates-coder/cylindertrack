import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import api, { setAuthFailHandler } from "./api";

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
const fmtCurrency = (v) => `$${(v || 0).toFixed(2)}`;

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
                    <td style={{ padding: "6px 8px", color: C.muted }}>{new Date(l.created).toLocaleString()}</td>
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
    return customers.filter(c => c.name.toLowerCase().includes(s) || c.address.toLowerCase().includes(s));
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
            Last sync: {new Date(stats.optimoroute.last_sync.created).toLocaleString()} · {stats.optimoroute.total_imported} total imported
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
                  <td style={{ padding: "4px 8px", fontWeight: 600 }}>{o.customer_name || o.customer_name_lookup || "—"}</td>
                  <td style={{ padding: "4px 8px" }}>{o.order_detail || "—"}</td>
                  <td style={{ padding: "4px 8px" }}>{o.unit_price ? fmtCurrency(o.unit_price) : "—"}</td>
                  <td style={{ padding: "4px 8px", color: C.green, fontWeight: 600 }}>{o.total_price ? fmtCurrency(o.total_price) : "—"}</td>
                  <td style={{ padding: "4px 8px" }}>{o.payment || "—"}</td>
                  <td style={{ padding: "4px 8px" }}>
                    <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: o.status === "completed" ? "#22c55e22" : o.status === "confirmed" ? "#3b82f622" : "#f59e0b22",
                      color: o.status === "completed" ? C.green : o.status === "confirmed" ? C.blue : C.accent,
                    }}>{o.status}</span>
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
function CustomersView({ customers, reload, showToast }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", contact: "", phone: "", email: "", address: "", notes: "", onedrive_link: "", payment_ref: "", cc_number: "", account_customer: false });
  const [search, setSearch] = useState("");

  const startEdit = (c) => {
    setEditing(c?.id || "new");
    setForm(c ? { name: c.name, contact: c.contact, phone: c.phone, email: c.email, address: c.address, notes: c.notes, onedrive_link: c.onedrive_link || "", payment_ref: c.payment_ref || "", cc_number: "", account_customer: !!c.account_customer } : { name: "", contact: "", phone: "", email: "", address: "", notes: "", onedrive_link: "", payment_ref: "", cc_number: "", account_customer: false });
  };

  const save = async () => {
    try {
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

  const filtered = useMemo(() => {
    if (!search) return customers || [];
    const s = search.toLowerCase();
    return (customers || []).filter(c => c.name.toLowerCase().includes(s) || c.address.toLowerCase().includes(s) || c.contact.toLowerCase().includes(s));
  }, [customers, search]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Customers</h2>
        <button onClick={() => startEdit(null)} style={btnStyle()}>+ Add Customer</button>
      </div>
      <input placeholder="Search by name, address, contact..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, marginBottom: 16, maxWidth: 400 }} />

      {editing && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>{editing === "new" ? "New Customer" : "Edit Customer"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[["name", "Company Name *"], ["contact", "Contact Person"], ["phone", "Phone"], ["email", "Email"], ["address", "Delivery Address"]].map(([key, lbl]) => (
              <div key={key} style={key === "address" ? { gridColumn: "1/-1" } : {}}>
                <label style={labelStyle}>{lbl}</label>
                <input value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} style={inputStyle} />
              </div>
            ))}
            <div style={{ gridColumn: "1/-1" }}>
              <label style={labelStyle}>OneDrive Folder Link</label>
              <input value={form.onedrive_link} onChange={e => setForm(p => ({ ...p, onedrive_link: e.target.value }))} placeholder="https://onedrive.live.com/..." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Payment Reference</label>
              <input value={form.payment_ref} onChange={e => setForm(p => ({ ...p, payment_ref: e.target.value }))} placeholder="e.g. Visa 4521, CC on file, Cash" style={inputStyle} />
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
              {editing !== "new" && customers?.find(c => c.id === editing)?.cc_masked && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Current: {customers.find(c => c.id === editing).cc_masked}</div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Notes</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div style={{ gridColumn: "1/-1", display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
              <input type="checkbox" id="account_cust" checked={form.account_customer} onChange={e => setForm(p => ({ ...p, account_customer: e.target.checked }))} />
              <label htmlFor="account_cust" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Account Customer</label>
              <span style={{ fontSize: 11, color: C.muted }}>(rental cylinder tracking & billing)</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={save} style={btnStyle(C.green)}>Save</button>
            <button onClick={() => setEditing(null)} style={btnStyle(C.muted)}>Cancel</button>
          </div>
        </Card>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Address", "Company", "Contact", "Phone", "Acct", "CC on File", "OneDrive", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px", color: C.muted, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px", color: C.accent, fontWeight: 500 }}>{c.address || "—"}</td>
                <td style={{ padding: "8px", fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: "8px" }}>{c.contact}</td>
                <td style={{ padding: "8px" }}>{c.phone}</td>
                <td style={{ padding: "8px" }}>
                  {c.account_customer ? <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: "#3b82f622", color: C.blue }}>ACC</span> : "—"}
                </td>
                <td style={{ padding: "8px" }}>
                  {c.cc_masked ? <CCReveal customerId={c.id} masked={c.cc_masked} /> : <span style={{ color: C.muted }}>—</span>}
                </td>
                <td style={{ padding: "8px" }}>
                  {c.onedrive_link ? <a href={c.onedrive_link} target="_blank" rel="noreferrer" style={{ color: C.blue, textDecoration: "none", fontWeight: 600 }}>OneDrive ↗</a> : "—"}
                </td>
                <td style={{ padding: "8px" }}>
                  <button onClick={() => startEdit(c)} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12, marginRight: 8 }}>Edit</button>
                  <button onClick={() => del(c.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12 }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={{ textAlign: "center", padding: 32, color: C.muted }}>No customers found</div>}
      </div>
    </div>
  );
}

// ==================== CYLINDER TYPES VIEW ====================
function CylinderTypesView({ cylinderTypes, reload, showToast }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ label: "", default_price: 0, gas_group: "", item_type: "cylinder", sort_order: 0 });

  const startEdit = (ct) => {
    setEditing(ct?.id || "new");
    setForm(ct || { label: "", default_price: 0, gas_group: "", item_type: "cylinder", sort_order: 0 });
  };

  const save = async () => {
    try {
      if (editing === "new") await api.createCylinderType(form);
      else await api.updateCylinderType(editing, form);
      reload(); setEditing(null);
      showToast(editing === "new" ? "Type created" : "Type updated");
    } catch (e) { showToast(e.message, "error"); }
  };

  const del = async (id) => {
    if (!confirm("Delete this cylinder type?")) return;
    try { await api.deleteCylinderType(id); reload(); showToast("Type deleted"); }
    catch (e) { showToast(e.message, "error"); }
  };

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
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={save} style={btnStyle(C.green)}>Save</button>
            <button onClick={() => setEditing(null)} style={btnStyle(C.muted)}>Cancel</button>
          </div>
        </Card>
      )}
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
          {["Label", "Default Price", "Gas Group", "Type", "Actions"].map(h => <th key={h} style={{ textAlign: "left", padding: "8px", color: C.muted, fontWeight: 600 }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {(cylinderTypes || []).map(ct => (
            <tr key={ct.id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px", fontWeight: 600 }}>{ct.label}</td>
              <td style={{ padding: "8px" }}>{fmtCurrency(ct.default_price)}</td>
              <td style={{ padding: "8px" }}>{ct.gas_group || "—"}</td>
              <td style={{ padding: "8px" }}>{ct.item_type}</td>
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
      showToast(`Recorded: ${parts.join(", ")}`);
      setForm(f => ({ ...f, customer_id: "", cylinder_type: "", delivered: 0, returned: 0, notes: "" }));
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
              {(cylinderTypes || []).map(ct => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
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
  const onHand = useApi(() => api.getOnHand());
  const txs = useApi(() => api.getTransactions(filter ? { customer_id: filter, limit: 50 } : { limit: 50 }), [filter]);

  const customerMap = useMemo(() => {
    const m = {}; (customers || []).forEach(c => m[c.id] = c); return m;
  }, [customers]);
  const ctMap = useMemo(() => {
    const m = {}; (cylinderTypes || []).forEach(ct => m[ct.id] = ct); return m;
  }, [cylinderTypes]);

  // Only show cylinder-type items (not sales)
  const cylinderTypeIds = useMemo(() => new Set((cylinderTypes || []).filter(ct => ct.item_type === "cylinder").map(ct => ct.id)), [cylinderTypes]);
  const filteredTxs = useMemo(() => (txs.data || []).filter(tx => cylinderTypeIds.has(tx.cylinder_type)), [txs.data, cylinderTypeIds]);

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Cylinder Tracking</h2>
      <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 300, marginBottom: 16 }}>
        <option value="">All customers</option>
        {(customers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>On-Hand Summary</div>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
            {["Customer", "Cylinder Type", "On-Hand"].map(h => <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {(onHand.data || []).filter(r => !filter || r.customer_id === filter).map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "6px 8px" }}>{customerMap[r.customer_id]?.name || r.customer_id}</td>
                <td style={{ padding: "6px 8px" }}>{ctMap[r.cylinder_type]?.label || r.cylinder_type}</td>
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
                <td style={{ padding: "4px 8px" }}>{customerMap[tx.customer_id]?.name || "?"}</td>
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
function BillingView({ customers, cylinderTypes }) {
  const [mode, setMode] = useState("month"); // month | range
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [filterCustomer, setFilterCustomer] = useState("");
  const [sortBy, setSortBy] = useState("name"); // name | address

  const params = mode === "month"
    ? { month, ...(filterCustomer ? { customer_id: filterCustomer } : {}) }
    : { from: dateFrom, to: dateTo, ...(filterCustomer ? { customer_id: filterCustomer } : {}) };
  const billing = useApi(() => api.getBilling(params), [mode, month, dateFrom, dateTo, filterCustomer]);

  const sortedBills = useMemo(() => {
    if (!billing.data?.bills) return [];
    return [...billing.data.bills].sort((a, b) => {
      if (sortBy === "address") return (a.customer.address || "").localeCompare(b.customer.address || "");
      return a.customer.name.localeCompare(b.customer.name);
    });
  }, [billing.data, sortBy]);

  const BillTable = ({ lines, label, color }) => {
    if (!lines?.length) return null;
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>
            {["Item", "Qty", "Unit Price", "Total"].map(h => <th key={h} style={{ textAlign: "left", padding: "4px 8px", color: C.muted }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.cylinder_type} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "4px 8px" }}>{l.label}</td>
                <td style={{ padding: "4px 8px" }}>{l.qty}</td>
                <td style={{ padding: "4px 8px" }}>{fmtCurrency(l.unit_price)}</td>
                <td style={{ padding: "4px 8px", fontWeight: 600 }}>{fmtCurrency(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Billing</h2>

      {/* Controls */}
      <Card>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Period</label>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setMode("month")} style={{ ...btnStyle(mode === "month" ? C.accent : C.muted), padding: "6px 12px", fontSize: 12 }}>Month</button>
              <button onClick={() => setMode("range")} style={{ ...btnStyle(mode === "range" ? C.accent : C.muted), padding: "6px 12px", fontSize: 12 }}>Date Range</button>
            </div>
          </div>
          {mode === "month" ? (
            <div><label style={labelStyle}>Month</label><input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...inputStyle, width: 180 }} /></div>
          ) : (
            <>
              <div><label style={labelStyle}>From</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inputStyle, width: 160 }} /></div>
              <div><label style={labelStyle}>To</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inputStyle, width: 160 }} /></div>
            </>
          )}
          <div>
            <label style={labelStyle}>Customer</label>
            <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} style={{ ...inputStyle, width: 220 }}>
              <option value="">All customers</option>
              {(customers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Sort By</label>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setSortBy("name")} style={{ ...btnStyle(sortBy === "name" ? C.blue : C.muted), padding: "6px 12px", fontSize: 12 }}>Name</button>
              <button onClick={() => setSortBy("address")} style={{ ...btnStyle(sortBy === "address" ? C.blue : C.muted), padding: "6px 12px", fontSize: 12 }}>Address</button>
            </div>
          </div>
        </div>
      </Card>

      {billing.data && (
        <>
          {/* Grand totals */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <StatCard label="Rental Total" value={fmtCurrency(billing.data.grand_rental)} color={C.accent} />
            <StatCard label="Sales Total" value={fmtCurrency(billing.data.grand_sales)} color={C.blue} />
            <StatCard label="Grand Total" value={fmtCurrency(billing.data.grand_total)} color={C.green} />
          </div>

          {/* Per-customer bills */}
          {sortedBills.map(b => (
            <Card key={b.customer.id}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{b.customer.name}</div>
                  {b.customer.address && <div style={{ fontSize: 12, color: C.muted }}>{b.customer.address}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: 18, color: C.green }}>{fmtCurrency(b.total)}</div>
                </div>
              </div>
              <BillTable lines={b.rentalLines} label="Rental" color={C.accent} />
              {b.rentalLines?.length > 0 && <div style={{ textAlign: "right", fontSize: 12, fontWeight: 600, color: C.accent, marginBottom: 8 }}>Rental subtotal: {fmtCurrency(b.rentalTotal)}</div>}
              <BillTable lines={b.saleLines} label="Sales" color={C.blue} />
              {b.saleLines?.length > 0 && <div style={{ textAlign: "right", fontSize: 12, fontWeight: 600, color: C.blue }}>Sales subtotal: {fmtCurrency(b.salesTotal)}</div>}
            </Card>
          ))}
          {sortedBills.length === 0 && <div style={{ textAlign: "center", padding: 32, color: C.muted }}>No billing data for this period</div>}
        </>
      )}
    </div>
  );
}

// ==================== RENTAL INVOICES VIEW ====================
function RentalInvoicesView({ customers, cylinderTypes, showToast }) {
  const GST_RATE = 0.10;
  const [asAtDate, setAsAtDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [invoices, setInvoices] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const rows = await api.getOnHandAsAt(asAtDate);
      setData(rows);
      setSelected([]);
      setInvoices(null);
    } catch(e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [asAtDate]);

  // Group by customer
  const byCustomer = useMemo(() => {
    const m = {};
    for (const r of data) {
      if (!m[r.customer_id]) m[r.customer_id] = { customer_id: r.customer_id, customer_name: r.customer_name, customer_address: r.customer_address, account_customer: r.account_customer, lines: [], subtotal: 0 };
      m[r.customer_id].lines.push(r);
      m[r.customer_id].subtotal += r.line_total;
    }
    for (const k of Object.keys(m)) {
      m[k].subtotal = Math.round(m[k].subtotal * 100) / 100;
      m[k].gst = Math.round(m[k].subtotal * GST_RATE * 100) / 100;
      m[k].total = Math.round((m[k].subtotal + m[k].gst) * 100) / 100;
    }
    return Object.values(m).sort((a, b) => a.customer_name.localeCompare(b.customer_name));
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
      showToast(`${r.invoicesGenerated} invoices generated, ${r.transactionsCreated} transactions created`);
      const inv = r.invoices.map(i => {
        const cust = byCustomer.find(c => c.customer_id === i.customer_id);
        const subtotal = i.total;
        const gst = Math.round(subtotal * GST_RATE * 100) / 100;
        const grandTotal = Math.round((subtotal + gst) * 100) / 100;
        return { ...i, customer_name: cust?.customer_name || "Unknown", customer_address: cust?.customer_address || "", subtotal, gst, grandTotal };
      });
      setInvoices(inv);
    } catch(e) { showToast(e.message, "error"); }
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Rental Invoices</h2>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={labelStyle}>On-Hand As At Date</label>
            <input type="date" value={asAtDate} onChange={e => setAsAtDate(e.target.value)} style={inputStyle} />
          </div>
          <button onClick={loadData} style={btnStyle(C.blue)}>{loading ? "Loading..." : "Refresh"}</button>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Shows cylinder quantities on hand as at this date, with customer pricing applied.</div>
      </Card>

      {/* Customer selection table */}
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

      {/* Generated Invoices — clean printable documents */}
      {invoices && (
        <div>
          <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Generated Invoices ({invoices.length})</h3>
            <div style={{ display: "flex", gap: 8 }}>
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
          {invoices.map(inv => (
            <div key={inv.customer_id} className="invoice-page" style={{ background: "#fff", color: "#111", borderRadius: 8, padding: 32, marginBottom: 24, pageBreakAfter: "always" }}>
              {/* Invoice header */}
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

              {/* Line items */}
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

              {/* Totals */}
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
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== ORDERS VIEW ====================
function OrdersView({ customers, showToast, reloadCustomers }) {
  const [orders, setOrders] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [custSearch, setCustSearch] = useState("");
  const [showNewCust, setShowNewCust] = useState(false);
  const emptyForm = {
    customer_id: "", address: "", customer_name: "", order_detail: "", cylinder_type_id: "",
    qty: 1, unit_price: 0, total_price: 0, notes: "",
    order_date: new Date().toISOString().split("T")[0], payment: "", payment_ref: "",
  };
  const [form, setForm] = useState({ ...emptyForm });
  const [priceLines, setPriceLines] = useState([]); // multi-item breakdown
  const [newCust, setNewCust] = useState({ name: "", contact: "", phone: "", email: "", address: "", payment_ref: "" });

  const loadOrders = async () => {
    try { setOrders(await api.getOrders({ limit: 100 })); } catch(e) {}
  };
  useEffect(() => { loadOrders(); }, []);

  // Price lookup when customer or order_detail changes — multi-item
  const lookupRef = useRef(0);
  useEffect(() => {
    if (!form.order_detail) { setPriceLines([]); return; }
    const thisLookup = ++lookupRef.current;
    const timer = setTimeout(async () => {
      try {
        const r = await api.lookupPrice(form.customer_id, form.order_detail);
        if (thisLookup !== lookupRef.current) return;
        setPriceLines(r.lines || []);
        // Set totals and first item's cylinder_type_id for transaction creation
        setForm(f => ({
          ...f,
          cylinder_type_id: r.cylinder_type_id || "",
          qty: r.qty || 1,
          unit_price: r.unit_price || 0,
          total_price: r.total || 0,
        }));
      } catch(e) {}
    }, 150);
    return () => clearTimeout(timer);
  }, [form.customer_id, form.order_detail]);

  const filteredCustomers = useMemo(() => {
    if (!custSearch) return customers || [];
    const s = custSearch.toLowerCase();
    return (customers || []).filter(c => c.name.toLowerCase().includes(s) || c.address.toLowerCase().includes(s));
  }, [customers, custSearch]);

  const selectCustomer = (c) => {
    setForm(f => ({ ...f, customer_id: c.id, address: c.address || "", customer_name: c.name || "", payment_ref: c.payment_ref || "", notes: c.notes || "" }));
    setCustSearch("");
  };

  const createInlineCustomer = async () => {
    try {
      const result = await api.createCustomer(newCust);
      showToast("Customer created");
      reloadCustomers();
      setForm(f => ({ ...f, customer_id: result.id, address: newCust.address || "", customer_name: newCust.name || "", payment_ref: newCust.payment_ref || "" }));
      setShowNewCust(false);
      setNewCust({ name: "", contact: "", phone: "", email: "", address: "", payment_ref: "" });
    } catch (e) { showToast(e.message, "error"); }
  };

  const submitOrder = async () => {
    try {
      if (editing) {
        await api.updateOrder(editing, form);
        // If already pushed to OptimoRoute, auto-resend
        const existingOrder = orders.find(o => o.id === editing);
        if (existingOrder?.optimoroute_id) {
          try {
            await api.resendOrder(editing);
            showToast("Order updated & synced to OptimoRoute");
          } catch(e) {
            showToast("Order updated but OptimoRoute sync failed: " + e.message, "error");
          }
        } else {
          showToast("Order updated");
        }
        setEditing(null);
      } else {
        await api.createOrder(form);
        showToast("Order created");
        setCreating(false);
      }
      setForm({ ...emptyForm });
      setPriceLines([]);
      loadOrders();
    } catch (e) { showToast(e.message, "error"); }
  };

  const startEdit = (o) => {
    setEditing(o.id);
    setCreating(true);
    setForm({
      customer_id: o.customer_id, address: o.address || "", customer_name: o.customer_name || "",
      order_detail: o.order_detail || "", cylinder_type_id: o.cylinder_type_id || "",
      qty: o.qty || 1, unit_price: o.unit_price || 0, total_price: o.total_price || 0,
      notes: o.notes || "", order_date: o.order_date || "",
      payment: o.payment || "", payment_ref: o.payment_ref || "",
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setCreating(false);
    setForm({ ...emptyForm });
    setPriceLines([]);
  };

  const deleteOrder = async (id) => {
    if (!confirm("Delete this order?")) return;
    try { await api.deleteOrder(id); loadOrders(); showToast("Order deleted"); }
    catch (e) { showToast(e.message, "error"); }
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
    if (!search) return orders;
    const s = search.toLowerCase();
    return orders.filter(o => (o.customer_name || "").toLowerCase().includes(s) || (o.address || "").toLowerCase().includes(s) || (o.order_detail || "").toLowerCase().includes(s));
  }, [orders, search]);

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
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>Separate multiple items with commas</div>
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
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={submitOrder} disabled={!form.customer_id || !form.order_date} style={{ ...btnStyle(C.green), flex: 1 }}>
              {editing ? (orders.find(o => o.id === editing)?.optimoroute_id ? "Save & Sync to OptimoRoute" : "Save Order") : "Create Order"}
            </button>
            {editing && <button onClick={cancelEdit} style={btnStyle(C.muted)}>Cancel</button>}
          </div>
        </Card>
      )}

      {/* ORDER LIST */}
      <input placeholder="Search orders..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, marginBottom: 16, maxWidth: 400 }} />

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Date", "Customer", "Address", "Order", "Qty", "Unit $", "Total $", "Payment", "Status", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map(o => (
              <tr key={o.id} style={{ borderBottom: `1px solid ${C.border}`, background: editing === o.id ? "#f59e0b08" : "transparent" }}>
                <td style={{ padding: "6px 8px" }}>{o.order_date}</td>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{o.customer_name || o.customer_name_lookup || "—"}</td>
                <td style={{ padding: "6px 8px", color: C.accent, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.address || "—"}</td>
                <td style={{ padding: "6px 8px" }}>{o.order_detail || "—"}</td>
                <td style={{ padding: "6px 8px" }}>{o.qty || "—"}</td>
                <td style={{ padding: "6px 8px" }}>{o.unit_price ? fmtCurrency(o.unit_price) : "—"}</td>
                <td style={{ padding: "6px 8px", fontWeight: 700, color: C.green }}>{o.total_price ? fmtCurrency(o.total_price) : "—"}</td>
                <td style={{ padding: "6px 8px" }}>{o.payment || "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: o.status === "completed" ? "#22c55e22" : o.status === "confirmed" ? "#3b82f622" : "#f59e0b22",
                    color: o.status === "completed" ? C.green : o.status === "confirmed" ? C.blue : C.accent,
                  }}>{o.status}</span>
                  {o.optimoroute_id && <span style={{ padding: "2px 5px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "#8b5cf622", color: C.purple, marginLeft: 4 }}>OR</span>}
                </td>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                  <button onClick={() => startEdit(o)} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12, marginRight: 6 }}>Edit</button>
                  {!o.payment_confirmed && (
                    <button onClick={() => confirmPayment(o.id)} style={{ ...btnStyle(C.green), padding: "3px 8px", fontSize: 11, marginRight: 6 }}>
                      Confirm & Push
                    </button>
                  )}
                  <button onClick={() => deleteOrder(o.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12 }}>Del</button>
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
        const cust = accountCustomers.find(c => c.name.toLowerCase() === parts[0].toLowerCase() || c.address.toLowerCase().includes(parts[0].toLowerCase()));
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
        Load starting on-hand cylinder quantities for account customers when going live. Only account customers are shown.
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: C.panel, borderRadius: 8, padding: 4 }}>
        <button onClick={() => setMode("single")} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", background: mode === "single" ? C.accent : "transparent", color: mode === "single" ? "#000" : C.muted, fontWeight: 600, fontSize: 13 }}>Single Entry</button>
        <button onClick={() => setMode("bulk")} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", background: mode === "bulk" ? C.accent : "transparent", color: mode === "bulk" ? "#000" : C.muted, fontWeight: 600, fontSize: 13 }}>Bulk Import</button>
      </div>

      {mode === "single" && (
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Account Customer</label>
              <select value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))} style={inputStyle}>
                <option value="">Select...</option>
                {accountCustomers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.address}</option>)}
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

      {accountCustomers.length === 0 && (
        <Card>
          <div style={{ textAlign: "center", padding: 24, color: C.muted }}>
            No account customers yet. Mark customers as "Account Customer" in the Customers view first.
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
  const [selCustomers, setSelCustomers] = useState([]);

  // Customer price list tab
  const [tab, setTab] = useState("bulk"); // bulk | customer
  const [custSearch, setCustSearch] = useState("");
  const [selCustId, setSelCustId] = useState("");
  const [custPrices, setCustPrices] = useState([]);

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
    return (customers || []).filter(c => c.name.toLowerCase().includes(s) || c.address.toLowerCase().includes(s));
  }, [customers, custSearch]);

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
      else { data.price = parseFloat(bulkPrice); }
      const r = await api.bulkPrice(data);
      pricing.reload();
      let msg = `${r.updated} customers updated`;
      if (r.skippedFixed > 0) msg += `, ${r.skippedFixed} skipped (fixed price active)`;
      showToast(msg);
    } catch (e) { showToast(e.message, "error"); }
  };

  const toggleAll = () => {
    if (selCustomers.length === (customers || []).length) setSelCustomers([]);
    else setSelCustomers((customers || []).map(c => c.id));
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Pricing Manager</h2>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: C.panel, borderRadius: 8, padding: 4 }}>
        <button onClick={() => setTab("bulk")} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", background: tab === "bulk" ? C.accent : "transparent", color: tab === "bulk" ? "#000" : C.muted, fontWeight: 600, fontSize: 13 }}>Bulk Update</button>
        <button onClick={() => setTab("customer")} style={{ padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", background: tab === "customer" ? C.accent : "transparent", color: tab === "customer" ? "#000" : C.muted, fontWeight: 600, fontSize: 13 }}>Customer Price List</button>
      </div>

      {/* ─── BULK UPDATE TAB ─── */}
      {tab === "bulk" && (
        <Card>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setBulkMode("fixed")} style={btnStyle(bulkMode === "fixed" ? C.accent : C.muted)}>Set Fixed Price</button>
            <button onClick={() => setBulkMode("percentage")} style={btnStyle(bulkMode === "percentage" ? C.accent : C.muted)}>% Increase</button>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Cylinder Type</label>
              <select value={selCT} onChange={e => setSelCT(e.target.value)} style={{ ...inputStyle, width: 240 }}>
                <option value="">Select...</option>
                {(cylinderTypes || []).map(ct => <option key={ct.id} value={ct.id}>{ct.label} (default: {fmtCurrency(ct.default_price)})</option>)}
              </select>
            </div>
            {bulkMode === "fixed" ? (
              <div><label style={labelStyle}>New Price</label><input type="number" step="0.01" value={bulkPrice} onChange={e => setBulkPrice(e.target.value)} style={{ ...inputStyle, width: 120 }} /></div>
            ) : (
              <div><label style={labelStyle}>Increase %</label><input type="number" step="0.1" value={pct} onChange={e => setPct(e.target.value)} style={{ ...inputStyle, width: 120 }} /></div>
            )}
            <button onClick={applyBulk} disabled={!selCT || selCustomers.length === 0} style={btnStyle(C.green)}>Apply</button>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>
            Customers with active fixed-price contracts will be skipped automatically.
          </div>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            <button onClick={toggleAll} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 12 }}>
              {selCustomers.length === (customers || []).length ? "Deselect All" : "Select All"}
            </button> · {selCustomers.length} selected
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
                {(customers || []).map(c => {
                  const pd = selCT ? getCustomerPrice(c.id) : null;
                  return (
                    <tr key={c.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "4px 10px" }}>
                        <input type="checkbox" checked={selCustomers.includes(c.id)} onChange={() => setSelCustomers(s => s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id])} />
                      </td>
                      <td style={{ padding: "4px 10px" }}>{c.name}</td>
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
  const [toast, setToast] = useState(null);
  const [globalSearch, setGlobalSearch] = useState("");

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

  const logout = async () => {
    await api.logout();
    setUser(null);
    setAuthState("login");
  };

  if (authState === "loading") return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: C.bg, color: C.muted }}>Loading...</div>;
  if (authState === "setup") return <SetupScreen onDone={u => { setUser(u); setAuthState("app"); }} />;
  if (authState === "login") return <LoginScreen onDone={u => { setUser(u); setAuthState("app"); }} />;

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
    { id: "rentalinvoices", label: "Rental Invoices", icon: Icons.billing },
    { id: "pricing", label: "Pricing Manager", icon: Icons.pricing },
    { id: "users", label: "Manage Users", icon: Icons.users },
  ];

  const renderView = () => {
    switch (view) {
      case "dashboard": return <DashboardView stats={stats.data} />;
      case "orders": return <OrdersView customers={customers.data || []} showToast={showToast} reloadCustomers={customers.reload} />;
      case "customers": return <CustomersView customers={customers.data} reload={customers.reload} showToast={showToast} />;
      case "cylindertypes": return <CylinderTypesView cylinderTypes={cylinderTypes.data} reload={cylinderTypes.reload} showToast={showToast} />;
      case "delivery": return <DeliveryView customers={customers.data} cylinderTypes={cylinderTypes.data} showToast={showToast} refreshAll={refreshAll} />;
      case "tracking": return <TrackingView customers={customers.data} cylinderTypes={cylinderTypes.data} />;
      case "billing": return <BillingView customers={customers.data} cylinderTypes={cylinderTypes.data} />;
      case "rentalinvoices": return <RentalInvoicesView customers={customers.data || []} cylinderTypes={cylinderTypes.data || []} showToast={showToast} />;
      case "pricing": return <PricingView customers={customers.data} cylinderTypes={cylinderTypes.data} showToast={showToast} userRole={user?.role} />;
      case "openingbalances": return <OpeningBalancesView customers={customers.data || []} cylinderTypes={cylinderTypes.data || []} showToast={showToast} />;
      case "optimoroute": return <OptimoRouteView customers={customers.data || []} cylinderTypes={cylinderTypes.data || []} showToast={showToast} refreshAll={refreshAll} />;
      case "users": return <UsersView showToast={showToast} />;
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
        <div style={{ padding: "12px 12px 4px" }}>
          <input placeholder="Search..." value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} style={{ ...inputStyle, fontSize: 12, padding: "6px 10px" }} />
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
