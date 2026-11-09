import { api } from "./client.js";

export function uploadAsset(file, { name, onProgress } = {}) {
  const data = new FormData();
  data.append("file", file);
  if (name?.trim()) data.append("name", name.trim());
  return api.post("/assets", data, {
    // 视频素材上限 200MB，全局 30s timeout 会在慢速上传时误杀；只放宽上传请求
    timeout: 180000,
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
