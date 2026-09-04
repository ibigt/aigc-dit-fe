import { api } from "./client.js";

export function loginRequest(payload) {
  return api.post("/auth/login", payload);
}

export function registerRequest(payload) {
  return api.post("/auth/register", payload);
}

export function fetchCurrentUser() {
  return api.get("/auth/me");
}

export function updateProfileRequest(payload) {
  return api.patch("/auth/profile", payload);
}
