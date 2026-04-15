// ============================================================
// AuditLog.jsx — Admin-only audit log viewer
// ============================================================
// Read-only view of the compliance audit trail. Supports filters
// (date range, user, table, action, free-text), pagination, and
// drill-down to see before/after JSON for any row.
//
// Talks to /api/audit-log, /api/audit-log/facets, and
// /api/audit-log/record/:table/:id (all admin-gated on server).
//
// Self-contained styling — does not depend on anything in App.jsx
// beyond the api module.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from "react";
import api from "./api";

// Local style tokens (mirrors the App.jsx dark theme)
const C = {
  bg: "#0f1117", panel: "#161820", border: "#23262f", card: "#1a1d27",
  text: "#e2e4ea", muted: "#6b7280", accent: "#f59e0b",
  red: "#ef4444", green: "#22c55e", blue: "#3b82f6", purple: "#8b5cf6",
  input: "#1e2130", inputBorder: "#2d3148",
};
const input = {
  padding: "7px 10px", background: C.input, border: `1px solid ${C.inputBorder}`,
  borderRadius: 6, color: C.text, fontSize: 12, boxSizing: "border-box",
};
const btn = (color = C.accent) => ({
  padding: "7px 14px", background: color, border: "none", borderRadius: 6,
  color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer",
});
const label = { fontSize: 10, color: C.muted, marginBottom: 4, display: "block", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };
const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16 };

// Color-code actions so a reviewer can eyeball the log
function actionColor(action) {
  if (!action) return C.muted;
  if (action.startsWith("create"))   return C.green;
  if (action.startsWith("delete"))   return C.red;
  if (action.startsWith("void"))     return C.red;
  if (action === "login")            return C.blue;
  if (action === "login_failed")     return C.red;
  if (action === "logout")           return C.muted;
  if (action === "payment")          return C.purple;
  if (action === "password_change")  return C.accent;
  if (action.startsWith("bulk"))     return C.accent;
  if (action.startsWith("update"))   return C.blue;
  return C.muted;
}

// Truncate helper for summary display
function truncate(s, n = 80) {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// Format ISO ts for display — the server stores UTC datetime('now')
function fmtTs(ts) {
  if (!ts) return "";
  // SQLite returns "YYYY-MM-DD HH:MM:SS" in UTC
  const d = new Date(ts.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

// Pretty-print a JSON string, gracefully handling empty / non-JSON
function prettyJson(s) {
  if (!s) return "";
  try { return JSON.stringify(JSON.parse(s), null, 2); }
  catch { return s; }
}

export default function AuditLogView({ showToast }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const today = new Date().toISOString().split("T")[0];
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [filters, setFilters] = useState({
    from: monthAgo,
    to: "",
    username: "",
    table: "",
    action: "",
    q: "",
    record_id: "",
  });
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [facets, setFacets] = useState({ users: [], tables: [], actions: [] });
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit, offset };
      // Only send non-empty filters
      for (const [k, v] of Object.entries(filters)) {
        if (v && String(v).trim() !== "") params[k] = v;
      }
      // The server stores ts as "YYYY-MM-DD HH:MM:SS". A from-date should
      // match the whole day, so append time bounds.
      if (params.from) params.from = params.from + " 00:00:00";
      if (params.to)   params.to   = params.to   + " 23:59:59";

      const res = await api.getAuditLog(params);
      setRows(res.rows || []);
      setTotal(res.total || 0);
    } catch (e) {
      setError(e.message);
      if (showToast) showToast(`Audit log: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [filters, limit, offset, showToast]);

  // Load facets once
  useEffect(() => {
    api.getAuditFacets().then(setFacets).catch(() => { /* non-fatal */ });
  }, []);

  // Load data when filters/paging change
  useEffect(() => { load(); }, [load]);

  const resetFilters = () => {
    setFilters({ from: monthAgo, to: "", username: "", table: "", action: "", q: "", record_id: "" });
    setOffset(0);
  };

  const applyFilters = () => { setOffset(0); load(); };

  // Export what's currently loaded as CSV. This only exports the visible
  // page — for a full export the user should widen the filters & limit.
  const exportCsv = () => {
    if (!rows.length) return;
    const header = ["ts", "username", "user_role", "ip", "action", "table_name", "record_id", "summary"];
    const escape = (v) => {
      const s = String(v ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [header.join(",")];
    for (const r of rows) lines.push(header.map(k => escape(r[k])).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: C.text }}>Audit Log</h1>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            Append-only compliance trail. Every create, update, delete, payment, and login is recorded here.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn(C.blue)} onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button style={btn(C.purple)} onClick={exportCsv} disabled={!rows.length}>
            Export CSV (this page)
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={label}>From</label>
            <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} style={{ ...input, width: "100%" }} />
          </div>
          <div>
            <label style={label}>To</label>
            <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} style={{ ...input, width: "100%" }} />
          </div>
          <div>
            <label style={label}>User</label>
            <select value={filters.username} onChange={e => setFilters(f => ({ ...f, username: e.target.value }))} style={{ ...input, width: "100%" }}>
              <option value="">All users</option>
              {facets.users.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Table</label>
            <select value={filters.table} onChange={e => setFilters(f => ({ ...f, table: e.target.value }))} style={{ ...input, width: "100%" }}>
              <option value="">All tables</option>
              {facets.tables.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Action</label>
            <select value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))} style={{ ...input, width: "100%" }}>
              <option value="">All actions</option>
              {facets.actions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Record ID</label>
            <input placeholder="e.g. INV-00042" value={filters.record_id} onChange={e => setFilters(f => ({ ...f, record_id: e.target.value }))} style={{ ...input, width: "100%" }} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={label}>Search summary</label>
            <input placeholder="free text search in summary" value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} style={{ ...input, width: "100%" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn(C.muted)} onClick={resetFilters}>Reset</button>
          <button style={btn()} onClick={applyFilters}>Apply</button>
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, fontSize: 12, color: C.muted }}>
        <div>
          {loading ? "Loading…" : error ? <span style={{ color: C.red }}>Error: {error}</span> : `${total.toLocaleString()} matching entries`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>Page {page} of {pages}</span>
          <button style={btn(C.muted)} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>‹ Prev</button>
          <button style={btn(C.muted)} disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next ›</button>
          <select value={limit} onChange={e => { setLimit(parseInt(e.target.value, 10)); setOffset(0); }} style={{ ...input, padding: "5px 8px" }}>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
        </div>
      </div>

      {/* Rows */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "160px 120px 120px 130px 1fr 40px", gap: 0, padding: "10px 14px", borderBottom: `1px solid ${C.border}`, background: C.panel, fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          <div>Timestamp</div>
          <div>User</div>
          <div>Action</div>
          <div>Table / Record</div>
          <div>Summary</div>
          <div></div>
        </div>
        {rows.length === 0 && !loading && (
          <div style={{ padding: 30, textAlign: "center", color: C.muted, fontSize: 13 }}>
            No audit entries match these filters.
          </div>
        )}
        {rows.map(r => (
          <React.Fragment key={r.id}>
            <div
              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "160px 120px 120px 130px 1fr 40px",
                gap: 0,
                padding: "10px 14px",
                borderBottom: `1px solid ${C.border}`,
                fontSize: 12,
                cursor: "pointer",
                background: expandedId === r.id ? C.panel : "transparent",
              }}
            >
              <div style={{ color: C.muted, fontFamily: "monospace", fontSize: 11 }}>{fmtTs(r.ts)}</div>
              <div style={{ color: C.text }}>
                {r.username || <span style={{ color: C.muted }}>—</span>}
                {r.user_role && <span style={{ color: C.muted, fontSize: 10, marginLeft: 4 }}>({r.user_role})</span>}
              </div>
              <div>
                <span style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: actionColor(r.action) + "22",
                  color: actionColor(r.action),
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}>{r.action}</span>
              </div>
              <div style={{ color: C.text, fontFamily: "monospace", fontSize: 11 }}>
                <div>{r.table_name}</div>
                {r.record_id && <div style={{ color: C.muted, fontSize: 10 }}>{truncate(r.record_id, 18)}</div>}
              </div>
              <div style={{ color: C.text }}>{truncate(r.summary, 120)}</div>
              <div style={{ color: C.muted, textAlign: "right" }}>{expandedId === r.id ? "▾" : "▸"}</div>
            </div>
            {expandedId === r.id && (
              <div style={{ padding: "14px 14px 18px 14px", borderBottom: `1px solid ${C.border}`, background: C.bg, fontSize: 11 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <div style={label}>Before</div>
                    <pre style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, color: C.text, fontSize: 11, overflow: "auto", maxHeight: 320, margin: 0 }}>
                      {prettyJson(r.before_json) || <span style={{ color: C.muted }}>(none)</span>}
                    </pre>
                  </div>
                  <div>
                    <div style={label}>After</div>
                    <pre style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, color: C.text, fontSize: 11, overflow: "auto", maxHeight: 320, margin: 0 }}>
                      {prettyJson(r.after_json) || <span style={{ color: C.muted }}>(none)</span>}
                    </pre>
                  </div>
                </div>
                <div style={{ marginTop: 10, color: C.muted, fontSize: 11, display: "flex", gap: 14 }}>
                  <span><b style={{ color: C.text }}>ID:</b> {r.id}</span>
                  <span><b style={{ color: C.text }}>IP:</b> {r.ip || "—"}</span>
                  <span><b style={{ color: C.text }}>User ID:</b> {r.user_id || "—"}</span>
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      <div style={{ marginTop: 16, padding: 12, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, color: C.muted }}>
        <b style={{ color: C.text }}>About this log:</b> This is an append-only record of every change made to financial and master data in CylinderTrack.
        Rows cannot be edited or deleted from the application — they can only be archived by a direct database operation.
        Credit card data and password hashes are redacted before storage.
      </div>
    </div>
  );
}
