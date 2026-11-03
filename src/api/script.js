import { api, TOKEN_KEY } from "./client.js";

export function fetchScriptTasks(query = "") {
  return api.get("/scripts/tasks", { params: query ? { q: query } : undefined });
}

export function fetchScriptTask(id) {
  return api.get(`/scripts/tasks/${id}`);
}

export function createScriptTask(payload) {
  return api.post("/scripts/tasks", payload);
}

export function saveScriptDocument(id, payload) {
  const body = typeof payload === "string" ? { document: payload } : payload;
  return api.put(`/scripts/tasks/${id}/document`, body);
}

export function updateScriptModel(id, modelId) {
  return api.put(`/scripts/tasks/${id}/model`, { modelId: Number(modelId) });
}

export function updateScriptTitle(id, title) {
  return api.put(`/scripts/tasks/${id}/title`, { title });
}

export function generateScriptTask(id) {
  return api.post(`/scripts/tasks/${id}/generate`, null, { timeout: 12 * 60 * 1000 });
}

export function completeScriptTask(id) {
  return api.post(`/scripts/tasks/${id}/complete`);
}

export function deleteScriptTask(id) {
  return api.delete(`/scripts/tasks/${id}`);
}

export function repairScriptStructure(id) {
  return api.post(`/scripts/tasks/${id}/structure`, null, { timeout: 6 * 60 * 1000 });
}

export function continueScriptTask(id) {
  return api.post(`/scripts/tasks/${id}/continue`, null, { timeout: 12 * 60 * 1000 });
}

export function createDramaFromScript(id) {
  return api.post(`/scripts/tasks/${id}/create-drama`);
}

export function fetchScriptModels() {
  return api.get("/drama/text-models");
}

export async function streamScriptChat(id, payload, { onEvent, signal } = {}) {
  const token = window.localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`/api/scripts/tasks/${id}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const body = await response.json();
      message = body.message || message;
    } catch {
      // keep status fallback
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("浏览器不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) onEvent?.(event);
    }
  }
  const last = parseSseBlock(buffer);
  if (last) onEvent?.(last);
}

function parseSseBlock(block) {
  if (!block.trim()) return null;
  let type = "message";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  const raw = data.join("\n");
  try {
    return { type, data: JSON.parse(raw) };
  } catch {
    return { type, data: raw };
  }
}
