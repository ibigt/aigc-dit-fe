import test from "node:test";
import assert from "node:assert/strict";
import { audioOutputsFor, buildClipQueue, mediaTypeOfNode, nextPlaybackPosition } from "../src/components/workflow/timeline.js";

test("initial queue follows incoming b,a edge traversal and one selected copy per video", () => {
  const videos = ["a", "b"].map((id) => ({ id, data: { media: { selectedOutputIndex: id === "b" ? 1 : 0 }, runtime: { outputs: [0, 1].map((index) => ({ type: "video", storageKey: `users/7/${id}-${index}.mp4`, metadata: { durationSec: 5 } })) } } }));
  const queue = buildClipQueue(videos, [{ source: "b", target: "bridge" }, { source: "a", target: "bridge" }, { source: "bridge", target: "edit" }], [], "edit");
  assert.deepEqual(queue.map((clip) => clip.storageKey), ["users/7/b-1.mp4", "users/7/a-0.mp4"]);
});

test("disabled video or bridge cuts its branch out of the visible queue", () => {
  const video = { id: "v", output: { storageKey: "users/7/v.mp4" } };
  const edges = [{ source: "v", target: "bridge" }, { source: "bridge", target: "edit" }];
  assert.deepEqual(buildClipQueue([video], edges, [], "edit", [video, { id: "bridge", data: { enabled: false } }]), []);
  assert.deepEqual(buildClipQueue([{ ...video, data: { enabled: false } }], edges, [], "edit"), []);
});

test("keeps invalid trim input visible and reports reversed or out-of-bounds ranges", () => {
  for (const [start, end] of [[4, 2], [0, 9], [-1, 2]]) {
    const [clip] = buildClipQueue([{ id: "v", output: { storageKey: "users/7/v.mp4", duration: 8 } }], [{ source: "v", target: "edit" }], [{ sourceNodeId: "v", trimStart: start, trimEnd: end }], "edit");
    assert.equal(clip.trimStart, start); assert.equal(clip.trimEnd, end);
    assert.ok(clip.validationError);
  }
});

test("keeps persisted edit order while adding newly connected videos", () => {
  const clips = buildClipQueue(
    [{ id: "a", output: { storageKey: "a.mp4" } }, { id: "b", output: { storageKey: "b.mp4" } }],
    [{ source: "a", target: "edit" }, { source: "b", target: "edit" }],
    [{ sourceNodeId: "b", outputIndex: 0, order: 0 }],
    "edit",
  );
  assert.deepEqual(clips.map((clip) => clip.sourceNodeId), ["b", "a"]);
});

test("filters outputs without media and preserves invalid trims while clamping volume", () => {
  const clips = buildClipQueue(
    [
      { id: "missing", output: {} },
      { id: "valid", output: { storageKey: "valid.mp4", duration: 8 } },
    ],
    [{ source: "missing", target: "edit" }, { source: "valid", target: "edit" }],
    [{ sourceNodeId: "valid", outputIndex: 0, trimStart: -3, trimEnd: 1, volume: 5 }],
    "edit",
  );
  assert.equal(clips.length, 1);
  assert.equal(clips[0].sourceNodeId, "valid");
  assert.equal(clips[0].trimStart, -3);
  assert.ok(clips[0].validationError);
  assert.ok(clips[0].trimEnd > clips[0].trimStart);
  assert.equal(clips[0].volume, 2);
});

test("defaults a new clip's trim end to the output duration", () => {
  const [clip] = buildClipQueue(
    [{ id: "v1", output: { storageKey: "v1.mp4", duration: 8 } }],
    [{ source: "v1", target: "edit" }],
    [],
    "edit",
  );
  assert.equal(clip.trimEnd, 8);
});

test("filters URL-only outputs so clips always have durable storage keys", () => {
  const clips = buildClipQueue(
    [
      { id: "blob", output: { url: "blob:https://app.test/temporary" } },
      { id: "remote", output: { url: "https://cdn.test/temporary.mp4" } },
      { id: "stored", output: { storageKey: "users/1/video.mp4" } },
    ],
    [
      { source: "blob", target: "edit" },
      { source: "remote", target: "edit" },
      { source: "stored", target: "edit" },
    ],
    [],
    "edit",
  );
  assert.deepEqual(clips.map((clip) => clip.sourceNodeId), ["stored"]);
  assert.ok(clips.every((clip) => clip.storageKey));
});

test("only queues video nodes connected to the specified editing node", () => {
  const clips = buildClipQueue(
    [
      { id: "connected", output: { storageKey: "connected.mp4" } },
      { id: "other", output: { storageKey: "other.mp4" } },
    ],
    [
      { source: "connected", target: "edit" },
      { source: "other", target: "preview" },
    ],
    [],
    "edit",
  );
  assert.deepEqual(clips.map((clip) => clip.sourceNodeId), ["connected"]);
});

test("queues all reachable upstream video nodes in source-to-editor order", () => {
  const clips = buildClipQueue(
    [
      { id: "videoA", output: { storageKey: "a.mp4" } },
      { id: "videoB", output: { storageKey: "b.mp4" } },
    ],
    [
      { source: "videoA", target: "videoB" },
      { source: "videoB", target: "edit" },
    ],
    [],
    "edit",
  );
  assert.deepEqual(clips.map((clip) => clip.sourceNodeId), ["videoA", "videoB"]);
});

test("supports the three-argument call when candidate edges share one target", () => {
  const clips = buildClipQueue(
    [
      { id: "a", output: { storageKey: "a.mp4" } },
      { id: "b", output: { storageKey: "b.mp4" } },
    ],
    [{ source: "a", target: "edit" }, { source: "b", target: "edit" }],
    [],
  );
  assert.deepEqual(clips.map((clip) => clip.sourceNodeId), ["a", "b"]);
});

test("returns an empty queue for the three-argument call with multiple targets", () => {
  const clips = buildClipQueue(
    [
      { id: "a", output: { storageKey: "a.mp4" } },
      { id: "b", output: { storageKey: "b.mp4" } },
    ],
    [{ source: "a", target: "edit" }, { source: "b", target: "preview" }],
    [],
  );
  assert.deepEqual(clips, []);
});

test("advances playback and returns null when no next clip exists", () => {
  const clips = [{ duration: 4, trimStart: 1 }, { duration: 6, trimStart: 2 }];
  assert.deepEqual(nextPlaybackPosition(clips, 0), { index: 1, time: 2 });
  assert.equal(nextPlaybackPosition(clips, 1), null);
});

test("片段携带来源节点标题供剪辑列表展示", () => {
  const [clip] = buildClipQueue(
    [{ id: "v1", data: { title: "雨夜追车" }, output: { storageKey: "v1.mp4" } }],
    [{ source: "v1", target: "edit" }],
    [],
    "edit",
  );
  assert.equal(clip.sourceTitle, "雨夜追车");
});

test("禁用片段不进入剪辑队列，缺省视为启用", () => {
  const videos = [
    { id: "a", output: { storageKey: "a.mp4" } },
    { id: "b", output: { storageKey: "b.mp4" } },
  ];
  const edges = [{ source: "a", target: "edit" }, { source: "b", target: "edit" }];
  const clips = buildClipQueue(videos, edges, [
    { sourceNodeId: "a", outputIndex: 0, order: 0, enabled: false },
    { sourceNodeId: "b", outputIndex: 0, order: 1 },
  ], "edit");

  assert.deepEqual(clips.map((clip) => clip.sourceNodeId), ["b"]);
  assert.equal(clips[0].enabled, true);
});

test("includeDisabled 选项返回禁用片段以便重新启用", () => {
  const videos = [{ id: "a", output: { storageKey: "a.mp4" } }];
  const edges = [{ source: "a", target: "edit" }];
  const clips = buildClipQueue(videos, edges, [
    { sourceNodeId: "a", outputIndex: 0, order: 0, enabled: false },
  ], "edit", videos, { includeDisabled: true });

  assert.equal(clips.length, 1);
  assert.equal(clips[0].enabled, false);
});

test("旧工作流片段没有 enabled 字段时保持启用语义", () => {
  const videos = [{ id: "a", output: { storageKey: "a.mp4" } }];
  const edges = [{ source: "a", target: "edit" }];
  const clips = buildClipQueue(videos, edges, [
    { sourceNodeId: "a", outputIndex: 0, order: 0 },
  ], "edit");

  assert.equal(clips.length, 1);
  assert.equal(clips[0].enabled, true);
});

test("kinds 选项把音频节点纳入素材清单，并标记 mediaType 供剪辑台分轨", () => {
  const video = { id: "v", data: { kind: "VideoGenerator", runtime: { outputs: [{ storageKey: "v.mp4" }] } } };
  const audio = { id: "a", data: { kind: "AudioGenerator", runtime: { outputs: [{ storageKey: "a.mp3" }] } } };
  const edges = [{ source: "v", target: "edit" }, { source: "a", target: "edit" }];
  const both = buildClipQueue([video, audio], edges, [], "edit", [video, audio], { kinds: ["VideoGenerator", "AudioGenerator"] });
  assert.deepEqual(both.map((clip) => clip.sourceNodeId), ["v", "a"]);
  assert.deepEqual(both.map((clip) => clip.mediaType), ["video", "audio"]);
  // 只要视频时音频被种类过滤掉（视频剪辑节点的成片队列就该如此）
  const onlyVideo = buildClipQueue([video, audio], edges, [], "edit", [video, audio], { kinds: ["VideoGenerator"] });
  assert.deepEqual(onlyVideo.map((clip) => clip.sourceNodeId), ["v"]);
  assert.equal(mediaTypeOfNode(audio), "audio");
  assert.equal(mediaTypeOfNode({ data: { kind: "VideoEditing" } }), "");
});

test("音频产物解析：上传音频与生成音频都收录，按 storageKey 去重", () => {
  const node = {
    id: "a",
    data: {
      kind: "AudioGenerator",
      media: { selectedAudioSource: "uploaded", uploadedAudio: { storageKey: "up.mp3", durationSec: 12 } },
      runtime: { outputs: [{ storageKey: "up.mp3" }, { storageKey: "gen.mp3" }, { url: "https://x/no-key.mp3" }] },
    },
  };
  const outputs = audioOutputsFor(node);
  assert.deepEqual(outputs.map((output) => output.storageKey), ["up.mp3", "gen.mp3"]);
  assert.ok(outputs.every((output) => output.type === "audio"));
  // 上传音频即使节点没跑过生成，也能作为素材进入剪辑台
  const uploadedOnly = { id: "b", data: { kind: "AudioGenerator", media: { uploadedAudio: { storageKey: "only.mp3" } } } };
  assert.deepEqual(audioOutputsFor(uploadedOnly).map((output) => output.storageKey), ["only.mp3"]);
});
