import { api } from "./client.js";

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
  return api.post("/admin/models/test-connection", payload, { timeout: 20000 });
}
