import { api } from "./client.js";

export function fetchSessions() {
  return api.get("/sessions");
}

export function fetchSession(id) {
  return api.get(`/sessions/${id}`);
}

export function createSession(payload) {
  return api.post("/sessions", payload);
}

export function deleteSession(id) {
  return api.delete(`/sessions/${id}`);
}

export function fetchCreations(params = {}) {
  return api.get("/creations", { params });
}

export function fetchCreationProjects() {
  return api.get("/creations/projects");
}

export function saveCreationToAsset(id) {
  return api.post(`/creations/${id}/to-asset`);
}

export function deleteCreation(id) {
  return api.delete(`/creations/${id}`);
}
