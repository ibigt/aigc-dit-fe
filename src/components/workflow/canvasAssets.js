// 画布资产（V1C20 1.3「保存节点为画布资产」）：存的是**节点配置快照**，不是运行产物。
// 复用 cleanPersistedValue 的落盘清洗口径，再额外剥掉资产不该继承的字段：
// 节点级 outputs（导入工程的产物副本，插到别的画布会指向同一 storageKey）、
// savedAsset 标记本身、React Flow 的父级/尺寸派生字段。
import { cleanPersistedValue } from "./serializer.js";

export const MAX_ASSET_NODES = 20;
export const MAX_ASSET_EDGES = 60;
export const MAX_ASSET_NAME = 128;

const NODE_DROP_KEYS = new Set([
  "outputs", "positionAbsolute", "width", "height", "parentId", "extent",
  "selected", "dragging", "resizing", "measured",
]);
const DATA_DROP_KEYS = new Set(["runtime", "savedAsset", "icon"]);

function cleanAssetNode(node) {
  const clean = cleanPersistedValue(node);
  for (const key of NODE_DROP_KEYS) delete clean[key];
  if (clean.data && typeof clean.data === "object") {
    const data = { ...clean.data };
    for (const key of DATA_DROP_KEYS) delete data[key];
    clean.data = data;
  }
  if (!clean.position || typeof clean.position !== "object") clean.position = { x: 0, y: 0 };
  return clean;
}

function cleanAssetEdge(edge, keptIds) {
  if (!edge || !keptIds.has(edge.source) || !keptIds.has(edge.target)) return null;
  const clean = cleanPersistedValue(edge);
  for (const key of ["selected", "measured"]) delete clean[key];
  return clean;
}

/** 从画布当前状态抽出可保存的子图；只保留选中集合内部的连线。 */
export function buildAssetGraph(nodes = [], edges = [], ids = []) {
  const idSet = new Set(ids);
  const picked = (Array.isArray(nodes) ? nodes : [])
    .filter((node) => idSet.has(node?.id) && node.type !== "groupFrame" && node?.data && typeof node.data === "object")
    .slice(0, MAX_ASSET_NODES)
    .map(cleanAssetNode);
  const keptIds = new Set(picked.map((node) => node.id));
  const keptEdges = (Array.isArray(edges) ? edges : [])
    .map((edge) => cleanAssetEdge(edge, keptIds))
    .filter(Boolean)
    .slice(0, MAX_ASSET_EDGES);
  return { nodes: picked, edges: keptEdges };
}

/** 后端落库前的同一套校验（前端先挡一次，服务端仍会独立校验）。 */
export function validateAssetGraph(graph) {
  const nodes = graph?.nodes;
  if (!Array.isArray(nodes) || !nodes.length) return { ok: false, error: "请先选中要保存的节点" };
  if (nodes.length > MAX_ASSET_NODES) return { ok: false, error: `单次最多保存 ${MAX_ASSET_NODES} 个节点` };
  const ids = new Set();
  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id)) {
      return { ok: false, error: "节点数据不完整或存在重复 id" };
    }
    if (!node.data || typeof node.data !== "object") return { ok: false, error: "节点缺少配置数据" };
    if (!String(node.data.kind || node.data.title || "").trim()) return { ok: false, error: "节点缺少类型或标题" };
    ids.add(node.id);
  }
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  if (edges.length > MAX_ASSET_EDGES) return { ok: false, error: `连线数量超过 ${MAX_ASSET_EDGES} 条` };
  for (const edge of edges) {
    if (!ids.has(edge?.source) || !ids.has(edge?.target)) return { ok: false, error: "存在指向资产外部的连线" };
  }
  return { ok: true, graph: { nodes: nodes.map(cleanAssetNode), edges: edges.map((edge) => cleanAssetEdge(edge, ids)) } };
}

export function assetNameFor(nodes = [], fallback = "未命名节点") {
  const list = Array.isArray(nodes) ? nodes : [];
  if (!list.length) return fallback;
  const first = String(list[0]?.data?.title || list[0]?.data?.kind || fallback).trim() || fallback;
  const name = list.length === 1 ? first : `${first} 等 ${list.length} 个节点`;
  return name.slice(0, MAX_ASSET_NAME);
}

/** 同名资产不覆盖，自动加序号，避免列表里分不清。 */
export function dedupeAssetName(name, existing = []) {
  const base = String(name || "未命名节点").trim().slice(0, MAX_ASSET_NAME - 6) || "未命名节点";
  const used = new Set((Array.isArray(existing) ? existing : []).map((item) => String(item?.name || "")));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
}

/** 插回画布时重映射 id，避免与当前画布已有节点/连线撞 id。 */
export function cloneAssetGraph(graph, makeId) {
  const idMap = new Map();
  const nodes = (graph?.nodes || []).map((node) => {
    const id = makeId();
    idMap.set(node.id, id);
    const data = { ...(node.data || {}) };
    for (const key of DATA_DROP_KEYS) delete data[key];
    return {
      ...node,
      id,
      selected: true,
      dragging: false,
      position: { x: Number(node.position?.x) || 0, y: Number(node.position?.y) || 0 },
      data,
    };
  });
  const edges = (graph?.edges || [])
    .filter((edge) => idMap.has(edge?.source) && idMap.has(edge?.target))
    .map((edge, index) => ({
      ...edge,
      id: `asset-edge-${index}-${makeId()}`,
      source: idMap.get(edge.source),
      target: idMap.get(edge.target),
      selected: false,
    }));
  return { nodes, edges };
}

export function withSavedAsset(node, asset) {
  return { ...node, data: { ...node.data, savedAsset: {
    assetId: asset?.id, title: asset?.name || "", savedAt: new Date().toISOString(),
  } } };
}

export function clearSavedAsset(node, assetId) {
  if (node?.data?.savedAsset?.assetId !== assetId) return node;
  const data = { ...node.data };
  delete data.savedAsset;
  return { ...node, data };
}
