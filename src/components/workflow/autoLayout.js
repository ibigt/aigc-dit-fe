// 智能排版引擎（需求 4.5）：DAG 分层从左至右 + 同层防重叠 + 网格吸附 + 孤立节点归置 + 环检测

export const LAYOUT_DEFAULTS = {
  layerGap: 160,      // 水平层间距（px）
  nodeGap: 64,        // 同层垂直节点间距（px）
  groupGap: 96,       // 节点组间距（px）
  gridSnap: 8,        // 网格吸附（px）
  margin: 80,         // 画布边距（px）
};

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 150;

function nodeSize(node) {
  return {
    width: Number(node.style?.width) || Number(node.measured?.width) || DEFAULT_NODE_WIDTH,
    height: Number(node.measured?.height) || Number(node.data?.size?.height) || DEFAULT_NODE_HEIGHT,
  };
}

export function snapToGrid(value, grid) {
  return Math.round(value / grid) * grid;
}

// 精确环检测：Kahn 未归零会把环下游节点也误报，这里用 Kosaraju 强连通分量（大小≥2 或自环）判定
export function nodesOnCycles(nodes, edges) {
  const ids = (nodes || []).map((node) => node.id);
  const idSet = new Set(ids);
  const adjacency = new Map(ids.map((id) => [id, []]));
  const reverse = new Map(ids.map((id) => [id, []]));
  const selfLoops = new Set();
  (edges || []).forEach((edge) => {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) return;
    adjacency.get(edge.source).push(edge.target);
    reverse.get(edge.target).push(edge.source);
    if (edge.source === edge.target) selfLoops.add(edge.source);
  });
  // 第一遍：正图迭代 DFS 收集完成顺序
  const visited = new Set();
  const finishOrder = [];
  ids.forEach((start) => {
    if (visited.has(start)) return;
    visited.add(start);
    const stack = [[start, 0]];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbors = adjacency.get(frame[0]);
      if (frame[1] < neighbors.length) {
        const next = neighbors[frame[1]];
        frame[1] += 1;
        if (!visited.has(next)) {
          visited.add(next);
          stack.push([next, 0]);
        }
      } else {
        finishOrder.push(frame[0]);
        stack.pop();
      }
    }
  });
  // 第二遍：按完成顺序逆序在反图上取分量
  const assigned = new Set();
  const onCycle = new Set(selfLoops);
  for (let cursor = finishOrder.length - 1; cursor >= 0; cursor -= 1) {
    const root = finishOrder[cursor];
    if (assigned.has(root)) continue;
    const component = [];
    const stack = [root];
    assigned.add(root);
    while (stack.length) {
      const id = stack.pop();
      component.push(id);
      reverse.get(id).forEach((next) => {
        if (!assigned.has(next)) {
          assigned.add(next);
          stack.push(next);
        }
      });
    }
    if (component.length >= 2) component.forEach((id) => onCycle.add(id));
  }
  return ids.filter((id) => onCycle.has(id));
}

// Kahn 分层：level = 最长路径深度；环上节点单独收集（精确 SCC 判定）
export function layeredOrder(nodes, edges, { layerGap, nodeGap } = LAYOUT_DEFAULTS) {
  const ids = nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  (edges || []).forEach((edge) => {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) return;
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.get(edge.source).push(edge.target);
  });
  const level = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => !incoming.get(id));
  const resolved = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    (outgoing.get(id) || []).forEach((target) => {
      level.set(target, Math.max(level.get(target), level.get(id) + 1));
      incoming.set(target, incoming.get(target) - 1);
      if (!incoming.get(target) && !resolved.has(target)) {
        resolved.add(target);
        queue.push(target);
      }
    });
  }
  const cycleIds = nodesOnCycles(nodes, edges);
  return { level, cycleIds };
}

/**
 * 同层排序（重心法 / barycenter，Sugiyama 消交叉的简化实现）：
 * 每个节点取相邻层邻居的序号平均值作为排序键，左→右、右→左双向扫描。
 * 仅按当前 y 排序会让"框选前的散乱位置"决定层内顺序，与连线拓扑无关，
 * 表现为自动规整后连线大量交叉；重心法让同层顺序对齐上下游，消除这类交叉。
 * 无邻居的节点（孤立/仅连环外）回退当前序号，保证排序稳定。
 */
function orderLayers(layers, edges) {
  const layerIndexes = [...layers.keys()].sort((a, b) => a - b);
  const layerOf = new Map();
  layers.forEach((list, li) => list.forEach((node) => layerOf.set(node.id, li)));
  const succs = new Map();
  const preds = new Map();
  (edges || []).forEach((edge) => {
    if (!layerOf.has(edge.source) || !layerOf.has(edge.target)) return;
    if (!succs.has(edge.source)) succs.set(edge.source, []);
    succs.get(edge.source).push(edge.target);
    if (!preds.has(edge.target)) preds.set(edge.target, []);
    preds.get(edge.target).push(edge.source);
  });
  const rank = new Map();
  layerIndexes.forEach((li) => layers.get(li).forEach((node, idx) => rank.set(node.id, idx)));

  const sortByNeighbors = (list, neighbors) => {
    const bary = (id) => {
      const values = (neighbors.get(id) || [])
        .map((nid) => rank.get(nid))
        .filter((value) => value !== undefined);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };
    const keyed = list.map((node, idx) => ({ node, key: bary(node.id) ?? idx, cur: idx }));
    keyed.sort((a, b) => a.key - b.key || a.cur - b.cur);
    keyed.forEach((item, idx) => {
      list[idx] = item.node;
      rank.set(item.node.id, idx);
    });
  };

  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (let i = 1; i < layerIndexes.length; i += 1) sortByNeighbors(layers.get(layerIndexes[i]), preds);
    for (let i = layerIndexes.length - 2; i >= 0; i -= 1) sortByNeighbors(layers.get(layerIndexes[i]), succs);
  }
}

/**
 * DAG 自动排版：从左至右分层布局。
 * 返回 { positions, cycleIds, cycleEdgeIds }；positions 为 id -> {x,y} 映射，调用方应用时保留可撤销性。
 * cycleEdgeIds（TC-008）：环上连线（两端节点均在环内），供画布高亮环路使用。
 */
export function autoArrange(nodes, edges, options = {}) {
  const config = { ...LAYOUT_DEFAULTS, ...options };
  const layoutNodes = (nodes || []).filter((node) => node.type !== "groupFrame");
  const groups = (nodes || []).filter((node) => node.type === "groupFrame");
  if (!layoutNodes.length) return { positions: {}, cycleIds: [], cycleEdgeIds: [] };

  const { level, cycleIds } = layeredOrder(layoutNodes, edges, config);
  const cycleSet = new Set(cycleIds);
  const cycleEdgeIds = (edges || [])
    .filter((edge) => cycleSet.has(edge.source) && cycleSet.has(edge.target))
    .map((edge) => edge.id);

  // 环上节点视为独立尾层，避免与正常分层互相挤压
  cycleIds.forEach((id) => level.set(id, Math.max(...[...level.values()], 0) + 1));

  const layers = new Map();
  layoutNodes.forEach((node) => {
    const value = level.get(node.id) || 0;
    if (!layers.has(value)) layers.set(value, []);
    layers.get(value).push(node);
  });
  // 同层排序保持既有视觉顺序（按当前 y，其次 x），减少排版跳动
  [...layers.values()].forEach((layer) => layer.sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0)));
  // 重心法（barycenter）消交叉：在初始顺序基础上，按上下游邻居序号双向扫描，
  // 让同层节点顺序对齐连线拓扑，消除自动规整后大量连线交叉（需求 4.5 收尾；原 orderLayers 仅定义未调用）。
  orderLayers(layers, edges);

  const columnX = new Map();
  const positions = new Map();
  [...layers.keys()].sort((a, b) => a - b).forEach((layerIndex) => {
    const layer = layers.get(layerIndex);
    const widest = Math.max(...layer.map((node) => nodeSize(node).width));
    const columnWidth = snapToGrid(widest, config.gridSnap);
    const previousEdge = columnX.size ? Math.max(...columnX.values()) + config.layerGap : 0;
    const x = snapToGrid(config.margin + previousEdge, config.gridSnap);
    columnX.set(layerIndex, x + columnWidth);

    const totalHeight = layer.reduce((sum, node) => sum + nodeSize(node).height, 0) + config.nodeGap * (layer.length - 1);
    let y = snapToGrid(config.margin + (Math.max(0, 1200 - totalHeight) / 2), config.gridSnap);
    layer.forEach((node) => {
      positions.set(node.id, { x, y: snapToGrid(y, config.gridSnap) });
      y += snapToGrid(nodeSize(node).height, config.gridSnap) + config.nodeGap;
    });
  });

  // 孤立节点（无任何连线）归置到画布底部网格区
  const connected = new Set();
  (edges || []).forEach((edge) => {
    connected.add(edge.source);
    connected.add(edge.target);
  });
  const orphans = layoutNodes.filter((node) => !connected.has(node.id) && positions.has(node.id));
  if (orphans.length) {
    const orphanX = snapToGrid(Math.max(...[...columnX.values()]) + config.layerGap, config.gridSnap);
    let orphanY = snapToGrid(config.margin, config.gridSnap);
    orphans
      .sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0))
      .forEach((node) => {
        positions.set(node.id, { x: orphanX, y: orphanY });
        orphanY += snapToGrid(nodeSize(node).height, config.gridSnap) + config.nodeGap;
      });
  }

  // 节点组框按成员包围盒重定位
  groups.forEach((group) => {
    const childPositions = layoutNodes
      .filter((node) => node.parentId === group.id)
      .map((node) => positions.get(node.id))
      .filter(Boolean);
    if (!childPositions.length) return;
    const minX = Math.min(...childPositions.map((pos) => pos.x));
    const minY = Math.min(...childPositions.map((pos) => pos.y));
    positions.set(group.id, { x: snapToGrid(minX - config.margin, config.gridSnap), y: snapToGrid(minY - config.margin, config.gridSnap) });
  });

  return {
    positions: Object.fromEntries(positions),
    cycleIds,
    cycleEdgeIds,
  };
}
