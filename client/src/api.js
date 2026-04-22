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
    const body = await res.json().catch(() => ({}));
    // Only redirect to login screen for protected-route 401s, not failed login attempts
    if (onAuthFail && !path.startsWith("/auth/")) onAuthFail();
    throw new Error(body.error || "Not authenticated");
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
  updateUser: (id, data) => request(`/auth/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  setUserActive: (id, active) => request(`/auth/users/${id}/active`, { method: "PATCH", body: JSON.stringify({ active }) }),

  // Customers
  getCustomers: (params) => request(`/customers${params?.include_archived ? "?include_archived=1" : ""}`),
  archiveCustomer: (id, archived) => request(`/customers/${id}/archive`, { method: "PATCH", body: JSON.stringify({ archived }) }),
  createCustomer: (data) => request("/customers", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id, data) => request(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCustomer: (id) => request(`/customers/${id}`, { method: "DELETE" }),
  getCustomerOrders: (id) => request(`/customers/${id}/orders`),
  getCustomerOnHand: (id) => request(`/customers/${id}/on-hand`),
  getLastSalePrice: (id) => request(`/customers/${id}/last-sale-price`),
  importCustomers: (rows) => request("/admin/customers/import", { method: "POST", body: JSON.stringify({ rows }) }),
  importCylinderTypes: (rows) => request("/admin/cylinder-types/import", { method: "POST", body: JSON.stringify({ rows }) }),
  revealCC: (id) => request(`/customers/${id}/reveal-cc`),
  deleteCC: (id) => request(`/customers/${id}/cc`, { method: "DELETE" }),

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

  // Reports
  runReport: (name, params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/reports/${name}${qs ? "?" + qs : ""}`);
  },

  // Return-other summary and return-to-owner
  getReturnOtherSummary: () => request("/transactions/return-other-summary"),
  returnToOwner: (data) => request("/transactions/return-to-owner", { method: "POST", body: JSON.stringify(data) }),

  // On-hand
  getOnHand: () => request("/on-hand"),
  getOnHandAsAt: (date) => request(`/on-hand/as-at?date=${encodeURIComponent(date)}`),
  generateRentalInvoices: (date, customers) => request("/on-hand/generate-invoices", { method: "POST", body: JSON.stringify({ date, customers }) }),

  // Rental cycles
  getSaleCap: (custId, saleTypeId) => request(`/rentals/sale-cap/${custId}/${saleTypeId}`),
  initializeRentals: () => request("/rentals/initialize", { method: "POST" }),
  runDueRentals: () => request("/rentals/run-due", { method: "POST" }),
  generateRentalsForce: (customerIds) => request("/rentals/generate-now", { method: "POST", body: JSON.stringify({ customer_ids: customerIds || [] }) }),
  generateSalesForce: (customerIds) => request("/rentals/generate-sales-now", { method: "POST", body: JSON.stringify({ customer_ids: customerIds || [] }) }),

  // Email
  getEmailConfig: () => request("/email/config"),
  sendInvoiceEmail: (invoiceId, recipientOverride) => request(`/invoices/${invoiceId}/email`, { method: "POST", body: JSON.stringify({ recipient_override: recipientOverride || null }) }),
  createStripeCheckout: (invoiceId) => request(`/invoices/${invoiceId}/stripe-checkout`, { method: "POST" }),
  sendInvoiceEmailBulk: (invoiceIds) => request("/invoices/email-bulk", { method: "POST", body: JSON.stringify({ invoice_ids: invoiceIds }) }),
  getEmailLog: (limit) => request(`/admin/email-log${limit ? `?limit=${limit}` : ""}`),

  // Pricing
  getPricing: () => request("/pricing"),
  getCustomerPriceList: (custId) => request(`/pricing/customer/${custId}`),
  setPrice: (custId, typeId, data) => request(`/pricing/${custId}/${typeId}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePrice: (custId, typeId) => request(`/pricing/${custId}/${typeId}`, { method: "DELETE" }),
  bulkPrice: (data) => request("/pricing/bulk", { method: "POST", body: JSON.stringify(data) }),

  // Billing
  getBilling: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/billing?${qs}`);
  },

  // Stats
  getStats: () => request("/stats"),

  // Opening Balances
  addOpeningBalance: (data) => request("/opening-balance", { method: "POST", body: JSON.stringify(data) }),
  bulkOpeningBalance: (entries) => request("/opening-balance/bulk", { method: "POST", body: JSON.stringify({ entries }) }),

  // Orders
  getOrders: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/orders${qs ? "?" + qs : ""}`);
  },
  createOrder: (data) => request("/orders", { method: "POST", body: JSON.stringify(data) }),
  updateOrder: (id, data) => request(`/orders/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteOrder: (id) => request(`/orders/${id}`, { method: "DELETE" }),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: "POST" }),
  confirmPayment: (id) => request(`/orders/${id}/confirm-payment`, { method: "POST" }),
  resendOrder: (id) => request(`/orders/${id}/resend`, { method: "POST" }),
  matchCreditToOrder: (id) => request(`/orders/${id}/match-credit`, { method: "POST" }),
  // Round 3
  pushOrderToOptimo: (id) => request(`/orders/${id}/push-to-optimo`, { method: "POST" }),
  pullOptimoStatus: (id) => request(`/orders/${id}/pull-optimo`, { method: "POST" }),
  markLineDelivered: (orderId, lineId, data) => request(`/orders/${orderId}/lines/${lineId}/deliver`, { method: "POST", body: JSON.stringify(data || {}) }),
  cancelLine: (orderId, lineId) => request(`/orders/${orderId}/lines/${lineId}/cancel`, { method: "POST" }),
  // 3.0.10: Manual completion for Optimo failsafe (Del/Ret/Roth per line)
  manualCompletion: (orderId, lineId, payload) => request(`/orders/${orderId}/lines/${lineId}/manual-completion`, { method: "POST", body: JSON.stringify(payload) }),
  // 3.0.12: Batch version — submit all per-line completions at once
  manualCompletionBatch: (orderId, payload) => request(`/orders/${orderId}/manual-completion-batch`, { method: "POST", body: JSON.stringify(payload) }),
  getRound3Settings: () => request("/admin/settings/round3"),
  updateRound3Settings: (data) => request("/admin/settings/round3", { method: "PUT", body: JSON.stringify(data) }),
  lookupPrice: (customer_id, order_detail) => request(`/orders/lookup-price?customer_id=${encodeURIComponent(customer_id || "")}&order_detail=${encodeURIComponent(order_detail || "")}`),
  getCustomerCylinderPrice: (custId, ctId) => request(`/pricing/customer/${custId}/cylinder/${ctId}`),
  getOrder: (id) => request(`/orders/${id}`),
  getOrderCompletions: (id) => request(`/orders/${id}/completions`),
  updateCustomerPrice: (data) => request("/orders/update-customer-price", { method: "POST", body: JSON.stringify(data) }),

  // Invoices
  getInvoices: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/invoices${qs ? "?" + qs : ""}`);
  },
  getInvoice: (id) => request(`/invoices/${id}`),
  recordInvoicePayment: (id, data) => request(`/invoices/${id}/payment`, { method: "POST", body: JSON.stringify(data) }),

  // Customer balance
  getCustomerBalance: (id) => request(`/customers/${id}/balance`),

  // Account Statement
  getCustomerStatement: (id, fromDate, toDate) =>
    request(`/customers/${id}/statement?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`),
  getCustomerStatementPdfUrl: (id, fromDate, toDate) =>
    `/api/customers/${id}/statement/pdf?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`,
  emailStatement: (id, fromDate, toDate, recipientOverride) =>
    request(`/customers/${id}/statement/email`, { method: "POST", body: JSON.stringify({ from_date: fromDate, to_date: toDate, recipient_override: recipientOverride || null }) }),
  recalculateAllBalances: () => request("/customers/recalculate-balances", { method: "POST" }),

  // Credit notes
  getCredits: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/credits${qs ? "?" + qs : ""}`);
  },
  createCredit: (data) => request("/credits", { method: "POST", body: JSON.stringify(data) }),
  approveCredit: (id) => request(`/credits/${id}/approve`, { method: "POST" }),
  rejectCredit: (id) => request(`/credits/${id}/reject`, { method: "POST" }),

  // Easy Order
  easyOrderPrep: (customerId) => request(`/easy-order/prep/${encodeURIComponent(customerId)}`),
  addCustomerNote: (id, text) => request(`/customers/${id}/internal-note`, { method: "POST", body: JSON.stringify({ text }) }),

  // Search
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),

  // Settings
  getSettings: () => request("/settings"),
  updateSettings: (data) => request("/settings", { method: "PUT", body: JSON.stringify(data) }),
  getBillingSchedule: () => request("/settings/billing-schedule"),
  updateBillingSchedule: (data) => request("/settings/billing-schedule", { method: "PUT", body: JSON.stringify(data) }),

  // Audit log (admin only)
  getAuditLog: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/audit-log${qs ? "?" + qs : ""}`);
  },
  getAuditFacets: () => request("/audit-log/facets"),
  getAuditRecordHistory: (table, id) => request(`/audit-log/record/${encodeURIComponent(table)}/${encodeURIComponent(id)}`),

  // Backup (full — all tables)
  // Note: getBackup is kept for backward compat but the BackupRestore
  // component hits /api/backup directly to get a streamable blob.
  getBackup: () => request("/backup"),
  getBackupCounts: () => request("/backup/counts"),
  validateBackup: (data) => request("/backup/validate", { method: "POST", body: JSON.stringify(data) }),
  restoreBackup: (data) => request("/restore", { method: "POST", body: JSON.stringify(data) }),
  restore: (data) => request("/restore", { method: "POST", body: JSON.stringify(data) }), // legacy alias

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
