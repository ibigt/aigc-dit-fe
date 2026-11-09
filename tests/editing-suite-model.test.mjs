import test from "node:test";
import assert from "node:assert/strict";
import {
  ASPECTS, ADJUST_PRESETS, EFFECT_PRESETS, GRAPHIC_PRESETS, TEXT_STYLES, TRANSITION_PRESETS,
  activeClipsAt, applyAdjustPreset, applyEffect, applyGraphic, applyTextStyle, applyTransition,
  aspectSize, clipDuration, clipEnd, clipFilter, emptyTimeline, exportFlatClips, filmDuration,
  findSnap, mainVideoTrack, mediaKindOf, migrateClips, moveClipToTrack, playableAudioClips, removeClips,
  removeTrack, snapTargets, sourceClipFromQueue, splitAt, timelineDuration, updateClip, updateTrack, addTrack,
  seedAudioSources, audioTracks, addClip,
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

// ── 批次①：五类应用 / 轨道态 / 预览解析 ───────────────────────────────────────

// updateClip 只更新已存在片段，不会凭空创建；测试里显式播种
const seed = (timeline, trackId, clip) => {
  const tracks = timeline.tracks.map((track) => (track.id === trackId
    ? { ...track, clips: [...track.clips, { id: clip.id, enabled: true, effects: [], ...clip }] }
    : track));
  return { ...timeline, tracks };
};
const seedVideo = (timeline, id = "v1", overrides = {}) => seed(timeline, "V1", {
  id, type: "video", start: 0, duration: 5, trimStart: 0, trimEnd: 5, storageKey: "k", ...overrides,
});

test("默认轨道：含图形轨 G1，轨道带锁定/可见/静音三态", () => {
  const timeline = emptyTimeline();
  const ids = timeline.tracks.map((track) => track.id);
  assert.deepEqual(ids, ["T1", "G1", "V2", "V1", "A1"]);
  const graphic = timeline.tracks.find((track) => track.type === "graphic");
  assert.equal(graphic.height, 40);
  assert.equal(graphic.locked, false);
  assert.equal(graphic.visible, true);
  assert.equal(graphic.muted, false);
});

test("特效：施加到片段并可清除；预设表自带预览滤镜", () => {
  let timeline = seedVideo(emptyTimeline());
  timeline = applyEffect(timeline, "v1", EFFECT_PRESETS.find((item) => item.id === "mono"));
  const clip = timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === "v1");
  assert.equal(clip.effects.length, 1);
  assert.equal(clip.effects[0].id, "mono");
  assert.equal(clipFilter(clip), "grayscale(1)");
  timeline = applyEffect(timeline, "v1", EFFECT_PRESETS.find((item) => item.id === "none"));
  assert.equal(timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === "v1").effects.length, 0);
});

test("调节预设：一次性写入 adjust，预览滤镜与参数一致", () => {
  let timeline = seedVideo(emptyTimeline());
  timeline = applyAdjustPreset(timeline, "v1", ADJUST_PRESETS.find((item) => item.id === "cinema"));
  const clip = timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === "v1");
  assert.equal(clip.adjust.contrast, 26);
  assert.equal(clipFilter(clip), "brightness(0.94) contrast(1.26) saturate(0.86)");
});

test("转场：施加在片段与右邻之间，清除后骑缝徽标消失", () => {
  let timeline = seedVideo(emptyTimeline());
  timeline = applyTransition(timeline, "v1", TRANSITION_PRESETS.find((item) => item.id === "fade"));
  let clip = timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === "v1");
  assert.equal(clip.transitionOut.id, "fade");
  assert.equal(clip.transitionOut.duration, 0.6);
  // 转场中点是合法吸附锚点
  assert.ok(snapTargets(timeline, 0, []).some((target) => target.kind === "transition"));
  timeline = applyTransition(timeline, "v1", TRANSITION_PRESETS.find((item) => item.id === "none"));
  clip = timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === "v1");
  assert.equal(clip.transitionOut, null);
});

test("图形：落到图形轨 G1，带形状/颜色/位置；文字样式写入 textStyle", () => {
  let timeline = emptyTimeline();
  timeline = applyGraphic(timeline, "G1", GRAPHIC_PRESETS.find((item) => item.id === "star"), 2);
  const graphic = timeline.tracks.find((track) => track.id === "G1").clips[0];
  assert.equal(graphic.type, "graphic");
  assert.equal(graphic.graphic.shape, "star");
  assert.equal(graphic.start, 2);
  assert.equal(graphic.duration, 3);
  timeline = seed(timeline, "T1", { id: "t1", type: "text", start: 0, duration: 3, text: "字幕" });
  timeline = applyTextStyle(timeline, "t1", TEXT_STYLES.find((item) => item.id === "title"));
  const text = timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === "t1");
  assert.equal(text.textStyle.fontSize, 32);
  assert.equal(text.textStyle.weight, 700);
});

test("轨道态：锁定/可见/静音可改；新增轨道不与既有 id 冲突；主视频轨不可删", () => {
  let timeline = emptyTimeline();
  timeline = updateTrack(timeline, "A1", { muted: true, locked: true });
  const audio = timeline.tracks.find((track) => track.id === "A1");
  assert.equal(audio.muted, true);
  assert.equal(audio.locked, true);
  timeline = addTrack(timeline, "graphic");
  const graphicTracks = timeline.tracks.filter((track) => track.type === "graphic");
  assert.equal(graphicTracks.length, 2);
  assert.notEqual(graphicTracks[1].id, "G1");
  const before = timeline.tracks.length;
  timeline = removeTrack(timeline, "V1");
  assert.equal(timeline.tracks.length, before, "主视频轨不可删除");
  timeline = removeTrack(timeline, "G1");
  assert.equal(timeline.tracks.length, before - 1);
});

test("预览解析：播放头处生效片段，含可见性与启用过滤", () => {
  let timeline = seedVideo(emptyTimeline());
  timeline = seed(timeline, "T1", { id: "t1", type: "text", start: 1, duration: 2, text: "字幕" });
  assert.equal(activeClipsAt(timeline, 0.5).length, 1);
  assert.equal(activeClipsAt(timeline, 1.5).length, 2);
  assert.equal(activeClipsAt(timeline, 9).length, 0);
  timeline = updateTrack(timeline, "T1", { visible: false });
  assert.equal(activeClipsAt(timeline, 1.5).length, 1, "隐藏轨不参与预览");
});

test("素材类型判定：节点带来的 mediaType 优先，其次产物 type 与文件后缀", () => {
  assert.equal(mediaKindOf({ mediaType: "audio", output: { storageKey: "a.mp4" } }), "audio");
  assert.equal(mediaKindOf({ output: { type: "audio", storageKey: "x" } }), "audio");
  assert.equal(mediaKindOf({ storageKey: "users/7/voice.mp3" }), "audio");
  assert.equal(mediaKindOf({ output: { storageKey: "users/7/a.mp4" } }), "video");
  assert.equal(mediaKindOf({}), "video");
});

test("音频素材入轨：sourceClipFromQueue 产出 audio 片段，视频仍为 video", () => {
  const audio = sourceClipFromQueue({
    mediaType: "audio", sourceNodeId: "audio-1", outputIndex: 0, sourceTitle: "配音",
    trimStart: 1, trimEnd: 4, output: { storageKey: "users/7/voice.mp3" },
  });
  assert.equal(audio.type, "audio");
  assert.equal(clipDuration(audio), 3);
  assert.equal(audio.posterKey, "", "音频没有封面帧");
  const video = sourceClipFromQueue({ sourceNodeId: "v", output: { storageKey: "a.mp4" } });
  assert.equal(video.type, "video");
});

test("音频预览清单：跳过静音轨、片段静音、禁用与无产物项，并按开始时间排序", () => {
  let timeline = emptyTimeline();
  timeline = seed(timeline, "A1", { id: "a2", type: "audio", start: 5, duration: 2, storageKey: "a2.mp3" });
  timeline = seed(timeline, "A1", { id: "a1", type: "audio", start: 1, duration: 2, storageKey: "a1.mp3" });
  assert.deepEqual(playableAudioClips(timeline).map((clip) => clip.id), ["a1", "a2"]);

  timeline = seed(timeline, "A1", { id: "mute", type: "audio", start: 0, duration: 1, storageKey: "m.mp3", muted: true });
  timeline = seed(timeline, "A1", { id: "off", type: "audio", start: 0, duration: 1, storageKey: "o.mp3", enabled: false });
  timeline = seed(timeline, "A1", { id: "empty", type: "audio", start: 0, duration: 1 });
  const ids = playableAudioClips(timeline).map((clip) => clip.id);
  assert.equal(ids.includes("mute"), false);
  assert.equal(ids.includes("off"), false);
  assert.equal(ids.includes("empty"), false);

  // 整轨静音后整条音频轨都不参与预览
  timeline = updateTrack(timeline, "A1", { muted: true });
  assert.deepEqual(playableAudioClips(timeline), []);
});

test("音频片段不进入成片扁平队列：exportFlatClips / filmDuration 只看主视频轨", () => {
  let timeline = seedVideo(emptyTimeline());
  timeline = seed(timeline, "A1", { id: "a1", type: "audio", start: 0, duration: 9, storageKey: "a1.mp3" });
  assert.equal(exportFlatClips(timeline).length, 1);
  assert.equal(filmDuration(timeline), 5, "音频不拉长成片时长");
  assert.equal(timelineDuration(timeline), 9, "时间线总长含音频轨");
});

// ---- 剪辑台缩略图取址（11-09：视频产物只有 storageKey 没有海报时的首帧兜底）----
// mediaUrl 会读 localStorage 取 token，node 环境下补一个最小 window
globalThis.window = globalThis.window || { localStorage: { getItem: () => "" } };
const { resolveThumbUrls } = await import("../src/components/workflow/editing-suite/thumbUrls.js");

test("视频产物只有 storageKey 时 poster 为空、video 指向可播放地址", () => {
  const { poster, video } = resolveThumbUrls({ output: { type: "video", storageKey: "users/7/a-0.mp4" } }, 160);
  assert.equal(poster, "", "mp4 不能塞进 <img>，应回落到 <video> 首帧");
  assert.match(video, /\/api\/media\?key=.*a-0\.mp4/);
  assert.ok(!video.includes("&w="), "视频播放地址不该带缩略图宽度参数");
});

test("有真实海报图时 poster 走图片缩略图通道，video 仍可用作兜底", () => {
  const { poster, video } = resolveThumbUrls({ output: { storageKey: "users/7/a.mp4", posterUrl: "posters/a.jpg" } }, 160);
  assert.match(poster, /\/api\/media\?key=.*a\.jpg/);
  assert.match(poster, /&w=160/);
  assert.match(video, /a\.mp4/);
});

test("后端把 poster 误记成视频地址时不塞进 <img>", () => {
  const { poster, video } = resolveThumbUrls({ output: { storageKey: "users/7/a.mp4", posterUrl: "users/7/a.mp4" } }, 160);
  assert.equal(poster, "");
  assert.match(video, /a\.mp4/);
  const encoded = resolveThumbUrls({ output: { storageKey: "users/7/a.mp4", posterUrl: "/api/media?key=x%2Fa.mp4&token=t" } }, 160);
  assert.equal(encoded.poster, "", "/api/media?key=…mp4&token=… 也要被识别为视频地址");
});

test("图片素材自身就是封面", () => {
  const { poster, video } = resolveThumbUrls({ output: { storageKey: "users/7/pic.png" } }, 160);
  assert.match(poster, /&w=160/);
  assert.match(video, /pic\.png/);
});

test("时间线 clip 形态（顶层 storageKey + 已 URL 化的 posterKey）可幂等重建", () => {
  const { poster, video } = resolveThumbUrls({ storageKey: "users/7/a.mp4", posterKey: "/api/media?key=posters%2Fa.jpg&token=t" }, 120);
  assert.match(poster, /posters%2Fa\.jpg/);
  assert.match(poster, /&w=120/);
  assert.match(video, /a\.mp4/);
});

test("空输入返回空地址，不会产生无效 url()", () => {
  assert.deepEqual(resolveThumbUrls(), { poster: "", video: "" });
  assert.deepEqual(resolveThumbUrls({ output: {} }, 160), { poster: "", video: "" });
});

// ---- 音频素材自动落 A1（11-09：与视频 clips→V1 对齐）----
const audioSource = (id, index = 0) => ({
  sourceNodeId: id, outputIndex: index, mediaType: "audio",
  output: { type: "audio", storageKey: `users/7/${id}-${index}.mp3`, durationSec: 4 },
  storageKey: `users/7/${id}-${index}.mp3`,
});
const videoSource = (id) => ({
  sourceNodeId: id, outputIndex: 0, mediaType: "video",
  output: { type: "video", storageKey: `users/7/${id}.mp4` },
  storageKey: `users/7/${id}.mp4`,
});
const audioClipsOf = (t) => audioTracks(t)[0]?.clips || [];

test("只把音频素材自动落到 A1，视频不重复落轨", () => {
  const base = migrateClips([videoSource("v")]);
  const next = seedAudioSources(base, [videoSource("v"), audioSource("a")]);
  assert.equal(audioClipsOf(next).length, 1);
  assert.equal(audioClipsOf(next)[0].type, "audio");
  assert.equal(audioClipsOf(next)[0].sourceNodeId, "a");
  assert.equal(mainVideoTrack(next).clips.length, 1, "V1 仍只有原视频片段");
  assert.ok(!exportFlatClips(next).some((clip) => clip.type === "audio"), "音频不进扁平 clips / 后端 compose");
});

test("重复打开不会重复添加音频片段", () => {
  const once = seedAudioSources(migrateClips([]), [audioSource("a")]);
  const twice = seedAudioSources(once, [audioSource("a")]);
  assert.equal(audioClipsOf(twice).length, 1);
  assert.deepEqual(twice.seededAudioKeys, ["a:0"]);
});

test("新增音频节点后只补这一段，已有片段保持不动", () => {
  const once = seedAudioSources(migrateClips([]), [audioSource("a")]);
  const next = seedAudioSources(once, [audioSource("a"), audioSource("b")]);
  assert.deepEqual(audioClipsOf(next).map((clip) => clip.sourceNodeId), ["a", "b"]);
  assert.equal(audioClipsOf(next)[1].start, 4, "首尾相接，接在 a 的末尾");
  assert.deepEqual(next.seededAudioKeys, ["a:0", "b:0"]);
});

test("用户手动删掉的音频片段不会被重新灌回来", () => {
  const once = seedAudioSources(migrateClips([]), [audioSource("a")]);
  const without = { ...once, tracks: once.tracks.map((track) => track.id === "A1" ? { ...track, clips: [] } : track) };
  const again = seedAudioSources(without, [audioSource("a")]);
  assert.equal(audioClipsOf(again).length, 0);
});

test("用户已手动加过同来源片段时不重复添加", () => {
  const base = addClip(migrateClips([]), "A1", { ...sourceClipFromQueue(audioSource("a")), start: 0 });
  const next = seedAudioSources(base, [audioSource("a")]);
  assert.equal(audioClipsOf(next).length, 1);
});

test("无可播放产物的音频源被忽略；无 sources 时原样返回", () => {
  const base = migrateClips([]);
  assert.equal(seedAudioSources(base, [{ ...audioSource("a"), output: {}, storageKey: "" }]), base);
  assert.equal(seedAudioSources(base, []), base);
});
