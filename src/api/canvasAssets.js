import { api } from "./client.js";

/** 画布资产（V1C20 1.3）：保存的是节点配置快照，可跨画布复用。 */
export function fetchCanvasAssets() {
  return api.get("/canvas-assets");
}

export function getCanvasAsset(id) {
  return api.get(`/canvas-assets/${id}`);
}

export function saveCanvasAsset({ name, graph }) {
  return api.post("/canvas-assets", { name, graph });
}

export function deleteCanvasAsset(id) {
  return api.delete(`/canvas-assets/${id}`);
}
