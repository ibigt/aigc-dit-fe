import { uploadAsset } from "../api/assets.js";

export async function materialToAsset(material) {
  if (!material) return null;
  if (material.storageKey) return material;
  if (material.file instanceof File) {
    return mergeMaterial(material, await uploadAsset(material.file));
  }
  if (material.url) {
    const blob = await fetch(material.url).then((response) => {
      if (!response.ok) throw new Error("无法读取参考素材");
      return response.blob();
    });
    const type = blob.type || (material.type === "video" ? "video/mp4" : "image/png");
    const file = new File([blob], material.name || `ref-${Date.now()}`, { type });
    return mergeMaterial(material, await uploadAsset(file));
  }
  throw new Error("参考素材缺少文件");
}

function mergeMaterial(material, asset) {
  return {
    ...material,
    id: asset.id,
    name: asset.name || material.name,
    type: asset.type || material.type,
    storageKey: asset.storageKey,
    url: asset.src || asset.url || material.url,
    poster: asset.poster || material.poster,
  };
}

export function taskToResultMessage(task) {
  const creations = task.creations || [];
  const first = creations[0] || {};
  return {
    type: "result",
    text: task.category === "video"
      ? `已完成 ${creations.length || task.copies || 1} 个视频副本，可继续编辑或保存`
      : `已完成 ${creations.length || task.copies || 1} 张图片，可继续编辑或保存`,
    creations,
    media: {
      type: first.type || task.category,
      src: first.src || first.url,
      poster: first.poster || first.posterUrl,
      title: first.title,
    },
    model: task.modelName || "模型",
    creationType: task.category === "video" ? "视频" : "图片",
    createdAt: formatClock(task.finishedAt || task.createdAt),
    elapsed: elapsedOf(task),
    credits: task.creditCost || 0,
    ratio: first.ratio || task.params?.ratio || "—",
    resolution: first.resolution || task.params?.resolution || "—",
    duration: task.category === "video" ? `${task.params?.durationSec || first.durationSec || "—"} 秒` : "—",
  };
}

export function tasksToMessages(tasks = []) {
  const messages = [];
  for (const task of tasks) {
    if (task.prompt) messages.push({ type: "user", text: task.prompt });
    if (task.status === "SUCCEEDED") messages.push(taskToResultMessage(task));
    if (task.status === "FAILED") {
      messages.push({
        type: "result",
        text: task.errorMessage || "生成失败，积分已退还",
        error: true,
        model: task.modelName || "模型",
        creationType: task.category === "video" ? "视频" : "图片",
        createdAt: formatClock(task.finishedAt || task.createdAt),
        elapsed: "—",
        credits: 0,
        ratio: "—",
        resolution: "—",
        duration: "—",
        media: { type: "image", src: "", title: "失败" },
        creations: [],
      });
    }
  }
  return messages;
}

function formatClock(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function elapsedOf(task) {
  if (!task.createdAt) return "—";
  const end = task.finishedAt ? new Date(task.finishedAt) : new Date();
  const start = new Date(task.createdAt);
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  return `${seconds} 秒`;
}
