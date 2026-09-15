import { api } from "./client.js";

export function uploadAsset(file, { name, onProgress } = {}) {
  const data = new FormData();
  data.append("file", file);
  if (name?.trim()) data.append("name", name.trim());
  return api.post("/assets", data, {
    onUploadProgress: (event) => {
      if (!onProgress || !event.total) return;
      onProgress(Math.min(100, Math.round((event.loaded * 100) / event.total)));
    },
  });
}

export function fetchAssets(params = {}) {
  return api.get("/assets", { params });
}

export function deleteAsset(id) {
  return api.delete(`/assets/${id}`);
}
