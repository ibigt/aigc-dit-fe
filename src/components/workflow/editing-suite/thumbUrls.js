import { mediaUrl } from "../../../lib/media.js";

// 后端对尚未出海报的视频，偶尔会把 poster 记成视频本身；这类地址塞进 <img> 必然破图。
// /api/media?key=xxx.mp4&token=… 里扩展名后跟的是 & 而不是 ?，一并覆盖。
const VIDEO_URL_PATTERN = /\.(mp4|webm|mov|m4v|mkv)(&|#|\?|$)/i;
const IMAGE_URL_PATTERN = /\.(png|jpe?g|webp|gif|avif|bmp)(&|#|\?|$)/i;

// clip.posterKey 存的是产物 posterUrl（形如 /api/media?key=…&token=…），并非裸 storageKey。
// 显式还原成 key 再交给 mediaUrl 重建，避免依赖 window.location 的反解（portal/测试环境下易失效）。
function plainKeyOf(raw) {
  const match = String(raw || "").match(/[?&]key=([^&]+)/);
  if (!match) return String(raw || "");
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

/**
 * 剪辑台缩略图取址（素材卡片 / 时间线片段共用，纯函数可单测）。
 * 上游视频产物通常只有 storageKey（mp4）而没有封面图，所以返回两个地址：
 *   poster —— 能直接给 <img> 用的图片地址；
 *   video  —— 给 <video preload="metadata"> 取首帧用的播放地址。
 * <MediaThumb> 先试 poster，缺失或加载失败时自动回落到 video 首帧。
 * 注意：clip 的 posterKey 实际是已带 token 的 URL，mediaUrl 会反解 key 后重建，幂等可用。
 */
export function resolveThumbUrls({ output, storageKey = "", posterKey = "" } = {}, width = 160) {
  const rawPoster = posterKey || output?.posterKey || output?.posterUrl || "";
  const key = plainKeyOf(output?.storageKey || storageKey || "");
  const video = key ? mediaUrl(key) : "";
  let poster = "";
  if (rawPoster && !VIDEO_URL_PATTERN.test(rawPoster)) poster = mediaUrl(plainKeyOf(rawPoster), { w: width });
  // 图片素材自身就是封面（本地导入 / 图片节点产物）
  if (!poster && IMAGE_URL_PATTERN.test(key)) poster = mediaUrl(key, { w: width });
  return { poster, video };
}
