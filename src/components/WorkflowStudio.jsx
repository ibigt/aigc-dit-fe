import {
  Background,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
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
  Film,
  FolderOpen,
  Group,
  Hand,
  Image,
  Layers3,
  LayoutGrid,
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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cancelWorkflowRun, createWorkflowRecord, getWorkflow, getWorkflowRun, listWorkflows, removeWorkflow, startWorkflowRun, updateWorkflowRecord } from "../api/workflows.js";
import { fetchAssets, uploadAsset } from "../api/assets.js";
import { validateAssetFile } from "../lib/assetUpload.js";
import { MEDIA_THUMB_WIDTH, mediaUrl, storageKeyOf } from "../lib/media.js";
import { MediaCover } from "../lib/MediaCover.jsx";
import { resolveAudioOptions } from "../lib/voices.js";
import SpecializedMediaNode from "./workflow/MediaGeneratorNode.jsx";
import SpecializedAudioNode from "./workflow/AudioGeneratorNode.jsx";
import SpecializedPromptNode from "./workflow/PromptNode.jsx";
import SpecializedEditingNode from "./workflow/VideoEditingNode.jsx";
import { WorkflowNodeContext } from "./workflow/WorkflowNodeContext.jsx";
import { NodeCollapseButton, NodeDeleteButton, NodeLockButton, nodeCollapsedClass } from "./workflow/NodeCardParts.jsx";
import { ImportReport } from "./workflow/ImportReport.jsx";
import StableTextarea from "./workflow/StableTextarea.jsx";
import { applyRunToCurrentNodes, applyWorkflowSnapshotToNodes, canConnectNodes, executeWorkflowRun, nodePreviewUrl, waitForWorkflowPoll, restoreWorkflowSnapshot, persistableWorkflowGraph as persistableGraph } from "./workflow/runtime.js";
import { getWorkflowRuntimeSnapshot } from "../api/workflows.js";
import { buildClipQueue } from "./workflow/timeline.js";
import { buildTitleUpdateBody, isWorkflowTitleChanged, normalizeWorkflowTitle } from "../lib/workflowTitle.js";
import { normalizeWorkflowVideoMode } from "../lib/modelCapabilities.js";
import { graphVariableScopes } from "./workflow/variables.js";
import { estimatedNodeHeight, placeQuickNode } from "./workflow/layout.js";
import { autoArrange } from "./workflow/autoLayout.js";
import { deserializeWorkflow, exportFileName, isComfyWorkflowDocument, isStandardWorkflowDocument, serializeWorkflow } from "./workflow/serializer.js";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { DemoSelect } from "./DemoSelect.jsx";
import { WorksTypeIcon } from "./WorksTypeIcon.jsx";

const GENERATOR_KINDS = ["ImageGenerator", "VideoGenerator", "AudioGenerator"];
const REFERENCE_LIMITS = { IMAGE: 30, VIDEO: 10, AUDIO: 10, VIDEO_SECONDS: 30 };

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
    model: item.modelLabel || "未选择",
    modelId: item.modelId,
    nodes: item.nodeCount ?? 0,
    updated: formatUpdated(item.updatedAt),
    origin: item.origin || (item.builtin ? "官方示例" : "我的工作流"),
    demo: item.demoKey || undefined,
    source: item.sourcePath || undefined,
    builtin: Boolean(item.builtin),
  };
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
};

function WorkflowThumbnail({ record, variant }) {
  const graph = thumbnailGraphs[variant % thumbnailGraphs.length];
  const patternId = `workflow-grid-${record.id}`;
  return (
    <svg className="workflow-canvas-thumb" viewBox="0 0 440 230" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><pattern id={patternId} width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" /></pattern></defs>
      <rect width="440" height="230" className="workflow-canvas-thumb__base" />
      <rect width="440" height="230" fill={`url(#${patternId})`} className="workflow-canvas-thumb__grid" />
      {graph.edges.map(([from, to], index) => {
        const source = graph.nodes[from];
        const target = graph.nodes[to];
        const x1 = source.x + source.w;
        const y1 = source.y + 22;
        const x2 = target.x;
        const y2 = target.y + 22;
        return <path key={`${from}-${to}-${index}`} d={`M ${x1} ${y1} C ${x1 + 34} ${y1}, ${x2 - 34} ${y2}, ${x2} ${y2}`} className="workflow-canvas-thumb__edge" />;
      })}
      {graph.nodes.map((node, index) => (
        <g key={`${node.label}-${index}`} className="workflow-canvas-thumb__node">
          <rect x={node.x} y={node.y} width={node.w} height="47" rx="5" />
          <path d={`M ${node.x + 5} ${node.y} H ${node.x + node.w - 5} Q ${node.x + node.w} ${node.y} ${node.x + node.w} ${node.y + 5} V ${node.y + 14} H ${node.x} V ${node.y + 5} Q ${node.x} ${node.y} ${node.x + 5} ${node.y}`} fill={thumbnailTones[node.tone]} />
          <text x={node.x + 7} y={node.y + 10}>{node.label}</text>
          <rect x={node.x + 8} y={node.y + 22} width={Math.max(27, node.w - 25)} height="5" rx="2.5" className="workflow-canvas-thumb__field" />
          <rect x={node.x + 8} y={node.y + 33} width={Math.max(20, node.w - 38)} height="4" rx="2" className="workflow-canvas-thumb__field workflow-canvas-thumb__field--short" />
          <circle cx={node.x} cy={node.y + 22} r="3" fill={thumbnailTones[node.tone]} />
          <circle cx={node.x + node.w} cy={node.y + 22} r="3" fill={thumbnailTones[node.tone]} />
        </g>
      ))}
    </svg>
  );
}

// 生成类节点的输入端口（与快速创作的能力一致）：
// 文本节点连到 prompt 端口作为提示词来源；图片/视频节点连到 reference/visual 端口作为参考素材。
// 端口名保持不变是为了兼容已保存工作流里的连线 targetHandle。
const MEDIA_NODE_INPUTS = [
  { name: "prompt", label: "提示词", type: "STRING" },
  { name: "reference", label: "参考素材", type: "MEDIA" },
];
const AUDIO_NODE_INPUTS = [
  { name: "prompt", label: "提示词", type: "STRING" },
  { name: "visual", label: "画面参考", type: "MEDIA" },
];
const EDITING_NODE_INPUTS = [
  { name: "video", label: "视频素材", type: "VIDEO" },
  { name: "audio", label: "音频素材", type: "AUDIO" },
];

const canvasQuickItems = [
  { id: "text", name: "文本", kind: "MarkdownNote", icon: Type, tone: "yellow", fields: [{ label: "内容", value: "", placeholder: "输入文本内容…", multiline: true }], outputs: [{ name: "TEXT", label: "文本", type: "STRING" }] },
  { id: "table", name: "表格", kind: "DataTable", icon: Table2, tone: "blue", fields: [{ label: "用途", value: "分镜表" }, { label: "列", value: "镜号、画面、台词、时长" }], outputs: [{ name: "TABLE", label: "表格", type: "DATA" }] },
  { id: "image", name: "图像", kind: "ImageGenerator", icon: Image, tone: "amber", inputs: MEDIA_NODE_INPUTS, outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }] },
  { id: "video", name: "视频", kind: "VideoGenerator", icon: Film, tone: "green", inputs: MEDIA_NODE_INPUTS, outputs: [{ name: "VIDEO", label: "视频", type: "VIDEO" }] },
  { id: "audio", name: "音频", kind: "AudioGenerator", icon: Volume2, tone: "violet", inputs: AUDIO_NODE_INPUTS, outputs: [{ name: "AUDIO", label: "音频", type: "AUDIO" }] },
  { id: "editing", name: "视频剪辑", kind: "VideoEditing", icon: Clapperboard, tone: "blue", inputs: EDITING_NODE_INPUTS },
];

const catalogGroups = [
  {
    name: "创意生成",
    items: [
      { name: "文本", kind: "MarkdownNote", icon: Type, tone: "yellow", source: "canvas", fields: [{ label: "内容", value: "", placeholder: "输入文本内容…", multiline: true }], outputs: [{ name: "TEXT", label: "提示词", type: "STRING" }] },
      { name: "表格", kind: "DataTable", icon: Table2, tone: "blue", source: "canvas", fields: [{ label: "用途", value: "分镜表" }, { label: "列", value: "镜号、画面、台词、时长" }], outputs: [{ name: "TABLE", label: "分镜表", type: "DATA" }] },
      { name: "图像生成", kind: "ImageGenerator", icon: Image, tone: "amber", source: "canvas", inputs: MEDIA_NODE_INPUTS, outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }] },
      { name: "视频生成", kind: "VideoGenerator", icon: Film, tone: "green", source: "canvas", inputs: MEDIA_NODE_INPUTS, outputs: [{ name: "VIDEO", label: "视频", type: "VIDEO" }] },
      { name: "音频生成", kind: "AudioGenerator", icon: Volume2, tone: "violet", source: "canvas", inputs: AUDIO_NODE_INPUTS, outputs: [{ name: "AUDIO", label: "音频", type: "AUDIO" }] },
      { name: "视频剪辑", kind: "VideoEditing", icon: Clapperboard, tone: "blue", source: "canvas", inputs: EDITING_NODE_INPUTS },
      { name: "参考音频", kind: "ReferenceAudio", icon: Volume2, tone: "violet", source: "canvas", outputs: [{ name: "AUDIO", label: "音频", type: "AUDIO" }], media: { type: "reference-audio", name: "尚未上传音频", url: "" } },
    ],
  },
  {
    name: "加载器",
    items: [
      { name: "加载模型", kind: "CheckpointLoaderSimple", icon: Box, tone: "rose", fields: [{ label: "模型文件", value: "wan2.2_t2v_high_noise.safetensors", options: ["wan2.2_t2v_high_noise.safetensors", "ltx-video-2b-v0.9.5.safetensors", "sd_xl_base_1.0.safetensors"] }], outputs: [{ name: "MODEL", label: "模型", type: "MODEL" }, { name: "CLIP", label: "文本编码器", type: "CLIP" }, { name: "VAE", label: "VAE", type: "VAE" }] },
      { name: "加载图像", kind: "LoadImage", icon: Image, tone: "amber", fields: [{ label: "图像文件", value: "transparent_rgb_gaming_mouse.png" }], outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }, { name: "MASK", label: "遮罩", type: "MASK" }] },
      { name: "加载 VAE", kind: "VAELoader", icon: Layers3, tone: "red", fields: [{ label: "VAE 名称", value: "wan2.2_vae.safetensors", options: ["wan2.2_vae.safetensors", "sdxl_vae.safetensors"] }], outputs: [{ name: "VAE", label: "VAE", type: "VAE" }] },
    ],
  },
  {
    name: "条件与潜空间",
    items: [
      { name: "正向提示词", kind: "CLIPTextEncode", icon: MessageSquareText, tone: "yellow", fields: [{ label: "提示词", value: "电影质感雨夜街景，柔和霓虹反光，稳定运镜", multiline: true }], inputs: [{ name: "clip", label: "文本编码器", type: "CLIP" }], outputs: [{ name: "CONDITIONING", label: "条件", type: "CONDITIONING" }] },
      { name: "负向提示词", kind: "CLIPTextEncode", icon: MessageSquareText, tone: "yellow", fields: [{ label: "提示词", value: "低清、闪烁、畸变、水印、过曝", multiline: true }], inputs: [{ name: "clip", label: "文本编码器", type: "CLIP" }], outputs: [{ name: "CONDITIONING", label: "条件", type: "CONDITIONING" }] },
      { name: "视频潜空间", kind: "EmptyHunyuanLatentVideo", icon: Film, tone: "pink", fields: [{ label: "宽度", value: "1280", inputType: "number" }, { label: "高度", value: "720", inputType: "number" }, { label: "帧数", value: "81", inputType: "number" }], outputs: [{ name: "LATENT", label: "潜空间", type: "LATENT" }] },
      { name: "图像潜空间", kind: "EmptyLatentImage", icon: Image, tone: "pink", fields: [{ label: "宽度", value: "1024", inputType: "number" }, { label: "高度", value: "1024", inputType: "number" }, { label: "批次", value: "1", inputType: "number" }], outputs: [{ name: "LATENT", label: "潜空间", type: "LATENT" }] },
    ],
  },
  {
    name: "采样与输出",
    items: [
      { name: "K 采样器", kind: "KSampler", icon: WandSparkles, tone: "violet", fields: [{ label: "随机种子", value: "908172635", inputType: "number" }, { label: "采样步数", value: "24", inputType: "number" }, { label: "引导系数", value: "6.0", inputType: "number" }, { label: "采样算法", value: "euler", options: ["euler", "euler_ancestral", "dpmpp_2m", "uni_pc"] }], inputs: [{ name: "model", label: "模型", type: "MODEL" }, { name: "positive", label: "正向条件", type: "CONDITIONING" }, { name: "negative", label: "反向条件", type: "CONDITIONING" }, { name: "latent_image", label: "潜空间", type: "LATENT" }], outputs: [{ name: "LATENT", label: "潜空间", type: "LATENT" }] },
      { name: "VAE 解码", kind: "VAEDecode", icon: Sparkles, tone: "red", fields: [{ label: "分块尺寸", value: "512", inputType: "number" }], inputs: [{ name: "samples", label: "采样结果", type: "LATENT" }, { name: "vae", label: "VAE", type: "VAE" }], outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }] },
      { name: "保存视频", kind: "SaveVideo", icon: Save, tone: "green", fields: [{ label: "文件名前缀", value: "LightFlow/video" }, { label: "格式", value: "mp4", options: ["mp4", "webm", "mov"] }], inputs: [{ name: "images", label: "图像序列", type: "IMAGE" }] },
      { name: "保存图像", kind: "SaveImage", icon: Save, tone: "blue", fields: [{ label: "文件名前缀", value: "LightFlow/image" }], inputs: [{ name: "images", label: "图像", type: "IMAGE" }] },
    ],
  },
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
// 返回 { ok, kind, graph, viewport, errors, warnings }；失败时不返回任何画布数据
export function parseWorkflowDocument(json) {
  if (isStandardWorkflowDocument(json)) {
    const result = deserializeWorkflow(json);
    if (!result.ok) return { ok: false, kind: "standard", errors: result.errors, warnings: result.warnings };
    return { ok: true, kind: "standard", graph: result.graph, viewport: result.viewport, errors: [], warnings: result.warnings };
  }
  if (isComfyWorkflowDocument(json)) {
    return { ok: true, kind: "comfy", graph: normalizeWorkflow(json), viewport: null, errors: [], warnings: [] };
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
        resolution: options.resolution || (isVideo ? "2K" : "2K"),
        quality: "高",
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

const referenceLibrary = [
  { key: "racer-first", title: "赛车首帧", type: "IMAGE", preview: "/media/quick-create/frames-racer-start.jpg" },
  { key: "racer-last", title: "赛车尾帧", type: "IMAGE", preview: "/media/quick-create/frames-racer-end.jpg" },
  { key: "neon-city", title: "霓虹城市", type: "IMAGE", preview: "/media/quick-create/video-neon-ride.jpg" },
  { key: "racer-video", title: "赛车动态参考", type: "VIDEO", preview: "/media/comfy-racer-poster.webp", url: "/media/comfy-racer.webm" },
  { key: "forest-video", title: "森林人物参考", type: "VIDEO", preview: "/media/drama/woman-forest.jpg", url: "/media/drama/woman-forest.mp4" },
];

function demoEdge(id, source, target, type) {
  return {
    id,
    source,
    target,
    sourceHandle: "output",
    targetHandle: "input",
    type: "bezier",
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(type), width: 14, height: 14 },
    style: { stroke: edgeColor(type), strokeWidth: 2.2 },
  };
}

function demoWorkflow(kind, models = []) {
  const promptNode = (id, position, title, value) => ({
    id,
    type: "comfy",
    position,
    style: { width: 320 },
    data: { title, kind: "MarkdownNote", tone: "gray", icon: Type, source: "canvas", enabled: true, fields: [{ label: "说明", value, multiline: true }], outputs: [{ name: "TEXT", label: "提示词", type: "STRING" }] },
  });
  if (kind === "image-to-video") {
    const nodes = [
      referenceAssetNode("first-frame", { x: 0, y: 0 }, referenceLibrary[0]),
      referenceAssetNode("last-frame", { x: 0, y: 330 }, referenceLibrary[1]),
      promptNode("brief", { x: 0, y: 660 }, "创意脚本", "同一场雨夜竞速：从首帧平滑过渡到尾帧，保持车辆、曝光、天气与电影感光线连续。"),
      mediaNode("hero-video", "video", { x: 470, y: 170 }, models, { preview: "/media/comfy-racer-poster.webp", mode: "参考帧", inputs: [{ name: "prompt", label: "提示词", type: "STRING" }, { name: "reference", label: "参考素材", type: "MEDIA" }] }),
      referenceAudioNode("reference-audio", { x: 470, y: 800 }),
      videoEditingNode("edit-video", { x: 940, y: 250 }, { inputs: [{ name: "video", label: "成片素材", type: "VIDEO" }], mode: "首尾拼接" }),
    ];
    const edges = [
      demoEdge("e-brief-video", "brief", "hero-video", "STRING", "TEXT", "prompt"),
      demoEdge("e-first-video", "first-frame", "hero-video", "IMAGE", "IMAGE", "reference"),
      demoEdge("e-last-video", "last-frame", "hero-video", "IMAGE", "IMAGE", "reference"),
      demoEdge("e-video-edit", "hero-video", "edit-video", "VIDEO", "VIDEO", "video"),
      demoEdge("e-audio-edit", "reference-audio", "edit-video", "AUDIO", "AUDIO", "audio"),
    ];
    return { nodes, edges };
  }

  if (kind === "shot-variations") {
    const nodes = [
      promptNode("shot-brief", { x: 0, y: 470 }, "镜头脚本", "同一人物从车站走向雨夜街头，分别生成近景情绪镜头与广角环境镜头，最终组合成短片。"),
      mediaNode("portrait", "image", { x: 430, y: 0 }, models, { preview: "/media/quick-create/frames-racer-start.jpg", ratio: "9:16" }),
      mediaNode("environment", "image", { x: 430, y: 570 }, models, { preview: "/media/quick-create/video-neon-ride.jpg" }),
      mediaNode("close-video", "video", { x: 900, y: 0 }, models, { model: "LTX2.3", ratio: "9:16", inputs: [{ name: "prompt", label: "脚本", type: "STRING" }, { name: "reference", label: "参考素材", type: "MEDIA" }] }),
      mediaNode("wide-video", "video", { x: 900, y: 700 }, models, { model: "LTX2.3", inputs: [{ name: "prompt", label: "脚本", type: "STRING" }, { name: "reference", label: "参考素材", type: "MEDIA" }] }),
      videoEditingNode("edit", { x: 1380, y: 470 }, { inputs: [{ name: "clip_a", label: "近景镜头", type: "VIDEO" }, { name: "clip_b", label: "广角镜头", type: "VIDEO" }], mode: "紧凑气口" }),
    ];
    const edges = [
      demoEdge("e-p-p", "shot-brief", "portrait", "STRING", "TEXT", "prompt"), demoEdge("e-p-e", "shot-brief", "environment", "STRING", "TEXT", "prompt"),
      demoEdge("e-p-c", "portrait", "close-video", "IMAGE", "IMAGE", "reference"), demoEdge("e-e-w", "environment", "wide-video", "IMAGE", "IMAGE", "reference"),
      demoEdge("e-c-edit", "close-video", "edit", "VIDEO", "VIDEO", "clip_a"), demoEdge("e-w-edit", "wide-video", "edit", "VIDEO", "VIDEO", "clip_b"),
    ];
    return { nodes, edges };
  }

  if (kind === "image-board") {
    const nodes = [promptNode("board-brief", { x: 0, y: 420 }, "分镜描述", "废土公路追逐段落：建立镜头、车辆特写、人物近景与远景收束，保持角色和美术风格一致。")];
    const previews = ["/media/quick-create/video-wildlife.jpg", "/media/quick-create/image-product.jpg", "/media/quick-create/image-fashion.jpg", "/media/quick-create/video-neon-ride.jpg"];
    const imageNodes = previews.map((preview, index) => mediaNode(`board-${index + 1}`, "image", { x: 430, y: index * 560 }, models, { preview, prompt: `镜头 ${index + 1}，电影级分镜画面，统一角色与色彩` }));
    const nodesWithOutput = [...nodes, ...imageNodes, { id: "board-table", type: "comfy", position: { x: 910, y: 820 }, data: { title: "分镜表", kind: "DataTable", tone: "blue", icon: Table2, source: "canvas", enabled: true, inputs: imageNodes.map((_, index) => ({ name: `shot_${index + 1}`, label: `镜头 ${index + 1}`, type: "IMAGE" })), outputs: [{ name: "TABLE", label: "分镜数据", type: "DATA" }], fields: [{ label: "列", value: "镜号、画面、台词、时长" }] } }];
    const edges = imageNodes.flatMap((node, index) => [demoEdge(`e-brief-${index}`, "board-brief", node.id, "STRING", "TEXT", "prompt"), demoEdge(`e-board-${index}`, node.id, "board-table", "IMAGE", "IMAGE", `shot_${index + 1}`)]);
    return { nodes: nodesWithOutput, edges };
  }

  if (kind === "sdxl-restore") {
    const nodes = [
      { id: "restore-model", type: "comfy", position: { x: 0, y: 240 }, style: { width: 270 }, data: { title: "加载模型", kind: "CheckpointLoaderSimple", tone: "rose", icon: Box, source: "comfy-core", enabled: true, fields: [{ label: "模型文件", value: "sd_xl_base_1.0.safetensors" }], outputs: [{ name: "MODEL", label: "模型", type: "MODEL" }, { name: "CLIP", label: "文本编码器", type: "CLIP" }, { name: "VAE", label: "VAE", type: "VAE" }] } },
      { id: "restore-positive", type: "comfy", position: { x: 0, y: 0 }, style: { width: 270 }, data: { title: "正向提示词", kind: "CLIPTextEncode", tone: "yellow", icon: MessageSquareText, source: "comfy-core", enabled: true, fields: [{ label: "提示词", value: "高清修复后的产品静物，锐利边缘，真实材质细节", multiline: true }], inputs: [{ name: "clip", label: "文本编码器", type: "CLIP" }], outputs: [{ name: "CONDITIONING", label: "条件", type: "CONDITIONING" }] } },
      { id: "restore-negative", type: "comfy", position: { x: 0, y: 480 }, style: { width: 270 }, data: { title: "负向提示词", kind: "CLIPTextEncode", tone: "yellow", icon: MessageSquareText, source: "comfy-core", enabled: true, fields: [{ label: "提示词", value: "blurry, deformed fingers, watermark, low quality", multiline: true }], inputs: [{ name: "clip", label: "文本编码器", type: "CLIP" }], outputs: [{ name: "CONDITIONING", label: "条件", type: "CONDITIONING" }] } },
      { id: "restore-source", type: "comfy", position: { x: 330, y: 240 }, style: { width: 286 }, data: { title: "加载图像", kind: "LoadImage", tone: "amber", icon: Image, source: "comfy-core", enabled: true, preview: "/media/quick-create/image-product.jpg", fields: [{ label: "图像", value: "transparent_rgb_gaming_mouse.png" }], outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }, { name: "MASK", label: "遮罩", type: "MASK" }] } },
      { id: "restore-scale", type: "comfy", position: { x: 660, y: 240 }, style: { width: 270 }, data: { title: "图像按总像素缩放", kind: "ImageScaleToTotalPixels", tone: "pink", icon: LayoutGrid, source: "comfy-core", enabled: true, fields: [{ label: "缩放算法", value: "lanczos" }, { label: "总百万像素", value: "4" }, { label: "尺寸倍数", value: "8" }], inputs: [{ name: "image", label: "图像", type: "IMAGE" }], outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }] } },
      { id: "restore-sampler", type: "comfy", position: { x: 990, y: 240 }, style: { width: 270 }, data: { title: "K 采样器", kind: "KSampler", tone: "violet", icon: WandSparkles, source: "comfy-core", enabled: true, fields: [{ label: "随机种子", value: "812734" }, { label: "采样步数", value: "28", inputType: "number" }, { label: "引导系数", value: "6.5", inputType: "number" }, { label: "采样算法", value: "dpmpp_2m" }], inputs: [{ name: "model", label: "模型", type: "MODEL" }, { name: "positive", label: "正向条件", type: "CONDITIONING" }, { name: "negative", label: "反向条件", type: "CONDITIONING" }, { name: "latent_image", label: "潜空间", type: "LATENT" }], outputs: [{ name: "LATENT", label: "潜空间", type: "LATENT" }] } },
      { id: "restore-decode", type: "comfy", position: { x: 1310, y: 240 }, style: { width: 270 }, data: { title: "VAE 解码", kind: "VAEDecode", tone: "red", icon: Sparkles, source: "comfy-core", enabled: true, fields: [{ label: "分块尺寸", value: "512", inputType: "number" }], inputs: [{ name: "samples", label: "采样结果", type: "LATENT" }, { name: "vae", label: "VAE", type: "VAE" }], outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }] } },
      { id: "restore-save", type: "comfy", position: { x: 1630, y: 240 }, style: { width: 270 }, data: { title: "保存图像", kind: "SaveImage", tone: "blue", icon: Save, source: "comfy-core", enabled: true, fields: [{ label: "文件名前缀", value: "LightFlow/restored" }], inputs: [{ name: "images", label: "图像", type: "IMAGE" }] } },
    ];
    const edges = [
      demoEdge("e-r-model-sampler", "restore-model", "restore-sampler", "MODEL", "MODEL", "model"),
      demoEdge("e-r-model-positive", "restore-model", "restore-positive", "CLIP", "CLIP", "clip"),
      demoEdge("e-r-model-negative", "restore-model", "restore-negative", "CLIP", "CLIP", "clip"),
      demoEdge("e-r-source-scale", "restore-source", "restore-scale", "IMAGE", "IMAGE", "image"),
      demoEdge("e-r-scale-sampler", "restore-scale", "restore-sampler", "IMAGE", "IMAGE", "latent_image"),
      demoEdge("e-r-positive-sampler", "restore-positive", "restore-sampler", "CONDITIONING", "CONDITIONING", "positive"),
      demoEdge("e-r-negative-sampler", "restore-negative", "restore-sampler", "CONDITIONING", "CONDITIONING", "negative"),
      demoEdge("e-r-sampler-decode", "restore-sampler", "restore-decode", "LATENT", "LATENT", "samples"),
      demoEdge("e-r-model-decode", "restore-model", "restore-decode", "VAE", "VAE", "vae"),
      demoEdge("e-r-decode-save", "restore-decode", "restore-save", "IMAGE", "IMAGE", "images"),
    ];
    return { nodes, edges };
  }

  const nodes = [
    promptNode("text", { x: 0, y: 180 }, "视频提示词", "晨雾中的山谷列车缓慢穿行，航拍镜头平稳推进，真实自然光。"),
    mediaNode("video", "video", { x: 450, y: 90 }, models, { model: kind === "text-to-video" ? "Wan2.2" : undefined, inputs: [{ name: "prompt", label: "提示词", type: "STRING" }] }),
    videoEditingNode("edit", { x: 920, y: 100 }, { inputs: [{ name: "video", label: "视频素材", type: "VIDEO" }], mode: "智能对齐" }),
  ];
  return { nodes, edges: [demoEdge("e-text-video", "text", "video", "STRING", "TEXT", "prompt"), demoEdge("e-video-edit", "video", "edit", "VIDEO", "VIDEO", "video")] };
}

function localWorkflow() {
  const nodes = [
    { id: "checkpoint", type: "comfy", position: { x: 0, y: 230 }, data: { title: "加载模型", kind: "CheckpointLoaderSimple", tone: "rose", icon: Box, source: "comfy-core", enabled: true, fields: [{ label: "模型文件", value: "wan2.2_t2v_high_noise.safetensors" }] } },
    { id: "positive", type: "comfy", position: { x: 310, y: 40 }, data: { title: "正向提示词", kind: "CLIPTextEncode", tone: "yellow", icon: MessageSquareText, source: "comfy-core", enabled: true, fields: [{ label: "提示词", value: "未来城市雨夜，镜头低角度缓慢推进", multiline: true }] } },
    { id: "negative", type: "comfy", position: { x: 310, y: 310 }, data: { title: "负向提示词", kind: "CLIPTextEncode", tone: "yellow", icon: MessageSquareText, source: "comfy-core", enabled: true, fields: [{ label: "提示词", value: "blurry, watermark, low quality", multiline: true }] } },
    { id: "latent", type: "comfy", position: { x: 320, y: 525 }, data: { title: "空白视频潜空间", kind: "EmptyHunyuanLatentVideo", tone: "pink", icon: Film, source: "comfy-core", enabled: true, fields: [{ label: "宽度", value: "1280", inputType: "number" }, { label: "高度", value: "720", inputType: "number" }, { label: "帧数", value: "81", inputType: "number" }] } },
    { id: "sampler", type: "comfy", position: { x: 680, y: 210 }, data: { title: "K 采样器", kind: "KSampler", tone: "violet", icon: WandSparkles, source: "comfy-core", enabled: true, fields: [{ label: "随机种子", value: "1092152731" }, { label: "采样步数", value: "24", inputType: "number" }, { label: "引导系数", value: "6.0", inputType: "number" }, { label: "采样算法", value: "euler" }] } },
    { id: "decode", type: "comfy", position: { x: 1010, y: 245 }, data: { title: "VAE 解码", kind: "VAEDecode", tone: "red", icon: Image, source: "comfy-core", enabled: true, fields: [{ label: "分块尺寸", value: "512", inputType: "number" }] } },
    { id: "video", type: "comfy", position: { x: 1305, y: 205 }, data: { title: "创建视频", kind: "CreateVideo", tone: "green", icon: Film, source: "comfy-core", enabled: true, fields: [{ label: "帧率", value: "24", inputType: "number" }] } },
    { id: "save", type: "comfy", position: { x: 1590, y: 205 }, data: { title: "保存视频", kind: "SaveVideo", tone: "blue", icon: Save, source: "comfy-core", enabled: true, fields: [{ label: "文件名前缀", value: "LightFlow/city-film" }, { label: "编码", value: "h264" }] } },
    { id: "preview", type: "comfy", position: { x: 1305, y: 455 }, data: { title: "预览输出", kind: "PreviewVideo", tone: "green", icon: Film, source: "致启节点", enabled: true, preview: "/media/comfy-racer-poster.webp", fields: [{ label: "状态", value: "最近运行成功" }] } },
  ];
  const pairs = [["checkpoint", "positive", "CLIP"], ["checkpoint", "negative", "CLIP"], ["checkpoint", "sampler", "MODEL"], ["positive", "sampler", "CONDITIONING"], ["negative", "sampler", "CONDITIONING"], ["latent", "sampler", "LATENT"], ["sampler", "decode", "LATENT"], ["decode", "video", "IMAGE"], ["video", "save", "VIDEO"], ["video", "preview", "VIDEO"]];
  const edges = pairs.map(([source, target, kind], index) => ({ id: `local-${index}`, source, target, sourceHandle: "output", targetHandle: "input", type: "bezier", style: { stroke: edgeColor(kind), strokeWidth: 2.2 } }));
  return { nodes, edges };
}

const NodeEditContext = createContext({
  updateField: () => {},
  updateMedia: () => {},
  generateMedia: () => {},
  notify: () => {},
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

function ComfyNode({ id, data, selected }) {
  if (["ImageGenerator", "VideoGenerator"].includes(data.kind)) return <SpecializedMediaNode id={id} data={data} selected={selected} />;
  if (data.kind === "AudioGenerator") return <SpecializedAudioNode id={id} data={data} selected={selected} />;
  if (data.kind === "ReferenceAudio") return <ReferenceAudioNode id={id} data={data} selected={selected} />;
  if (data.kind === "VideoEditing") return <SpecializedEditingNode id={id} data={data} selected={selected} />;
  const Icon = resolveNodeIcon(data.icon, data.kind);
  const hasInputs = Array.isArray(data.inputs) ? data.inputs.length > 0 : !["CheckpointLoaderSimple", "LoadImage", "MarkdownNote", "ReferenceAsset"].includes(data.kind);
  const hasOutputs = Array.isArray(data.outputs) ? data.outputs.length > 0 : !["SaveImage", "SaveVideo", "VideoEditing"].includes(data.kind);
  const fields = (data.fields && data.fields.length)
    ? data.fields
    : ["MarkdownNote", "Prompt"].includes(data.kind)
      ? [{ label: "内容", value: data.prompt || data.media?.prompt || "", placeholder: "输入文本内容…", multiline: true }]
      : [];
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
      {data.preview && (data.kind === "ReferenceAsset" ? <div className="comfy-node__asset-preview"><img src={data.preview} alt={`${data.title}预览`} />{data.assetType === "VIDEO" && <span><Film size={12} />视频素材</span>}</div> : <img className="comfy-node__preview" src={data.preview} alt="节点输入预览" />)}
      <div className="comfy-node__fields">
        {fields.map((field, index) => <ComfyField key={`${field.label}-${index}`} nodeId={id} field={field} index={index} />)}
      </div>
      <footer><span>{data.source === "canvas" ? "光驭画布节点" : "ComfyUI 节点"}</span><small>{data.source === "comfy-core" ? "核心" : data.source === "canvas" ? "画布" : data.source || "扩展"}</small></footer>
    </div>
  );
}

const GROUP_COLORS = ["#7584ff", "#349064", "#be5570", "#b97a14", "#aa559f", "#4e66cf"];

function GroupFrame({ data, selected }) {
  const frameStyle = data.color ? { borderColor: data.color, background: `${data.color}14` } : undefined;
  return <div className={`canvas-group-frame ${selected ? "is-selected" : ""}`} style={frameStyle}><span><Group size={13} />{data.label || "节点组合"}</span></div>;
}

const nodeTypes = { comfy: ComfyNode, groupFrame: GroupFrame };

const WORKFLOW_KINDS = { image: "图片", video: "视频", audio: "语音", import: "导入", template: "模板" };

// 主页沿用「我的创作」（works-page）的卡片、类型页签与搜索框风格
function WorkflowLibrary({ records, status, onOpen, onCreate, onImport, onOpenTemplates, onDelete }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const fileRef = useRef(null);
  const searchRef = useRef(null);
  const visible = records.filter((item) => (filter === "all" || item.type === filter) && `${item.title}${item.model}`.toLowerCase().includes(query.toLowerCase()));

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
        <div><h1>高级工作台</h1><p>选择一个工作流继续编辑，或从空白与模板开始搭建。</p></div>
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
            <kbd aria-hidden="true">/</kbd>
          </label>
        </div>
      </div>

      {status && <p className={`workflow-library__status${status.error ? " is-error" : ""}`}>{status.text}</p>}

      {!status && records.length === 0 ? (
        <div className="works-empty">
          <div className="works-empty-icon" aria-hidden="true"><Layers3 size={28} /></div>
          <h2>暂无工作流</h2>
          <p>从空白画布开始搭建，或导入 ComfyUI / 工作台 JSON 模板。</p>
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
                <span className="work-spec">{record.nodes} 个节点</span>
                <span className="work-kind">{record.builtin ? "官方示例" : WORKFLOW_KINDS[record.type] || "工作流"}</span>
                <span className="workflow-cover-open" aria-hidden="true"><CirclePlay size={15} /> 打开工作流</span>
              </button>
              <div className="work-card-body">
                <h3 title={record.title}>{record.title}</h3>
                <div className="work-model" title={record.model}>{record.model}</div>
                <p>{record.description || (record.builtin ? "官方示例工作流，可直接运行。" : "暂无描述。")}</p>
              </div>
              <footer className="work-card-footer">
                <span><CalendarDays size={12} /> {record.updated}</span>
                {!record.builtin && (
                  <div className="work-actions">
                    <button type="button" className="is-danger" aria-label={`删除工作流：${record.title}`} title="删除" onClick={() => { setDeleteError(null); setDeleteTarget(record); }}><Trash2 size={16} /></button>
                  </div>
                )}
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
    </section>
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
  const data = { ...(node.data || {}), runtime: undefined };
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
  return { ...node, type: "comfy", style, data };
}

function WorkflowEditor({ record, initialGraph, onBack, models, selectedModel, onRecordChange, appendRequest, onAppendApplied }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(() => (initialGraph.nodes || []).map((node) => hydrateStoredNode(node, models)));
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges || []);
  const [canvasTool, setCanvasTool] = useState("select");
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [runTotal, setRunTotal] = useState(0);
  const [saved, setSaved] = useState(true);
  // 返回拦截：dirty 画布直接返回会丢草稿，先弹三选一确认
  const [backGuard, setBackGuard] = useState(false);
  const [savingBack, setSavingBack] = useState(false);
  const [flowInstance, setFlowInstance] = useState(null);
  const [toast, setToast] = useState("");
  const [addMenu, setAddMenu] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [edgeMenu, setEdgeMenu] = useState(null);
  const [comfyMenuOpen, setComfyMenuOpen] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  const [tidyMenuOpen, setTidyMenuOpen] = useState(false);
  const [includeConnected, setIncludeConnected] = useState(false);
  const [referencePickerNodeId, setReferencePickerNodeId] = useState(null);
  // 弹框目标位：null=添加参考素材；"first"/"last"=选首帧/尾帧（参考帧档的显式图框）
  const [referencePickerSlot, setReferencePickerSlot] = useState(null);
  // 参考素材弹框「素材库」分区：真实素材库数据（null=未加载），只列图片/视频
  const [referenceAssets, setReferenceAssets] = useState(null);
  const [referenceAssetsError, setReferenceAssetsError] = useState("");
  const [importReport, setImportReport] = useState(null);
  // 标题行内重命名：草稿 + 编辑态，提交后回写 record 并按需落库
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(() => normalizeWorkflowTitle(record?.title));
  const titleInputRef = useRef(null);
  const titleEditingRef = useRef(false);
  // TC-008 环路高亮：瞬态渲染态，不参与撤销栈与持久化
  const [cycleHighlight, setCycleHighlight] = useState(null);
  const cycleHighlightTimer = useRef(null);
  const fileRef = useRef(null);
  const materialRef = useRef(null);
  const materialPoint = useRef(null);
  const zoomLabelRef = useRef(null);
  const runLock = useRef(false);
  const runAbortRef = useRef(null);
  const notifiedFailuresRef = useRef(new Set());
  const lastRunIdRef = useRef(null);
  const referenceUploadRef = useRef(null);
  const stageRef = useRef(null);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const nodeClipboardRef = useRef(null);
  useEffect(() => () => { runAbortRef.current?.abort(); window.clearTimeout(cycleHighlightTimer.current); }, []);
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
  // 返回 "saved" | "skip"（未落库的新画布/官方示例）| "error"
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
  const snapshotGraph = useCallback(() => ({ nodes: nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data } })), edges: edges.map((edge) => ({ ...edge })) }), [nodes, edges]);
  const rememberGraph = useCallback(() => { historyRef.current = [...historyRef.current.slice(-39), snapshotGraph()]; futureRef.current = []; }, [snapshotGraph]);
  // showToast 的清理定时器：新 toast 先清旧的，避免前一条的定时器把后一条提前清空（挂引用后马上点生成必现）
  const toastTimer = useRef(null);
  const showToast = useCallback((message, duration = 1800) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), duration);
  }, []);
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
    if (!cycleHighlight) return edges;
    return edges.map((edge) => cycleHighlight.edgeIds.has(edge.id)
      ? { ...edge, animated: true, style: { ...(edge.style || {}), stroke: "#ef4444", strokeWidth: 2.6 } }
      : edge);
  }, [edges, cycleHighlight]);
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
    const workflowId = Number(record.id);
    if (!Number.isFinite(workflowId) || workflowId <= 0 || record.builtin) return;
    const controller = new AbortController();
    runAbortRef.current = controller;
    runLock.current = true;
    restoreWorkflowSnapshot({ workflowId, signal: controller.signal, snapshot: getWorkflowRuntimeSnapshot, get: getWorkflowRun,
      onSnapshot: (snapshot) => {
        lastRunIdRef.current = snapshot.latestRunId;
        setNodes((current) => applyWorkflowSnapshotToNodes(current, snapshot));
        setRunning(snapshot.activeRuns?.some((run) => run.status === "RUNNING") || false);
        setRunProgress(snapshot.steps.filter((step) => step.status === "SUCCEEDED").length);
        setRunTotal(snapshot.steps.length || 1);
      },
    }).catch((error) => { if (!controller.signal.aborted) showToast(error.message || "运行恢复失败，请重新打开工作流", 3600); })
      .finally(() => {
        if (runAbortRef.current === controller) { runAbortRef.current = null; runLock.current = false; }
        if (!controller.signal.aborted) setRunning(false);
      });
    return () => controller.abort();
  }, [record.id, record.builtin, setNodes, showToast]);
  const onConnect = useCallback((params) => {
    if (!canConnectNodes(nodes, params)) {
      const sourceNode = nodes.find((node) => node.id === params.source);
      showToast(sourceNode?.data?.kind === "VideoEditing" ? "视频剪辑是终点节点，不可作为上游连接下游" : "连线不兼容：端口类型不匹配，无法连接");
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
        throw new Error("文件不是合法的 JSON");
      }
      parsed = parseWorkflowDocument(json);
    } catch (error) {
      setImportReport({ fileName: file.name, errors: [error.message || "文件读取失败"], warnings: [] });
      return;
    }
    if (!parsed.ok) {
      setImportReport({ fileName: file.name, errors: parsed.errors, warnings: parsed.warnings });
      return;
    }
    rememberGraph();
    setNodes(parsed.graph.nodes);
    setEdges(parsed.graph.edges);
    setSaved(false);
    window.setTimeout(() => {
      if (parsed.viewport) flowInstance?.setViewport(parsed.viewport, { duration: 320 });
      else flowInstance?.fitView({ padding: 0.14, duration: 320 });
    }, 80);
    if (parsed.warnings.length) setImportReport({ fileName: file.name, errors: [], warnings: parsed.warnings });
    showToast(parsed.kind === "standard" ? "已导入工作流 JSON，可撤销" : "已导入 ComfyUI 工作流，可撤销", 2600);
  }

  function createComfyWorkflow() {
    rememberGraph();
    setNodes([]);
    setEdges([]);
    setSaved(false);
    setAddMenu(null);
    setComfyMenuOpen(false);
    showToast("已创建空白 ComfyUI 工作流");
  }

  const updateNodeField = useCallback((nodeId, fieldIndex, value) => {
    setNodes((items) => items.map((node) => node.id === nodeId ? {
      ...node,
      data: { ...node.data, fields: node.data.fields.map((field, index) => index === fieldIndex ? { ...field, value } : field) },
    } : node));
    setSaved(false);
  }, [setNodes]);

  const updateNodeMedia = useCallback((nodeId, patch, { silent } = {}) => {
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
  }, [setNodes]);

  const selectOutput = useCallback((nodeId, index) => updateNodeMedia(nodeId, { selectedOutputIndex: index, outputIndex: index }), [updateNodeMedia]);

  // 删除节点（需求 4.2.5）：连同挂接的连线一起清理；先记历史，Ctrl+Z 可撤销
  const removeNodeById = useCallback((nodeId) => {
    rememberGraph();
    setNodes((items) => items.filter((node) => node.id !== nodeId));
    setEdges((items) => items.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNodeIds((ids) => ids.filter((id) => id !== nodeId));
    setSaved(false);
    showToast("已删除节点，Ctrl+Z 可撤销");
  }, [rememberGraph, setNodes, setEdges, setSelectedNodeIds, setSaved, showToast]);

  const updatePrompt = useCallback((nodeId, patch) => {
    setNodes((items) => items.map((node) => node.id === nodeId ? { ...node, data: {
      ...node.data,
      media: { ...node.data.media, ...patch },
      fields: patch.prompt === undefined ? node.data.fields : [{ label: "提示词", value: patch.prompt, multiline: true }, ...(node.data.fields || []).slice(1)],
    } } : node));
    setSaved(false);
  }, [setNodes]);

  const updateClips = useCallback((nodeId, clips) => {
    setNodes((items) => items.map((node) => node.id === nodeId ? { ...node, data: {
      ...node.data,
      media: { ...node.data.media, clips },
      editing: { ...node.data.editing, clips },
    } } : node));
    setSaved(false);
  }, [setNodes]);

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

  // 节点锁定（需求 4.1.2.5）：锁定后画布层 draggable/deletable=false，仅保留选中与连线
  const toggleLock = useCallback((nodeId) => {
    setNodes((items) => items.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, locked: !node.data?.locked } } : node));
    setSaved(false);
  }, [setNodes, setSaved]);

  // 节点折叠（需求 4.1.2.6）：折叠后仅显示标题栏与端口
  const toggleCollapse = useCallback((nodeId) => {
    setNodes((items) => items.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, collapsed: !node.data?.collapsed } } : node));
    setSaved(false);
  }, [setNodes, setSaved]);

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
    return runGraph(nodeId);
  }, [nodes, edges, selectedModel, record, running, setNodes, showToast]);

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
          preview: nodePreviewUrl(source) || "",
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
        updateNodeMedia(targetId, { referenceAssets: list.filter((item) => item?.storageKey !== storageKey) });
        showToast("已移除参考素材");
      }
      return;
    }
    rememberGraph();
    setEdges((items) => items.filter((edge) => !(edge.target === targetId && edge.source === sourceId)));
    setSaved(false);
    showToast("已移除连线");
  }, [nodes, rememberGraph, setEdges, setSaved, showToast, updateNodeMedia]);

  const referenceLimitMessage = useCallback((targetId, type, durationSec = 0) => {
    const usage = referenceUsageOf(getReferences(targetId));
    if (type === "IMAGE" && usage.IMAGE.count >= REFERENCE_LIMITS.IMAGE) {
      return `参考图已达上限 ${REFERENCE_LIMITS.IMAGE} 张`;
    }
    if (type === "AUDIO" && usage.AUDIO.count >= REFERENCE_LIMITS.AUDIO) {
      return `参考音频已达上限 ${REFERENCE_LIMITS.AUDIO} 段`;
    }
    if (type === "VIDEO") {
      const nextSeconds = usage.VIDEO.seconds + (Number(durationSec) || 0);
      if (usage.VIDEO.count >= REFERENCE_LIMITS.VIDEO) {
        return `参考视频已达上限 ${REFERENCE_LIMITS.VIDEO} 段`;
      }
      if (nextSeconds > REFERENCE_LIMITS.VIDEO_SECONDS) {
        return `参考视频总时长将超过 ${REFERENCE_LIMITS.VIDEO_SECONDS} 秒`;
      }
    }
    return "";
  }, [getReferences]);

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
    updateNodeMedia(nodeId, { frames });
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
      showToast("参考帧模式只使用首帧/尾帧图框，请先切回「参考视频」模式再添加参考素材");
      return;
    }
    const limitMessage = referenceLimitMessage(targetId, asset.type, asset.durationSec);
    if (limitMessage) {
      showToast(limitMessage);
      return;
    }
    const list = Array.isArray(target.data?.media?.referenceAssets) ? target.data.media.referenceAssets : [];
    if (list.some((item) => item?.storageKey === asset.key)) {
      showToast("该素材已在参考列表中");
      return;
    }
    rememberGraph();
    updateNodeMedia(targetId, {
      referenceAssets: [...list, {
        storageKey: asset.key,
        title: asset.title || "参考素材",
        type: asset.type === "VIDEO" ? "video" : asset.type === "AUDIO" ? "audio" : "image",
        durationSec: Number(asset.durationSec) || 0,
        // 只存原始 key：预览地址渲染时用 mediaUrl 重建（带当前 token），保存的图里不落死 URL
        posterKey: asset.posterKey || storageKeyOf(asset.preview || ""),
      }],
    });
    showToast(`已添加${asset.type === "VIDEO" ? "视频" : asset.type === "AUDIO" ? "音频" : "图片"}参考素材`);
  }, [nodes, referenceLimitMessage, rememberGraph, setNodes, showToast, updateNodeMedia]);

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
    setNodes((items) => items.map((node) => (node.id === id ? { ...node, data: { ...node.data, label } } : node)));
    setSaved(false);
  }, [setNodes, setSaved]);

  const setGroupColor = useCallback((color) => {
    if (!selectedGroupId) return;
    rememberGraph();
    setNodes((items) => items.map((node) => (node.id === selectedGroupId ? { ...node, data: { ...node.data, color } } : node)));
    setSaved(false);
    showToast("已更新组合颜色");
  }, [selectedGroupId, rememberGraph, setNodes, setSaved, showToast]);

  const nodeEditApi = useMemo(() => ({
    updateField: updateNodeField,
    updateMedia: updateNodeMedia,
    generateMedia: generateNodeMedia,
    notify: showToast,
    getReferences,
    removeReference,
    openReferencePicker: openReferencePicker,
  }), [updateNodeField, updateNodeMedia, generateNodeMedia, showToast, getReferences, removeReference, openReferencePicker]);

  const workflowNodeApi = useMemo(() => ({
    getVariableScopes: (nodeId) => graphVariableScopes(nodes, edges, nodeId),
    updateMedia: updateNodeMedia,
    updatePrompt,
    updateClips,
    selectOutput,
    generateMedia: generateNodeMedia,
    execute: generateNodeMedia,
    notify: showToast,
    remove: removeNodeById,
    uploadAudio,
    getClips,
    getEditingSources,
    toggleLock,
    toggleCollapse,
    getReferences,
    getPromptSupplements,
    removeReference,
    openReferencePicker: openReferencePicker,
    running,
    models,
  }), [nodes, edges, updateNodeMedia, updatePrompt, updateClips, selectOutput, generateNodeMedia, showToast, removeNodeById, uploadAudio, getClips, getEditingSources, toggleLock, toggleCollapse, getReferences, getPromptSupplements, removeReference, openReferencePicker, running, models]);

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
  const formatReferenceUsage = (type, limit) => `${pickerUsage[type].count}/${limit}${type === "VIDEO" ? ` 段 / ${pickerUsage.VIDEO.seconds}/${REFERENCE_LIMITS.VIDEO_SECONDS}s` : ""}`;
  const pickerQuotaText = pickerSlotLabel
    ? "仅支持图片素材"
    : pickerIsImageNode
      ? `已选参考图 ${formatReferenceUsage("IMAGE", REFERENCE_LIMITS.IMAGE)}`
      : pickerAcceptsVideo
        ? `已选 图 ${formatReferenceUsage("IMAGE", REFERENCE_LIMITS.IMAGE)} · 视频 ${formatReferenceUsage("VIDEO", REFERENCE_LIMITS.VIDEO)}${pickerAcceptsAudio ? ` · 音频 ${formatReferenceUsage("AUDIO", REFERENCE_LIMITS.AUDIO)}` : ""}`
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
    const runId = lastRunIdRef.current;
    if (!runId) return;
    try {
      // 先让后端收敛运行状态，再停本地轮询：反过来先 abort，轮询拿不到 CANCELLED 终态，
      // 节点卡片会一直停在「生成中」，且停止失败时前端已无法感知后端仍在跑
      const run = await cancelWorkflowRun(runId);
      if (run?.steps) applyRunToCurrentNodes(setNodes, run);
      showToast("已停止运行", 2400);
    } catch (error) {
      showToast(error.message || "停止请求发送失败", 3000);
    } finally {
      runAbortRef.current?.abort();
    }
  }

  async function runGraph(nodeId) {
    const onlyNode = typeof nodeId === "string" ? nodeId : undefined;
    // 单节点运行优先用节点自己选的模型（后端 resolveModel 也会按节点模型名解析，
    // 这里的 modelId 只是兜底），否则退回工具条上选的运行模型
    const nodeModelId = onlyNode ? nodeModelIdOf(onlyNode) : undefined;
    const modelId = nodeModelId || Number(selectedModel);
    if (!modelId) {
      showToast(onlyNode ? "该节点没有可用模型，请在卡片里选一个模型" : "请先选择运行模型", 2800);
      return;
    }
    // 参考帧（i2v）校验：没有任何首帧来源时后端会降级成参考生视频，运行前先拦住（单节点与整图运行都查）。
    // 首帧来源 = 显式图框（media.frames.firstKey），或连入的图片 / 上游视频生成节点（取其尾帧）；尾帧可选
    const framesTargets = onlyNode
      ? nodes.filter((node) => node.id === onlyNode)
      : nodes.filter((node) => node.data?.enabled !== false);
    const framesMissing = framesTargets.find((node) => {
      const isVideoNode = node.data?.kind === "VideoGenerator" || node.data?.media?.type === "video";
      if (!isVideoNode || normalizeWorkflowVideoMode(node.data?.media?.mode) !== "参考帧") return false;
      if (node.data?.media?.frames?.firstKey) return false;
      return !getReferences(node.id).some((reference) => reference.type === "IMAGE" || reference.chainFrame);
    });
    if (framesMissing) {
      showToast(`「${framesMissing.data?.title || "视频节点"}」为参考帧模式，请设置首帧图（图框选图或连接图片/上游视频取其尾帧）`, 3600);
      return;
    }
    if (runLock.current) return;
    const controller = new AbortController();
    runAbortRef.current = controller;
    runLock.current = true;
    setRunning(true);
    setRunProgress(0);
    setRunTotal(onlyNode ? 1 : nodes.filter((node) => GENERATOR_KINDS.includes(node.data?.kind) && node.data?.enabled !== false).length);
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
      const workflowId = Number(record.id);
      const ownedId = Number.isFinite(workflowId) && workflowId > 0 && !record.builtin ? workflowId : undefined;
      const body = {
        title: record.title || "未命名工作流",
        description: record.description || "",
        type: ["image", "video", "audio", "import", "template"].includes(record.type) ? record.type : "image",
        modelId,
        origin: record.origin || "高级工作台",
        demoKey: record.demo,
        sourcePath: record.source,
        graph,
      };
      const started = Date.now();
      const latest = await executeWorkflowRun({
        graph, workflowId: ownedId, previousRunId: ownedId == null ? lastRunIdRef.current : undefined, modelId, nodeId: onlyNode, signal: controller.signal,
        save: (id) => updateWorkflowRecord(id, body),
        start: startWorkflowRun,
        get: (id, { signal }) => getWorkflowRun(id, { signal }),
        wait: (signal) => {
          if (Date.now() - started > 25 * 60 * 1000) throw new Error("工作流仍在运行，可稍后在我的创作查看结果");
          return waitForWorkflowPoll(signal);
        },
        onRun: (run) => {
          lastRunIdRef.current = run.id;
          (run.steps || []).filter((step) => ["FAILED", "BLOCKED"].includes(step.status)).forEach((step) => {
            const key = `${run.id}:${step.nodeId}`;
            if (notifiedFailuresRef.current.has(key)) return;
            notifiedFailuresRef.current.add(key);
            showToast(`「${step.title || step.nodeId}」${step.errorMessage || (step.status === "BLOCKED" ? "上游节点未成功" : "生成失败")}`, 3600);
          });
          applyRunToCurrentNodes(setNodes, run);
          setRunProgress(run.progress || 0);
          setRunTotal(run.total || 1);
        },
      });
      if (controller.signal.aborted || !latest) return;
      if (latest.status === "CANCELLED") {
        // 已取消：不弹失败类提示
      } else if (latest.status === "SUCCEEDED") showToast(onlyNode ? "节点已生成" : "工作流运行完成", 3200);
      else if (latest.status === "PARTIAL_FAILED") showToast("部分节点失败，已保留成功结果", 3600);
      else showToast(latest.errorMessage || "工作流运行失败", 3600);
    } catch (error) {
      if (!controller.signal.aborted) showToast(error.message || "工作流运行失败", 3600);
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      runLock.current = false;
      setRunning(false);
    }
  }

  function exportWorkflowFile() {
    try {
      const viewport = flowInstance?.getViewport?.();
      const document_ = serializeWorkflow(nodes, edges, {
        viewport: viewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : undefined,
        title: record.title || "未命名工作流",
        description: record.description || "",
      });
      const blob = new Blob([JSON.stringify(document_, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = exportFileName(record.title || "未命名工作流");
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast("已导出工作流 JSON", 2200);
    } catch (error) {
      showToast(error.message || "导出失败", 2800);
    }
  }

  // 智能排版：对当前画布（或选中子图）做 DAG 分层，环状结构不排版并高亮环路（TC-008）
  function autoArrangeCanvas() {
    setCycleHighlight(null);
    window.clearTimeout(cycleHighlightTimer.current);
    const scope = selectedNodeIds.length >= 2 ? nodes.filter((node) => selectedNodeIds.includes(node.id) && node.type !== "groupFrame") : nodes;
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
    showToast(selectedNodeIds.length >= 2 ? "已按连线自动规整所选节点" : "已按连线自动规整画布", 2400);
  }

  async function saveWorkflow() {
    const modelId = Number(selectedModel);
    const graph = persistableGraph(nodes, edges);
    const body = {
      title: record.title || "未命名工作流",
      description: record.description || "",
      type: ["image", "video", "audio", "import", "template"].includes(record.type) ? record.type : "image",
      modelId: modelId || null,
      origin: record.origin || "高级工作台",
      demoKey: record.demo,
      sourcePath: record.source,
      graph,
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

  // 记录是否已在库里：自己的（数字 id）或官方示例（builtin）返回后仍在；新建/导入/模板草稿不在
  const ownedId = Number(record.id);
  const owned = Number.isFinite(ownedId) && ownedId > 0 && !record.builtin;
  const inLibrary = owned || Boolean(record.builtin);
  const dirty = !saved;

  function requestBack() {
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

  function openMaterialUpload() {
    const point = flowInstance?.screenToFlowPosition({ x: contextMenu?.clientX || 0, y: contextMenu?.clientY || 0 });
    materialPoint.current = point || { x: 120, y: 120 };
    setContextMenu(null);
    materialRef.current?.click();
  }

  async function placeUploadedMaterial(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const validation = validateAssetFile(file);
      if (!validation.valid) throw new Error(validation.message);
      const asset = await uploadAsset(file);
      if (!asset?.storageKey) throw new Error("素材上传未返回存储地址");
      rememberGraph();
      const position = materialPoint.current || { x: 120, y: 120 };
      const id = `asset-${Date.now()}`;
      const url = asset.url || asset.src || mediaUrl(asset.storageKey);
      if (validation.kind === "audio") {
        setNodes((items) => [...items, referenceAudioNode(id, position, { name: asset.name || file.name, url, storageKey: asset.storageKey })]);
      } else {
        const type = validation.kind === "video" ? "VIDEO" : "IMAGE";
        setNodes((items) => [...items, referenceAssetNode(id, position, { key: asset.storageKey, title: asset.name || file.name, type, preview: asset.posterUrl || asset.poster || url, url })]);
      }
      setSaved(false);
      showToast("素材已放到画布");
    } catch (error) { showToast(error.message || "素材上传失败"); }
  }

  function deleteEdge(edge) {
    rememberGraph();
    setEdges((items) => items.filter((item) => item.id !== edge.id));
    setSaved(false);
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
      if (event.key === "Escape") { setAddMenu(null); setContextMenu(null); setComfyMenuOpen(false); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redoGraph() : undoGraph(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { event.preventDefault(); handlePaste(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); copySelectedNodes(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelectedNodes(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selectAll(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="studio-layout studio-layout--editor">
      <section ref={stageRef} className="flow-stage flow-stage--minimax" onDoubleClick={(event) => { if (!event.target.closest(".react-flow__pane")) return; const rect = stageRef.current?.getBoundingClientRect(); setContextMenu(null); setComfyMenuOpen(false); setAddMenu({ origin: "context", x: Math.max(10, Math.min(event.clientX - (rect?.left || 0), (rect?.width || 900) - 260)), y: Math.max(10, Math.min(event.clientY - (rect?.top || 0), (rect?.height || 700) - 446)), clientX: event.clientX, clientY: event.clientY }); }}>
        <NodeEditContext.Provider value={nodeEditApi}><WorkflowNodeContext.Provider value={workflowNodeApi}><ReactFlow
          key={record.id}
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onInit={(instance) => { setFlowInstance(instance); paintZoom(instance.getViewport().zoom); }}
          onMove={(_, viewport) => paintZoom(viewport.zoom)}
          onNodesChange={(changes) => { const settled = changes.some((change) => change.type === "remove" || (change.type === "position" && change.dragging === false)); if (settled) rememberGraph(); onNodesChange(changes); if (settled) setSaved(false); }}
          onEdgesChange={(changes) => { if (changes.some((change) => change.type === "remove")) rememberGraph(); onEdgesChange(changes); if (changes.some((change) => change.type === "remove")) setSaved(false); }}
          onConnect={onConnect}
          onConnectEnd={(_, connectionState) => { if (connectionState?.isValid === false) showToast("连线不兼容：端口类型不匹配，无法连接", 2400); }}
          isValidConnection={isValidConnection}
          onEdgeClick={(_, edge) => deleteEdge(edge)}
          onSelectionChange={handleSelectionChange}
          selectionOnDrag={canvasTool === "select"}
          multiSelectionKeyCode={selectionKeys}
          panOnDrag={canvasTool === "pan" ? true : canvasPanButtons}
          panOnScroll={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          connectionLineType={ConnectionLineType.Bezier}
          onPaneClick={() => { setAddMenu(null); setContextMenu(null); setComfyMenuOpen(false); setTidyMenuOpen(false); closeReferencePicker(); }}
          onPaneContextMenu={openPaneMenu}
          fitView
          fitViewOptions={fitOptions}
          minZoom={0.2}
          maxZoom={3}
          onlyRenderVisibleElements
          deleteKeyCode={["Backspace", "Delete"]}
          defaultEdgeOptions={edgeDefaults}
        >
          <Background color="#cfd4dc" gap={22} size={1.1} />
          <Controls position="bottom-right" showInteractive={false} />
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
              <button className="run-workflow" onClick={() => runGraph()} disabled={!nodes.length}>
                <CirclePlay size={16} /> 运行
              </button>
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
                  <span className="reference-picker__thumb"><img src={nodePreviewUrl(node)} alt={node.data.title} />{(attached || (frameKey && frameKey === currentFrameKey)) ? <i className="reference-picker__check"><Check size={12} /></i> : null}</span>
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
            <button onClick={() => showToast(`已将 ${selectedNodeIds.length} 个节点保存为画布资产`)}><PackagePlus size={15} />保存为资产</button>
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
          <button className={canvasTool === "pan" ? "active" : ""} aria-label="切换工具" onClick={() => setCanvasTool((current) => current === "pan" ? "select" : "pan")}><ChevronUp size={15} /></button>
          <button aria-label="导入工作流" onClick={() => fileRef.current?.click()}><FolderOpen size={18} /></button>
          <button aria-label="画布帮助" onClick={() => showToast("框选节点、点击连线删除、双击或右键打开快捷菜单。")}><CircleHelp size={17} /></button>
        </div>
        {addMenu && <div className={`canvas-add-menu ${addMenu.origin === "context" ? "is-contextual" : ""} ${addMenu.origin === "context" && addMenu.x > (stageRef.current?.clientWidth || 900) - 520 ? "submenu-left" : ""}`} style={addMenu.origin === "context" ? { left: addMenu.x, top: addMenu.y } : undefined} onMouseDown={(event) => event.stopPropagation()}>
          <header>添加节点</header>
          <div className="canvas-add-menu__items">{canvasQuickItems.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => addQuickNode(item)}><i><Icon size={18} /></i><span>{item.name}</span>{item.badge && <em>{item.badge}</em>}</button>; })}</div>
          <div className="canvas-add-submenu-shell" onMouseEnter={() => setComfyMenuOpen(true)} onMouseLeave={() => setComfyMenuOpen(false)}><button className="canvas-add-menu__comfy" onClick={() => setComfyMenuOpen((value) => !value)}><i><Layers3 size={18} /></i><span>ComfyUI</span><ChevronRight size={15} /></button>{comfyMenuOpen && <div className="canvas-add-submenu"><header><button type="button">探索更多</button></header><button onClick={createComfyWorkflow}><i><Plus size={17} /></i><span><strong>新建工作流</strong><small>创建空白 ComfyUI 工作流</small></span></button></div>}</div>
        </div>}
        {contextMenu && <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button onClick={openMaterialUpload}><Upload size={15} /><span>上传素材</span></button>
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
        <input ref={fileRef} hidden type="file" accept=".json" onChange={(event) => { importIntoCanvas(event.target.files?.[0]); event.target.value = ""; }} />
        <input ref={materialRef} hidden type="file" accept="image/*,video/*,audio/*" onChange={placeUploadedMaterial} />
        {toast && <div className="run-toast"><Check size={16} /> {toast}</div>}
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
      </section>
    </div>
  );
}

export function WorkflowStudio({ onOpenTemplates, templateLaunch, importRequest, onImportApplied, models = [] }) {
  const [view, setView] = useState(templateLaunch ? "editor" : "library");
  const workflowModels = useMemo(() => models.filter((model) => model.enabled !== false && (model.capabilities?.includes("workflow") || ["image", "video", "audio"].includes(model.category))), [models]);
  const [selectedModel, setSelectedModel] = useState(() => workflowModels[0]?.id || "");
  const [record, setRecord] = useState(() => templateLaunch ? templateRecord(templateLaunch, workflowModels) : null);
  const [graph, setGraph] = useState(localWorkflow());
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
          ? { nodes: stored.nodes, edges: stored.edges || [] }
          : { nodes: [], edges: [] };
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
    setGraph(parsed.graph);
    setEditorKey((key) => key + 1);
    openEditor();
    if (parsed.warnings.length) setImportReport({ fileName: importRequest.fileName, errors: [], warnings: parsed.warnings });
    onImportApplied?.();
  }, [importRequest]);

  // 模板实例化（需求 4.3.1.5/4.3.1.6）：新建画布或追加到当前画布，都不覆盖已有节点
  useEffect(() => {
    if (!templateLaunch) return;
    let cancelled = false;
    const mode = templateLaunch.mode === "append" ? "append" : "new";
    (async () => {
      let nextGraph;
      try {
        nextGraph = await resolveTemplateGraph(templateLaunch, workflowModels);
      } catch (error) {
        if (!cancelled) window.alert(error.message || "模板加载失败");
        return;
      }
      if (cancelled) return;
      if (mode === "append") {
        setAppendRequest({ graph: nextGraph, token: templateLaunch.token || Date.now() });
        openEditor();
        return;
      }
      setRecord(templateRecord(templateLaunch, workflowModels));
      setGraph(nextGraph);
      setEditorKey((key) => key + 1);
      openEditor();
    })();
    return () => { cancelled = true; };
  }, [templateLaunch, workflowModels]);
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
      setRecords((items || []).map(toWorkflowCard));
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
      if (Array.isArray(stored.nodes) && stored.nodes.length) nextGraph = { nodes: stored.nodes, edges: stored.edges || [] };
      else if (card.demo) nextGraph = demoWorkflow(card.demo, workflowModels);
      else if (card.source) nextGraph = normalizeWorkflow(await fetch(card.source).then((response) => response.json()));
      else nextGraph = { nodes: [], edges: [] };
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
        throw new Error("文件不是合法的 JSON");
      }
      parsed = parseWorkflowDocument(json);
    } catch (error) {
      window.alert(`无法读取该工作流：${error.message || "文件格式不正确"}`);
      return;
    }
    if (!parsed.ok) {
      window.alert(`导入失败，当前画布未改动：\n${parsed.errors.map((message) => `· ${message}`).join("\n")}`);
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
    setGraph(parsed.graph);
    setEditorKey((key) => key + 1);
    openEditor();
    if (parsed.warnings.length) window.alert(`导入完成，但存在兼容提示：\n${parsed.warnings.map((message) => `· ${message}`).join("\n")}`);
  }

  // 删除确认由库页的 ConfirmDialog 负责；失败时错误回传到弹窗内展示
  async function deleteRecord(target) {
    await removeWorkflow(target.id);
    setRecords((items) => items.filter((item) => item.id !== target.id));
  }

  if (loading) return <div className="workflow-loading"><span><Sparkles size={22} /></span><strong>正在载入工作流</strong><small>读取画布、节点与连接…</small></div>;
  // record 为空绝不进编辑器（WorkflowEditor 的 effect 依赖 record.id，null 会在渲染期崩溃）；
  // 刷新 ?view=editor 但恢复失败/未带 id 时在这里兜一帧，由上面的守卫 effect 收敛回库页
  if (view === "library" || !record) return <div className="workflow-studio-host"><WorkflowLibrary records={records} status={libraryStatus} onOpen={openRecord} onCreate={createWorkflow} onImport={importWorkflow} onOpenTemplates={onOpenTemplates} onDelete={deleteRecord} /><ImportReport report={importReport} onClose={() => setImportReport(null)} /></div>;
  return <WorkflowEditor key={editorKey} record={record} initialGraph={graph} models={workflowModels} selectedModel={selectedModel} onRecordChange={setRecord} onBack={closeEditor} appendRequest={appendRequest} onAppendApplied={() => setAppendRequest(null)} />;
}

// 模板实例化：官方模板按 demo 键或 ComfyUI 源路径展开；自定义模板直接取后端画布
async function resolveTemplateGraph(template, models) {
  const detail = Number(template.id) > 0 ? await getWorkflow(template.id).catch(() => null) : null;
  const stored = detail?.graph || {};
  if (Array.isArray(stored.nodes) && stored.nodes.length) return { nodes: stored.nodes, edges: stored.edges || [] };
  const demoKey = template.demoKey || detail?.demoKey;
  if (demoKey) return applyTemplateDefaults(demoWorkflow(demoKey, models), template.defaultParams);
  const sourcePath = template.sourcePath || detail?.sourcePath;
  if (sourcePath) return applyTemplateDefaults(normalizeWorkflow(await fetch(sourcePath).then((response) => response.json())), template.defaultParams);
  return { nodes: [], edges: [] };
}

// 套用模板默认参数（需求 4.3.1.2）：只覆盖生成节点媒体参数，保留节点结构
function applyTemplateDefaults(graph, defaults) {
  if (!defaults || !Object.keys(defaults).length) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (!["ImageGenerator", "VideoGenerator", "AudioGenerator"].includes(node.data?.kind)) return node;
      const media = node.data.media || {};
      const next = { ...media };
      if (defaults.ratio) next.ratio = defaults.ratio;
      if (defaults.resolution) next.resolution = defaults.resolution;
      if (defaults.duration) next.duration = defaults.duration;
      if (defaults.copies) next.copies = defaults.copies;
      return { ...node, data: { ...node.data, media: next } };
    }),
  };
}

function templateRecord(template, models = []) {
  return {
    id: `template-${template.id}-${template.token || Date.now()}`,
    title: template.title,
    type: "template",
    model: template.modelLabel || (models.length ? models[(Number(template.id) - 1) % models.length].name : "未选择"),
    nodes: template.nodeCount || 0,
    origin: template.origin || "官方模板",
    builtin: false,
  };
}
