import test from "node:test";
import assert from "node:assert/strict";
import {
  connectedClipQueue,
  applyClipAudio,
  syncClipPlayback,
  videoOutputSelection,
  audioPreviewSources,
  clipEnabled,
  enabledClips,
} from "../src/components/workflow/nodeInteractions.js";

test("disconnected editor stays empty even with persisted clips", () => {
  const stale = [{ sourceNodeId: "old", outputIndex: 0 }];
  assert.deepEqual(connectedClipQueue([], stale), []);
  const connected = [{ sourceNodeId: "live", outputIndex: 0 }];
  assert.deepEqual(connectedClipQueue(connected, stale), connected);
});

test("final trim boundary pauses and clamps preview without advancing", () => {
  const video = { currentTime: 7.2, paused: false, pause() { this.paused = true; } };
  assert.equal(syncClipPlayback(video, { trimStart: 1, trimEnd: 7 }, false), false);
  assert.equal(video.currentTime, 7);
  assert.equal(video.paused, true);
  const nextVideo = { currentTime: 7.2, paused: false, pause() { this.paused = true; } };
  assert.equal(syncClipPlayback(nextVideo, { trimStart: 1, trimEnd: 7 }, true), true);
  assert.equal(nextVideo.currentTime, 7);
  assert.equal(nextVideo.paused, false);
});

test("active clip volume and mute apply immediately to the media element", () => {
  const video = { volume: 1, muted: false };
  applyClipAudio(video, { volume: 0.4, muted: true });
  assert.deepEqual({ volume: video.volume, muted: video.muted }, { volume: 0.4, muted: true });
  applyClipAudio(video, { volume: 2, muted: false });
  assert.deepEqual({ volume: video.volume, muted: video.muted }, { volume: 1, muted: false });
});

test("all generated video copies remain selectable by stable output key", () => {
  const outputs = [
    { storageKey: "one", url: "/one.mp4" },
    { storageKey: "two", url: "/two.mp4" },
    { storageKey: "three", url: "/three.mp4" },
  ];
  const selection = videoOutputSelection(outputs, "two");
  assert.deepEqual(selection.options.map((item) => item.key), ["one", "two", "three"]);
  assert.equal(selection.selected.url, "/two.mp4");
  assert.equal(videoOutputSelection(outputs, "removed").selected.url, "/one.mp4");
});

test("uploaded audio stays available beside generated audio", () => {
  const sources = audioPreviewSources({ storageKey: "generated", url: "/gen.mp3" }, { storageKey: "uploaded", url: "/upload.mp3" });
  assert.deepEqual(sources.map((item) => item.kind), ["generated", "uploaded"]);
  assert.equal(sources[1].output.url, "/upload.mp3");
});

test("clipEnabled 缺省视为启用，enabledClips 只保留启用片段", () => {
  assert.equal(clipEnabled({ sourceNodeId: "a" }), true);
  assert.equal(clipEnabled({ sourceNodeId: "a", enabled: true }), true);
  assert.equal(clipEnabled({ sourceNodeId: "a", enabled: false }), false);
  assert.equal(clipEnabled(null), true);

  const clips = [{ sourceNodeId: "a" }, { sourceNodeId: "b", enabled: false }, { sourceNodeId: "c", enabled: true }];
  assert.deepEqual(enabledClips(clips).map((clip) => clip.sourceNodeId), ["a", "c"]);
  assert.deepEqual(enabledClips(null), []);
});
