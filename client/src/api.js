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
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

// Auth
export const getAuthStatus = () => request("/auth/status");
export const login = (username, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
export const setup = (username, password) => request("/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) });
export const logout = () => request("/auth/logout", { method: "POST" });
export const changePassword = (currentPassword, newPassword) => request("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
export const addUser = (username, password, role) => request("/auth/add-user", { method: "POST", body: JSON.stringify({ username, password, role }) });

// Customers
export const getCustomers = () => request("/customers");
export const createCustomer = (data) => request("/customers", { method: "POST", body: JSON.stringify(data) });
export const updateCustomer = (id, data) => request(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCustomer = (id) => request(`/customers/${id}`, { method: "DELETE" });

// Cylinder Types
export const getCylinderTypes = () => request("/cylinder-types");
export const createCylinderType = (data) => request("/cylinder-types", { method: "POST", body: JSON.stringify(data) });
export const updateCylinderType = (id, data) => request(`/cylinder-types/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCylinderType = (id) => request(`/cylinder-types/${id}`, { method: "DELETE" });

// Transactions
export const getTransactions = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/transactions${qs ? `?${qs}` : ""}`);
};
export const createTransaction = (data) => request("/transactions", { method: "POST", body: JSON.stringify(data) });

// On-hand
export const getOnHand = (customerId) => {
  const qs = customerId ? `?customer_id=${customerId}` : "";
  return request(`/on-hand${qs}`);
};

// Pricing
export const getPricing = () => request("/pricing");
export const setPrice = (customerId, cylinderTypeId, price) =>
  request(`/pricing/${customerId}/${cylinderTypeId}`, { method: "PUT", body: JSON.stringify({ price }) });
export const bulkSetPrice = (customer_ids, cylinder_type_id, price) =>
  request("/pricing/bulk", { method: "POST", body: JSON.stringify({ customer_ids, cylinder_type_id, price }) });
export const resetPrice = (customerId, cylinderTypeId) =>
  request(`/pricing/${customerId}/${cylinderTypeId}`, { method: "DELETE" });
export const resetAllPricing = (customerId) =>
  request(`/pricing/${customerId}`, { method: "DELETE" });

// Billing
export const getBilling = (month) => request(`/billing?month=${month}`);

// Dashboard Stats
export const getStats = () => request("/stats");
