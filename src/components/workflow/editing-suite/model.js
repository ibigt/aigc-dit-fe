// 剪辑台数据模型（纯函数，可 node --test 单测）
// 约定：时间线 v2 的 clips[].start 只用于「时间线上的摆放」；导出成片时按主视频轨
// start 升序拼接、空隙压缩为 0（沿用既有「首尾拼接」语义），故扁平 clips[] 不带 start。

export const ASPECTS = [
  { id: "16:9", label: "16:9", w: 16, h: 9, hd: [1920, 1080], sd: [1280, 720] },
  { id: "9:16", label: "9:16", w: 9, h: 16, hd: [1080, 1920], sd: [720, 1280] },
  { id: "1:1", label: "1:1", w: 1, h: 1, hd: [1080, 1080], sd: [720, 720] },
  { id: "4:3", label: "4:3", w: 4, h: 3, hd: [1440, 1080], sd: [960, 720] },
  { id: "2.35:1", label: "2.35:1", w: 2.35, h: 1, hd: [1920, 816], sd: [1280, 544] },
];

export const QUALITIES = ["1080P", "720P"];
export const ZOOM_LEVELS = [10, 20, 40, 60, 90, 120];
export const SNAP_THRESHOLD_PX = 8;
export const HISTORY_LIMIT = 50;

// ── 预设表（六面板内容源，UI 与预览共用同一份，后端合成本批只记录不渲染）──────────

// 图形预设：形状 + 默认颜色，落在图形轨 G1 的片段上
export const GRAPHIC_PRESETS = [
  { id: "rect", label: "矩形", shape: "rect", color: "#6cb2ec" },
  { id: "circle", label: "圆形", shape: "circle", color: "#c56ab8" },
  { id: "triangle", label: "三角", shape: "triangle", color: "#d6a824" },
  { id: "arrow", label: "箭头", shape: "arrow", color: "#4fb780" },
  { id: "star", label: "星光", shape: "star", color: "#9a77e9" },
  { id: "line", label: "线条", shape: "line", color: "#aab1bc" },
];

// 特效预设：cssFilter 供预览实时渲染，params 供后端 filter_complex 还原
export const EFFECT_PRESETS = [
  { id: "none", label: "无特效", cssFilter: "none", params: {} },
  { id: "mono", label: "黑白", cssFilter: "grayscale(1)", params: { filter: "colorchannelmixer" } },
  { id: "vintage", label: "复古", cssFilter: "sepia(.55) contrast(1.12) saturate(.85)", params: { sepia: 0.55 } },
  { id: "warm", label: "暖阳", cssFilter: "saturate(1.45) sepia(.28)", params: { saturate: 1.45, sepia: 0.28 } },
  { id: "cool", label: "冷调", cssFilter: "hue-rotate(-12deg) saturate(1.1)", params: { hue: -12 } },
  { id: "soft", label: "柔光", cssFilter: "brightness(1.08) blur(.5px)", params: { brightness: 1.08 } },
  { id: "contrast", label: "高对比", cssFilter: "contrast(1.5)", params: { contrast: 1.5 } },
  { id: "blur", label: "模糊", cssFilter: "blur(2px)", params: { blur: 2 } },
];

// 转场预设：施加在片段与其右邻之间（骑缝）
export const TRANSITION_PRESETS = [
  { id: "none", label: "无转场", duration: 0 },
  { id: "fade", label: "淡入淡出", duration: 0.6 },
  { id: "slide", label: "滑动", duration: 0.5 },
  { id: "zoom", label: "缩放", duration: 0.5 },
  { id: "wipe", label: "擦除", duration: 0.4 },
  { id: "flash", label: "闪白", duration: 0.3 },
];

// 文字样式预设
export const TEXT_STYLES = [
  { id: "default", label: "默认", fontSize: 16, color: "#ffffff", weight: 400, align: "center" },
  { id: "title", label: "标题", fontSize: 32, color: "#ffffff", weight: 700, align: "center" },
  { id: "caption", label: "字幕", fontSize: 18, color: "#ffffff", weight: 500, align: "center" },
  { id: "note", label: "注释", fontSize: 13, color: "#d6a824", weight: 400, align: "left" },
];

// 调节预设：一次性写入 clip.adjust
export const ADJUST_PRESETS = [
  { id: "none", label: "原片", adjust: {} },
  { id: "bright", label: "提亮", adjust: { brightness: 18, contrast: 6, saturate: 6 } },
  { id: "dark", label: "压暗", adjust: { brightness: -16, contrast: 14, saturate: -8 } },
  { id: "cinema", label: "电影感", adjust: { brightness: -6, contrast: 26, saturate: -14 } },
  { id: "vivid", label: "浓郁", adjust: { brightness: 4, contrast: 12, saturate: 34 } },
];

export const TRACK_TYPES = {
  text: { label: "文字", height: 28, sem: "var(--tx)" },
  graphic: { label: "图形", height: 40, sem: "var(--g)" },
  video: { label: "视频", height: 56, sem: "var(--v)" },
  audio: { label: "音频", height: 40, sem: "var(--a)" },
};

export function presetById(list, id) {
  return list.find((item) => item.id === id) || null;
}


export function aspectSize(aspect, quality) {
  const def = ASPECTS.find((item) => item.id === aspect) || ASPECTS[0];
  return quality === "1080P" ? def.hd : def.sd;
}

export function resolutionText(aspect, quality) {
  const [w, h] = aspectSize(aspect, quality);
  return `${w}×${h}`;
}

export function clipDuration(clip) {
  if (!clip) return 0;
  if (clip.type === "video" || clip.type === "audio") {
    const start = Number(clip.trimStart) || 0;
    const end = Number(clip.trimEnd);
    return Number.isFinite(end) && end > start ? end - start : Number(clip.duration) || 0;
  }
  return Number(clip.duration) || 0;
}

export function clipEnd(clip) {
  return (Number(clip?.start) || 0) + clipDuration(clip);
}

// 裁剪数值输入的最短片段时长，与时间线 trim 拖拽的 0.1s 下限保持一致。
export const MIN_TRIM_DURATION = 0.1;

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * 校验属性面板的「入点 / 出点」输入，产出可直接交给 updateClip 的 patch。
 * 入参允许字符串（保留「1.」这类输入中间态）；不合法时只返回 error，绝不写坏 timeline。
 * patch 同步 duration：clipDuration 优先用 trimEnd-trimStart，但拖拽裁剪 / 旧草稿迁移
 * 会读写 clip.duration，两处保持一致才不会让时间线宽度与导出时长分叉。
 */
export function validateTrim({ trimStart, trimEnd, minDuration = MIN_TRIM_DURATION } = {}) {
  const toNumber = (raw) => {
    if (typeof raw === "number") return raw;
    const text = String(raw ?? "").trim();
    return text ? Number(text) : Number.NaN;
  };
  const start = toNumber(trimStart);
  const end = toNumber(trimEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, error: "请输入有效的裁剪数值" };
  }
  if (start < 0) {
    return { ok: false, error: "入点不能小于 0s" };
  }
  if (end <= start) {
    return { ok: false, error: "出点必须大于入点" };
  }
  const duration = round3(end - start);
  if (duration < minDuration) {
    return { ok: false, error: `裁剪时长不能短于 ${minDuration}s` };
  }
  return {
    ok: true,
    duration,
    patch: { trimStart: round3(start), trimEnd: round3(end), duration },
  };
}

/** 片段当前生效的裁剪区间（旧草稿可能没有 trimEnd，用 clipDuration 兜底）。 */
export function trimRangeOf(clip) {
  const trimStart = Number(clip?.trimStart) || 0;
  const trimEnd = Number.isFinite(Number(clip?.trimEnd)) && Number(clip?.trimEnd) > 0
    ? Number(clip.trimEnd)
    : trimStart + clipDuration(clip);
  return { trimStart, trimEnd };
}

const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export function defaultTracks() {
  return [
    { id: "T1", type: "text", name: "文字 T1", height: 28, clips: [], locked: false, visible: true, muted: false },
    { id: "G1", type: "graphic", name: "图形 G1", height: 40, clips: [], locked: false, visible: true, muted: false },
    { id: "V2", type: "video", name: "视频 V2", height: 56, clips: [], locked: false, visible: true, muted: false },
    { id: "V1", type: "video", name: "视频 V1", height: 56, clips: [], locked: false, visible: true, muted: false },
    { id: "A1", type: "audio", name: "音频 A1", height: 40, clips: [], locked: false, visible: true, muted: false },
  ];
}

export function emptyTimeline(aspect = "16:9", quality = "1080P") {
  return { version: 2, aspect, quality, tracks: defaultTracks() };
}

// 旧工作流（只有扁平 clips[]）迁移：全部片段铺到 V1，start 按有效时长累加。
// 与 buildClipQueue 的「首尾拼接」语义完全一致，文字/音频轨为空。
export function migrateClips(saved, options = {}) {
  const timeline = emptyTimeline(options.aspect || "16:9", options.quality || "1080P");
  const videoTrack = timeline.tracks.find((track) => track.id === "V1");
  let cursor = 0;
  for (const item of [...(saved || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))) {
    if (item.enabled === false || !item.sourceNodeId) continue;
    const trimStart = Number(item.trimStart) || 0;
    const trimEnd = Number(item.trimEnd);
    const duration = Number.isFinite(trimEnd) && trimEnd > trimStart
      ? trimEnd - trimStart
      : Number(item.output?.durationSec ?? item.output?.metadata?.durationSec) || 5;
    const clip = {
      id: uid("clip"),
      // 稳定片段标识：同源同输出的多段靠它区分（后端按 clipId 去重，不能按 source+output）
      clipId: item.clipId || uid("clip"),
      type: "video",
      start: cursor,
      duration,
      trimStart,
      trimEnd: Number.isFinite(trimEnd) ? trimEnd : trimStart + duration,
      sourceNodeId: item.sourceNodeId,
      outputIndex: Number(item.outputIndex) || 0,
      sourceTitle: item.sourceTitle || item.sourceNodeId,
      storageKey: item.output?.storageKey || item.storageKey || "",
      posterKey: item.output?.posterUrl || "",
      muted: Boolean(item.muted),
      volume: Number.isFinite(Number(item.volume)) ? Number(item.volume) : 1,
      enabled: true,
      effects: [],
      transitionOut: null,
    };
    videoTrack.clips.push(clip);
    cursor += duration;
  }
  return timeline;
}

// 双写：草稿提交时同时导出扁平 clips[]，让节点卡队列 / runGraph / 后端 compose 零改动可用。
export function exportFlatClips(timeline) {
  const main = mainVideoTrack(timeline);
  if (!main) return [];
  return [...main.clips]
    .filter((clip) => clip.enabled !== false && clip.storageKey)
    .sort((a, b) => a.start - b.start)
    .map((clip, order) => ({
      // clipId 是片段唯一标识：同一上游节点的同一输出可能被拆成多段（不同裁剪区间），
      // 后端按 (sourceNodeId, outputIndex) 去重会把它们合成一条，只剩选中的那一段。
      clipId: clip.id,
      sourceNodeId: clip.sourceNodeId,
      outputIndex: Number(clip.outputIndex) || 0,
      order,
      trimStart: Number(clip.trimStart) || 0,
      trimEnd: Number(clip.trimEnd) || (Number(clip.trimStart) || 0) + clipDuration(clip),
      muted: Boolean(clip.muted),
      volume: Number.isFinite(Number(clip.volume)) ? Number(clip.volume) : 1,
      enabled: true,
      // 本地导入素材没有对应的上游生成步骤，后端据此直接读 storageKey（并校验归属）
      ...(clip.imported && clip.localKey ? { localKey: clip.localKey } : {}),
    }));
}

// 导出用样式数组（排期 #7）：与 exportFlatClips **同序同长**，后端按下标对齐。
// 每项 = 该片段的调节 + 特效 + 「与右邻之间」的转场。
// 全为空时返回 null——后端不写该字段，step map 与旧版逐字节一致（运行指纹不漂移）。
export function exportClipStyles(timeline) {
  const main = mainVideoTrack(timeline);
  if (!main) return null;
  const clips = [...main.clips]
    .filter((clip) => clip.enabled !== false && clip.storageKey)
    .sort((a, b) => a.start - b.start);
  if (!clips.length) return null;
  const styles = clips.map((clip) => ({
    brightness: clampPercent(clip.adjust?.brightness),
    contrast: clampPercent(clip.adjust?.contrast),
    saturate: clampPercent(clip.adjust?.saturate),
    effect: effectIdOf(clip),
    // 转场是「本片段与右邻之间」，后端 xfade 折叠时挂在**前一段**上：
    // 第 i 段的 transitionOut 描述的是 i 与 i+1 的接缝，因此写在 styles[i]。
    transitionId: clip.transitionOut?.id && clip.transitionOut.id !== "none" ? clip.transitionOut.id : null,
    transitionSeconds: clip.transitionOut?.id && clip.transitionOut.id !== "none"
      ? Math.max(0.1, Number(clip.transitionOut.duration) || 0.5)
      : null,
  }));
  const any = styles.some((style) => style.brightness || style.contrast || style.saturate
    || style.effect || style.transitionId);
  return any ? styles : null;
}

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return 0;
  return Math.max(-100, Math.min(100, Math.round(num)));
}

function effectIdOf(clip) {
  const effects = Array.isArray(clip.effects) ? clip.effects : [];
  const effect = effects.find((item) => item && item.id && item.id !== "none");
  return effect ? effect.id : null;
}

// 导出用叠加层（排期 #7）：文字轨与图形轨的片段，start/end 为成片内绝对时间。
// 视频导出是「空隙压缩的首尾拼接」，成片时间与时间线时间在 V1 无空隙时一致；
// 有空隙时按「已导出视频片段累计时长」折算成片位置，保证叠加落在正确画面上。
export function exportOverlays(timeline) {
  const overlays = [];
  const videoClips = exportedVideoClips(timeline);
  const timelineToFilm = filmTimeMapper(videoClips);
  for (const { clip } of allClips(timeline)) {
    if (clip.type !== "text" && clip.type !== "graphic") continue;
    if (clip.enabled === false) continue;
    const start = Number(clip.start) || 0;
    const end = start + clipDuration(clip);
    if (end <= start) continue;
    const filmStart = timelineToFilm(start);
    const filmEnd = timelineToFilm(end);
    if (filmEnd <= filmStart) continue;
    if (clip.type === "text") {
      const content = String(clip.text || "");
      // 空白文字不导出：后端也会丢弃，避免「有叠加层但什么都没画」的无效烧录
      if (!content.trim()) continue;
      const style = clip.textStyle || {};
      overlays.push({
        kind: "text",
        start: filmStart,
        end: filmEnd,
        text: content,
        color: style.color || "#ffffff",
        // 字号是预览器（.ce-monitor，宽 ≤560px）上的 CSS px，不是成片像素。
        // 后端 OverlayRenderer 会按「成片宽 / 560」等比放大，别在这里提前换算。
        fontSize: Number(style.fontSize) || 16,
        weight: Number(style.weight) || 400,
        align: style.align || "center",
      });
    } else {
      const graphic = clip.graphic || {};
      overlays.push({
        kind: "graphic",
        start: filmStart,
        end: filmEnd,
        shape: graphic.shape || "rect",
        color: graphic.color || "#6cb2ec",
        x: Number(graphic.x) || 50,
        y: Number(graphic.y) || 50,
        scale: Number(graphic.scale) || 100,
        opacity: Number(graphic.opacity) || 100,
      });
    }
  }
  return overlays.length ? overlays : null;
}

function exportedVideoClips(timeline) {
  const main = mainVideoTrack(timeline);
  if (!main) return [];
  return [...main.clips]
    .filter((clip) => clip.enabled !== false && clip.storageKey)
    .sort((a, b) => a.start - b.start);
}

/**
 * 时间线时间 → 成片时间。成片是「空隙压缩的首尾拼接」：第 i 段在成片里的起点
 * = 前面所有已导出片段的时长之和。返回 null 表示该时间点落在未导出区间（如空隙），
 * 调用方据此丢弃叠加层。
 */
function filmTimeMapper(videoClips) {
  const segments = [];
  let cursor = 0;
  for (const clip of videoClips) {
    const duration = clipDuration(clip);
    segments.push({ from: Number(clip.start) || 0, to: (Number(clip.start) || 0) + duration, film: cursor });
    cursor += duration;
  }
  return (time) => {
    for (const segment of segments) {
      if (time >= segment.from && time < segment.to) {
        return segment.film + (time - segment.from);
      }
    }
    // 末段末尾：贴到成片结尾（避免尾部叠加被误丢）
    if (segments.length && time === segments[segments.length - 1].to) {
      return segments[segments.length - 1].film + (segments[segments.length - 1].to - segments[segments.length - 1].from);
    }
    return null;
  };
}

export function mainVideoTrack(timeline) {
  const videos = (timeline?.tracks || []).filter((track) => track.type === "video");
  return videos.find((track) => track.id === "V1") || videos.at(-1) || null;
}

// 导出用音频片段（混入成片）：与 playableAudioClips 同一过滤口径（轨不静音 /
// 片段启用 / 未静音 / 有可播放产物），但比视频扁平 clips 多一个 start —— 它是
// 时间线上的绝对位置，后端据此 adelay 对齐混入点。注意视频导出是「空隙压缩
// 首尾拼接」，V1 无空隙时时间线时间与成片时间一致；V1 有空隙时按成片时间近似。
export function exportAudioClips(timeline) {
  return playableAudioClips(timeline)
    .filter((clip) => clip.enabled !== false && clip.muted !== true && clip.storageKey)
    .map((clip) => ({
      sourceNodeId: clip.sourceNodeId,
      outputIndex: Number(clip.outputIndex) || 0,
      start: Math.max(0, Number(clip.start) || 0),
      trimStart: Number(clip.trimStart) || 0,
      trimEnd: Number(clip.trimEnd) || (Number(clip.trimStart) || 0) + clipDuration(clip),
      muted: Boolean(clip.muted),
      volume: Number.isFinite(Number(clip.volume)) ? Number(clip.volume) : 1,
      ...(clip.imported && clip.localKey ? { localKey: clip.localKey } : {}),
    }));
}

export function allClips(timeline) {
  return (timeline?.tracks || []).flatMap((track) => track.clips.map((clip) => ({ clip, track })));
}

export function audioTracks(timeline) {
  return (timeline?.tracks || []).filter((track) => track.type === "audio");
}

// 预览用音频片段：音频轨（未被静音）上启用的片段，按开始时间升序。
// 轨道静音 = 整轨不参与预览；片段 muted = 只静该段。导出成片经 exportAudioClips 混入（同口径过滤）。
export function playableAudioClips(timeline) {
  return audioTracks(timeline)
    .flatMap((track) => (track.muted ? [] : track.clips
      .filter((clip) => clip.enabled !== false && clip.muted !== true && clip.storageKey)
      .map((clip) => ({ ...clip, trackMuted: false }))))
    .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
}

export function timelineDuration(timeline) {
  return allClips(timeline).reduce((max, { clip }) => Math.max(max, clipEnd(clip)), 0);
}

export function filmDuration(timeline) {
  const main = mainVideoTrack(timeline);
  return (main?.clips || [])
    .filter((clip) => clip.enabled !== false)
    .reduce((sum, clip) => sum + clipDuration(clip), 0);
}

// 吸附锚点：播放头 > 片段端点 > 0 点 > 转场中点（数字越小优先级越高）
export function snapTargets(timeline, playhead = 0, excludeClipIds = []) {
  const targets = [{ time: 0, priority: 2, kind: "zero" }];
  if (Number.isFinite(playhead)) targets.push({ time: playhead, priority: 0, kind: "playhead" });
  for (const { clip } of allClips(timeline)) {
    if (excludeClipIds.includes(clip.id)) continue;
    targets.push({ time: Number(clip.start) || 0, priority: 1, kind: "clip-start" });
    targets.push({ time: clipEnd(clip), priority: 1, kind: "clip-end" });
    if (clip.transitionOut) {
      const end = clipEnd(clip);
      const length = Math.min(Number(clip.transitionOut.duration) || 0.5, clipDuration(clip) / 2);
      targets.push({ time: end - length / 2, priority: 3, kind: "transition" });
    }
  }
  return targets;
}

export function findSnap(time, targets, pxPerSec, thresholdPx = SNAP_THRESHOLD_PX) {
  if (!Number.isFinite(time)) return null;
  const tolerance = thresholdPx / (pxPerSec || 40);
  const candidates = targets
    .map((target) => ({ ...target, distance: Math.abs(target.time - time) }))
    .filter((item) => item.distance <= tolerance)
    .sort((a, b) => a.priority - b.priority || a.distance - b.distance);
  return candidates[0] || null;
}

// 剪切：所有轨道上覆盖播放头的片段同步切开；播放头不在任何片段内部时返回 null。
export function clipsAtPlayhead(timeline, time) {
  return allClips(timeline)
    .filter(({ clip }) => time > (Number(clip.start) || 0) + 0.05 && time < clipEnd(clip) - 0.05)
    .map(({ clip, track }) => ({ clip, track }));
}

export function splitAt(timeline, time) {
  const hits = clipsAtPlayhead(timeline, time);
  if (!hits.length) return null;
  const hitIds = new Set(hits.map(({ clip }) => clip.id));
  const tracks = timeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.flatMap((clip) => {
      if (!hitIds.has(clip.id)) return [clip];
      const leftDuration = time - (Number(clip.start) || 0);
      const rightDuration = clipEnd(clip) - time;
      const left = {
        ...clip,
        id: uid("clip"),
        duration: clip.type === "video" || clip.type === "audio" ? leftDuration : leftDuration,
        trimEnd: (Number(clip.trimStart) || 0) + leftDuration,
        transitionOut: null,
      };
      const right = {
        ...clip,
        id: uid("clip"),
        start: time,
        duration: clip.type === "video" || clip.type === "audio" ? rightDuration : rightDuration,
        trimStart: (Number(clip.trimStart) || 0) + leftDuration,
        trimEnd: (Number(clip.trimStart) || 0) + leftDuration + rightDuration,
        effects: [...(clip.effects || [])],
      };
      return [left, right];
    }),
  }));
  return { timeline: { ...timeline, tracks }, count: hits.length };
}

export function updateClip(timeline, clipId, patch) {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
    })),
  };
}

export function moveClipToTrack(timeline, clipId, fromTrackId, toTrackId, start) {
  let moving = null;
  const stripped = timeline.tracks.map((track) => {
    if (track.id !== fromTrackId) return track;
    return { ...track, clips: track.clips.filter((clip) => {
      if (clip.id !== clipId) return true;
      moving = clip;
      return false;
    }) };
  });
  if (!moving) return timeline;
  return {
    ...timeline,
    tracks: stripped.map((track) => track.id === toTrackId
      ? { ...track, clips: [...track.clips, { ...moving, start: Math.max(0, start) }] }
      : track),
  };
}

export function removeClips(timeline, ids) {
  const set = new Set(ids);
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => !set.has(clip.id)),
    })),
  };
}

export function addClip(timeline, trackId, clip) {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => track.id === trackId
      ? { ...track, clips: [...track.clips, { id: uid("clip"), enabled: true, effects: [], ...clip }] }
      : track),
  };
}

// ── 轨道操作（锁定 / 可见 / 静音 / 增删）───────────────────────────────────────

export function updateTrack(timeline, trackId, patch) {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => (track.id === trackId ? { ...track, ...patch } : track)),
  };
}

export function addTrack(timeline, type) {
  const def = TRACK_TYPES[type];
  if (!def) return timeline;
  const sameType = timeline.tracks.filter((track) => track.type === type);
  const index = sameType.length + 1;
  const prefix = type === "text" ? "T" : type === "graphic" ? "G" : type === "video" ? "V" : "A";
  let id = `${prefix}${index}`;
  let guard = index;
  while (timeline.tracks.some((track) => track.id === id)) { guard += 1; id = `${prefix}${guard}`; }
  const track = {
    id,
    type,
    name: `${def.label} ${id}`,
    height: def.height,
    clips: [],
    locked: false,
    visible: true,
    muted: false,
  };
  // 视频轨插在 V1 之上、音频轨之下，保持「上层压下层」的常见排布
  const insertAt = type === "video"
    ? timeline.tracks.findIndex((item) => item.type === "audio")
    : timeline.tracks.findIndex((item) => item.type === "audio");
  const at = insertAt < 0 ? timeline.tracks.length : insertAt;
  const tracks = [...timeline.tracks];
  tracks.splice(at, 0, track);
  return { ...timeline, tracks };
}

export function removeTrack(timeline, trackId) {
  const track = timeline.tracks.find((item) => item.id === trackId);
  // 主视频轨不可删除（成片依赖它）
  if (!track || track.id === mainVideoTrack(timeline)?.id) return timeline;
  return { ...timeline, tracks: timeline.tracks.filter((item) => item.id !== trackId) };
}

// ── 五类应用：施加到片段 / 轨道上（记录草稿，预览即时可见）──────────────────

// 特效：施加在片段上，effects 存预设 id + 参数
export function applyEffect(timeline, clipId, preset) {
  if (!preset || preset.id === "none") {
    return updateClip(timeline, clipId, { effects: [] });
  }
  return updateClip(timeline, clipId, {
    effects: [{ id: preset.id, label: preset.label, cssFilter: preset.cssFilter, params: preset.params || {} }],
  });
}

// 调节：预设一次性写入 adjust（可再手动微调）
export function applyAdjustPreset(timeline, clipId, preset) {
  if (!preset) return timeline;
  return updateClip(timeline, clipId, { adjust: { ...preset.adjust } });
}

// 转场：施加在片段与右邻之间
export function applyTransition(timeline, clipId, preset) {
  if (!preset || preset.id === "none") {
    return updateClip(timeline, clipId, { transitionOut: null });
  }
  return updateClip(timeline, clipId, {
    transitionOut: { id: preset.id, label: preset.label, duration: preset.duration },
  });
}

// 文字样式：写入 textStyle
export function applyTextStyle(timeline, clipId, preset) {
  if (!preset) return timeline;
  return updateClip(timeline, clipId, {
    textStyle: { id: preset.id, fontSize: preset.fontSize, color: preset.color, weight: preset.weight, align: preset.align },
  });
}

// 图形：在图形轨上新增一个预设图形片段；落在当前播放头位置
export function applyGraphic(timeline, trackId, preset, start, duration = 3) {
  if (!preset) return timeline;
  return addClip(timeline, trackId, {
    type: "graphic",
    start: Math.max(0, Number(start) || 0),
    duration,
    text: preset.label,
    enabled: true,
    graphic: { shape: preset.shape, color: preset.color, x: 50, y: 50, scale: 100, opacity: 100, rotation: 0 },
  });
}

// 播放头处生效的片段（供预览解析当前画面构成）
export function activeClipsAt(timeline, time) {
  return allClips(timeline)
    .filter(({ clip, track }) => track.visible !== false && clip.enabled !== false
      && time >= (Number(clip.start) || 0) && time < clipEnd(clip))
    .map(({ clip, track }) => ({ clip, track }));
}

// 合成某片段的预览滤镜：调节 + 特效叠加
export function clipFilter(clip) {
  if (!clip) return "none";
  const adjust = clip.adjust || {};
  const parts = [];
  if (Number(adjust.brightness)) parts.push(`brightness(${1 + Number(adjust.brightness) / 100})`);
  if (Number(adjust.contrast)) parts.push(`contrast(${1 + Number(adjust.contrast) / 100})`);
  if (Number(adjust.saturate)) parts.push(`saturate(${1 + Number(adjust.saturate) / 100})`);
  for (const effect of clip.effects || []) {
    if (effect?.cssFilter && effect.cssFilter !== "none") parts.push(effect.cssFilter);
  }
  return parts.length ? parts.join(" ") : "none";
}

// 本地导入素材的 sourceNodeId 前缀。它不在画布 graph 里，后端合成时按 localKey
// 直读对象存储，不会去 steps 里找「上游生成步骤」。
export const LOCAL_SOURCE_PREFIX = "local:";

/**
 * 把 /api/assets 上传响应转成剪辑台素材面板的 source。纯函数，便于单测。
 * kind 沿用后端 AssetKind（image/video/audio）；durationMs 缺失时回落 5s，
 * 用户可在右侧属性面板改裁剪区间。posterKey 是裸 storageKey，resolveThumbUrls 可反解。
 */
export function importedSourceFromAsset(asset = {}, fallbackName = "") {
  const storageKey = String(asset.storageKey || "");
  if (!storageKey) return null;
  const kind = String(asset.kind || asset.type || "").toLowerCase();
  const mediaType = kind === "audio" || kind === "image" ? kind : "video";
  const id = asset.id != null ? String(asset.id) : Math.random().toString(36).slice(2, 10);
  const durationSec = Number(asset.durationMs) > 0 ? Number(asset.durationMs) / 1000 : 5;
  return {
    sourceNodeId: `${LOCAL_SOURCE_PREFIX}${id}`,
    sourceTitle: asset.name || asset.title || fallbackName || `本地素材 ${id}`,
    mediaType,
    storageKey,
    outputIndex: 0,
    output: {
      storageKey,
      posterKey: asset.posterKey || "",
      type: mediaType,
      durationSec,
    },
    imported: true,
    assetId: asset.id ?? null,
    sizeBytes: Number(asset.sizeBytes) || 0,
  };
}

/** 草稿里的导入清单做防御式清洗：只保留有 key、带 local: 前缀的合法项。 */
export function normalizeImportedSources(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.flatMap((item) => {
    const key = String(item?.output?.storageKey || item?.storageKey || "");
    const sourceNodeId = String(item?.sourceNodeId || "");
    if (!key || !sourceNodeId.startsWith(LOCAL_SOURCE_PREFIX) || seen.has(sourceNodeId)) return [];
    seen.add(sourceNodeId);
    return [{ ...item, imported: true, storageKey: key, sourceNodeId }];
  });
}

export function sourceClipFromQueue(item) {
  const trimStart = Number(item.trimStart) || 0;
  const trimEnd = Number(item.trimEnd);
  const duration = Number.isFinite(trimEnd) && trimEnd > trimStart
    ? trimEnd - trimStart
    : Number(item.output?.durationSec ?? item.output?.metadata?.durationSec) || 5;
  return {
    // 素材类型来自上游节点种类（视频生成 / 音频生成），决定落哪条轨道与片段渲染形态
    type: item.mediaType === "audio" ? "audio" : "video",
    duration,
    trimStart,
    trimEnd: Number.isFinite(trimEnd) ? trimEnd : trimStart + duration,
    sourceNodeId: item.sourceNodeId,
    outputIndex: Number(item.outputIndex) || 0,
    sourceTitle: item.sourceTitle || item.sourceNodeId,
    storageKey: item.output?.storageKey || item.storageKey || "",
    posterKey: item.output?.posterUrl || item.output?.posterKey || "",
    muted: Boolean(item.muted),
    volume: Number.isFinite(Number(item.volume)) ? Number(item.volume) : 1,
    // 导入素材带标记：漂移检测跳过它，导出成片时把 localKey 交给后端直读
    ...(item.imported ? { imported: true, localKey: item.output?.storageKey || item.storageKey || "" } : {}),
  };
}

// 素材类型判定：优先用上游节点带过来的 mediaType，其次回落到 output.type / 文件后缀
export function mediaKindOf(item) {
  if (item?.mediaType === "audio" || item?.mediaType === "video" || item?.mediaType === "image") return item.mediaType;
  const declared = String(item?.output?.type || item?.type || "").toLowerCase();
  if (declared.includes("audio")) return "audio";
  if (declared.includes("image")) return "image";
  if (declared.includes("video")) return "video";
  const key = item?.output?.storageKey || item?.storageKey || "";
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(key)) return "audio";
  if (/\.(png|jpe?g|webp|gif)$/i.test(key)) return "image";
  if (/\.(mp4|webm|mov)$/i.test(key)) return "video";
  return "video";
}

// 上游产物标识：节点 id + 输出序号。剪辑台片段、素材面板、漂移检测共用同一口径。
export function sourceKeyOf(item) {
  return `${item?.sourceNodeId || ""}:${Number(item?.outputIndex) || 0}`;
}

// 上游音频素材自动落到 A1，与「视频 clips → migrateClips → V1」对齐。
// seededAudioKeys 记录已同步过的上游产物，保证：① 每次打开只补新增的音频节点，不重复添加；
// ② 用户手动删掉的片段不会被重新灌回来。无草稿与已存草稿两条初始化路径都会经过这里。
function audioSourceKey(item) {
  return sourceKeyOf(item);
}

function clipSourceKey(clip) {
  return sourceKeyOf(clip);
}

export function seedAudioSources(timeline, sources = []) {
  if (!timeline?.tracks) return timeline;
  // 导入音频必须手动落轨，不参与「打开即铺 A1」：否则用户导入一次、每次刷新都会被灌回时间线
  const incoming = (Array.isArray(sources) ? sources : []).filter(
    (item) => !item?.imported && mediaKindOf(item) === "audio" && (item?.output?.storageKey || item?.storageKey),
  );
  const seen = new Set(timeline.seededAudioKeys || []);
  const keys = [...new Set(incoming.map(audioSourceKey))];
  const freshKeys = keys.filter((key) => !seen.has(key));
  const fresh = incoming.filter((item) => freshKeys.includes(audioSourceKey(item)));
  let next = timeline;
  if (fresh.length) {
    // 默认时间线自带 A1；用户手工删过音轨时补一条再落
    next = audioTracks(next).length ? next : addTrack(next, "audio");
    const track = audioTracks(next)[0];
    if (track) {
      const existing = new Set(track.clips.map(clipSourceKey));
      let cursor = track.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
      for (const item of fresh) {
        const key = audioSourceKey(item);
        if (existing.has(key)) continue; // 用户已手动加过，不重复
        existing.add(key);
        const clip = { ...sourceClipFromQueue(item), start: cursor };
        next = addClip(next, track.id, clip);
        cursor += clipDuration(clip);
      }
    }
  }
  if (!freshKeys.length) return next;
  return { ...next, seededAudioKeys: [...seen, ...freshKeys] };
}

// ── 上游产物漂移（剪辑台内刷新产物，需求排期 #3）──────────────────────────
// 上游节点重新生成后 storageKey 会变，而 timeline 是打开剪辑台那一刻的快照；
// 不回写的话，播放 / 缩略图 / 导出都会一直指向旧文件。刷新只动媒体引用，
// 绝不碰用户编排（trim / start / 音量 / 特效 / 文字 / 轨道位置）。
function indexUpstreamSources(sources = []) {
  const map = new Map();
  for (const item of (Array.isArray(sources) ? sources : [])) {
    if (item?.imported) continue; // 导入素材不是上游产物，不参与漂移比对
    const storageKey = item?.output?.storageKey || item?.storageKey || "";
    if (!item?.sourceNodeId || !storageKey) continue;
    map.set(sourceKeyOf(item), { ...item, storageKey });
  }
  return map;
}

/**
 * 对比时间线片段与当前上游产物：
 * - outdated：key 相同但 storageKey 变了（上游重新生成过），需回写媒体引用
 * - missing ：片段引用的上游产物已不存在（上游节点被删 / 连线断开 / 产物被清）
 * - added   ：上游有产物但时间线里没有对应片段（新节点 / 新产物，等用户手动落轨）
 */
export function inspectSourceDrift(timeline, sources = []) {
  const upstream = indexUpstreamSources(sources);
  const timelineKeys = new Set();
  const timelineNodeIds = new Set();
  const outdated = [];
  const missing = [];
  for (const { clip } of allClips(timeline)) {
    if (clip.type !== "video" && clip.type !== "audio") continue;
    // 本地导入片段不依赖画布上游节点，既不算缺失也不算过期
    if (clip.imported) continue;
    const key = sourceKeyOf(clip);
    timelineKeys.add(key);
    timelineNodeIds.add(clip.sourceNodeId);
    const latest = upstream.get(key);
    if (!latest) { missing.push({ clipId: clip.id, key, clip }); continue; }
    if ((clip.storageKey || "") !== latest.storageKey) {
      outdated.push({ clipId: clip.id, key, clip, latest });
    }
  }
  // 同一节点换了输出序号（如节点卡改选第 2 个产物）不算「新增素材」，
  // 否则会给用户常驻一条「有 N 个新产物可拖入」的假提示。
  const added = [...upstream.entries()]
    .filter(([key, item]) => !timelineKeys.has(key) && !timelineNodeIds.has(item.sourceNodeId))
    .map(([key, item]) => ({ key, source: item }));
  return { outdated, missing, added };
}

/**
 * 同步最新上游产物到时间线。新增音频沿用 seedAudioSources 的「打开即落 A1」口径；
 * 新增视频**不自动入 V1**（避免打乱用户已编排的主视频轨），只在素材面板列示。
 * 无变化时返回原 timeline 引用，调用方据此跳过写回，保证幂等、不误标脏。
 */
export function syncTimelineSources(timeline, sources = []) {
  if (!timeline?.tracks) return { timeline, updated: 0, addedAudio: 0 };
  const { outdated } = inspectSourceDrift(timeline, sources);
  const patches = new Map();
  for (const entry of outdated) {
    const { latest, clip } = entry;
    patches.set(entry.clipId, {
      storageKey: latest.storageKey,
      posterKey: latest.output?.posterUrl || latest.output?.posterKey || "",
      sourceTitle: latest.sourceTitle || clip.sourceTitle || entry.key,
    });
  }
  let next = timeline;
  if (patches.size) {
    next = {
      ...next,
      tracks: next.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => (patches.has(clip.id) ? { ...clip, ...patches.get(clip.id) } : clip)),
      })),
    };
  }
  const audioCount = (doc) => audioTracks(doc).reduce((sum, track) => sum + track.clips.length, 0);
  const before = audioCount(next);
  next = seedAudioSources(next, sources);
  return { timeline: next, updated: patches.size, addedAudio: audioCount(next) - before };
}

export function formatTime(seconds, withFrames = false) {
  const value = Math.max(0, Number(seconds) || 0);
  const mm = String(Math.floor(value / 60)).padStart(2, "0");
  const ss = String(Math.floor(value % 60)).padStart(2, "0");
  if (!withFrames) return `${mm}:${ss}`;
  const ff = String(Math.floor((value % 1) * 30)).padStart(2, "0");
  return `${mm}:${ss}:${ff}`;
}
