import { Play } from "lucide-react";

// 16 根波形条 — 与 demo .work-waveform 一致（弹框预览 + 卡片缩略图共用）
const WAVE_HEIGHTS = [18, 35, 52, 30, 66, 42, 76, 34, 58, 26, 70, 44, 62, 30, 48, 22];

function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 16 根波形，居中显示在父容器。卡片缩略图与弹框预览共用。
 * 配合 `.work-thumb.is-audio` 的 radial+linear 渐变背景，呈现 demo 同款效果。
 */
export function WorkWaveform() {
  return (
    <div className="work-waveform" aria-hidden="true">
      {WAVE_HEIGHTS.map((height, index) => (
        <i key={index} style={{ "--wave": `${height}%` }} />
      ))}
    </div>
  );
}

/**
 * 音频预览（my-creations / asset-library 弹框内复用）：
 * - 16 根波形 + 标题/格式/时长元信息
 * - 实际播放 / 进度控制交给底下原生 <audio controls>
 */
export function AudioPreview({ src, title, format, duration }) {
  return (
    <div className="work-audio-player">
      <WorkWaveform />
      <div className="work-audio-info">
        <strong>{title || "音频"}</strong>
        <span>
          {format ? `${format} · ` : ""}
          {fmtTime(duration ?? NaN)}
        </span>
      </div>
      <audio className="work-audio-native" src={src} controls preload="metadata" />
    </div>
  );
}
