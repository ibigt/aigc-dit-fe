import test from "node:test";
import assert from "node:assert/strict";
import { assetSelectionAtLimit, sameAsset } from "../src/lib/assetPicker.js";

test("asset identity prefers storage key then id then url", () => {
  assert.equal(sameAsset({ storageKey: "users/1/a.png" }, { storageKey: "users/1/a.png", id: 2 }), true);
  assert.equal(sameAsset({ id: 7 }, { id: "7" }), true);
  assert.equal(sameAsset({ url: "/media/a" }, { src: "/media/a" }), true);
  assert.equal(sameAsset({ id: 7 }, { id: 8 }), false);
});

test("selection limit still allows deselecting an already selected asset", () => {
  const selected = [{ id: 1 }, { id: 2 }];
  assert.equal(assetSelectionAtLimit(selected, { id: 3 }, 2), true);
  assert.equal(assetSelectionAtLimit(selected, { id: 2 }, 2), false);
  assert.equal(assetSelectionAtLimit(selected, { id: 3 }), false);
});
