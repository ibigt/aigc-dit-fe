import assert from "node:assert/strict";
import { test } from "node:test";
import { LAYOUT_DEFAULTS, autoArrange, layeredOrder, snapToGrid } from "../src/components/workflow/autoLayout.js";

const { layerGap, nodeGap, gridSnap, margin } = LAYOUT_DEFAULTS;

function node(id, x, y, { width = 320, height = 150, parentId } = {}) {
  return { id, type: "comfy", position: { x, y }, style: { width }, measured: { height }, ...(parentId ? { parentId } : {}) };
}

test("默认参数符合需求文档 4.5", () => {
  assert.equal(layerGap, 160);
  assert.equal(nodeGap, 64);
  assert.equal(gridSnap, 8);
  assert.equal(margin, 80);
});

test("snapToGrid 吸附到 8px 网格", () => {
  assert.equal(snapToGrid(83, 8), 80);
  assert.equal(snapToGrid(84, 8), 88);
  assert.equal(snapToGrid(0, 8), 0);
});

test("线性链按层从左至右排列", () => {
  const nodes = [node("a", 900, 500), node("b", 0, 0), node("c", 400, 100)];
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ];
  const { positions } = autoArrange(nodes, edges);

  assert.ok(positions.a.x < positions.b.x, "源节点应在目标节点左侧");
  assert.ok(positions.b.x < positions.c.x);
  assert.equal(positions.b.x - positions.a.x >= layerGap, true, "层间距不小于水平层间距");
  assert.equal(positions.a.x % gridSnap, 0);
  assert.equal(positions.b.y % gridSnap, 0);
});

test("分叉图同层节点垂直排开且不重叠", () => {
  const nodes = [node("a", 0, 0), node("b1", 0, 0), node("b2", 0, 0), node("c", 0, 0)];
  const edges = [
    { source: "a", target: "b1" },
    { source: "a", target: "b2" },
    { source: "b1", target: "c" },
    { source: "b2", target: "c" },
  ];
  const { positions } = autoArrange(nodes, edges);

  assert.equal(positions.b1.x, positions.b2.x, "同层节点同列");
  const gap = Math.abs(positions.b1.y - positions.b2.y);
  assert.ok(gap >= 150 + nodeGap, `同层垂直间距(${gap})应不小于节点高度+间距(${150 + nodeGap})`);
  assert.equal(positions.a.x, margin, "首层从画布边距开始");
});

test("环检测返回环上节点", () => {
  const nodes = [node("a", 0, 0), node("b", 0, 0), node("c", 0, 0)];
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "a" },
    { source: "b", target: "c" },
  ];
  const { cycleIds } = autoArrange(nodes, edges);
  assert.deepEqual(cycleIds.sort(), ["a", "b"]);
});

test("TC-008 环路高亮：返回环上连线 id，环外连线排除", () => {
  const nodes = [node("a", 0, 0), node("b", 0, 0), node("c", 0, 0)];
  const edges = [
    { id: "e-ab", source: "a", target: "b" },
    { id: "e-ba", source: "b", target: "a" },
    { id: "e-bc", source: "b", target: "c" },
  ];
  const { cycleIds, cycleEdgeIds } = autoArrange(nodes, edges);
  assert.deepEqual(cycleIds.sort(), ["a", "b"]);
  assert.deepEqual([...cycleEdgeIds].sort(), ["e-ab", "e-ba"]);
});

test("TC-008 无环或空画布时 cycleEdgeIds 为空数组", () => {
  const nodes = [node("a", 0, 0), node("b", 0, 0)];
  const edges = [{ id: "e1", source: "a", target: "b" }];
  assert.deepEqual(autoArrange(nodes, edges).cycleEdgeIds, []);
  assert.deepEqual(autoArrange([], []).cycleEdgeIds, []);
});

test("环上节点仍获得位置（独立尾层）", () => {
  const nodes = [node("a", 0, 0), node("b", 0, 0)];
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "a" },
  ];
  const { positions } = autoArrange(nodes, edges);
  assert.ok(positions.a && positions.b, "环上节点也有坐标");
});

test("孤立节点归置到主流程右侧网格区", () => {
  const nodes = [node("a", 0, 0), node("b", 300, 0), node("orphan1", 900, 900), node("orphan2", 950, 950)];
  const edges = [{ source: "a", target: "b" }];
  const { positions } = autoArrange(nodes, edges);

  assert.ok(positions.orphan1.x > positions.b.x, "孤立节点在主流程右侧");
  assert.equal(positions.orphan1.x, positions.orphan2.x, "孤立节点同一列");
  assert.ok(positions.orphan2.y > positions.orphan1.y, "孤立节点垂直堆叠");
});

test("groupFrame 按成员包围盒重定位", () => {
  const group = { id: "g1", type: "groupFrame", position: { x: 0, y: 0 }, style: { width: 600, height: 400 }, data: { label: "组" } };
  const childA = { ...node("a", 0, 0), parentId: "g1" };
  const childB = { ...node("b", 300, 200), parentId: "g1" };
  const { positions } = autoArrange([group, childA, childB], []);

  assert.equal(positions.g1.x, positions.a.x - margin);
  assert.equal(positions.g1.y, positions.a.y - margin);
});

test("空图与纯空节点安全返回", () => {
  assert.deepEqual(autoArrange([], []).positions, {});
  const { positions } = autoArrange([node("solo", 0, 0)], []);
  assert.ok(positions.solo);
});

test("layeredOrder 最长路径分层", () => {
  const { level } = layeredOrder(
    [node("a", 0, 0), node("b", 0, 0), node("c", 0, 0)],
    [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "c" },
    ],
  );
  assert.equal(level.get("a"), 0);
  assert.equal(level.get("b"), 1);
  assert.equal(level.get("c"), 2, "取最长路径深度");
});

test("排版保持原有节点与连线不动（纯函数）", () => {
  const nodes = [node("a", 0, 0), node("b", 0, 0)];
  const edges = [{ source: "a", target: "b" }];
  const snapshot = JSON.stringify({ nodes, edges });
  autoArrange(nodes, edges);
  assert.equal(JSON.stringify({ nodes, edges }), snapshot, "autoArrange 不应修改入参");
});

test("重心法消交叉：orderLayers 已接入 autoArrange", () => {
  // 层0: a；层1: b(上)、c(下)；层2: e(上)、d(下，故意反转)
  // 边 a->b, a->c, b->d, c->e。初始层1 顺序与层2 顺序反向 → 两条边交叉。
  // 接入 orderLayers 后重心法应翻转层2，使 b->d、c->e 同侧（无交叉）。
  const nodes = [
    node("a", 0, 0),
    node("b", 0, 0),
    node("c", 0, 400),
    node("e", 0, 0),
    node("d", 0, 400),
  ];
  const edges = [
    { source: "a", target: "b" },
    { source: "a", target: "c" },
    { source: "b", target: "d" },
    { source: "c", target: "e" },
  ];
  const { positions } = autoArrange(nodes, edges);
  assert.equal(positions.b.x, positions.c.x, "层1 同列");
  assert.equal(positions.d.x, positions.e.x, "层2 同列");
  // 两条边 (b->d, c->e) 交叉当且仅当层1 与层2 的相对上下顺序相反；消交叉后二者同号（>0）。
  const cross = (positions.b.y - positions.c.y) * (positions.d.y - positions.e.y);
  assert.ok(cross > 0, `重心法应消除同层连线交叉（b.y=${positions.b.y}, c.y=${positions.c.y}, d.y=${positions.d.y}, e.y=${positions.e.y}）`);
});
