import test from "node:test";
import assert from "node:assert/strict";
import {
  EFFECT_PRESETS, TRANSITION_PRESETS,
  addClip, applyEffect, applyTransition, emptyTimeline, exportClipStyles, exportFlatClips, exportOverlays,
  removeTrack, updateTrack,
} from "../src/components/workflow/editing-suite/model.js";
import { applyAssistantBatch, validateAssistantAction } from "../src/components/workflow/editing-suite/assistant.js";
import { createEditingStore } from "../src/components/workflow/editing-suite/store.js";

const video = (id, start, duration, extra = {}) => ({
  id, type: "video", start, duration,
  trimStart: 0, trimEnd: duration,
  storageKey: `${id}.mp4`, volume: 1, muted: false, enabled: true, effects: [],
  ...extra,
});

function withMedia() {
  let timeline = emptyTimeline();
  timeline = addClip(timeline, "V1", video("v1", 0, 4));
  timeline = addClip(timeline, "V1", video("v2", 8, 3, { trimStart: 1, trimEnd: 4, duration: 9 }));
  timeline = addClip(timeline, "V2", video("pip", 1, 2));
  timeline = addClip(timeline, "A1", {
    id: "a1", type: "audio", start: 0, duration: 3, trimStart: 0, trimEnd: 3,
    storageKey: "a1.mp3", volume: 0.4, muted: false, effects: [],
  });
  timeline = addClip(timeline, "T1", {
    id: "t1", type: "text", start: 0, duration: 2, text: "已有字幕",
  });
  return timeline;
}

function clipOf(timeline, id) {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((item) => item.id === id);
    if (clip) return clip;
  }
  return null;
}

test("播放头加 3 秒空字幕：只增文字片段，并给出可进入编辑的 id", () => {
  const timeline = emptyTimeline();
  const result = applyAssistantBatch(timeline, [{ op: "addCaption", text: "注入", start: 99 }], {
    time: 2.5, clipId: "cap-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(result.selection, ["cap-1"]);
  assert.equal(result.editClipId, "cap-1");
  const caption = clipOf(result.timeline, "cap-1");
  assert.equal(caption.type, "text");
  assert.equal(caption.text, "");
  assert.equal(caption.start, 2.5);
  assert.equal(caption.duration, 3);
  assert.equal(caption.textStyle.fontSize, 18);
  assert.equal(caption.textStyle.align, "center");
  assert.equal(result.timeline.tracks.find((track) => track.id === "V1").clips.length, 0);
  assert.equal(exportOverlays(result.timeline), null);
});

test("没有文字轨或文字轨被锁定时不添加字幕", () => {
  const removed = removeTrack(emptyTimeline(), "T1");
  const missing = applyAssistantBatch(removed, [{ op: "addCaption" }], { time: 1, clipId: "cap" });
  assert.equal(missing.ok, false);
  assert.equal(missing.timeline, removed);

  const locked = updateTrack(emptyTimeline(), "T1", { locked: true });
  const blocked = applyAssistantBatch(locked, [{ op: "addCaption" }], { time: 1, clipId: "cap" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.timeline, locked);
});

test("清除特效：多个选中片段一次清掉；没选中或没有特效时时间线不动", () => {
  let timeline = withMedia();
  timeline = applyEffect(timeline, "v1", EFFECT_PRESETS.find((item) => item.id === "mono"));
  timeline = applyEffect(timeline, "a1", EFFECT_PRESETS.find((item) => item.id === "warm"));
  const before = timeline;

  const empty = applyAssistantBatch(timeline, [{ op: "clearEffects", clipIds: [] }]);
  assert.equal(empty.ok, false);
  assert.equal(empty.timeline, timeline);

  const clean = applyAssistantBatch(timeline, [{ op: "clearEffects", clipIds: ["v2"] }]);
  assert.equal(clean.ok, true);
  assert.equal(clean.changed, false);
  assert.equal(clean.timeline, timeline);

  const cleared = applyAssistantBatch(timeline, [{ op: "clearEffects", clipIds: ["v1", "a1", "v2"] }]);
  assert.equal(cleared.changed, true);
  assert.deepEqual(clipOf(cleared.timeline, "v1").effects, []);
  assert.deepEqual(clipOf(cleared.timeline, "a1").effects, []);
  assert.equal(clipOf(cleared.timeline, "v2"), clipOf(before, "v2"));
  assert.match(cleared.message, /2 个片段/);
});

test("静音只落在视频和音频上，不改音量；文字或图片单独选中时时间线不动", () => {
  let timeline = withMedia();
  timeline = addClip(timeline, "V1", video("still", 12, 5, { type: "image", storageKey: "still.png" }));
  const videoClip = clipOf(timeline, "v1");

  const textOnly = applyAssistantBatch(timeline, [{ op: "muteClips", clipIds: ["t1"] }]);
  assert.equal(textOnly.ok, false);
  assert.equal(textOnly.timeline, timeline);

  const imageOnly = applyAssistantBatch(timeline, [{ op: "muteClips", clipIds: ["still"] }]);
  assert.equal(imageOnly.ok, false);
  assert.equal(imageOnly.timeline, timeline);

  const muted = applyAssistantBatch(timeline, [{
    op: "muteClips", clipIds: ["v1", "a1", "t1", "still"], volume: 0,
  }]);
  assert.equal(muted.changed, true);
  assert.equal(clipOf(muted.timeline, "v1").muted, true);
  assert.equal(clipOf(muted.timeline, "v1").volume, videoClip.volume);
  assert.equal(clipOf(muted.timeline, "a1").muted, true);
  assert.equal(clipOf(muted.timeline, "a1").volume, 0.4);
  assert.equal(clipOf(muted.timeline, "t1"), clipOf(timeline, "t1"));
  assert.equal(clipOf(muted.timeline, "still"), clipOf(timeline, "still"));

  const again = applyAssistantBatch(muted.timeline, [{ op: "muteClips", clipIds: ["v1", "a1"] }]);
  assert.equal(again.changed, false);
  assert.equal(again.timeline, muted.timeline);
});

test("转场只接受左栏同一份预设；未知预设或半批失败都不改时间线", () => {
  let timeline = withMedia();
  timeline = applyEffect(timeline, "v1", EFFECT_PRESETS.find((item) => item.id === "mono"));
  const original = timeline;

  const unknown = applyAssistantBatch(timeline, [{ op: "applyTransition", presetId: "dissolve", clipIds: ["v1"] }]);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.timeline, original);

  const applied = applyAssistantBatch(timeline, [{ op: "applyTransition", presetId: "fade", clipIds: ["v1", "v2"] }]);
  assert.equal(clipOf(applied.timeline, "v1").transitionOut.id, "fade");
  assert.equal(clipOf(applied.timeline, "v1").transitionOut.duration, 0.6);
  assert.equal(clipOf(applied.timeline, "v2").transitionOut.id, "fade");
  assert.equal(clipOf(applied.timeline, "v1").trimEnd, 4);
  const styles = exportClipStyles(applied.timeline);
  assert.equal(styles[0].transitionId, "fade");
  assert.equal(styles[0].effect, "mono");

  const partial = applyAssistantBatch(original, [
    { op: "clearEffects", clipIds: ["v1"] },
    { op: "applyTransition", presetId: "not-in-list", clipIds: ["v1"] },
  ]);
  assert.equal(partial.ok, false);
  assert.equal(partial.timeline, original);
  assert.equal(clipOf(partial.timeline, "v1").effects[0].id, "mono");

  for (const preset of TRANSITION_PRESETS) {
    const verdict = validateAssistantAction({ op: "applyTransition", presetId: preset.id, clipIds: ["v1"] }, original);
    assert.equal(verdict.ok, true, preset.id);
  }
});

test("主轨按现有时间顺序收成首尾相接，只改开始时间", () => {
  let timeline = withMedia();
  timeline = addClip(timeline, "V1", video("later", 1, 2));
  const pip = clipOf(timeline, "pip");
  const result = applyAssistantBatch(timeline, [{ op: "packMainTrack", clipIds: ["pip"] }]);
  assert.equal(result.changed, true);
  const v1 = result.timeline.tracks.find((track) => track.id === "V1").clips;
  const byId = Object.fromEntries(v1.map((clip) => [clip.id, clip]));
  assert.equal(byId.v1.start, 0);
  assert.equal(byId.later.start, 4);
  assert.equal(byId.v2.start, 6);
  assert.equal(byId.v2.trimStart, 1);
  assert.equal(byId.v2.trimEnd, 4);
  assert.equal(byId.v2.duration, 9);
  assert.equal(byId.v2.storageKey, "v2.mp4");
  assert.equal(byId.v1, clipOf(timeline, "v1"));
  assert.equal(clipOf(result.timeline, "pip"), pip);
  assert.equal(clipOf(result.timeline, "a1"), clipOf(timeline, "a1"));

  const flat = exportFlatClips(result.timeline);
  assert.deepEqual(flat.map((clip) => clip.trimStart), [0, 0, 1]);
  assert.deepEqual(flat.map((clip) => [clip.clipId, clip.trimEnd]), [
    ["v1", 4], ["later", 2], ["v2", 4],
  ]);

  const again = applyAssistantBatch(result.timeline, [{ op: "packMainTrack" }]);
  assert.equal(again.changed, false);
  assert.equal(again.timeline, result.timeline);
});

test("主轨已锁定或没有空隙时不改时间线", () => {
  const locked = updateTrack(withMedia(), "V1", { locked: true });
  const blocked = applyAssistantBatch(locked, [{ op: "packMainTrack" }]);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.timeline, locked);

  let tight = emptyTimeline();
  tight = addClip(tight, "V1", video("a", 2, 3));
  tight = addClip(tight, "V1", video("b", 5, 1));
  const packed = applyAssistantBatch(tight, [{ op: "packMainTrack" }]);
  assert.equal(packed.changed, false);
  assert.equal(packed.timeline, tight);
  assert.equal(clipOf(packed.timeline, "a").start, 2);
});

test("不认识的动作、坏片段引用整批拒绝，不能借字段直接改时间线", () => {
  const timeline = withMedia();
  for (const op of ["autoScore", "oneClickCaption", "rewriteTimeline"]) {
    const result = applyAssistantBatch(timeline, [{ op, clipIds: ["v1"] }]);
    assert.equal(result.ok, false);
    assert.equal(result.timeline, timeline);
  }
  const badIds = applyAssistantBatch(timeline, [{ op: "clearEffects", clipIds: ["v1", "missing"] }]);
  assert.equal(badIds.ok, false);
  assert.equal(badIds.timeline, timeline);
  const notArray = applyAssistantBatch(timeline, [{ op: "muteClips", clipIds: "v1" }]);
  assert.equal(notArray.ok, false);
  assert.equal(validateAssistantAction({ op: "muteClips", clipIds: [{ id: "v1" }] }, timeline).ok, false);
});

test("一批动作一次 commit，撤销整步退回", () => {
  const previous = globalThis.window;
  globalThis.window = { innerWidth: 1600, setTimeout, clearTimeout };
  try {
    let timeline = withMedia();
    timeline = applyEffect(timeline, "v1", EFFECT_PRESETS.find((item) => item.id === "mono"));
    timeline = applyTransition(timeline, "a1", TRANSITION_PRESETS.find((item) => item.id === "wipe"));
    const store = createEditingStore(timeline);
    const actions = [
      { op: "clearEffects", clipIds: ["v1"] },
      { op: "muteClips", clipIds: ["v1", "a1"] },
      { op: "applyTransition", presetId: "none", clipIds: ["a1"] },
    ];
    const changed = store.commit("助手动作", (doc) => {
      const applied = applyAssistantBatch(doc.timeline, actions);
      assert.equal(applied.ok, true);
      return { ...doc, timeline: applied.timeline, selection: applied.selection ?? doc.selection };
    });
    assert.equal(changed, true);
    assert.equal(store.getState().past.length, 1);
    assert.equal(store.getState().view.dirty, true);
    assert.deepEqual(clipOf(store.getState().doc.timeline, "v1").effects, []);
    assert.equal(clipOf(store.getState().doc.timeline, "v1").muted, true);
    assert.equal(clipOf(store.getState().doc.timeline, "a1").muted, true);
    assert.equal(clipOf(store.getState().doc.timeline, "a1").transitionOut, null);
    store.undo();
    assert.equal(store.getState().past.length, 0);
    assert.equal(store.getState().doc.timeline, timeline);
    assert.equal(clipOf(store.getState().doc.timeline, "v1").effects[0].id, "mono");
    assert.equal(clipOf(store.getState().doc.timeline, "a1").transitionOut.id, "wipe");
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
