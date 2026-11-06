import test from "node:test";
import assert from "node:assert/strict";
import {
  ASPECTS, aspectSize, clipDuration, clipEnd, emptyTimeline, exportFlatClips, filmDuration,
  findSnap, mainVideoTrack, migrateClips, moveClipToTrack, removeClips, snapTargets,
  splitAt, timelineDuration, updateClip,
} from "../src/components/workflow/editing-suite/model.js";
import { parseSrt, toSrt } from "../src/components/workflow/editing-suite/srt.js";

const flat = (overrides = {}) => ({
  sourceNodeId: "video-1", outputIndex: 0, order: 0, trimStart: 0, trimEnd: 5,
  muted: false, volume: 1, enabled: true,
  output: { storageKey: "users/7/a.mp4", durationSec: 5 },
  ...overrides,
});

test("画幅白名单尺寸：5 画幅 × 2 清晰度，2.35:1 的 1080P 高度为 816", () => {
  assert.equal(ASPECTS.length, 5);
  assert.deepEqual(aspectSize("16:9", "1080P"), [1920, 1080]);
  assert.deepEqual(aspectSize("9:16", "720P"), [720, 1280]);
  assert.deepEqual(aspectSize("2.35:1", "1080P"), [1920, 816]);
  assert.deepEqual(aspectSize("2.35:1", "720P"), [1280, 544]);
  assert.deepEqual(aspectSize("未知", "1080P"), [1920, 1080]); // 回落 16:9
});

test("旧扁平 clips 迁移：铺到 V1 且 start 按有效时长累加，禁用项不进入", () => {
  const timeline = migrateClips([
    flat({ order: 1, sourceNodeId: "v2", trimStart: 1, trimEnd: 4 }),
    flat({ order: 0, sourceNodeId: "v1" }),
    flat({ order: 2, sourceNodeId: "v3", enabled: false }),
  ]);
  const main = mainVideoTrack(timeline);
  assert.equal(main.id, "V1");
  assert.equal(main.clips.length, 2);
  assert.equal(main.clips[0].sourceNodeId, "v1");
  assert.equal(main.clips[0].start, 0);
  assert.equal(main.clips[1].start, 5);
  assert.equal(clipDuration(main.clips[1]), 3);
  assert.equal(timelineDuration(timeline), 8);
});

test("双写：导出扁平 clips 按 start 升序重排，只保留七字段且不含 start/output 大对象", () => {
  const timeline = migrateClips([flat(), flat({ order: 1, sourceNodeId: "v2" })]);
  updateClip(timeline, "x", {}); // 无副作用
  const exported = exportFlatClips(timeline);
  assert.equal(exported.length, 2);
  assert.equal(exported[0].sourceNodeId, "video-1");
  assert.equal(exported[0].order, 0);
  assert.equal(exported[1].order, 1);
  assert.ok(!("start" in exported[0]) && !("output" in exported[0]));
  assert.deepEqual(Object.keys(exported[0]).sort(),
    ["enabled", "muted", "order", "outputIndex", "sourceNodeId", "trimEnd", "trimStart", "volume"]);
  assert.equal(filmDuration(timeline), 10);
});

test("吸附锚点优先级：同距离下播放头 > 片段端点 > 0 点", () => {
  const timeline = migrateClips([flat()]);
  const targets = snapTargets(timeline, 5, []);
  const snap = findSnap(5.05, targets, 40); // 0.05s ≈ 2px
  assert.equal(snap.kind, "playhead");
  const atEnd = findSnap(clipEnd(mainVideoTrack(timeline).clips[0]) + 0.05,
    snapTargets(timeline, 0, []), 40, 20);
  assert.equal(atEnd.kind, "clip-end");
  assert.equal(findSnap(999, targets, 40), null);
  assert.equal(findSnap(5.05, snapTargets(timeline, 5, []), 40, 0), null);
});

test("剪切：所有轨道覆盖播放头的片段同步切开；播放头落空时返回 null", () => {
  let timeline = emptyTimeline();
  const textTrack = timeline.tracks.find((track) => track.type === "text");
  textTrack.clips.push({ id: "t", type: "text", start: 0, duration: 8, text: "字幕", enabled: true });
  const videoTrack = mainVideoTrack(timeline);
  videoTrack.clips.push({ id: "v", type: "video", start: 0, duration: 5, trimStart: 0, trimEnd: 5, storageKey: "k", enabled: true });
  const result = splitAt(timeline, 3);
  assert.equal(result.count, 2);
  const next = result.timeline;
  assert.equal(mainVideoTrack(next).clips.length, 2);
  const [left, right] = mainVideoTrack(next).clips;
  assert.equal(clipDuration(left), 3);
  assert.equal(right.start, 3);
  assert.equal(right.trimStart, 3);
  assert.equal(textTrack.clips.length, 1);
  assert.equal(next.tracks.find((track) => track.id === "T1").clips.length, 2);
  assert.equal(splitAt(next, 20), null); // 播放头不在任何片段内部 → UI 给 toast
});

test("删除与跨轨移动：同类轨道可搬，片段引用不丢失", () => {
  const timeline = migrateClips([flat()]);
  const id = mainVideoTrack(timeline).clips[0].id;
  const moved = moveClipToTrack(timeline, id, "V1", "V2", 2);
  assert.equal(mainVideoTrack(moved).clips.length, 0);
  const target = moved.tracks.find((track) => track.id === "V2");
  assert.equal(target.clips.length, 1);
  assert.equal(target.clips[0].start, 2);
  assert.equal(target.clips[0].storageKey, "users/7/a.mp4");
  assert.equal(removeClips(moved, [id]).tracks.every((track) => !track.clips.length), true);
});

test("SRT 往返：解析异常条目计数、序列化时间码、重叠保留", () => {
  const source = "1\n00:00:01,000 --> 00:00:03,500\n第一句\n\n2\nBAD --> TIME\n坏条目\n\n3\n00:00:02,000 --> 00:00:04,000\n第二句\n";
  const { items, skipped } = parseSrt(source);
  assert.equal(items.length, 2);
  assert.equal(skipped, 1);
  assert.equal(items[0].start, 1);
  assert.equal(items[0].duration, 2.5);
  const srt = toSrt(items.map((item) => ({ ...item, text: item.text, start: item.start, duration: item.duration })));
  assert.ok(srt.includes("00:00:01,000 --> 00:00:03,500"));
  assert.ok(srt.includes("第一句"));
  const back = parseSrt(srt);
  assert.equal(back.items.length, 2);
  assert.equal(parseSrt("\uFEFF" + srt).skipped, 0);
});
