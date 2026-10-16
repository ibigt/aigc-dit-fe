// 与 demo 的 icons.film / icons.image / 自定义 audio mic SVG 一致
// 用于 MyCreations / AssetLibrary 的 全部/视频/图片/语音 类型 tab 与卡片角标
const Stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  "aria-hidden": true,
};

export function WorksTypeIcon({ type }) {
  if (type === "image") {
    return (
      <svg viewBox="0 0 24 24" {...Stroke}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="2" />
        <path d="m4 18 5-5 3 3 3-4 5 6" />
      </svg>
    );
  }
  if (type === "video") {
    return (
      <svg viewBox="0 0 24 24" {...Stroke}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4" />
      </svg>
    );
  }
  if (type === "audio") {
    return (
      <svg viewBox="0 0 24 24" {...Stroke}>
        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
        <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8" />
      </svg>
    );
  }
  // 默认 all：网格
  return (
    <svg viewBox="0 0 24 24" {...Stroke}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
