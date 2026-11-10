import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ASSET_NODES, assetNameFor, buildAssetGraph, clearSavedAsset, cloneAssetGraph,
  dedupeAssetName, validateAssetGraph, withSavedAsset,
} from "../src/components/workflow/canvasAssets.js";

function node(id, extra = {}) {
  const index = Number(id.slice(1));
  return {
    id,
    type: "comfy",
    position: { x: 10 + (Number.isFinite(index) ? index : 0) * 30, y: 40 },
    style: { width: 332 },
    data: {
      kind: "VideoGenerator",
      title: `视频节点 ${id}`,
      media: { prompt: "一只猫", model: "Seedance" },
      runtime: { status: "SUCCEEDED", outputs: [{ storageKey: "users/1/outputs/a.mp4" }] },
      savedAsset: { assetId: 9 },
      icon: () => null,
    },
    outputs: [{ storageKey: "users/1/outputs/a.mp4" }],
    selected: true,
    measured: { width: 332, height: 200 },
    ...extra,
  };
}

const edge = (id, source, target) => ({ id, source, target, type: "smoothstep", selected: true });

test("buildAssetGraph 只取选中节点，剥掉运行态 / 产物 / 选中态", () => {
  const nodes = [node("n1"), node("n2")];
  const graph = buildAssetGraph(nodes, [edge("e1", "n1", "n2")], ["n1", "n2"]);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  const clean = graph.nodes[0];
  assert.deepEqual(clean.position, { x: 40, y: 40 });
  assert.equal(clean.data.media.prompt, "一只猫");
  assert.equal(clean.data.title, "视频节点 n1");
  assert.ok(!("outputs" in clean), "节点级产物副本不进资产");
  assert.ok(!("runtime" in clean.data), "运行态不进资产");
  assert.ok(!("savedAsset" in clean.data), "已保存标记不继承");
  assert.ok(!("icon" in clean.data), "React 组件不能落盘");
  assert.ok(!("selected" in clean));
  assert.ok(!("measured" in clean));
  assert.ok(!("selected" in graph.edges[0]));
});

test("buildAssetGraph 丢弃跨集合连线、groupFrame 与集合外节点", () => {
  const nodes = [node("n1"), node("n2"), node("n3"), { ...node("g1"), type: "groupFrame" }];
  const edges = [
    edge("e1", "n1", "n2"),   // 都在选中集合 → 保留
    edge("e2", "n1", "n3"),   // 目标未选中 → 丢弃
    edge("e3", "g1", "n1"),   // 组合框 → 丢弃
    edge("e4", "n1", "ghost"),// 画布外 → 丢弃
  ];
  const graph = buildAssetGraph(nodes, edges, ["n1", "n2", "g1"]);
  assert.deepEqual(graph.nodes.map((item) => item.id), ["n1", "n2"]);
  assert.deepEqual(graph.edges.map((item) => item.id), ["e1"]);
});

test("buildAssetGraph 限制节点与连线数量", () => {
  const nodes = Array.from({ length: MAX_ASSET_NODES + 5 }, (_, i) => node(`n${i}`));
  const ids = nodes.map((item) => item.id);
  const edges = nodes.slice(1).map((item, i) => edge(`e${i}`, nodes[i].id, item.id));
  const graph = buildAssetGraph(nodes, edges, ids);
  assert.equal(graph.nodes.length, MAX_ASSET_NODES);
  assert.ok(graph.edges.every((item) => graph.nodes.some((n) => n.id === item.source)
    && graph.nodes.some((n) => n.id === item.target)), "被截断节点相关的连线也要剔除");
});

test("validateAssetGraph 拒绝空图 / 超量 / 重复 id / 缺 data / 外部连线", () => {
  assert.equal(validateAssetGraph({ nodes: [], edges: [] }).ok, false);
  assert.equal(validateAssetGraph(null).ok, false);
  assert.equal(validateAssetGraph({ nodes: Array.from({ length: MAX_ASSET_NODES + 1 }, (_, i) => node(`n${i}`)) }).ok, false);
  assert.equal(validateAssetGraph({ nodes: [node("a"), node("a")] }).ok, false);
  assert.equal(validateAssetGraph({ nodes: [{ id: "a" }] }).ok, false);
  assert.equal(validateAssetGraph({ nodes: [{ id: "a", data: {} }] }).ok, false);
  assert.equal(validateAssetGraph({ nodes: [node("a")], edges: [edge("e", "a", "b")] }).ok, false);
  const ok = validateAssetGraph(buildAssetGraph([node("a"), node("b")], [edge("e", "a", "b")], ["a", "b"]));
  assert.equal(ok.ok, true);
  assert.equal(ok.graph.nodes.length, 2);
});

test("assetNameFor 单节点用标题，多节点带数量，超长截断", () => {
  assert.equal(assetNameFor([node("n1")]), "视频节点 n1");
  assert.equal(assetNameFor([node("n1"), node("n2")]), "视频节点 n1 等 2 个节点");
  assert.equal(assetNameFor([]), "未命名节点");
  assert.equal(assetNameFor([{ data: { title: "x".repeat(200) } }]).length, 128);
});

test("dedupeAssetName 同名自动加序号且不覆盖已有资产", () => {
  assert.equal(dedupeAssetName("猫", []), "猫");
  assert.equal(dedupeAssetName("猫", [{ name: "猫" }]), "猫 (2)");
  assert.equal(dedupeAssetName("猫", [{ name: "猫" }, { name: "猫 (2)" }]), "猫 (3)");
  assert.equal(dedupeAssetName("", []), "未命名节点");
});

test("cloneAssetGraph 重映射节点/连线 id，保留相对布局", () => {
  let seq = 0;
  const source = buildAssetGraph([node("n1"), node("n2")], [edge("e1", "n1", "n2")], ["n1", "n2"]);
  const cloned = cloneAssetGraph(source, () => `new-${++seq}`);
  assert.deepEqual(cloned.nodes.map((item) => item.id), ["new-1", "new-2"]);
  assert.equal(cloned.edges[0].source, "new-1");
  assert.equal(cloned.edges[0].target, "new-2");
  assert.notEqual(cloned.edges[0].id, "e1");
  assert.equal(cloned.nodes[1].position.x - cloned.nodes[0].position.x,
    source.nodes[1].position.x - source.nodes[0].position.x);
  assert.ok(cloned.nodes.every((item) => item.selected));
  assert.ok(!("savedAsset" in cloned.nodes[0].data));
});

test("withSavedAsset / clearSavedAsset 只改指定资产的标记", () => {
  const marked = withSavedAsset(node("n1"), { id: 7, name: "猫" });
  assert.equal(marked.data.savedAsset.assetId, 7);
  assert.equal(marked.data.savedAsset.title, "猫");
  assert.equal(clearSavedAsset(marked, 8), marked, "别的资产 id 不动");
  assert.ok(!("savedAsset" in clearSavedAsset(marked, 7).data));
});
