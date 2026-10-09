import { uploadAsset } from "../api/assets.js";
import { storageKeyOf } from "./media.js";
import { reusePayloadOf } from "./reuseParams.js";

export const FRAMES_EMPTY_PROMPT_LABEL = "根据首帧自动生成";

/**
 * 清洗给用户看的提示词：去掉结构标签。创作记录默认也去掉 Picture 锚点。
 * 分镜面板传 keepPictures，把 Picture 锚点显示成 Picture 1，与下方参考图缩略图对齐。
 * 完整编译 prompt 仍存库，仅影响展示与回填文案。
 */
export function promptForDisplay(prompt, options = {}) {
  const keepPictures = Boolean(options.keepPictures);
  const lines = String(prompt || "").split(/\r?\n/);
  const visible = lines.map((source) => {
    const trimmed = source.trim();
    if (/^(Active References|Voice References|Identities):?$/i.test(trimmed)) return "";

    let line = source.replace(/^\s*(Must start|Must|Scene|Action|Dialogue|Continuity in|Continuity out|Cast|Duration|Audio):\s*/i, "");
    if (keepPictures) {
      line = line.replace(/<Picture\s+(\d+)>/gi, "Picture $1");
    } else {
      line = line
        .replace(/[（(]\s*<Picture\s+\d+>\s*[)）]/gi, "")
        .replace(/\s*=\s*<Picture\s+\d+>/gi, "")
        .replace(/<Picture\s+\d+>/gi, "");
    }
    line = line
      .replace(/<(Video|Audio)\s+\d+>/gi, "")
      .replace(/\b(\d+)\s+seconds?\b/gi, "$1 秒")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    return line;
  });

  return visible
    .filter((line, index) => line || (index > 0 && visible[index - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function creationTitleForDisplay(item) {
  const fromTitle = promptForDisplay(item?.title);
  if (fromTitle) return fromTitle;
  const fromPrompt = promptForDisplay(item?.prompt);
  if (fromPrompt) return fromPrompt.length > 24 ? fromPrompt.slice(0, 24) : fromPrompt;
  return "未命名作品";
}

export async function materialToAsset(material) {
  if (!material) return null;
  const storageKey = material.storageKey || storageKeyOf(material.url || material.src);
  if (storageKey) return { ...material, storageKey };
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
    prompt: task.prompt || first.prompt || userPromptOf(task) || "",
    text: task.category === "video"
      ? `已完成 ${creations.length || task.copies || 1} 个视频副本，可继续编辑或保存`
      : task.category === "audio"
        ? "语音已生成，可播放、下载或保存到素材库"
        : `已完成 ${creations.length || task.copies || 1} 张图片，可继续编辑或保存`,
    creations,
    media: {
      type: first.type || task.category,
      src: first.src || first.url,
      poster: first.poster || first.posterUrl,
      title: first.title,
    },
    model: task.modelName || "模型",
    creationType: task.category === "video" ? "视频" : task.category === "audio" ? "语音" : "图片",
    createdAt: formatClock(task.finishedAt || task.createdAt),
    elapsed: elapsedOf(task),
    credits: task.creditCost || 0,
    ratio: task.category === "audio" ? "—" : first.ratio || task.params?.ratio || "—",
    resolution: task.category === "audio" ? (task.params?.audioFormat || "音频").toUpperCase() : first.resolution || task.params?.resolution || "—",
    duration: task.category === "video" ? `${task.params?.durationSec || first.durationSec || "—"} 秒` : "—",
    reuse: reusePayloadOf(task),
  };
}

export function tasksToMessages(tasks = []) {
  const messages = [];
  for (const task of tasks) {
    const userText = userPromptOf(task);
    if (userText) messages.push({ type: "user", text: userText });
    if (task.status === "SUCCEEDED") messages.push(taskToResultMessage(task));
    if (task.status === "PENDING" || task.status === "RUNNING") {
      messages.push({
        type: "result",
        prompt: userText,
        pending: true,
        taskId: task.id,
        text: task.category === "video" ? "视频生成中，通常需要几分钟，请稍候或稍后刷新会话" : task.category === "audio" ? "语音生成中，请稍候…" : "图片生成中，请稍候…",
        model: task.modelName || "模型",
        creationType: task.category === "video" ? "视频" : task.category === "audio" ? "语音" : "图片",
        createdAt: formatClock(task.createdAt),
        elapsed: elapsedOf(task),
        credits: task.creditCost || 0,
        ratio: task.category === "audio" ? "—" : task.params?.ratio || "—",
        resolution: task.category === "audio" ? (task.params?.audioFormat || "音频").toUpperCase() : task.params?.resolution || "—",
        duration: task.category === "video" ? `${task.params?.durationSec || "—"} 秒` : "—",
        media: { type: task.category || "image", src: "" },
        creations: [],
      });
    }
    if (task.status === "FAILED") {
      messages.push({
        type: "result",
        prompt: userText,
        text: friendlyGenerateError(task.errorMessage, {
          adapterKey: task.params?.adapterKey,
          modelKey: task.params?.modelKey,
          name: task.modelName,
        }),
        error: true,
        model: task.modelName || "模型",
        creationType: task.category === "video" ? "视频" : task.category === "audio" ? "语音" : "图片",
        createdAt: formatClock(task.finishedAt || task.createdAt),
        elapsed: "—",
        credits: 0,
        ratio: "—",
        resolution: "—",
        duration: "—",
        media: { type: task.category || "image", src: "", title: "失败" },
        creations: [],
        reuse: reusePayloadOf(task),
      });
    }
  }
  return messages;
}

export function userPromptOf(task) {
  const prompt = String(task?.prompt || "").trim();
  if (prompt) {
    const visible = promptForDisplay(prompt);
    if (visible) return visible;
    return isFramesTask(task) ? FRAMES_EMPTY_PROMPT_LABEL : "参考素材生成";
  }
  return isFramesTask(task) ? FRAMES_EMPTY_PROMPT_LABEL : "";
}

function isFramesTask(task) {
  const mode = String(task?.mode || task?.params?.mode || "").toLowerCase();
  if (mode === "i2v" || mode === "frames" || mode === "v2v" || mode === "frame") return true;
  const frames = task?.params?.frames;
  return Boolean(frames?.firstFrameKey || frames?.lastFrameKey);
}

export function friendlyGenerateError(message) {
  const text = String(message || "").trim();
  if (!text) return "生成失败，积分已退还";
  const lower = text.toLowerCase();
  if (lower.includes("http 429") || lower.includes("exceeded the quota") || lower.includes("rate limit") || text.includes("额度")) {
    return "官方 Seedance 额度繁忙或请求过密。请等一两分钟再点生成，不要连续点多镜。";
  }
  return text;
}

export function promptForResult(messages = [], resultMessage) {
  if (resultMessage?.prompt) return resultMessage.prompt;
  const fromCreation = resultMessage?.creations?.find((item) => item?.prompt)?.prompt;
  if (fromCreation) return fromCreation;
  const index = messages.indexOf(resultMessage);
  if (index < 0) return "";
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === "user" && messages[i].text) return messages[i].text;
  }
  return "";
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
  return formatElapsed(seconds);
}

function formatElapsed(totalSeconds) {
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    if (minutes === 0 && seconds === 0) return `${hours}小时`;
    if (seconds === 0) return `${hours}小时${minutes}分`;
    return `${hours}小时${minutes}分${seconds}秒`;
  }
  if (seconds === 0) return `${minutes}分`;
  return `${minutes}分${seconds}秒`;
}
