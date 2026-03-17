const BASE = "/api";

let onAuthFail = null;
export function setAuthFailHandler(fn) { onAuthFail = fn; }

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "include",
    ...options,
  });
  if (res.status === 401) {
    if (onAuthFail) onAuthFail();
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

const api = {
  // Auth
  authStatus: () => request("/auth/status"),
  setup: (username, password) => request("/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  getUsers: () => request("/auth/users"),
  addUser: (username, password, role) => request("/auth/add-user", { method: "POST", body: JSON.stringify({ username, password, role }) }),
  changePassword: (userId, newPassword) => request("/auth/change-password", { method: "POST", body: JSON.stringify({ userId, newPassword }) }),

  // Customers
  getCustomers: () => request("/customers"),
  createCustomer: (data) => request("/customers", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id, data) => request(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCustomer: (id) => request(`/customers/${id}`, { method: "DELETE" }),

  // Cylinder Types
  getCylinderTypes: () => request("/cylinder-types"),
  createCylinderType: (data) => request("/cylinder-types", { method: "POST", body: JSON.stringify(data) }),
  updateCylinderType: (id, data) => request(`/cylinder-types/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCylinderType: (id) => request(`/cylinder-types/${id}`, { method: "DELETE" }),

  // Transactions
  getTransactions: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/transactions${qs ? "?" + qs : ""}`);
  },
  createTransaction: (data) => request("/transactions", { method: "POST", body: JSON.stringify(data) }),
  deleteTransaction: (id) => request(`/transactions/${id}`, { method: "DELETE" }),

  // On-hand
  getOnHand: () => request("/on-hand"),

  // Pricing
  getPricing: () => request("/pricing"),
  setPrice: (custId, typeId, price) => request(`/pricing/${custId}/${typeId}`, { method: "PUT", body: JSON.stringify({ price }) }),
  deletePrice: (custId, typeId) => request(`/pricing/${custId}/${typeId}`, { method: "DELETE" }),
  bulkPrice: (data) => request("/pricing/bulk", { method: "POST", body: JSON.stringify(data) }),

  // Billing
  getBilling: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/billing?${qs}`);
  },

  // Stats
  getStats: () => request("/stats"),

  // Search
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),

  // Settings
  getSettings: () => request("/settings"),
  updateSettings: (data) => request("/settings", { method: "PUT", body: JSON.stringify(data) }),

  // Backup
  getBackup: () => request("/backup"),
  restore: (data) => request("/restore", { method: "POST", body: JSON.stringify(data) }),

  // OptimoRoute
  orTestConnection: () => request("/optimoroute/test", { method: "POST" }),
  orGetRoutes: (date) => request(`/optimoroute/routes?date=${date}`),
  orSearch: (from, to) => request(`/optimoroute/search?from=${from}&to=${to}`),
  orGetCompletion: (orderNos) => request("/optimoroute/completion", { method: "POST", body: JSON.stringify({ orderNos }) }),
  orSync: (dateFrom, dateTo) => request("/optimoroute/sync", { method: "POST", body: JSON.stringify({ dateFrom, dateTo }) }),
  orDebug: (dateFrom, dateTo) => request("/optimoroute/debug", { method: "POST", body: JSON.stringify({ dateFrom, dateTo }) }),
  orGetUnmatched: () => request("/optimoroute/unmatched"),
  orImportManual: (data) => request("/optimoroute/import-manual", { method: "POST", body: JSON.stringify(data) }),
  orGetSyncLog: () => request("/optimoroute/sync-log"),
};

export default api;
