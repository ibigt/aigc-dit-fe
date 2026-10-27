import {
  Background,
  ConnectionLineType,
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  CirclePlay,
  Clipboard,
  Clapperboard,
  Clock3,
  Columns3,
  Film,
  FolderOpen,
  Group,
  Hand,
  Image,
  Layers3,
  LayoutGrid,
  ListFilter,
  MessageSquareText,
  MoreHorizontal,
  MousePointer2,
  Music2,
  PackagePlus,
  Plus,
  Redo2,
  Rows3,
  Save,
  Scan,
  Search,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Type,
  Undo2,
  Upload,
  Volume2,
  WandSparkles,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createWorkflowRecord, getWorkflow, getWorkflowRun, listWorkflows, removeWorkflow, startWorkflowRun, updateWorkflowRecord } from "../api/workflows.js";
import { uploadAsset } from "../api/assets.js";
import { validateAssetFile } from "../lib/assetUpload.js";
import { mediaUrl } from "../lib/media.js";
import SpecializedMediaNode from "./workflow/MediaGeneratorNode.jsx";
import SpecializedAudioNode from "./workflow/AudioGeneratorNode.jsx";
import SpecializedPromptNode from "./workflow/PromptNode.jsx";
import SpecializedEditingNode from "./workflow/VideoEditingNode.jsx";
import { WorkflowNodeContext } from "./workflow/WorkflowNodeContext.jsx";
import { applyRunToCurrentNodes, applyWorkflowSnapshotToNodes, canConnectNodes, executeWorkflowRun, waitForWorkflowPoll, restoreWorkflowSnapshot, persistableWorkflowGraph as persistableGraph } from "./workflow/runtime.js";
import { getWorkflowRuntimeSnapshot } from "../api/workflows.js";
import { buildClipQueue } from "./workflow/timeline.js";
import { graphVariableScopes } from "./workflow/variables.js";
import { estimatedNodeHeight, placeQuickNode } from "./workflow/layout.js";

const GENERATOR_KINDS = ["ImageGenerator", "VideoGenerator", "AudioGenerator"];

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

const catalogGroups = [
  {
    name: "创意生成",
    items: [
      { name: "图像生成", meta: "提示词、模型与多副本生成", kind: "ImageGenerator", icon: Image, tone: "amber", inputs: [{ name: "prompt", label: "提示词", type: "STRING" }], outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }] },
      { name: "视频生成", meta: "图片与视频统一参考生成", kind: "VideoGenerator", icon: Film, tone: "green", inputs: [{ name: "prompt", label: "提示词", type: "STRING" }, { name: "reference", label: "参考素材", type: "MEDIA" }], outputs: [{ name: "VIDEO", label: "视频", type: "VIDEO" }] },
      { name: "音频生成", meta: "配音、情感语速与音乐生成", kind: "AudioGenerator", icon: Volume2, tone: "violet", inputs: [{ name: "input", label: "输入", type: "DATA" }], outputs: [{ name: "AUDIO", label: "音频", type: "AUDIO" }] },
    ],
  },
  {
    name: "加载器",
    items: [
      { name: "加载模型", meta: "基础模型加载器", kind: "CheckpointLoaderSimple", icon: Box, tone: "rose", fields: [{ label: "模型文件", value: "sd_xl_base_1.0.safetensors" }], outputs: [{ name: "MODEL", label: "模型", type: "MODEL" }, { name: "CLIP", label: "文本编码器", type: "CLIP" }, { name: "VAE", label: "VAE", type: "VAE" }] },
      { name: "加载图像", meta: "本地图像输入", kind: "LoadImage", icon: Image, tone: "amber", fields: [{ label: "图像", value: "transparent_rgb_gaming_mouse.png" }], outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }, { name: "MASK", label: "遮罩", type: "MASK" }] },
      { name: "参考音频", meta: "上传并预览参考音频", kind: "ReferenceAudio", icon: Volume2, tone: "violet", outputs: [{ name: "AUDIO", label: "音频", type: "AUDIO" }] },
      { name: "加载 VAE", meta: "变分自编码器", kind: "VAELoader", icon: Layers3, tone: "red", fields: [{ label: "VAE 文件", value: "minimax_h3_video_vae_fp16.safetensors" }], outputs: [{ name: "VAE", label: "VAE", type: "VAE" }] },
      { name: "加载文本编码器", meta: "提示词编码模型", kind: "CLIPLoader", icon: MessageSquareText, tone: "yellow", fields: [{ label: "编码器文件", value: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" }], outputs: [{ name: "CLIP", label: "文本编码器", type: "CLIP" }] },
    ],
  },
  {
    name: "条件与潜空间",
    items: [
      { name: "提示词编码", meta: "生成条件编码", kind: "CLIPTextEncode", icon: MessageSquareText, tone: "yellow", fields: [{ label: "提示词", value: "电影感光线，精细场景", multiline: true }], inputs: [{ name: "clip", label: "文本编码器", type: "CLIP" }], outputs: [{ name: "CONDITIONING", label: "条件", type: "CONDITIONING" }] },
      { name: "空白图像潜空间", meta: "图像尺寸与批次", kind: "EmptyLatentImage", icon: LayoutGrid, tone: "pink", fields: [{ label: "宽度", value: "1024" }, { label: "高度", value: "1024" }], outputs: [{ name: "LATENT", label: "潜空间", type: "LATENT" }] },
      { name: "空白视频潜空间", meta: "视频尺寸与帧数", kind: "EmptyHunyuanLatentVideo", icon: Film, tone: "pink", fields: [{ label: "宽度", value: "832" }, { label: "高度", value: "480" }, { label: "帧数", value: "81" }], outputs: [{ name: "LATENT", label: "潜空间", type: "LATENT" }] },
      { name: "应用控制网络", meta: "姿态与结构控制", kind: "ControlNetApplyAdvanced", icon: SlidersHorizontal, tone: "violet", fields: [{ label: "强度", value: "0.80" }], inputs: [{ name: "conditioning", label: "条件", type: "CONDITIONING" }], outputs: [{ name: "CONDITIONING", label: "条件", type: "CONDITIONING" }] },
    ],
  },
  {
    name: "采样与输出",
    items: [
      { name: "K 采样器", meta: "扩散采样", kind: "KSampler", icon: WandSparkles, tone: "violet", fields: [{ label: "采样步数", value: "20" }, { label: "引导系数", value: "7.0" }, { label: "采样算法", value: "euler" }], inputs: [{ name: "model", label: "模型", type: "MODEL" }, { name: "positive", label: "正向条件", type: "CONDITIONING" }, { name: "negative", label: "反向条件", type: "CONDITIONING" }, { name: "latent_image", label: "潜空间", type: "LATENT" }], outputs: [{ name: "LATENT", label: "潜空间", type: "LATENT" }] },
      { name: "VAE 解码", meta: "潜空间转图像", kind: "VAEDecode", icon: Sparkles, tone: "red", fields: [{ label: "分块尺寸", value: "512" }], inputs: [{ name: "samples", label: "采样结果", type: "LATENT" }, { name: "vae", label: "VAE", type: "VAE" }], outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }] },
      { name: "保存图像", meta: "写入输出目录", kind: "SaveImage", icon: Save, tone: "blue", fields: [{ label: "文件名前缀", value: "ComfyUI" }], inputs: [{ name: "images", label: "图像", type: "IMAGE" }] },
      { name: "视频剪辑", meta: "预览并播放剪辑成片", kind: "VideoEditing", icon: Clapperboard, tone: "blue", inputs: [{ name: "video", label: "视频素材", type: "VIDEO" }, { name: "audio", label: "音频素材", type: "AUDIO" }] },
    ],
  },
];

const canvasQuickItems = [
  { id: "text", name: "文本", kind: "MarkdownNote", icon: Type, tone: "yellow", fields: [{ label: "内容", value: "输入文本内容…", multiline: true }], outputs: [{ name: "TEXT", label: "文本", type: "STRING" }] },
  { id: "table", name: "表格", kind: "DataTable", icon: Table2, tone: "blue", fields: [{ label: "用途", value: "分镜表" }, { label: "列", value: "镜号、画面、台词、时长" }], outputs: [{ name: "TABLE", label: "表格", type: "DATA" }] },
  { id: "image", name: "图像", kind: "ImageGenerator", icon: Image, tone: "amber", outputs: [{ name: "IMAGE", label: "图像", type: "IMAGE" }] },
  { id: "video", name: "视频", kind: "VideoGenerator", icon: Film, tone: "green", badge: "MiniMax H3", inputs: [{ name: "prompt", label: "提示词", type: "STRING" }, { name: "reference", label: "参考素材", type: "MEDIA" }], outputs: [{ name: "VIDEO", label: "视频", type: "VIDEO" }] },
  { id: "audio", name: "音频", kind: "AudioGenerator", icon: Volume2, tone: "violet", inputs: [{ name: "input", label: "输入", type: "DATA" }], outputs: [{ name: "AUDIO", label: "音频", type: "AUDIO" }] },
  { id: "editing", name: "视频剪辑", kind: "VideoEditing", icon: Clapperboard, tone: "blue", badge: "新", inputs: [{ name: "video", label: "视频素材", type: "VIDEO" }, { name: "audio", label: "音频素材", type: "AUDIO" }] },
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
  if (/Video/i.test(type)) return Film;
  if (/Image|VAE/i.test(type)) return Image;
  if (/Text|CLIP/i.test(type)) return MessageSquareText;
  if (/Sampler|Scheduler/i.test(type)) return WandSparkles;
  if (/Save/i.test(type)) return Save;
  if (/Loader|Model|UNET/i.test(type)) return Box;
  return Sparkles;
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
  return ["IMAGE", "VIDEO"].includes(nodeOutputType(node));
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
  return {
    type: "audio",
    tab: "配音",
    prompt: "",
    lyrics: "",
    models: modelNames,
    model: modelNames[0]?.name,
    speechModel: modelNames[0]?.name,
    musicModel: modelNames.find((model) => model.name.toLowerCase().includes("music"))?.name || "Music-3.0",
    voice: "深情叙事者",
    speed: 1,
    emotion: "平静",
    instrumental: true,
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
      inputs: options.inputs || (isVideo
        ? [{ name: "prompt", label: "提示词", type: "STRING" }, { name: "reference", label: "参考素材", type: "MEDIA" }]
        : [{ name: "prompt", label: "提示词", type: "STRING" }]),
      outputs: [{ name: isVideo ? "VIDEO" : "IMAGE", label: isVideo ? "视频" : "图像", type: isVideo ? "VIDEO" : "IMAGE" }],
      media: {
        type: mediaType,
        prompt: options.prompt || (isVideo ? "霓虹雨夜中，镜头跟随角色缓慢推进，电影感光线" : "电影级概念设计，清晰主体，统一光影与色彩"),
        models: modelNames,
        model: options.model || modelNames[0]?.name,
        mode: options.mode || (isVideo ? "全能参考" : "参考生成"),
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
      editing: {
        status: "等待剪辑",
        mode: options.mode || "智能对齐",
        duration: options.duration || "00:12",
        resolution: options.resolution || "2K",
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
      mediaNode("hero-video", "video", { x: 470, y: 170 }, models, { preview: "/media/comfy-racer-poster.webp", mode: "首尾帧", inputs: [{ name: "prompt", label: "提示词", type: "STRING" }, { name: "reference", label: "参考素材", type: "MEDIA" }] }),
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

const inputHandleStyle = { top: "50%", left: 0, right: "auto", transform: "translate(-50%, -50%)" };
const outputHandleStyle = { top: "50%", right: 0, left: "auto", transform: "translate(50%, -50%)" };

function UnifiedHandles({ hasInput, hasOutput }) {
  return <>
    {hasInput && <Handle id="input" type="target" position={Position.Left} className="comfy-node__unified-handle comfy-node__unified-handle--input" style={inputHandleStyle} />}
    {hasOutput && <Handle id="output" type="source" position={Position.Right} className="comfy-node__unified-handle comfy-node__unified-handle--output" style={outputHandleStyle} />}
  </>;
}

function ComfyField({ nodeId, field, index }) {
  const { updateField } = useContext(NodeEditContext);
  const common = {
    className: "nodrag nowheel",
    value: field.value,
    onChange: (event) => updateField(nodeId, index, event.target.value),
    onPointerDown: (event) => event.stopPropagation(),
  };
  return (
    <label className={`comfy-node__field ${field.multiline ? "comfy-node__field--multiline" : ""}`}>
      <span>{field.label}</span>
      {field.inputType === "boolean" ? (
        <input className="nodrag" type="checkbox" checked={field.value === true || field.value === "true"} onChange={(event) => updateField(nodeId, index, event.target.checked)} onPointerDown={(event) => event.stopPropagation()} />
      ) : field.options ? (
        <select {...common}>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
      ) : field.multiline ? (
        <textarea {...common} rows={field.label === "说明" ? 7 : 5} />
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
    <div className={`comfy-node reference-audio-node comfy-node--violet ${selected ? "comfy-node--selected" : ""}`}>
      <UnifiedHandles hasInput={false} hasOutput />
      <header><span><ChevronDown size={12} /></span><strong>{data.title || "参考音频"}</strong><Volume2 size={14} /></header>
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
  if (["MarkdownNote", "Prompt"].includes(data.kind)) return <SpecializedPromptNode id={id} data={data} selected={selected} />;
  const Icon = data.icon || Sparkles;
  const hasInputs = Array.isArray(data.inputs) ? data.inputs.length > 0 : !["CheckpointLoaderSimple", "LoadImage", "MarkdownNote", "ReferenceAsset"].includes(data.kind);
  const hasOutputs = Array.isArray(data.outputs) ? data.outputs.length > 0 : !["SaveImage", "SaveVideo", "VideoEditing"].includes(data.kind);
  return (
    <div className={`comfy-node comfy-node--${data.tone || "blue"} ${selected ? "comfy-node--selected" : ""} ${data.enabled === false ? "comfy-node--disabled" : ""}`}>
      <UnifiedHandles hasInput={hasInputs} hasOutput={hasOutputs} />
      <header>
        <span><ChevronDown size={12} /></span>
        <strong>{data.title}</strong>
        <Icon size={14} />
      </header>
      {data.preview && (data.kind === "ReferenceAsset" ? <div className="comfy-node__asset-preview"><img src={data.preview} alt={`${data.title}预览`} />{data.assetType === "VIDEO" && <span><Film size={12} />视频素材</span>}</div> : <img className="comfy-node__preview" src={data.preview} alt="节点输入预览" />)}
      <div className="comfy-node__fields">
        {(data.fields || []).map((field, index) => <ComfyField key={`${field.label}-${index}`} nodeId={id} field={field} index={index} />)}
      </div>
      <footer><span>{data.source === "canvas" ? "光驭画布节点" : "ComfyUI 节点"}</span><small>{data.source === "comfy-core" ? "核心" : data.source === "canvas" ? "画布" : data.source || "扩展"}</small></footer>
    </div>
  );
}

function GroupFrame({ data, selected }) {
  return <div className={`canvas-group-frame ${selected ? "is-selected" : ""}`}><span><Group size={13} />{data.label || "节点组合"}</span></div>;
}

const nodeTypes = { comfy: ComfyNode, groupFrame: GroupFrame };

function WorkflowLibrary({ records, status, onOpen, onCreate, onImport, onOpenTemplates, onDelete }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  const visible = records.filter((item) => (filter === "all" || item.type === filter) && `${item.title}${item.model}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="workflow-library">
      <header className="workflow-library__hero">
        <div><h1>高级工作台</h1><p>选择一个工作流继续编辑，或从空白与 ComfyUI 文件开始。</p></div>
        <div className="workflow-library__actions">
          <button onClick={onOpenTemplates}><Layers3 size={16} /> 模板</button>
          <button onClick={() => inputRef.current?.click()}><Upload size={16} /> 导入工作流</button>
          <button className="button button--primary" onClick={onCreate}><Plus size={16} /> 新建工作流</button>
          <input ref={inputRef} hidden type="file" accept=".json" onChange={(event) => onImport(event.target.files?.[0])} />
        </div>
      </header>

      <div className="workflow-library__toolbar">
        <div className="workflow-filter">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><ListFilter size={14} /> 全部</button>
          <button className={filter === "video" ? "active" : ""} onClick={() => setFilter("video")}><Film size={14} /> 视频</button>
          <button className={filter === "image" ? "active" : ""} onClick={() => setFilter("image")}><Image size={14} /> 图片</button>
        </div>
        <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或模型" /></label>
      </div>

      {status && <p className={`workflow-library__status${status.error ? " is-error" : ""}`}>{status.text}</p>}
      <div className="workflow-record-grid">
        <button className="workflow-new-card" onClick={onCreate}><span><Plus size={22} /></span><strong>空白工作流</strong><small>从节点库开始搭建</small></button>
        {visible.map((record, index) => (
          <article className="workflow-record-card" key={record.id}>
            <button className="workflow-record-card__cover" onClick={() => onOpen(record)} aria-label={`打开工作流：${record.title}`}>
              <WorkflowThumbnail record={record} variant={index} />
              <span className="workflow-origin">{record.origin}</span>
              <span className="workflow-open"><CirclePlay size={18} /> 打开工作流</span>
            </button>
            <div className="workflow-record-card__body">
              <div><strong>{record.title}</strong><button aria-label={record.builtin ? `示例工作流：${record.title}` : `删除工作流：${record.title}`} onClick={() => onDelete(record)}><MoreHorizontal size={16} /></button></div>
              <p>{record.description}</p>
              <footer><span><Layers3 size={13} /> {record.nodes} 个节点</span><span><Clock3 size={13} /> {record.updated}</span><b>{record.model}</b></footer>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function WorkflowEditor({ record, initialGraph, onBack, onImport, models, selectedModel, onModelChange, onRecordChange }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph.nodes.map((node) => ({ ...node, data: { ...node.data, runtime: undefined } })));
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [canvasTool, setCanvasTool] = useState("select");
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [runTotal, setRunTotal] = useState(0);
  const [saved, setSaved] = useState(true);
  const [flowInstance, setFlowInstance] = useState(null);
  const [toast, setToast] = useState("");
  const [addMenu, setAddMenu] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [comfyMenuOpen, setComfyMenuOpen] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  const [tidyMenuOpen, setTidyMenuOpen] = useState(false);
  const [includeConnected, setIncludeConnected] = useState(false);
  const [referencePickerNodeId, setReferencePickerNodeId] = useState(null);
  const fileRef = useRef(null);
  const materialRef = useRef(null);
  const materialPoint = useRef(null);
  const zoomLabelRef = useRef(null);
  const runLock = useRef(false);
  const runAbortRef = useRef(null);
  const lastRunIdRef = useRef(null);
  const referenceUploadRef = useRef(null);
  const stageRef = useRef(null);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  useEffect(() => () => { runAbortRef.current?.abort(); }, []);
  const visibleCatalog = useMemo(() => catalogGroups.map((group) => ({ ...group, items: group.items.filter((item) => `${item.name}${item.kind}`.toLowerCase().includes(query.toLowerCase())) })).filter((group) => group.items.length), [query]);
  const focusNodes = useMemo(() => {
    const primary = nodes.filter((node) => !["MarkdownNote", "ImageScaleToTotalPixels", "GetImageSize"].includes(node.data.kind));
    return primary.length ? primary : nodes;
  }, [nodes]);
  const snapshotGraph = useCallback(() => ({ nodes: nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data } })), edges: edges.map((edge) => ({ ...edge })) }), [nodes, edges]);
  const rememberGraph = useCallback(() => { historyRef.current = [...historyRef.current.slice(-39), snapshotGraph()]; futureRef.current = []; }, [snapshotGraph]);
  const showToast = useCallback((message, duration = 1800) => { setToast(message); window.setTimeout(() => setToast(""), duration); }, []);
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
      showToast("视频剪辑是终点节点，不能连接到下游");
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

  function addCatalogNode(item, position, avoidOverlap = false) {
    rememberGraph();
    const id = `node-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const resolvedMedia = item.media || (item.kind === "AudioGenerator" ? audioMedia(models) : ["ImageGenerator", "VideoGenerator"].includes(item.kind) ? mediaNode("preview", item.kind === "VideoGenerator" ? "video" : "image", { x: 0, y: 0 }, models).data.media : undefined);
    const nextNode = { id, type: "comfy", position: position || { x: 260 + nodes.length * 22, y: 220 + (nodes.length % 4) * 88 }, style: { width: item.kind === "VideoGenerator" ? 356 : item.kind === "ImageGenerator" ? 332 : ["AudioGenerator", "VideoEditing"].includes(item.kind) ? 382 : 270 }, data: { title: item.name, kind: item.kind, icon: item.icon, tone: item.tone, fields: (item.fields || []).map((field) => ({ ...field })), inputs: (item.inputs || []).map((port) => ({ ...port })), outputs: (item.outputs || []).map((port) => ({ ...port })), enabled: true, source: item.source || "comfy-core", media: resolvedMedia ? { ...resolvedMedia, models: [...(resolvedMedia.models || [])] } : undefined, editing: item.kind === "VideoEditing" ? videoEditingNode("preview", { x: 0, y: 0 }).data.editing : item.editing, preview: item.preview || (item.kind === "LoadImage" ? "/comfyui-workflows/minimax-h3/transparent_rgb_gaming_mouse.png" : undefined) } };
    setNodes((items) => [...items, avoidOverlap && position ? { ...nextNode, position: placeQuickNode(position, items, nextNode) } : nextNode]);
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
    addCatalogNode(configuredItem, position, addMenu?.origin !== "context");
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

  function createComfyWorkflow() {
    rememberGraph();
    setNodes([]);
    setEdges([]);
    setSidebarOpen(true);
    setSaved(false);
    setAddMenu(null);
    setComfyMenuOpen(false);
    showToast("已创建空白 ComfyUI 工作流");
  }

  function onDrop(event) {
    event.preventDefault();
    if (!flowInstance) return;
    const payload = event.dataTransfer.getData("application/lightflow-node");
    if (!payload) return;
    const item = JSON.parse(payload);
    addCatalogNode({ ...item, icon: iconForType(item.kind) }, flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }

  const updateNodeField = useCallback((nodeId, fieldIndex, value) => {
    setNodes((items) => items.map((node) => node.id === nodeId ? {
      ...node,
      data: { ...node.data, fields: node.data.fields.map((field, index) => index === fieldIndex ? { ...field, value } : field) },
    } : node));
    setSaved(false);
  }, [setNodes]);

  const updateNodeMedia = useCallback((nodeId, patch) => {
    setNodes((items) => items.map((node) => {
      if (node.id !== nodeId) return node;
      const media = { ...node.data.media, ...patch };
      if (patch.durationSec !== undefined) media.duration = patch.durationSec;
      if (node.data.kind === "AudioGenerator") {
        if (patch.tab === "music") {
          media.speechModel = node.data.media?.speechModel || node.data.media?.model;
          media.model = media.musicModel;
        } else if (patch.tab === "speech") media.model = media.speechModel || media.model;
        else if (patch.musicModel !== undefined && ["music", "音乐"].includes(media.tab)) media.model = patch.musicModel;
        else if (patch.model !== undefined && !["music", "音乐"].includes(media.tab)) media.speechModel = patch.model;
      }
      return { ...node, data: {
        ...node.data,
        ...(node.data.kind === "ReferenceAudio" && patch.storageKey ? { assetKey: patch.storageKey, assetType: "AUDIO" } : {}),
        media,
      } };
    }));
    setSaved(false);
  }, [setNodes]);

  const selectOutput = useCallback((nodeId, index) => updateNodeMedia(nodeId, { selectedOutputIndex: index, outputIndex: index }), [updateNodeMedia]);

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
    return buildClipQueue(videoNodes, edges, editing?.data?.media?.clips || editing?.data?.editing?.clips || [], nodeId, nodes);
  }, [nodes, edges]);

  const uploadAudio = useCallback(async (file) => {
    const validation = validateAssetFile(file);
    if (!validation.valid || validation.kind !== "audio") throw new Error(validation.message || "请选择音频文件");
    const asset = await uploadAsset(file);
    if (!asset?.storageKey) throw new Error("音频上传未返回存储地址");
    return { storageKey: asset.storageKey, url: asset.url || asset.src || mediaUrl(asset.storageKey), name: asset.name || file.name, duration: asset.durationMs ? asset.durationMs / 1000 : undefined };
  }, []);

  const generateNodeMedia = useCallback((nodeId) => runGraph(nodeId), [nodes, edges, selectedModel, record, running]);

  const getReferences = useCallback((targetId) => edges
    .filter((edge) => edge.target === targetId && isVisualReferenceNode(nodes.find((node) => node.id === edge.source)))
    .map((edge) => {
      const source = nodes.find((node) => node.id === edge.source);
      const type = nodeOutputType(source);
      return {
        edgeId: edge.id,
        sourceId: edge.source,
        title: source?.data?.title || (type === "VIDEO" ? "视频参考" : "图像参考"),
        type,
        preview: source?.data?.preview || (type === "VIDEO" ? "/media/wan-22-poster.webp" : "/comfyui-workflows/minimax-h3/transparent_rgb_gaming_mouse.png"),
      };
    }), [edges, nodes]);

  const removeReference = useCallback((targetId, sourceId) => {
    rememberGraph();
    setEdges((items) => items.filter((edge) => !(edge.target === targetId && edge.source === sourceId && isVisualReferenceNode(nodes.find((node) => node.id === edge.source)))));
    setSaved(false);
    showToast("已移除参考素材及对应连线");
  }, [nodes, rememberGraph, setEdges, showToast]);

  const attachReference = useCallback((targetId, sourceId) => {
    if (edges.some((edge) => edge.target === targetId && edge.source === sourceId)) return;
    const source = nodes.find((node) => node.id === sourceId);
    if (!source) return;
    const output = source.data?.outputs?.find((port) => ["IMAGE", "VIDEO"].includes(port.type)) || source.data?.outputs?.[0];
    const type = output?.type || source.data?.assetType || "IMAGE";
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
  }, [edges, nodes, rememberGraph, setEdges]);

  const addReferenceAsset = useCallback((targetId, asset) => {
    const existing = nodes.find((node) => node.data?.assetKey === asset.key);
    if (existing) {
      attachReference(targetId, existing.id);
      return;
    }
    const target = nodes.find((node) => node.id === targetId);
    if (!target) return;
    rememberGraph();
    const attachedCount = edges.filter((edge) => edge.target === targetId && isVisualReferenceNode(nodes.find((node) => node.id === edge.source))).length;
    const createdReferenceCount = nodes.filter((node) => node.data?.kind === "ReferenceAsset" && node.data?.assetKey && !["racer-first", "racer-last"].includes(node.data.assetKey)).length;
    const sourceId = `reference-asset-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const sourceNode = referenceAssetNode(sourceId, {
      x: target.position.x - 860 - Math.floor(createdReferenceCount / 2) * 370,
      y: target.position.y + (attachedCount % 2) * 310,
    }, asset);
    setNodes((items) => [...items, sourceNode]);
    setEdges((items) => addEdge({
      id: `reference-${sourceId}-${targetId}`,
      source: sourceId,
      sourceHandle: "output",
      target: targetId,
      targetHandle: "input",
      type: "bezier",
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(asset.type), width: 14, height: 14 },
      style: { stroke: edgeColor(asset.type), strokeWidth: 2.2 },
    }, items));
    setSaved(false);
    showToast(`已创建${asset.type === "VIDEO" ? "视频" : "图片"}素材节点并完成引用`);
    window.setTimeout(() => flowInstance?.fitView({ padding: 0.14, duration: 320 }), 80);
  }, [attachReference, edges, flowInstance, nodes, rememberGraph, setEdges, setNodes, showToast]);

  const handleSelectionChange = useCallback(({ nodes: selectedNodes }) => {
    const nextIds = selectedNodes.map((node) => node.id);
    setSelectedNodeIds((currentIds) => currentIds.length === nextIds.length && currentIds.every((id, index) => id === nextIds[index]) ? currentIds : nextIds);
    if (nextIds.length < 2) setTidyMenuOpen(false);
  }, []);

  const fitOptions = useMemo(() => ({ padding: 0.13, nodes: focusNodes }), [focusNodes]);
  const edgeDefaults = useMemo(() => ({ type: "bezier", interactionWidth: 22, markerEnd: { type: MarkerType.ArrowClosed, color: "#7584ff", width: 14, height: 14 }, style: { stroke: "#7584ff", strokeWidth: 2.2 } }), []);
  const selectionKeys = useMemo(() => ["Shift", "Control", "Meta"], []);
  const canvasPanButtons = useMemo(() => [1, 2], []);

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

  const nodeEditApi = useMemo(() => ({
    updateField: updateNodeField,
    updateMedia: updateNodeMedia,
    generateMedia: generateNodeMedia,
    notify: showToast,
    getReferences,
    removeReference,
    openReferencePicker: setReferencePickerNodeId,
  }), [updateNodeField, updateNodeMedia, generateNodeMedia, showToast, getReferences, removeReference]);

  const workflowNodeApi = useMemo(() => ({
    getVariableScopes: (nodeId) => graphVariableScopes(nodes, edges, nodeId),
    updateMedia: updateNodeMedia,
    updatePrompt,
    updateClips,
    selectOutput,
    execute: generateNodeMedia,
    uploadAudio,
    getClips,
    getReferences,
    removeReference,
    openReferencePicker: setReferencePickerNodeId,
    models,
  }), [nodes, edges, updateNodeMedia, updatePrompt, updateClips, selectOutput, generateNodeMedia, uploadAudio, getClips, getReferences, removeReference, models]);

  const canvasReferenceNodes = useMemo(() => nodes.filter((node) => node.id !== referencePickerNodeId && node.data?.preview && node.data?.outputs?.some((port) => ["IMAGE", "VIDEO"].includes(port.type))), [nodes, referencePickerNodeId]);

  async function runGraph(nodeId) {
    const onlyNode = typeof nodeId === "string" ? nodeId : undefined;
    const modelId = Number(selectedModel);
    if (!modelId) {
      showToast("请先选择运行模型", 2800);
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
        const clips = queue.map((clip, order) => ({ sourceNodeId: clip.sourceNodeId, outputIndex: clip.outputIndex, order, trimStart: clip.trimStart, trimEnd: clip.trimEnd, muted: Boolean(clip.muted), volume: clip.volume }));
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
          applyRunToCurrentNodes(setNodes, run);
          setRunProgress(run.progress || 0);
          setRunTotal(run.total || 1);
        },
      });
      if (controller.signal.aborted || !latest) return;
      if (latest.status === "SUCCEEDED") showToast(onlyNode ? "节点已生成" : "工作流运行完成", 3200);
      else if (latest.status === "PARTIAL_FAILED") showToast("部分节点失败，已保留成功结果", 3600);
      else showToast(latest.errorMessage || "工作流运行失败", 3600);
    } catch (error) {
      if (!controller.signal.aborted) showToast(error.message || "工作流运行失败", 3600);
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      runLock.current = false;
      if (!controller.signal.aborted) setRunning(false);
    }
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
    } catch (error) {
      showToast(error.message || "保存失败", 2800);
    }
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { event.preventDefault(); pasteToCanvas(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="studio-layout studio-layout--editor">
      <aside className={`node-panel ${sidebarOpen ? "" : "node-panel--closed"}`}>
        <header><div><strong>节点库</strong><small>点击或拖拽插入节点</small></div><button aria-label="收起节点库" onClick={() => setSidebarOpen(false)}><ChevronLeft size={16} /></button></header>
        <label className="node-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点" /></label>
        <div className="node-catalog-scroll">{visibleCatalog.map((group) => <section key={group.name}><span>{group.name}</span>{group.items.map((item) => { const Icon = item.icon; return <button draggable key={item.kind} onDragStart={(event) => { event.dataTransfer.setData("application/lightflow-node", JSON.stringify({ ...item, icon: undefined })); event.dataTransfer.effectAllowed = "move"; }} onClick={() => addCatalogNode(item)}><i className={`catalog-icon catalog-icon--${item.tone}`}><Icon size={15} /></i><span><strong>{item.name}</strong><small>{item.meta}</small></span><Plus size={14} /></button>; })}</section>)}</div>
        <button className="import-shortcut" onClick={() => fileRef.current?.click()}><Upload size={16} /> 导入 ComfyUI JSON</button>
        <input ref={fileRef} hidden type="file" accept=".json" onChange={(event) => onImport(event.target.files?.[0])} />
      </aside>

      <section ref={stageRef} className="flow-stage flow-stage--minimax" onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDoubleClick={(event) => { if (!event.target.closest(".react-flow__pane")) return; openPaneMenu(event); }}>
        <NodeEditContext.Provider value={nodeEditApi}><WorkflowNodeContext.Provider value={workflowNodeApi}><ReactFlow
          key={record.id}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(instance) => { setFlowInstance(instance); paintZoom(instance.getViewport().zoom); }}
          onMove={(_, viewport) => paintZoom(viewport.zoom)}
          onNodesChange={(changes) => { const settled = changes.some((change) => change.type === "remove" || (change.type === "position" && change.dragging === false)); if (settled) rememberGraph(); onNodesChange(changes); if (settled) setSaved(false); }}
          onEdgesChange={(changes) => { if (changes.some((change) => change.type === "remove")) rememberGraph(); onEdgesChange(changes); if (changes.some((change) => change.type === "remove")) setSaved(false); }}
          onConnect={onConnect}
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
          onPaneClick={() => { setAddMenu(null); setContextMenu(null); setComfyMenuOpen(false); setTidyMenuOpen(false); setReferencePickerNodeId(null); }}
          onPaneContextMenu={openPaneMenu}
          fitView
          fitViewOptions={fitOptions}
          minZoom={0.15}
          maxZoom={2}
          deleteKeyCode={["Backspace", "Delete"]}
          defaultEdgeOptions={edgeDefaults}
        >
          <Background color="#cfd4dc" gap={22} size={1.1} />
          <Panel position="top-left" className="flow-title">
            <button className="flow-back" onClick={onBack}><ArrowLeft size={15} /> 工作流记录</button>
            {!sidebarOpen && <button className="open-node-panel" onClick={() => setSidebarOpen(true)}><Box size={15} /> 节点库</button>}
            <div><span className={saved ? "status-dot" : "status-dot status-dot--warn"} /><strong>{record.title}</strong><small>{saved ? "已保存" : "有未保存更改"} · {nodes.length} 个节点</small></div>
          </Panel>
          <Panel position="top-right" className="flow-toolbar">
            <label className="workflow-model-select"><Sparkles size={15} /><select aria-label="工作流运行模型" value={selectedModel} onChange={(event) => onModelChange(event.target.value)}>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select><ChevronDown size={13} /></label>
            <button onClick={() => fileRef.current?.click()}><Upload size={15} /> 导入</button>
            <button onClick={saveWorkflow}><Save size={15} /> 保存</button>
            <button className="run-workflow" onClick={() => runGraph()} disabled={running || !nodes.length}>{running ? <><Zap size={15} className="spin" /> {runProgress}/{runTotal || 1}</> : <><CirclePlay size={16} /> 运行</>}</button>
          </Panel>
        </ReactFlow></WorkflowNodeContext.Provider></NodeEditContext.Provider>
        {referencePickerNodeId && <div className="reference-picker nodrag nowheel" role="dialog" aria-modal="true" aria-label="添加参考素材" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><strong>添加参考素材</strong><small>图片和视频统一连接到节点左侧输入点</small></div><button aria-label="关闭参考素材选择" onClick={() => setReferencePickerNodeId(null)}><X size={15} /></button></header>
          <div className="reference-picker__scroll">
            <section>
              <div className="reference-picker__section-title"><strong>画布素材</strong><span>{canvasReferenceNodes.length} 项</span></div>
              {canvasReferenceNodes.length ? <div className="reference-picker__grid">{canvasReferenceNodes.map((node) => {
                const type = node.data.assetType || node.data.outputs?.find((port) => ["IMAGE", "VIDEO"].includes(port.type))?.type || "IMAGE";
                const attached = edges.some((edge) => edge.source === node.id && edge.target === referencePickerNodeId);
                return <button className={attached ? "is-selected" : ""} key={node.id} onClick={() => attached ? removeReference(referencePickerNodeId, node.id) : attachReference(referencePickerNodeId, node.id)}>
                  <img src={node.data.preview} alt={node.data.title} /><span>{type === "VIDEO" ? <Film size={11} /> : <Image size={11} />}{node.data.title}</span><b>{attached ? "已引用" : "引用"}</b>
                </button>;
              })}</div> : <p className="reference-picker__empty">画布中还没有可引用的图片或视频。</p>}
            </section>
            <section>
              <div className="reference-picker__section-title"><strong>素材库</strong><span>选择后自动创建素材节点</span></div>
              <div className="reference-picker__grid">{referenceLibrary.map((asset) => {
                const existing = nodes.find((node) => node.data?.assetKey === asset.key);
                const attached = existing && edges.some((edge) => edge.source === existing.id && edge.target === referencePickerNodeId);
                return <button className={attached ? "is-selected" : ""} key={asset.key} onClick={() => attached ? removeReference(referencePickerNodeId, existing.id) : addReferenceAsset(referencePickerNodeId, asset)}>
                  <img src={asset.preview} alt={asset.title} /><span>{asset.type === "VIDEO" ? <Film size={11} /> : <Image size={11} />}{asset.title}</span><b>{attached ? "已引用" : existing ? "引用" : "添加并引用"}</b>
                </button>;
              })}</div>
            </section>
          </div>
          <footer><button onClick={() => referenceUploadRef.current?.click()}><Upload size={14} />本地上传图片或视频</button><button className="reference-picker__done" onClick={() => setReferencePickerNodeId(null)}><Check size={14} />完成</button></footer>
          <input ref={referenceUploadRef} hidden type="file" accept="image/*,video/*" onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              const validation = validateAssetFile(file);
              if (!validation.valid || validation.kind === "audio") throw new Error(validation.message || "请选择图片或视频文件");
              const asset = await uploadAsset(file);
              if (!asset?.storageKey) throw new Error("素材上传未返回存储地址");
              const type = validation.kind === "video" ? "VIDEO" : "IMAGE";
              const url = asset.url || asset.src || mediaUrl(asset.storageKey);
              addReferenceAsset(referencePickerNodeId, { key: asset.storageKey, title: asset.name || file.name, type, preview: asset.posterUrl || asset.poster || url, url });
            } catch (error) { showToast(error.message || "素材上传失败"); }
          }} />
        </div>}
        {selectedNodeIds.length >= 2 && <div className="canvas-selection-actions" onMouseDown={(event) => event.stopPropagation()}>
          <div className="canvas-selection-actions__bar">
            <button className={tidyMenuOpen ? "active" : ""} onClick={() => setTidyMenuOpen((value) => !value)}><LayoutGrid size={15} />整理<ChevronDown size={12} /></button>
            <button onClick={groupSelection}><Group size={15} />组合</button>
            <button onClick={() => showToast(`已将 ${selectedNodeIds.length} 个节点保存为画布资产`)}><PackagePlus size={15} />保存为资产</button>
          </div>
          {tidyMenuOpen && <div className="canvas-tidy-menu">
            <button onClick={() => arrangeSelection("grid")}><LayoutGrid size={15} /><span>网格排列</span></button>
            <button onClick={() => arrangeSelection("horizontal")}><Columns3 size={15} /><span>横向排列</span></button>
            <button onClick={() => arrangeSelection("vertical")}><Rows3 size={15} /><span>纵向排列</span></button>
            <label><input type="checkbox" checked={includeConnected} onChange={(event) => setIncludeConnected(event.target.checked)} /><span>同时整理相连的上下游节点</span><CircleHelp size={13} /></label>
          </div>}
        </div>}
        <div className="canvas-dock" aria-label="画布工具栏">
          <button className={`canvas-dock__add ${addMenu?.origin === "dock" ? "active" : ""}`} aria-label="添加节点" aria-expanded={addMenu?.origin === "dock"} onClick={() => { setContextMenu(null); setComfyMenuOpen(false); setAddMenu((value) => value?.origin === "dock" ? null : { origin: "dock" }); }}><Plus size={22} /></button>
          <button type="button" className={canvasTool === "select" ? "active" : ""} aria-label="框选工具" aria-pressed={canvasTool === "select"} onClick={() => setCanvasTool("select")}><MousePointer2 size={17} /></button>
          <button type="button" className={canvasTool === "pan" ? "active" : ""} aria-label="平移画布" aria-pressed={canvasTool === "pan"} onClick={() => setCanvasTool("pan")}><Hand size={17} /></button>
          <span className="canvas-dock__split" />
          <button type="button" aria-label="缩小画布" onClick={() => flowInstance?.zoomOut({ duration: 180 })}><ZoomOut size={16} /></button>
          <span className="canvas-zoom" ref={zoomLabelRef} aria-live="polite">100%</span>
          <button type="button" aria-label="放大画布" onClick={() => flowInstance?.zoomIn({ duration: 180 })}><ZoomIn size={16} /></button>
          <button type="button" aria-label="自适应全屏" onClick={() => flowInstance?.fitView({ ...fitOptions, duration: 280 })}><Scan size={16} /></button>
          <span className="canvas-dock__split" />
          <button type="button" aria-label={sidebarOpen ? "收起节点库" : "展开节点库"} onClick={() => setSidebarOpen((value) => !value)}>{sidebarOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
          <button type="button" aria-label="导入工作流" onClick={() => fileRef.current?.click()}><FolderOpen size={18} /></button>
          <button type="button" aria-label="画布帮助" onClick={() => showToast("滚轮或双指缩放，手型工具平移画布；悬停连线后点击即可删除。双击或右键打开快捷菜单。")}><CircleHelp size={17} /></button>
        </div>
        {addMenu && <div className={`canvas-add-menu ${addMenu.origin === "context" ? "is-contextual" : ""} ${addMenu.origin === "context" && addMenu.x > (stageRef.current?.clientWidth || 900) - 520 ? "submenu-left" : ""}`} style={addMenu.origin === "context" ? { left: addMenu.x, top: addMenu.y } : undefined} onMouseDown={(event) => event.stopPropagation()}>
          <header>添加节点</header>
          <div className="canvas-add-menu__items">{canvasQuickItems.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => addQuickNode(item)}><i><Icon size={18} /></i><span>{item.name}</span>{item.badge && <em className={item.badge === "MiniMax H3" ? "is-model" : ""}>{item.badge}</em>}</button>; })}</div>
          <div className="canvas-add-submenu-shell" onMouseEnter={() => setComfyMenuOpen(true)} onMouseLeave={() => setComfyMenuOpen(false)}><button className="canvas-add-menu__comfy" onClick={() => setComfyMenuOpen((value) => !value)}><i><Layers3 size={18} /></i><span>ComfyUI</span><em>新</em><ChevronRight size={15} /></button>{comfyMenuOpen && <div className="canvas-add-submenu"><header><button onClick={() => setSidebarOpen(true)}>探索更多</button></header><button onClick={createComfyWorkflow}><i><Plus size={17} /></i><span><strong>新建工作流</strong><small>创建空白 ComfyUI 工作流</small></span></button></div>}</div>
        </div>}
        {contextMenu && <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button onClick={openMaterialUpload}><Upload size={15} /><span>上传素材</span></button>
          <button onClick={() => { const next = { origin: "context", x: Math.min(contextMenu.x + 150, Math.max(10, (stageRef.current?.clientWidth || 900) - 260)), y: Math.max(10, Math.min(contextMenu.y, (stageRef.current?.clientHeight || 700) - 446)), clientX: contextMenu.clientX, clientY: contextMenu.clientY }; setContextMenu(null); setAddMenu(next); }}><Plus size={15} /><span>添加节点</span></button>
          <hr />
          <button disabled={!historyRef.current.length} onClick={undoGraph}><Undo2 size={15} /><span>撤销</span><kbd>Ctrl+Z</kbd></button>
          <button disabled={!futureRef.current.length} onClick={redoGraph}><Redo2 size={15} /><span>重做</span><kbd>Ctrl+Shift+Z</kbd></button>
          <hr />
          <button onClick={pasteToCanvas}><Clipboard size={15} /><span>粘贴</span><kbd>Ctrl+V</kbd></button>
        </div>}
        <input ref={materialRef} hidden type="file" accept="image/*,video/*,audio/*" onChange={placeUploadedMaterial} />
        {toast && <div className="run-toast"><Check size={16} /> {toast}</div>}
      </section>
    </div>
  );
}

export function WorkflowStudio({ onOpenTemplates, templateLaunch, models = [] }) {
  const [view, setView] = useState(templateLaunch ? "editor" : "library");
  const workflowModels = useMemo(() => models.filter((model) => model.enabled !== false && (model.capabilities?.includes("workflow") || ["image", "video", "audio"].includes(model.category))), [models]);
  const [selectedModel, setSelectedModel] = useState(() => workflowModels[0]?.id || "");
  const [record, setRecord] = useState(() => templateLaunch ? templateRecord(templateLaunch, workflowModels) : null);
  const [graph, setGraph] = useState(localWorkflow());
  const [editorKey, setEditorKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [libraryStatus, setLibraryStatus] = useState(null);

  useEffect(() => {
    if (!templateLaunch) return;
    setRecord(templateRecord(templateLaunch, workflowModels));
    setGraph(localWorkflow());
    setEditorKey((key) => key + 1);
    setView("editor");
  }, [templateLaunch, workflowModels]);
  useEffect(() => { if (workflowModels.length && !workflowModels.some((model) => String(model.id) === String(selectedModel))) setSelectedModel(workflowModels[0].id); }, [workflowModels, selectedModel]);
  useEffect(() => {
    if (view !== "library") return undefined;
    let cancelled = false;
    setLibraryStatus({ text: "正在加载工作流…" });
    listWorkflows().then((items) => {
      if (cancelled) return;
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
      setView("editor");
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
    setView("editor");
  }

  function importWorkflow(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        setRecord({ id: `import-${Date.now()}`, title: file.name.replace(/\.json$/i, ""), type: "import", model: "ComfyUI JSON", origin: "ComfyUI 导入", builtin: false });
        setGraph(normalizeWorkflow(json));
        setEditorKey((key) => key + 1);
        setView("editor");
      } catch {
        window.alert("无法读取该工作流，请确认它是有效的 ComfyUI JSON 文件。");
      }
    };
    reader.readAsText(file);
  }

  async function deleteRecord(target) {
    if (target.builtin) {
      window.alert("官方示例不能删除，可以打开后另存为自己的工作流。");
      return;
    }
    if (!window.confirm(`删除工作流「${target.title}」？`)) return;
    try {
      await removeWorkflow(target.id);
      setRecords((items) => items.filter((item) => item.id !== target.id));
    } catch (error) {
      window.alert(error.message || "删除失败");
    }
  }

  if (loading) return <div className="workflow-loading"><span><Sparkles size={22} /></span><strong>正在载入工作流</strong><small>读取画布、节点与连接…</small></div>;
  if (view === "library") return <WorkflowLibrary records={records} status={libraryStatus} onOpen={openRecord} onCreate={createWorkflow} onImport={importWorkflow} onOpenTemplates={onOpenTemplates} onDelete={deleteRecord} />;
  return <WorkflowEditor key={editorKey} record={record} initialGraph={graph} models={workflowModels} selectedModel={selectedModel} onModelChange={setSelectedModel} onRecordChange={setRecord} onBack={() => setView("library")} onImport={importWorkflow} />;
}

function templateRecord(template, models = []) {
  return {
    id: `template-${template.id}-${template.token}`,
    title: template.title,
    type: "template",
    model: models.length ? models[(Number(template.id) - 1) % models.length].name : "未选择",
    nodes: template.nodes,
  };
}
