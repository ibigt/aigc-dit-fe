import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKFLOW_VIDEO_MODES,
  normalizeWorkflowMedia,
  normalizeWorkflowVideoMode,
  workflowMediaOptions,
  workflowModeLabel,
} from "../src/lib/modelCapabilities.js";

// 视频节点档位改叫「参考生成 / 首尾帧」：只改展示文案（label），value 仍是
// 「参考视频 / 参考帧」——value 落库且后端 WorkflowGraphPlanner 白名单认这两个字。
// 火山 Seedance 的参考视频只收公网 HTTPS URL（base64 不收），S3_PUBLIC_ENDPOINT
// 未配置前由后端友好拦截报「请给对象存储配置公网域名」——前端不藏入口（图片参考可用），
// 公网入口配好后无需改动。
const seedance = {
  name: "Seedance 2.5",
  category: "video",
  adapterKey: "seedance-2.5",
  modelKey: "doubao-seedance-2-5-260628",
  capabilities: ["t2v", "r2v", "i2v"],
};
const seedance20 = { ...seedance, name: "Seedance 2.0", adapterKey: "seedance-2.0", modelKey: "doubao-seedance-2-0-260128" };
const h3 = {
  name: "MiniMax-H3",
  category: "video",
  adapterKey: "minimax-h3",
  modelKey: "MiniMax-H3",
  capabilities: ["t2v", "r2v", "i2v"],
};

test("档位 value 保持后端口径（参考视频/参考帧），展示文案改为「参考生成/首尾帧」", () => {
  assert.deepEqual(WORKFLOW_VIDEO_MODES.map((item) => item.value), ["参考视频", "参考帧"]);
  assert.equal(workflowModeLabel("参考视频"), "参考生成");
  assert.equal(workflowModeLabel("参考帧"), "首尾帧");
  assert.equal(workflowModeLabel("自定义"), "自定义"); // 未登记的值原样返回
});

test("旧档位名归一不受改名影响", () => {
  assert.equal(normalizeWorkflowVideoMode("全能参考"), "参考视频");
  assert.equal(normalizeWorkflowVideoMode("参考图"), "参考视频");
  assert.equal(normalizeWorkflowVideoMode("首尾帧"), "参考帧");
});

test("Seedance 不隐藏「参考生成」档（图片参考可用，视频参考由后端公网拦截报错）", () => {
  for (const model of [seedance, seedance20, h3]) {
    const modes = workflowMediaOptions(model, true).modes;
    assert.equal(modes.includes("参考视频"), true, model.name);
    assert.equal(modes.includes("参考帧"), true, model.name);
  }
});

test("已存「参考视频」档的 Seedance 节点经 normalize 不被重置", () => {
  const { values } = normalizeWorkflowMedia({ mode: "参考视频", duration: 5 }, seedance, true);
  assert.equal(values.mode, "参考视频");
});
