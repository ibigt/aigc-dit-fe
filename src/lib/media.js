import { TOKEN_KEY } from "../api/client.js";

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

export function mediaUrl(keyOrUrl) {
  if (!keyOrUrl) return "";
  if (keyOrUrl.startsWith("blob:") || keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://") || keyOrUrl.startsWith("/media/")) {
    return keyOrUrl;
  }
  const token = window.localStorage.getItem(TOKEN_KEY) || "";
  const key = storageKeyOf(keyOrUrl) || keyOrUrl;
  return `/api/media?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
