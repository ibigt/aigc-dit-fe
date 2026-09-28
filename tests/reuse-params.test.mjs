import test from "node:test";
import assert from "node:assert/strict";
import { isFramesMode, reusePayloadOf } from "../src/lib/reuseParams.js";

test("frames task restores billing params, frames and filters invalid references", () => {
  const payload = reusePayloadOf({
    category: "video",
    modelId: 7,
    mode: "i2v",
    params: {
      mode: "i2v",
      ratio: "9:16",
      resolution: "1080P",
      quality: "High",
      durationSec: 8,
      copies: 2,
      frames: { firstFrameKey: "users/1/first.png", lastFrameKey: null },
      references: [{ type: "image", storageKey: "users/1/ref.png" }, { type: "audio" }],
    },
  });
  assert.equal(payload.framesMode, true);
  assert.equal(payload.modelId, 7);
  assert.equal(payload.ratio, "9:16");
  assert.equal(payload.resolution, "1080P");
  assert.equal(payload.quality, "High");
  assert.equal(payload.durationSec, 8);
  assert.equal(payload.copies, 2);
  assert.deepEqual(payload.references, [{ name: "参考 1", type: "image", storageKey: "users/1/ref.png" }]);
  assert.deepEqual(payload.frames.firstFrame, { name: "首帧", type: "image", storageKey: "users/1/first.png" });
  assert.equal(payload.frames.lastFrame, null);
});

test("reference task keeps materials, falls back to task copies and clamps to 4", () => {
  const payload = reusePayloadOf({
    category: "image",
    modelId: 3,
    copies: 9,
    params: { mode: "i2i", ratio: "1:1", references: [{ type: "image", storageKey: "a.png" }, { type: "video", storageKey: "b.mp4" }] },
  });
  assert.equal(payload.framesMode, false);
  assert.equal(payload.copies, 4);
  assert.equal(payload.references.length, 2);
  assert.equal(payload.references[1].type, "video");
  assert.equal(payload.frames.firstFrame, null);
});

test("audio task restores voice settings", () => {
  const payload = reusePayloadOf({
    category: "audio",
    modelId: 5,
    params: { mode: "t2a", voiceId: "female-yujie", speed: 1.5, audioFormat: "wav", characterCount: 120 },
  });
  assert.equal(payload.voiceId, "female-yujie");
  assert.equal(payload.speed, 1.5);
  assert.equal(payload.audioFormat, "wav");
  assert.deepEqual(payload.references, []);
});

test("missing task yields null and frames modes are recognized case-insensitively", () => {
  assert.equal(reusePayloadOf(null), null);
  assert.equal(isFramesMode("V2V"), true);
  assert.equal(isFramesMode("frames"), true);
  assert.equal(isFramesMode("r2v"), false);
  assert.equal(isFramesMode(""), false);
});
