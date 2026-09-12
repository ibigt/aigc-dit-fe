import { api } from "./client.js";

export function uploadAsset(file) {
  const data = new FormData();
  data.append("file", file);
  return api.post("/assets", data);
}

export function fetchAssets(params = {}) {
  return api.get("/assets", { params });
}

export function deleteAsset(id) {
  return api.delete(`/assets/${id}`);
}
