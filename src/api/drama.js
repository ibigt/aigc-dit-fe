import { api } from "./client.js";

export function fetchDramaStyles() {
  return api.get("/drama/styles");
}

export function fetchDramaSeries() {
  return api.get("/drama/series");
}

export function fetchDramaSeriesDetail(id) {
  return api.get(`/drama/series/${id}`);
}

export function createDramaSeries(payload) {
  return api.post("/drama/series", payload);
}

export function updateDramaSeries(id, payload) {
  return api.put(`/drama/series/${id}`, payload);
}

export function deleteDramaSeries(id) {
  return api.delete(`/drama/series/${id}`);
}

export function fetchDramaEpisode(id) {
  return api.get(`/drama/episodes/${id}`);
}

export function updateDramaEpisode(id, payload) {
  return api.put(`/drama/episodes/${id}`, payload);
}

export function fetchDramaTextModels() {
  return api.get("/drama/text-models");
}

export function fetchDramaImageModels() {
  return api.get("/drama/image-models");
}

export function bindDramaImageModel(seriesId, imageModelId) {
  return api.put(`/drama/series/${seriesId}/image-model`, { imageModelId });
}

/** 文本模型结构化输出较慢，单阶段最多 180s；须覆盖后端模型请求超时。 */
const SCRIPT_LLM_TIMEOUT_MS = 360000;

export function importDramaScript(episodeId, sourceText) {
  return api.post(`/drama/episodes/${episodeId}/script/import`, { sourceText }, { timeout: SCRIPT_LLM_TIMEOUT_MS });
}

export function generateDramaScript(episodeId, sourceText) {
  return api.post(`/drama/episodes/${episodeId}/script/generate`, { sourceText }, { timeout: SCRIPT_LLM_TIMEOUT_MS });
}

export function analyzeDramaScript(episodeId, payload) {
  return api.post(`/drama/episodes/${episodeId}/script/analyze`, payload, { timeout: 600000 });
}

export function saveDramaScript(episodeId, payload) {
  return api.put(`/drama/episodes/${episodeId}/script`, payload);
}

export function lockDramaScript(episodeId) {
  return api.post(`/drama/episodes/${episodeId}/script/lock`);
}

export function fetchDramaAssets(episodeId) {
  return api.get(`/drama/episodes/${episodeId}/assets`);
}

export function extractDramaAssets(episodeId) {
  return api.post(`/drama/episodes/${episodeId}/assets/extract`, null, { timeout: SCRIPT_LLM_TIMEOUT_MS });
}

export function createDramaAsset(episodeId, payload) {
  return api.post(`/drama/episodes/${episodeId}/assets`, payload);
}

export function updateDramaAsset(assetId, payload) {
  return api.put(`/drama/assets/${assetId}`, payload);
}

export function deleteDramaAsset(assetId) {
  return api.delete(`/drama/assets/${assetId}`);
}

export function uploadDramaAssetImage(assetId, file) {
  const data = new FormData();
  data.append("file", file);
  return api.post(`/drama/assets/${assetId}/upload`, data);
}

export function generateDramaAssetImage(assetId, payload = {}) {
  return api.post(`/drama/assets/${assetId}/generate`, payload);
}

export function fetchDramaAssetGenerateTask(assetId, taskId) {
  return api.get(`/drama/assets/${assetId}/generate/tasks/${taskId}`);
}

export function lockDramaAsset(assetId) {
  return api.post(`/drama/assets/${assetId}/lock`);
}

export function fetchDramaStoryboard(episodeId) {
  return api.get(`/drama/episodes/${episodeId}/storyboard`);
}

export function draftDramaStoryboard(episodeId, durationSec) {
  return api.post(`/drama/episodes/${episodeId}/storyboard/draft`, null, {
    timeout: SCRIPT_LLM_TIMEOUT_MS,
    params: { durationSec: durationSec || 15 },
  });
}

export function createDramaShot(episodeId, payload = {}) {
  return api.post(`/drama/episodes/${episodeId}/shots`, payload);
}

export function deleteDramaShot(shotId) {
  return api.delete(`/drama/shots/${shotId}`);
}

export function compileDramaStoryboard(episodeId) {
  return api.post(`/drama/episodes/${episodeId}/storyboard/compile`);
}

export function updateDramaShot(shotId, payload) {
  return api.put(`/drama/shots/${shotId}`, payload);
}

export function compileDramaShot(shotId) {
  return api.post(`/drama/shots/${shotId}/compile`);
}

export function confirmDramaShot(shotId) {
  return api.post(`/drama/shots/${shotId}/confirm`);
}

export function fetchDramaVideoModels() {
  return api.get("/drama/video-models");
}

export function bindDramaVideoModel(seriesId, videoModelId) {
  return api.put(`/drama/series/${seriesId}/video-model`, { videoModelId });
}

export function generateDramaShot(shotId) {
  return api.post(`/drama/shots/${shotId}/generate`);
}

export function fetchDramaShotGenerateTask(shotId, taskId) {
  return api.get(`/drama/shots/${shotId}/generate/tasks/${taskId}`);
}

/** 拼接可能走重编码，超时需覆盖后端 ffmpeg encode 上限。 */
const FILM_ASSEMBLE_TIMEOUT_MS = 16 * 60 * 1000;

export function fetchDramaFilm(episodeId) {
  return api.get(`/drama/episodes/${episodeId}/film`);
}

export function assembleDramaFilm(episodeId) {
  return api.post(`/drama/episodes/${episodeId}/film/assemble`, null, { timeout: FILM_ASSEMBLE_TIMEOUT_MS });
}

export function pollDramaAssetGenerate(assetId, taskId, { interval = 2000, timeout = 8 * 60 * 1000 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const result = await fetchDramaAssetGenerateTask(assetId, taskId);
        const status = result?.task?.status;
        if (status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED") {
          resolve(result);
          return;
        }
        if (Date.now() - started > timeout) {
          reject(Object.assign(new Error("生图仍在进行"), { result, stillGoing: true }));
          return;
        }
        window.setTimeout(tick, interval);
      } catch (error) {
        reject(error);
      }
    };
    tick();
  });
}

export function pollDramaShotGenerate(shotId, taskId, { interval = 3000, timeout = 15 * 60 * 1000 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const result = await fetchDramaShotGenerateTask(shotId, taskId);
        const status = result?.task?.status;
        if (status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED") {
          resolve(result);
          return;
        }
        if (Date.now() - started > timeout) {
          reject(Object.assign(new Error("出片仍在进行"), { result, stillGoing: true }));
          return;
        }
        window.setTimeout(tick, interval);
      } catch (error) {
        reject(error);
      }
    };
    tick();
  });
}
