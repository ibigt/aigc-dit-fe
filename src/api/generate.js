import { api } from "./client.js";

export function submitGenerate(payload) {
  return api.post("/generate", payload);
}

export function fetchGenerateTask(id) {
  return api.get(`/generate/tasks/${id}`);
}

export function pollGenerateTask(id, { interval = 800, timeout = 180000 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const task = await fetchGenerateTask(id);
        if (task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "CANCELLED") {
          resolve(task);
          return;
        }
        if (Date.now() - started > timeout) {
          reject(new Error("生成超时"));
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
