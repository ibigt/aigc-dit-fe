import { api } from "./client.js";

export function listWorkflows(params) {
  return api.get("/workflows", { params });
}

export function getWorkflow(id) {
  return api.get(`/workflows/${id}`);
}

export function createWorkflowRecord(body) {
  return api.post("/workflows", body);
}

export function updateWorkflowRecord(id, body) {
  return api.put(`/workflows/${id}`, body);
}

export function removeWorkflow(id) {
  return api.delete(`/workflows/${id}`);
}

export function startWorkflowRun(body) {
  return api.post("/workflows/runs", body);
}

export function getWorkflowRun(id, { signal } = {}) {
  return api.get(`/workflows/runs/${id}`, { signal });
}

export function getLatestWorkflowRun(id, { signal } = {}) {
  return api.get(`/workflows/${id}/runs/latest`, { signal });
}

export function getWorkflowRuntimeSnapshot(id, { signal } = {}) {
  return api.get(`/workflows/${id}/runtime`, { signal });
}
