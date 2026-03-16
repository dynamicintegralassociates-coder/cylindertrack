import { useState, useEffect, useCallback, useMemo } from "react";
import * as api from "./api.js";

const STATUS_COLORS = {
  delivered: "#2563eb",
  onsite: "#d97706",
  returned: "#16a34a",
  lost: "#dc2626",
  billed: "#6d28d9",
};

const fmtDate = (d) => new Date(d).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
const fmtCurrency = (n) => `$${Number(n).toFixed(2)}`;
const today = () => new Date().toISOString().split("T")[0];

// --- ICONS ---
const Icon = ({ d, size = 18, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const Icons = {
  dashboard: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1",
  customers: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  cylinders: "M12 2L12 22M8 6h8a2 2 0 012 2v8a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2zM10 2h4M10 22h4",
  delivery: "M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  billing: "M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6",
  pricing: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  plus: "M12 5v14M5 12h14",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18M6 6l12 12",
  edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  truck: "M1 3h15v13H1zM16 8h4l3 3v5h-7V8z",
  undo: "M3 10h10a5 5 0 015 5v2M3 10l6 6M3 10l6-6",
  refresh: "M23 4v6h-6M1 20v-6h6M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15",
};

// --- SHARED UI ---
const Card = ({ children, style }) => (
  <div style={{ background: "#1a1d27", border: "1px solid #23262f", borderRadius: 12, padding: 20, ...style }}>{children}</div>
);
const Badge = ({ label, color }) => (
  <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: `${color}22`, color, letterSpacing: "0.02em" }}>{label}</span>
);
const Btn = ({ children, onClick, variant = "primary", style, disabled }) => {
  const styles = {
    primary: { background: "linear-gradient(135deg, #f59e0b, #ea580c)", color: "#fff", border: "none" },
    secondary: { background: "#23262f", color: "#d1d5db", border: "1px solid #2d3039" },
    danger: { background: "#7f1d1d", color: "#fca5a5", border: "1px solid #991b1b" },
    ghost: { background: "transparent", color: "#9ca3af", border: "1px solid #23262f" },
  };
  return (
    <button disabled={disabled} onClick={onClick} style={{
      ...styles[variant], padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6, transition: "all 0.15s", fontFamily: "inherit", ...style,
    }}>{children}</button>
  );
};
const Input = ({ label, ...props }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>}
    <input {...props} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #23262f", background: "#0f1117", color: "#e2e4ea", fontSize: 13, outline: "none", fontFamily: "inherit", ...props.style }} />
  </div>
);
const Select = ({ label, children, ...props }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>}
    <select {...props} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #23262f", background: "#0f1117", color: "#e2e4ea", fontSize: 13, outline: "none", fontFamily: "inherit", ...props.style }}>{children}</select>
  </div>
);
const PageTitle = ({ title, subtitle }) => (
  <div style={{ marginBottom: 24 }}>
    <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: "#f3f4f6" }}>{title}</h1>
    {subtitle && <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{subtitle}</p>}
  </div>
);
const StatCard = ({ label, value, accent }) => (
  <Card style={{ flex: 1, minWidth: 160, position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent || "#f59e0b" }} />
    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6, letterSpacing: "-0.03em", fontFamily: "'JetBrains Mono', monospace", color: "#f3f4f6" }}>{value}</div>
  </Card>
);
const Table = ({ columns, data, emptyMsg }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>{columns.map((col, i) => (
          <th key={i} style={{ textAlign: col.align || "left", padding: "10px 12px", borderBottom: "1px solid #23262f", color: "#6b7280", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{col.label}</th>
        ))}</tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr><td colSpan={columns.length} style={{ padding: 32, textAlign: "center", color: "#4b5563" }}>{emptyMsg || "No data"}</td></tr>
        ) : data.map((row, ri) => (
          <tr key={ri} style={{ borderBottom: "1px solid #1e2130" }}>
            {columns.map((col, ci) => (
              <td key={ci} style={{ padding: "10px 12px", textAlign: col.align || "left", color: "#d1d5db" }}>{col.render ? col.render(row) : row[col.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
const Modal = ({ title, onClose, children, width }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
    <div onClick={e => e.stopPropagation()} style={{ background: "#1a1d27", border: "1px solid #23262f", borderRadius: 14, padding: 28, width: width || 480, maxHeight: "85vh", overflow: "auto", animation: "fadeIn 0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280" }}><Icon d={Icons.x} /></button>
      </div>
      {children}
    </div>
  </div>
);

// Custom hook to fetch data from the API
function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, reload, setData };
}

// ==================== AUTH WRAPPER ====================
export default function App() {
  const [authState, setAuthState] = useState("loading"); // loading, setup, login, authenticated
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");
  const [formPass2, setFormPass2] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Set up 401 handler
  useEffect(() => {
    api.setAuthFailHandler(() => setAuthState("login"));
  }, []);

  // Check auth status on load
  useEffect(() => {
    api.getAuthStatus().then(status => {
      if (status.needsSetup) setAuthState("setup");
      else if (status.authenticated) { setUser(status.user); setAuthState("authenticated"); }
      else setAuthState("login");
    }).catch(() => setAuthState("login"));
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!formUser || !formPass) return;
    setSubmitting(true); setError("");
    try {
      const res = await api.login(formUser, formPass);
      setUser(res.user); setAuthState("authenticated");
      setFormUser(""); setFormPass("");
    } catch (e) { setError(e.message); }
    setSubmitting(false);
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    if (!formUser || !formPass) return;
    if (formPass !== formPass2) { setError("Passwords don't match"); return; }
    if (formPass.length < 4) { setError("Password must be at least 4 characters"); return; }
    setSubmitting(true); setError("");
    try {
      const res = await api.setup(formUser, formPass);
      setUser(res.user); setAuthState("authenticated");
      setFormUser(""); setFormPass(""); setFormPass2("");
    } catch (e) { setError(e.message); }
    setSubmitting(false);
  };

  const handleLogout = async () => {
    await api.logout().catch(() => {});
    setUser(null); setAuthState("login");
  };

  if (authState === "loading") {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f1117", color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>Loading...</div>;
  }

  if (authState === "setup" || authState === "login") {
    const isSetup = authState === "setup";
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f1117", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
        <div style={{ width: 400, animation: "fadeIn 0.3s" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg, #f59e0b, #ef4444)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 24, color: "#fff", marginBottom: 16 }}>GC</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#f3f4f6", letterSpacing: "-0.03em" }}>CylinderTrack</h1>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
              {isSetup ? "Create your admin account to get started" : "Sign in to access your data"}
            </p>
          </div>
          <form onSubmit={isSetup ? handleSetup : handleLogin}>
            <div style={{ background: "#1a1d27", border: "1px solid #23262f", borderRadius: 14, padding: 24 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Username</label>
                <input value={formUser} onChange={e => { setFormUser(e.target.value); setError(""); }} autoFocus placeholder="Enter username..." style={{ width: "100%", padding: "11px 14px", borderRadius: 8, border: "1px solid #23262f", background: "#0f1117", color: "#e2e4ea", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{isSetup ? "Create Password" : "Password"}</label>
                <input type="password" value={formPass} onChange={e => { setFormPass(e.target.value); setError(""); }} placeholder="Enter password..." style={{ width: "100%", padding: "11px 14px", borderRadius: 8, border: "1px solid #23262f", background: "#0f1117", color: "#e2e4ea", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
              </div>
              {isSetup && <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Confirm Password</label>
                <input type="password" value={formPass2} onChange={e => { setFormPass2(e.target.value); setError(""); }} placeholder="Confirm password..." style={{ width: "100%", padding: "11px 14px", borderRadius: 8, border: "1px solid #23262f", background: "#0f1117", color: "#e2e4ea", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
              </div>}
              {error && <div style={{ padding: "8px 12px", borderRadius: 8, background: "#7f1d1d", color: "#fca5a5", fontSize: 12, marginBottom: 16, fontWeight: 500 }}>{error}</div>}
              <button type="submit" disabled={submitting} style={{ width: "100%", padding: "11px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #f59e0b, #ea580c)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: submitting ? "wait" : "pointer", fontFamily: "inherit", opacity: submitting ? 0.7 : 1 }}>
                {submitting ? "Please wait..." : (isSetup ? "Create Account & Enter" : "Sign In")}
              </button>
            </div>
          </form>
          {isSetup && <p style={{ textAlign: "center", fontSize: 11, color: "#4b5563", marginTop: 16, lineHeight: 1.5 }}>
            This is a one-time setup. You can add more users later from the app. Your colleague will need their own username and password.
          </p>}
        </div>
        <style>{`
          @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          input { font-family: 'DM Sans', sans-serif; }
        `}</style>
      </div>
    );
  }

  return <MainApp user={user} onLogout={handleLogout} />;
}

// ==================== MAIN APP ====================
function MainApp({ user, onLogout }) {
  const [view, setView] = useState("dashboard");
  const [toast, setToast] = useState(null);

  // Global data caches
  const customers = useApi(() => api.getCustomers());
  const cylinderTypes = useApi(() => api.getCylinderTypes());
  const pricing = useApi(() => api.getPricing());

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const refreshAll = () => {
    customers.reload();
    cylinderTypes.reload();
    pricing.reload();
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: Icons.dashboard },
    { id: "customers", label: "Customers", icon: Icons.customers },
    { id: "cylindertypes", label: "Cylinder Types", icon: Icons.settings },
    { id: "delivery", label: "Deliver / Return", icon: Icons.delivery },
    { id: "tracking", label: "Cylinder Tracking", icon: Icons.cylinders },
    { id: "billing", label: "Monthly Billing", icon: Icons.billing },
    { id: "pricing", label: "Pricing Manager", icon: Icons.pricing },
  ];
  if (user?.role === "admin") {
    navItems.push({ id: "users", label: "Manage Users", icon: Icons.customers });
  }

  const loading = customers.loading || cylinderTypes.loading;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: "#0f1117", color: "#e2e4ea" }}>
      {/* SIDEBAR */}
      <nav style={{ width: 240, background: "#161820", borderRight: "1px solid #23262f", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid #23262f" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #f59e0b, #ef4444)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: "#fff" }}>GC</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>CylinderTrack</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>Gas Rental Manager</div>
            </div>
          </div>
        </div>
        <div style={{ padding: "12px 8px", flex: 1 }}>
          {navItems.map(item => {
            const active = view === item.id;
            return (
              <button key={item.id} onClick={() => setView(item.id)} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", marginBottom: 2,
                background: active ? "#23262f" : "transparent", border: "none", borderRadius: 8, cursor: "pointer",
                color: active ? "#f59e0b" : "#9ca3af", fontSize: 13, fontWeight: active ? 600 : 400, transition: "all 0.15s",
                fontFamily: "inherit",
              }}>
                <Icon d={item.icon} size={17} color={active ? "#f59e0b" : "#6b7280"} />
                {item.label}
              </button>
            );
          })}
        </div>
        <div style={{ padding: "16px 20px", borderTop: "1px solid #23262f" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: "#23262f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#f59e0b" }}>{user?.username?.[0]?.toUpperCase() || "?"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#d1d5db", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.username}</div>
              <div style={{ fontSize: 10, color: "#4b5563" }}>{user?.role}</div>
            </div>
          </div>
          <button onClick={onLogout} style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #23262f", background: "transparent", color: "#9ca3af", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>Sign Out</button>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main style={{ flex: 1, overflow: "auto", padding: "28px 36px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh", color: "#6b7280" }}>Loading...</div>
        ) : (
          <>
            {view === "dashboard" && <DashboardView cylinderTypes={cylinderTypes.data || []} />}
            {view === "customers" && <CustomersView customers={customers.data || []} reload={customers.reload} showToast={showToast} />}
            {view === "cylindertypes" && <CylinderTypesView cylinderTypes={cylinderTypes.data || []} reload={cylinderTypes.reload} showToast={showToast} />}
            {view === "delivery" && <DeliveryView customers={customers.data || []} cylinderTypes={cylinderTypes.data || []} showToast={showToast} />}
            {view === "tracking" && <TrackingView customers={customers.data || []} cylinderTypes={cylinderTypes.data || []} />}
            {view === "billing" && <BillingView />}
            {view === "pricing" && <PricingView customers={customers.data || []} cylinderTypes={cylinderTypes.data || []} pricing={pricing.data || []} reloadPricing={pricing.reload} showToast={showToast} />}
            {view === "users" && user?.role === "admin" && <UsersView showToast={showToast} />}
          </>
        )}
      </main>

      {/* TOAST */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, padding: "12px 20px", borderRadius: 10,
          background: toast.type === "success" ? "#16a34a" : "#dc2626", color: "#fff",
          fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", animation: "fadeIn 0.2s", fontFamily: "inherit",
        }}>{toast.msg}</div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #23262f; border-radius: 3px; }
        input, select, textarea { font-family: 'DM Sans', sans-serif; }
      `}</style>
    </div>
  );
}

// ==================== MANAGE USERS (admin only) ====================
function UsersView({ showToast }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");

  const addUser = async () => {
    if (!username.trim() || !password) return;
    try {
      await api.addUser(username.trim(), password, role);
      showToast(`User "${username.trim()}" created`);
      setUsername(""); setPassword("");
    } catch (e) { showToast(e.message, "error"); }
  };

  const changePw = async () => {
    if (!curPw || !newPw) return;
    try {
      await api.changePassword(curPw, newPw);
      showToast("Password changed");
      setCurPw(""); setNewPw("");
    } catch (e) { showToast(e.message, "error"); }
  };

  const exportBackup = async () => {
    try {
      const backup = await api.downloadBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cylindertrack-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Backup downloaded");
    } catch (e) { showToast(e.message, "error"); }
  };

  const importBackup = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const backup = JSON.parse(text);
        if (!backup.data) { showToast("Invalid backup file", "error"); return; }
        if (!confirm("This will replace ALL existing data with the backup. Are you sure?")) return;
        await api.restoreBackup(backup.data);
        showToast("Data restored successfully — refresh the page");
      } catch (e) { showToast(e.message, "error"); }
    };
    input.click();
  };

  return (
    <div>
      <PageTitle title="Manage Users & Backups" subtitle="Add colleagues, change passwords, and backup your data" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, maxWidth: 800 }}>
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Add New User</h3>
          <Input label="Username" value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. john" />
          <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 4 characters" />
          <Select label="Role" value={role} onChange={e => setRole(e.target.value)}>
            <option value="user">User — can view and edit data</option>
            <option value="admin">Admin — can also manage users</option>
          </Select>
          <Btn onClick={addUser} disabled={!username.trim() || !password}><Icon d={Icons.plus} size={15} /> Create User</Btn>
        </Card>
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Change Your Password</h3>
          <Input label="Current Password" type="password" value={curPw} onChange={e => setCurPw(e.target.value)} />
          <Input label="New Password" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Minimum 4 characters" />
          <Btn onClick={changePw} disabled={!curPw || !newPw}>Change Password</Btn>
        </Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, maxWidth: 800, marginTop: 24 }}>
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Export Backup</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16, lineHeight: 1.5 }}>Download all customers, cylinder types, transactions, and pricing as a JSON file. Do this regularly to keep a copy of your data.</p>
          <Btn onClick={exportBackup}>Download Backup</Btn>
        </Card>
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Restore from Backup</h3>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16, lineHeight: 1.5 }}>Upload a previously exported JSON backup file. This will replace all existing data.</p>
          <Btn variant="danger" onClick={importBackup}>Restore from File</Btn>
        </Card>
      </div>
    </div>
  );
}

// ==================== DASHBOARD ====================
function DashboardView({ cylinderTypes }) {
  const { data: stats, loading } = useApi(() => api.getStats());
  if (loading || !stats) return <div style={{ color: "#6b7280" }}>Loading dashboard...</div>;

  const txColors = { delivery: STATUS_COLORS.delivered, return: STATUS_COLORS.returned, sale: "#8b5cf6" };

  return (
    <div>
      <PageTitle title="Dashboard" subtitle="Overview of your cylinder rental operations" />
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 28 }}>
        <StatCard label="Active Customers" value={stats.total_customers} accent="#2563eb" />
        <StatCard label="Cylinders On-Hand" value={stats.total_on_hand} accent="#f59e0b" />
        <StatCard label="Total Deliveries" value={stats.total_deliveries} accent="#16a34a" />
        <StatCard label="Total Returns" value={stats.total_returns} accent="#8b5cf6" />
        <StatCard label="Total Sales" value={stats.total_sales} accent="#ef4444" />
      </div>
      <Card>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Recent Transactions</h3>
        <Table
          columns={[
            { label: "Date", render: r => fmtDate(r.date) },
            { label: "Customer", key: "customer_name" },
            { label: "Type", render: r => <Badge label={r.type.toUpperCase()} color={txColors[r.type] || "#6b7280"} /> },
            { label: "Item", render: r => cylinderTypes.find(c => c.id === r.cylinder_type)?.label || r.cylinder_type },
            { label: "Qty", key: "qty", align: "right" },
          ]}
          data={stats.recent_transactions || []}
          emptyMsg="No transactions yet"
        />
      </Card>
    </div>
  );
}

// ==================== CUSTOMERS ====================
function CustomersView({ customers, reload, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", contact: "", phone: "", email: "", address: "", notes: "" });

  const filtered = customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const openAdd = () => { setForm({ name: "", contact: "", phone: "", email: "", address: "", notes: "" }); setShowAdd(true); };
  const openEdit = (c) => { setForm({ ...c }); setEditId(c.id); };

  const save = async () => {
    if (!form.name.trim()) return;
    try {
      if (editId) {
        await api.updateCustomer(editId, form);
        setEditId(null);
        showToast("Customer updated");
      } else {
        await api.createCustomer(form);
        setShowAdd(false);
        showToast("Customer added");
      }
      reload();
    } catch (e) { showToast(e.message, "error"); }
  };

  const remove = async (id) => {
    if (!confirm("Delete this customer?")) return;
    try {
      await api.deleteCustomer(id);
      reload();
      showToast("Customer deleted", "error");
    } catch (e) { showToast(e.message, "error"); }
  };

  const formModal = (title, onClose) => (
    <Modal title={title} onClose={onClose}>
      <Input label="Company Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Smith Welding Pty Ltd" />
      <Input label="Contact Person" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="e.g. John Smith" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Input label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="04xx xxx xxx" />
        <Input label="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="john@example.com" />
      </div>
      <Input label="Delivery Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
      <Input label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <Btn onClick={save}><Icon d={Icons.check} size={15} /> Save</Btn>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );

  return (
    <div>
      <PageTitle title="Customers" subtitle="Manage your gas rental customer accounts" />
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers..."
            style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #23262f", background: "#0f1117", color: "#e2e4ea", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
        </div>
        <Btn onClick={openAdd}><Icon d={Icons.plus} size={15} /> Add Customer</Btn>
      </div>
      <Card>
        <Table
          columns={[
            { label: "Company", render: r => <span style={{ fontWeight: 600 }}>{r.name}</span> },
            { label: "Contact", key: "contact" },
            { label: "Phone", key: "phone" },
            { label: "Email", key: "email" },
            { label: "Actions", align: "right", render: r => (
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <Btn variant="ghost" style={{ padding: "4px 8px" }} onClick={() => openEdit(r)}><Icon d={Icons.edit} size={14} /></Btn>
                <Btn variant="danger" style={{ padding: "4px 8px" }} onClick={() => remove(r.id)}><Icon d={Icons.x} size={14} /></Btn>
              </div>
            )}
          ]}
          data={filtered}
          emptyMsg="No customers yet"
        />
      </Card>
      {showAdd && formModal("Add Customer", () => setShowAdd(false))}
      {editId && formModal("Edit Customer", () => setEditId(null))}
    </div>
  );
}

// ==================== CYLINDER TYPES ====================
function CylinderTypesView({ cylinderTypes, reload, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ label: "", default_price: "", gas_group: "", item_type: "cylinder" });
  const GAS_GROUPS = ["Oxygen", "Acetylene", "Argon", "CO₂", "Nitrogen", "LPG", "Helium", "Hydrogen", "Mixed Gas", "Other"];

  const openAdd = () => { setForm({ label: "", default_price: "", gas_group: "", item_type: "cylinder" }); setShowAdd(true); };
  const openEdit = (ct) => { setForm({ label: ct.label, default_price: ct.default_price, gas_group: ct.gas_group || "", item_type: ct.item_type || "cylinder" }); setEditId(ct.id); };

  const save = async () => {
    if (!form.label.trim() || !form.default_price) return;
    try {
      if (editId) {
        await api.updateCylinderType(editId, form);
        setEditId(null);
        showToast("Item updated");
      } else {
        await api.createCylinderType(form);
        setShowAdd(false);
        showToast(`${form.item_type === "service" ? "Service" : "Cylinder"} added`);
      }
      reload();
    } catch (e) { showToast(e.message, "error"); }
  };

  const remove = async (id) => {
    if (!confirm("Delete this item?")) return;
    try {
      await api.deleteCylinderType(id);
      reload();
      showToast("Item deleted", "error");
    } catch (e) { showToast(e.message, "error"); }
  };

  const cylinders = cylinderTypes.filter(ct => (ct.item_type || "cylinder") === "cylinder");
  const services = cylinderTypes.filter(ct => ct.item_type === "service");

  const formModal = (title, onClose) => (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[{ key: "cylinder", label: "Cylinder", desc: "Tracked — on-hand & returns" }, { key: "service", label: "Service", desc: "Not tracked — billed per sale" }].map(t => (
          <button key={t.key} onClick={() => setForm({ ...form, item_type: t.key })} style={{
            flex: 1, padding: "10px 12px", borderRadius: 8, textAlign: "left",
            border: `2px solid ${form.item_type === t.key ? (t.key === "cylinder" ? "#2563eb" : "#8b5cf6") : "#23262f"}`,
            background: form.item_type === t.key ? (t.key === "cylinder" ? "#2563eb12" : "#8b5cf612") : "transparent",
            cursor: "pointer", fontFamily: "inherit",
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: form.item_type === t.key ? (t.key === "cylinder" ? "#60a5fa" : "#a78bfa") : "#9ca3af" }}>{t.label}</div>
            <div style={{ fontSize: 11, marginTop: 2, color: "#6b7280" }}>{t.desc}</div>
          </button>
        ))}
      </div>
      <Input label="Name" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
      <Select label="Gas Group" value={form.gas_group} onChange={e => setForm({ ...form, gas_group: e.target.value })}>
        <option value="">No group</option>
        {GAS_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
      </Select>
      <Input label={form.item_type === "service" ? "Default Price per Sale ($)" : "Default Monthly Rental ($)"} type="number" step="0.01" min="0" value={form.default_price} onChange={e => setForm({ ...form, default_price: e.target.value })} />
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <Btn onClick={save} disabled={!form.label.trim() || !form.default_price}><Icon d={Icons.check} size={15} /> Save</Btn>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );

  const typeTable = (data, label, priceLabel, badgeColor) => (
    <Card style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <Badge label={label === "Cylinders" ? "TRACKED" : "NOT TRACKED"} color={badgeColor} /> {label}
      </h3>
      <Table
        columns={[
          { label: "Name", render: r => <span style={{ fontWeight: 600 }}>{r.label}</span> },
          { label: "Gas Group", render: r => r.gas_group ? <Badge label={r.gas_group} color="#6366f1" /> : <span style={{ color: "#4b5563" }}>—</span> },
          { label: priceLabel, align: "right", render: r => <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "#f59e0b" }}>{fmtCurrency(r.default_price)}</span> },
          { label: "Actions", align: "right", render: r => (
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <Btn variant="ghost" style={{ padding: "4px 8px" }} onClick={() => openEdit(r)}><Icon d={Icons.edit} size={14} /></Btn>
              <Btn variant="danger" style={{ padding: "4px 8px" }} onClick={() => remove(r.id)}><Icon d={Icons.x} size={14} /></Btn>
            </div>
          )}
        ]}
        data={data}
        emptyMsg={`No ${label.toLowerCase()} configured`}
      />
    </Card>
  );

  return (
    <div>
      <PageTitle title="Cylinder Types & Services" subtitle="Manage tracked cylinders and non-tracked service items" />
      <div style={{ marginBottom: 20 }}><Btn onClick={openAdd}><Icon d={Icons.plus} size={15} /> Add Item</Btn></div>
      {typeTable(cylinders, "Cylinders", "Default Rental / Month", "#2563eb")}
      {typeTable(services, "Services", "Default Price / Sale", "#8b5cf6")}
      {showAdd && formModal("Add Item", () => setShowAdd(false))}
      {editId && formModal("Edit Item", () => setEditId(null))}
    </div>
  );
}

// ==================== DELIVERY / RETURN ====================
function DeliveryView({ customers, cylinderTypes, showToast }) {
  const [form, setForm] = useState({ customer_id: "", cylinder_type: "", qty: 1, type: "delivery", date: today(), notes: "" });
  const { data: recentTx, reload } = useApi(() => api.getTransactions({ limit: 15 }));

  const selectedType = cylinderTypes.find(ct => ct.id === form.cylinder_type);
  const isService = selectedType?.item_type === "service";

  const handleTypeChange = (typeId) => {
    const ct = cylinderTypes.find(c => c.id === typeId);
    setForm({ ...form, cylinder_type: typeId, type: ct?.item_type === "service" ? "sale" : (form.type === "sale" ? "delivery" : form.type) });
  };

  const submit = async () => {
    if (!form.customer_id || !form.cylinder_type || form.qty < 1) return;
    try {
      await api.createTransaction(form);
      const label = isService ? "Sale" : (form.type === "delivery" ? "Delivery" : "Return");
      showToast(`${label} recorded — ${form.qty} × ${selectedType?.label}`);
      setForm({ ...form, qty: 1, notes: "" });
      reload();
    } catch (e) { showToast(e.message, "error"); }
  };

  const txColors = { delivery: STATUS_COLORS.delivered, return: STATUS_COLORS.returned, sale: "#8b5cf6" };

  return (
    <div>
      <PageTitle title="Deliver / Return / Sell" subtitle="Record cylinder movements and service sales" />
      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 24 }}>
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>New Transaction</h3>
          <Select label="Customer" value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">Select customer...</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select label="Item" value={form.cylinder_type} onChange={e => handleTypeChange(e.target.value)}>
            <option value="">Select item...</option>
            <optgroup label="Cylinders (tracked)">
              {cylinderTypes.filter(ct => (ct.item_type || "cylinder") === "cylinder").map(ct => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
            </optgroup>
            <optgroup label="Services (not tracked)">
              {cylinderTypes.filter(ct => ct.item_type === "service").map(ct => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
            </optgroup>
          </Select>
          {isService ? (
            <div style={{ padding: "10px 12px", borderRadius: 8, border: "2px solid #8b5cf6", background: "#8b5cf612", marginBottom: 16, textAlign: "center" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#a78bfa" }}>Sale — no return needed</div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["delivery", "return"].map(t => (
                <button key={t} onClick={() => setForm({ ...form, type: t })} style={{
                  flex: 1, padding: "10px", borderRadius: 8, border: `2px solid ${form.type === t ? (t === "delivery" ? "#2563eb" : "#16a34a") : "#23262f"}`,
                  background: form.type === t ? (t === "delivery" ? "#2563eb18" : "#16a34a18") : "transparent",
                  color: form.type === t ? (t === "delivery" ? "#60a5fa" : "#4ade80") : "#6b7280",
                  fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                }}>
                  <Icon d={t === "delivery" ? Icons.truck : Icons.undo} size={16} color={form.type === t ? (t === "delivery" ? "#60a5fa" : "#4ade80") : "#6b7280"} />
                  <div style={{ marginTop: 4 }}>{t === "delivery" ? "Delivery" : "Return"}</div>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input label="Quantity" type="number" min="1" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
            <Input label="Date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>
          <Input label="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Docket #, PO #, etc." />
          <Btn onClick={submit} disabled={!form.customer_id || !form.cylinder_type} style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>
            <Icon d={Icons.check} size={15} /> Record {isService ? "Sale" : (form.type === "delivery" ? "Delivery" : "Return")}
          </Btn>
        </Card>
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Recent Transactions</h3>
          <Table
            columns={[
              { label: "Date", render: r => fmtDate(r.date) },
              { label: "Customer", key: "customer_name" },
              { label: "Type", render: r => <Badge label={r.type.toUpperCase()} color={txColors[r.type] || "#6b7280"} /> },
              { label: "Item", render: r => cylinderTypes.find(c => c.id === r.cylinder_type)?.label || r.cylinder_type },
              { label: "Qty", key: "qty", align: "right" },
              { label: "Notes", key: "notes" },
            ]}
            data={recentTx || []}
            emptyMsg="No transactions recorded yet"
          />
        </Card>
      </div>
    </div>
  );
}

// ==================== TRACKING ====================
function TrackingView({ customers, cylinderTypes }) {
  const [filterCustomer, setFilterCustomer] = useState("");
  const { data: onHand } = useApi(() => api.getOnHand(filterCustomer || undefined), [filterCustomer]);
  const { data: history } = useApi(
    () => filterCustomer ? api.getTransactions({ customer_id: filterCustomer, limit: 20 }) : Promise.resolve([]),
    [filterCustomer]
  );

  const txColors = { delivery: STATUS_COLORS.delivered, return: STATUS_COLORS.returned, sale: "#8b5cf6" };

  return (
    <div>
      <PageTitle title="Cylinder Tracking" subtitle="See what's on-hand at each customer site (excludes services)" />
      <div style={{ marginBottom: 20, maxWidth: 320 }}>
        <Select label="Filter by Customer" value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}>
          <option value="">All Customers</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>On-Hand Cylinders</h3>
        <Table
          columns={[
            { label: "Customer", render: r => <span style={{ fontWeight: 600 }}>{r.customer_name}</span> },
            { label: "Cylinder Type", key: "cylinder_label" },
            { label: "On-Hand Qty", align: "right", render: r => <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: r.on_hand > 0 ? "#f59e0b" : "#4b5563" }}>{r.on_hand}</span> },
            { label: "Status", render: r => <Badge label={r.on_hand > 0 ? "ON SITE" : "CLEAR"} color={r.on_hand > 0 ? STATUS_COLORS.onsite : STATUS_COLORS.returned} /> },
          ]}
          data={onHand || []}
          emptyMsg="No cylinders currently on-hand"
        />
      </Card>
      {filterCustomer && (history || []).length > 0 && (
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Transaction History</h3>
          <Table
            columns={[
              { label: "Date", render: r => fmtDate(r.date) },
              { label: "Type", render: r => <Badge label={r.type.toUpperCase()} color={txColors[r.type] || "#6b7280"} /> },
              { label: "Item", render: r => cylinderTypes.find(c => c.id === r.cylinder_type)?.label || r.cylinder_type },
              { label: "Qty", key: "qty", align: "right" },
              { label: "Notes", key: "notes" },
            ]}
            data={history || []}
            emptyMsg="No transactions"
          />
        </Card>
      )}
    </div>
  );
}

// ==================== BILLING ====================
function BillingView() {
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const { data: billing, loading } = useApi(() => api.getBilling(month), [month]);

  return (
    <div>
      <PageTitle title="Monthly Billing" subtitle="Cylinder rentals (on-hand) + service sales for the selected month" />
      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Billing Period</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #23262f", background: "#0f1117", color: "#e2e4ea", fontSize: 13, fontFamily: "inherit" }} />
        </div>
        {billing && <StatCard label="Total Billable" value={fmtCurrency(billing.grand_total)} accent="#ef4444" />}
      </div>
      {loading && <div style={{ color: "#6b7280" }}>Calculating...</div>}
      {billing?.customers?.map(c => (
        <Card key={c.id} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</h3>
              {c.address && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{c.address}</div>}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: "#f59e0b" }}>{fmtCurrency(c.total)}</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #23262f" }}>
                <th style={{ textAlign: "left", padding: "8px 0", color: "#6b7280", fontSize: 11, fontWeight: 600 }}>ITEM</th>
                <th style={{ textAlign: "center", padding: "8px 0", color: "#6b7280", fontSize: 11, fontWeight: 600 }}>TYPE</th>
                <th style={{ textAlign: "right", padding: "8px 0", color: "#6b7280", fontSize: 11, fontWeight: 600 }}>QTY</th>
                <th style={{ textAlign: "right", padding: "8px 0", color: "#6b7280", fontSize: 11, fontWeight: 600 }}>PRICE</th>
                <th style={{ textAlign: "right", padding: "8px 0", color: "#6b7280", fontSize: 11, fontWeight: 600 }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {c.lines.map((l, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #1e2130" }}>
                  <td style={{ padding: "8px 0", color: "#d1d5db" }}>{l.label}</td>
                  <td style={{ padding: "8px 0", textAlign: "center" }}><Badge label={l.category === "service" ? "SALE" : "RENTAL"} color={l.category === "service" ? "#8b5cf6" : "#2563eb"} /></td>
                  <td style={{ padding: "8px 0", textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{l.qty}</td>
                  <td style={{ padding: "8px 0", textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                    {fmtCurrency(l.price)}
                    {l.is_override && <span style={{ fontSize: 9, marginLeft: 4, color: "#f59e0b" }}>●</span>}
                  </td>
                  <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "#f59e0b" }}>{fmtCurrency(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      {!loading && (!billing?.customers?.length) && (
        <Card><p style={{ textAlign: "center", color: "#4b5563", padding: 24 }}>No billable items for this period.</p></Card>
      )}
    </div>
  );
}

// ==================== PRICING ====================
function PricingView({ customers, cylinderTypes, pricing, reloadPricing, showToast }) {
  const [selectedCustomers, setSelectedCustomers] = useState([]);
  const [selectedType, setSelectedType] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [search, setSearch] = useState("");
  const [editingCell, setEditingCell] = useState(null);
  const [cellValue, setCellValue] = useState("");

  const pricingMap = useMemo(() => {
    const map = {};
    for (const p of pricing) map[`${p.customer_id}__${p.cylinder_type_id}`] = p.price;
    return map;
  }, [pricing]);

  const toggleCustomer = (id) => setSelectedCustomers(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  const selectAll = () => setSelectedCustomers(customers.map(c => c.id));
  const selectNone = () => setSelectedCustomers([]);

  const applyBulk = async () => {
    if (!selectedType || !newPrice || !selectedCustomers.length) return;
    try {
      await api.bulkSetPrice(selectedCustomers, selectedType, Number(newPrice));
      reloadPricing();
      showToast(`Price updated for ${selectedCustomers.length} customer(s)`);
    } catch (e) { showToast(e.message, "error"); }
  };

  const saveCell = async (custId, typeId) => {
    const val = Number(cellValue);
    if (!isNaN(val) && val >= 0) {
      try {
        await api.setPrice(custId, typeId, val);
        reloadPricing();
      } catch (e) { showToast(e.message, "error"); }
    }
    setEditingCell(null);
  };

  const resetCell = async (custId, typeId) => {
    try {
      await api.resetPrice(custId, typeId);
      reloadPricing();
      showToast("Reset to default");
    } catch (e) { showToast(e.message, "error"); }
  };

  const resetAllForCustomer = async (custId) => {
    try {
      await api.resetAllPricing(custId);
      reloadPricing();
      showToast("All prices reset to default");
    } catch (e) { showToast(e.message, "error"); }
  };

  const filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const matrix = customers.map(c => {
    const prices = {};
    let hasCustom = false;
    cylinderTypes.forEach(ct => {
      const key = `${c.id}__${ct.id}`;
      const isCustom = pricingMap[key] !== undefined;
      if (isCustom) hasCustom = true;
      prices[ct.id] = { value: isCustom ? pricingMap[key] : ct.default_price, isCustom };
    });
    return { ...c, prices, hasCustom };
  });

  return (
    <div>
      <PageTitle title="Pricing Manager" subtitle="Set customer-specific pricing — overrides default cylinder rates" />
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 24 }}>
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Bulk Price Update</h3>
          <Select label="Cylinder Type" value={selectedType} onChange={e => setSelectedType(e.target.value)}>
            <option value="">Select type...</option>
            {cylinderTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.label} (def: {fmtCurrency(ct.default_price)})</option>)}
          </Select>
          <Input label="Override Price" type="number" step="0.01" min="0" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="e.g. 42.50" />
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" }}>Customers ({selectedCustomers.length})</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={selectAll} style={{ fontSize: 11, color: "#60a5fa", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>All</button>
                <button onClick={selectNone} style={{ fontSize: 11, color: "#6b7280", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>None</button>
              </div>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #23262f", background: "#0f1117", color: "#e2e4ea", fontSize: 12, outline: "none", fontFamily: "inherit", marginBottom: 8 }} />
            <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid #23262f", borderRadius: 8, background: "#0f1117" }}>
              {filteredCustomers.map(c => {
                const checked = selectedCustomers.includes(c.id);
                return (
                  <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #1a1d27", background: checked ? "#23262f" : "transparent" }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCustomer(c.id)} style={{ accentColor: "#f59e0b" }} />
                    <span style={{ fontSize: 12, color: checked ? "#f3f4f6" : "#9ca3af" }}>{c.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <Btn onClick={applyBulk} disabled={!selectedType || !newPrice || !selectedCustomers.length} style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>
            Apply to {selectedCustomers.length} Customer{selectedCustomers.length !== 1 ? "s" : ""}
          </Btn>
        </Card>

        <Card style={{ overflow: "auto" }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Pricing Matrix <span style={{ fontSize: 11, fontWeight: 400, color: "#6b7280" }}>— click to edit, right-click to reset</span></h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #23262f", color: "#6b7280", fontSize: 10, fontWeight: 600, position: "sticky", left: 0, background: "#1a1d27", zIndex: 1, minWidth: 160 }}>CUSTOMER</th>
                  {cylinderTypes.map(ct => (
                    <th key={ct.id} style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #23262f", color: "#6b7280", fontSize: 10, fontWeight: 600, minWidth: 100, whiteSpace: "nowrap" }}>
                      {ct.label}
                      <div style={{ fontSize: 9, fontWeight: 400, color: "#4b5563", marginTop: 2 }}>def: {fmtCurrency(ct.default_price)}</div>
                    </th>
                  ))}
                  <th style={{ textAlign: "center", padding: "8px", borderBottom: "1px solid #23262f", color: "#6b7280", fontSize: 10, minWidth: 50 }}>RESET</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map(c => (
                  <tr key={c.id} style={{ borderBottom: "1px solid #1e2130" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 600, color: "#d1d5db", position: "sticky", left: 0, background: "#1a1d27", zIndex: 1 }}>{c.name}</td>
                    {cylinderTypes.map(ct => {
                      const cellKey = `${c.id}__${ct.id}`;
                      const info = c.prices[ct.id];
                      const isEditing = editingCell === cellKey;
                      return (
                        <td key={ct.id} style={{ textAlign: "right", padding: "4px 6px" }}>
                          {isEditing ? (
                            <input autoFocus type="number" step="0.01" min="0" value={cellValue}
                              onChange={e => setCellValue(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") saveCell(c.id, ct.id); if (e.key === "Escape") setEditingCell(null); }}
                              onBlur={() => saveCell(c.id, ct.id)}
                              style={{ width: 72, padding: "4px 6px", borderRadius: 4, border: "1px solid #f59e0b", background: "#0f1117", color: "#f59e0b", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", textAlign: "right", outline: "none" }}
                            />
                          ) : (
                            <div
                              onClick={() => { setEditingCell(cellKey); setCellValue(String(info.value)); }}
                              onContextMenu={e => { e.preventDefault(); if (info.isCustom) resetCell(c.id, ct.id); }}
                              style={{ cursor: "pointer", padding: "4px 6px", borderRadius: 4, fontFamily: "'JetBrains Mono', monospace", color: info.isCustom ? "#f59e0b" : "#6b7280", background: info.isCustom ? "#f59e0b0a" : "transparent", border: `1px solid ${info.isCustom ? "#f59e0b22" : "transparent"}` }}
                              title={info.isCustom ? "Custom — right-click to reset" : "Default — click to override"}
                            >
                              {fmtCurrency(info.value)}
                              {info.isCustom && <span style={{ fontSize: 9, marginLeft: 3, color: "#f59e0b" }}>●</span>}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: "center", padding: "4px 6px" }}>
                      {c.hasCustom && (
                        <button onClick={() => resetAllForCustomer(c.id)} style={{ background: "none", border: "1px solid #23262f", borderRadius: 4, padding: "3px 6px", cursor: "pointer", color: "#6b7280" }}>
                          <Icon d={Icons.undo} size={12} color="#6b7280" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, color: "#4b5563" }}>
            <span><span style={{ color: "#f59e0b" }}>●</span> Customer override</span>
            <span>Grey = default from Cylinder Types</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
