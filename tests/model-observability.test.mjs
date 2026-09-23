import test from "node:test";
import assert from "node:assert/strict";
import { healthLevel, observabilityCategoryLabel } from "../src/lib/modelObservability.js";

test("模型监控类型展示覆盖多模态", () => {
  assert.equal(observabilityCategoryLabel("video"), "视频生成");
  assert.equal(observabilityCategoryLabel("text"), "文本生成");
});

test("模型健康状态区分无失败、轻微失败和异常", () => {
  assert.equal(healthLevel(100, 0), "success");
  assert.equal(healthLevel(98, 1), "running");
  assert.equal(healthLevel(80, 2), "failed");
});
