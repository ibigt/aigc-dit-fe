import test from "node:test";
import assert from "node:assert/strict";
import { assetKindOf, validateAssetFile } from "../src/lib/assetUpload.js";

test("asset kind falls back to extension when browser mime is empty", () => {
  assert.equal(assetKindOf({ name: "voice.mp3", type: "" }), "audio");
  assert.equal(assetKindOf({ name: "clip.mp4", type: "application/octet-stream" }), "video");
});

test("asset validation accepts supported media and rejects invalid files", () => {
  assert.equal(validateAssetFile({ name: "photo.png", type: "image/png", size: 1024 }).valid, true);
  assert.equal(validateAssetFile({ name: "archive.zip", type: "application/zip", size: 1024 }).valid, false);
  assert.match(validateAssetFile({ name: "huge.jpg", type: "image/jpeg", size: 21 * 1024 * 1024 }).message, /文件过大/);
});
