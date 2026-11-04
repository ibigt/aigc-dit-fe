export function connectedClipQueue(connectedClips) {
  return Array.isArray(connectedClips) ? connectedClips : [];
}

// 片段启用状态（需求 4.2.5.3）：缺省视为启用，旧工作流 JSON 保持原行为
export function clipEnabled(clip) {
  return clip?.enabled !== false;
}

// 只保留启用的片段，用于播放与成片合成
export function enabledClips(clips) {
  return (Array.isArray(clips) ? clips : []).filter(clipEnabled);
}

export function applyClipAudio(video, clip) {
  if (!video || !clip) return;
  video.muted = Boolean(clip.muted);
  video.volume = Math.max(0, Math.min(1, Number(clip.volume ?? 1) || 0));
}

export function syncClipPlayback(video, clip, hasNext, ended = false) {
  if (!video || !clip) return false;
  const trimEnd = Number(clip.trimEnd);
  const hasTrimEnd = Number.isFinite(trimEnd) && trimEnd > (Number(clip.trimStart) || 0);
  if (!ended && (!hasTrimEnd || video.currentTime < trimEnd)) return false;
  if (hasTrimEnd && video.currentTime !== trimEnd) video.currentTime = trimEnd;
  if (!hasNext) video.pause();
  return Boolean(hasNext);
}

export function videoOutputSelection(outputs, selectedKey) {
  const options = (Array.isArray(outputs) ? outputs : [])
    .filter((output) => output?.url)
    .map((output) => ({ key: output.storageKey || output.url, output }));
  const selected = (options.find((option) => option.key === selectedKey) || options[0])?.output || null;
  return { options, selected };
}

export function audioPreviewSources(generated, uploaded) {
  return [
    generated?.url ? { kind: "generated", label: "生成音频", output: generated } : null,
    uploaded?.url ? { kind: "uploaded", label: "上传音频", output: uploaded } : null,
  ].filter(Boolean);
}
