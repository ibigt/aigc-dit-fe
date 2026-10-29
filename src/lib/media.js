import { TOKEN_KEY } from "../api/client.js";

/** 素材列表/网格预览默认宽度（后端会规整到最近档位） */
export const MEDIA_THUMB_WIDTH = 480;

export function storageKeyOf(keyOrUrl) {
  if (!keyOrUrl) return "";
  if (keyOrUrl.startsWith("blob:") || keyOrUrl.startsWith("/media/")) return "";
  try {
    if (keyOrUrl.includes("key=") && (keyOrUrl.startsWith("/api/media") || keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://"))) {
      return new URL(keyOrUrl, window.location.origin).searchParams.get("key") || "";
    }
  } catch {
    return "";
  }
  if (keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://") || keyOrUrl.startsWith("/")) return "";
  return keyOrUrl;
}

/**
 * @param {string} keyOrUrl
 * @param {{ w?: number, filename?: string }} [options] 传 w 走缩略图；filename 写入 Content-Disposition，避免下载成 media
 */
export function mediaUrl(keyOrUrl, options = {}) {
  if (!keyOrUrl) return "";
  if (keyOrUrl.startsWith("blob:") || keyOrUrl.startsWith("/media/")) {
    return keyOrUrl;
  }
  const width = Number(options?.w) > 0 ? Math.round(Number(options.w)) : 0;
  const filename = String(options?.filename || "").trim();
  if (keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://")) {
    return appendMediaParams(keyOrUrl, { width, filename });
  }
  const token = window.localStorage.getItem(TOKEN_KEY) || "";
  const key = storageKeyOf(keyOrUrl) || keyOrUrl;
  let url = `/api/media?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
  if (width > 0) url += `&w=${width}`;
  if (filename) url += `&filename=${encodeURIComponent(filename)}`;
  return url;
}

function appendMediaParams(url, { width = 0, filename = "" } = {}) {
  if (!(width > 0) && !filename) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    if (!parsed.pathname.endsWith("/api/media") && !parsed.pathname.endsWith("/api/media/")) {
      return url;
    }
    if (width > 0) parsed.searchParams.set("w", String(width));
    if (filename) parsed.searchParams.set("filename", filename);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** 缩略图正在生成时，落选的请求会马上结束。过一会儿再要一次，这时缓存通常已经写好。 */
export function retryMediaOnce(event) {
  const img = event.currentTarget;
  if (!img || img.dataset.retried === "1") {
    if (img) img.onerror = null;
    return;
  }
  img.dataset.retried = "1";
  const next = img.currentSrc || img.src;
  if (!next) return;
  window.setTimeout(() => {
    if (!img.isConnected) return;
    img.removeAttribute("src");
    img.src = next;
  }, 1500);
}

export function authenticatedApiUrl(path) {
  if (!path) return "";
  const token = window.localStorage.getItem(TOKEN_KEY) || "";
  if (!token) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}token=${encodeURIComponent(token)}`;
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 下载文件名安全化：去掉路径非法字符，压缩空白。 */
export function safeDownloadBase(name, fallback = "未命名") {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 80);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 从 storage key / URL / MIME 推断扩展名。 */
export function guessMediaExtension({ storageKey, src, url, type, mimeType, contentType } = {}) {
  for (const raw of [storageKey, src, url]) {
    if (!raw) continue;
    let source = String(raw);
    try {
      source = decodeURIComponent(source);
    } catch {
      /* keep raw */
    }
    const keyMatch = source.match(/[?&]key=([^&]+)/);
    const mediaPath = (keyMatch ? keyMatch[1] : source).split(/[?#]/)[0];
    const extension = mediaPath.match(/\.([a-z0-9]{2,5})$/i)?.[1];
    if (extension && extension.toLowerCase() !== "bin") return extension.toLowerCase();
  }
  const mime = String(mimeType || contentType || "").toLowerCase();
  const fromMime = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
  }[mime];
  if (fromMime) return fromMime;
  if (type === "video") return "mp4";
  if (type === "audio") return "mp3";
  if (type === "image") return "png";
  return "bin";
}

function stampFromCreatedAt(createdAt) {
  if (!createdAt) return "";
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

/**
 * 通用媒体下载名：标题[-时间戳][-序号].ext
 * used 传入 Set 时可自动去重（打包 zip 时用）。
 */
export function mediaDownloadName({
  title,
  fallback = "作品",
  type,
  storageKey,
  src,
  url,
  mimeType,
  contentType,
  createdAt,
  index,
  used,
} = {}) {
  const base = safeDownloadBase(title, fallback);
  const stamp = stampFromCreatedAt(createdAt);
  const ext = guessMediaExtension({ storageKey, src, url, type, mimeType, contentType });
  const parts = [base];
  if (stamp) parts.push(stamp);
  if (index != null && index !== "") parts.push(String(index));
  let name = `${parts.join("-")}.${ext}`;
  if (used instanceof Set) {
    let n = 2;
    while (used.has(name)) {
      name = `${parts.join("-")}-${n}.${ext}`;
      n += 1;
    }
    used.add(name);
  }
  return name;
}

/**
 * 短剧成片下载名：短剧名-第N集[-后缀].ext
 * episode 可用 name（如「第 1 集」）或 episodeNumber。
 */
export function dramaFilmDownloadName({ seriesName, episode, suffix = "", ext = "mp4" } = {}) {
  const series = safeDownloadBase(seriesName, "短剧");
  const episodeLabel = episode?.name
    ? safeDownloadBase(episode.name, "第1集")
    : `第${episode?.episodeNumber || 1}集`;
  const parts = [series, episodeLabel];
  const extra = String(suffix || "").trim();
  if (extra) parts.push(safeDownloadBase(extra, extra));
  const extension = String(ext || "mp4").replace(/^\./, "") || "mp4";
  return `${parts.join("-")}.${extension}`;
}

/** 拉取媒体并触发本地下载（避免 /api/media 被浏览器存成 media）。 */
export async function downloadMediaFile(urlOrKey, filename) {
  const src = mediaUrl(urlOrKey) || urlOrKey;
  if (!src) throw new Error("无可下载地址");
  const response = await fetch(src, { cache: "no-store" });
  if (!response.ok) throw new Error("下载失败");
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename || "download.bin";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
