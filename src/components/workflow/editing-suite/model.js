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
    { id: "T1", type: "text", name: "文字 T1", height: 28, clips: [] },
    { id: "V2", type: "video", name: "视频 V2", height: 56, clips: [] },
    { id: "V1", type: "video", name: "视频 V1", height: 56, clips: [] },
    { id: "A1", type: "audio", name: "音频 A1", height: 40, clips: [] },
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

export function sourceClipFromQueue(item) {
  const trimStart = Number(item.trimStart) || 0;
  const trimEnd = Number(item.trimEnd);
  const duration = Number.isFinite(trimEnd) && trimEnd > trimStart
    ? trimEnd - trimStart
    : Number(item.output?.durationSec ?? item.output?.metadata?.durationSec) || 5;
  return {
    type: "video",
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

export function formatTime(seconds, withFrames = false) {
  const value = Math.max(0, Number(seconds) || 0);
  const mm = String(Math.floor(value / 60)).padStart(2, "0");
  const ss = String(Math.floor(value % 60)).padStart(2, "0");
  if (!withFrames) return `${mm}:${ss}`;
  const ff = String(Math.floor((value % 1) * 30)).padStart(2, "0");
  return `${mm}:${ss}:${ff}`;
}
