// 剪辑助手一期：受限动作（op + presetId 白名单 + clipIds）。
// 校验通过后只调用 model.js 已有纯函数。不读动作里的其它字段，避免直接改写 timeline。
// 一批动作由调用方一次 store.commit；这里不碰撤销栈，也不发请求。

import {
  EFFECT_PRESETS, TEXT_STYLES, TRANSITION_PRESETS,
  addClip, applyEffect, applyTextStyle, applyTransition,
  clipDuration, mainVideoTrack, presetById, updateClip,
} from "./model.js";

export const ASSISTANT_OPS = Object.freeze([
  "addCaption",
  "clearEffects",
  "muteClips",
  "applyTransition",
  "packMainTrack",
]);

export const CAPTION_DURATION = 3;

const OP_SET = new Set(ASSISTANT_OPS);
const AUDIBLE_TYPES = new Set(["video", "audio"]);

function clipsById(timeline) {
  const map = new Map();
  for (const track of timeline?.tracks || []) {
    for (const clip of track.clips || []) map.set(clip.id, { clip, track });
  }
  return map;
}

function hasEffect(clip) {
  return (clip?.effects || []).some((item) => item && item.id && item.id !== "none");
}

function sameTransition(clip, preset) {
  if (!preset || preset.id === "none") return !clip?.transitionOut;
  return clip?.transitionOut?.id === preset.id;
}

function normalizeClipIds(clipIds) {
  if (clipIds == null) return [];
  if (!Array.isArray(clipIds)) return null;
  const ids = [];
  const seen = new Set();
  for (const raw of clipIds) {
    if (raw == null || typeof raw === "object") return null;
    const id = String(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * 校验一条动作。只接受 op / presetId / clipIds。
 * 选中类动作的 clipIds 必须都能在当前时间线找到，否则整条拒绝。
 */
export function validateAssistantAction(action, timeline) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    return { ok: false, error: "无法识别的剪辑动作" };
  }
  if (!OP_SET.has(action.op)) {
    return { ok: false, error: "不支持的剪辑动作" };
  }
  const clipIds = normalizeClipIds(action.clipIds);
  if (clipIds == null) return { ok: false, error: "片段引用无效" };
  if (action.op === "applyTransition" && !presetById(TRANSITION_PRESETS, action.presetId)) {
    return { ok: false, error: "转场预设不在可用列表里" };
  }
  if (action.op === "clearEffects" || action.op === "muteClips" || action.op === "applyTransition") {
    if (!clipIds.length) {
      return {
        ok: false,
        error: action.op === "muteClips" ? "请先在时间线选中视频或音频片段" : "请先在时间线选中片段",
      };
    }
    const known = clipsById(timeline);
    if (clipIds.some((id) => !known.has(id))) {
      return { ok: false, error: "有选中片段已不在时间线上" };
    }
  }
  return {
    ok: true,
    action: { op: action.op, presetId: action.presetId ?? null, clipIds },
  };
}

/**
 * 按顺序应用一批已受限动作。任一条不合法或无法执行时，返回调用方传入的 timeline 引用，不留下半成品。
 * 没有任何字段变化时同样返回原引用，便于 store.commit 判定为无改动。
 * context.time 只给「播放头加字幕」用；context.clipId 固定新字幕 id，方便立刻进入编辑。
 */
export function applyAssistantBatch(timeline, actions, context = {}) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: false, error: "没有可执行的剪辑动作", timeline, changed: false };
  }
  let next = timeline;
  let selection = null;
  let editClipId = null;
  const notes = [];
  for (const raw of actions) {
    const verdict = validateAssistantAction(raw, next);
    if (!verdict.ok) return { ok: false, error: verdict.error, timeline, changed: false };
    const step = applyOne(next, verdict.action, context);
    if (!step.ok) return { ok: false, error: step.error, timeline, changed: false };
    next = step.timeline;
    if (step.selection) selection = step.selection;
    if (step.editClipId) editClipId = step.editClipId;
    if (step.message) notes.push(step.message);
  }
  return {
    ok: true,
    timeline: next,
    changed: next !== timeline,
    selection,
    editClipId,
    message: notes.join("；"),
  };
}

function applyOne(timeline, action, context) {
  switch (action.op) {
    case "addCaption":
      return addCaption(timeline, context);
    case "clearEffects":
      return clearEffects(timeline, action.clipIds);
    case "muteClips":
      return muteClips(timeline, action.clipIds);
    case "applyTransition":
      return transitionClips(timeline, action.clipIds, action.presetId);
    case "packMainTrack":
      return packMain(timeline);
    default:
      return { ok: false, error: "不支持的剪辑动作" };
  }
}

function addCaption(timeline, context) {
  const track = (timeline?.tracks || []).find((item) => item.type === "text");
  if (!track) return { ok: false, error: "没有文字轨，无法添加字幕" };
  if (track.locked) return { ok: false, error: "文字轨已锁定，先解锁再添加字幕" };
  const id = context.clipId || `clip-${Math.random().toString(36).slice(2, 9)}`;
  const time = Number(context.time);
  const start = Number.isFinite(time) ? Math.max(0, time) : 0;
  let next = addClip(timeline, track.id, {
    id,
    type: "text",
    start,
    duration: CAPTION_DURATION,
    text: "",
    enabled: true,
  });
  const caption = presetById(TEXT_STYLES, "caption");
  if (caption) next = applyTextStyle(next, id, caption);
  return {
    ok: true,
    timeline: next,
    selection: [id],
    editClipId: id,
    message: "已在播放头添加 3 秒字幕",
  };
}

function clearEffects(timeline, clipIds) {
  const known = clipsById(timeline);
  const none = presetById(EFFECT_PRESETS, "none");
  const targets = clipIds.filter((id) => hasEffect(known.get(id).clip));
  if (!targets.length) {
    return { ok: true, timeline, message: "选中片段没有可清除的特效" };
  }
  let next = timeline;
  for (const id of targets) next = applyEffect(next, id, none);
  return { ok: true, timeline: next, message: `已清除 ${targets.length} 个片段的特效` };
}

function muteClips(timeline, clipIds) {
  const known = clipsById(timeline);
  const media = clipIds.filter((id) => AUDIBLE_TYPES.has(known.get(id).clip.type));
  if (!media.length) return { ok: false, error: "请先选中视频或音频片段" };
  const targets = media.filter((id) => known.get(id).clip.muted !== true);
  if (!targets.length) {
    return { ok: true, timeline, message: "选中的视频和音频已经是静音" };
  }
  let next = timeline;
  for (const id of targets) next = updateClip(next, id, { muted: true });
  return { ok: true, timeline: next, message: `已静音 ${targets.length} 个片段` };
}

function transitionClips(timeline, clipIds, presetId) {
  const preset = presetById(TRANSITION_PRESETS, presetId);
  if (!preset) return { ok: false, error: "转场预设不在可用列表里" };
  const known = clipsById(timeline);
  const targets = clipIds.filter((id) => !sameTransition(known.get(id).clip, preset));
  if (!targets.length) {
    return { ok: true, timeline, message: `选中片段已经是「${preset.label}」` };
  }
  let next = timeline;
  for (const id of targets) next = applyTransition(next, id, preset);
  const message = preset.id === "none"
    ? `已清除 ${targets.length} 个片段的转场`
    : `已为 ${targets.length} 个片段套上「${preset.label}」`;
  return { ok: true, timeline: next, message };
}

function packMain(timeline) {
  const main = mainVideoTrack(timeline);
  if (!main) return { ok: false, error: "没有主视频轨" };
  if (main.locked) return { ok: false, error: "主视频轨已锁定，先解锁再收紧" };
  if (!main.clips.length) return { ok: true, timeline, message: "主视频轨上没有片段" };
  const startOf = (clip) => {
    const value = Number(clip.start);
    return Number.isFinite(value) ? value : 0;
  };
  const ordered = [...main.clips].sort((a, b) => startOf(a) - startOf(b));
  let cursor = startOf(ordered[0]);
  const patches = [];
  for (const clip of ordered) {
    if (Math.abs(startOf(clip) - cursor) > 0.0005) patches.push({ id: clip.id, start: cursor });
    cursor += clipDuration(clip);
  }
  if (!patches.length) return { ok: true, timeline, message: "主视频轨已经首尾相接" };
  let next = timeline;
  for (const patch of patches) next = updateClip(next, patch.id, { start: patch.start });
  return {
    ok: true,
    timeline: next,
    message: `已把主视频轨收成首尾相接，调整了 ${patches.length} 个片段的开始时间`,
  };
}
