const RULES = {
  image: { extensions: ["jpg", "jpeg", "png", "webp", "gif"], maxBytes: 20 * 1024 * 1024, label: "JPG、PNG、WEBP 或 GIF（最大 20MB）" },
  video: { extensions: ["mp4", "webm", "mov"], maxBytes: 200 * 1024 * 1024, label: "MP4、WEBM 或 MOV（最大 200MB）" },
  audio: { extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"], maxBytes: 100 * 1024 * 1024, label: "MP3、WAV、M4A、AAC、FLAC 或 OGG（最大 100MB）" },
};

export function assetKindOf(file) {
  const mimeKind = String(file?.type || "").split("/")[0];
  if (RULES[mimeKind]) return mimeKind;
  const extension = String(file?.name || "").split(".").pop().toLowerCase();
  return Object.entries(RULES).find(([, rule]) => rule.extensions.includes(extension))?.[0] || null;
}

export function validateAssetFile(file) {
  const kind = assetKindOf(file);
  if (!kind) return { valid: false, kind: null, message: "不支持的文件格式" };
  const extension = String(file?.name || "").split(".").pop().toLowerCase();
  const rule = RULES[kind];
  if (!rule.extensions.includes(extension)) return { valid: false, kind, message: `${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}仅支持 ${rule.label}` };
  if (!file?.size) return { valid: false, kind, message: "文件为空" };
  if (file.size > rule.maxBytes) return { valid: false, kind, message: `文件过大，仅支持 ${rule.label}` };
  return { valid: true, kind, message: "" };
}
