import {
  Background,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ViewportPortal,
  addEdge,
  useEdgesState,
  useNodesState,
  useViewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  Box,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  CirclePlay,
  Clipboard,
  CalendarDays,
  Clapperboard,
  Columns3,
  Copy,
  Download,
  Droplets,
  Eye,
  EyeOff,
  Film,
  FolderOpen,
  Group,
  Hand,
  Image,
  Layers3,
  LayoutGrid,
  Map as MapIcon,
  MessageSquareText,
  MousePointer2,
  Music2,
  PackagePlus,
  Pencil,
  Plus,
  Redo2,
  Rows3,
  Save,
  Scan,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareStack,
  Sticker,
  Table2,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Upload,
  Volume2,
  WandSparkles,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cancelWorkflowRun, createWorkflowRecord, getWorkflow, getWorkflowRun, listWorkflows, removeWorkflow, startWorkflowRun, updateWorkflowRecord } from "../api/workflows.js";
import { fetchAssets, uploadAsset } from "../api/assets.js";
import { deleteCanvasAsset, fetchCanvasAssets, getCanvasAsset, saveCanvasAsset } from "../api/canvasAssets.js";
import { validateAssetFile } from "../lib/assetUpload.js";
import { MEDIA_THUMB_WIDTH, mediaUrl, storageKeyOf } from "../lib/media.js";
import { MediaCover } from "../lib/MediaCover.jsx";
import { resolveAudioOptions } from "../lib/voices.js";
import SpecializedMediaNode from "./workflow/MediaGeneratorNode.jsx";
import SpecializedAudioNode from "./workflow/AudioGeneratorNode.jsx";
import SpecializedPromptNode from "./workflow/PromptNode.jsx";
import SpecializedEditingNode from "./workflow/VideoEditingNode.jsx";
import { WorkflowNodeContext } from "./workflow/WorkflowNodeContext.jsx";
import { autoArrange } from "./workflow/autoLayout.js";
import { NodeCollapseButton, NodeDeleteButton, NodeLockButton, NodeTagBadges, nodeCollapsedClass } from "./workflow/NodeCardParts.jsx";
import { ImportReport } from "./workflow/ImportReport.jsx";
import StableTextarea from "./workflow/StableTextarea.jsx";
import { applyRunToCurrentNodes, applyWorkflowSnapshotToNodes, canConnectNodes, collectCancelTargets, executeWorkflowRun, graphWithViewport, hydrateImportedOutputs, isWorkStep, nodePlaybackUrl, nodePosterUrl, nodePreviewUrl, normalizeViewport, portTypesCompatible, waitForWorkflowPoll, restoreWorkflowSnapshot, persistableWorkflowGraph as persistableGraph } from "./workflow/runtime.js";
import { getWorkflowRuntimeSnapshot } from "../api/workflows.js";
import { buildClipQueue } from "./workflow/timeline.js";
// 独立剪辑台：懒加载，只有打开时才拉 chunk（样式与逻辑全部内聚在 editing-suite/）
const EditingSuite = lazy(() => import("./workflow/editing-suite/EditingSuite.jsx"));
import { buildTitleUpdateBody, isWorkflowTitleChanged, normalizeWorkflowTitle } from "../lib/workflowTitle.js";
import { findWorkflowModel, isSeedance20Official, normalizeWorkflowVideoMode, workflowModeLabel } from "../lib/modelCapabilities.js";
import { graphVariableScopes } from "./workflow/variables.js";
import { estimatedNodeHeight, placeQuickNode } from "./workflow/layout.js";
import { deserializeWorkflow, downloadWorkflowDocument, exportFileName, isComfyWorkflowDocument, isStandardWorkflowDocument, serializeWorkflow, validateComfyWorkflow } from "./workflow/serializer.js";
import { assetNameFor, buildAssetGraph, cloneAssetGraph, dedupeAssetName, validateAssetGraph, withSavedAsset } from "./workflow/canvasAssets.js";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { DemoSelect } from "./DemoSelect.jsx";
import { WorksTypeIcon } from "./WorksTypeIcon.jsx";

const GENERATOR_KINDS = ["ImageGenerator", "VideoGenerator", "AudioGenerator"];
const REFERENCE_LIMITS = { IMAGE: 30, VIDEO: 10, AUDIO: 10, VIDEO_SECONDS: 30 };
// Seedance 2.0 官方限参考视频 ≤3 段且总 ≤15s；2.5 及其他视频模型沿用 10 段/30s（与后端守卫同口径）。
// media.model 是模型名，经模型目录解析后按适配协议分档。
function referenceLimitsOf(models, media) {
  const model = findWorkflowModel(models, media?.model) || findWorkflowModel(media?.models, media?.model);
  return isSeedance20Official(model)
    ? { ...REFERENCE_LIMITS, VIDEO: 3, VIDEO_SECONDS: 15 }
    : REFERENCE_LIMITS;
}

function referenceUsageOf(references = []) {
  const usage = {
    IMAGE: { count: 0 },
    VIDEO: { count: 0, seconds: 0 },
    AUDIO: { count: 0 },
  };
  references.forEach((reference) => {
    const bucket = usage[reference?.type];
    if (!bucket) return;
    bucket.count += 1;
    if (reference.type === "VIDEO") bucket.seconds += Number(reference.durationSec) || 0;
  });
  return usage;
}

function referenceDurationOf(node) {
  const outputs = node?.data?.runtime?.outputs || [];
  const index = node?.data?.media?.selectedOutputIndex ?? node?.data?.runtime?.selectedOutputIndex ?? 0;
  const metadata = (outputs[index] || outputs[0])?.metadata || {};
  return Number(metadata.durationSec)
    || Number(metadata.durationMs) / 1000
    || Number(node?.data?.media?.duration)
    || Number(node?.data?.media?.durationSec)
    || 0;
}

function formatUpdated(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toWorkflowCard(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description || "",
    type: item.type,
    // modelLabel 是「运行模型」（工具条选中的兜底模型），不代表图里用了什么；
    // 卡片文案用后端按输出链路回溯出的 outputModels，model 仅用于恢复工具条选中态
    model: item.modelLabel || "未选择",
    models: Array.isArray(item.outputModels) ? item.outputModels.filter(Boolean) : [],
    modelId: item.modelId,
    nodes: item.nodeCount ?? 0,
    updated: formatUpdated(item.updatedAt),
    origin: item.origin || "我的工作流",
    builtin: Boolean(item.builtin),
    topology: item.topology || undefined,
  };
}

// 文本输入判定：撤销栈只在「文本类输入框」启用失焦合并策略，
// checkbox/radio/range/color/file 等控件一次点击即一次操作，不该走会话合并。
function isTextInputTarget(target) {
  if (!target || typeof target.tagName !== "string") return false;
  if (target.tagName === "TEXTAREA") return true;
  if (target.tagName !== "INPUT") return false;
  const type = String(target.type || "text").toLowerCase();
  return ["text", "number", "search", "url", "email", "tel", "password"].includes(type);
}

// 删除节点确认文案（全角「？」；确认按钮恒为「删除」）
function sanitizeDeleteTitle(value) {
  const chars = Array.from(String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/[「」"'`]/g, "").trim());
  return chars.length > 20 ? `${chars.slice(0, 19).join("")}…` : chars.join("");
}

function nodeDeleteCopy({ count, edgeCount, lockedCount, title }) {
  const head = count === 1 ? "删除节点？" : `删除 ${count} 个节点？`;
  const tail = "删除后仍可按 Ctrl+Z 撤销，是否继续？";
  let message;
  if (count === 1) {
    message = edgeCount > 0
      ? `「${title}」及其 ${edgeCount} 条连线将一起删除，${tail}`
      : `「${title}」将被删除，${tail}`;
  } else {
    message = edgeCount > 0
      ? `选中的 ${count} 个节点及关联的 ${edgeCount} 条连线将一起删除，${tail}`
      : `选中的 ${count} 个节点将被删除，${tail}`;
  }
  if (lockedCount > 0) message += `另有 ${lockedCount} 个已锁定节点不会被删除，需先解锁。`;
  return { title: head, message };
}

// 卡片模型行：优先展示输出链路上的真实模型（后端已按上游 -> 下游限 3 个）。
// 一行放不下就折成「末端模型 等 N 个模型」，保证最终产物用的模型永远可见，
// 不被省略号吃掉尾部（否则又会变成"明明用的 A 却显示 B"的误读）。完整链走在 title 里。
const MODEL_LINE_BUDGET = 52; // 半角字符预算，约等于卡片正文 11px 字号的可用宽度

function modelTextWidth(text) {
  return [...text].reduce((total, char) => total + (/[\u0000-\u00ff]/.test(char) ? 1 : 2), 0);
}

// 展示名剥掉环境后缀（如「（测试验证）」）：一行预算有限，后缀挤掉的是信息量更大的模型名本身；
// 完整名称保留在 hover 的 title 里
function displayModelName(name) {
  return name.replace(/[（(][^）)]*[）)]\s*$/, "");
}

function cardModelTitle(record) {
  const chain = (record?.models || []).filter(Boolean);
  return chain.length ? chain.join(" → ") : (record?.model || "无生成模型");
}

function cardModelText(record) {
  const chain = (record?.models || []).filter(Boolean);
  if (!chain.length) return record?.model && record.model !== "未选择" ? record.model : "无生成模型";
  const shown = chain.map(displayModelName);
  const joined = shown.join(" → ");
  if (shown.length <= 2 && modelTextWidth(joined) <= MODEL_LINE_BUDGET) return joined;
  return `${shown[shown.length - 1]} 等 ${shown.length} 个模型`;
}

const thumbnailGraphs = [
  {
    nodes: [
      { x: 20, y: 88, w: 82, label: "加载模型", tone: "rose" },
      { x: 134, y: 36, w: 86, label: "正向提示词", tone: "yellow" },
      { x: 134, y: 142, w: 86, label: "视频潜空间", tone: "pink" },
      { x: 250, y: 88, w: 76, label: "KSampler", tone: "violet" },
      { x: 350, y: 48, w: 72, label: "预览", tone: "green" },
      { x: 350, y: 142, w: 72, label: "视频剪辑", tone: "blue" },
    ],
    edges: [[0, 1], [0, 3], [1, 3], [2, 3], [3, 4], [3, 5]],
  },
  {
    nodes: [
      { x: 18, y: 42, w: 82, label: "UNET 加载", tone: "rose" },
      { x: 18, y: 142, w: 82, label: "CLIP 加载", tone: "yellow" },
      { x: 130, y: 34, w: 86, label: "提示词编码", tone: "yellow" },
      { x: 130, y: 148, w: 86, label: "视频潜空间", tone: "pink" },
      { x: 250, y: 88, w: 72, label: "采样器", tone: "violet" },
      { x: 348, y: 52, w: 72, label: "VAE 解码", tone: "red" },
      { x: 348, y: 150, w: 72, label: "视频剪辑", tone: "blue" },
    ],
    edges: [[0, 4], [1, 2], [2, 4], [3, 4], [4, 5], [5, 6]],
  },
  {
    nodes: [
      { x: 18, y: 86, w: 84, label: "LTXV 模型", tone: "rose" },
      { x: 130, y: 32, w: 84, label: "文本条件", tone: "yellow" },
      { x: 130, y: 146, w: 84, label: "潜空间", tone: "pink" },
      { x: 246, y: 52, w: 76, label: "调度器", tone: "violet" },
      { x: 246, y: 148, w: 76, label: "采样器", tone: "violet" },
      { x: 350, y: 88, w: 72, label: "视频输出", tone: "green" },
    ],
    edges: [[0, 3], [0, 4], [1, 3], [1, 4], [2, 4], [3, 4], [4, 5]],
  },
  {
    nodes: [
      { x: 14, y: 38, w: 78, label: "SDXL Base", tone: "rose" },
      { x: 14, y: 142, w: 78, label: "SDXL Refiner", tone: "rose" },
      { x: 116, y: 28, w: 80, label: "正向文本", tone: "yellow" },
      { x: 116, y: 152, w: 80, label: "负向文本", tone: "yellow" },
      { x: 220, y: 58, w: 72, label: "基础采样", tone: "violet" },
      { x: 220, y: 154, w: 72, label: "精修采样", tone: "violet" },
      { x: 316, y: 58, w: 72, label: "VAE 解码", tone: "red" },
      { x: 348, y: 154, w: 72, label: "保存图像", tone: "blue" },
    ],
    edges: [[0, 4], [1, 5], [2, 4], [3, 4], [4, 5], [4, 6], [5, 6], [6, 7]],
  },
];

const thumbnailTones = {
  rose: "#c86f83",
  yellow: "#c5a246",
  pink: "#bb6cae",
  violet: "#806bc5",
  red: "#c36d68",
  blue: "#557fb8",
  green: "#51977a",
  amber: "#d08a3c",
  gray: "#8b939d",
};

// ---- 缩略图几何：先用「屏幕/viewBox 单位」设计，再把所有期望屏幕恒定的量除以 scale 写成局部单位 ----
// 关键：CSS 里的 .workflow-canvas-thumb__node text 不再写 font-size，
// 否则 CSS 规则会覆盖 SVG presentation attribute，<g scale(s)> 内文字实际字号恒为 10 局部单位。
const THUMB_VIEW_W = 440;
const THUMB_VIEW_H = 230;
const THUMB_MARGIN_X = 18;
const THUMB_MARGIN_Y = 14;
const THUMB_NODE_HEIGHT = 32;      // 屏幕单位
const THUMB_SINGLE_HEIGHT = 40;    // 单节点：高度提到 40，保证宽高比 ≤ 4:1
const THUMB_TEXT_SIZE = 10;        // 屏幕字号恒为 10px
const THUMB_PAD = 8;               // 文字左右内边距（屏幕单位）
const THUMB_GUTTER = 4;            // 文字预算额外留白（屏幕单位）
const THUMB_W_MIN = 76;
const THUMB_W_TARGET = 96;
const THUMB_W_MAX = 160;           // 屏幕宽度上限，不再约束后端 node.w
const THUMB_CJK_WIDTH = 10;        // 10px 字号下中文/全角字符宽
const THUMB_ASCII_RATIO = 0.56;

function thumbCharWidth(char, cjk = THUMB_CJK_WIDTH) {
  return /[\u4e00-\u9fa5\uff00-\uffef]/.test(char) ? cjk : cjk * THUMB_ASCII_RATIO;
}

function thumbTextWidth(label, cjk = THUMB_CJK_WIDTH) {
  let width = 0;
  for (const char of Array.from(String(label ?? ""))) width += thumbCharWidth(char, cjk);
  return width;
}

// maxWidth 与字符宽同处屏幕坐标系。逐字累加，仅当放不下才截断；
// 截断时至少保留 3 个完整字，禁止「少于 3 字 + …」。
function fitThumbLabel(label, maxWidth, cjkWidth = THUMB_CJK_WIDTH) {
  const chars = Array.from(String(label ?? ""));
  if (!chars.length) return "";
  const widths = chars.map((char) => thumbCharWidth(char, cjkWidth));
  let used = 0;
  let fitCount = 0;
  for (const width of widths) {
    if (used + width > maxWidth) break;
    used += width;
    fitCount += 1;
  }
  if (fitCount === chars.length) return chars.join("");
  // 短标签宁可原样输出，也绝不产生「少于 3 字 + …」或光秃秃一个省略号
  if (chars.length <= 3) return chars.join("");
  let kept = 0;
  let acc = 0;
  for (const width of widths) {
    if (acc + width + cjkWidth > maxWidth) break;
    acc += width;
    kept += 1;
  }
  kept = Math.min(Math.max(kept, 3), chars.length - 1);
  return `${chars.slice(0, kept).join("")}…`;
}

// 把锚点值按邻近度聚成列 / 行，仅用于重排，不改变节点数据
function thumbCluster(values, tolerance) {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  const groups = [];
  let current = [unique[0]];
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i] - current[0] <= tolerance) current.push(unique[i]);
    else { groups.push(current); current = [unique[i]]; }
  }
  groups.push(current);
  const lookup = new Map();
  groups.forEach((group, index) => group.forEach((value) => lookup.set(value, index)));
  return { indexOf: (value) => lookup.get(value), count: groups.length };
}

// 宽度分档（屏幕单位）：1 节点 ≤160，2 节点 ≤136，3–8 节点分档，≥9 节点收敛到 76–96
function thumbWidthCandidates(nodes) {
  const count = nodes.length;
  const cap = count === 1 ? THUMB_W_MAX : count === 2 ? 136 : count <= 8 ? 120 : THUMB_W_TARGET;
  const need = Math.max(...nodes.map((node) => 2 * THUMB_PAD + thumbTextWidth(node.label) + THUMB_GUTTER));
  const preferred = Math.min(cap, Math.max(THUMB_W_TARGET, need, THUMB_W_MIN));
  return [...new Set([preferred, 96, 88, 80, 76])]
    .filter((width) => width >= THUMB_W_MIN && width <= preferred)
    .sort((a, b) => b - a);
}

// 包围盒只用锚点求 scale（boxW 不含节点宽），再加宽节点不会被 scale 抵消。
// 列 / 行重排保证任意两节点不相交、四边留白 ≥14，且 W_screen 不随节点数漂移。
function fitThumbTopology(rawNodes) {
  const list = Array.isArray(rawNodes) ? rawNodes : [];
  if (!list.length) {
    return { scale: 1, tx: 0, ty: 0, width: THUMB_W_TARGET, height: THUMB_NODE_HEIGHT, nodes: [] };
  }
  const nodes = list.map((node, index) => ({
    x: Number(node?.x) || 0,
    y: Number(node?.y) || 0,
    label: String(node?.label || `节点 ${index + 1}`),
    tone: node?.tone,
  }));
  const count = nodes.length;
  let H = count === 1 ? THUMB_SINGLE_HEIGHT : THUMB_NODE_HEIGHT;
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const boxW = Math.max(1, maxX - minX);
  const boxHY = Math.max(1, maxY - minY);

  const columns = thumbCluster(xs, Math.max(12, boxW / 8));
  const rows = thumbCluster(ys, Math.max(12, boxHY / 8));
  const colIndex = nodes.map((node) => columns.indexOf(node.x));
  // 同一列内行号必须唯一，否则两个节点会落在同一格重叠
  const rowIndex = new Array(count).fill(0);
  for (let c = 0; c < columns.count; c += 1) {
    const inColumn = nodes
      .map((node, i) => ({ node, i }))
      .filter(({ i }) => colIndex[i] === c)
      .sort((a, b) => a.node.y - b.node.y || a.i - b.i);
    let previous = -1;
    inColumn.forEach(({ node, i }) => {
      const row = Math.max(rows.indexOf(node.y), previous + 1);
      rowIndex[i] = row;
      previous = row;
    });
  }
  const C = columns.count;
  const R = Math.max(1, Math.max(...rowIndex) + 1);
  const limitW = THUMB_VIEW_W - 2 * THUMB_MARGIN_X;   // 404
  const limitH = THUMB_VIEW_H - 2 * THUMB_MARGIN_Y;   // 202
  // 行很多时（如单列 5 个节点）略微压低节点高度，保证行间隙仍能取到 14
  while (R > 1 && H > 26 && R * H + (R - 1) * 14 > limitH) H -= 2;
  const boxH = boxHY + H;

  const candidates = thumbWidthCandidates(nodes);
  const gapsFor = (W) => ({
    colGap: C > 1 ? Math.min(24, Math.floor((limitW - C * W) / (C - 1))) : 0,
    rowGap: R > 1 ? Math.min(14, Math.floor((limitH - R * H) / (R - 1))) : 0,
  });
  // 先按硬约束找（列间隙 ≥24、行间隙 ≥14）：加宽若碰撞优先降 W 到 76，仍不足才降 s
  let chosen = null;
  for (const W of candidates) {
    const { colGap, rowGap } = gapsFor(W);
    if ((C === 1 || colGap >= 24) && (R === 1 || rowGap >= 14)) { chosen = { W, colGap, rowGap }; break; }
  }
  // 列数特别多时放宽间隙，但至少保证不相交
  if (!chosen) {
    for (const W of candidates) {
      const { colGap, rowGap } = gapsFor(W);
      if ((C === 1 || colGap >= 2) && (R === 1 || rowGap >= 2)) { chosen = { W, colGap, rowGap }; break; }
    }
  }
  if (!chosen) chosen = { W: THUMB_W_MIN, colGap: 2, rowGap: 2 };
  const { W, colGap, rowGap } = chosen;
  const contentW = C * W + (C - 1) * colGap;
  const contentH = R * H + (R - 1) * rowGap;
  // 极端节点数兜底：整体等比压缩进画布（正常数据下恒为 1）
  const fitFactor = Math.min(1, limitW / Math.max(1, contentW), limitH / Math.max(1, contentH));

  // maxScale 一律 1（删掉 1.15 放大分支），下限 0.85
  const scale = Math.max(0.85, Math.min(
    1,
    (THUMB_VIEW_W - 2 * THUMB_MARGIN_X - W) / boxW,
    (THUMB_VIEW_H - 2 * THUMB_MARGIN_Y - THUMB_NODE_HEIGHT) / boxH,
  ));
  const tx = (THUMB_VIEW_W - contentW * fitFactor) / 2;
  const ty = (THUMB_VIEW_H - contentH * fitFactor) / 2;
  const placed = nodes.map((node, i) => ({
    ...node,
    // 屏幕坐标 → 局部坐标：位置与尺寸都除以 scale，渲染时再乘回来
    x: (colIndex[i] * (W + colGap) * fitFactor) / scale,
    y: (rowIndex[i] * (H + rowGap) * fitFactor) / scale,
  }));
  return {
    scale,
    tx,
    ty,
    width: W * fitFactor,
    height: H * fitFactor,
    nodes: placed,
  };
}

function ThumbGraph({ nodes, edges }) {
  const fit = fitThumbTopology(nodes);
  const { scale } = fit;
  const L = (value) => value / scale;          // 屏幕常量 → 局部单位
  const wLocal = L(fit.width);
  const hLocal = L(fit.height);
  const fontSize = L(THUMB_TEXT_SIZE);
  const radius = L(6);
  const portR = L(2.2);
  const barH = L(3);
  const barRadius = Math.min(radius, barH);
  const textPad = L(THUMB_PAD);
  const avail = Math.max(0, fit.width - 2 * THUMB_PAD - THUMB_GUTTER);
  return (
    <svg className="workflow-canvas-thumb" viewBox="0 0 440 230" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect width="440" height="230" className="workflow-canvas-thumb__base" />
      <g transform={`translate(${fit.tx.toFixed(2)} ${fit.ty.toFixed(2)}) scale(${scale.toFixed(4)})`}>
        {(Array.isArray(edges) ? edges : []).map((pair, index) => {
          if (!Array.isArray(pair)) return null;
          const [from, to] = pair;
          const source = fit.nodes[from];
          const target = fit.nodes[to];
          if (!source || !target) return null;
          const x1 = source.x + wLocal;
          const y1 = source.y + hLocal / 2;
          const x2 = target.x;
          const y2 = target.y + hLocal / 2;
          const gapX = (x2 - x1) * scale;
          const bend = L(Math.min(26, Math.max(8, gapX / 2)));
          return <path key={`${from}-${to}-${index}`} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} className="workflow-canvas-thumb__edge" vectorEffect="non-scaling-stroke" />;
        })}
        {fit.nodes.map((node, index) => {
          const tone = thumbnailTones[node.tone] || thumbnailTones.blue;
          return (
            <g key={`${node.label}-${index}`} className="workflow-canvas-thumb__node">
              <rect x={node.x} y={node.y} width={wLocal} height={hLocal} rx={radius} className="workflow-canvas-thumb__node-box" vectorEffect="non-scaling-stroke" />
              <path d={`M ${node.x} ${node.y + barRadius} Q ${node.x} ${node.y} ${node.x + barRadius} ${node.y} H ${node.x + wLocal - barRadius} Q ${node.x + wLocal} ${node.y} ${node.x + wLocal} ${node.y + barRadius} V ${node.y + barH} H ${node.x} Z`} fill={tone} opacity="1" />
              <text x={node.x + textPad} y={node.y + hLocal / 2} fontSize={fontSize} textAnchor="start" dominantBaseline="central">{fitThumbLabel(node.label, avail)}</text>
              <circle cx={node.x} cy={node.y + hLocal / 2} r={portR} fill={tone} className="workflow-canvas-thumb__port" vectorEffect="non-scaling-stroke" />
              <circle cx={node.x + wLocal} cy={node.y + hLocal / 2} r={portR} fill={tone} className="workflow-canvas-thumb__port" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function WorkflowThumbnail({ record, variant }) {
  const topology = record?.topology;
  const topologyNodes = Array.isArray(topology?.nodes) ? topology.nodes : [];
  const topologyEdges = Array.isArray(topology?.edges) ? topology.edges : [];
  if (topologyNodes.length) return <ThumbGraph nodes={topologyNodes} edges={topologyEdges} />;
  const index = Number(variant) || 0;
  const graph = thumbnailGraphs[index % thumbnailGraphs.length];
  return <ThumbGraph nodes={graph.nodes} edges={graph.edges} />;
}

// 生成类节点的输入端口（与快速创作的能力一致）：
// 文本节点连到 prompt 端口作为提示词来源；图片/视频节点连到 reference/visual 端口作为参考素材。
// 端口名保持不变是为了兼容已保存工作流里的连线 targetHandle。
const MEDIA_NODE_INPUTS = [
  { name: "prompt", label: "提示词", type: "STRING" },
  { name: "reference", label: "参考素材", type: "MEDIA" },
];
// 音频节点端口（需求 1.6）：只接受文本输入，不接受图片或视频输入（AC-011）。
// 原先的 visual(MEDIA) 画面参考口已移除——图片/视频连接音频节点会被连线预检直接拒绝。
const AUDIO_NODE_INPUTS = [
  { name: "prompt", label: "提示词", type: "STRING" },
];
const EDITING_NODE_INPUTS = [
  { name: "video", label: "视频素材", type: "VIDEO" },
  { name: "audio", label: "音频素材", type: "AUDIO" },
];

const canvasQuickItems = [
  { id: "text", name: "文本", kind: "MarkdownNote", icon: Type, tone: "yellow", fields: [{ label: "内容", value: "", placeholder: "输入文本内容…", multiline: true }], outputs: [{ name: "TEXT", label: "文本", type: "STRING" }] },
  // { id: "table", name: "表格", kind: "DataTable", icon: Table2, tone: "blue", fields: [{ label: "用途", value: "分镜表" }, { label: "列", value: "镜号、画面、台词、时长" }], outputs: [{ name: "TABLE", label: "表格", type: "DATA" }] },
  { id: "image", name: "图像", kind: "ImageGenerator", icon: Image, tone: "amber", inputs: MEDIA_NODE_INPUTS, outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }] },
  { id: "video", name: "视频", kind: "VideoGenerator", icon: Film, tone: "green", inputs: MEDIA_NODE_INPUTS, outputs: [{ name: "VIDEO", label: "视频", type: "VIDEO" }] },
  { id: "audio", name: "音频", kind: "AudioGenerator", icon: Volume2, tone: "violet", inputs: AUDIO_NODE_INPUTS, outputs: [{ name: "AUDIO", label: "音频", type: "AUDIO" }] },
  { id: "editing", name: "视频剪辑", kind: "VideoEditing", icon: Clapperboard, tone: "blue", inputs: EDITING_NODE_INPUTS },
];

const toneByType = {
  CLIPLoader: "yellow",
  CLIPTextEncode: "yellow",
  CheckpointLoaderSimple: "rose",
  UNETLoader: "rose",
  ModelSamplingSD3: "rose",
  VAELoader: "red",
  VAEDecode: "red",
  EmptyLatentImage: "pink",
  EmptyHunyuanLatentVideo: "pink",
  EmptyLTXVLatentVideo: "pink",
  KSampler: "violet",
  KSamplerAdvanced: "violet",
  KSamplerSelect: "violet",
  SamplerCustom: "violet",
  LTXVScheduler: "violet",
  SaveImage: "blue",
  ImageGenerator: "amber",
  AudioGenerator: "violet",
  CreateVideo: "green",
  VideoGenerator: "green",
  SaveVideo: "green",
  Note: "gray",
  MarkdownNote: "gray",
  LoadImage: "amber",
  ResolutionSelector: "pink",
  ImageScaleToTotalPixels: "blue",
  GetImageSize: "blue",
  "4c314f31-ecda-4b08-ae98-faaba1bf613f": "violet",
};

const MINIMAX_H3_NODE = "4c314f31-ecda-4b08-ae98-faaba1bf613f";

const nodeTitleMap = {
  CheckpointLoaderSimple: "加载模型",
  UNETLoader: "加载扩散模型",
  CLIPLoader: "加载文本编码器",
  CLIPTextEncode: "提示词编码",
  VAELoader: "加载 VAE",
  VAEDecode: "VAE 解码",
  LoadImage: "加载图像",
  EmptyLatentImage: "空白图像潜空间",
  EmptyHunyuanLatentVideo: "空白视频潜空间",
  EmptyLTXVLatentVideo: "空白 LTX 视频潜空间",
  KSampler: "K 采样器",
  KSamplerAdvanced: "高级 K 采样器",
  KSamplerSelect: "选择采样器",
  SamplerCustom: "自定义采样器",
  LTXVScheduler: "LTXV 调度器",
  ResolutionSelector: "分辨率选择",
  ImageScaleToTotalPixels: "图像按总像素缩放",
  GetImageSize: "获取图像尺寸",
  CreateVideo: "创建视频",
  ImageGenerator: "图像生成",
  AudioGenerator: "音频生成",
  VideoGenerator: "视频生成",
  SaveImage: "保存图像",
  SaveVideo: "保存视频",
  PreviewVideo: "预览视频",
  MarkdownNote: "工作流说明",
  [MINIMAX_H3_NODE]: "Minimax-H3 图生视频",
};

const portLabelMap = {
  first_frame: "首帧图像", last_frame: "尾帧图像", image: "图像", images: "图像", IMAGE: "图像",
  MASK: "遮罩", mask: "遮罩", width: "宽度", height: "高度", batch_size: "批次",
  model: "模型", MODEL: "模型", clip: "文本编码器", CLIP: "文本编码器",
  positive: "正向条件", negative: "负向条件", conditioning: "条件", CONDITIONING: "条件",
  latent_image: "潜空间", samples: "采样结果", LATENT: "潜空间", vae: "VAE", VAE: "VAE",
  video: "视频", VIDEO: "视频", value_1: "时长", vae_name_1: "音频 VAE",
  value: "Turbo 模式", strength_model_1: "Turbo 模型强度", value_2: "Turbo 步数",
  duration: "时长", audio_vae: "音频 VAE", turbo_mode: "Turbo 模式",
  turbo_model_strength: "Turbo 模型强度", turbo_steps: "Turbo 步数",
};

function iconForType(type) {
  if (type === "MarkdownNote" || type === "Prompt" || type === "Note") return Type;
  if (type === "DataTable") return Table2;
  if (type === "VideoEditing") return Clapperboard;
  if (/Audio/i.test(type)) return Volume2;
  if (/Video/i.test(type)) return Film;
  if (/Image|VAE/i.test(type)) return Image;
  if (/Text|CLIP/i.test(type)) return MessageSquareText;
  if (/Sampler|Scheduler/i.test(type)) return WandSparkles;
  if (/Save/i.test(type)) return Save;
  if (/Loader|Model|UNET/i.test(type)) return Box;
  return Sparkles;
}

function resolveNodeIcon(icon, kind) {
  if (typeof icon === "function") return icon;
  if (
    icon &&
    typeof icon === "object" &&
    typeof icon.$$typeof === "symbol" &&
    (typeof icon.render === "function" || typeof icon.type === "function")
  ) {
    return icon;
  }
  return iconForType(kind);
}

function widgetLabels(type) {
  const labels = {
    CLIPTextEncode: ["提示词"],
    KSampler: ["随机种子", "生成后操作", "采样步数", "引导系数", "采样算法", "调度器", "降噪强度"],
    KSamplerAdvanced: ["添加噪声", "噪声种子", "生成后操作", "采样步数", "引导系数", "采样算法", "调度器"],
    EmptyLatentImage: ["宽度", "高度", "批次"],
    EmptyHunyuanLatentVideo: ["宽度", "高度", "帧数", "批次"],
    EmptyLTXVLatentVideo: ["宽度", "高度", "帧数", "批次"],
    CheckpointLoaderSimple: ["模型文件"],
    UNETLoader: ["扩散模型", "权重精度"],
    CLIPLoader: ["编码器文件", "编码器类型", "运行设备"],
    VAELoader: ["VAE 文件"],
    LoadImage: ["图像", "输入类型"],
    ResolutionSelector: ["画面比例", "百万像素", "尺寸倍数"],
    ImageScaleToTotalPixels: ["缩放算法", "总百万像素", "尺寸倍数"],
    SaveImage: ["文件名前缀"],
    SaveVideo: ["文件名前缀", "格式", "编码", "质量"],
    CreateVideo: ["帧率"],
    KSamplerSelect: ["采样算法"],
    MarkdownNote: ["说明"],
    [MINIMAX_H3_NODE]: ["提示词", "宽度", "高度", "时长（秒）", "随机种子", "扩散模型", "文本编码器", "视频 VAE", "音频 VAE", "启用 Turbo", "LoRA 模型", "LoRA 强度", "采样步数"],
  };
  return labels[type] || [];
}

function translatedNodeTitle(raw) {
  if (raw.type === "MarkdownNote") {
    if (/Model Links/i.test(raw.title || "")) return "模型与素材说明";
    if (/Size Settings/i.test(raw.title || "")) return "尺寸设置参考";
    if (/MiniMax H3/i.test(raw.title || "")) return "Minimax-H3 使用说明";
  }
  return nodeTitleMap[raw.type] || raw.title || `节点 ${raw.id}`;
}

function normalizePort(port, index) {
  const name = port?.name || `端口-${index}`;
  return { name, label: portLabelMap[name] || portLabelMap[port?.label] || port?.label || name, type: port?.type || "DATA" };
}

function makeField(type, value, index) {
  const label = widgetLabels(type)[index] || `参数 ${index + 1}`;
  const stringValue = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  const field = {
    label,
    value: stringValue,
    multiline: type === "MarkdownNote" || (type === MINIMAX_H3_NODE && index === 0) || stringValue.length > 120,
    inputType: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text",
  };
  if (type === "ResolutionSelector" && index === 0) field.options = ["1:1 (Square)", "16:9 (Landscape)", "9:16 (Portrait)", "4:3 (Landscape)", "3:4 (Portrait)"];
  return field;
}

function normalizeNode(raw, bounds) {
  const values = Array.isArray(raw.widgets_values) ? raw.widgets_values : [];
  const fields = values.map((value, index) => makeField(raw.type, value, index));
  const scale = bounds?.scale || 1;
  const width = raw.type === MINIMAX_H3_NODE ? 360 : raw.type === "MarkdownNote" ? 320 : raw.type === "LoadImage" ? 286 : 270;
  return {
    id: String(raw.id),
    type: "comfy",
    position: {
      x: (Number(raw.pos?.[0] || 0) - (bounds?.minX || 0)) * scale,
      y: (Number(raw.pos?.[1] || 0) - (bounds?.minY || 0)) * scale,
    },
    style: { width },
    data: {
      title: translatedNodeTitle(raw),
      kind: raw.type,
      tone: toneByType[raw.type] || "blue",
      icon: iconForType(raw.type),
      fields,
      inputs: (raw.inputs || []).map(normalizePort),
      outputs: (raw.outputs || []).map(normalizePort),
      enabled: raw.mode !== 4,
      source: raw.properties?.cnr_id || "comfy-core",
      preview: raw.type === "LoadImage" ? "/comfyui-workflows/minimax-h3/transparent_rgb_gaming_mouse.png" : undefined,
    },
  };
}

function layoutWorkflow(nodes, edges) {
  if (!nodes.length) return nodes;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });
  const depth = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => !incoming.get(node.id)).map((node) => node.id);
  const pending = new Map(incoming);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const source = queue[cursor];
    (outgoing.get(source) || []).forEach((target) => {
      depth.set(target, Math.max(depth.get(target) || 0, (depth.get(source) || 0) + 1));
      pending.set(target, (pending.get(target) || 0) - 1);
      if (pending.get(target) === 0) queue.push(target);
    });
  }
  const columns = new Map();
  nodes.forEach((node) => {
    const column = depth.get(node.id) || 0;
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push(node);
  });
  const positions = new Map();
  [...columns.entries()].sort(([a], [b]) => a - b).forEach(([column, items]) => {
    let y = 0;
    items.sort((a, b) => a.position.y - b.position.y).forEach((node) => {
      positions.set(node.id, { x: column * 430, y });
      y += estimatedNodeHeight(node) + 84;
    });
  });
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) || node.position }));
}

function normalizeWorkflow(json) {
  const rawNodes = json.nodes || [];
  const positions = rawNodes.map((node) => node.pos || [0, 0]);
  const bounds = {
    minX: positions.length ? Math.min(...positions.map((position) => Number(position[0] || 0))) : 0,
    minY: positions.length ? Math.min(...positions.map((position) => Number(position[1] || 0))) : 0,
    scale: rawNodes.length <= 12 ? 0.64 : 0.82,
  };
  const normalizedNodes = rawNodes.map((node) => normalizeNode(node, bounds));
  const edges = (json.links || []).map((link) => ({
    id: `link-${link[0]}`,
    source: String(link[1]),
    target: String(link[3]),
    sourceHandle: "output",
    targetHandle: "input",
    animated: false,
    data: { valueType: link[5] || "DATA" },
    style: { stroke: edgeColor(link[5]), strokeWidth: 2.2 },
  }));
  return { nodes: layoutWorkflow(normalizedNodes, edges), edges };
}

// 导入分派：标准工作台 JSON 走协议校验，ComfyUI JSON 走既有归一化
// 返回 { ok, kind, graph, viewport, stickers, errors, warnings }；失败时不返回任何画布数据
export function parseWorkflowDocument(json) {
  if (isStandardWorkflowDocument(json)) {
    const result = deserializeWorkflow(json);
    if (!result.ok) return { ok: false, kind: "standard", errors: result.errors, warnings: result.warnings };
    return { ok: true, kind: "standard", graph: result.graph, viewport: result.viewport, stickers: result.stickers || [], errors: [], warnings: result.warnings };
  }
  if (isComfyWorkflowDocument(json)) {
    const checked = validateComfyWorkflow(json);
    if (checked.errors.length) return { ok: false, kind: "comfy", errors: checked.errors, warnings: checked.warnings };
    return { ok: true, kind: "comfy", graph: normalizeWorkflow(checked.json), viewport: null, stickers: [], errors: [], warnings: checked.warnings };
  }
  return {
    ok: false,
    kind: "unknown",
    errors: ["无法识别的文件格式：既不是高级工作台标准 JSON，也不是 ComfyUI 工作流"],
    warnings: [],
  };
}

function edgeColor(type = "") {
  if (/IMAGE|PIXEL/i.test(type)) return "#63b3ed";
  if (/MODEL/i.test(type)) return "#b794f4";
  if (/CLIP|CONDITIONING/i.test(type)) return "#e5b949";
  if (/LATENT/i.test(type)) return "#d880d8";
  if (/VAE/i.test(type)) return "#ef7373";
  return "#7584ff";
}

function nodeOutputType(node) {
  return node?.data?.assetType
    || node?.data?.outputs?.find((port) => ["IMAGE", "VIDEO", "AUDIO"].includes(port.type))?.type
    || (node?.data?.kind === "VideoGenerator" ? "VIDEO" : node?.data?.kind === "ImageGenerator" ? "IMAGE" : "DATA");
}

function isVisualReferenceNode(node) {
  // 音频生成节点输出也可作视频生成的参考素材（节奏/氛围参考，仅支持音频参考的模型生效）
  return ["IMAGE", "VIDEO", "AUDIO"].includes(nodeOutputType(node));
}

// 帧槽位（首帧/尾帧）取画布节点的图片产物 storageKey：优先素材节点自身的 storageKey，
// 其次取运行结果里选中的那张输出。拿不到（还没出图）返回空串。
function canvasFrameStorageKey(node) {
  if (node?.data?.assetType === "IMAGE" && node?.data?.storageKey) return node.data.storageKey;
  if (node?.data?.assetKey) return node.data.assetKey;
  const outputs = node?.data?.runtime?.outputs || [];
  const index = node?.data?.media?.selectedOutputIndex ?? node?.data?.runtime?.selectedOutputIndex ?? 0;
  const output = outputs[index] || outputs[0];
  return output?.storageKey || "";
}

// 文本节点（MarkdownNote/Prompt/表格）：连到生成节点时作为提示词补充，后端 planner 会拼接
function isTextPromptNode(node) {
  return ["MarkdownNote", "Prompt", "DataTable"].includes(node?.data?.kind)
    || node?.data?.outputs?.some((port) => ["STRING", "DATA"].includes(port.type));
}

function nodeTextValue(node) {
  const field = node?.data?.fields?.find((item) => item?.value);
  return String(field?.value || node?.data?.prompt || "").trim();
}

const fallbackImageModels = ["GPT Image 2", "NanoBanana 2", "Seedream 5.0 Pro", "Midjourney 8.1"];
const fallbackVideoModels = ["Minimax-H3", "Wan2.2", "LTX2.3", "可灵 O1"];
const fallbackAudioModels = ["Speech-2.8-HD", "Speech-2.6-Turbo", "Music-3.0"];

function mediaModelNames(models, type) {
  const choices = models.filter((model) => model.enabled !== false && model.category === type);
  return choices.length ? choices : (type === "image" ? fallbackImageModels : fallbackVideoModels).map((name) => ({ name }));
}

function audioModelNames(models) {
  const choices = models.filter((model) => model.enabled !== false && model.category === "audio");
  return choices.length ? choices : fallbackAudioModels.map((name) => ({ name }));
}

function audioMedia(models) {
  const modelNames = audioModelNames(models);
  // 语音参数与快速创作同源：默认音色/格式取自模型目录 audioOptions
  const speechOptions = resolveAudioOptions({ models, modelName: modelNames[0]?.name });
  return {
    type: "audio",
    prompt: "",
    models: modelNames,
    model: modelNames[0]?.name,
    speechModel: modelNames[0]?.name,
    voiceId: speechOptions.defaultVoice,
    format: speechOptions.defaultFormat,
    speed: 1,
    // 情感留空：快速创作不传该参数，工作台默认也不传，避免厂商因非法枚举拒绝请求
    emotion: "",
    copies: 1,
    points: 20,
  };
}

function mediaNode(id, mediaType, position, models, options = {}) {
  const modelNames = mediaModelNames(models, mediaType);
  const isVideo = mediaType === "video";
  return {
    id,
    type: "comfy",
    position,
    style: { width: isVideo ? 356 : 332 },
    data: {
      title: isVideo ? "视频生成" : "图像生成",
      kind: isVideo ? "VideoGenerator" : "ImageGenerator",
      tone: isVideo ? "green" : "amber",
      icon: isVideo ? Film : Image,
      source: "canvas",
      enabled: true,
      preview: options.preview,
      inputs: options.inputs || MEDIA_NODE_INPUTS,
      outputs: [{ name: isVideo ? "VIDEO" : "IMAGE", label: isVideo ? "视频" : "图像", type: isVideo ? "VIDEO" : "IMAGE" }],
      media: {
        type: mediaType,
        prompt: options.prompt || "",
        models: modelNames,
        model: options.model || modelNames[0]?.name,
        mode: options.mode || (isVideo ? "参考视频" : "参考生成"),
        ratio: options.ratio || "16:9",
        resolution: options.resolution || (isVideo ? "2K" : "1K"),
        quality: "中",
        duration: options.duration || 5,
        audio: true,
        copies: 1,
        points: isVideo ? 600 : 80,
      },
    },
  };
}

function referenceAssetNode(id, position, asset) {
  const isVideo = asset.type === "VIDEO";
  return {
    id,
    type: "comfy",
    position,
    style: { width: 332 },
    data: {
      title: asset.title,
      kind: "ReferenceAsset",
      tone: isVideo ? "green" : "amber",
      icon: isVideo ? Film : Image,
      source: "canvas",
      enabled: true,
      preview: asset.preview,
      assetUrl: asset.url || asset.preview,
      assetType: asset.type,
      assetKey: asset.key,
      outputs: [{ name: asset.type, label: isVideo ? "视频" : "图像", type: asset.type }],
      fields: [],
    },
  };
}

function videoEditingNode(id, position, options = {}) {
  return {
    id,
    type: "comfy",
    position,
    style: { width: 382 },
    data: {
      title: "视频剪辑",
      kind: "VideoEditing",
      tone: "blue",
      icon: Clapperboard,
      source: "canvas",
      enabled: true,
      inputs: options.inputs || [{ name: "video", label: "视频素材", type: "VIDEO" }],
      outputs: [],
      // 空态默认（需求 4.2.5）：新建剪辑节点不携带演示成片，等上游视频连线后由 getClips 实时聚合
      editing: {
        status: options.status || "",
        mode: options.mode || "智能对齐",
        duration: options.duration || "",
        resolution: options.resolution || "",
        video: options.video || "",
        poster: options.poster || "",
        clips: [],
      },
    },
  };
}

function referenceAudioNode(id, position, options = {}) {
  return {
    id,
    type: "comfy",
    position,
    style: { width: 332 },
    data: {
      title: "参考音频",
      kind: "ReferenceAudio",
      tone: "violet",
      icon: Volume2,
      source: "canvas",
      enabled: true,
      inputs: [],
      outputs: [{ name: "AUDIO", label: "音频", type: "AUDIO" }],
      assetType: "AUDIO",
      assetKey: options.storageKey || "",
      media: { type: "reference-audio", name: options.name || "尚未上传音频", url: options.url || "", storageKey: options.storageKey || "" },
    },
  };
}

function referenceTextNode(id, position, asset) {
  return {
    id,
    type: "comfy",
    position,
    style: { width: 332 },
    data: {
      title: asset.title || "文本素材",
      kind: "ReferenceText",
      tone: "yellow",
      icon: Type,
      source: "canvas",
      enabled: true,
      assetKey: asset.key,
      assetUrl: asset.url || "",
      textContent: asset.textContent || "",
      // 静态节点：无生成控件，单一文本输出（供后续文本消费节点复用）
      outputs: [{ name: "TEXT", label: "文本", type: "TEXT" }],
      fields: [],
    },
  };
}

const NodeEditContext = createContext({
  updateField: () => {},
  updateMedia: () => {},
  updateData: () => {},
  generateMedia: () => {},
  notify: () => {},
  uploadAsset: async () => null,
  getReferences: () => [],
  removeReference: () => {},
  openReferencePicker: () => {},
});

function UnifiedHandles({ hasInput, hasOutput }) {
  return <>
    {hasInput && <Handle id="input" type="target" position={Position.Left} className="comfy-node__unified-handle comfy-node__unified-handle--input" />}
    {hasOutput && <Handle id="output" type="source" position={Position.Right} className="comfy-node__unified-handle comfy-node__unified-handle--output" />}
  </>;
}

function ComfyField({ nodeId, field, index }) {
  const { updateField } = useContext(NodeEditContext);
  const common = {
    className: "nodrag nowheel",
    value: field.value,
    placeholder: field.placeholder,
    // StableTextarea 的回调签名是 (value, event)，原生 input 是 (event)，这里统一兼容
    onChange: (event) => updateField(nodeId, index, typeof event === "string" ? event : event?.target?.value),
    onPointerDown: (event) => event.stopPropagation(),
  };
  return (
    <label className={`comfy-node__field ${field.multiline ? "comfy-node__field--multiline" : ""}`}>
      <span>{field.label}</span>
      {field.inputType === "boolean" ? (
        <input className="nodrag" type="checkbox" checked={field.value === true || field.value === "true"} onChange={(event) => updateField(nodeId, index, event.target.checked)} onPointerDown={(event) => event.stopPropagation()} />
      ) : field.options ? (
        <DemoSelect
          className="nodrag nowheel workflow-node-select"
          ariaLabel={field.label}
          value={field.value}
          onChange={(val) => updateField(nodeId, index, val)}
          options={field.options.map((option) => ({ value: option, label: option }))}
        />
      ) : field.multiline ? (
        <StableTextarea {...common} rows={field.label === "说明" ? 7 : 5} />
      ) : (
        <input {...common} type={field.inputType === "number" ? "number" : "text"} />
      )}
    </label>
  );
}

function ReferenceAudioNode({ id, data, selected }) {
  const { updateMedia, notify } = useContext(NodeEditContext);
  const { uploadAudio } = useContext(WorkflowNodeContext);
  const uploadRef = useRef(null);
  const media = data.media || {};
  return (
    <div className={`comfy-node reference-audio-node comfy-node--violet ${selected ? "comfy-node--selected" : ""} ${nodeCollapsedClass(data)}`}>
      <UnifiedHandles hasInput={false} hasOutput />
      <header><NodeCollapseButton id={id} collapsed={data.collapsed} /><strong>{data.title || "参考音频"}</strong><Volume2 size={14} /><NodeLockButton id={id} locked={data.locked} /><NodeDeleteButton id={id} title={data.title || "参考音频"} locked={data.locked} /></header>
      <NodeTagBadges tags={data.tags} />
      <div className="reference-audio-node__body nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
        <button className="reference-audio-node__upload" onClick={() => uploadRef.current?.click()}><Upload size={14} />{media.url ? "更换音频" : "上传参考音频"}</button>
        <div className={`reference-audio-node__preview ${media.url ? "has-audio" : ""}`}>
          <span><Music2 size={28} /></span>
          <strong>{media.name || "尚未上传音频"}</strong>
          {media.url ? <audio controls preload="metadata" src={media.url} /> : <small>支持 MP3、WAV、M4A 等常见格式</small>}
        </div>
        <input ref={uploadRef} hidden type="file" accept="audio/*" onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            const uploaded = await uploadAudio(file);
            updateMedia(id, { name: uploaded.name, url: uploaded.url, storageKey: uploaded.storageKey });
            notify(`已上传参考音频：${file.name}`);
          } catch (error) { notify(error.message || "音频上传失败"); }
        }} />
      </div>
      <footer><span>光驭画布节点</span><small>音频素材</small></footer>
    </div>
  );
}

function ReferenceTextNode({ id, data, selected }) {
  const { uploadAsset, updateData, notify } = useContext(NodeEditContext);
  const uploadRef = useRef(null);
  const draftRef = useRef(null);
  const content = data.textContent || "";
  const [draft, setDraft] = useState(content);
  useEffect(() => setDraft(content), [content]);
  const commitDraft = () => {
    const value = draftRef.current?.value ?? draft;
    if (value !== content) updateData(id, { textContent: value });
  };
  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const asset = await uploadAsset(file);
      if (!asset?.storageKey) throw new Error("素材上传未返回存储地址");
      const text = asset.textContent || (await file.text().catch(() => ""));
      updateData(id, { assetKey: asset.storageKey, assetUrl: asset.url || asset.src || (asset.storageKey ? mediaUrl(asset.storageKey) : ""), textContent: text });
      notify(`已上传文本素材：${file.name}`);
    } catch (error) { notify(error.message || "文本素材上传失败"); }
  };
  return (
    <div className={`comfy-node reference-text-node comfy-node--yellow ${selected ? "comfy-node--selected" : ""} ${nodeCollapsedClass(data)}`}>
      <UnifiedHandles hasInput={false} hasOutput />
      <header><NodeCollapseButton id={id} collapsed={data.collapsed} /><strong>{data.title || "文本素材"}</strong><Type size={14} /><NodeLockButton id={id} locked={data.locked} /><NodeDeleteButton id={id} title={data.title || "文本素材"} locked={data.locked} /></header>
      <NodeTagBadges tags={data.tags} />
      <div className="reference-text-node__body nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
        <textarea
          ref={draftRef}
          className="reference-text-node__content"
          value={draft}
          placeholder="粘贴或输入文本素材内容…"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
        />
        <div className="reference-text-node__actions">
          <button className="reference-text-node__upload" onClick={() => uploadRef.current?.click()}><Upload size={13} />{content ? "替换文本文件" : "上传文本文件"}</button>
          <input ref={uploadRef} hidden type="file" accept=".txt,.md,text/*" onChange={handleUpload} />
        </div>
      </div>
      <footer><span>光驭画布节点</span><small>文本素材</small></footer>
    </div>
  );
}

function ComfyNode({ id, data, selected }) {
  // 钩子必须无条件置顶（早于所有 early return），遵守 rules-of-hooks
  const { uploadAsset: ctxUpload, updateData: ctxUpdateData, notify } = useContext(NodeEditContext);
  const assetUploadRef = useRef(null);
  if (["ImageGenerator", "VideoGenerator"].includes(data.kind)) return <SpecializedMediaNode id={id} data={data} selected={selected} />;
  if (data.kind === "AudioGenerator") return <SpecializedAudioNode id={id} data={data} selected={selected} />;
  if (data.kind === "ReferenceAudio") return <ReferenceAudioNode id={id} data={data} selected={selected} />;
  if (data.kind === "VideoEditing") return <SpecializedEditingNode id={id} data={data} selected={selected} />;
  if (data.kind === "ReferenceText") return <ReferenceTextNode id={id} data={data} selected={selected} />;
  const Icon = resolveNodeIcon(data.icon, data.kind);
  const hasInputs = Array.isArray(data.inputs) ? data.inputs.length > 0 : !["CheckpointLoaderSimple", "LoadImage", "MarkdownNote", "ReferenceAsset"].includes(data.kind);
  const hasOutputs = Array.isArray(data.outputs) ? data.outputs.length > 0 : !["SaveImage", "SaveVideo", "VideoEditing"].includes(data.kind);
  const fields = (data.fields && data.fields.length)
    ? data.fields
    : ["MarkdownNote", "Prompt"].includes(data.kind)
      ? [{ label: "内容", value: data.prompt || data.media?.prompt || "", placeholder: "输入文本内容…", multiline: true }]
      : [];
  const isAsset = data.kind === "ReferenceAsset";
  const handleAssetUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const asset = await ctxUpload(file);
      if (!asset?.storageKey) throw new Error("素材上传未返回存储地址");
      const url = asset.url || asset.src || mediaUrl(asset.storageKey);
      const type = (String(asset.type || "").toUpperCase()) || (file.type.startsWith("video") ? "VIDEO" : "IMAGE");
      ctxUpdateData(id, { assetKey: asset.storageKey, assetUrl: url, assetType: type, preview: asset.posterUrl || asset.poster || url });
      notify(`已上传素材：${file.name}`);
    } catch (error) { notify(error.message || "素材上传失败"); }
  };
  return (
    <div className={`comfy-node comfy-node--${data.tone || "blue"} ${selected ? "comfy-node--selected" : ""} ${data.enabled === false ? "comfy-node--disabled" : ""} ${nodeCollapsedClass(data)}`}>
      <UnifiedHandles hasInput={hasInputs} hasOutput={hasOutputs} />
      <header>
        <NodeCollapseButton id={id} collapsed={data.collapsed} />
        <strong>{data.title}</strong>
        <Icon size={14} />
        <NodeLockButton id={id} locked={data.locked} />
        <NodeDeleteButton id={id} title={data.title} locked={data.locked} />
        </header>
      <NodeTagBadges tags={data.tags} />
      {isAsset && (data.preview
        ? <div className="comfy-node__asset-preview"><img src={data.preview} alt={`${data.title}预览`} />{data.assetType === "VIDEO" && <span><Film size={12} />视频素材</span>}</div>
        : <div className="comfy-node__asset-empty">
            <span className="comfy-node__asset-type">{data.assetType === "VIDEO" ? "视频素材" : "图像素材"}</span>
            <button className="comfy-node__asset-upload nodrag" onClick={() => assetUploadRef.current?.click()}><Upload size={13} />上传素材</button>
            <input ref={assetUploadRef} hidden type="file" accept="image/*,video/*" onChange={handleAssetUpload} />
          </div>)}
      {!isAsset && data.preview && <img className="comfy-node__preview" src={data.preview} alt="节点输入预览" />}
      <div className="comfy-node__fields">
        {fields.map((field, index) => <ComfyField key={`${field.label}-${index}`} nodeId={id} field={field} index={index} />)}
      </div>
      <footer><span>{data.source === "canvas" ? "光驭画布节点" : "ComfyUI 节点"}</span><small>{data.source === "comfy-core" ? "核心" : data.source === "canvas" ? "画布" : data.source || "扩展"}</small></footer>
    </div>
  );
}

const GROUP_COLORS = ["#7584ff", "#349064", "#be5570", "#b97a14", "#aa559f", "#4e66cf"];

// 节点标签集合（需求 1.3 业务规则）：固定四类，不可扩展。
const NODE_TAG_OPTIONS = ["角色", "场景", "道具", "参考"];

// 贴纸预设（需求 1.8）：纯展示图层，不进画布节点、不参与连线与运行。// 用 emoji 做视觉标记，避免为每种贴纸引入图片资源。
const STICKER_PRESETS = [
  { id: "star", label: "星标", glyph: "⭐", tone: "#f5c33b" },
  { id: "note", label: "便签", glyph: "📌", tone: "#e07a5f" },
  { id: "idea", label: "灵感", glyph: "💡", tone: "#f0c674" },
  { id: "check", label: "待办", glyph: "✅", tone: "#6fbf8b" },
  { id: "warn", label: "注意", glyph: "⚠️", tone: "#e2a03f" },
  { id: "heart", label: "喜欢", glyph: "❤️", tone: "#e0658a" },
];

// 水印平铺密度：画布可视区约 1200×800，一个水印块 240×140，按 6×6 铺满并留余量，
// 超出部分靠 overflow:hidden 裁掉，保证任意窗口尺寸下都铺满不留白。
const WATERMARK_TILE_COUNT = 36;

// 贴纸图层落库 / 还原的清洗口径（需求 1.8）：只认预设里的字段，
// 坐标钳为有限数，避免脏数据把贴纸甩到画布外或让拖动算出 NaN。
function sanitizeStickers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      id: String(item.id || `sticker-restored-${index}`),
      label: String(item.label || "贴纸"),
      glyph: String(item.glyph || "⭐"),
      tone: /^#[0-9a-f]{3,8}$/i.test(String(item.tone || "")) ? String(item.tone) : "#f5c33b",
      x: Number.isFinite(Number(item.x)) ? Number(item.x) : 0,
      y: Number.isFinite(Number(item.y)) ? Number(item.y) : 0,
    }));
}

// 贴纸图层（需求 1.8）：渲染进 ViewportPortal，位置用画布（flow）坐标，
// 因此画布平移/缩放时贴纸跟着动——和节点同一套坐标系，不再是"浮在屏幕上的绝对定位"。
// 视觉尺寸保持屏幕恒定（scale(1/zoom) + transform-origin: top left），
// 缩到 20% 时 X 按钮也还点得到；拖动时屏幕位移除以 zoom 换算回流坐标。
function StickerLayer({ stickers, onMove, onRemove }) {
  const viewport = useViewport();
  const zoom = viewport.zoom || 1;
  return (
    <ViewportPortal>
      {stickers.map((sticker) => (
        <div
          key={sticker.id}
          className="canvas-sticker nodrag nopan"
          style={{
            left: sticker.x,
            top: sticker.y,
            background: sticker.tone,
            transform: `scale(${1 / zoom})`,
          }}
          title={sticker.label}
          onPointerDown={(event) => {
            event.stopPropagation();
            const startX = event.clientX;
            const startY = event.clientY;
            const originX = sticker.x;
            const originY = sticker.y;
            const onDrag = (moveEvent) => onMove(
              sticker.id,
              originX + (moveEvent.clientX - startX) / zoom,
              originY + (moveEvent.clientY - startY) / zoom,
            );
            const onUp = () => {
              window.removeEventListener("pointermove", onDrag);
              window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onDrag);
            window.addEventListener("pointerup", onUp);
          }}
        >
          <span>{sticker.glyph}</span>
          <button
            aria-label={`移除贴纸：${sticker.label}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onRemove(sticker.id); }}
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </ViewportPortal>
  );
}

function GroupFrame({ data, selected }) {
  const frameStyle = data.color ? { borderColor: data.color, background: `${data.color}14` } : undefined;
  return <div className={`canvas-group-frame ${selected ? "is-selected" : ""}`} style={frameStyle}><span><Group size={13} />{data.label || "节点组合"}</span></div>;
}

const nodeTypes = { comfy: ComfyNode, groupFrame: GroupFrame };

const WORKFLOW_KINDS = { image: "图片", video: "视频", audio: "语音", import: "导入", template: "模板" };

// 主页沿用「我的创作」（works-page）的卡片、类型页签与搜索框风格
function WorkflowLibrary({ records, status, onOpen, onCreate, onImport, onOpenTemplates, onDelete, onSaveAsTemplate }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [templateTarget, setTemplateTarget] = useState(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const fileRef = useRef(null);
  const searchRef = useRef(null);
  // type=template 的记录进模板库展示，工作流列表里排除，避免同画布出现两份
  const visible = records.filter((item) => !item.builtin && item.type !== "template" && (filter === "all" || item.type === filter) && `${item.title}${item.model}${(item.models || []).join("")}`.toLowerCase().includes(query.toLowerCase()));

  // "/" 聚焦搜索框（与搜索框内的 kbd 提示一致）
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const node = document.activeElement;
      if (node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(deleteTarget);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error.message || "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="page standard-content-page works-page workflow-library-page">
      <header className="page-header works-header">
        <div><h1>高级工作台</h1><p>选择一个工作流继续编辑，或从空白画布开始搭建。</p></div>
        <div className="workflow-library-actions">
          <button type="button" onClick={onOpenTemplates}><Layers3 size={16} /> 模板库</button>
          <button type="button" onClick={() => fileRef.current?.click()}><Upload size={16} /> 导入工作流</button>
          <button type="button" className="primary" onClick={onCreate}><Plus size={16} /> 新建工作流</button>
          <input ref={fileRef} hidden type="file" accept=".json" onChange={(event) => { onImport(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
      </header>

      <div className="works-controls">
        <div className="works-type-tabs" role="tablist" aria-label="工作流类型">
          {[["all", "全部"], ["video", "视频"], ["image", "图片"]].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} className={`works-type-tab${filter === value ? " is-active" : ""}`} onClick={() => setFilter(value)}>
              <WorksTypeIcon type={value} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="works-filter-group">
          <label className="works-search">
            <Search size={17} aria-hidden="true" />
            <span className="visually-hidden">搜索工作流</span>
            <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工作流或模型" autoComplete="off" />
          </label>
        </div>
      </div>

      {status && <p className={`workflow-library__status${status.error ? " is-error" : ""}`}>{status.text}</p>}

      {!status && records.length === 0 ? (
        <div className="works-empty">
          <div className="works-empty-icon" aria-hidden="true"><Layers3 size={28} /></div>
          <h2>暂无工作流</h2>
          <p>从空白画布开始搭建，或导入 ComfyUI / 工作台 JSON。</p>
        </div>
      ) : (
        <>
          <div className="works-result-summary">
            <span>{filter === "all" ? "全部工作流" : `找到 ${visible.length} 个工作流`}</span>
            <span>按更新时间排序</span>
          </div>
          <div className="works-grid">
            <button type="button" className="workflow-new-card" onClick={onCreate}>
              <span aria-hidden="true"><Plus size={22} /></span>
              <strong>空白工作流</strong>
              <small>从节点库开始搭建</small>
            </button>
          {visible.map((record, index) => (
            <article className="work-card workflow-record-card" key={record.id}>
              <button type="button" className="work-thumb workflow-cover" onClick={() => onOpen(record)} aria-label={`打开工作流：${record.title}`}>
                <WorkflowThumbnail record={record} variant={index} />
                {/* 仅导入类显示右上角徽章标识来源；生成类工作流内节点类型混用，不再标注 */}
                {record.type === "import" && <span className="work-kind">{WORKFLOW_KINDS[record.type] || "导入"}</span>}
              </button>
              <div className="work-card-body">
                <h3 title={record.title}>{record.title}</h3>
                <div className="work-model" title={cardModelTitle(record)}>{cardModelText(record)}</div>
                <p>{record.description || "暂无描述。"}</p>
              </div>
              <footer className="work-card-footer">
                <span className="work-card-tags">
                  {/* 「N 个节点」徽章从封面左上角移到 footer；右上角类型徽章已移除（工作流内节点类型混用，标注不准确） */}
                  <em className="work-card-kind">{record.nodes} 个节点</em>
                  <span><CalendarDays size={12} /> {record.updated}</span>
                </span>
                <div className="work-actions">
                  <button type="button" aria-label={`保存为模板：${record.title}`} title="保存为模板" disabled={record.type === "template"} onClick={() => { setTemplateTarget(record); }}><Layers3 size={16} /></button>
                  <button type="button" className="is-danger" aria-label={`删除工作流：${record.title}`} title="删除" onClick={() => { setDeleteError(null); setDeleteTarget(record); }}><Trash2 size={16} /></button>
                </div>
              </footer>
            </article>
          ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除工作流？"
        message={deleteTarget
          ? deleteError
            ? `删除失败：${deleteError}`
            : `「${deleteTarget.title}」删除后将无法恢复，请确认是否继续。`
          : ""}
        confirmLabel="删除"
        busy={deleting}
        busyLabel="删除中…"
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
      />
      {templateTarget && <SaveAsTemplateDialog
        record={templateTarget}
        saving={templateSaving}
        error={templateError}
        onClose={() => { if (!templateSaving) setTemplateTarget(null); }}
        onConfirm={async (meta) => {
          setTemplateSaving(true);
          setTemplateError("");
          try {
            await onSaveAsTemplate(templateTarget, meta);
            setTemplateTarget(null);
          } catch (error) {
            setTemplateError(error.message || "保存模板失败");
          } finally {
            setTemplateSaving(false);
          }
        }}
      />}
    </section>
  );
}

// 「保存为模板」弹框：填写模板名/描述/分类/标签后另存为 type=template 的副本（原工作流不动）
function SaveAsTemplateDialog({ record, saving, error, onClose, onConfirm }) {
  const [title, setTitle] = useState(() => `${record?.title || "未命名工作流"} 模板`);
  const [description, setDescription] = useState(record?.description || "");
  const [category, setCategory] = useState("image");
  const [tagsText, setTagsText] = useState("");
  const tags = tagsText.split(/[,，、\s]+/).map((tag) => tag.trim()).filter(Boolean).slice(0, 6);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="save-template-dialog" role="dialog" aria-modal="true" aria-label="保存为模板">
        <header><strong>保存为模板</strong><small>将「{record?.title}」的当前画布另存为个人模板，可在模板库中一键实例化。</small></header>
        <div className="save-template-dialog__body">
          <label><span>模板名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={128} placeholder="模板名称" autoFocus /></label>
          <label><span>描述</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={512} rows={2} placeholder="模板用途说明（可选）" /></label>
          <div className="save-template-dialog__row">
            <label><span>分类</span>
              <DemoSelect ariaLabel="模板分类" value={category} onChange={setCategory} options={[
                { value: "image", label: "图片" },
                { value: "video", label: "视频" },
                { value: "audio", label: "语音" },
              ]} />
            </label>
            <label><span>标签（最多 6 个，逗号分隔）</span><input value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="如：首尾帧, 双镜头" /></label>
          </div>
          {tags.length > 0 && <p className="save-template-dialog__tags">{tags.map((tag) => <em key={tag}>{tag}</em>)}</p>}
          {error && <p className="save-template-dialog__error">{error}</p>}
        </div>
        <footer>
          <button type="button" disabled={saving} onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={saving || !title.trim()} onClick={() => onConfirm({ title: title.trim(), description: description.trim(), category, tags })}>
            {saving ? "保存中…" : "保存为模板"}
          </button>
        </footer>
      </section>
    </div>
  );
}

// 端口补齐：旧工作流里图像节点没有输入端口、音频节点是单个 DATA 口、剪辑节点只有视频口，
// 加载时统一为新端口定义，保证「文本→图像/音频」「图片→图像/音频」「音频→剪辑」都能连线。
function ensurePorts(data, expected) {
  const current = Array.isArray(data.inputs) ? data.inputs.filter(Boolean) : [];
  const names = new Set(current.map((port) => port.name || port.id));
  const missing = expected.filter((port) => !names.has(port.name));
  // 旧版音频节点用 { name: "input", type: "DATA" } 兜底口，语义相同可以替换掉
  const legacyOnly = current.length === 1 && current[0].type === "DATA";
  if (!missing.length && !legacyOnly) return current;
  return (legacyOnly ? [] : current).concat(missing.map((port) => ({ ...port })));
}

function hydrateStoredNode(node, models) {
  if (!node || node.type === "groupFrame") return node;
  // 产物水合（两个来源，均只有 storageKey、需重建带 token 的 url/posterUrl）：
  // 1) 落库 graph 的节点顶层 outputs（persistableWorkflowGraph 从 runtime.outputs 迁移而来）；
  // 2) 导入工程文件由 serializer 重建的 data.runtime.outputs。
  // 注意先取原值再清 runtime。
  const rawOutputs = Array.isArray(node.outputs) && node.outputs.length
    ? node.outputs
    : Array.isArray(node.data?.runtime?.outputs) ? node.data.runtime.outputs : null;
  const importedOutputs = rawOutputs ? hydrateImportedOutputs(rawOutputs) : null;
  const data = { ...(node.data || {}), runtime: undefined };
  if (importedOutputs?.length) {
    data.runtime = { runId: null, status: "SUCCEEDED", progress: 100, reused: true, outputs: importedOutputs };
  }
  const kind = data.kind || node.type || "MarkdownNote";
  data.kind = kind;
  data.icon = resolveNodeIcon(data.icon, kind);
  if (["MarkdownNote", "Prompt"].includes(kind) && (!Array.isArray(data.fields) || !data.fields.length)) {
    data.fields = [{ label: "内容", value: data.prompt || data.media?.prompt || "", placeholder: "输入文本内容…", multiline: true }];
  }
  if (["ImageGenerator", "VideoGenerator"].includes(kind)) {
    const isVideo = kind === "VideoGenerator";
    const fallbackMedia = mediaNode("preview", isVideo ? "video" : "image", { x: 0, y: 0 }, models).data.media;
    data.media = {
      ...fallbackMedia,
      ...(data.media || {}),
      models: data.media?.models?.length ? data.media.models : fallbackMedia.models,
    };
    data.inputs = ensurePorts(data, MEDIA_NODE_INPUTS);
  } else if (kind === "AudioGenerator") {
    const fallbackAudio = audioMedia(models);
    data.media = {
      ...fallbackAudio,
      ...(data.media || {}),
      models: data.media?.models?.length ? data.media.models : fallbackAudio.models,
    };
    data.inputs = ensurePorts(data, AUDIO_NODE_INPUTS);
  } else if (kind === "VideoEditing") {
    const fallbackEditing = videoEditingNode("preview", { x: 0, y: 0 }).data.editing;
    data.editing = {
      ...fallbackEditing,
      ...(data.editing || {}),
    };
    data.inputs = ensurePorts(data, EDITING_NODE_INPUTS);
  }
  const defaultWidth =
    kind === "VideoGenerator"
      ? 356
      : kind === "ImageGenerator"
        ? 332
        : kind === "AudioGenerator"
          // 音频节点控制行要同排容纳「模型 | 音色摘要 | 份数」，比视频剪辑节点略宽
          ? 400
          : kind === "VideoEditing"
            ? 382
            : undefined;
  const style = defaultWidth && !node.style?.width ? { ...(node.style || {}), width: defaultWidth } : node.style;
  // 顶层 outputs 只用于水合，不进 React Flow 节点状态（避免状态里囤积冗余数据）
  const { outputs: _nodeOutputs, ...rest } = node;
  return { ...rest, type: "comfy", style, data };
}

function WorkflowEditor({ record, initialGraph, onBack, models, selectedModel, onRecordChange, appendRequest, onAppendApplied }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(() => (initialGraph.nodes || []).map((node) => hydrateStoredNode(node, models)));
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges || []);
  const [canvasTool, setCanvasTool] = useState("select");
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [runTotal, setRunTotal] = useState(0);
  // 运行方式：reuse=复用参数未变节点的历史产物（默认），regenerate=全部重新生成（不复用）
  const [runMode, setRunMode] = useState("reuse");
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  // 返回拦截：dirty 画布直接返回会丢草稿，先弹三选一确认
  const [backGuard, setBackGuard] = useState(false);
  const [savingBack, setSavingBack] = useState(false);
  const [flowInstance, setFlowInstance] = useState(null);
  // 打开 / 刷新时还原上次保存的画布视口（需求 4.1.1.6）；老数据没有视口就回退 fitView
  const initialViewport = useMemo(() => normalizeViewport(initialGraph?.viewport), [initialGraph?.viewport]);
  // 贴纸图层随画布落库（需求 1.8）：打开 / 刷新时从 graph.stickers 还原
  const [stickers, setStickers] = useState(() => sanitizeStickers(initialGraph?.stickers));
  const [toast, setToast] = useState("");
  const [addMenu, setAddMenu] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  // 节点右键菜单（需求 1.3）：复制节点、重命名、标签、保存为资产、删除
  const [nodeMenu, setNodeMenu] = useState(null);
  const [nodeRenameDraft, setNodeRenameDraft] = useState("");
  const [nodeRenameEditing, setNodeRenameEditing] = useState(false);
  const nodeMenuRenameRef = useRef(null);
  const [edgeMenu, setEdgeMenu] = useState(null);
  const [edgeDeleteConfirm, setEdgeDeleteConfirm] = useState(null);
  // 删除节点二次确认：nodeDeleteConfirm 只放可序列化字段；pending / trigger 放 ref，
  // 保证 React Flow 同批次发出的 nodes/edges remove change 都能被成对拦下。
  const [nodeDeleteConfirm, setNodeDeleteConfirm] = useState(null);
  const nodeDeletePendingRef = useRef(null);
  const nodeDeleteTriggerRef = useRef(null);
  const helpButtonRef = useRef(null);
  const [comfyMenuOpen, setComfyMenuOpen] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  // 画布资产（需求 1.3）：跨画布复用的节点配置快照，落在服务端 canvas_asset 表。
  const [canvasAssets, setCanvasAssets] = useState([]);
  const [assetsBusy, setAssetsBusy] = useState(false);
  const [tidyMenuOpen, setTidyMenuOpen] = useState(false);
  const [includeConnected, setIncludeConnected] = useState(false);
  // TC-008 自动排版检测到环时的瞬态高亮（定时自动消退）
  const [cycleHighlight, setCycleHighlight] = useState(null);
  const cycleHighlightTimer = useRef(null);
  const [referencePickerNodeId, setReferencePickerNodeId] = useState(null);
  // 独立剪辑台（UC-AIGC-V1C20-007）：全屏覆盖层，画布内存态不销毁；null=关闭
  const [editingSuiteNodeId, setEditingSuiteNodeId] = useState(null);
  // 弹框目标位：null=添加参考素材；"first"/"last"=选首帧/尾帧（参考帧档的显式图框）
  const [referencePickerSlot, setReferencePickerSlot] = useState(null);
  // 参考素材弹框「素材库」分区：真实素材库数据（null=未加载），只列图片/视频
  const [referenceAssets, setReferenceAssets] = useState(null);
  const [referenceAssetsError, setReferenceAssetsError] = useState("");
  // 画布辅助工具（需求 1.8）：贴纸、水印、小地图、连线显示。
  // 小地图与水印默认关闭；抓手模式下节点不可拖动、不可连线（见 nodesDraggable / nodesConnectable）。
  const [watermarkOn, setWatermarkOn] = useState(false);
  const [minimapOn, setMinimapOn] = useState(false);
  const [edgesVisible, setEdgesVisible] = useState(true);
  // 贴纸：独立可拖动的贴纸图层（不参与连线与运行）；state 已在组件首部随 graph 初始化
  const [stickerMenuOpen, setStickerMenuOpen] = useState(false);
  const [importReport, setImportReport] = useState(null);
  // 标题行内重命名：草稿 + 编辑态，提交后回写 record 并按需落库
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(() => normalizeWorkflowTitle(record?.title));
  const titleInputRef = useRef(null);
  const titleEditingRef = useRef(false);
  const fileRef = useRef(null);
  const zoomLabelRef = useRef(null);
  // 允许同一画布上并存多个运行（例如依次点两个视频节点的「生成」）：
  // 每次运行各自持有 AbortController，按运行标识（节点 id 或 "all"）存放，互不覆盖。
  // 原先用单个 runLock + 单个 runAbortRef，第二次点击会被锁静默拦下（表现为「点了没反应」），
  // 即使放行也会覆盖控制器导致第一次运行无法停止。
  //
  // 注意 key 只是「运行标识」，**不是**后端 run id：「停止」要按 workflow_run.id 调
  // /runs/{id}/cancel，所以每次运行还得记住自己拿到的 runId。
  // 旧实现把 key 当 run id 用（Number(key) 恒为 NaN，被 filter 掉 → 数组为空），
  // 于是「停止」永远提示「没有正在运行的任务」，节点却一直卡在「生成中」。
  const localRunRef = useRef(new Map()); // 运行标识 -> { controller, runId, stopRequested }
  // 只观察到、本地没发起的运行（打开画布时服务端已有在跑的任务）：停止时同样要能取消
  const observedRunIdsRef = useRef(new Set());
  // 快照恢复用的独立控制器：此前它与运行轮询共用 runAbortRef，两者互相覆盖，
  // 导致「打开画布时正在跑」的场景下运行轮询 abort 不到、runLock 永不释放，
  // 之后点生成/重试全部被 runGraph 开头静默拦下（表现为「点击没反应」）。
  const restoreAbortRef = useRef(null);
  const notifiedFailuresRef = useRef(new Set());
  // 草稿「点生成即保存」：并行点多个节点生成时只建一条工作流（持久记录 id）
  const autoSavedWorkflowIdRef = useRef(null);
  const autoSavePromiseRef = useRef(null);
  // 一次性标记：跳过自动保存导致 record.id 变化而触发的那一次快照恢复，
  // 否则新画布刚开跑就被空快照覆盖节点、并把 running 置回 false。
  const skipRestoreIdRef = useRef(null);
  const referenceUploadRef = useRef(null);
  const stageRef = useRef(null);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const nodeClipboardRef = useRef(null);
  useEffect(() => () => { localRunRef.current.forEach((entry) => entry?.controller?.abort()); localRunRef.current.clear(); window.clearTimeout(cycleHighlightTimer.current); }, []);
  // 标题行内重命名：进入编辑态后自动聚焦并全选，失焦/回车提交，Esc 取消
  useEffect(() => {
    if (!editingTitle) return;
    const input = titleInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editingTitle]);
  function startTitleEdit() {
    titleEditingRef.current = true;
    setTitleDraft(normalizeWorkflowTitle(record?.title));
    setEditingTitle(true);
  }
  function cancelTitleEdit() {
    titleEditingRef.current = false;
    setEditingTitle(false);
    setTitleDraft(normalizeWorkflowTitle(record?.title));
  }
  // 仅改标题的落库：PUT 会整体覆盖 graph，所以先取服务端已存画布再回写，保证只变标题
  // 返回 "saved" | "skip"（未落库的新画布）| "error"
  async function persistTitleOnly(nextTitle) {
    const numericId = Number(record?.id);
    const owned = Number.isFinite(numericId) && numericId > 0 && !record.builtin;
    if (!owned) return "skip";
    try {
      const detail = await getWorkflow(numericId);
      await updateWorkflowRecord(numericId, buildTitleUpdateBody(detail, nextTitle, record));
      return "saved";
    } catch (error) {
      showToast(error.message || "名称保存失败", 2800);
      return "error";
    }
  }
  async function commitTitle() {
    if (!titleEditingRef.current) return;
    titleEditingRef.current = false;
    setEditingTitle(false);
    const next = normalizeWorkflowTitle(titleDraft);
    const previous = normalizeWorkflowTitle(record?.title);
    if (!isWorkflowTitleChanged(previous, next)) {
      setTitleDraft(previous);
      return;
    }
    onRecordChange?.({ ...record, title: next });
    const result = await persistTitleOnly(next);
    if (result === "error") {
      onRecordChange?.({ ...record, title: previous });
      setTitleDraft(previous);
      return;
    }
    if (result === "saved") showToast("已重命名", 2000);
    else {
      setSaved(false);
      showToast("名称已更新，点击「保存」生效", 2400);
    }
  }
  const focusNodes = useMemo(() => {
    const primary = nodes.filter((node) => !["MarkdownNote", "ImageScaleToTotalPixels", "GetImageSize"].includes(node.data.kind));
    return primary.length ? primary : nodes;
  }, [nodes]);
  // 快照读「最近一次已提交渲染」的 nodes/edges。用 ref 承接而不是闭包依赖，
  // 是为了让 snapshotGraph/rememberGraph 保持稳定引用，不至于每次渲染都换新函数、
  // 连带下游几十个 useCallback 全部失效。
  const graphRef = useRef({ nodes, edges });
  useEffect(() => { graphRef.current = { nodes, edges }; });
  const snapshotGraph = useCallback(() => {
    const current = graphRef.current;
    return {
      nodes: current.nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data } })),
      edges: current.edges.map((edge) => ({ ...edge })),
    };
  }, []);
  const rememberGraph = useCallback(() => { historyRef.current = [...historyRef.current.slice(-39), snapshotGraph()]; futureRef.current = []; }, [snapshotGraph]);
  // ---- 文本输入进撤销栈（Playwright 实测结论）----
  // 焦点在 TEXTAREA/INPUT 内时浏览器原生撤销逐字生效，且全局 Ctrl+Z 在 INPUT/TEXTAREA 早退，
  // 所以编辑过程中绝不能压栈：否则原生撤销把字符退回去、栈里却多留一条，同样的改动会被撤销两遍。
  // 改为「聚焦时存编辑前快照，失焦时若有改动才压一条」——一次连续输入 = 一条历史，
  // 既能撤销，也不会把 40 条栈瞬间打满。非文本参数（模型/比例/份数/锁定/折叠）无连续输入问题，操作即一条。
  const textEditRef = useRef(null);
  // 会话里记 dirty：只有真的写回过节点数据才在失焦时留一条历史。
  // 不能拿 nodes/edges 的引用比较——点进输入框会顺带改变节点选中态（React Flow 的 select 变更），
  // 引用必然不同，于是「只点一下没改字」也会白留一条空历史。
  const markEdited = useCallback(() => { if (textEditRef.current) textEditRef.current.dirty = true; }, []);
  const beginTextEdit = useCallback(() => {
    if (textEditRef.current) return;
    textEditRef.current = { dirty: false, snapshot: snapshotGraph() };
  }, [snapshotGraph]);
  const commitTextEdit = useCallback(() => {
    const session = textEditRef.current;
    textEditRef.current = null;
    if (!session?.dirty) return;
    historyRef.current = [...historyRef.current.slice(-39), session.snapshot];
    futureRef.current = [];
  }, []);
  // showToast 的清理定时器：新 toast 先清旧的，避免前一条的定时器把后一条提前清空（挂引用后马上点生成必现）
  const toastTimer = useRef(null);
  const showToast = useCallback((message, duration = 1800) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), duration);
  }, []);
  // 列表只取元信息（节点图按 id 单独拉）。后端未部署 / 未登录时静默保持空态，不阻塞画布编辑。
  const loadCanvasAssets = useCallback(() => fetchCanvasAssets()
    .catch(() => [])
    .then((items) => setCanvasAssets(Array.isArray(items) ? items : [])), []);
  useEffect(() => { loadCanvasAssets(); }, [loadCanvasAssets]);
  // TC-008 环路高亮的渲染期派生：仅在渲染层叠加 className/样式，不触碰 nodes/edges 状态，
  // 因此不进入撤销栈，也不会随 persistableWorkflowGraph / 序列化导出污染画布数据
  const displayNodes = useMemo(() => {
    // 锁定节点（需求 4.1.2.5）：仅渲染层禁用拖拽/删除，不触碰 nodes 状态，序列化不受影响
    const applyLock = (node) => (node.data?.locked ? { ...node, draggable: false, deletable: false } : node);
    if (!cycleHighlight) return nodes.map(applyLock);
    return nodes.map((node) => {
      const locked = applyLock(node);
      return cycleHighlight.nodeIds.has(node.id)
        ? { ...locked, className: `workflow-node--cycle ${locked.className || ""}`.trim() }
        : locked;
    });
  }, [nodes, cycleHighlight]);
  const displayEdges = useMemo(() => {
    const base = edgesVisible ? edges : edges.map((edge) => ({ ...edge, hidden: true }));
    if (!cycleHighlight) return base;
    return base.map((edge) => cycleHighlight.edgeIds.has(edge.id)
      ? { ...edge, animated: true, style: { ...(edge.style || {}), stroke: "#ef4444", strokeWidth: 2.6 } }
      : edge);
  }, [edges, cycleHighlight, edgesVisible]);
  // 追加模板到当前画布（需求 4.3.1.6）：节点平移到现有画布右侧，不覆盖已有节点
  useEffect(() => {
    if (!appendRequest?.graph?.nodes?.length) return;
    const incoming = appendRequest.graph.nodes;
    const incomingEdges = appendRequest.graph.edges || [];
    const maxX = nodes.reduce((acc, node) => Math.max(acc, node.position?.x || 0), 0);
    const offsetX = Math.round((maxX + 320) / 8) * 8 + 96;
    const usedIds = new Set(nodes.map((node) => node.id));
    const remap = new Map();
    const addedNodes = incoming.map((node) => {
      const id = usedIds.has(node.id) ? `${node.id}-${appendRequest.token || Date.now()}` : node.id;
      usedIds.add(id);
      remap.set(node.id, id);
      return { ...node, id, position: { x: (node.position?.x || 0) + offsetX, y: node.position?.y || 0 } };
    });
    const addedEdges = incomingEdges
      .filter((edge) => remap.has(edge.source) && remap.has(edge.target))
      .map((edge) => ({ ...edge, id: `${edge.id}-${appendRequest.token || Date.now()}`, source: remap.get(edge.source), target: remap.get(edge.target) }));
    rememberGraph();
    setNodes((items) => [...items, ...addedNodes]);
    setEdges((items) => [...items, ...addedEdges]);
    setSaved(false);
    showToast(`已追加 ${addedNodes.length} 个模板节点到当前画布`, 2600);
    window.setTimeout(() => flowInstance?.fitView({ padding: 0.12, duration: 320 }), 80);
    onAppendApplied?.();
  }, [appendRequest?.token]);
  useEffect(() => {
    // 「点生成即自动保存」让草稿的 record.id 从 blank-xxx 变成数字，会触发本 effect。
    // 此刻画布正要开跑，恢复一次旧快照只会覆盖节点状态 / 误清 running，直接跳过这一次。
    if (skipRestoreIdRef.current != null && Number(record.id) === Number(skipRestoreIdRef.current)) {
      skipRestoreIdRef.current = null;
      return;
    }
    const workflowId = Number(record.id);
    if (!Number.isFinite(workflowId) || workflowId <= 0 || record.builtin) return;
    const controller = new AbortController();
    restoreAbortRef.current = controller;
    // 恢复期不占用运行锁：恢复只是把上一次运行的结果画回卡片，
    // 若在此期间持锁，用户点「生成/重试」会被 runGraph 静默拦下。
    restoreWorkflowSnapshot({ workflowId, signal: controller.signal, snapshot: getWorkflowRuntimeSnapshot, get: getWorkflowRun,
      onSnapshot: (snapshot) => {
        setNodes((current) => applyWorkflowSnapshotToNodes(current, snapshot));
        // 记录服务端在跑的 run id：打开画布时若已有任务在跑，节点会显示「生成中」，
        // 此时本地没有控制器，「停止」必须靠这些 id 去调 cancel，否则永远提示「没有正在运行的任务」。
        observedRunIdsRef.current = new Set((snapshot.activeRuns || [])
          .filter((run) => run?.status === "RUNNING")
          .map((run) => Number(run?.id))
          .filter((id) => Number.isFinite(id) && id > 0));
        setRunning(snapshot.activeRuns?.some((run) => run.status === "RUNNING") || false);
        setRunProgress(snapshot.steps.filter((step) => step.status === "SUCCEEDED").length);
        setRunTotal(snapshot.steps.length || 1);
      },
    }).catch((error) => { if (!controller.signal.aborted) showToast(error.message || "运行恢复失败，请重新打开工作流", 3600); })
      .finally(() => {
        if (restoreAbortRef.current === controller) restoreAbortRef.current = null;
        observedRunIdsRef.current.clear();
        if (!controller.signal.aborted) setRunning(false);
      });
    return () => controller.abort();
  }, [record.id, record.builtin, setNodes, showToast]);
  const onConnect = useCallback((params) => {
    if (!canConnectNodes(nodes, params)) {
      const sourceNode = nodes.find((node) => node.id === params.source);
      const targetNode = nodes.find((node) => node.id === params.target);
      // 文案对齐需求 1.2 异常流 4a「节点类型不兼容，无法连线」；音频节点单独点名（需求 1.6 AC-011）
      const audioRejected = targetNode?.data?.kind === "AudioGenerator" && ["ImageGenerator", "VideoGenerator"].includes(sourceNode?.data?.kind);
      showToast(sourceNode?.data?.kind === "VideoEditing"
        ? "视频剪辑是终点节点，不可作为上游连接下游"
        : audioRejected
          ? "节点类型不兼容，无法连线：音频节点只接受文本输入"
          : "节点类型不兼容，无法连线");
      return;
    }
    rememberGraph();
    setEdges((items) => addEdge({
      ...params,
      type: "bezier",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#7584ff", width: 14, height: 14 },
      style: { stroke: "#7584ff", strokeWidth: 2.2 },
    }, items));
    setSaved(false);
  }, [nodes, rememberGraph, setEdges, showToast]);

  const isValidConnection = useCallback((connection) => canConnectNodes(nodes, connection), [nodes]);

  function addCatalogNode(item, position) {
    rememberGraph();
    const id = `node-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const resolvedMedia = item.media || (item.kind === "AudioGenerator" ? audioMedia(models) : ["ImageGenerator", "VideoGenerator"].includes(item.kind) ? mediaNode("preview", item.kind === "VideoGenerator" ? "video" : "image", { x: 0, y: 0 }, models).data.media : undefined);
    const nextNode = { id, type: "comfy", position: position || { x: 260 + nodes.length * 22, y: 220 + (nodes.length % 4) * 88 }, style: { width: item.kind === "VideoGenerator" ? 356 : item.kind === "ImageGenerator" ? 332 : item.kind === "AudioGenerator" ? 400 : item.kind === "VideoEditing" ? 382 : 270 }, data: { title: item.name, kind: item.kind, icon: item.icon, tone: item.tone, fields: (item.fields || []).map((field) => ({ ...field })), inputs: (item.inputs || []).map((port) => ({ ...port })), outputs: (item.outputs || []).map((port) => ({ ...port })), enabled: true, source: item.source || "comfy-core", media: resolvedMedia ? { ...resolvedMedia, models: [...(resolvedMedia.models || [])] } : undefined, editing: item.kind === "VideoEditing" ? videoEditingNode("preview", { x: 0, y: 0 }).data.editing : item.editing, preview: item.preview || (item.kind === "LoadImage" ? "/comfyui-workflows/minimax-h3/transparent_rgb_gaming_mouse.png" : undefined) } };
    // 落位一律做重叠避让（需求 9.1.4）：默认级联位置与拖放点都可能压住已有卡片，
    // 叠压的后画卡片会盖住先画节点的连线句柄，导致无法连线
    const preferred = position || { x: 260 + nodes.length * 22, y: 220 + (nodes.length % 4) * 88 };
    setNodes((items) => [...items, { ...nextNode, position: placeQuickNode(preferred, items, nextNode) }]);
    setSaved(false);
    setAddMenu(null);
    setContextMenu(null);
  }

  function addQuickNode(item) {
    const screenPoint = addMenu?.origin === "context" ? { x: addMenu.clientX, y: addMenu.clientY } : { x: (stageRef.current?.getBoundingClientRect().left || 0) + 360, y: (stageRef.current?.getBoundingClientRect().top || 0) + 280 };
    const position = flowInstance?.screenToFlowPosition(screenPoint);
    const configuredItem = item.kind === "AudioGenerator"
      ? { ...item, source: "canvas", media: audioMedia(models) }
      : ["ImageGenerator", "VideoGenerator"].includes(item.kind)
      ? { ...item, source: "canvas", media: mediaNode("preview", item.kind === "VideoGenerator" ? "video" : "image", { x: 0, y: 0 }, models).data.media }
      : { ...item, source: "canvas" };
    addCatalogNode(configuredItem, position);
  }

  function undoGraph() {
    // 撤销会整体替换 nodes/edges，未提交的文本编辑会话直接作废（它的快照已过时）
    textEditRef.current = null;
    const previous = historyRef.current.pop();
    if (!previous) return;
    futureRef.current.push(snapshotGraph());
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setSaved(false);
    setContextMenu(null);
    showToast("已撤销上一步操作");
  }

  function redoGraph() {
    textEditRef.current = null;
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(snapshotGraph());
    setNodes(next.nodes);
    setEdges(next.edges);
    setSaved(false);
    setContextMenu(null);
    showToast("已重做上一步操作");
  }

  async function pasteToCanvas() {
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) throw new Error("empty");
      const textItem = { ...canvasQuickItems[0], fields: [{ label: "内容", value: value.slice(0, 1000), multiline: true }] };
      const rect = stageRef.current?.getBoundingClientRect();
      const position = flowInstance?.screenToFlowPosition({ x: (rect?.left || 0) + (contextMenu?.x || 360), y: (rect?.top || 0) + (contextMenu?.y || 280) });
      addCatalogNode({ ...textItem, source: "canvas" }, position);
      showToast("剪贴板内容已粘贴为文本节点");
    } catch {
      setContextMenu(null);
      showToast("剪贴板中没有可粘贴的文本");
    }
  }

  // ---- 节点级复制 / 粘贴 / 全选 / 反选（需求 4.1.4.6）----
  const cloneWorkflowNodes = useCallback((sourceNodes, sourceEdges, idSet) => {
    const idMap = new Map();
    const clonedNodes = sourceNodes
      .filter((node) => idSet.has(node.id))
      .map((node) => {
        const id = `node-${Date.now()}-${Math.round(Math.random() * 1000)}`;
        idMap.set(node.id, id);
        return {
          ...node,
          id,
          selected: false,
          dragging: false,
          parentId: undefined,
          extent: undefined,
          position: { x: node.position.x, y: node.position.y },
          style: node.style ? { ...node.style } : undefined,
          data: {
            ...node.data,
            fields: node.data.fields ? node.data.fields.map((field) => ({ ...field })) : node.data.fields,
            inputs: node.data.inputs ? node.data.inputs.map((port) => ({ ...port })) : node.data.inputs,
            outputs: node.data.outputs ? node.data.outputs.map((port) => ({ ...port })) : node.data.outputs,
            media: node.data.media ? { ...node.data.media, models: node.data.media.models ? [...node.data.media.models] : node.data.media.models } : node.data.media,
            editing: node.data.editing ? { ...node.data.editing } : node.data.editing,
          },
        };
      });
    const clonedEdges = sourceEdges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({ ...edge, id: `edge-${Date.now()}-${Math.round(Math.random() * 1000)}`, source: idMap.get(edge.source), target: idMap.get(edge.target) }));
    return { nodes: clonedNodes, edges: clonedEdges };
  }, []);

  const pasteClonedNodes = useCallback((cloned, offset = { x: 0, y: 0 }, basePosition) => {
    if (!cloned.nodes.length) return [];
    const minX = Math.min(...cloned.nodes.map((node) => node.position.x));
    const minY = Math.min(...cloned.nodes.map((node) => node.position.y));
    const placed = cloned.nodes.map((node) => {
      const position = basePosition
        ? { x: basePosition.x + (node.position.x - minX), y: basePosition.y + (node.position.y - minY) }
        : { x: node.position.x + offset.x, y: node.position.y + offset.y };
      return { ...node, position, selected: true };
    });
    rememberGraph();
    setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), ...placed]);
    setEdges((items) => [...items, ...cloned.edges.map((edge) => ({ ...edge, selected: false }))]);
    setSelectedNodeIds(placed.map((node) => node.id));
    setSaved(false);
    showToast(`已粘贴 ${placed.length} 个节点`);
    return placed.map((node) => node.id);
  }, [rememberGraph, setNodes, setEdges, setSelectedNodeIds, setSaved, showToast]);

  const copySelectedNodes = useCallback(() => {
    const idSet = new Set(selectedNodeIds);
    if (!idSet.size) { showToast("请先选中节点再复制"); return; }
    nodeClipboardRef.current = cloneWorkflowNodes(nodes, edges, idSet);
    showToast(`已复制 ${nodeClipboardRef.current.nodes.length} 个节点`);
  }, [selectedNodeIds, nodes, edges, cloneWorkflowNodes, showToast]);

  const duplicateSelectedNodes = useCallback(() => {
    const idSet = new Set(selectedNodeIds);
    if (!idSet.size) { showToast("请先选中节点再复制"); return; }
    const cloned = cloneWorkflowNodes(nodes, edges, idSet);
    pasteClonedNodes(cloned, { x: 28, y: 28 });
  }, [selectedNodeIds, nodes, edges, cloneWorkflowNodes, pasteClonedNodes]);

  // ── 节点右键菜单（需求 1.3）────────────────────────────────────────────
  // 打开节点菜单：记录节点 id 与鼠标位置，副本要落在鼠标处
  const openNodeMenu = useCallback((event, node) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setEdgeMenu(null);
    setStickerMenuOpen(false);
    setNodeMenu({ id: node.id, x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY });
    setNodeRenameEditing(false);
    setNodeRenameDraft(node.data?.title || "");
  }, []);

  const closeNodeMenu = useCallback(() => {
    setNodeMenu(null);
    setNodeRenameEditing(false);
  }, []);

  // 复制节点：副本落在鼠标位置（需求 1.3 业务规则）
  const duplicateNodeAt = useCallback((nodeId, at) => {
    const source = nodes.find((node) => node.id === nodeId);
    if (!source) return;
    const cloned = cloneWorkflowNodes(nodes, edges, new Set([nodeId]));
    pasteClonedNodes(cloned, { x: 0, y: 0 }, at);
  }, [nodes, edges, cloneWorkflowNodes, pasteClonedNodes]);

  // 重命名节点标题：空名不更新（需求 1.3 异常流 3a）
  const renameNode = useCallback((nodeId, title) => {
    const next = String(title ?? "").trim();
    if (!next) { showToast("名称不能为空，已保持原名称"); return; }
    const target = nodes.find((node) => node.id === nodeId);
    if (!target || target.data?.title === next) return;
    rememberGraph();
    setNodes((items) => items.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, title: next } } : node)));
    setSaved(false);
    showToast("已重命名节点", 2000);
  }, [nodes, rememberGraph, setNodes, setSaved, showToast]);

  // 标签（需求 1.3）：固定四类——角色 / 场景 / 道具 / 参考
  const toggleNodeTag = useCallback((nodeId, tag) => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return;
    const current = Array.isArray(target.data?.tags) ? target.data.tags : [];
    const next = current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
    rememberGraph();
    setNodes((items) => items.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, tags: next } } : node)));
    setSaved(false);
  }, [nodes, rememberGraph, setNodes, setSaved]);

  // 保存为画布资产（需求 1.3）：节点配置快照落库，可在任意画布「添加节点 → 我的资产」复用。
  // 只保存参数与内部连线；运行产物 / runtime / savedAsset 标记一律剥离（canvasAssets.js）。
  // 成功才压一条撤销栈、才标未保存，批量保存也只压一条。
  const saveSelectionAsAssets = useCallback(async (ids) => {
    if (assetsBusy) return;
    const idSet = new Set(ids);
    const graph = buildAssetGraph(nodes, edges, idSet);
    const check = validateAssetGraph(graph);
    if (!check.ok) { showToast(check.error); return; }
    const name = dedupeAssetName(assetNameFor(graph.nodes), canvasAssets);
    setAssetsBusy(true);
    try {
      const asset = await saveCanvasAsset({ name, graph: check.graph });
      rememberGraph();
      setNodes((items) => items.map((node) => idSet.has(node.id) ? withSavedAsset(node, asset) : node));
      setSaved(false);
      setCanvasAssets((items) => [asset, ...items.filter((item) => item?.id !== asset?.id)]);
      showToast(`已保存 ${graph.nodes.length} 个节点为画布资产「${asset?.name || name}」，可在「添加节点 → 我的资产」复用`, 3600);
    } catch (error) {
      showToast(`保存失败：${error?.message || "请重试"}`);
    } finally {
      setAssetsBusy(false);
    }
  }, [assetsBusy, nodes, edges, canvasAssets, rememberGraph, setNodes, setSaved, showToast]);

  const saveNodeAsAsset = useCallback((nodeId) => saveSelectionAsAssets([nodeId]), [saveSelectionAsAssets]);

  // 从资产库插回画布：重新映射节点/连线 id，落在当前视口中心，保留资产内的相对布局。
  const insertCanvasAsset = useCallback(async (asset) => {
    if (assetsBusy) return;
    setAssetsBusy(true);
    try {
      const detail = await getCanvasAsset(asset.id);
      const check = validateAssetGraph(detail?.graph);
      if (!check.ok) { showToast(`资产「${asset.name}」已损坏：${check.error}`); return; }
      const cloned = cloneAssetGraph(check.graph, () => `node-${Date.now()}-${Math.round(Math.random() * 100000)}`);
      if (!cloned.nodes.length) { showToast("该资产没有可插入的节点"); return; }
      const rect = stageRef.current?.getBoundingClientRect();
      const base = flowInstance
        ? flowInstance.screenToFlowPosition({ x: (rect?.left || 0) + (rect?.width || 900) / 2, y: (rect?.top || 0) + (rect?.height || 700) / 2 })
        : { x: 320, y: 220 };
      const minX = Math.min(...cloned.nodes.map((node) => node.position.x));
      const minY = Math.min(...cloned.nodes.map((node) => node.position.y));
      const placed = cloned.nodes.map((node) => ({ ...node, position: { x: base.x + node.position.x - minX, y: base.y + node.position.y - minY }, selected: true }));
      rememberGraph();
      setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), ...placed]);
      setEdges((items) => [...items, ...cloned.edges]);
      setSelectedNodeIds(placed.map((node) => node.id));
      setSaved(false);
      setAddMenu(null);
      setContextMenu(null);
      showToast(`已插入画布资产「${asset.name}」（${placed.length} 个节点）`);
    } catch (error) {
      showToast(`插入失败：${error?.message || "请重试"}`);
    } finally {
      setAssetsBusy(false);
    }
  }, [assetsBusy, flowInstance, rememberGraph, setNodes, setEdges, setSelectedNodeIds, setSaved, showToast]);

  // 删除资产只动服务端清单，不改画布上已插入的节点；节点上的 savedAsset 标记也保留，
  // 菜单按资产清单实时判断是否仍「已保存」，避免删除操作牵连画布撤销栈。
  const removeCanvasAsset = useCallback(async (asset) => {
    if (assetsBusy) return;
    setAssetsBusy(true);
    try {
      await deleteCanvasAsset(asset.id);
      setCanvasAssets((items) => items.filter((item) => item.id !== asset.id));
      showToast(`已删除画布资产「${asset.name}」`);
    } catch (error) {
      showToast(`删除失败：${error?.message || "请重试"}`);
    } finally {
      setAssetsBusy(false);
    }
  }, [assetsBusy, showToast]);

  const pasteNodes = useCallback(() => {
    const clip = nodeClipboardRef.current;
    if (!clip || !clip.nodes.length) { showToast("剪贴板中没有可粘贴的节点"); return; }
    const rect = stageRef.current?.getBoundingClientRect();
    const base = flowInstance
      ? flowInstance.screenToFlowPosition({ x: (rect?.left || 0) + (rect?.width || 900) / 2, y: (rect?.top || 0) + (rect?.height || 700) / 2 })
      : { x: 320, y: 220 };
    pasteClonedNodes(clip, { x: 0, y: 0 }, base);
  }, [flowInstance, pasteClonedNodes]);

  const handlePaste = useCallback(() => {
    if (nodeClipboardRef.current && nodeClipboardRef.current.nodes.length) pasteNodes();
    else pasteToCanvas();
  }, [pasteNodes, pasteToCanvas]);

  const selectAll = useCallback(() => {
    const ids = nodes.filter((node) => node.type !== "groupFrame").map((node) => node.id);
    if (!ids.length) return;
    setNodes((items) => items.map((node) => ({ ...node, selected: node.type !== "groupFrame" })));
    setSelectedNodeIds(ids);
    showToast(`已全选 ${ids.length} 个节点`);
  }, [nodes, setNodes, setSelectedNodeIds, showToast]);

  const invertSelection = useCallback(() => {
    const current = new Set(selectedNodeIds);
    const nextIds = nodes.filter((node) => node.type !== "groupFrame" && !current.has(node.id)).map((node) => node.id);
    setNodes((items) => items.map((node) => ({ ...node, selected: node.type !== "groupFrame" && !current.has(node.id) })));
    setSelectedNodeIds(nextIds);
    showToast(`已反选，选中 ${nextIds.length} 个节点`);
  }, [selectedNodeIds, nodes, setNodes, setSelectedNodeIds, showToast]);

  // 导入：标准工作台 JSON 与 ComfyUI JSON 自动识别；校验失败不触碰当前画布
  async function importIntoCanvas(file) {
    if (!file) return;
    let parsed;
    try {
      const text = await file.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("无法读取该工作流：文件不是合法的 JSON");
      }
      parsed = parseWorkflowDocument(json);
    } catch (error) {
      setImportReport({ fileName: file.name, errors: [error.message || "无法读取该工作流"], warnings: [] });
      return;
    }
    if (!parsed.ok) {
      setImportReport({ fileName: file.name, errors: ["无法读取该工作流", ...parsed.errors], warnings: parsed.warnings });
      return;
    }
    rememberGraph();
    // 产物水合：导入文件里的 runtime.outputs 只有 storageKey（url 含过期 token，导出时剥离），
    // 重建出带 token 的可访问地址，图片/视频/成片导入后才能显示与播放。
    setNodes(parsed.graph.nodes.map((node) => (Array.isArray(node.data?.runtime?.outputs)
      ? { ...node, data: { ...node.data, runtime: { ...node.data.runtime, outputs: hydrateImportedOutputs(node.data.runtime.outputs) } } }
      : node)));
    setEdges(parsed.graph.edges);
    // 贴纸图层（需求 1.8）：导入文件里的 extensions.stickers 还原到画布图层
    if (Array.isArray(parsed.stickers) && parsed.stickers.length) setStickers(sanitizeStickers(parsed.stickers));
    setSaved(false);
    window.setTimeout(() => {
      if (parsed.viewport) flowInstance?.setViewport(parsed.viewport, { duration: 320 });
      else flowInstance?.fitView({ padding: 0.14, duration: 320 });
    }, 80);
    if (parsed.warnings.length) setImportReport({ fileName: file.name, errors: [], warnings: parsed.warnings });
    showToast(parsed.kind === "standard" ? "已导入工作流 JSON，可撤销" : "已导入 ComfyUI 工作流，可撤销", 2600);
  }

  const updateNodeField = useCallback((nodeId, fieldIndex, value) => {
    // 文本字段的连续输入同样由画布层的失焦会话统一压栈
    if (textEditRef.current) markEdited(); else rememberGraph();
    setNodes((items) => items.map((node) => node.id === nodeId ? {
      ...node,
      data: { ...node.data, fields: node.data.fields.map((field, index) => index === fieldIndex ? { ...field, value } : field) },
    } : node));
    setSaved(false);
  }, [markEdited, rememberGraph, setNodes]);

  // history: false 用于「调用方已在更早一步压过栈」的场景（参考素材增删、帧槽位写入），
  // 否则一次操作会留下两条历史，撤销要点两下才回到动手前。
  const updateNodeMedia = useCallback((nodeId, patch, { silent, history } = {}) => {
    // 文本编辑会话进行中（提示词输入）由失焦统一压一条，这里只标脏、不逐字压栈
    if (!silent && !textEditRef.current && history !== false) rememberGraph();
    if (!silent) markEdited();
    setNodes((items) => items.map((node) => {
      if (node.id !== nodeId) return node;
      const media = { ...node.data.media, ...patch };
      if (patch.durationSec !== undefined) media.duration = patch.durationSec;
      if (node.data.kind === "AudioGenerator" && patch.model !== undefined) {
        media.speechModel = patch.model;
      }
      return { ...node, data: {
        ...node.data,
        ...(node.data.kind === "ReferenceAudio" && patch.storageKey ? { assetKey: patch.storageKey, assetType: "AUDIO" } : {}),
        media,
      } };
    }));
    // silent：打开画布时按模型能力自动收敛取值的回写，不是用户编辑，不标“有未保存更改”
    if (!silent) setSaved(false);
  }, [markEdited, rememberGraph, setNodes]);

  // 顶层 data 补丁（ReferenceAsset / ReferenceText 等静态素材节点的 assetKey/preview/textContent 等字段在 data 顶层，不走 data.media）
  const updateNodeData = useCallback((nodeId, patch, { history = true } = {}) => {
    if (history) rememberGraph();
    setNodes((items) => items.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node));
    setSaved(false);
  }, [rememberGraph, setNodes, setSaved]);

  const selectOutput = useCallback((nodeId, index) => updateNodeMedia(nodeId, { selectedOutputIndex: index, outputIndex: index }), [updateNodeMedia]);

  // 批量删除：一次历史、一次节点过滤、一次连线过滤、一次选中集合过滤、一次 dirty、一次 toast。
  // idSet 为空直接返回，保证幂等（确认回调先清 pending 再调用，防双击重复删除）。
  const removeNodesByIds = useCallback((ids) => {
    const idSet = new Set(ids || []);
    if (!idSet.size) return;
    rememberGraph();
    setNodes((items) => items.filter((node) => !idSet.has(node.id)));
    setEdges((items) => items.filter((edge) => !idSet.has(edge.source) && !idSet.has(edge.target)));
    setSelectedNodeIds((current) => current.filter((id) => !idSet.has(id)));
    setSaved(false);
    showToast(idSet.size > 1 ? `已删除 ${idSet.size} 个节点，Ctrl+Z 可撤销` : "已删除节点，Ctrl+Z 可撤销");
  }, [rememberGraph, setNodes, setEdges, setSelectedNodeIds, setSaved, showToast]);

  // 保留单 id 包装，兼容其它调用点
  const removeNodeById = useCallback((nodeId) => removeNodesByIds([nodeId]), [removeNodesByIds]);

  // 取消 / 确认后把焦点还回画布，绝不掉回 body
  const focusAfterDeleteDialog = useCallback((source, triggerEl) => {
    const candidates = source === "button"
      ? [triggerEl, stageRef.current, helpButtonRef.current]
      : [stageRef.current, triggerEl, helpButtonRef.current];
    for (const element of candidates) {
      if (element && element.isConnected && typeof element.focus === "function") {
        element.focus({ preventScroll: true });
        return;
      }
    }
    document.querySelector('.canvas-dock button[aria-label="画布帮助"]')?.focus?.({ preventScroll: true });
  }, []);

  // 统一删除入口：D=可删数、L=锁定跳过数、E=关联边（两端都在集合内只算 1 条）
  const requestNodeDelete = useCallback((ids, source = "button", triggerEl = null) => {
    const unique = [...new Set((Array.isArray(ids) ? ids : [ids]).filter((id) => id != null && id !== ""))];
    if (!unique.length || nodeDeletePendingRef.current) return;
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const targets = unique.map((id) => nodeMap.get(id)).filter(Boolean);
    const deletable = targets.filter((node) => !node.data?.locked);
    const lockedCount = targets.length - deletable.length;
    const D = deletable.length;
    if (!D) { showToast("所选节点均已锁定，请先解锁"); return; }
    const idSet = new Set(deletable.map((node) => node.id));
    const E = edges.reduce((count, edge) => count + (idSet.has(edge.source) || idSet.has(edge.target) ? 1 : 0), 0);
    const first = deletable[0];
    const title = sanitizeDeleteTitle(first?.data?.title || first?.data?.kind || first?.id);
    const copy = nodeDeleteCopy({ count: D, edgeCount: E, lockedCount, title });

    // 与连线确认 / 返回守卫 / 各类浮层互斥；打开删除确认时全部清空
    setEdgeDeleteConfirm(null);
    setBackGuard(false);
    setContextMenu(null);
    setEdgeMenu(null);
    setAddMenu(null);
    setComfyMenuOpen(false);
    setTidyMenuOpen(false);
    setRunMenuOpen(false);

    nodeDeletePendingRef.current = idSet;
    nodeDeleteTriggerRef.current = source === "button" ? (triggerEl || document.activeElement) : null;
    setNodeDeleteConfirm({ ids: [...idSet], ...copy, source, deletableCount: D });
  }, [nodes, edges, showToast]);

  // 确认：先清 pending 再删（守卫防止双击重复删除）
  const confirmNodeDelete = useCallback(() => {
    const pending = nodeDeletePendingRef.current;
    const target = nodeDeleteConfirm;
    if (!pending || !pending.size || !target) return;
    const ids = [...pending];
    nodeDeletePendingRef.current = null;
    setNodeDeleteConfirm(null);
    const triggerEl = nodeDeleteTriggerRef.current;
    nodeDeleteTriggerRef.current = null;
    removeNodesByIds(ids);
    // 延后一拍：等弹层卸载 / mousedown 默认行为结束，避免焦点被随后清掉
    window.setTimeout(() => focusAfterDeleteDialog(target.source, triggerEl), 0);
  }, [nodeDeleteConfirm, removeNodesByIds, focusAfterDeleteDialog]);

  // 取消 / Esc / × / backdrop：拦截阶段未落地任何 change，故无需恢复状态
  const cancelNodeDelete = useCallback(() => {
    nodeDeletePendingRef.current = null;
    setNodeDeleteConfirm(null);
    const triggerEl = nodeDeleteTriggerRef.current;
    const source = nodeDeleteConfirm?.source;
    nodeDeleteTriggerRef.current = null;
    window.setTimeout(() => focusAfterDeleteDialog(source, triggerEl), 0);
  }, [nodeDeleteConfirm?.source, focusAfterDeleteDialog]);

  // 提示词 / 变量输入：入口只有文本输入框，历史由画布层的失焦会话统一压一条，这里只标脏
  const updatePrompt = useCallback((nodeId, patch) => {
    markEdited();
    setNodes((items) => items.map((node) => node.id === nodeId ? { ...node, data: {
      ...node.data,
      media: { ...node.data.media, ...patch },
      fields: patch.prompt === undefined ? node.data.fields : [{ label: "提示词", value: patch.prompt, multiline: true }, ...(node.data.fields || []).slice(1)],
    } } : node));
    setSaved(false);
  }, [markEdited, setNodes]);

  // 剪辑片段的启停 / 排序 / 裁剪区间：都是一次性操作，操作即一条历史
  const updateClips = useCallback((nodeId, clips) => {
    rememberGraph();
    setNodes((items) => items.map((node) => node.id === nodeId ? { ...node, data: {
      ...node.data,
      media: { ...node.data.media, clips },
      editing: { ...node.data.editing, clips },
    } } : node));
    setSaved(false);
  }, [rememberGraph, setNodes]);

  // 独立剪辑台草稿双写：每次草稿提交写回 timeline v2 + 扁平 clips[] + audioClips[]。
  // clips 供节点卡队列 / runGraph / 后端 compose（主视频轨拼接）；audioClips 供后端把音频轨混入成片（amix）。
  // 不进画布撤销栈：剪辑台内部有自己的 50 步栈，画布只需在「导出成片」时记一条。
  const updateEditingDraft = useCallback((nodeId, { timeline, clips, audioClips, importedSources = [], clipStyles = null, overlays = null }) => {
    setNodes((items) => items.map((node) => {
      if (node.id !== nodeId) return node;
      // importedSources 是剪辑台本地导入的素材清单，不在 graph.nodes 里，只能随草稿透传。
      // clipStyles / overlays（排期 #7）是成片烧录用的样式与叠加层，与 clips 同序：
      // 为 null 时必须**删掉旧字段**——只展开不覆盖会让上一次的字幕/调节残留，
      // 表现为「删了字幕，导出成片里还有字幕」。后端把 null 与缺省都当空列表，
      // toStep 都不写字段，step map 仍与旧版逐字节一致（运行指纹不漂移）。
      const editing = {
        ...node.data.editing,
        clips,
        audioClips,
        importedSources,
        timeline,
        resolution: `${timeline.aspect}@${timeline.quality}`,
      };
      if (clipStyles) editing.clipStyles = clipStyles; else delete editing.clipStyles;
      if (overlays) editing.overlays = overlays; else delete editing.overlays;
      return { ...node, data: {
        ...node.data,
        media: { ...node.data.media, clips, ratio: timeline.aspect, resolution: timeline.quality },
        editing,
      } };
    }));
    setSaved(false);
  }, [setNodes]);

  // 导出成片：画布记一条历史（Ctrl+Z 可整体回退本次导出），然后走既有单节点 run 通道。
  // runGraph 每次渲染新建，用 ref 承接最新闭包；草稿已在上一步的渲染里落地，不存在状态竞态。
  const commitEditingExport = useCallback(async (nodeId) => {
    rememberGraph();
    // 归一成 null：剪辑台据此区分「成功 / 失败 / 未启动」，undefined 不再被当成成功
    return (await runGraphRef.current?.(nodeId)) ?? null;
  }, [rememberGraph]);

  // 剪辑台「取消等待」：abort 掉该节点的运行控制器，轮询循环下一轮即退出。
  // runGraph 里 runKey 就是 onlyNode，所以直接用 nodeId 取控制器。
  const abortEditingExport = useCallback((nodeId) => {
    localRunRef.current.get(nodeId)?.controller?.abort();
  }, []);

  const getClips = useCallback((nodeId) => {
    const editing = nodes.find((node) => node.id === nodeId);
    const videoNodes = nodes.filter((node) => node.data?.kind === "VideoGenerator" && node.data?.runtime?.status === "SUCCEEDED");
    // 返回完整片段列表（含禁用项），由节点内部区分"展示"与"参与播放"
    return buildClipQueue(videoNodes, edges, editing?.data?.media?.clips || editing?.data?.editing?.clips || [], nodeId, nodes, { includeDisabled: true });
  }, [nodes, edges]);

  // 剪辑节点的上游视频源清单（需求 4.2.5.6）：沿连线收集全部上游视频生成节点（含失败/生成中/停用），
  // 供剪辑节点区分"未连线 / 等待生成 / 上游失败"等状态并给出可理解提示
  const getEditingSources = useCallback((nodeId) => {
    const ancestors = new Set();
    const queue = [nodeId];
    while (queue.length) {
      const current = queue.shift();
      for (const edge of edges) {
        if (edge.target !== current || ancestors.has(edge.source)) continue;
        ancestors.add(edge.source);
        queue.push(edge.source);
      }
    }
    return nodes
      .filter((node) => ancestors.has(node.id) && node.data?.kind === "VideoGenerator")
      .map((node) => ({ id: node.id, title: node.data?.title || node.id, status: node.data?.runtime?.status || "", enabled: node.data?.enabled !== false }));
  }, [nodes, edges]);

  // 剪辑台素材清单：上游「视频生成 + 音频生成」两类节点的可播放产物，带 mediaType 交给剪辑台分轨。
  // 与 getClips 分开：getClips 是视频剪辑节点的成片片段队列（只收视频），这里只用于素材面板拖拽。
  const getEditingSourceClips = useCallback((nodeId) => {
    const candidates = nodes.filter((node) => node.data?.kind === "VideoGenerator" || node.data?.kind === "AudioGenerator");
    return buildClipQueue(candidates, edges, [], nodeId, nodes, { kinds: ["VideoGenerator", "AudioGenerator"] });
  }, [nodes, edges]);

  // 节点锁定（需求 4.1.2.5）：锁定后画布层 draggable/deletable=false，仅保留选中与连线
  const toggleLock = useCallback((nodeId) => {
    rememberGraph();
    setNodes((items) => items.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, locked: !node.data?.locked } } : node));
    setSaved(false);
  }, [rememberGraph, setNodes, setSaved]);

  // 节点折叠（需求 4.1.2.6）：折叠后仅显示标题栏与端口
  const toggleCollapse = useCallback((nodeId) => {
    rememberGraph();
    setNodes((items) => items.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, collapsed: !node.data?.collapsed } } : node));
    setSaved(false);
  }, [rememberGraph, setNodes, setSaved]);

  const uploadAudio = useCallback(async (file) => {
    const validation = validateAssetFile(file);
    if (!validation.valid || validation.kind !== "audio") throw new Error(validation.message || "请选择音频文件");
    const asset = await uploadAsset(file);
    if (!asset?.storageKey) throw new Error("音频上传未返回存储地址");
    return { storageKey: asset.storageKey, url: asset.url || asset.src || mediaUrl(asset.storageKey), name: asset.name || file.name, duration: asset.durationMs ? asset.durationMs / 1000 : undefined };
  }, []);

  const generateNodeMedia = useCallback((nodeId, fallbackPreview) => {
    if (fallbackPreview) {
      setNodes((items) => items.map((node) => node.id === nodeId ? {
        ...node,
        data: { ...node.data, preview: node.data.preview || fallbackPreview },
      } : node));
      setSaved(false);
      showToast("生成任务已完成，结果已写入当前节点");
      return;
    }
    // 顶栏「运行方式」对单节点生成同样生效：选了「全部重新生成」时，
    // 节点卡片点生成也要带 forceRegenerate，否则上游仍按指纹复用、只有本节点重跑。
    return runGraph(nodeId, runMode);
  }, [nodes, edges, selectedModel, record, running, setNodes, showToast, runMode]);

  const getReferences = useCallback((targetId) => {
    const edgeRefs = edges
      .filter((edge) => edge.target === targetId && isVisualReferenceNode(nodes.find((node) => node.id === edge.source)))
      .map((edge) => {
        const source = nodes.find((node) => node.id === edge.source);
        const type = nodeOutputType(source);
        // 上游视频的时长：生成产物优先取运行结果的 metadata.durationSec，回落到节点设置的时长。
        // 「参考视频」模式按秒计费，估算需要它。
        const outputMeta = source?.data?.runtime?.outputs?.[0]?.metadata;
        const durationSec = Number(outputMeta?.durationSec)
          || Number(source?.data?.media?.duration)
          || Number(source?.data?.media?.durationSec)
          || 0;
        // 参考视频按它自己的分辨率档计价：上游产物 metadata 里的 resolution 最准，
        // 没跑过时用节点上选的档（后端用服务端记录折同一档，两边口径一致）
        const resolution = String(outputMeta?.resolution || source?.data?.media?.resolution || "");
        return {
          edgeId: edge.id,
          sourceId: edge.source,
          // 后端 planner 的 staticRef 只认 data.assetKey/storageKey（参考素材节点），生成节点输出走 dependsOn
          staticRef: Boolean(source?.data?.assetKey || source?.data?.storageKey),
          // 视频生成节点 → 视频生成节点：默认取上游视频尾帧（参考视频档无视频输入时作衔接参考图）；
          // 「参考视频」档且有整段视频透传时由后端按 videoRefMode 分流
          chainFrame: source?.data?.kind === "VideoGenerator",
          title: source?.data?.title || (type === "VIDEO" ? "视频参考" : type === "AUDIO" ? "音频参考" : "图像参考"),
          type,
          durationSec,
          resolution,
          preview: nodePosterUrl(source) || "",
          // 视频/音频没有封面图时用 <video>/<audio> 取首帧或播放，不能塞进 <img>
          src: nodePlaybackUrl(source) || "",
        };
      });
    // 素材库/本地上传直接附加的参考素材（media.referenceAssets，不经画布连线），
    // 排在连线引用之后；后端 planner 同序（静态引用块内先连线后直附）
    const target = nodes.find((node) => node.id === targetId);
    const directRefs = (Array.isArray(target?.data?.media?.referenceAssets) ? target.data.media.referenceAssets : [])
      .filter((item) => item?.storageKey && !String(item.storageKey).startsWith("blob:"))
      .map((item) => {
        const raw = String(item.type || "image").toLowerCase();
        const type = raw === "video" ? "VIDEO" : raw === "audio" ? "AUDIO" : "IMAGE";
        return {
          edgeId: `direct-${item.storageKey}`,
          sourceId: `direct:${item.storageKey}`,
          storageKey: item.storageKey,
          // 与连线的静态引用同等对待（后端 referenceAssets 也并入 staticRefs）
          staticRef: true,
          chainFrame: false,
          direct: true,
          title: item.title || (type === "VIDEO" ? "视频参考" : type === "AUDIO" ? "音频参考" : "图像参考"),
          type,
          durationSec: Number(item.durationSec) || 0,
          // 参考视频按自己的分辨率档计价：素材宽高折档（后端用同一套规则）
          resolution: "",
          width: Number(item.width) || 0,
          height: Number(item.height) || 0,
          // 预览每次用原始 key 重建（带当前 token），保存的图 JSON 里不落死 URL
          preview: item.posterKey ? mediaUrl(item.posterKey, { w: MEDIA_THUMB_WIDTH }) : "",
          src: mediaUrl(item.storageKey),
        };
      });
    return [...edgeRefs, ...directRefs];
  }, [edges, nodes]);

  const getPromptSupplements = useCallback((targetId) => edges
    .filter((edge) => edge.target === targetId && isTextPromptNode(nodes.find((node) => node.id === edge.source)))
    .map((edge) => {
      const source = nodes.find((node) => node.id === edge.source);
      return {
        edgeId: edge.id,
        sourceId: edge.source,
        title: source?.data?.title || "文本",
        text: nodeTextValue(source),
      };
    }), [edges, nodes]);

  const removeReference = useCallback((targetId, sourceId) => {
    // 直接附加在节点上的参考素材（不经连线）：sourceId 形如 direct:<storageKey>
    if (typeof sourceId === "string" && sourceId.startsWith("direct:")) {
      const storageKey = sourceId.slice(7);
      const target = nodes.find((node) => node.id === targetId);
      const list = Array.isArray(target?.data?.media?.referenceAssets) ? target.data.media.referenceAssets : [];
      if (list.some((item) => item?.storageKey === storageKey)) {
        rememberGraph();
        updateNodeMedia(targetId, { referenceAssets: list.filter((item) => item?.storageKey !== storageKey) }, { history: false });
        showToast("已移除参考素材");
      }
      return;
    }
    rememberGraph();
    const remainingEdges = edges.filter((edge) => !(edge.target === targetId && edge.source === sourceId));
    setEdges(remainingEdges);
    // 静态素材节点（图片/视频/音频/文本）在移除最后一条连线后一并删除，避免留下孤立节点
    const source = nodes.find((node) => node.id === sourceId);
    if (source && ["ReferenceAsset", "ReferenceAudio", "ReferenceText"].includes(source.data?.kind) && !remainingEdges.some((edge) => edge.source === sourceId)) {
      setNodes((items) => items.filter((node) => node.id !== sourceId));
    }
    setSaved(false);
    showToast("已移除连线");
  }, [nodes, edges, rememberGraph, setEdges, setNodes, setSaved, showToast, updateNodeMedia]);

  const referenceLimitMessage = useCallback((targetId, type, durationSec = 0) => {
    const limits = referenceLimitsOf(models, nodes.find((node) => node.id === targetId)?.data?.media);
    const usage = referenceUsageOf(getReferences(targetId));
    if (type === "IMAGE" && usage.IMAGE.count >= limits.IMAGE) {
      return `参考图已达上限 ${limits.IMAGE} 张`;
    }
    if (type === "AUDIO" && usage.AUDIO.count >= limits.AUDIO) {
      return `参考音频已达上限 ${limits.AUDIO} 段`;
    }
    if (type === "VIDEO") {
      const nextSeconds = usage.VIDEO.seconds + (Number(durationSec) || 0);
      if (usage.VIDEO.count >= limits.VIDEO) {
        return `参考视频已达上限 ${limits.VIDEO} 段`;
      }
      if (nextSeconds > limits.VIDEO_SECONDS) {
        return `参考视频总时长将超过 ${limits.VIDEO_SECONDS} 秒`;
      }
    }
    return "";
  }, [getReferences, models, nodes]);

  const attachReference = useCallback((targetId, sourceId) => {
    if (edges.some((edge) => edge.target === targetId && edge.source === sourceId)) return;
    const source = nodes.find((node) => node.id === sourceId);
    if (!source) return;
    const output = source.data?.outputs?.find((port) => ["IMAGE", "VIDEO"].includes(port.type)) || source.data?.outputs?.[0];
    const type = output?.type || source.data?.assetType || "IMAGE";
    const limitMessage = referenceLimitMessage(targetId, type, referenceDurationOf(source));
    if (limitMessage) {
      showToast(limitMessage);
      return;
    }
    rememberGraph();
    setEdges((items) => addEdge({
      id: `reference-${sourceId}-${targetId}-${Date.now()}`,
      source: sourceId,
      sourceHandle: "output",
      target: targetId,
      targetHandle: "input",
      type: "bezier",
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(type), width: 14, height: 14 },
      style: { stroke: edgeColor(type), strokeWidth: 2.2 },
    }, items));
    setSaved(false);
  }, [edges, nodes, referenceLimitMessage, rememberGraph, setEdges, showToast]);

  // 打开参考素材弹框。options.slot="first"/"last" 时是参考帧档的首/尾帧图框：
  // 弹框只列图片素材，选中直接写入 media.frames.{first,last}Key（不吃参考素材列表）。
  const openReferencePicker = useCallback((nodeId, options) => {
    setReferencePickerSlot(options?.slot || null);
    setReferencePickerNodeId(nodeId);
  }, []);

  // 关闭弹框：清掉目标节点与槽位，避免下次打开残留
  const closeReferencePicker = useCallback(() => {
    setReferencePickerNodeId(null);
    setReferencePickerSlot(null);
  }, []);

  // 帧槽位写入：把选中的图片存进 media.frames.{first,last}Key（显式首/尾帧图框）
  const setFrameSlot = useCallback((nodeId, slot, asset) => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target || !slot || !asset?.key) return;
    const frames = { ...(target.data?.media?.frames || {}) };
    if (slot === "first") {
      frames.firstKey = asset.key;
      frames.firstTitle = asset.title || "首帧";
    } else {
      frames.lastKey = asset.key;
      frames.lastTitle = asset.title || "尾帧";
    }
    rememberGraph();
    updateNodeMedia(nodeId, { frames }, { history: false });
    closeReferencePicker();
  }, [nodes, rememberGraph, updateNodeMedia, closeReferencePicker]);

  // 素材库/本地上传的参考素材：直接附加在节点 media.referenceAssets 上（显示为 + 号后面的缩略图 chip），
  // 不再落画布素材节点+连线；左侧输入点的连线留给画布节点之间的引用
  const addReferenceAsset = useCallback((targetId, asset) => {
    const target = nodes.find((node) => node.id === targetId);
    if (!target) return;
    // 图像节点只收图片参考：与节点 chip 过滤、后端 acceptRef 同口径，防止存入不可见/运行时被丢的引用
    if (asset.type === "VIDEO" && (target.data?.kind === "ImageGenerator" || target.data?.media?.type === "image")) {
      showToast("图像节点只能添加图片参考素材");
      return;
    }
    // 参考帧档只吃显式首/尾帧（media.frames），与参考素材互斥（对齐小云雀）
    const isVideoNode = target.data?.kind === "VideoGenerator" || target.data?.media?.type === "video";
    if (isVideoNode && normalizeWorkflowVideoMode(target.data?.media?.mode) === "参考帧") {
      showToast(`${workflowModeLabel("参考帧")}模式只使用首帧/尾帧图框，请先切回「${workflowModeLabel("参考视频")}」模式再添加参考素材`);
      return;
    }
    // 已存在同素材节点并已连到本节点：避免重复建节点
    const existing = nodes.find((node) => node.data?.assetKey === asset.key);
    if (existing && edges.some((edge) => edge.source === existing.id && edge.target === targetId)) {
      showToast("该素材已在参考列表中");
      return;
    }
    const limitMessage = referenceLimitMessage(targetId, asset.type, asset.durationSec);
    if (limitMessage) {
      showToast(limitMessage);
      return;
    }
    // A2：不再直挂 media.referenceAssets，改为「建静态素材节点 + 建连线」
    const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const base = target.position || { x: 0, y: 0 };
    const position = { x: base.x - 360, y: base.y + (Math.random() * 60 - 30) };
    const node = asset.type === "AUDIO"
      ? referenceAudioNode(id, position, { name: asset.title || "音频素材", url: asset.url, storageKey: asset.key })
      : asset.type === "TEXT"
        ? referenceTextNode(id, position, { key: asset.key, title: asset.title || "文本素材", url: asset.url, textContent: asset.textContent })
        : referenceAssetNode(id, position, {
          key: asset.key,
          title: asset.title || "素材",
          type: asset.type === "VIDEO" ? "VIDEO" : "IMAGE",
          preview: asset.preview || asset.url,
          url: asset.url,
          durationSec: asset.durationSec,
        });
    const refType = asset.type === "VIDEO" ? "VIDEO" : asset.type === "AUDIO" ? "AUDIO" : asset.type === "TEXT" ? "TEXT" : "IMAGE";
    const sourceTypes = (node.data?.outputs || []).map((port) => port.type).filter(Boolean);
    const targetTypes = (target.data?.inputs || []).map((port) => port.type).filter(Boolean);
    const connect = sourceTypes.length && targetTypes.length && sourceTypes.some((left) => targetTypes.some((right) => portTypesCompatible(left, right)));
    rememberGraph();
    setNodes((items) => [...items, node]);
    if (connect) {
      setEdges((items) => addEdge({
        id: `reference-${node.id}-${targetId}-${Date.now()}`,
        source: node.id,
        sourceHandle: "output",
        target: targetId,
        targetHandle: "input",
        type: "bezier",
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(refType), width: 14, height: 14 },
        style: { stroke: edgeColor(refType), strokeWidth: 2.2 },
      }, items));
    }
    setSaved(false);
    showToast(`已添加${asset.type === "VIDEO" ? "视频" : asset.type === "AUDIO" ? "音频" : asset.type === "TEXT" ? "文本" : "图片"}参考素材`);
  }, [nodes, edges, referenceLimitMessage, rememberGraph, setNodes, setEdges, setSaved, showToast]);

  const handleSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }) => {
    const nextIds = selectedNodes.map((node) => node.id);
    setSelectedNodeIds((currentIds) => currentIds.length === nextIds.length && currentIds.every((id, index) => id === nextIds[index]) ? currentIds : nextIds);
    if (nextIds.length < 2) setTidyMenuOpen(false);
    if (selectedEdges && !selectedEdges.length) setEdgeMenu(null);
  }, []);

  const fitOptions = useMemo(() => ({ padding: 0.13, nodes: focusNodes }), [focusNodes]);
  const edgeDefaults = useMemo(() => ({ type: "bezier", interactionWidth: 22, markerEnd: { type: MarkerType.ArrowClosed, color: "#7584ff", width: 14, height: 14 }, style: { stroke: "#7584ff", strokeWidth: 2.2 } }), []);
  const selectionKeys = useMemo(() => ["Shift", "Control", "Meta"], []);
  // 平移只挂中键：@xyflow v12 在 panOnDrag 数组含 2（右键）时会吞掉 contextmenu，
  // 右键要留给画布快捷菜单（onPaneContextMenu → openPaneMenu）
  const canvasPanButtons = useMemo(() => [1], []);

  const arrangementIds = useMemo(() => {
    const ids = new Set(selectedNodeIds);
    if (!includeConnected) return ids;
    let changed = true;
    while (changed) {
      changed = false;
      edges.forEach((edge) => {
        if (ids.has(edge.source) || ids.has(edge.target)) {
          if (!ids.has(edge.source)) { ids.add(edge.source); changed = true; }
          if (!ids.has(edge.target)) { ids.add(edge.target); changed = true; }
        }
      });
    }
    return ids;
  }, [selectedNodeIds, includeConnected, edges]);

  function arrangeSelection(mode) {
    const targets = nodes.filter((node) => arrangementIds.has(node.id) && node.type !== "groupFrame" && !node.parentId);
    if (targets.length < 2) return;
    rememberGraph();
    const ordered = [...targets].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    const anchorX = Math.min(...ordered.map((node) => node.position.x));
    const anchorY = Math.min(...ordered.map((node) => node.position.y));
    const maxWidth = Math.max(...ordered.map((node) => node.measured?.width || Number(node.style?.width) || 320));
    const maxHeight = Math.max(...ordered.map((node) => node.measured?.height || estimatedNodeHeight(node)));
    const columns = mode === "grid" ? Math.ceil(Math.sqrt(ordered.length)) : mode === "horizontal" ? ordered.length : 1;
    const nextPositions = new Map(ordered.map((node, index) => {
      const column = mode === "vertical" ? 0 : index % columns;
      const row = mode === "horizontal" ? 0 : Math.floor(index / columns);
      return [node.id, { x: anchorX + column * (maxWidth + 96), y: anchorY + row * (maxHeight + 96) }];
    }));
    setNodes((items) => items.map((node) => nextPositions.has(node.id) ? { ...node, position: nextPositions.get(node.id) } : node));
    setSaved(false);
    setTidyMenuOpen(false);
    showToast(mode === "grid" ? "已按网格整理节点" : mode === "horizontal" ? "已横向排列节点" : "已纵向排列节点");
  }

  function groupSelection() {
    const targets = nodes.filter((node) => selectedNodeIds.includes(node.id) && node.type !== "groupFrame" && !node.parentId);
    if (targets.length < 2) return;
    rememberGraph();
    const left = Math.min(...targets.map((node) => node.position.x));
    const top = Math.min(...targets.map((node) => node.position.y));
    const right = Math.max(...targets.map((node) => node.position.x + (node.measured?.width || Number(node.style?.width) || 320)));
    const bottom = Math.max(...targets.map((node) => node.position.y + (node.measured?.height || estimatedNodeHeight(node))));
    const groupId = `group-${Date.now()}`;
    const groupPosition = { x: left - 28, y: top - 52 };
    const groupNode = { id: groupId, type: "groupFrame", position: groupPosition, style: { width: right - left + 56, height: bottom - top + 80 }, data: { label: `组合 ${targets.length} 个节点` }, selectable: true, draggable: true, zIndex: -1 };
    const targetIds = new Set(targets.map((node) => node.id));
    setNodes((items) => [groupNode, ...items.map((node) => targetIds.has(node.id) ? { ...node, parentId: groupId, extent: "parent", position: { x: node.position.x - groupPosition.x, y: node.position.y - groupPosition.y }, selected: false } : node)]);
    setSelectedNodeIds([groupId]);
    setTidyMenuOpen(false);
    setSaved(false);
    showToast("所选节点已组合，可整体拖动");
  }

  const selectedGroupId = useMemo(() => selectedNodeIds.find((id) => {
    const node = nodes.find((item) => item.id === id);
    return node && node.type === "groupFrame";
  }), [selectedNodeIds, nodes]);

  const selectedGroupNode = useMemo(() => (selectedGroupId ? nodes.find((node) => node.id === selectedGroupId) || null : null), [selectedGroupId, nodes]);

  const ungroupSelection = useCallback(() => {
    if (!selectedGroupId) return;
    const id = selectedGroupId;
    rememberGraph();
    setNodes((items) => {
      const group = items.find((node) => node.id === id);
      if (!group) return items;
      const base = group.position;
      return items
        .filter((node) => node.id !== id)
        .map((node) => (node.parentId === id ? { ...node, parentId: undefined, extent: undefined, position: { x: base.x + node.position.x, y: base.y + node.position.y }, selected: true } : node));
    });
    setSelectedNodeIds((ids) => ids.filter((item) => item !== id));
    setSaved(false);
    showToast("已解散组合，节点回到画布");
  }, [selectedGroupId, rememberGraph, setNodes, setSelectedNodeIds, setSaved, showToast]);

  const renameGroup = useCallback((id, label) => {
    // 组合名称是文本输入，走失焦会话统一压栈
    markEdited();
    setNodes((items) => items.map((node) => (node.id === id ? { ...node, data: { ...node.data, label } } : node)));
    setSaved(false);
  }, [markEdited, setNodes, setSaved]);

  const setGroupColor = useCallback((color) => {
    if (!selectedGroupId) return;
    rememberGraph();
    setNodes((items) => items.map((node) => (node.id === selectedGroupId ? { ...node, data: { ...node.data, color } } : node)));
    setSaved(false);
    showToast("已更新组合颜色");
  }, [selectedGroupId, rememberGraph, setNodes, setSaved, showToast]);

  // 刷新产物（需求 4.2.5.9）：上游失败 / 产物缺失 / 媒体地址过期时，重新拉一次运行时快照，
  // 把节点 runtime.outputs 换成服务端最新地址（storageKey 会重新换算出带当前登录态的 URL）。
  // 只重拉状态、不动画布结构，因此不记历史、不标脏。
  const refreshRuntime = useCallback(async () => {
    const workflowId = Number(record?.id);
    if (!Number.isFinite(workflowId) || workflowId <= 0 || record.builtin) {
      showToast("当前画布还没有运行记录，请先运行一次");
      return false;
    }
    try {
      const snapshot = await getWorkflowRuntimeSnapshot(workflowId);
      setNodes((current) => applyWorkflowSnapshotToNodes(current, snapshot));
      showToast("已刷新产物", 1800);
      return true;
    } catch (error) {
      showToast(error.message || "刷新产物失败，请稍后重试", 2800);
      return false;
    }
  }, [record?.id, record?.builtin, setNodes, showToast]);

  const nodeEditApi = useMemo(() => ({
    updateField: updateNodeField,
    updateMedia: updateNodeMedia,
    updateData: updateNodeData,
    generateMedia: generateNodeMedia,
    notify: showToast,
    uploadAsset,
    getReferences,
    removeReference,
    openReferencePicker: openReferencePicker,
  }), [updateNodeField, updateNodeMedia, updateNodeData, generateNodeMedia, showToast, uploadAsset, getReferences, removeReference, openReferencePicker]);

  const workflowNodeApi = useMemo(() => ({
    getVariableScopes: (nodeId) => graphVariableScopes(nodes, edges, nodeId),
    updateMedia: updateNodeMedia,
    updatePrompt,
    updateClips,
    selectOutput,
    generateMedia: generateNodeMedia,
    execute: generateNodeMedia,
    notify: showToast,
    // NodeCardParts.jsx 保持 remove(id) 契约不变：按钮入口统一走二次确认，
    // triggerEl 取点击时焦点所在的删除按钮，取消后焦点原样还回。
    remove: (id) => requestNodeDelete([id], "button", document.activeElement),
    uploadAudio,
    getClips,
    getEditingSources,
    // 独立剪辑台入口（UC-AIGC-V1C20-007）
    openEditingSuite: setEditingSuiteNodeId,
    updateEditingDraft,
    commitEditingExport,
    toggleLock,
    toggleCollapse,
    getReferences,
    getPromptSupplements,
    removeReference,
    openReferencePicker: openReferencePicker,
    running,
    models,
    refreshRuntime,
    // 顶栏运行方式（reuse / regenerate）：节点卡片据此给出「生成 / 重新生成」文案与提示
    runMode,
  }), [nodes, edges, updateNodeMedia, updatePrompt, updateClips, updateEditingDraft, commitEditingExport, selectOutput, generateNodeMedia, showToast, requestNodeDelete, uploadAudio, getClips, getEditingSources, toggleLock, toggleCollapse, getReferences, getPromptSupplements, removeReference, openReferencePicker, running, models, refreshRuntime, runMode]);

  const canvasReferenceNodes = useMemo(() => nodes.filter((node) => node.id !== referencePickerNodeId && nodePreviewUrl(node) && node.data?.outputs?.some((port) => ["IMAGE", "VIDEO", "AUDIO"].includes(port.type))), [nodes, referencePickerNodeId]);  // 当前弹框目标节点已直接附加的参考素材 key（media.referenceAssets）
  const directReferenceKeys = useMemo(() => new Set((nodes.find((node) => node.id === referencePickerNodeId)?.data?.media?.referenceAssets || []).map((item) => item?.storageKey)), [nodes, referencePickerNodeId]);
  // 图像节点只收图片参考（节点 chip 与后端 acceptRef 同口径），视频节点图/视/音都可（音频按模型能力生效）
  const pickerTarget = nodes.find((node) => node.id === referencePickerNodeId);
  const pickerIsImageNode = pickerTarget?.data?.kind === "ImageGenerator" || pickerTarget?.data?.media?.type === "image";
  // 视频节点的档位：参考帧档只吃显式首/尾帧（media.frames），参考素材入口直接不弹；
  // 参考视频档允许 图片+视频+音频（对齐小云雀全模态参考）
  const pickerIsFramesMode = Boolean(pickerTarget) && !pickerIsImageNode
    && normalizeWorkflowVideoMode(pickerTarget?.data?.media?.mode) === "参考帧";
  const pickerAcceptsVideo = !pickerIsImageNode && !pickerIsFramesMode;
  const pickerAcceptsAudio = pickerAcceptsVideo;
  const pickerAssetOptions = useMemo(() => (referenceAssets || []).filter((asset) => {
    if (!pickerAcceptsVideo && asset.type === "VIDEO") return false;
    if (!pickerAcceptsAudio && asset.type === "AUDIO") return false;
    return true;
  }), [referenceAssets, pickerAcceptsVideo, pickerAcceptsAudio]);
  // 画布素材按档位过滤：图像节点只显示图片产出；视频参考帧档不弹 picker（上游由显式图框处理）
  const pickerCanvasNodes = useMemo(() => canvasReferenceNodes.filter((node) => {
    const type = node.data.assetType || node.data.outputs?.find((port) => ["IMAGE", "VIDEO", "AUDIO"].includes(port.type))?.type || "IMAGE";
    if (type === "AUDIO") return pickerAcceptsAudio;
    if (type === "VIDEO") return pickerAcceptsVideo;
    return true;
  }), [canvasReferenceNodes, pickerAcceptsVideo, pickerAcceptsAudio]);
  // 参考素材类型随档位收敛（与小云雀一致）：
  //   参考视频 —— 图片+视频(+音频) 混合参考（整段视频保留动作/运镜，图片定人物/风格，音频定节奏）
  //   参考帧 / 图像节点 —— 不弹参考素材选择器（首尾帧用显式图框，图像节点只收图片）

  // 帧槽位模式（首帧/尾帧）：弹框只列图片，选中直接写 media.frames，不进参考素材列表
  const pickerSlotLabel = referencePickerSlot === "first" ? "首帧" : referencePickerSlot === "last" ? "尾帧" : "";
  const currentFrameKey = referencePickerSlot === "first"
    ? (pickerTarget?.data?.media?.frames?.firstKey || "")
    : referencePickerSlot === "last" ? (pickerTarget?.data?.media?.frames?.lastKey || "") : "";
  const pickerUsage = useMemo(() => referenceUsageOf(referencePickerNodeId ? getReferences(referencePickerNodeId) : []), [getReferences, referencePickerNodeId]);
  const pickerLimits = useMemo(() => referenceLimitsOf(
    models,
    referencePickerNodeId ? nodes.find((node) => node.id === referencePickerNodeId)?.data?.media : null,
  ), [models, nodes, referencePickerNodeId]);
  const formatReferenceUsage = (type, limit) => `${pickerUsage[type].count}/${limit}${type === "VIDEO" ? ` 段 / ${pickerUsage.VIDEO.seconds}/${pickerLimits.VIDEO_SECONDS}s` : ""}`;
  const pickerQuotaText = pickerSlotLabel
    ? "仅支持图片素材"
    : pickerIsImageNode
      ? `已选参考图 ${formatReferenceUsage("IMAGE", pickerLimits.IMAGE)}`
      : pickerAcceptsVideo
        ? `已选 图 ${formatReferenceUsage("IMAGE", pickerLimits.IMAGE)} · 视频 ${formatReferenceUsage("VIDEO", pickerLimits.VIDEO)}${pickerAcceptsAudio ? ` · 音频 ${formatReferenceUsage("AUDIO", pickerLimits.AUDIO)}` : ""}`
        : "";
  // 帧槽位：素材库/本地上传只收图片
  const pickerFrameAssets = useMemo(() => (referenceAssets || []).filter((asset) => asset.type === "IMAGE"), [referenceAssets]);
  // 帧槽位实际展示的素材列表：帧模式只列图片，普通模式按档位收敛
  const pickerVisibleAssets = pickerSlotLabel ? pickerFrameAssets : pickerAssetOptions;

  // 弹框打开时拉真实素材库（我的素材），取图片/视频/音频；选中后经 addReferenceAsset 直接附加到节点
  useEffect(() => {
    if (!referencePickerNodeId) return undefined;
    let cancelled = false;
    setReferenceAssetsError("");
    fetchAssets()
      .then((items) => {
        if (cancelled) return;
        setReferenceAssets((items || [])
          .filter((item) => ["image", "video", "audio"].includes(item.kind || item.type))
          .map((item) => {
            const kind = item.kind || item.type;
            const isVideo = kind === "video";
            const isAudio = kind === "audio";
            const posterKey = item.posterKey || item.poster || "";
            // 后端对未出海报的视频会把 poster 记成视频本身，当海报用 <img> 会挂；这类直接渲染 <video> 取首帧
            const hasImagePoster = posterKey && !/\.(mp4|webm|mov|m4v)(\?|$)/i.test(posterKey);
            const src = mediaUrl(item.src || item.storageKey);
            const title = item.title || item.name || "未命名素材";
            return {
              key: item.storageKey,
              title,
              type: isVideo ? "VIDEO" : isAudio ? "AUDIO" : "IMAGE",
              // 原始海报 key 透传：附加到节点时只存 key，预览渲染时再重建带 token 的地址
              posterKey: hasImagePoster ? posterKey : "",
              preview: hasImagePoster ? mediaUrl(posterKey, { w: MEDIA_THUMB_WIDTH }) : "",
              url: src,
              durationSec: isVideo && Number(item.durationMs) > 0 ? Math.max(1, Math.round(Number(item.durationMs) / 1000)) : 0,
              // 参考视频按自己的分辨率档计价，宽高用于折档（后端用同一套规则）
              width: Number(item.width) || 0,
              height: Number(item.height) || 0,
              cover: { type: isVideo ? "video" : isAudio ? "audio" : "image", title, thumb: hasImagePoster ? mediaUrl(posterKey, { w: MEDIA_THUMB_WIDTH }) : "", src },
            };
          }));
      })
      .catch((error) => {
        if (cancelled) return;
        setReferenceAssets([]);
        setReferenceAssetsError(error.message || "素材库加载失败");
      });
    return () => { cancelled = true; };
  }, [referencePickerNodeId]);

  // 贴纸（需求 1.8）：独立可拖动的贴纸图层，不进画布节点、不参与连线与运行。
  // 坐标是画布（flow）坐标，与节点同一坐标系——贴纸随画布平移/缩放一起动。
  // 新贴纸落在当前视口中心附近，保证一加出来就看得见。
  const addSticker = useCallback((sticker) => {
    const id = `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const rect = stageRef.current?.getBoundingClientRect();
    const center = rect
      ? flowInstance?.screenToFlowPosition?.({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : null;
    const baseX = Number.isFinite(center?.x) ? center.x : 0;
    const baseY = Number.isFinite(center?.y) ? center.y : 0;
    setStickers((items) => [...items, {
      ...sticker,
      id,
      x: Math.round(baseX - 19 + (items.length % 6) * 34),
      y: Math.round(baseY - 19 + (items.length % 5) * 30),
    }]);
    showToast(`已添加贴纸「${sticker.label}」`);
  }, [flowInstance, showToast]);

  // 贴纸拖动：跟手移动，改动只落在贴纸图层，不写画布（不进撤销栈）
  const moveSticker = useCallback((id, x, y) => {
    setStickers((items) => items.map((item) => (item.id === id ? { ...item, x, y } : item)));
  }, []);

  const removeSticker = useCallback((id) => {
    setStickers((items) => items.filter((item) => item.id !== id));
  }, []);

  // 节点卡片里选的模型（按名字）→ 模型 id；目录里找不到返回 undefined
  function nodeModelIdOf(nodeId) {
    const node = nodes.find((item) => item.id === nodeId);
    const name = node?.data?.media?.model;
    if (!name) return undefined;
    const kind = node?.data?.kind;
    const category = node?.data?.media?.type
      || (kind === "AudioGenerator" ? "audio" : kind === "VideoGenerator" ? "video" : "image");
    const hit = (models || []).find((model) => model.name === name && model.category === category);
    if (!hit || hit.id == null) return undefined;
    const id = Number(hit.id);
    return Number.isFinite(id) && id > 0 ? id : undefined;
  }

  async function cancelActiveRun() {
    // 同一画布可能并存多个运行（例如两个视频节点各点了一次生成）：
    // 停止按钮需要把所有进行中的运行一起取消，而不是只停最后一个。
    //
    // 关键：要取消的是**后端 workflow_run.id**，不是本地登记用的 key（节点 id / "all"）。
    // 旧实现把 key 当 run id 用（Number(key) 恒为 NaN → 被 filter 掉 → 数组恒空），
    // 于是永远提示「没有正在运行的任务」，而且在 try 之前就 return，
    // 本地轮询控制器没被 abort，节点就一直卡在「生成中」。
    const { runIds, pending: pendingEntries, observed: observedIds } = collectCancelTargets(localRunRef.current, observedRunIdsRef.current);
    if (!runIds.length && !pendingEntries.length) {
      showToast("没有正在运行的任务", 2200);
      return;
    }
    // POST /runs 还没返回的运行：此时还不知道 run id，只能先记下停止意图。
    // 先记意图再发请求：否则「取消请求在飞」的这段时间里 run 建好，
    // onStart 触发时还看不到意图，后端会留下一条没人管的运行。
    pendingEntries.forEach(([, entry]) => { if (entry) entry.stopRequested = true; });
    const cancelledRuns = [];
    const cancelled = new Set();
    const failed = new Set();
    try {
      // 先让后端收敛运行状态，再停本地轮询：反过来先 abort，轮询拿不到 CANCELLED 终态，
      // 节点卡片会一直停在「生成中」，且停止失败时前端已无法感知后端仍在跑
      for (const runId of runIds) {
        const observed = observedIds.includes(runId);
        try {
          const run = await cancelWorkflowRun(runId);
          cancelled.add(runId);
          if (run?.steps) cancelledRuns.push(run);
        } catch (error) {
          failed.add(runId);
          // 观察到的运行多半已经自己收敛了，失败就静默跳过，不要用「停止失败」吓人
          if (!observed) showToast(error.message || `运行 ${runId} 停止失败`, 3000);
        }
      }
      // 取消请求在飞的这段时间里，POST /runs 可能刚好返回、run id 才拿到：补一次取消。
      // stopRequested 的由 onStart 负责取消（那里拿得到准确的 run id），不重复发。
      localRunRef.current.forEach((entry) => {
        const runId = Number(entry?.runId);
        if (!Number.isFinite(runId) || runId <= 0 || cancelled.has(runId) || entry?.stopRequested) return;
        cancelled.add(runId);
        cancelWorkflowRun(runId)
          .then((cancelledRun) => { if (cancelledRun?.steps) applyRunToCurrentNodes(setNodes, cancelledRun); })
          .catch(() => {});
      });
      showToast(cancelled.size > 1 ? `已停止 ${cancelled.size} 个任务` : "已停止运行", 2400);
    } finally {
      // 只停「确认已取消」的本地轮询：取消失败的运行继续轮询，
      // 否则后端还在跑、前端却不再更新，节点会永远卡在「生成中」。
      localRunRef.current.forEach((entry, key) => {
        const runId = Number(entry?.runId);
        if (Number.isFinite(runId) && failed.has(runId)) return;
        entry?.controller?.abort();
        localRunRef.current.delete(key);
      });
      // 快照恢复的轮询与运行轮询是两条独立的循环：只停运行时轮询时，
      // 恢复轮询仍会按 activeRuns 每 4 秒把节点刷回「生成中」，表现为「停止后几秒又开始生成」。
      if (!failed.size) restoreAbortRef.current?.abort();
      cancelledRuns.forEach((run) => applyRunToCurrentNodes(setNodes, run));
      observedRunIdsRef.current.clear();
      setRunning(localRunRef.current.size > 0);
    }
  }

  // 未落库画布（新建 / 导入 / 模板）点生成时先落库一条工作流，返回 { id, first }。
  // first 表示本次是发起者，负责回写 record / saved / toast；并行点多个节点生成时
  // 后续调用复用同一个 Promise，避免建出多条一模一样的工作流。
  function ensureOwnedWorkflow(body) {
    if (autoSavedWorkflowIdRef.current) return Promise.resolve({ id: autoSavedWorkflowIdRef.current, first: false });
    if (!autoSavePromiseRef.current) {
      autoSavePromiseRef.current = createWorkflowRecord(body)
        .then((created) => {
          const id = Number(created?.id);
          if (!Number.isFinite(id) || id <= 0) throw new Error("自动保存工作流失败，请手动保存后再生成");
          autoSavedWorkflowIdRef.current = id;
          skipRestoreIdRef.current = id;
          // 回写 record：后续「保存」走更新而不是再建一条；返回拦截也能识别为已入库、不再弹未保存框
          onRecordChange?.(toWorkflowCard(created));
          setSaved(true);
          showToast("画布已自动保存，生成结果刷新后可回显", 2800);
          return created;
        })
        .finally(() => { autoSavePromiseRef.current = null; });
      return autoSavePromiseRef.current.then((created) => ({ id: Number(created.id), first: true }));
    }
    return autoSavePromiseRef.current.then((created) => ({ id: Number(created.id), first: false }));
  }

  async function runGraph(nodeId, mode) {
    const onlyNode = typeof nodeId === "string" ? nodeId : undefined;
    const forceRegenerate = mode === "regenerate";
    // 单节点运行优先用节点自己选的模型（后端 resolveModel 也会按节点模型名解析，
    // 这里的 modelId 只是兜底），否则退回工具条上选的运行模型。
    // 剪辑节点例外：EDIT 步骤不需要模型（上游生成节点各自带模型），modelId 缺省也要放行，
    // 否则节点上的「合成成片」会被"请先选择运行模型"误拦。
    const editingOnly = onlyNode ? nodes.find((item) => item.id === onlyNode)?.data?.kind === "VideoEditing" : false;
    const nodeModelId = onlyNode && !editingOnly ? nodeModelIdOf(onlyNode) : undefined;
    const modelId = nodeModelId || Number(selectedModel);
    if (!modelId && !editingOnly) {
      showToast(onlyNode ? "该节点没有可用模型，请在卡片里选一个模型" : "请先选择运行模型", 2800);
      return;
    }
    // 参考帧（i2v）校验：没有任何首帧来源时后端会降级成参考生视频，运行前先拦住（单节点与整图运行都查）。
    // 首帧来源 = 显式图框（media.frames.firstKey），或连入的图片 / 上游视频生成节点（取其尾帧）；尾帧可选
    const framesTargets = onlyNode
      ? nodes.filter((node) => node.id === onlyNode)
      : nodes.filter((node) => node.data?.enabled !== false);
    const framesMissing = framesTargets.filter((node) => {
      const isVideoNode = node.data?.kind === "VideoGenerator" || node.data?.media?.type === "video";
      if (!isVideoNode || normalizeWorkflowVideoMode(node.data?.media?.mode) !== "参考帧") return false;
      if (node.data?.media?.frames?.firstKey) return false;
      return !getReferences(node.id).some((reference) => reference.type === "IMAGE" || reference.chainFrame);
    });
    // 整图运行不因单个节点缺首帧而全盘落空：跳过这些节点及其下游，其余照跑；
    // 单节点运行仍硬拦（用户就是要点它，必须先补首帧，否则后端会静默降级成参考生视频）。
    const skippedIds = new Set();
    if (framesMissing.length) {
      if (onlyNode) {
        showToast(`「${framesMissing[0].data?.title || "视频节点"}」为参考帧模式，请设置首帧图（图框选图或连接图片/上游视频取其尾帧）`, 3600);
        return;
      }
      framesMissing.forEach((node) => skippedIds.add(node.id));
      // 被跳过节点的下游一并跳过：它们可能依赖被跳过节点的产物，否则会以 BLOCKED 收场
      let grew = true;
      while (grew) {
        grew = false;
        edges.forEach((edge) => {
          if (skippedIds.has(edge.source) && !skippedIds.has(edge.target)) {
            skippedIds.add(edge.target);
            grew = true;
          }
        });
      }
      const names = [...skippedIds].map((id) => nodes.find((node) => node.id === id)?.data?.title || id);
      showToast(`已跳过 ${skippedIds.size} 个节点（参考帧模式缺少首帧）：${names.join("、")}`, 4000);
    }
    const controller = new AbortController();
    // 以「本次运行的目标节点」为键登记控制器：不同节点可并存，
    // 同一节点重复点击则替换旧控制器（旧运行随之被 abort，避免同一节点两个任务打架）。
    const runKey = onlyNode || "all";
    localRunRef.current.get(runKey)?.controller?.abort();
    // runId 先留空：后端 run 建好（onStart）后才填上，「停止」按它调 cancel。
    // stopRequested：用户在 POST /runs 返回前就点了停止 → run 建好后补一次 cancel。
    // entry 用闭包持有（不靠 map 反查）：「停止」会清空 map，那时 run 可能才刚建好。
    const runEntry = { controller, runId: null, stopRequested: false };
    localRunRef.current.set(runKey, runEntry);
    setRunning(true);
    setRunProgress(0);
    setRunMenuOpen(false);
    setRunTotal(onlyNode
      ? 1
      : nodes.filter((node) => isWorkStep(node) && !skippedIds.has(node.id)).length);
    try {
      const nextNodes = nodes.map((node) => {
        if (node.data?.kind !== "VideoEditing") return node;
        const videos = nodes.filter((candidate) => candidate.data?.kind === "VideoGenerator" && candidate.data?.runtime?.status === "SUCCEEDED");
        const queue = buildClipQueue(videos, edges, node.data?.media?.clips || node.data?.editing?.clips || [], node.id, nodes);
        const clips = queue.map((clip, order) => ({ sourceNodeId: clip.sourceNodeId, outputIndex: clip.outputIndex, order, trimStart: clip.trimStart, trimEnd: clip.trimEnd, muted: Boolean(clip.muted), volume: clip.volume, enabled: clip.enabled !== false }));
        return { ...node, data: { ...node.data, media: { ...node.data.media, clips }, editing: { ...node.data.editing, clips } } };
      });
      const nextEditing = new Map(nextNodes.filter((node) => node.data?.kind === "VideoEditing").map((node) => [node.id, node.data.editing]));
      setNodes((current) => current.map((node) => nextEditing.has(node.id) ? { ...node, data: {
        ...node.data,
        media: { ...node.data.media, clips: nextEditing.get(node.id).clips },
        editing: { ...node.data.editing, clips: nextEditing.get(node.id).clips },
      } } : node));
      const graph = persistableGraph(nextNodes, edges);
      // 提交用的图：被跳过的节点置 enabled=false（后端规划阶段直接忽略），落库仍用上面的原图
      const requestGraph = skippedIds.size
        ? persistableGraph(nextNodes.map((node) => (skippedIds.has(node.id) ? { ...node, data: { ...node.data, enabled: false } } : node)), edges)
        : graph;
      const numericId = Number(record.id);
      let ownedId = Number.isFinite(numericId) && numericId > 0 && !record.builtin
        ? numericId
        : autoSavedWorkflowIdRef.current || undefined;
      const body = {
        title: record.title || "未命名工作流",
        description: record.description || "",
        type: ["image", "video", "audio", "import", "template"].includes(record.type) ? record.type : "image",
        modelId,
        origin: record.origin || "高级工作台",
        demoKey: record.demo,
        sourcePath: record.source,
        // 落库用带视口的副本；运行请求的 graph 仍是纯 {nodes,edges}，不干扰后端规划
        graph: graphWithViewport(graph, flowInstance?.getViewport?.()),
      };
      // 未落库画布（新建 / 导入 / 模板）直接点生成时，先自动创建工作流再提交运行。
      // 否则 workflow_run.workflow_id 会是 NULL：刷新后 /api/workflows/{id}/runtime 按 workflow_id
      // 查不到这次运行，产物不回显；之后手动保存也不会回填已落库的 run；下次运行查不到历史可复用，
      // 会重新生成一遍并重复扣积分。
      let autoSaved = false;
      if (ownedId == null) {
        const ensured = await ensureOwnedWorkflow(body);
        ownedId = ensured.id;
        autoSaved = ensured.first;
      }
      const started = Date.now();
      const latest = await executeWorkflowRun({
        // 现在所有运行都带 workflowId，复用走后端的 ownedHistory(workflowId)，不再需要 previousRunId 链
        graph, requestGraph, workflowId: ownedId, modelId, nodeId: onlyNode, forceRegenerate, signal: controller.signal,
        // 刚 create 过就不必再 PUT 一次（body 里已是同一份运行前画布）
        save: autoSaved ? () => Promise.resolve() : (id) => updateWorkflowRecord(id, body),
        start: startWorkflowRun,
        get: (id, { signal }) => getWorkflowRun(id, { signal }),
        wait: (signal) => {
          if (Date.now() - started > 25 * 60 * 1000) throw new Error("工作流仍在运行，可稍后在我的创作查看结果");
          return waitForWorkflowPoll(signal);
        },
        onStart: (run) => {
          // 后端 run 已建好：登记真实 run id，「停止」才能按它调 cancel。
          const runId = Number(run?.id);
          if (!Number.isFinite(runId) || runId <= 0) return;
          runEntry.runId = runId;
          // 用户在 POST /runs 返回前就点了停止：现在补一次取消，
          // 否则后端留一条没人管的运行，节点会永远停在「生成中」。
          if (runEntry.stopRequested) {
            cancelWorkflowRun(runId)
              .then((cancelled) => { if (cancelled?.steps) applyRunToCurrentNodes(setNodes, cancelled); })
              .catch(() => {});
          }
        },
        onRun: (run) => {
          (run.steps || []).filter((step) => ["FAILED", "BLOCKED", "SKIPPED"].includes(step.status)).forEach((step) => {
            const key = `${run.id}:${step.nodeId}`;
            if (notifiedFailuresRef.current.has(key)) return;
            notifiedFailuresRef.current.add(key);
            // 点名被跳过的节点（需求 4.6.4.2）：与失败/阻塞区分开，说明是前置条件不满足
            const fallbackText = step.status === "SKIPPED" ? "前置条件不满足，已跳过" : step.status === "BLOCKED" ? "上游节点未成功" : "生成失败";
            showToast(`「${step.title || step.nodeId}」${step.errorMessage || fallbackText}`, 3600);
          });
          applyRunToCurrentNodes(setNodes, run);
          setRunProgress(run.progress || 0);
          setRunTotal(run.total || 1);
        },
      });
      // 把终态返回给调用方：剪辑台「导出成片」据此区分成功 / 失败 / 取消，
      // 不能再像以前那样无论成败都弹「导出完成」。
      if (controller.signal.aborted || !latest) return null;
      // 复用了多少个节点的历史产物：说清楚「为什么这次几乎没花积分」，避免用户以为点了没反应
      const reusedCount = (latest.steps || []).filter((step) => step.reused).length;
      if (latest.status === "CANCELLED") {
        // 已取消：不弹失败类提示
      } else if (latest.status === "SUCCEEDED") {
        showToast(onlyNode ? "节点已生成" : reusedCount ? `工作流运行完成，复用了 ${reusedCount} 个节点的已有结果` : "工作流运行完成", 3200);
      } else if (latest.status === "PARTIAL_FAILED") showToast("部分节点失败，已保留成功结果", 3600);
      else showToast(latest.errorMessage || "工作流运行失败", 3600);
      return latest;
    } catch (error) {
      if (!controller.signal.aborted) showToast(error.message || "工作流运行失败", 3600);
      return null;
    } finally {
      // 只清理自己这一条：其它节点发起的运行可能仍在跑，不能一并抹掉
      if (localRunRef.current.get(runKey)?.controller === controller) localRunRef.current.delete(runKey);
      setRunning(localRunRef.current.size > 0);
    }
  }

  // 剪辑台导出要用「当下渲染」的 nodes（含刚写回的草稿）；ref 承接最新 runGraph 闭包
  const runGraphRef = useRef(null);
  useEffect(() => { runGraphRef.current = runGraph; });

  function exportWorkflowFile() {
    try {
      const viewport = flowInstance?.getViewport?.();
      const document_ = serializeWorkflow(nodes, edges, {
        viewport: viewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : undefined,
        title: record.title || "未命名工作流",
        description: record.description || "",
        // 贴纸图层随文件导出（需求 1.8），导入端按同一字段还原
        stickers: sanitizeStickers(stickers),
      });
      downloadWorkflowDocument(document_, exportFileName(record.title || "未命名工作流"));
      showToast("已导出工作流 JSON", 2200);
    } catch (error) {
      showToast(error.message || "导出失败", 2800);
    }
  }

  // 智能排版：对当前画布（或选中子图）做 DAG 分层，环状结构不排版并高亮环路（TC-008）
  function autoArrangeCanvas() {
    setCycleHighlight(null);
    window.clearTimeout(cycleHighlightTimer.current);
    const useSubgraph = selectedNodeIds.length >= 2;
    const scope = useSubgraph
      ? nodes.filter((node) => arrangementIds.has(node.id) && node.type !== "groupFrame")
      : nodes;
    if (!scope.length) {
      showToast("画布上没有可整理的节点");
      return;
    }
    const scopeIds = new Set(scope.map((node) => node.id));
    const scopeEdges = edges.filter((edge) => scopeIds.has(edge.source) && scopeIds.has(edge.target));
    const result = autoArrange(scope, scopeEdges);
    if (result.cycleIds.length) {
      const names = result.cycleIds.map((id) => scope.find((node) => node.id === id)?.data?.title || id);
      showToast(`检测到环状连线，无法自动排版：${names.join("、")}`, 4200);
      // 环路高亮是瞬态视觉反馈：只影响渲染，不进撤销栈、不进持久化 graph
      setCycleHighlight({ nodeIds: new Set(result.cycleIds), edgeIds: new Set(result.cycleEdgeIds || []) });
      cycleHighlightTimer.current = window.setTimeout(() => setCycleHighlight(null), 5200);
      window.setTimeout(() => flowInstance?.fitView({ nodes: result.cycleIds.map((id) => ({ id })), padding: 0.3, duration: 320 }), 60);
      return;
    }
    rememberGraph();
    setNodes((items) => items.map((node) => {
      const position = result.positions[node.id];
      return position ? { ...node, position } : node;
    }));
    setSaved(false);
    setTidyMenuOpen(false);
    window.setTimeout(() => flowInstance?.fitView({ padding: 0.14, duration: 320 }), 80);
    showToast(useSubgraph ? "已按连线自动规整所选节点" : "已按连线自动规整画布", 2400);
  }

  async function saveWorkflow() {
    const modelId = Number(selectedModel);
    // 视口随画布一起落库，下次打开 / 刷新还原（需求 4.1.1.6）
    const graph = graphWithViewport(persistableGraph(nodes, edges), flowInstance?.getViewport?.());
    // 贴纸图层随画布落库（需求 1.8）：只存展示字段，坐标钳为有限数
    const savedStickers = sanitizeStickers(stickers);
    const body = {
      title: record.title || "未命名工作流",
      description: record.description || "",
      type: ["image", "video", "audio", "import", "template"].includes(record.type) ? record.type : "image",
      modelId: modelId || null,
      origin: record.origin || "高级工作台",
      demoKey: record.demo,
      sourcePath: record.source,
      graph: savedStickers.length ? { ...graph, stickers: savedStickers } : graph,
    };
    try {
      const numericId = Number(record.id);
      const owned = Number.isFinite(numericId) && numericId > 0 && !record.builtin;
      const saved = owned ? await updateWorkflowRecord(numericId, body) : await createWorkflowRecord(body);
      onRecordChange?.(toWorkflowCard(saved));
      setSaved(true);
      showToast("工作流已保存", 2200);
      return true;
    } catch (error) {
      showToast(error.message || "保存失败", 2800);
      return false;
    }
  }

  // 记录是否已在库里：已落库的（数字 id）返回后仍在；新建/导入/模板草稿不在
  const ownedId = Number(record.id);
  const owned = Number.isFinite(ownedId) && ownedId > 0 && !record.builtin;
  const inLibrary = owned || Boolean(record.builtin);
  const dirty = !saved;

  // ── 编辑自动保存（需求 1.2：系统自动保存工作流的节点与连线更改）─────────
  // 只对「已落库」的工作流生效：脏状态出现后防抖 2.5s 静默落库。
  // 草稿（未落库的空白/导入画布）不自动建记录——避免打开画布随手拖一下就多出一条记录，
  // 草稿的首次落库仍由「点生成」触发（原行为不变）。
  // 与既有机制的协同：
  // - 撤销栈（rememberGraph）只管内存快照，不触碰 saved 状态，二者无冲突；
  // - 快照恢复只回填节点数据、不置脏，不会误触发本定时器；
  // - 手动保存/Ctrl+S 成功后 saved=true，pending 的定时器在触发时自查脏态后自然跳过；
  // - 保存前 graph 由 persistableWorkflowGraph 剥离运行态，运行中的轮询回写不受影响。
  const autoSaveTimerRef = useRef(null);
  const autoSaveStateRef = useRef(null);
  useEffect(() => { autoSaveStateRef.current = { save: saveWorkflow, owned, dirty }; });
  useEffect(() => {
    if (!owned || !dirty) {
      window.clearTimeout(autoSaveTimerRef.current);
      return undefined;
    }
    autoSaveTimerRef.current = window.setTimeout(async () => {
      const state = autoSaveStateRef.current;
      if (!state?.owned || !state?.dirty) return;
      try {
        await state.save();
      } catch { /* saveWorkflow 内部已提示 */ }
    }, 2500);
    return () => window.clearTimeout(autoSaveTimerRef.current);
    // record.id：切换/新建画布时重挂定时器；dirty：脏态沿触发调度
  }, [owned, dirty, record.id]);

  function requestBack() {
    // 删除确认与 backGuard 互斥：先从删除确认退出，再决定返回行为
    nodeDeletePendingRef.current = null;
    nodeDeleteTriggerRef.current = null;
    setNodeDeleteConfirm(null);
    if (inLibrary && !dirty) onBack();
    else setBackGuard(true);
  }

  // 保存成功才返回；失败留在画布，原因由保存 toast 提示
  async function saveAndBack() {
    setSavingBack(true);
    const ok = await saveWorkflow();
    setSavingBack(false);
    if (ok) onBack();
  }

  function paintZoom(zoom) {
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round((Number(zoom) || 1) * 100)}%`;
  }

  function openPaneMenu(event) {
    event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    const x = Math.max(10, Math.min(event.clientX - (rect?.left || 0), (rect?.width || 900) - 226));
    const y = Math.max(10, Math.min(event.clientY - (rect?.top || 0), (rect?.height || 700) - 250));
    setAddMenu(null);
    setComfyMenuOpen(false);
    setContextMenu({ x, y, clientX: event.clientX, clientY: event.clientY });
  }

  function deleteEdge(edge) {
    rememberGraph();
    setEdges((items) => items.filter((item) => item.id !== edge.id));
    setSaved(false);
  }

  function handleEdgeClick(event, edge) {
    const rect = stageRef.current?.getBoundingClientRect();
    setEdgeMenu({
      edge,
      x: Math.max(8, Math.min(event.clientX - (rect?.left || 0) + 14, (rect?.width || 900) - 42)),
      y: Math.max(8, Math.min(event.clientY - (rect?.top || 0) - 34, (rect?.height || 700) - 42)),
    });
  }

  // 快捷键里要调保存，但 saveWorkflow 每次渲染都是新函数；用 ref 承接，
  // 避免把 keydown 监听从「依赖稳定」变成「每次渲染重挂一次」。
  const saveWorkflowRef = useRef(saveWorkflow);
  useEffect(() => { saveWorkflowRef.current = saveWorkflow; });

  useEffect(() => {
    const onKeyDown = (event) => {
      // 独立剪辑台打开时冻结全部画布快捷键（剪辑台自身在 capture 阶段接管键盘域）
      if (editingSuiteNodeId) return;
      // 删除确认打开期间冻结画布快捷键：Escape 交给 ConfirmDialog 自身（内部 stopPropagation），
      // 其余（Delete/Ctrl+Z/A/C/D/V）一律早退，不穿透、不弹第二个框。
      if (nodeDeleteConfirm) {
        if (event.key === "Escape") return;
        event.stopPropagation();
        return;
      }
      // Ctrl+S 保存要放在「输入框内早退」之前：用户常常正在写提示词就按保存，
      // 一律早退会让这个组合键在画布里完全失效。
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveWorkflowRef.current?.();
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
      // 选中节点全部锁定时 React Flow 不会发出任何 remove change，
      // 这里补一次统一入口，命中 D=0 分支只提示、不弹框。
      if ((event.key === "Delete" || event.key === "Backspace")) {
        const selected = nodes.filter((node) => node.selected);
        if (selected.length && selected.every((node) => node.data?.locked)) {
          event.preventDefault();
          requestNodeDelete(selected.map((node) => node.id), "keyboard", null);
          return;
        }
      }
      if (event.key === "Escape") { setAddMenu(null); setContextMenu(null); setComfyMenuOpen(false); setEdgeMenu(null); setStickerMenuOpen(false); setNodeMenu(null); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redoGraph() : undoGraph(); }
      // Ctrl+Y 是 Windows 习惯的重做别名（与 Ctrl+Shift+Z 等价）
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "y") { event.preventDefault(); redoGraph(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { event.preventDefault(); handlePaste(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); copySelectedNodes(); }
      // Ctrl+X 剪切：先把节点写进剪贴板，再走统一删除入口（删除仍要二次确认，取消则剪贴板里留一份拷贝，无损）
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
        event.preventDefault();
        if (!selectedNodeIds.length) { showToast("请先选中节点再剪切"); return; }
        const ids = [...new Set(selectedNodeIds)];
        nodeClipboardRef.current = cloneWorkflowNodes(nodes, edges, new Set(ids));
        requestNodeDelete(ids, "keyboard", null);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelectedNodes(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selectAll(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingSuiteNodeId, nodeDeleteConfirm, nodes, edges, selectedNodeIds, showToast, requestNodeDelete, undoGraph, redoGraph, handlePaste, copySelectedNodes, duplicateSelectedNodes, selectAll, cloneWorkflowNodes]);

  return (
    <div className="studio-layout studio-layout--editor">
      <section ref={stageRef} tabIndex={-1} className="flow-stage flow-stage--minimax"
        // 节点内的文本输入（提示词/变量/裁剪秒数）统一在画布层兜住焦点进出，
        // 不必逐个输入框挂 onFocus/onBlur；React 的 focus/blur 是合成的 focusin/focusout，会冒泡到这里。
        onFocusCapture={(event) => { if (isTextInputTarget(event.target)) beginTextEdit(); }}
        onBlurCapture={(event) => { if (isTextInputTarget(event.target)) commitTextEdit(); }}
        onDoubleClick={(event) => { if (!event.target.closest(".react-flow__pane")) return; const rect = stageRef.current?.getBoundingClientRect(); setContextMenu(null); setComfyMenuOpen(false); setAddMenu({ origin: "context", x: Math.max(10, Math.min(event.clientX - (rect?.left || 0), (rect?.width || 900) - 260)), y: Math.max(10, Math.min(event.clientY - (rect?.top || 0), (rect?.height || 700) - 446)), clientX: event.clientX, clientY: event.clientY }); }}>
        <NodeEditContext.Provider value={nodeEditApi}><WorkflowNodeContext.Provider value={workflowNodeApi}><ReactFlow
          key={record.id}
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onInit={(instance) => { setFlowInstance(instance); paintZoom(instance.getViewport().zoom); }}
          onMove={(_, viewport) => paintZoom(viewport.zoom)}
          onNodesChange={(changes) => {
            const removes = changes.filter((change) => change.type === "remove");
            const rest = changes.filter((change) => change.type !== "remove");
            if (removes.length && !nodeDeletePendingRef.current) {
              // 合并当前选中集合，让锁定节点计入 L（React Flow 会先把 locked 节点从 remove 里剔除）
              const selected = nodes.filter((node) => node.selected).map((node) => node.id);
              requestNodeDelete([...new Set([...removes.map((change) => change.id), ...selected])], "keyboard", null);
            }
            // remove 一律不透传：请求确认阶段完全不落地任何 change，也不记 dirty
            const settled = rest.some((change) => change.type === "position" && change.dragging === false);
            if (settled) rememberGraph();
            if (rest.length) onNodesChange(rest);
            if (settled) setSaved(false);
          }}
          onEdgesChange={(changes) => {
            const removes = changes.filter((change) => change.type === "remove");
            const rest = changes.filter((change) => change.type !== "remove");
            if (rest.length) onEdgesChange(rest);
            if (!removes.length) return;
            // @xyflow v12 的 deleteElements 先发 edges remove 再发 nodes remove，
            // 延迟一个微任务等 onNodesChange 把 pending 写好，再成对剔除关联边。
            queueMicrotask(() => {
              const pending = nodeDeletePendingRef.current;
              const isRelated = (change) => {
                if (!pending || !pending.size) return false;
                const edge = edges.find((item) => item.id === change.id);
                return Boolean(edge && (pending.has(edge.source) || pending.has(edge.target)));
              };
              const pass = removes.filter((change) => !isRelated(change));
              if (!pass.length) return;
              rememberGraph();
              onEdgesChange(pass);
              setSaved(false);
            });
          }}
          onConnect={onConnect}
          onConnectEnd={(_, connectionState) => { if (connectionState?.isValid === false) showToast("节点类型不兼容，无法连线", 2400); }}
          isValidConnection={isValidConnection}
          onEdgeClick={handleEdgeClick}
          onSelectionChange={handleSelectionChange}
          selectionOnDrag={canvasTool === "select"}
          multiSelectionKeyCode={selectionKeys}
          panOnDrag={canvasTool === "pan" ? true : canvasPanButtons}
          // 抓手模式：仅平移画布，节点不可拖动、不可连线（需求 1.8 AC-017）
          nodesDraggable={canvasTool === "select"}
          nodesConnectable={canvasTool === "select"}
          elementsSelectable={canvasTool === "select"}
          panOnScroll={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          connectionLineType={ConnectionLineType.Bezier}
          onPaneClick={() => { setAddMenu(null); setContextMenu(null); setComfyMenuOpen(false); setTidyMenuOpen(false); setEdgeMenu(null); setRunMenuOpen(false); setStickerMenuOpen(false); setNodeMenu(null); closeReferencePicker(); }}
          onPaneContextMenu={openPaneMenu}
          onNodeContextMenu={openNodeMenu}
          defaultViewport={initialViewport || { x: 0, y: 0, zoom: 1 }}
          fitView={!initialViewport}
          fitViewOptions={fitOptions}
          minZoom={0.2}
          maxZoom={3}
          onlyRenderVisibleElements
          deleteKeyCode={nodeDeleteConfirm ? null : ["Backspace", "Delete"]}
          defaultEdgeOptions={edgeDefaults}
        >
          <Background color="#cfd4dc" gap={22} size={1.1} />
          <Controls position="bottom-right" showInteractive={false} />
          {/* 小地图（需求 1.8）：默认关闭，由工具栏开关 */}
          {minimapOn && <MiniMap className="canvas-minimap" pannable zoomable nodeColor="#8b939d" maskColor="rgba(255,255,255,.72)" />}
          {/* 水印（需求 1.8）：预览水印，斜向平铺铺满整个画布，仅覆盖显示，不进入保存数据 */}
          {watermarkOn && (
            <div className="canvas-watermark" aria-hidden="true">
              {Array.from({ length: WATERMARK_TILE_COUNT }, (_, index) => (
                <span key={index}>预览水印 · 未导出</span>
              ))}
            </div>
          )}
          {/* 贴纸图层（需求 1.8）：独立可拖动的展示层，不进画布节点；走 ViewportPortal 跟随画布变换 */}
          <StickerLayer stickers={stickers} onMove={moveSticker} onRemove={removeSticker} />
          <Panel position="top-left" className="flow-title">
            <button className="flow-back" onClick={requestBack}><ArrowLeft size={15} /> 返回</button>
            <div>
              <span className={saved && inLibrary ? "status-dot" : "status-dot status-dot--warn"} />
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  className="flow-title__input"
                  value={titleDraft}
                  maxLength={128}
                  aria-label="工作流名称"
                  placeholder="输入工作流名称"
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); commitTitle(); }
                    if (event.key === "Escape") { event.preventDefault(); cancelTitleEdit(); }
                  }}
                />
              ) : (
                <button type="button" className="flow-title__name" title="点击重命名" onClick={startTitleEdit}>
                  <strong>{record.title}</strong><Pencil size={12} />
                </button>
              )}
              <small>{!inLibrary ? "尚未保存到工作台" : (saved ? "已保存" : "有未保存更改")} · {nodes.length} 个节点</small>
            </div>
          </Panel>
          <Panel position="top-right" className="flow-toolbar">
            <button onClick={() => fileRef.current?.click()}><Upload size={15} /> 导入</button>
            <button onClick={exportWorkflowFile}><Download size={15} /> 导出</button>
            <button onClick={saveWorkflow}><Save size={15} /> 保存</button>
            {running ? (
              <button className="run-workflow is-stop" onClick={cancelActiveRun}>
                <Square size={14} /> 停止 {runProgress}/{runTotal || 1}
              </button>
            ) : (
              <div className="run-workflow-group">
                <button className="run-workflow" onClick={() => runGraph(undefined, runMode)} disabled={!nodes.length}>
                  <CirclePlay size={16} /> {runMode === "regenerate" ? "重新生成" : "运行"}
                </button>
                <button className="run-workflow-toggle" onClick={() => setRunMenuOpen((value) => !value)} aria-label="选择运行方式" aria-expanded={runMenuOpen} disabled={!nodes.length}>
                  <ChevronDown size={13} />
                </button>
                {runMenuOpen && <div className="run-workflow-menu" role="menu" onMouseDown={(event) => event.stopPropagation()}>
                  <button role="menuitemradio" aria-checked={runMode === "reuse"} className={runMode === "reuse" ? "is-active" : ""} onClick={() => { setRunMode("reuse"); setRunMenuOpen(false); }}>
                    <span>复用已有结果</span>
                    <small>参数与上游都没变的节点直接用上次的产物，不重复生成、不重复扣积分</small>
                  </button>
                  <button role="menuitemradio" aria-checked={runMode === "regenerate"} className={runMode === "regenerate" ? "is-active" : ""} onClick={() => { setRunMode("regenerate"); setRunMenuOpen(false); }}>
                    <span>全部重新生成</span>
                    <small>所有生成与剪辑节点都真跑一遍，重新扣积分</small>
                  </button>
                </div>}
              </div>
            )}
            <span className="flow-zoom" ref={zoomLabelRef} aria-live="polite" title="画布缩放比例">100%</span>
          </Panel>
        </ReactFlow></WorkflowNodeContext.Provider></NodeEditContext.Provider>
        {referencePickerNodeId && <div className="reference-picker nodrag nowheel" role="dialog" aria-modal="true" aria-label={pickerSlotLabel ? `选择${pickerSlotLabel}` : "添加参考素材"} onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div className="reference-picker__head">
              <strong>{pickerSlotLabel ? `选择${pickerSlotLabel}` : "添加参考素材"}</strong>
              <span className="reference-picker__quota">{pickerQuotaText}</span>
            </div>
            <button aria-label="关闭参考素材选择" onClick={closeReferencePicker}><X size={15} /></button>
          </header>
          <div className="reference-picker__scroll">
            <section>
              <div className="reference-picker__section-title"><strong>画布素材</strong><span>{pickerCanvasNodes.length} 项</span></div>
              {pickerCanvasNodes.length ? <div className="reference-picker__grid">{pickerCanvasNodes.map((node) => {
                const type = node.data.assetType || node.data.outputs?.find((port) => ["IMAGE", "VIDEO", "AUDIO"].includes(port.type))?.type || "IMAGE";
                const attached = edges.some((edge) => edge.source === node.id && edge.target === referencePickerNodeId);
                const frameKey = pickerSlotLabel ? canvasFrameStorageKey(node) : "";
                const limitMessage = attached || pickerSlotLabel ? "" : referenceLimitMessage(referencePickerNodeId, type, referenceDurationOf(node));
                return <button className={attached || (frameKey && frameKey === currentFrameKey) ? "is-selected" : ""} disabled={Boolean(limitMessage)} title={limitMessage} key={node.id} onClick={() => {
                  if (pickerSlotLabel) {
                    // 帧槽位：把该画布节点的图片产物直接写进 media.frames
                    if (!frameKey) { showToast("该节点还没有图片产出，请先生成"); return; }
                    setFrameSlot(referencePickerNodeId, referencePickerSlot, { key: frameKey, title: node.data.title });
                    return;
                  }
                  attached ? removeReference(referencePickerNodeId, node.id) : attachReference(referencePickerNodeId, node.id);
                }}>
                  <span className="reference-picker__thumb">{nodePosterUrl(node) ? <img src={nodePosterUrl(node)} alt={node.data.title} /> : type === "VIDEO" && nodePlaybackUrl(node) ? <video src={`${nodePlaybackUrl(node)}#t=0.1`} muted playsInline preload="metadata" aria-label={node.data.title} /> : type === "VIDEO" ? <Film size={14} /> : <Image size={14} />}{(attached || (frameKey && frameKey === currentFrameKey)) ? <i className="reference-picker__check"><Check size={12} /></i> : null}</span>
                  <span className="reference-picker__name">{type === "VIDEO" ? <Film size={11} /> : type === "AUDIO" ? <Music2 size={11} /> : <Image size={11} />}<em>{node.data.title}</em></span>
                </button>;
              })}</div> : <p className="reference-picker__empty">画布中还没有可引用的图片、视频或音频。</p>}
            </section>
            <section>
              <div className="reference-picker__section-title"><strong>素材库</strong><span>{pickerVisibleAssets.length} 项</span></div>
              {referenceAssetsError ? <p className="reference-picker__empty">素材库加载失败：{referenceAssetsError}</p>
                : referenceAssets === null ? <p className="reference-picker__empty">正在读取素材库…</p>
                : pickerVisibleAssets.length === 0 ? <p className="reference-picker__empty">{pickerAcceptsVideo ? "素材库还没有图片、视频或音频，可点下方「本地上传」或到「我的素材」页上传。" : "素材库还没有图片素材，可点下方「本地上传」或到「我的素材」页上传。"}</p>
                : <div className="reference-picker__grid">{pickerVisibleAssets.map((asset) => {
                  // 旧画布可能仍有素材节点+连线的存量引用，一并算「已引用」
                  const existing = nodes.find((node) => node.data?.assetKey === asset.key);
                  const legacyAttached = Boolean(existing && edges.some((edge) => edge.source === existing.id && edge.target === referencePickerNodeId));
                  const attached = directReferenceKeys.has(asset.key) || legacyAttached;
                  const isCurrentFrame = Boolean(pickerSlotLabel && asset.key === currentFrameKey);
                  const active = attached || isCurrentFrame;
                  const limitMessage = active || pickerSlotLabel ? "" : referenceLimitMessage(referencePickerNodeId, asset.type, asset.durationSec);
                  return <button className={active ? "is-selected" : ""} disabled={Boolean(limitMessage)} title={limitMessage} key={asset.key} onClick={() => {
                    if (pickerSlotLabel) {
                      // 帧槽位：单选，选中即写入并关闭弹框
                      setFrameSlot(referencePickerNodeId, referencePickerSlot, { key: asset.key, title: asset.title });
                      return;
                    }
                    attached
                      ? removeReference(referencePickerNodeId, directReferenceKeys.has(asset.key) ? `direct:${asset.key}` : existing.id)
                      : addReferenceAsset(referencePickerNodeId, asset);
                  }}>
                    <span className="reference-picker__thumb">
                      {asset.cover.type === "video" && !asset.cover.thumb
                        ? <video src={asset.cover.src} muted playsInline preload="metadata" />
                        : <MediaCover item={asset.cover} />}
                      {active ? <i className="reference-picker__check"><Check size={12} /></i> : null}
                    </span>
                    <span className="reference-picker__name">{asset.type === "VIDEO" ? <Film size={11} /> : asset.type === "AUDIO" ? <Music2 size={11} /> : <Image size={11} />}<em>{asset.title}</em></span>
                  </button>;
                })}</div>}
            </section>
          </div>
          <footer><button onClick={() => referenceUploadRef.current?.click()}><Upload size={14} />{pickerAcceptsVideo ? "本地上传图片、视频或音频" : "本地上传图片"}</button><button className="reference-picker__done" onClick={closeReferencePicker}><Check size={14} />完成</button></footer>
          <input ref={referenceUploadRef} hidden type="file" accept={pickerAcceptsVideo ? "image/*,video/*,audio/*" : "image/*"} onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              const validation = validateAssetFile(file);
              if (!validation.valid) throw new Error(validation.message || "请选择图片、视频或音频文件");
              if (validation.kind === "audio" && !pickerAcceptsAudio) throw new Error("当前节点不支持音频参考素材");
              if (validation.kind === "video" && !pickerAcceptsVideo) throw new Error("当前节点不支持视频参考素材");
              const asset = await uploadAsset(file);
              if (!asset?.storageKey) throw new Error("素材上传未返回存储地址");
              const type = validation.kind === "video" ? "VIDEO" : validation.kind === "audio" ? "AUDIO" : "IMAGE";
              const url = asset.url || asset.src || mediaUrl(asset.storageKey);
              if (pickerSlotLabel) {
                // 帧槽位：上传的图片直接作为首帧/尾帧
                setFrameSlot(referencePickerNodeId, referencePickerSlot, { key: asset.storageKey, title: asset.name || file.name });
                return;
              }
              addReferenceAsset(referencePickerNodeId, {
                key: asset.storageKey,
                title: asset.name || file.name,
                type,
                posterKey: storageKeyOf(asset.posterKey || asset.poster || ""),
                preview: asset.posterUrl || asset.poster || url,
                url,
                durationSec: type === "VIDEO" && Number(asset.durationMs) > 0
                  ? Math.max(1, Math.round(Number(asset.durationMs) / 1000))
                  : 0,
              });
            } catch (error) { showToast(error.message || "素材上传失败"); }
          }} />
        </div>}
        {selectedNodeIds.length >= 2 && <div className="canvas-selection-actions" onMouseDown={(event) => event.stopPropagation()}>
          <div className="canvas-selection-actions__bar">
            <button className={tidyMenuOpen ? "active" : ""} onClick={() => setTidyMenuOpen((value) => !value)}><LayoutGrid size={15} />整理<ChevronDown size={12} /></button>
            <button onClick={groupSelection}><Group size={15} />组合</button>
            <button onClick={duplicateSelectedNodes}><Copy size={15} />复制</button>
            <button disabled={assetsBusy} onClick={() => saveSelectionAsAssets(selectedNodeIds)}><PackagePlus size={15} />{assetsBusy ? "保存中…" : "保存为资产"}</button>
          </div>
          {tidyMenuOpen && <div className="canvas-tidy-menu">
            <button onClick={autoArrangeCanvas}><WandSparkles size={15} /><span>自动规整（按连线）</span></button>
            <button onClick={() => arrangeSelection("grid")}><LayoutGrid size={15} /><span>网格排列</span></button>
            <button onClick={() => arrangeSelection("horizontal")}><Columns3 size={15} /><span>横向排列</span></button>
            <button onClick={() => arrangeSelection("vertical")}><Rows3 size={15} /><span>纵向排列</span></button>
            <label><input type="checkbox" checked={includeConnected} onChange={(event) => setIncludeConnected(event.target.checked)} /><span>同时整理相连的上下游节点</span><CircleHelp size={13} /></label>
          </div>}
        </div>}
        {selectedGroupNode && selectedNodeIds.length === 1 && (
          <div className="canvas-group-actions" onMouseDown={(event) => event.stopPropagation()}>
            <input className="canvas-group-actions__title" value={selectedGroupNode.data.label || ""} onChange={(event) => renameGroup(selectedGroupNode.id, event.target.value)} placeholder="组合名称" aria-label="组合名称" />
            <button onClick={ungroupSelection}><Ungroup size={14} />解散</button>
            <div className="canvas-group-actions__colors">{GROUP_COLORS.map((color) => <button key={color} type="button" className={selectedGroupNode.data.color === color ? "is-active" : ""} style={{ background: color }} aria-label={`颜色 ${color}`} onClick={() => setGroupColor(color)} />)}</div>
          </div>
        )}
        <div className="canvas-dock" aria-label="画布工具栏">
          <button className={`canvas-dock__add ${addMenu?.origin === "dock" ? "active" : ""}`} aria-label="添加节点" onClick={() => { setContextMenu(null); setComfyMenuOpen(false); setAddMenu((value) => value?.origin === "dock" ? null : { origin: "dock" }); }}><Plus size={22} /></button>
          <button className={canvasTool === "select" ? "active" : ""} aria-label="选择工具" onClick={() => setCanvasTool("select")}><MousePointer2 size={17} /></button>
          <button className={canvasTool === "pan" ? "active" : ""} aria-label="抓手工具" title={canvasTool === "pan" ? "抓手模式：仅平移画布，节点不可拖动与连线" : "切换到抓手模式"} onClick={() => setCanvasTool((current) => current === "pan" ? "select" : "pan")}><ChevronUp size={15} /></button>
          <button aria-label="导入工作流" onClick={() => fileRef.current?.click()}><FolderOpen size={18} /></button>
          <button aria-label="自动规整画布" title="按连线自动规整：选中节点时整理所选（含相连上下游），否则整理整图" onClick={autoArrangeCanvas}><WandSparkles size={17} /></button>
          <button className={stickers.length ? "active" : ""} aria-label="添加贴纸" title="贴纸：添加独立可拖动的贴纸图层" onClick={() => { setContextMenu(null); setStickerMenuOpen((value) => !value); }}><Sticker size={17} /></button>
          <button className={watermarkOn ? "active" : ""} aria-label="水印" title="水印：在画布上叠加或隐藏预览水印" onClick={() => setWatermarkOn((value) => !value)}><Droplets size={17} /></button>
          <button className={minimapOn ? "active" : ""} aria-label="小地图" title="小地图：显示画布缩略导航（默认关闭）" onClick={() => setMinimapOn((value) => !value)}><MapIcon size={17} /></button>
          <button className={edgesVisible ? "" : "active"} aria-label="连线显示" title={edgesVisible ? "连线显示：点击隐藏所有连线" : "连线显示：点击显示所有连线"} onClick={() => setEdgesVisible((value) => !value)}>{edgesVisible ? <Eye size={17} /> : <EyeOff size={17} />}</button>
          <button ref={helpButtonRef} aria-label="画布帮助" onClick={() => showToast("框选节点后按 Delete / Backspace 删除；Ctrl+Z 撤销、Ctrl+Y 重做、Ctrl+S 保存；双击或右键打开快捷菜单，删除按钮均需二次确认。", 4200)}><CircleHelp size={17} /></button>
        </div>
        {addMenu && <div className={`canvas-add-menu ${addMenu.origin === "context" ? "is-contextual" : ""} ${addMenu.origin === "context" && addMenu.x > (stageRef.current?.clientWidth || 900) - 520 ? "submenu-left" : ""}`} style={addMenu.origin === "context" ? { left: addMenu.x, top: addMenu.y } : undefined} onMouseDown={(event) => event.stopPropagation()}>
          <header>添加节点</header>
          <div className="canvas-add-menu__items">{canvasQuickItems.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => addQuickNode(item)}><i><Icon size={18} /></i><span>{item.name}</span>{item.badge && <em>{item.badge}</em>}</button>; })}</div>
          {/* 画布资产（需求 1.3）：14.27 下线的「项目资产」是素材→画布的 dock 面板，
              这里是节点→资产→画布的反向复用，入口直接挂在添加节点菜单里，不复活旧面板。 */}
          <div className="canvas-add-menu__assets">
            <header>我的资产 <span>{canvasAssets.length}</span></header>
            {canvasAssets.length === 0 && <div className="canvas-add-menu__assets-empty">右键节点选「保存为资产」，即可在这里跨画布复用</div>}
            {canvasAssets.slice(0, 8).map((asset) => (
              <div className="canvas-add-menu__asset" key={asset.id}>
                <button disabled={assetsBusy} title={`把「${asset.name}」插入当前画布`} onClick={() => insertCanvasAsset(asset)}>
                  <i><PackagePlus size={15} /></i><span>{asset.name}</span><em>{asset.nodeCount || 1}</em>
                </button>
                <button className="is-remove" disabled={assetsBusy} aria-label={`删除资产 ${asset.name}`} title="删除该资产（不影响已插入的节点）" onClick={() => removeCanvasAsset(asset)}><Trash2 size={13} /></button>
              </div>
            ))}
            {canvasAssets.length > 8 && <div className="canvas-add-menu__assets-more">仅显示最近 8 个，共 {canvasAssets.length} 个</div>}
          </div>
          {/*<div className="canvas-add-submenu-shell" onMouseEnter={() => setComfyMenuOpen(true)} onMouseLeave={() => setComfyMenuOpen(false)}><button className="canvas-add-menu__comfy" onClick={() => setComfyMenuOpen((value) => !value)}><i><Layers3 size={18} /></i><span>ComfyUI</span><ChevronRight size={15} /></button>{comfyMenuOpen && <div className="canvas-add-submenu"><header><button type="button">探索更多</button></header></div>}</div>*/}
        </div>}
        {stickerMenuOpen && <div className="canvas-sticker-menu" onMouseDown={(event) => event.stopPropagation()}>
          <header>添加贴纸</header>
          <div className="canvas-sticker-menu__items">
            {STICKER_PRESETS.map((sticker) => (
              <button key={sticker.id} onClick={() => { addSticker(sticker); setStickerMenuOpen(false); }}>
                <i style={{ background: sticker.tone }}><span>{sticker.glyph}</span></i>
                <span>{sticker.label}</span>
              </button>
            ))}
          </div>
        </div>}
        {contextMenu && <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button onClick={() => { const next = { origin: "context", x: Math.min(contextMenu.x + 150, Math.max(10, (stageRef.current?.clientWidth || 900) - 260)), y: Math.max(10, Math.min(contextMenu.y, (stageRef.current?.clientHeight || 700) - 446)), clientX: contextMenu.clientX, clientY: contextMenu.clientY }; setContextMenu(null); setAddMenu(next); }}><Plus size={15} /><span>添加节点</span></button>
          <hr />
          <button disabled={!selectedNodeIds.length} onClick={copySelectedNodes}><Copy size={15} /><span>复制</span><kbd>Ctrl+C</kbd></button>
          <button disabled={!historyRef.current.length} onClick={undoGraph}><Undo2 size={15} /><span>撤销</span><kbd>Ctrl+Z</kbd></button>
          <button disabled={!futureRef.current.length} onClick={redoGraph}><Redo2 size={15} /><span>重做</span><kbd>Ctrl+Shift+Z</kbd></button>
          <hr />
          <button onClick={handlePaste}><Clipboard size={15} /><span>粘贴</span><kbd>Ctrl+V</kbd></button>
          <button onClick={selectAll}><CheckSquare size={15} /><span>全选</span><kbd>Ctrl+A</kbd></button>
          <button onClick={invertSelection}><SquareStack size={15} /><span>反选</span></button>
        </div>}
        {nodeMenu && (() => {
          const menuNode = nodes.find((node) => node.id === nodeMenu.id);
          if (!menuNode) return null;
          const currentTags = Array.isArray(menuNode.data?.tags) ? menuNode.data.tags : [];
          return (
            <div
              className="canvas-node-menu"
              style={{
                left: Math.min(nodeMenu.x, (stageRef.current?.clientWidth || 900) - 250),
                top: Math.min(nodeMenu.y, (stageRef.current?.clientHeight || 700) - 340),
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header><strong>{menuNode.data?.title || "节点"}</strong></header>
              <button onClick={() => {
                const at = flowInstance?.screenToFlowPosition({ x: nodeMenu.clientX || 0, y: nodeMenu.clientY || 0 });
                duplicateNodeAt(nodeMenu.id, at || { x: 120, y: 120 });
                closeNodeMenu();
              }}><Copy size={15} /><span>复制节点</span></button>
              <button onClick={() => setNodeRenameEditing(true)}><Pencil size={15} /><span>重命名</span></button>
              {nodeRenameEditing && (
                <div className="canvas-node-menu__rename">
                  <input
                    ref={nodeMenuRenameRef}
                    value={nodeRenameDraft}
                    autoFocus
                    placeholder="输入新名称"
                    aria-label="节点新名称"
                    onChange={(event) => setNodeRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { event.preventDefault(); renameNode(nodeMenu.id, nodeRenameDraft); closeNodeMenu(); }
                      if (event.key === "Escape") { event.preventDefault(); setNodeRenameEditing(false); }
                    }}
                    onBlur={(event) => { renameNode(nodeMenu.id, event.target.value); setNodeRenameEditing(false); }}
                  />
                  <button aria-label="确认重命名" onMouseDown={(event) => event.preventDefault()} onClick={() => { renameNode(nodeMenu.id, nodeRenameDraft); closeNodeMenu(); }}><Check size={13} /></button>
                </div>
              )}
              <div className="canvas-node-menu__tags">
                <span>标签</span>
                <div>
                  {NODE_TAG_OPTIONS.map((tag) => (
                    <button
                      key={tag}
                      className={currentTags.includes(tag) ? "is-active" : ""}
                      aria-pressed={currentTags.includes(tag)}
                      onClick={() => toggleNodeTag(nodeMenu.id, tag)}
                    >{tag}</button>
                  ))}
                </div>
              </div>
              <button disabled={assetsBusy} onClick={() => { saveNodeAsAsset(nodeMenu.id); closeNodeMenu(); }}>
                <PackagePlus size={15} /><span>{canvasAssets.some((item) => item.id === menuNode.data?.savedAsset?.assetId) ? "已保存 · 更新画布资产" : "保存为资产"}</span>
              </button>
              <hr />
              <button className="is-danger" onClick={() => {
                const id = nodeMenu.id;
                closeNodeMenu();
                requestNodeDelete([id], "menu", document.activeElement);
              }}><Trash2 size={15} /><span>删除</span></button>
            </div>
          );
        })()}
        {edgeMenu && (
          <div className="edge-delete-popover" style={{ left: edgeMenu.x, top: edgeMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="edge-delete-popover__btn"
              title="删除连线"
              aria-label="删除连线"
              onClick={() => { nodeDeletePendingRef.current = null; nodeDeleteTriggerRef.current = null; setNodeDeleteConfirm(null); setEdgeDeleteConfirm(edgeMenu.edge); setEdgeMenu(null); }}
            >
              删除
            </button>
          </div>
        )}
        <input ref={fileRef} hidden type="file" accept=".json" onChange={(event) => { importIntoCanvas(event.target.files?.[0]); event.target.value = ""; }} />
        {toast && <div className="run-toast" role="status" aria-live="polite"><Check size={16} /> {toast}</div>}
        <ConfirmDialog
          open={Boolean(edgeDeleteConfirm)}
          title="删除连线？"
          message="删除后两个节点将断开连接，是否继续？"
          confirmLabel="删除"
          onClose={() => setEdgeDeleteConfirm(null)}
          onConfirm={() => { if (edgeDeleteConfirm) { deleteEdge(edgeDeleteConfirm); setEdgeDeleteConfirm(null); } }}
        />
        <ConfirmDialog
          open={Boolean(nodeDeleteConfirm)}
          title={nodeDeleteConfirm?.title || "删除节点？"}
          message={nodeDeleteConfirm?.message || ""}
          confirmLabel="删除"
          cancelLabel="取消"
          onClose={cancelNodeDelete}
          onConfirm={confirmNodeDelete}
        />
        {backGuard && <div className="flow-back-guard" role="dialog" aria-modal="true" aria-label="未保存更改" onMouseDown={(event) => event.stopPropagation()}>
          <div className="flow-back-guard__card">
            <strong>{inLibrary ? "未保存的更改" : "尚未保存"}</strong>
            <p>{inLibrary
              ? `「${record.title || "未命名工作流"}」还有未保存的更改，直接返回将丢失本次编辑。`
              : `「${record.title || "未命名工作流"}」还没有保存到工作台，直接返回将丢失这个工作流。`}</p>
            <div className="flow-back-guard__actions">
              <button type="button" disabled={savingBack} onClick={onBack}>直接返回</button>
              <button type="button" disabled={savingBack} onClick={() => setBackGuard(false)}>取消</button>
              <button type="button" className="primary" disabled={savingBack} onClick={saveAndBack}>{savingBack ? "正在保存…" : "保存并返回"}</button>
            </div>
          </div>
        </div>}
        <ImportReport report={importReport} onClose={() => setImportReport(null)} />
        {editingSuiteNodeId && (() => {
          const target = nodes.find((node) => node.id === editingSuiteNodeId);
          return (
            <Suspense fallback={null}>
              <EditingSuite
                nodeId={editingSuiteNodeId}
                title={record.title || "视频剪辑"}
                clips={getClips(editingSuiteNodeId)}
                sources={getEditingSourceClips(editingSuiteNodeId)}
                savedTimeline={target?.data?.editing?.timeline}
                savedImportedSources={target?.data?.editing?.importedSources}
                onClose={() => setEditingSuiteNodeId(null)}
                onDraft={(draft) => updateEditingDraft(editingSuiteNodeId, draft)}
                onExport={() => commitEditingExport(editingSuiteNodeId)}
                onAbort={() => abortEditingExport(editingSuiteNodeId)}
                onRefresh={refreshRuntime}
              />
            </Suspense>
          );
        })()}
      </section>
    </div>
  );
}

export function WorkflowStudio({ onOpenTemplates, templateLaunch, importRequest, onImportApplied, models = [] }) {
  const [view, setView] = useState(templateLaunch ? "editor" : "library");
  const workflowModels = useMemo(() => models.filter((model) => model.enabled !== false && (model.capabilities?.includes("workflow") || ["image", "video", "audio"].includes(model.category))), [models]);
  const [selectedModel, setSelectedModel] = useState(() => workflowModels[0]?.id || "");
  const [record, setRecord] = useState(() => templateLaunch ? templateRecord(templateLaunch) : null);
  const [graph, setGraph] = useState(() => ({ nodes: [], edges: [] }));
  const [editorKey, setEditorKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [libraryStatus, setLibraryStatus] = useState(null);
  const [appendRequest, setAppendRequest] = useState(null);
  const [importReport, setImportReport] = useState(null);

  // 画布视图映射到 URL（/console/studio?view=editor），使浏览器返回能先回到高级工作台库页，
  // 而非跳过库页直接退到进入画布前所在的页面（如剧本创作）
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editorPushedRef = useRef(false);
  // 本次 openEditor/closeEditor 的预期视图：view(state) 与 URL 各自异步落定，落定前不对齐（防翻转，见下方同步 effect）
  const pendingViewRef = useRef(null);
  const editorParam = searchParams.get("view") === "editor";

  const openEditor = useCallback((id) => {
    pendingViewRef.current = "editor";
    setView("editor");
    editorPushedRef.current = true;
    setSearchParams((prev) => {
      prev.set("view", "editor");
      // 已落库的工作流把 id 一起带上：刷新/深链时据此恢复画布，不再回落库页
      if (id) prev.set("id", String(id));
      else prev.delete("id");
      return prev;
    });
  }, [setSearchParams]);

  // 编辑器回写 record 时顺带补上可寻址的 ?id=：草稿被「点生成即保存」或手动保存后，
  // 刷新画布直链也能按 id 恢复，而不是因为 URL 无 id 直接回落库页。
  const handleRecordChange = useCallback((next) => {
    setRecord(next);
    const id = Number(next?.id);
    if (!Number.isFinite(id) || id <= 0) return;
    setSearchParams((prev) => {
      if (prev.get("id") === String(id)) return prev;
      prev.set("id", String(id));
      return prev;
    }, { replace: true });
  }, [setSearchParams]);

  const closeEditor = useCallback(() => {
    pendingViewRef.current = "library";
    if (editorPushedRef.current) {
      editorPushedRef.current = false;
      // 走这里说明 openEditor push 过一条 ?view=editor 历史，pop 一定会生效；
      // location 经 transition 异步落定，view 先行切走，陈旧 URL 的回翻由下方同步 effect 的 pending 挡住
      navigate(-1);
      setView("library");
      return;
    }
    setView("library");
    setSearchParams(
      (prev) => {
        prev.delete("view");
        prev.delete("id");
        return prev;
      },
      { replace: true },
    );
  }, [navigate, setSearchParams]);

  // URL ↔ view 同步：深链 ?view=editor 进入画布；画布无参数且非模板/导入/加载态则回落库页。
  // openEditor/closeEditor 里 setView 与 navigate 不在同一次提交落定：router 的 location 走
  // transition 异步传播，中间有一两帧 editorParam 仍是旧值，若直接按 URL 对齐会把 view 翻回去，
  // 编辑器/库页来回闪（还会连带重复拉列表）。等 view 与 URL 都落到 pendingViewRef 记下的
  // 预期值后，才恢复“以 URL 为准”的外部同步（深链、浏览器前进/后退）。
  useEffect(() => {
    const pending = pendingViewRef.current;
    if (pending === "editor" && !(view === "editor" && editorParam)) return;
    if (pending === "library" && !(view === "library" && !editorParam)) return;
    if (pending) pendingViewRef.current = null;
    if (editorParam && view !== "editor") {
      editorPushedRef.current = false;
      setView("editor");
    } else if (!editorParam && view === "editor" && !templateLaunch && !importRequest && !loading) {
      setView("library");
    }
  }, [editorParam, view, templateLaunch, importRequest, loading]);

  // 守卫：刷新画布直链但无 record 时回落库页，避免白屏；带 id 深链时交给下方恢复 effect 处理
  useEffect(() => {
    if (view === "editor" && !record && !templateLaunch && !importRequest && !loading) {
      if (searchParams.get("id")) return;
      navigate("/console/studio", { replace: true });
    }
  }, [view, record, templateLaunch, importRequest, loading, navigate, searchParams]);

  // 刷新/深链恢复：?view=editor&id=<已落库id> 时直接重开该工作流（blank/import 草稿没有可寻址 id，仍回落库页）
  const restoreIdParam = searchParams.get("id");
  const restoredIdsRef = useRef(new Set());
  useEffect(() => {
    if (!editorParam || !restoreIdParam || !Number(restoreIdParam) || record
      || templateLaunch || importRequest || restoredIdsRef.current.has(restoreIdParam)) return;
    let cancelled = false;
    setLoading(true);
    getWorkflow(restoreIdParam)
      .then((detail) => {
        // 落定后才记入已恢复集合：StrictMode 会双跑 effect，若启动时就去重，第二次会被拦截而无人复位 loading
        restoredIdsRef.current.add(restoreIdParam);
        if (cancelled) return;
        const card = toWorkflowCard(detail);
        const stored = detail?.graph || {};
        const nextGraph = Array.isArray(stored.nodes) && stored.nodes.length
          ? { ...stored, nodes: stored.nodes, edges: stored.edges || [] }
          : { nodes: [], edges: [], viewport: stored.viewport, stickers: stored.stickers || [] };
        if (card.modelId) setSelectedModel(String(card.modelId));
        setRecord(card);
        setGraph(nextGraph);
        setEditorKey((key) => key + 1);
      })
      .catch((error) => {
        restoredIdsRef.current.add(restoreIdParam);
        if (cancelled) return;
        setLibraryStatus({ text: error.message || "工作流恢复失败，请从库页重新打开", error: true });
        navigate("/console/studio", { replace: true });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [editorParam, restoreIdParam, record, templateLaunch, importRequest]);

  // 模板弹窗导入本地工作流 JSON（需求 4.4.2）：先校验再落画布，失败时逐项报错且不改动画布
  useEffect(() => {
    if (!importRequest?.json) return;
    const parsed = parseWorkflowDocument(importRequest.json);
    if (!parsed.ok) {
      setImportReport({ fileName: importRequest.fileName, errors: parsed.errors, warnings: parsed.warnings || [] });
      onImportApplied?.();
      return;
    }
    const mode = importRequest.mode === "append" ? "append" : "new";
    if (mode === "append") {
      setAppendRequest({ graph: parsed.graph, token: importRequest.token || Date.now() });
      openEditor();
      if (parsed.warnings.length) setImportReport({ fileName: importRequest.fileName, errors: [], warnings: parsed.warnings });
      onImportApplied?.();
      return;
    }
    setRecord({
      id: `import-${importRequest.token || Date.now()}`,
      title: String(importRequest.fileName || "导入工作流").replace(/\.json$/i, ""),
      type: "import",
      model: parsed.kind === "standard" ? "工作台 JSON" : "ComfyUI JSON",
      origin: parsed.kind === "standard" ? "工作台 JSON 导入" : "ComfyUI 导入",
      builtin: false,
    });
    setGraph({ ...parsed.graph, viewport: parsed.viewport, stickers: parsed.stickers || [] });
    setEditorKey((key) => key + 1);
    openEditor();
    if (parsed.warnings.length) setImportReport({ fileName: importRequest.fileName, errors: [], warnings: parsed.warnings });
    onImportApplied?.();
  }, [importRequest]);

  // 模板实例化（需求 4.3.1.5/4.3.1.6）：新建画布或追加到当前画布，都不覆盖已有节点。
  // 以 templateLaunch.token 去重：workflowModels 是随父组件渲染派生的 memo 数组（身份常变），
  // 若直接依赖它，本 effect 会反复重跑 → 重新拉模板画布 + setEditorKey++ → 编辑器不停重挂载，
  // 表现为模板生成的工作流卡片一直闪烁。
  const templateLaunchTokenRef = useRef(null);
  useEffect(() => {
    if (!templateLaunch) return;
    const token = templateLaunch.token || `${templateLaunch.id}-${templateLaunch.mode}`;
    if (templateLaunchTokenRef.current === token) return;
    templateLaunchTokenRef.current = token;
    let cancelled = false;
    const mode = templateLaunch.mode === "append" ? "append" : "new";
    (async () => {
      let nextGraph;
      try {
        nextGraph = await resolveTemplateGraph(templateLaunch);
      } catch (error) {
        if (!cancelled) window.alert(error.message || "模板加载失败");
        return;
      }
      if (cancelled) return;
      if (mode === "append") {
        // 当前没有打开的画布时无法追加（openEditor 依赖已有 record），降级为新建并说明
        if (!record) {
          setRecord(templateRecord(templateLaunch));
          setGraph(nextGraph);
          setEditorKey((key) => key + 1);
          openEditor();
          window.alert("当前没有打开的画布，已按新建画布打开该模板");
          return;
        }
        setAppendRequest({ graph: nextGraph, token: templateLaunch.token || Date.now() });
        openEditor();
        return;
      }
      setRecord(templateRecord(templateLaunch));
      setGraph(nextGraph);
      setEditorKey((key) => key + 1);
      openEditor();
    })();
    return () => { cancelled = true; };
  // 依赖只放 templateLaunch：workflowModels 是随父组件渲染派生的 memo 数组（身份常变），
  // 若依赖它，本 effect 会反复重跑 → 重新拉模板画布 + setEditorKey++ → 编辑器不停重挂载（卡片闪烁）
  }, [templateLaunch]);
  useEffect(() => { if (workflowModels.length && !workflowModels.some((model) => String(model.id) === String(selectedModel))) setSelectedModel(workflowModels[0].id); }, [workflowModels, selectedModel]);
  const listLoadedRef = useRef(false);
  useEffect(() => {
    if (view !== "library") return undefined;
    let cancelled = false;
    // 首次加载才提示“正在加载”；从画布返回库页时已有列表数据，改为静默刷新，
    // 避免“正在加载工作流…”插进/移出把卡片网格顶得上下跳（返回闪动）
    setLibraryStatus(listLoadedRef.current ? null : { text: "正在加载工作流…" });
    listWorkflows().then((items) => {
      if (cancelled) return;
      listLoadedRef.current = true;
      setRecords((items || []).filter((item) => !item.builtin).map(toWorkflowCard));
      setLibraryStatus(null);
    }).catch((error) => {
      if (cancelled) return;
      setRecords([]);
      setLibraryStatus({ text: error.message || "工作流列表加载失败", error: true });
    });
    return () => { cancelled = true; };
  }, [view]);

  async function openRecord(nextRecord) {
    setLoading(true);
    try {
      const detail = Number(nextRecord.id) > 0 ? await getWorkflow(nextRecord.id) : null;
      const card = detail ? toWorkflowCard(detail) : nextRecord;
      const stored = detail?.graph || {};
      let nextGraph;
      // 展开 stored 保留 viewport（老数据没有该字段，editor 会回退 fitView）
      if (Array.isArray(stored.nodes) && stored.nodes.length) nextGraph = { ...stored, nodes: stored.nodes, edges: stored.edges || [] };
      else nextGraph = { nodes: [], edges: [], viewport: stored.viewport, stickers: stored.stickers || [] };
      if (card.modelId) setSelectedModel(String(card.modelId));
      setRecord(card);
      setGraph(nextGraph);
      setEditorKey((key) => key + 1);
      openEditor(Number(card.id) > 0 ? card.id : undefined);
    } catch (error) {
      window.alert(error.message || "无法打开工作流");
    } finally {
      setLoading(false);
    }
  }

  function createWorkflow() {
    setRecord({ id: `blank-${Date.now()}`, title: "未命名工作流", type: "image", model: "未选择", builtin: false });
    setGraph({ nodes: [], edges: [] });
    setEditorKey((key) => key + 1);
    openEditor();
  }

  async function importWorkflow(file) {
    if (!file) return;
    let parsed;
    try {
      const text = await file.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("无法读取该工作流：文件不是合法的 JSON");
      }
      parsed = parseWorkflowDocument(json);
    } catch (error) {
      // 导入结果统一走 ImportReport 浮层（需求 4.4.2.4），与画布内导入保持同一套错误清单
      setImportReport({ fileName: file.name, errors: [error.message || "无法读取该工作流"], warnings: [] });
      return;
    }
    if (!parsed.ok) {
      setImportReport({ fileName: file.name, errors: ["无法读取该工作流", ...parsed.errors], warnings: parsed.warnings });
      return;
    }
    setRecord({
      id: `import-${Date.now()}`,
      title: file.name.replace(/\.json$/i, ""),
      type: "import",
      model: parsed.kind === "standard" ? "工作台 JSON" : "ComfyUI JSON",
      origin: parsed.kind === "standard" ? "工作台 JSON 导入" : "ComfyUI 导入",
      builtin: false,
    });
    setGraph({ ...parsed.graph, viewport: parsed.viewport, stickers: parsed.stickers || [] });
    setEditorKey((key) => key + 1);
    openEditor();
    if (parsed.warnings.length) setImportReport({ fileName: file.name, errors: [], warnings: parsed.warnings });
  }

  // 删除确认由库页的 ConfirmDialog 负责；失败时错误回传到弹窗内展示
  async function deleteRecord(target) {
    await removeWorkflow(target.id);
    setRecords((items) => items.filter((item) => item.id !== target.id));
  }

  // 保存为模板（需求 14.16 口径）：拉取原工作流完整画布，另存 type=template 的副本，
  // 原工作流不动；模板落库后自动出现在模板库（listTemplates 只查 type=template）
  async function saveAsTemplate(target, meta) {
    const detail = await getWorkflow(target.id);
    await createWorkflowRecord({
      title: meta.title,
      description: meta.description,
      type: "template",
      category: meta.category,
      tags: meta.tags,
      modelId: detail?.modelId ?? null,
      origin: "个人模板",
      graph: detail?.graph || { nodes: [], edges: [] },
    });
    setLibraryStatus({ text: `已保存为模板「${meta.title}」，可在模板库中使用`, error: false });
  }

  if (loading) return <div className="workflow-loading"><span><Sparkles size={22} /></span><strong>正在载入工作流</strong><small>读取画布、节点与连接…</small></div>;
  // record 为空绝不进编辑器（WorkflowEditor 的 effect 依赖 record.id，null 会在渲染期崩溃）；
  // 刷新 ?view=editor 但恢复失败/未带 id 时在这里兜一帧，由上面的守卫 effect 收敛回库页
  if (view === "library" || !record) return <div className="workflow-studio-host"><WorkflowLibrary records={records} status={libraryStatus} onOpen={openRecord} onCreate={createWorkflow} onImport={importWorkflow} onOpenTemplates={onOpenTemplates} onDelete={deleteRecord} onSaveAsTemplate={saveAsTemplate} /><ImportReport report={importReport} onClose={() => setImportReport(null)} /></div>;
  return <WorkflowEditor key={editorKey} record={record} initialGraph={graph} models={workflowModels} selectedModel={selectedModel} onRecordChange={handleRecordChange} onBack={closeEditor} appendRequest={appendRequest} onAppendApplied={() => setAppendRequest(null)} />;
}

// 模板实例化：模板画布由「保存为模板」写入后端，按 id 读取真实 nodes/edges
async function resolveTemplateGraph(template) {
  const detail = Number(template.id) > 0 ? await getWorkflow(template.id).catch(() => null) : null;
  const stored = detail?.graph || {};
  return {
    nodes: Array.isArray(stored.nodes) ? stored.nodes : [],
    edges: Array.isArray(stored.edges) ? stored.edges : [],
  };
}

function templateRecord(template) {
  // 实例化出来的是一份普通工作流副本，不是模板：type 必须用模板分类（image/video/audio），
  // 若写 "template"，保存/点生成落库会变成一条新的模板记录——库页过滤 type!=='template' 导致
  // 用户看不到自己刚实例化的画布，且后端按模板口径要求 category，不带会 500。
  const category = ["image", "video", "audio"].includes(template.category) ? template.category : "image";
  return {
    id: `template-${template.id}-${template.token || Date.now()}`,
    title: template.title,
    type: category,
    // 模板记录上没有真实模型时留空：此前按 template.id 取模从模型目录里挑一个，纯属伪造
    model: template.modelLabel || "",
    models: Array.isArray(template.outputModels) ? template.outputModels.filter(Boolean) : [],
    nodes: template.nodeCount || 0,
    origin: "模板实例化",
    builtin: false,
  };
}
