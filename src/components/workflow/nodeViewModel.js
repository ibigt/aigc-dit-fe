import { extractVariableNames, resolveTemplate } from "./variables.js";

const clampProgress = (value) => Math.max(0, Math.min(100, Number(value) || 0));

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
