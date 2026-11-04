import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCHEMA_VERSION,
  serializeWorkflow,
  deserializeWorkflow,
  findGraphCycles,
  isStandardWorkflowDocument,
  isComfyWorkflowDocument,
  parseImportedFileText,
  exportFileName,
} from "../src/components/workflow/serializer.js";

function generatorNode(id, x, y, kind = "ImageGenerator") {
  return {
    id,
    type: "comfy",
    position: { x, y },
    style: { width: 300 },
    data: {
      kind,
      title: `节点${id}`,
      inputs: [{ name: "image", label: "图片", type: "IMAGE" }],
      outputs: [{ name: "output", label: "输出", type: "IMAGE" }],
      fields: { prompt: `prompt-${id}` },
    },
  };
}

function edge(id, source, target, sourceHandle = "output", targetHandle = "input") {
  return { id, source, target, sourceHandle, targetHandle, type: "bezier" };
}

test("serializeWorkflow 输出标准协议结构", () => {
  const doc = serializeWorkflow(
    [generatorNode("a", 0, 0), generatorNode("b", 200, 40)],
    [edge("e1", "a", "b")],
    { viewport: { x: -40, y: 80, zoom: 0.75 }, title: "测试工作流" },
  );

  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.equal(doc.metadata.name, "测试工作流");
  assert.equal(doc.canvas.offsetX, -40);
  assert.equal(doc.canvas.offsetY, 80);
  assert.equal(doc.canvas.scale, 0.75);
  assert.equal(doc.nodes.length, 2);
  assert.equal(doc.nodes[0].type, "ImageGenerator");
  assert.equal(doc.nodes[0].position.x, 0);
  assert.equal(doc.nodes[0].ports.length, 2);
  assert.equal(doc.nodes[0].ports[0].kind, "input");
  assert.equal(doc.nodes[0].ports[0].dataType, "IMAGE");
  assert.equal(doc.edges.length, 1);
  assert.equal(doc.edges[0].sourceNodeId, "a");
  assert.equal(doc.edges[0].targetNodeId, "b");
  assert.equal(doc.edges[0].sourcePortId, "output");
  assert.deepEqual(doc.groups, []);
  assert.deepEqual(doc.assets, []);
});

test("serializeWorkflow 把 groupFrame 归入 groups 而不是 nodes", () => {
  const child = generatorNode("a", 0, 0);
  const group = {
    id: "g1",
    type: "groupFrame",
    position: { x: -10, y: -10 },
    style: { width: 600, height: 400 },
    data: { label: "镜头组" },
  };
  const doc = serializeWorkflow([{ ...child, parentId: "g1" }, group], [], {});

  assert.equal(doc.nodes.length, 1);
  assert.equal(doc.groups.length, 1);
  assert.equal(doc.groups[0].label, "镜头组");
  assert.deepEqual(doc.groups[0].childIds, ["a"]);
  assert.equal(doc.groups[0].size.width, 600);
});

test("deserializeWorkflow 恢复分组及其子节点相对坐标", () => {
  const child = generatorNode("a", 30, 50);
  const group = {
    id: "g1",
    type: "groupFrame",
    position: { x: -10, y: -10 },
    style: { width: 600, height: 400 },
    data: { label: "镜头组", color: "#7584ff" },
  };
  const doc = serializeWorkflow([{ ...child, parentId: "g1", extent: "parent" }, group], [], {});
  const result = deserializeWorkflow(doc);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.graph.nodes.length, 2);
  assert.equal(result.graph.nodes[0].id, "g1");
  assert.equal(result.graph.nodes[0].type, "groupFrame");
  assert.equal(result.graph.nodes[0].data.label, "镜头组");
  assert.equal(result.graph.nodes[0].data.color, "#7584ff");
  assert.deepEqual(result.graph.nodes[0].style, { width: 600, height: 400 });
  assert.equal(result.graph.nodes[1].parentId, "g1");
  assert.equal(result.graph.nodes[1].extent, "parent");
  assert.deepEqual(result.graph.nodes[1].position, { x: 30, y: 50 });
});

test("deserializeWorkflow 跳过无效分组并保留未分组位置", () => {
  const result = deserializeWorkflow({
    schemaVersion: SCHEMA_VERSION,
    nodes: [generatorNode("a", 12, 34)],
    edges: [],
    groups: [{ id: "bad", label: "无效尺寸", position: { x: 0, y: 0 }, size: { width: 0, height: 0 }, childIds: ["a"] }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.graph.nodes.length, 1);
  assert.equal(result.graph.nodes[0].parentId, undefined);
  assert.deepEqual(result.graph.nodes[0].position, { x: 12, y: 34 });
  assert.ok(result.warnings.some((message) => message.includes("无效尺寸")));
});

test("serializeWorkflow 收集参考素材资产", () => {
  const assetNode = generatorNode("ref", 0, 0, "ReferenceAsset");
  assetNode.data = { ...assetNode.data, assetKey: "users/1/ref.png", assetType: "image", assetUrl: "/files/users/1/ref.png" };
  const mediaNode = generatorNode("v", 0, 0, "VideoGenerator");
  mediaNode.data.media = { storageKey: "users/1/clip.mp4", type: "video", url: "/files/clip.mp4" };

  const doc = serializeWorkflow([assetNode, mediaNode], [], {});
  assert.equal(doc.assets.length, 2);
  assert.equal(doc.assets[0].key, "users/1/ref.png");
  assert.equal(doc.assets[1].key, "users/1/clip.mp4");
});

test("deserializeWorkflow 往返保持节点与连线数据", () => {
  const nodes = [generatorNode("a", 12, 34), generatorNode("b", 160, 96)];
  const edges = [edge("e1", "a", "b", "output", "image")];
  const doc = serializeWorkflow(nodes, edges, { title: "往返" });
  const result = deserializeWorkflow(doc);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.graph.nodes.length, 2);
  assert.equal(result.graph.nodes[0].id, "a");
  assert.equal(result.graph.nodes[0].type, "comfy");
  assert.equal(result.graph.nodes[0].data.kind, "ImageGenerator");
  assert.equal(result.graph.nodes[0].data.fields.prompt, "prompt-a");
  assert.equal(result.graph.nodes[0].position.x, 12);
  assert.equal(result.graph.edges[0].source, "a");
  assert.equal(result.graph.edges[0].sourceHandle, "output");
  assert.equal(result.graph.edges[0].targetHandle, "image");
});

test("deserializeWorkflow 恢复画布视口", () => {
  const doc = serializeWorkflow([generatorNode("a", 0, 0)], [], { viewport: { x: -120, y: 55, zoom: 1.4 } });
  const result = deserializeWorkflow(doc);
  assert.deepEqual(result.viewport, { x: -120, y: 55, zoom: 1.4 });
});

test("deserializeWorkflow 拒绝非对象 JSON", () => {
  const result = deserializeWorkflow(null);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 1);
});

test("deserializeWorkflow 收集缺失字段错误清单", () => {
  const result = deserializeWorkflow({ nodes: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("schemaVersion")));
  assert.ok(result.errors.some((message) => message.includes("edges")));
});

test("deserializeWorkflow 报告重复与缺失节点 id", () => {
  const result = deserializeWorkflow({
    schemaVersion: SCHEMA_VERSION,
    nodes: [
      { id: "a", type: "ImageGenerator", position: { x: 0, y: 0 } },
      { id: "a", type: "ImageGenerator", position: { x: 0, y: 0 } },
    ],
    edges: [
      { id: "e1", sourceNodeId: "a", targetNodeId: "ghost" },
      { id: "e2", sourceNodeId: "a", targetNodeId: "a" },
    ],
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("重复")));
  assert.ok(result.errors.some((message) => message.includes("ghost")));
  assert.ok(result.errors.some((message) => message.includes("自环")));
});

test("deserializeWorkflow 端口缺失时回退默认端口并给出警告", () => {
  const result = deserializeWorkflow({
    schemaVersion: SCHEMA_VERSION,
    nodes: [
      { id: "a", type: "ImageGenerator", position: { x: 0, y: 0 }, data: { inputs: [], outputs: [] } },
      { id: "b", type: "VideoGenerator", position: { x: 200, y: 0 }, data: { inputs: [], outputs: [] } },
    ],
    edges: [{ id: "e1", sourceNodeId: "a", sourcePortId: "不存在的端口", targetNodeId: "b", targetPortId: "另一个端口" }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.graph.edges[0].sourceHandle, "output");
  assert.equal(result.graph.edges[0].targetHandle, "input");
  assert.ok(result.warnings.some((message) => message.includes("不存在的端口")));
  assert.ok(result.warnings.some((message) => message.includes("另一个端口")));
});

test("deserializeWorkflow 未知节点类型导入并警告", () => {
  const result = deserializeWorkflow({
    schemaVersion: SCHEMA_VERSION,
    nodes: [{ id: "x", type: "FutureNode9000", position: { x: 0, y: 0 } }],
    edges: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.graph.nodes[0].data.kind, "FutureNode9000");
  assert.ok(result.warnings.some((message) => message.includes("未知")));
});

test("deserializeWorkflow 版本不一致时给出兼容警告", () => {
  const result = deserializeWorkflow({
    schemaVersion: "0.9",
    nodes: [{ id: "a", type: "ImageGenerator", position: { x: 0, y: 0 } }],
    edges: [],
  });

  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((message) => message.includes("0.9")));
});

test("deserializeWorkflow 环状连线给出警告", () => {
  const result = deserializeWorkflow({
    schemaVersion: SCHEMA_VERSION,
    nodes: [
      { id: "a", type: "ImageGenerator", position: { x: 0, y: 0 } },
      { id: "b", type: "ImageGenerator", position: { x: 100, y: 0 } },
      { id: "c", type: "ImageGenerator", position: { x: 200, y: 0 } },
    ],
    edges: [
      { id: "e1", sourceNodeId: "a", targetNodeId: "b" },
      { id: "e2", sourceNodeId: "b", targetNodeId: "c" },
      { id: "e3", sourceNodeId: "c", targetNodeId: "a" },
    ],
  });

  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((message) => message.includes("环")));
});

test("findGraphCycles 返回环上节点", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "a" },
    { source: "c", target: "d" },
  ];
  const cycle = findGraphCycles(nodes, edges).sort();
  assert.deepEqual(cycle, ["a", "b", "c"]);
});

test("findGraphCycles 无环时返回空", () => {
  const nodes = [{ id: "a" }, { id: "b" }];
  const edges = [{ source: "a", target: "b" }];
  assert.deepEqual(findGraphCycles(nodes, edges), []);
});

test("isStandardWorkflowDocument 识别标准文件", () => {
  assert.equal(isStandardWorkflowDocument({ schemaVersion: "1.0", nodes: [] }), true);
  assert.equal(isStandardWorkflowDocument({ nodes: [] }), false);
  assert.equal(isStandardWorkflowDocument(null), false);
});

test("isComfyWorkflowDocument 识别 ComfyUI 文件", () => {
  assert.equal(isComfyWorkflowDocument({ nodes: [{ id: 1 }], links: [[1, 1, 2, 3, 4, "IMAGE"]] }), true);
  assert.equal(isComfyWorkflowDocument({ nodes: [{ id: 1, widgets_values: ["x"], pos: [0, 0] }] }), true);
  assert.equal(isComfyWorkflowDocument({ schemaVersion: "1.0", nodes: [], edges: [] }), false);
});

test("exportFileName 符合规范命名", () => {
  const name = exportFileName("我的 工作流/测试:1");
  assert.match(name, /^workflow-我的-工作流-测试-1-1\.0-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
  assert.match(exportFileName(""), /^workflow-workflow-1\.0-/);
});

test("parseImportedFileText 识别标准工作台 JSON", () => {
  const doc = serializeWorkflow([generatorNode("a", 0, 0)], [], { title: "导入测试" });
  const parsed = parseImportedFileText(JSON.stringify(doc));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.kind, "standard");
  assert.equal(parsed.json.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(parsed.errors, []);
});

test("parseImportedFileText 识别 ComfyUI 工作流", () => {
  const parsed = parseImportedFileText(JSON.stringify({
    nodes: [{ id: 1, type: "SaveImage", pos: [10, 20], widgets_values: ["x"] }],
    links: [[1, 1, 2, 3, 4, "IMAGE"]],
  }));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.kind, "comfy");
  assert.deepEqual(parsed.errors, []);
});

test("parseImportedFileText 拒绝非法 JSON 并给出错误清单", () => {
  const parsed = parseImportedFileText("{ not json");

  assert.equal(parsed.ok, false);
  assert.equal(parsed.kind, "unknown");
  assert.equal(parsed.json, null);
  assert.ok(parsed.errors.length >= 1);
  assert.ok(parsed.errors[0].includes("JSON"));
});

test("parseImportedFileText 拒绝空内容与非对象根节点", () => {
  assert.equal(parseImportedFileText("").ok, false);
  assert.equal(parseImportedFileText("   ").ok, false);
  assert.equal(parseImportedFileText("null").ok, false);

  const arrayRoot = parseImportedFileText("[1,2,3]");
  assert.equal(arrayRoot.ok, false);
  assert.ok(arrayRoot.errors[0].includes("对象"));
});

test("parseImportedFileText 拒绝无法识别的格式", () => {
  const parsed = parseImportedFileText(JSON.stringify({ hello: "world" }));

  assert.equal(parsed.ok, false);
  assert.equal(parsed.kind, "unknown");
  assert.ok(parsed.errors[0].includes("无法识别"));
});

test("serializeWorkflow 剥离运行时态、函数与 blob: 临时地址", () => {
  const node = generatorNode("a", 0, 0);
  node.data.runtime = { status: "SUCCEEDED", outputs: [{ url: "https://example.com/x.png" }] };
  node.data.icon = () => null;
  node.data.scopes = [{ values: {} }];
  node.data.media = {
    prompt: "保留的参数",
    preview: "blob:preview-1",
    nested: { runtime: { status: "RUNNING" }, keep: 1 },
  };

  const doc = serializeWorkflow([node], [], {});
  const text = JSON.stringify(doc);

  assert.equal(doc.nodes[0].data.runtime, undefined);
  assert.equal(doc.nodes[0].data.icon, undefined);
  assert.equal(doc.nodes[0].data.scopes, undefined);
  assert.equal(doc.nodes[0].data.media.prompt, "保留的参数");
  assert.equal(doc.nodes[0].data.media.preview, undefined);
  assert.equal(doc.nodes[0].data.media.nested.runtime, undefined);
  assert.equal(doc.nodes[0].data.media.nested.keep, 1);
  assert.ok(!text.includes("SUCCEEDED"));
  assert.ok(!text.includes("blob:"));
});

test("带运行结果的画布导出再导入不携带运行时态", () => {
  const node = generatorNode("a", 0, 0);
  node.data.runtime = { status: "SUCCEEDED", outputs: [{ storageKey: "users/1/x.png" }] };

  const result = deserializeWorkflow(serializeWorkflow([node], [], {}));

  assert.equal(result.ok, true);
  assert.equal(result.graph.nodes[0].data.runtime, undefined);
  assert.equal(result.graph.nodes[0].data.fields.prompt, "prompt-a");
});

test("低版本文件补齐可选字段并保留未知字段原值", () => {
  const result = deserializeWorkflow({
    schemaVersion: "0.9",
    nodes: [{ id: "a", type: "ImageGenerator", position: { x: 0, y: 0 }, data: { title: "旧节点" } }],
    edges: [],
    legacyQuota: 12,
  });

  assert.equal(result.ok, true);
  assert.equal(result.graph.nodes[0].data.title, "旧节点");
  assert.equal(result.extensions.legacyFields.legacyQuota, 12);
  assert.ok(result.warnings.some((message) => message.includes("0.9")));
  assert.ok(result.warnings.some((message) => message.includes("旧版本文件缺少")));
  assert.ok(result.warnings.some((message) => message.includes("legacyQuota")));
  assert.deepEqual(result.viewport, { x: 0, y: 0, zoom: 1 });
});

test("标准版本文件导入不产生补齐噪音", () => {
  const doc = serializeWorkflow([generatorNode("a", 0, 0)], [], {});
  const result = deserializeWorkflow(doc);

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.extensions, {});
});
