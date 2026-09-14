import { api } from "./client.js";

export const VIDEO_POLL_TIMEOUT_MS = 25 * 60 * 1000;
export const IMAGE_POLL_TIMEOUT_MS = 8 * 60 * 1000;

export function submitGenerate(payload) {
  return api.post("/generate", payload);
}

export function fetchGenerateTask(id) {
  return api.get(`/generate/tasks/${id}`);
}

export function pollGenerateTask(id, { interval = 2000, timeout = VIDEO_POLL_TIMEOUT_MS } = {}) {
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
          const stillGoing = task.status === "PENDING" || task.status === "RUNNING";
          reject(Object.assign(new Error(stillGoing ? "生成仍在进行" : "生成超时"), { task, stillGoing: true }));
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
