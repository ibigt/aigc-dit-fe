import test from "node:test";
import assert from "node:assert/strict";
import {
  ASPECTS, ADJUST_PRESETS, EFFECT_PRESETS, GRAPHIC_PRESETS, TEXT_STYLES, TRANSITION_PRESETS,
  activeClipsAt, applyAdjustPreset, applyEffect, applyGraphic, applyTextStyle, applyTransition,
  aspectSize, clipDuration, clipEnd, clipFilter, emptyTimeline, exportFlatClips, filmDuration,
  findSnap, mainVideoTrack, mediaKindOf, migrateClips, moveClipToTrack, playableAudioClips, removeClips,
  removeTrack, snapTargets, sourceClipFromQueue, splitAt, timelineDuration, updateClip, updateTrack, addTrack,
  seedAudioSources, audioTracks, addClip, exportAudioClips, exportClipStyles, exportOverlays, exportPipClips,
  MIN_TRIM_DURATION, validateTrim, trimRangeOf,
  sourceKeyOf, inspectSourceDrift, syncTimelineSources,
  LOCAL_SOURCE_PREFIX, importedSourceFromAsset, normalizeImportedSources,
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

test("双写：导出扁平 clips 按 start 升序重排，只保留轻量字段且不含 start/output 大对象", () => {
  const timeline = migrateClips([flat(), flat({ order: 1, sourceNodeId: "v2" })]);
  updateClip(timeline, "x", {}); // 无副作用
  const exported = exportFlatClips(timeline);
  assert.equal(exported.length, 2);
  assert.equal(exported[0].sourceNodeId, "video-1");
  assert.equal(exported[0].order, 0);
  assert.equal(exported[1].order, 1);
  assert.ok(!("start" in exported[0]) && !("output" in exported[0]));
  // clipId 是片段唯一标识：同源同输出的多段靠它区分，后端不能只按 (sourceNodeId, outputIndex) 去重
  assert.deepEqual(Object.keys(exported[0]).sort(),
    ["clipId", "enabled", "muted", "order", "outputIndex", "sourceNodeId", "trimEnd", "trimStart", "volume"]);
  assert.equal(filmDuration(timeline), 10);
});

test("同源同输出的多段各自带独立 clipId（导出不能只剩选中的那一段）", () => {
  const base = migrateClips([flat({ sourceNodeId: "v1", order: 0 })]);
  const track = mainVideoTrack(base);
  const firstId = track.clips[0].id;
  // 同一上游节点的第二段（不同裁剪区间）
  const withSecond = addClip(base, "V1", {
    ...sourceClipFromQueue({ sourceNodeId: "v1", outputIndex: 0, mediaType: "video",
      output: { type: "video", storageKey: "users/7/v1.mp4", durationSec: 10 }, storageKey: "users/7/v1.mp4" }),
    id: "c2", start: 5, duration: 5, trimStart: 0, trimEnd: 5,
  });
  const exported = exportFlatClips(withSecond);
  assert.equal(exported.length, 2);
  assert.equal(exported[0].sourceNodeId, "v1");
  assert.equal(exported[1].sourceNodeId, "v1");
  assert.notEqual(exported[0].clipId, exported[1].clipId, "两段必须有不同 clipId");
  assert.equal(exported[0].clipId, firstId, "首段沿用时间线片段 id");
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

// ---- exportAudioClips（音频轨混入成片的扁平导出）----
test("exportAudioClips 产出带 start 的音频片段，过滤口径与预览一致", () => {
  const base = addClip(migrateClips([]), "A1", { ...sourceClipFromQueue(audioSource("a")), start: 2.5, volume: 0.8 });
  const timeline = { ...base, tracks: base.tracks.map((track) => track.id === "A1"
    ? { ...track, clips: [...track.clips, { ...sourceClipFromQueue(audioSource("b", 1)), start: 10 }] }
    : track) };
  const exported = exportAudioClips(timeline);
  assert.equal(exported.length, 2);
  assert.deepEqual(Object.keys(exported[0]).sort(),
    ["muted", "outputIndex", "sourceNodeId", "start", "trimEnd", "trimStart", "volume"]);
  assert.equal(exported[0].sourceNodeId, "a");
  assert.equal(exported[0].start, 2.5);
  assert.equal(exported[0].volume, 0.8);
  assert.equal(exported[1].sourceNodeId, "b");
});

test("禁用片段与被静音的轨道不进导出", () => {
  const withClips = seedAudioSources(migrateClips([]), [audioSource("a"), audioSource("b")]);
  const disabled = { ...withClips, tracks: withClips.tracks.map((track) => track.id === "A1"
    ? { ...track, clips: track.clips.map((clip, i) => i === 0 ? { ...clip, enabled: false } : clip) } : track) };
  assert.deepEqual(exportAudioClips(disabled).map((clip) => clip.sourceNodeId), ["b"]);
  const trackMuted = { ...withClips, tracks: withClips.tracks.map((track) => track.id === "A1" ? { ...track, muted: true } : track) };
  assert.deepEqual(exportAudioClips(trackMuted), []);
});

test("空音频轨导出为空数组，视频片段不混入", () => {
  const onlyVideo = migrateClips([videoSource("v")]);
  assert.deepEqual(exportAudioClips(onlyVideo), []);
});

// ---- validateTrim / trimRangeOf（属性面板裁剪数值输入，需求排期 #2）----
test("validateTrim 合法输入产出 patch，同步 duration 且消除浮点脏值", () => {
  const result = validateTrim({ trimStart: "0.1", trimEnd: "4.300000000000001" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.patch, { trimStart: 0.1, trimEnd: 4.3, duration: 4.2 });
  assert.equal(result.duration, 4.2);
});

test("validateTrim 拒绝空值 / 非数字 / 无穷大，只给 error 不给 patch", () => {
  for (const input of [
    { trimStart: "", trimEnd: 5 },
    { trimStart: 0, trimEnd: "" },
    { trimStart: "abc", trimEnd: 5 },
    { trimStart: 0, trimEnd: "1e309" },
  ]) {
    const result = validateTrim(input);
    assert.equal(result.ok, false);
    assert.equal(result.error, "请输入有效的裁剪数值");
    assert.equal(result.patch, undefined);
  }
});

test("validateTrim 拒绝负入点 / 出点不大于入点 / 短于 0.1s 的片段", () => {
  assert.equal(validateTrim({ trimStart: -1, trimEnd: 5 }).error, "入点不能小于 0s");
  assert.equal(validateTrim({ trimStart: 2, trimEnd: 2 }).error, "出点必须大于入点");
  assert.equal(validateTrim({ trimStart: 3, trimEnd: 2 }).error, "出点必须大于入点");
  assert.equal(validateTrim({ trimStart: 0, trimEnd: 0.05 }).error, "裁剪时长不能短于 0.1s");
  assert.equal(validateTrim({ trimStart: 0, trimEnd: 0.5, minDuration: 1 }).error, "裁剪时长不能短于 1s");
  assert.equal(validateTrim({ trimStart: 0, trimEnd: MIN_TRIM_DURATION }).ok, true);
});

test("trimRangeOf 为缺 trimEnd 的旧草稿按 clipDuration 兜底", () => {
  assert.deepEqual(trimRangeOf({ type: "video", trimStart: 1.5, trimEnd: 6 }), { trimStart: 1.5, trimEnd: 6 });
  assert.deepEqual(trimRangeOf({ type: "video", trimStart: 1, duration: 4 }), { trimStart: 1, trimEnd: 5 });
});

test("裁剪 patch 落地后，时间线时长与视频扁平导出同步", () => {
  const base = migrateClips([flat({ output: { storageKey: "users/7/long.mp4", durationSec: 10 } })]);
  const clip = mainVideoTrack(base).clips[0];
  const next = updateClip(base, clip.id, validateTrim({ trimStart: 2, trimEnd: 7.5 }).patch);
  assert.equal(clipDuration(mainVideoTrack(next).clips[0]), 5.5);
  assert.equal(timelineDuration(next), 5.5);
  assert.equal(exportFlatClips(next)[0].trimStart, 2);
  assert.equal(exportFlatClips(next)[0].trimEnd, 7.5);
});

test("音频片段裁剪 patch 同样进 exportAudioClips 的混音区间", () => {
  const base = seedAudioSources(migrateClips([]), [audioSource("a")]);
  const clip = audioClipsOf(base)[0];
  const next = updateClip(base, clip.id, validateTrim({ trimStart: 1, trimEnd: 3 }).patch);
  assert.equal(exportAudioClips(next)[0].trimStart, 1);
  assert.equal(exportAudioClips(next)[0].trimEnd, 3);
});

// ---- 上游产物漂移 / 剪辑台内刷新（需求排期 #3）----
const upstream = (id, key, overrides = {}) => ({
  sourceNodeId: id, outputIndex: 0, mediaType: "video", sourceTitle: `${id} 标题`,
  output: { storageKey: key, durationSec: 5 }, storageKey: key,
  ...overrides,
});
const flatWithKey = (id, key) => flat({ sourceNodeId: id, output: { storageKey: key, durationSec: 5 } });

test("sourceKeyOf 用节点 id + 输出序号对齐片段与素材面板", () => {
  assert.equal(sourceKeyOf({ sourceNodeId: "v1", outputIndex: 2 }), "v1:2");
  assert.equal(sourceKeyOf({ sourceNodeId: "v1" }), "v1:0");
});

test("inspectSourceDrift 识别产物更新 / 上游消失 / 新增素材", () => {
  const base = migrateClips([flatWithKey("v1", "old/v1.mp4"), flatWithKey("v2", "old/v2.mp4")]);
  const drift = inspectSourceDrift(base, [upstream("v1", "new/v1.mp4"), upstream("v3", "new/v3.mp4")]);
  assert.deepEqual(drift.outdated.map((item) => item.key), ["v1:0"]);
  assert.deepEqual(drift.missing.map((item) => item.key), ["v2:0"]);
  assert.deepEqual(drift.added.map((item) => item.key), ["v3:0"]);
});

test("syncTimelineSources 只回写媒体引用，保留裁剪 / 位置 / 音量 / 特效", () => {
  const base = migrateClips([flatWithKey("v1", "old/v1.mp4")]);
  const clipId = mainVideoTrack(base).clips[0].id;
  const edited = updateClip(base, clipId, {
    trimStart: 1, trimEnd: 4, start: 2.5, volume: 0.4, effects: [{ id: "mono", label: "黑白" }],
  });
  const result = syncTimelineSources(edited, [upstream("v1", "new/v1.mp4", {
    sourceTitle: "新标题",
    output: { storageKey: "new/v1.mp4", posterUrl: "/api/media?key=poster.png" },
  })]);
  assert.equal(result.updated, 1);
  const clip = mainVideoTrack(result.timeline).clips[0];
  assert.equal(clip.storageKey, "new/v1.mp4");
  assert.equal(clip.sourceTitle, "新标题");
  assert.equal(clip.posterKey, "/api/media?key=poster.png");
  assert.equal(clip.trimStart, 1);
  assert.equal(clip.trimEnd, 4);
  assert.equal(clip.start, 2.5);
  assert.equal(clip.volume, 0.4);
  assert.deepEqual(clip.effects, [{ id: "mono", label: "黑白" }]);
  assert.equal(clipDuration(clip), 3);
  assert.equal(exportFlatClips(result.timeline)[0].trimEnd, 4);
});

test("syncTimelineSources 幂等：无漂移时返回原 timeline 引用", () => {
  const sources = [upstream("v1", "same/v1.mp4")];
  const base = migrateClips([flatWithKey("v1", "same/v1.mp4")]);
  const unchanged = syncTimelineSources(base, sources);
  assert.equal(unchanged.updated, 0);
  assert.equal(unchanged.timeline, base);
  const changed = syncTimelineSources(base, [upstream("v1", "new/v1.mp4")]);
  const again = syncTimelineSources(changed.timeline, [upstream("v1", "new/v1.mp4")]);
  assert.equal(again.updated, 0);
  assert.equal(again.timeline, changed.timeline);
});

test("刷新时新增音频自动落 A1，新增视频不自动塞进 V1", () => {
  const base = seedAudioSources(migrateClips([]), [audioSource("a")]);
  const sources = [audioSource("a"), audioSource("b"), upstream("v9", "new/v9.mp4")];
  const result = syncTimelineSources(base, sources);
  assert.equal(result.addedAudio, 1);
  assert.equal(audioClipsOf(result.timeline).length, 2);
  assert.equal(mainVideoTrack(result.timeline).clips.length, 0);
  assert.deepEqual(inspectSourceDrift(result.timeline, sources).added.map((item) => item.key), ["v9:0"]);
});

test("上游已消失的片段保留在时间线上，只提示不清理", () => {
  const base = migrateClips([flatWithKey("v1", "old/v1.mp4")]);
  const result = syncTimelineSources(base, []);
  assert.equal(result.timeline, base);
  assert.equal(mainVideoTrack(result.timeline).clips.length, 1);
  assert.equal(inspectSourceDrift(base, []).missing.length, 1);
});

test("同节点换输出序号不算新增素材，也不误删已有片段", () => {
  const base = migrateClips([flat({ sourceNodeId: "v1", outputIndex: 1, output: { storageKey: "old/v1.mp4", durationSec: 5 } })]);
  const drift = inspectSourceDrift(base, [upstream("v1", "old/v1.mp4")]);
  assert.equal(drift.added.length, 0);
  assert.deepEqual(drift.missing.map((item) => item.key), ["v1:1"]);
  assert.equal(mainVideoTrack(base).clips.length, 1);
});

// ---- 本地导入素材（排期 #4）----
test("importedSourceFromAsset 把上传响应转成素材面板 source，时长按 durationMs 换算", () => {
  const source = importedSourceFromAsset({
    id: 42, name: "片头.mp4", kind: "video", storageKey: "users/7/assets/a.mp4",
    posterKey: "users/7/assets/a.jpg", durationMs: 3200, sizeBytes: 1024,
  }, "片头.mp4");
  assert.equal(source.sourceNodeId, `${LOCAL_SOURCE_PREFIX}42`);
  assert.ok(source.sourceNodeId.startsWith(LOCAL_SOURCE_PREFIX));
  assert.equal(source.sourceTitle, "片头.mp4");
  assert.equal(source.mediaType, "video");
  assert.equal(source.storageKey, "users/7/assets/a.mp4");
  assert.equal(source.output.durationSec, 3.2);
  assert.equal(source.output.posterKey, "users/7/assets/a.jpg");
  assert.equal(source.imported, true);
  assert.equal(source.assetId, 42);
  assert.equal(mediaKindOf(source), "video");
});

test("importedSourceFromAsset 识别音频 / 图片，缺失时长回落 5s，无 key 返回 null", () => {
  const audio = importedSourceFromAsset({ id: 1, kind: "audio", storageKey: "users/7/a.mp3" });
  assert.equal(audio.mediaType, "audio");
  assert.equal(audio.output.durationSec, 5);
  assert.equal(mediaKindOf(audio), "audio");
  const image = importedSourceFromAsset({ id: 2, type: "image", storageKey: "users/7/a.png" });
  assert.equal(image.mediaType, "image");
  assert.equal(importedSourceFromAsset({ id: 3, kind: "video" }), null);
});

test("图片素材落视频轨：sourceClipFromQueue 产出 image 片段并进扁平导出（静帧段）", () => {
  const source = importedSourceFromAsset({ id: 9, kind: "image", storageKey: "users/7/pic.png", name: "海报" });
  const clip = sourceClipFromQueue(source);
  assert.equal(clip.type, "image");
  assert.equal(clip.trimStart, 0);
  assert.equal(clip.trimEnd, 5);
  assert.equal(clip.localKey, "users/7/pic.png");
  // 时长口径与 video/audio 一致（trimEnd - trimStart）
  assert.equal(clipDuration(clip), 5);
  // 落 V1 后进扁平导出：后端按图片静帧段烧录
  let timeline = migrateClips([]);
  timeline = addClip(timeline, mainVideoTrack(timeline).id, { ...clip, start: 0 });
  const flat = exportFlatClips(timeline);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].localKey, "users/7/pic.png");
  assert.equal(flat[0].trimEnd, 5);
  assert.equal(filmDuration(timeline), 5);
  // 漂移检测不把图片片段当 text/graphic 忽略
  const drift = inspectSourceDrift(timeline, []);
  assert.ok(drift.missing.some((item) => item.clipId === clip.id) || drift.missing.length === 0);
});

test("normalizeImportedSources 只保留合法导入项并按 sourceNodeId 去重", () => {
  const one = importedSourceFromAsset({ id: 1, kind: "video", storageKey: "users/7/a.mp4" });
  const two = importedSourceFromAsset({ id: 2, kind: "audio", storageKey: "users/7/b.mp3" });
  const result = normalizeImportedSources([
    one, { ...two, sourceNodeId: "video-1" }, null, { ...one, storageKey: "" }, one,
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].sourceNodeId, `${LOCAL_SOURCE_PREFIX}1`);
  assert.equal(result[0].imported, true);
  assert.deepEqual(normalizeImportedSources("bad"), []);
});

test("导入素材落轨带 imported / localKey，导出扁平 clips 把 localKey 交给后端", () => {
  const source = importedSourceFromAsset({
    id: 9, name: "本地.mp4", kind: "video", storageKey: "users/7/assets/local.mp4", durationMs: 6000,
  });
  const clip = sourceClipFromQueue(source);
  assert.equal(clip.imported, true);
  assert.equal(clip.localKey, "users/7/assets/local.mp4");
  assert.equal(clip.sourceNodeId, `${LOCAL_SOURCE_PREFIX}9`);
  assert.equal(clipDuration(clip), 6);

  const timeline = addClip(emptyTimeline(), "V1", { ...clip, id: "c1", start: 0 });
  const exported = exportFlatClips(timeline)[0];
  assert.equal(exported.localKey, "users/7/assets/local.mp4");
  assert.equal(exported.sourceNodeId, `${LOCAL_SOURCE_PREFIX}9`);
  // 上游片段不带 localKey，step map 与旧版逐字节一致
  assert.ok(!("localKey" in exportFlatClips(migrateClips([flat()]))[0]));
});

test("导入音频落 A1 后导出 audioClips 同样携带 localKey 与 start", () => {
  const source = importedSourceFromAsset({
    id: 10, name: "配音.mp3", kind: "audio", storageKey: "users/7/assets/voice.mp3", durationMs: 4000,
  });
  const track = audioTracks(emptyTimeline())[0];
  const timeline = addClip(emptyTimeline(), track.id, {
    ...sourceClipFromQueue(source), id: "a1", start: 2.5,
  });
  const exported = exportAudioClips(timeline);
  assert.equal(exported.length, 1);
  assert.equal(exported[0].localKey, "users/7/assets/voice.mp3");
  assert.equal(exported[0].start, 2.5);
});

test("漂移检测跳过导入片段：不报缺失 / 过期，也不污染新增素材", () => {
  const imported = importedSourceFromAsset({ id: 5, kind: "video", storageKey: "users/7/assets/i.mp4" });
  const timeline = addClip(migrateClips([flatWithKey("v1", "old/v1.mp4")]), "V1", {
    ...sourceClipFromQueue(imported), id: "ci", start: 10,
  });
  const drift = inspectSourceDrift(timeline, [upstream("v1", "new/v1.mp4")]);
  assert.deepEqual(drift.outdated.map((item) => item.key), ["v1:0"]);
  assert.deepEqual(drift.missing, []);
  assert.deepEqual(drift.added, []);
  const synced = syncTimelineSources(timeline, [upstream("v1", "new/v1.mp4")]);
  const stillImported = mainVideoTrack(synced.timeline).clips.find((clip) => clip.id === "ci");
  assert.equal(stillImported.storageKey, "users/7/assets/i.mp4");
  assert.equal(stillImported.localKey, "users/7/assets/i.mp4");
  assert.equal(synced.addedAudio, 0);
});

test("导入音频不参与「打开即铺 A1」，刷新也不会把它灌回时间线", () => {
  const imported = importedSourceFromAsset({ id: 6, kind: "audio", storageKey: "users/7/assets/bgm.mp3" });
  const base = seedAudioSources(emptyTimeline(), [imported]);
  assert.equal(audioClipsOf(base).length, 0);
  const synced = syncTimelineSources(base, [imported, audioSource("upstream-a")]);
  assert.equal(synced.addedAudio, 1);
  assert.equal(audioClipsOf(synced.timeline)[0].sourceNodeId, "upstream-a");
});

test("probeLocalDuration 在非浏览器环境安全降级为 null", async () => {
  const { probeLocalDuration } = await import("../src/components/workflow/editing-suite/localDuration.js");
  assert.equal(await probeLocalDuration({ name: "a.mp4" }, "video"), null);
  assert.equal(await probeLocalDuration({ name: "a.png" }, "image"), null);
});

// ---- 成片烧录：样式与叠加层导出（排期 #7）----
const styledTimeline = () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4"), flatWithKey("v2", "users/7/v2.mp4")]);
  const track = mainVideoTrack(base);
  const firstId = track.clips[0].id;
  const secondId = track.clips[1].id;
  let next = updateClip(base, firstId, {
    adjust: { brightness: 18, contrast: 6, saturate: -8 },
    effects: [{ id: "vintage", label: "复古", cssFilter: "sepia(.55)", params: {} }],
    transitionOut: { id: "fade", label: "淡入淡出", duration: 0.6 },
  });
  next = updateClip(next, secondId, { adjust: { brightness: 0, contrast: 0, saturate: 0 } });
  return next;
};

test("exportClipStyles 与 exportFlatClips 同序同长，逐条带出调节与特效", () => {
  const timeline = styledTimeline();
  const styles = exportClipStyles(timeline);
  const clips = exportFlatClips(timeline);
  assert.equal(styles.length, clips.length);
  assert.equal(styles[0].brightness, 18);
  assert.equal(styles[0].contrast, 6);
  assert.equal(styles[0].saturate, -8);
  assert.equal(styles[0].effect, "vintage");
  assert.equal(styles[0].transitionId, "fade");
  assert.equal(styles[0].transitionSeconds, 0.6);
  assert.equal(styles[1].brightness, 0);
  assert.equal(styles[1].effect, null);
});

test("exportClipStyles 无任何样式时返回 null（后端不写字段，指纹不漂移）", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  assert.equal(exportClipStyles(base), null);
  assert.equal(exportClipStyles(emptyTimeline()), null);
});

test("exportClipStyles 忽略 none 特效与无转场预设", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const id = mainVideoTrack(base).clips[0].id;
  const next = updateClip(base, id, {
    effects: [{ id: "none", label: "无特效", cssFilter: "none", params: {} }],
    transitionOut: { id: "none", label: "无转场", duration: 0 },
  });
  assert.equal(exportClipStyles(next), null);
});

test("exportClipStyles 把调节值钳制到 ±100", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const id = mainVideoTrack(base).clips[0].id;
  const next = updateClip(base, id, { adjust: { brightness: 500, contrast: -900, saturate: 30 } });
  const styles = exportClipStyles(next);
  assert.equal(styles[0].brightness, 100);
  assert.equal(styles[0].contrast, -100);
  assert.equal(styles[0].saturate, 30);
});

test("exportOverlays 导出文字与图形叠加，start/end 为成片内绝对时间", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const withText = addClip(base, "T1", {
    type: "text", start: 1, duration: 2, text: "你好，世界",
    textStyle: { id: "title", fontSize: 32, color: "#ffffff", weight: 700, align: "center" },
  });
  const withGraphic = addClip(withText, "G1", {
    type: "graphic", start: 3, duration: 2, text: "矩形",
    graphic: { shape: "rect", color: "#6cb2ec", x: 30, y: 40, scale: 100, opacity: 80 },
  });
  const overlays = exportOverlays(withGraphic);
  assert.equal(overlays.length, 2);
  const text = overlays.find((item) => item.kind === "text");
  assert.equal(text.text, "你好，世界");
  assert.equal(text.fontSize, 32);
  assert.equal(text.weight, 700);
  assert.equal(text.start, 1);
  assert.equal(text.end, 3);
  const graphic = overlays.find((item) => item.kind === "graphic");
  assert.equal(graphic.shape, "rect");
  assert.equal(graphic.color, "#6cb2ec");
  assert.equal(graphic.x, 30);
  assert.equal(graphic.opacity, 80);
});

test("exportOverlays 无叠加元素时返回 null", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  assert.equal(exportOverlays(base), null);
  assert.equal(exportOverlays(emptyTimeline()), null);
});

test("exportOverlays 把时间线时间折算成片时间（空隙压缩后不偏移）", () => {
  // V1 两段：0-5 与 10-15，成片里是 0-5 与 5-10（空隙被压缩）
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const track = mainVideoTrack(base);
  const firstId = track.clips[0].id;
  const next = updateClip(base, firstId, { start: 0, duration: 5, trimStart: 0, trimEnd: 5 });
  const withSecond = addClip(next, "V1", {
    ...sourceClipFromQueue({ sourceNodeId: "v2", outputIndex: 0, mediaType: "video",
      output: { type: "video", storageKey: "users/7/v2.mp4", durationSec: 5 }, storageKey: "users/7/v2.mp4" }),
    id: "c2", start: 10, duration: 5, trimStart: 0, trimEnd: 5,
  });
  const withText = addClip(withSecond, "T1", {
    type: "text", start: 11, duration: 1, text: "第二段", textStyle: { fontSize: 16, color: "#fff", weight: 400, align: "center" },
  });
  const overlays = exportOverlays(withText);
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].start, 6, "时间线 11s 处对应成片 6s（第一段 5s + 第二段内 1s）");
  assert.equal(overlays[0].end, 7);
});

test("exportOverlays 丢弃落在未导出空隙里的叠加", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const withText = addClip(base, "T1", {
    type: "text", start: 8, duration: 1, text: "空隙内", textStyle: { fontSize: 16 },
  });
  assert.equal(exportOverlays(withText), null);
});

test("exportOverlays 忽略禁用片段与空文本", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const disabled = addClip(base, "T1", { type: "text", start: 0, duration: 1, text: "隐藏", enabled: false });
  const blank = addClip(disabled, "T1", { type: "text", start: 0, duration: 1, text: "   " });
  assert.equal(exportOverlays(blank), null);
});

// 14.55 端到端实测发现的缺陷：字幕尾段超出成片长度时，**整条字幕被静默丢弃**。
// 成片是「裁剪后 + 空隙压缩」，长度常短于时间线上叠加层的跨度（用户按时间线总长拖字幕）。
// 旧实现里 filmTimeMapper 对超界时间返回 null → exportOverlays 直接 continue → 字幕凭空消失。
// 正确语义：夹到成片结尾，保留有效部分。
test("exportOverlays 字幕超出成片长度时夹到结尾，不整条丢弃", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const track = mainVideoTrack(base);
  const videoId = track.clips[0].id;
  // 视频只留 4s
  const shortVideo = updateClip(base, videoId, { start: 0, duration: 4, trimStart: 0, trimEnd: 4 });
  // 字幕 0.175s 起、6s 长 → 尾段到 6.175s，超出 4s 成片
  const withText = addClip(shortVideo, "T1", {
    type: "text", start: 0.175, duration: 6, text: "端到端验证字幕",
    textStyle: { id: "title", fontSize: 32, color: "#ffffff", weight: 700, align: "center" },
  });
  const overlays = exportOverlays(withText);
  assert.ok(overlays, "字幕不能被整条丢弃");
  const text = overlays.find((item) => item.kind === "text");
  assert.equal(text.text, "端到端验证字幕");
  assert.equal(text.start, 0.175);
  assert.equal(text.end, 4, "尾段夹到成片结尾（4s）");
  assert.equal(text.fontSize, 32, "字号是预览 CSS px，由后端按画幅换算");
});

test("exportOverlays 完全落在成片之后的叠加仍被丢弃", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const track = mainVideoTrack(base);
  const videoId = track.clips[0].id;
  const shortVideo = updateClip(base, videoId, { start: 0, duration: 4, trimStart: 0, trimEnd: 4 });
  const withText = addClip(shortVideo, "T1", {
    type: "text", start: 10, duration: 2, text: "完全在片外", textStyle: { fontSize: 16 },
  });
  assert.equal(exportOverlays(withText), null, "片外叠加没有对应画面，应丢弃");
});

test("sourceClipFromQueue 优先读 metadata.durationMs（音频产物补写后不再按 5s 兜底）", () => {
  const clip = sourceClipFromQueue({
    sourceNodeId: "audio-1", mediaType: "audio", trimStart: 0,
    output: { storageKey: "users/7/a.mp3", metadata: { durationMs: 3440 } },
  });
  assert.equal(clip.duration, 3.44);
  assert.equal(clip.sourceDuration, 3.44);
});

test("sourceClipFromQueue 时长全缺失时仍回落 5s，且 sourceDuration 为 0（跳过裁剪校验）", () => {
  const clip = sourceClipFromQueue({
    sourceNodeId: "audio-2", mediaType: "audio", trimStart: 0,
    output: { storageKey: "users/7/b.mp3" },
  });
  assert.equal(clip.duration, 5);
  assert.equal(clip.sourceDuration, 0);
});

test("validateTrim：出点超过素材实际时长直接报错（不等导出被 ffmpeg 拦）", () => {
  const bad = validateTrim({ trimStart: 0, trimEnd: 5.95, sourceDuration: 3.44 });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不能超过素材实际时长 3\.44s/);
  const ok = validateTrim({ trimStart: 0, trimEnd: 3.4, sourceDuration: 3.44 });
  assert.equal(ok.ok, true);
  assert.equal(ok.duration, 3.4);
  // 源时长未知时保持旧行为，不拦截
  assert.equal(validateTrim({ trimStart: 0, trimEnd: 99 }).ok, true);
});

// ── V2 画中画（副视频轨）独立导出通道 ──────────────────────────────────────

test("exportPipClips：无副视频轨片段时返回 null，且画中画不污染 overlays / V1 拼接", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  assert.equal(exportPipClips(base), null);
  assert.equal(exportOverlays(base), null);
  assert.equal(exportFlatClips(base).length, 1);
});

test("exportPipClips：副视频轨片段带全量 PiP 字段，不进文字/图形叠加通道", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const withPip = seed(base, "V2", {
    id: "pip-1", type: "video", start: 1, duration: 2, trimStart: 0.5, trimEnd: 2.5,
    storageKey: "users/7/pip.mp4", sourceNodeId: "v2", outputIndex: 1, muted: true,
    pip: { x: 20, y: 80, scale: 45, opacity: 70 },
  });
  const pips = exportPipClips(withPip);
  assert.equal(pips.length, 1);
  assert.deepEqual(pips[0], {
    start: 1, end: 3, sourceNodeId: "v2", outputIndex: 1,
    trimStart: 0.5, trimEnd: 2.5, x: 20, y: 80, scale: 45, opacity: 70, muted: true, volume: 1,
  });
  assert.equal(exportOverlays(withPip), null, "画中画必须走独立 pipClips 通道，不能烧成 PNG");
  assert.equal(exportFlatClips(withPip).length, 1, "副视频轨不能混进 V1 首尾拼接");
});

test("exportPipClips：缺省 PiP 参数用右上角 30% 宽，空隙压缩后折算成片时间", () => {
  const base = migrateClips([
    flatWithKey("v1", "users/7/a.mp4"), flatWithKey("v2", "users/7/b.mp4"),
  ]);
  const secondId = mainVideoTrack(base).clips[1].id;
  // V1：0-5s + 7-10s（中间 2s 空隙），成片为 0-5s + 5-8s
  const withGap = updateClip(base, secondId, { start: 7, duration: 3, trimStart: 0, trimEnd: 3 });
  const withPip = seed(withGap, "V2", {
    id: "pip-2", type: "video", start: 7, duration: 2, trimStart: 0, trimEnd: 2,
    storageKey: "users/7/pip.mp4", sourceNodeId: "v3",
  });
  const pips = exportPipClips(withPip);
  assert.equal(pips.length, 1);
  assert.equal(pips[0].start, 5, "时间线 7s 折算成成片 5s");
  assert.equal(pips[0].end, 7);
  assert.equal(pips[0].x, 70);
  assert.equal(pips[0].y, 25);
  assert.equal(pips[0].scale, 30);
  assert.equal(pips[0].opacity, 100);
  assert.equal(pips[0].muted, false);
  assert.equal(pips[0].volume, 1);
});

test("exportPipClips：写出片段音量，轨道静音时按只出画面导出", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const withPip = seed(base, "V2", {
    id: "pip-vol", type: "video", start: 0, duration: 2, trimStart: 0, trimEnd: 2,
    storageKey: "users/7/pip.mp4", sourceNodeId: "v2", volume: 0.4, muted: false,
  });
  const pips = exportPipClips(withPip);
  assert.equal(pips[0].volume, 0.4);
  assert.equal(pips[0].muted, false);
  const silenced = updateTrack(withPip, "V2", { muted: true });
  const muted = exportPipClips(silenced);
  assert.equal(muted[0].muted, true);
  assert.equal(muted[0].volume, 0.4);
});

test("exportPipClips：禁用/无素材/落在空隙的片段丢弃，本地导入带 localKey", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  let timeline = seed(base, "V2", {
    id: "off", type: "video", start: 0, duration: 2, trimStart: 0, trimEnd: 2,
    storageKey: "users/7/off.mp4", enabled: false,
  });
  timeline = seed(timeline, "V2", {
    id: "blank", type: "video", start: 0, duration: 2, trimStart: 0, trimEnd: 2,
  });
  timeline = seed(timeline, "V2", {
    id: "local", type: "video", start: 2, duration: 2, trimStart: 0, trimEnd: 2,
    storageKey: "users/7/assets/local.mp4", localKey: "users/7/assets/local.mp4", imported: true,
    sourceNodeId: "local-1", pip: { x: 10, y: 10, scale: 50, opacity: 80 },
  });
  const pips = exportPipClips(timeline);
  assert.equal(pips.length, 1);
  assert.equal(pips[0].localKey, "users/7/assets/local.mp4");
  assert.equal(pips[0].start, 2);
  assert.equal(pips[0].scale, 50);
  assert.equal(pips[0].opacity, 80);
});

test("exportPipClips：超出成片尾部的画中画夹到成片结尾", () => {
  const base = migrateClips([flatWithKey("v1", "users/7/v1.mp4")]);
  const withPip = seed(base, "V2", {
    id: "long", type: "video", start: 3, duration: 8, trimStart: 0, trimEnd: 8,
    storageKey: "users/7/pip.mp4", sourceNodeId: "v2",
  });
  const pips = exportPipClips(withPip);
  assert.equal(pips.length, 1);
  assert.equal(pips[0].start, 3);
  assert.equal(pips[0].end, 5, "成片只有 5s，尾部夹住");
});
