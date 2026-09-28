/**
 * 复用参数：把后端生成任务（GenerateTaskResp）还原成快速创作可直接回填的参数快照。
 * 纯函数、不触碰 window/DOM，便于 node --test 直接覆盖；URL 解析交给组件层（mediaUrl）。
 */
const FRAMES_MODES = ["i2v", "frames", "v2v", "frame"];

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function referenceMaterial(item, index) {
  if (!item?.storageKey) return null;
  const type = item.type === "video" ? "video" : item.type === "audio" ? "audio" : "image";
  return { name: `参考 ${index + 1}`, type, storageKey: String(item.storageKey) };
}

function frameMaterial(key, name) {
  return key ? { name, type: "image", storageKey: String(key) } : null;
}

export function isFramesMode(mode) {
  return FRAMES_MODES.includes(String(mode || "").toLowerCase());
}

export function reusePayloadOf(task) {
  if (!task) return null;
  const params = task.params || {};
  const category = task.category || "";
  const mode = String(task.mode || params.mode || "");
  const references = (Array.isArray(params.references) ? params.references : [])
    .map(referenceMaterial)
    .filter(Boolean);
  const frames = params.frames || {};
  return {
    category,
    modelId: toNumber(task.modelId, null),
    mode,
    framesMode: category === "video" && isFramesMode(mode),
    ratio: params.ratio || "",
    resolution: params.resolution || "",
    quality: params.quality || "",
    durationSec: toNumber(params.durationSec, null),
    copies: Math.min(4, Math.max(1, toNumber(params.copies, toNumber(task.copies, 1)) || 1)),
    voiceId: params.voiceId || "",
    speed: toNumber(params.speed, null),
    audioFormat: params.audioFormat || "",
    references,
    frames: {
      firstFrame: frameMaterial(frames.firstFrameKey, "首帧"),
      lastFrame: frameMaterial(frames.lastFrameKey, "尾帧"),
    },
  };
}
