import { WorkWaveform } from "../components/AudioPreview.jsx";

// 兜底：src 加载失败时整张 img 隐藏，让 .work-thumb 的紫色 radial-gradient 占位。
function hideOnError(event) {
  event.currentTarget.style.display = "none";
}

export function MediaCover({ item, alt }) {
  const label = alt || item.title || "";
  const thumb = item.thumb || item.poster || item.src;
  if (item.type === "video") {
    if (thumb) return <img src={thumb} alt={label} onError={hideOnError} />;
    return <video src={item.src} muted playsInline preload="metadata" />;
  }
  if (item.type === "image") return <img src={thumb} alt={label} onError={hideOnError} />;
  // 音频用统一的 WorkWaveform 渲染（弹框预览同款），背景靠 .work-thumb.is-audio 渐变填充。
  return <WorkWaveform />;
}
