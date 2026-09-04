import { api } from "./client.js";

export function fetchEnabledModels() {
  return api.get("/models");
}
