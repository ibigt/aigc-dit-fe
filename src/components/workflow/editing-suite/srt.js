// SRT 导入 / 导出（纯前端，零后端）
export function parseSrt(text, limit = 2000) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const blocks = raw.split(/\r?\n\s*\r?\n/);
  const items = [];
  let skipped = 0;
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/).filter((line) => line.trim() !== "");
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) { skipped++; continue; }
    const [from, to] = lines[timeIndex].split("-->").map((part) => parseSrtTime(part.trim()));
    const content = lines.slice(timeIndex + 1).join("\n").trim();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !content) { skipped++; continue; }
    if (items.length >= limit) { skipped++; continue; }
    items.push({ start: from, duration: to - from, text: content });
  }
  return { items, skipped };
}

function parseSrtTime(value) {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(value);
  if (!match) return NaN;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, "0"));
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function srtTime(value) {
  const total = Math.max(0, Number(value) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const millis = Math.round((total % 1) * 1000);
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

// 文字/字幕轨片段按 start 排序 → SRT；重叠忠实保留
export function toSrt(clips = []) {
  return [...clips]
    .filter((clip) => clip.enabled !== false && clip.text)
    .sort((a, b) => a.start - b.start)
    .map((clip, index) => `${index + 1}\n${srtTime(clip.start)} --> ${srtTime(clip.start + (Number(clip.duration) || 0))}\n${clip.text}\n`)
    .join("\n");
}

export function downloadSrt(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
