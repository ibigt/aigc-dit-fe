import { api, TOKEN_KEY } from "./client.js";

export function fetchDashboard(days = 14) {
  return api.get("/admin/dashboard", { params: { days } });
}

export function fetchAdminUsers(params = {}) {
  return api.get("/admin/users", { params: { pageNum: 1, pageSize: 100, ...params } });
}

export function createAdminUser(payload) {
  return api.post("/admin/users", payload);
}

export function updateAdminUser(id, payload) {
  return api.put(`/admin/users/${id}`, payload);
}

export function changeAdminUserStatus(id, status) {
  return api.patch(`/admin/users/${id}/status`, { status });
}

export function resetAdminUserPassword(id) {
  return api.post(`/admin/users/${id}/reset-password`);
}

export function deleteAdminUser(id) {
  return api.delete(`/admin/users/${id}`);
}

export function fetchAdminRecharges(params = {}) {
  return api.get("/admin/recharges", { params: { pageNum: 1, pageSize: 50, ...params } });
}

export function fetchAdminRechargeSummary() {
  return api.get("/admin/recharges/summary");
}

export function fetchAdminTextUsage(params = {}) {
  return api.get("/admin/text-usage", { params: { pageNum: 1, pageSize: 20, days: 30, ...params } });
}

export function fetchAdminTextUsageSummary(params = {}) {
  return api.get("/admin/text-usage/summary", { params: { days: 30, ...params } });
}

export function fetchModelObservability(params = {}) {
  return api.get("/admin/model-observability", { params: { days: 7, ...params } });
}

export function fetchAdapterCatalog() {
  return api.get("/admin/models/adapters");
}

export function fetchAdminModels(params = {}) {
  return api.get("/admin/models", { params });
}

export function createAdminModel(payload) {
  return api.post("/admin/models", payload);
}

export function updateAdminModel(id, payload) {
  return api.put(`/admin/models/${id}`, payload);
}

export function changeAdminModelEnabled(id, enabled) {
  return api.patch(`/admin/models/${id}/enabled`, { enabled });
}

export function deleteAdminModel(id) {
  return api.delete(`/admin/models/${id}`);
}

export function testAdminModelConnection(payload) {
  return api.post("/admin/models/test-connection", payload, { timeout: 45000 });
}

export function fetchArkReviewCredential() {
  return api.get("/admin/models/review-credential");
}

export function saveArkReviewCredential(payload) {
  return api.put("/admin/models/review-credential", payload);
}

export function fetchAdminRequests(params = {}) {
  return api.get("/admin/requests", { params: { pageNum: 1, pageSize: 20, hours: 24, ...params } });
}

export async function exportAdminRequests(params = {}) {
  const token = window.localStorage.getItem(TOKEN_KEY);
  const search = new URLSearchParams();
  Object.entries({ hours: 24, ...params }).forEach(([key, value]) => {
    if (value != null && value !== "") {
      search.set(key, String(value));
    }
  });
  const response = await fetch(`/api/admin/requests/export?${search.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    let message = "导出日志失败";
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "request-logs.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function fetchAdminQueue(params = {}) {
  return api.get("/admin/queue", { params: { pageNum: 1, pageSize: 20, days: 7, ...params } });
}

export function fetchAdminQueueSummary() {
  return api.get("/admin/queue/summary");
}

export function retryAdminQueueTask(id) {
  return api.post(`/admin/queue/${id}/retry`);
}

export function cancelAdminQueueTask(id) {
  return api.post(`/admin/queue/${id}/cancel`);
}
