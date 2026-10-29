// 高级工作台标准 JSON 工程文件协议（需求 4.4 / 5.1 / 5.2）
// 导出：xyflow 画布状态 → schemaVersion 1.0 标准结构
// 导入：完整校验 + 版本迁移 + 错误清单，失败时不返回任何画布变更（事务性）

import { nodesOnCycles } from "./autoLayout.js";

export const SCHEMA_VERSION = "1.0";

const KNOWN_KINDS = new Set([
  "ImageGenerator", "VideoGenerator", "AudioGenerator", "VideoEditing",
  "ReferenceAsset", "ReferenceAudio", "MarkdownNote", "Prompt", "DataTable",
  "CheckpointLoaderSimple", "UNETLoader", "CLIPLoader", "CLIPTextEncode",
  "VAELoader", "VAEDecode", "LoadImage", "EmptyLatentImage", "EmptyHunyuanLatentVideo",
  "EmptyLTXVLatentVideo", "KSampler", "KSamplerAdvanced", "KSamplerSelect",
  "SamplerCustom", "LTXVScheduler", "ResolutionSelector", "ImageScaleToTotalPixels",
  "GetImageSize", "CreateVideo", "SaveImage", "SaveVideo", "PreviewVideo",
  "ControlNetApplyAdvanced", "ModelSamplingSD3",
]);

// 未知节点类型的兜底：导入时不丢弃，标记兼容警告（需求 4.4.2.5）
function isKnownNode(node) {
  return KNOWN_KINDS.has(node?.data?.kind) || Boolean(node?.data?.title);
}

function portId(port) {
  return port?.name || port?.id;
}

function normalizePorts(ports, kind) {
  return (ports || []).filter(Boolean).map((port) => ({
    id: portId(port) || "port",
    kind,
    dataType: port.type || "DATA",
    label: port.label || undefined,
  }));
}

export function serializeWorkflow(nodes, edges, { viewport, title, description } = {}) {
  const assets = [];
  const assetKeys = new Set();
  const collectAsset = (node) => {
    const key = node?.data?.assetKey || node?.data?.media?.storageKey;
    if (key && !assetKeys.has(key)) {
      assetKeys.add(key);
      assets.push({
        key,
        type: node.data.assetType || node.data.media?.type || "unknown",
        title: node.data.title,
        url: node.data.assetUrl || node.data.media?.url || undefined,
      });
    }
  };
  const standardNodes = (nodes || []).filter((node) => node.type !== "groupFrame").map((node) => {
    collectAsset(node);
    const width = Number(node.style?.width) || Number(node.measured?.width) || 320;
    const height = Number(node.measured?.height) || 0;
    return {
      id: node.id,
      type: node.data?.kind || "unknown",
      position: { x: Math.round(node.position?.x || 0), y: Math.round(node.position?.y || 0) },
      size: { width: Math.round(width), ...(height ? { height: Math.round(height) } : {}) },
      collapsed: Boolean(node.data?.collapsed),
      ports: [
        ...normalizePorts(node.data?.inputs, "input"),
        ...normalizePorts(node.data?.outputs, "output"),
      ],
      data: node.data || {},
    };
  });
  const groups = (nodes || []).filter((node) => node.type === "groupFrame").map((node) => ({
    id: node.id,
    label: node.data?.label || "节点组合",
    position: { x: Math.round(node.position?.x || 0), y: Math.round(node.position?.y || 0) },
    size: { width: Math.round(Number(node.style?.width) || 0), height: Math.round(Number(node.style?.height) || 0) },
    childIds: (nodes || []).filter((child) => child.parentId === node.id).map((child) => child.id),
  }));
  const standardEdges = (edges || []).map((edge) => ({
    id: edge.id,
    sourceNodeId: edge.source,
    sourcePortId: edge.sourceHandle || "output",
    targetNodeId: edge.target,
    targetPortId: edge.targetHandle || "input",
  }));
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      name: title || "未命名工作流",
      description: description || "",
      createdAt: now,
      updatedAt: now,
      exportedFrom: "advanced-workbench",
    },
    canvas: {
      offsetX: Math.round(viewport?.x ?? 0),
      offsetY: Math.round(viewport?.y ?? 0),
      scale: Number(viewport?.zoom ?? 1),
    },
    nodes: standardNodes,
    edges: standardEdges,
    groups,
    assets,
    extensions: {},
  };
}

function migrateDocument(doc, warnings) {
  const version = String(doc.schemaVersion || "");
  if (version === SCHEMA_VERSION) return doc;
  // 低版本迁移钩子：目前只有 1.0；未来版本在此按序迁移并记录兼容警告。
  warnings.push(`schemaVersion "${version || "(缺失)"}" 与当前版本 ${SCHEMA_VERSION} 不一致，已尝试按兼容模式读取`);
  return doc;
}

// 精确环检测（自环 + 强连通分量），供导入警告与排版引擎共用
export function findGraphCycles(nodes, edges) {
  return nodesOnCycles(nodes, edges);
}

export function deserializeWorkflow(json) {
  const errors = [];
  const warnings = [];
  if (!json || typeof json !== "object") {
    return { ok: false, errors: ["文件不是有效的 JSON 对象"], warnings };
  }
  const doc = migrateDocument(json, warnings);
  if (!doc.schemaVersion) errors.push("缺少 schemaVersion 字段");
  if (!Array.isArray(doc.nodes)) errors.push("缺少 nodes 数组");
  if (!Array.isArray(doc.edges)) errors.push("缺少 edges 数组");
  if (errors.length) return { ok: false, errors, warnings };

  const seenIds = new Set();
  doc.nodes.forEach((node, index) => {
    if (!node?.id) errors.push(`nodes[${index}] 缺少 id`);
    else if (seenIds.has(node.id)) errors.push(`节点 id 重复：${node.id}`);
    else seenIds.add(node.id);
    if (!isKnownNode(node)) warnings.push(`节点 ${node?.id ?? index} 类型未知（${node?.type ?? "空"}），已按原样导入`);
    if (node?.position && (typeof node.position.x !== "number" || typeof node.position.y !== "number")) errors.push(`节点 ${node.id} 的 position 不是数值坐标`);
  });
  doc.edges.forEach((edge, index) => {
    if (!edge?.id) errors.push(`edges[${index}] 缺少 id`);
    if (!edge?.sourceNodeId || !edge?.targetNodeId) errors.push(`连线 ${edge?.id ?? index} 缺少 sourceNodeId/targetNodeId`);
    else {
      if (!seenIds.has(edge.sourceNodeId)) errors.push(`连线 ${edge.id} 的源节点不存在：${edge.sourceNodeId}`);
      if (!seenIds.has(edge.targetNodeId)) errors.push(`连线 ${edge.id} 的目标节点不存在：${edge.targetNodeId}`);
      if (edge.sourceNodeId === edge.targetNodeId) errors.push(`连线 ${edge.id} 是自环连线`);
    }
  });
  if (errors.length) return { ok: false, errors, warnings };

  const nodes = doc.nodes.map((node) => {
    const data = { ...(node.data || {}) };
    if (node.type) data.kind = data.kind || node.type;
    const inputNames = new Set((data.inputs || node.ports || []).filter((port) => port.kind !== "output").map((port) => port.name || port.id).filter(Boolean));
    const outputNames = new Set((data.outputs || node.ports || []).filter((port) => port.kind === "output").map((port) => port.name || port.id).filter(Boolean));
    const width = Number(node.size?.width) || 320;
    return {
      id: String(node.id),
      type: "comfy",
      position: { x: Number(node.position?.x || 0), y: Number(node.position?.y || 0) },
      style: { width },
      data: {
        ...data,
        title: data.title || `节点 ${node.id}`,
        inputs: data.inputs || (node.ports || []).filter((port) => port.kind === "input").map((port) => ({ name: port.id, label: port.label || port.id, type: port.dataType })),
        outputs: data.outputs || (node.ports || []).filter((port) => port.kind === "output").map((port) => ({ name: port.id, label: port.label || port.id, type: port.dataType })),
      },
      // 标注端口引用（供连线校验使用，不进入 React Flow 状态）
      __ports: { inputs: [...inputNames, "input"], outputs: [...outputNames, "output"] },
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = doc.edges.map((edge) => {
    const source = byId.get(edge.sourceNodeId);
    const target = byId.get(edge.targetNodeId);
    const sourceHandle = edge.sourcePortId || "output";
    const targetHandle = edge.targetPortId || "input";
    if (source && source.__ports && !source.__ports.outputs.includes(sourceHandle)) warnings.push(`连线 ${edge.id} 的源端口 ${sourceHandle} 在节点 ${edge.sourceNodeId} 上不存在，已回退到默认输出端口`);
    if (target && target.__ports && !target.__ports.inputs.includes(targetHandle)) warnings.push(`连线 ${edge.id} 的目标端口 ${targetHandle} 在节点 ${edge.targetNodeId} 上不存在，已回退到默认输入端口`);
    return {
      id: String(edge.id),
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      sourceHandle: source.__ports?.outputs.includes(sourceHandle) ? sourceHandle : "output",
      targetHandle: target.__ports?.inputs.includes(targetHandle) ? targetHandle : "input",
      type: "bezier",
    };
  });
  const cycleIds = findGraphCycles(nodes, edges);
  if (cycleIds.length) warnings.push(`检测到环状连线，涉及节点：${cycleIds.join("、")}；已导入但排版和执行会跳过环上节点`);

  const viewport = doc.canvas ? { x: Number(doc.canvas.offsetX) || 0, y: Number(doc.canvas.offsetY) || 0, zoom: Number(doc.canvas.scale) || 1 } : null;
  return {
    ok: true,
    warnings,
    errors,
    viewport,
    metadata: doc.metadata || {},
    graph: {
      nodes: nodes.map(({ __ports, ...node }) => node),
      edges,
    },
  };
}

export function isStandardWorkflowDocument(json) {
  return Boolean(json && typeof json === "object" && json.schemaVersion && Array.isArray(json.nodes));
}

export function isComfyWorkflowDocument(json) {
  return Boolean(json && typeof json === "object" && Array.isArray(json.nodes) && (Array.isArray(json.links) || json.nodes.some((node) => node.widgets_values || node.pos)));
}

// 导入文件文本解析（需求 4.4.2）：先做 JSON 语法校验与格式识别，
// 失败时返回逐项错误清单，调用方据此保证"校验失败不污染当前画布"。
// 返回 { ok, kind, json, errors }：kind 为 standard / comfy / unknown。
export function parseImportedFileText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, kind: "unknown", json: null, errors: ["文件内容为空"] };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, kind: "unknown", json: null, errors: [`文件不是合法的 JSON：${error.message || "语法错误"}`] };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, kind: "unknown", json: null, errors: ["工作流文件的根节点必须是对象"] };
  }
  if (isStandardWorkflowDocument(json)) {
    return { ok: true, kind: "standard", json, errors: [] };
  }
  if (isComfyWorkflowDocument(json)) {
    return { ok: true, kind: "comfy", json, errors: [] };
  }
  return {
    ok: false,
    kind: "unknown",
    json: null,
    errors: ["无法识别的文件格式：既不是高级工作台标准 JSON，也不是 ComfyUI 工作流"],
  };
}

export function exportFileName(title) {
  const safe = String(title || "workflow").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40);
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  return `workflow-${safe}-${SCHEMA_VERSION}-${stamp}.json`;
}

export function downloadWorkflowDocument(document_, fileName) {
  const blob = new Blob([JSON.stringify(document_, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
