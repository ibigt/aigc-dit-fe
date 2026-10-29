import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORKFLOW_TITLE,
  WORKFLOW_TITLE_MAX,
  buildTitleUpdateBody,
  isWorkflowTitleChanged,
  normalizeWorkflowTitle,
} from "../src/lib/workflowTitle.js";

test("normalize trims and collapses whitespace", () => {
  assert.equal(normalizeWorkflowTitle("  我的  短剧  "), "我的 短剧");
  assert.equal(normalizeWorkflowTitle("短剧\n第一集"), "短剧 第一集");
});

test("normalize falls back to default title for empty input", () => {
  assert.equal(normalizeWorkflowTitle(""), DEFAULT_WORKFLOW_TITLE);
  assert.equal(normalizeWorkflowTitle("   "), DEFAULT_WORKFLOW_TITLE);
  assert.equal(normalizeWorkflowTitle(null), DEFAULT_WORKFLOW_TITLE);
  assert.equal(normalizeWorkflowTitle(undefined), DEFAULT_WORKFLOW_TITLE);
});

test("normalize caps title at backend limit", () => {
  const long = "名".repeat(200);
  assert.equal(normalizeWorkflowTitle(long).length, WORKFLOW_TITLE_MAX);
});

test("title change detection ignores whitespace-only differences", () => {
  assert.equal(isWorkflowTitleChanged("我的短剧", "我的短剧"), false);
  assert.equal(isWorkflowTitleChanged("我的短剧", "  我的短剧 "), false);
  assert.equal(isWorkflowTitleChanged("我的短剧", "我的短剧 2"), true);
});

test("title-only update keeps the stored graph so canvas is not wiped", () => {
  const detail = {
    description: "旧描述",
    type: "video",
    modelId: 7,
    origin: "高级工作台",
    demoKey: "demo-a",
    sourcePath: "/demo/a.json",
    graph: { nodes: [{ id: "n1" }], edges: [] },
  };
  const body = buildTitleUpdateBody(detail, "新名字");
  assert.equal(body.title, "新名字");
  assert.equal(body.description, "旧描述");
  assert.equal(body.type, "video");
  assert.equal(body.modelId, 7);
  assert.deepEqual(body.graph, detail.graph);
});

test("title-only update falls back to empty graph when detail is missing", () => {
  const body = buildTitleUpdateBody(null, "新名字", { type: "image", origin: "高级工作台" });
  assert.equal(body.title, "新名字");
  assert.equal(body.description, "");
  assert.equal(body.type, "image");
  assert.deepEqual(body.graph, { nodes: [], edges: [] });
});
