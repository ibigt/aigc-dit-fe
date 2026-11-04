import test from "node:test";
import assert from "node:assert/strict";
import { nodeRuntimeState } from "../src/components/workflow/nodeViewModel.js";

// 用户主动停止的步骤后端记为 CANCELLED：不能渲染成「生成失败」，
// 否则用户以为是自己操作出错而反复重试，且停不掉正在跑的任务。
test("cancelled run renders as 已取消 instead of 生成失败", () => {
  const state = nodeRuntimeState({ status: "CANCELLED", error: "已取消" });
  assert.equal(state.tone, "cancelled");
  assert.equal(state.title, "已取消");
  assert.equal(state.message, "已取消");
});

test("cancelled run without error message still reads 已取消", () => {
  const state = nodeRuntimeState({ status: "CANCELLED" });
  assert.equal(state.title, "已取消");
  assert.equal(state.message, "已取消");
});

test("failed run still renders 生成失败 and blocked run renders 已阻塞", () => {
  const failed = nodeRuntimeState({ status: "FAILED", error: "provider failed" });
  assert.equal(failed.tone, "failed");
  assert.equal(failed.title, "生成失败");
  assert.equal(failed.message, "provider failed");

  const blocked = nodeRuntimeState({ status: "BLOCKED" });
  assert.equal(blocked.title, "已阻塞");
  assert.match(blocked.message, /上游节点未成功/);
});

test("running or idle runs show no state bar", () => {
  assert.equal(nodeRuntimeState({ status: "RUNNING" }), null);
  assert.equal(nodeRuntimeState({ status: "SUCCEEDED" }), null);
  assert.equal(nodeRuntimeState({}), null);
  assert.equal(nodeRuntimeState(), null);
});
