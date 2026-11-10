// 剪辑台统一线性图标（24×24 / stroke=currentColor），替代表情符号与 Unicode 字形。
// 视觉规范 §4 明确「表情符号做图标」属于避免清单，全部图标走同一套描边语言。
const GLYPHS = {
  back: <path d="M15 18l-6-6 6-6" />,
  media: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M8 4v6M16 4v6" /></>,
  text: <><path d="M4 7V5h16v2M12 5v14M9 19h6" /></>,
  graphic: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3v18" /></>,
  effect: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6z" /></>,
  transition: <path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" />,
  adjust: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="7" cy="18" r="2" fill="currentColor" stroke="none" /></>,
  fold: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  download: <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3" />,
  upload: <path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v3h16v-3" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
  skipBack: <><path d="M19 20L9 12l10-8v16z" /><path d="M5 5v14" /></>,
  skipForward: <><path d="M5 4l10 8-10 8V4z" /><path d="M19 5v14" /></>,
  play: <path d="M8 5l11 7-11 7V5z" fill="currentColor" stroke="none" />,
  pause: <path d="M8.5 5v14M15.5 5v14" strokeWidth="3" />,
  scissors: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" /></>,
  volume: <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  magnet: <><path d="M6 3v9a6 6 0 0 0 12 0V3h-4v9a2 2 0 0 1-4 0V3H6z" /><path d="M6 7h4M14 7h4" /></>,
  pointer: <path d="M5 3l6.5 17 2.3-7.2L21 10.5 5 3z" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  mute: <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M16 9l5 6M21 9l-5 6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  video: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /></>,
  audio: <path d="M3 12h2l2-6 3 12 3-9 2 3h6" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M8 4v6M16 4v6M8 14h8" /></>,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  arrowLR: <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  mousePointer: <><path d="M5 3l6.5 17 2.3-7.2L21 10.5 5 3z" /><path d="M15 18l3 3" /></>,
  minus: <path d="M5 12h14" />,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  refresh: <><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.6-4.2" /><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.6 4.2" /><path d="M21 3v6h-6M3 21v-6h6" /></>,
};

export default function Icon({ name, size = 16, className = "", strokeWidth = 1.8, ...rest }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {GLYPHS[name] || null}
    </svg>
  );
}
