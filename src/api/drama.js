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

export function fetchDramaEpisode(id) {
  return api.get(`/drama/episodes/${id}`);
}

export function updateDramaEpisode(id, payload) {
  return api.put(`/drama/episodes/${id}`, payload);
}

export function fetchDramaTextModels() {
  return api.get("/drama/text-models");
}
