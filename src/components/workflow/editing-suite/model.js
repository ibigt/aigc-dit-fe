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
      sourceNodeId: clip.sourceNodeId,
      outputIndex: Number(clip.outputIndex) || 0,
      order,
      trimStart: Number(clip.trimStart) || 0,
      trimEnd: Number(clip.trimEnd) || (Number(clip.trimStart) || 0) + clipDuration(clip),
      muted: Boolean(clip.muted),
      volume: Number.isFinite(Number(clip.volume)) ? Number(clip.volume) : 1,
      enabled: true,
    }));
}

export function mainVideoTrack(timeline) {
  const videos = (timeline?.tracks || []).filter((track) => track.type === "video");
  return videos.find((track) => track.id === "V1") || videos.at(-1) || null;
}

export function allClips(timeline) {
  return (timeline?.tracks || []).flatMap((track) => track.clips.map((clip) => ({ clip, track })));
}

export function audioTracks(timeline) {
  return (timeline?.tracks || []).filter((track) => track.type === "audio");
}

// 预览用音频片段：音频轨（未被静音）上启用的片段，按开始时间升序。
// 轨道静音 = 整轨不参与预览；片段 muted = 只静该段。导出成片暂不混入音频轨（后端合成链路见批次②）。
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
    posterKey: item.output?.posterUrl || "",
    muted: Boolean(item.muted),
    volume: Number.isFinite(Number(item.volume)) ? Number(item.volume) : 1,
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

// 上游音频素材自动落到 A1，与「视频 clips → migrateClips → V1」对齐。
// seededAudioKeys 记录已同步过的上游产物，保证：① 每次打开只补新增的音频节点，不重复添加；
// ② 用户手动删掉的片段不会被重新灌回来。无草稿与已存草稿两条初始化路径都会经过这里。
function audioSourceKey(item) {
  return `${item?.sourceNodeId || ""}:${Number(item?.outputIndex) || 0}`;
}

function clipSourceKey(clip) {
  return `${clip?.sourceNodeId || ""}:${Number(clip?.outputIndex) || 0}`;
}

export function seedAudioSources(timeline, sources = []) {
  if (!timeline?.tracks) return timeline;
  const incoming = (Array.isArray(sources) ? sources : []).filter(
    (item) => mediaKindOf(item) === "audio" && (item?.output?.storageKey || item?.storageKey),
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

export function formatTime(seconds, withFrames = false) {
  const value = Math.max(0, Number(seconds) || 0);
  const mm = String(Math.floor(value / 60)).padStart(2, "0");
  const ss = String(Math.floor(value % 60)).padStart(2, "0");
  if (!withFrames) return `${mm}:${ss}`;
  const ff = String(Math.floor((value % 1) * 30)).padStart(2, "0");
  return `${mm}:${ss}:${ff}`;
}
