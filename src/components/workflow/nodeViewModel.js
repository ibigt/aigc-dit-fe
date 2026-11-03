import { extractVariableNames, resolveTemplate } from "./variables.js";

const clampProgress = (value) => Math.max(0, Math.min(100, Number(value) || 0));

/**
 * 节点运行状态 → 状态条文案。
 * 用户主动停止的步骤后端记为 CANCELLED：不是「生成失败」，要单独呈现为「已取消」，
 * 否则用户会以为是自己操作出错而反复重试。
 */
export function nodeRuntimeState(runtime = {}) {
  const status = runtime.status || "";
  const message = runtime.error || "";
  if (status === "CANCELLED") {
    return { tone: "cancelled", title: "已取消", message: message || "已取消" };
  }
  if (status === "BLOCKED") {
    return { tone: "failed", title: "已阻塞", message: message || "上游节点未成功，当前节点已阻塞" };
  }
  if (status === "FAILED") {
    return { tone: "failed", title: "生成失败", message: message || "生成失败" };
  }
  return null;
}

export function nodeViewModel(kind, media = {}, runtime = {}) {
  const status = runtime.status || "IDLE";
  const isEditing = kind === "VideoEditing";
  const outputs = Array.isArray(runtime.outputs) ? runtime.outputs : [];
  const selectedIndex = Number(media.selectedOutputIndex ?? media.outputIndex);
  const output = (Number.isInteger(selectedIndex) && selectedIndex >= 0 ? outputs[selectedIndex] : null)
    || outputs.find((output) => output?.storageKey && output?.url) || outputs.find((output) => output?.url) || null;
  const generatedOutput = kind === "AudioGenerator" && output?.storageKey === media.uploadedAudio?.storageKey ? null : output;
  const selectedOutput = kind === "AudioGenerator" && media.selectedAudioSource === "uploaded" && media.uploadedAudio?.storageKey
    ? { ...media.uploadedAudio, type: "audio" } : generatedOutput;
  const prompt = media.prompt ?? media.template ?? "";
  const placeholders = extractVariableNames(prompt);
  const scopes = [{ priority: -1, values: media.variables || {} }, ...(media.scopes || [])];
  const resolved = resolveTemplate(prompt, scopes);
  const progress = clampProgress(runtime.progress);
  const isBusy = ["PENDING", "SUBMITTING", "RUNNING", "EDITING"].includes(status);
  const hasError = ["FAILED", "BLOCKED"].includes(status);

  return {
    status,
    isBusy,
    hasError,
    progress,
    tabs: kind === "AudioGenerator" ? ["配音朗读", "AI 音乐"] : [],
    actionLabel: isBusy ? `${isEditing ? "合成中" : "生成中"} ${progress}%`
      : isEditing ? (status === "SUCCEEDED" ? "重新合成" : "合成成片") : "执行生成",
    actionDisabled: isBusy || status === "QUEUED",
    hasInputHandle: true,
    hasOutputHandle: !isEditing,
    selectedOutput,
    generatedOutput,
    outputs,
    placeholders,
    missing: resolved.missing,
    conflicts: resolved.conflicts,
  };
}
