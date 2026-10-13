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
 * @param {{ w?: number }} [options] 传 w 时走后端缩略图（仅图片有效）
 */
export function mediaUrl(keyOrUrl, options = {}) {
  if (!keyOrUrl) return "";
  if (keyOrUrl.startsWith("blob:") || keyOrUrl.startsWith("/media/")) {
    return keyOrUrl;
  }
  const width = Number(options?.w) > 0 ? Math.round(Number(options.w)) : 0;
  if (keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://")) {
    return appendMediaWidth(keyOrUrl, width);
  }
  const token = window.localStorage.getItem(TOKEN_KEY) || "";
  const key = storageKeyOf(keyOrUrl) || keyOrUrl;
  let url = `/api/media?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
  if (width > 0) url += `&w=${width}`;
  return url;
}

function appendMediaWidth(url, width) {
  if (!(width > 0)) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    if (!parsed.pathname.endsWith("/api/media") && !parsed.pathname.endsWith("/api/media/")) {
      return url;
    }
    parsed.searchParams.set("w", String(width));
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
