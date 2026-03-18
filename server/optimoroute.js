/**
 * OptimoRoute API Integration for CylinderTrack
 * Your orders use 'id' (not 'orderNo'), so all lookups use the id field.
 */
const fetch = require("node-fetch");
const BASE_URL = "https://api.optimoroute.com/v1";

class OptimoRouteClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  // Search orders by date range (corrected params — no includeCompletionDetails)
  async searchOrders(dateFrom, dateTo) {
    const url = `${BASE_URL}/search_orders?key=${this.apiKey}`;
    const body = {
      dateRange: { from: dateFrom, to: dateTo },
      includeOrderData: true,
      includeScheduleInformation: true,
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`search_orders failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  // Get routes for a specific date
  async getRoutes(date, driverSerial) {
    let url = `${BASE_URL}/get_routes?key=${this.apiKey}&date=${date}`;
    if (driverSerial) url += `&driverSerial=${driverSerial}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`get_routes failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  // Get completion details by orderNo
  async getCompletionDetails(orderNos) {
    const url = `${BASE_URL}/get_completion_details?key=${this.apiKey}`;
    const body = { orders: orderNos.map(no => ({ orderNo: no })) };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`get_completion_details failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  // Get completion details by id (for orders without orderNo)
  async getCompletionDetailsById(ids) {
    const url = `${BASE_URL}/get_completion_details?key=${this.apiKey}`;
    const body = { orders: ids.map(id => ({ id })) };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`get_completion_details (by id) failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  // Get order data by orderNo
  async getOrders(orderNos) {
    const url = `${BASE_URL}/get_orders?key=${this.apiKey}`;
    const body = { orders: orderNos.map(no => ({ orderNo: no })) };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`get_orders failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  // Get order data by id (for orders without orderNo)
  async getOrdersById(ids) {
    const url = `${BASE_URL}/get_orders?key=${this.apiKey}`;
    const body = { orders: ids.map(id => ({ id })) };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`get_orders (by id) failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  // Create order in OptimoRoute
  async createOrder({ customerName, address, payment, order, notes, date }) {
    const url = `${BASE_URL}/create_order?key=${this.apiKey}`;
    const body = {
      operation: "CREATE",
      orderNo: "",
      type: "T",
      date: date,
      duration: 5,
      location: {
        address: address,
        locationName: address,
        acceptPartialMatch: true,
        acceptMultipleResults: true,
      },
      notes: notes || "",
      customFields: {
        customer_name: customerName || "",
        payment: payment || "",
        order: order || "",
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`create_order failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  // Update existing order in OptimoRoute using SYNC operation (by id)
  async syncOrder({ id, customerName, address, payment, order, notes, date }) {
    const url = `${BASE_URL}/create_order?key=${this.apiKey}`;
    const body = {
      operation: "SYNC",
      id: id,
      type: "T",
      date: date,
      duration: 5,
      location: {
        address: address,
        locationName: address,
        acceptPartialMatch: true,
        acceptMultipleResults: true,
      },
      notes: notes || "",
      customFields: {
        customer_name: customerName || "",
        payment: payment || "",
        order: order || "",
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`sync_order failed: ${res.status} ${res.statusText}`);
    return res.json();
  }

  // Test connection
  async testConnection() {
    try {
      const today = new Date().toISOString().split("T")[0];
      await this.getRoutes(today);
      return { success: true, message: "Connected to OptimoRoute successfully" };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = { OptimoRouteClient };
