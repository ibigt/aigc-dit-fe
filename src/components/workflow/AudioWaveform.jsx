import { useEffect, useState } from "react";

// 音频波形可视化（需求 4.2.4.5）：Web Audio decodeAudioData 计算峰值后以柱状渲染。
// 取 PCM 首声道按份数分块取块内峰值；解析失败（跨域/编码不支持/无 AudioContext）时静默降级为不渲染。
const DEFAULT_BARS = 56;

export default function AudioWaveform({ src, bars = DEFAULT_BARS, className = "" }) {
  const [peaks, setPeaks] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    setPeaks(null);
    if (!src) return undefined;

    (async () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const response = await fetch(src, controller ? { signal: controller.signal } : undefined);
        const buffer = await response.arrayBuffer();
        const context = new AudioCtx();
        const audio = await context.decodeAudioData(buffer);
        const channel = audio.getChannelData(0);
        const count = Math.max(8, Math.min(Number(bars) || DEFAULT_BARS, 160));
        const block = Math.floor(channel.length / count) || 1;
        const next = [];
        for (let index = 0; index < count; index += 1) {
          let peak = 0;
          const start = index * block;
          for (let offset = 0; offset < block; offset += 1) {
            const value = Math.abs(channel[start + offset] || 0);
            if (value > peak) peak = value;
          }
          next.push(peak);
        }
        context.close?.().catch(() => {});
        if (!cancelled) setPeaks(next);
      } catch {
        // 静默降级：波形不可用时保留原生播放器即可
      }
    })();

    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [src, bars]);

  if (!peaks || !peaks.length) return null;
  const max = peaks.reduce((top, peak) => Math.max(top, peak), 0.001);
  return (
    <div className={`audio-waveform ${className}`.trim()} role="img" aria-label="音频波形">
      {peaks.map((peak, index) => (
        <span key={index} style={{ height: `${Math.max(8, Math.round((peak / max) * 100))}%` }} />
      ))}
    </div>
  );
}
