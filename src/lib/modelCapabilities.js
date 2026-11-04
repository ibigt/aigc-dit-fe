// 各创作类型的可选参数，以及「按模型能力收敛」的判定。
// 原先只有 FastCreate.jsx 内联持有，高级工作台的节点卡片拿不到，两边口径会漂移
// （例如工作台按 2K 报价、模型其实只支持 720P），故抽到共享模块，两处共用同一套规则。

export const videoRatios = ["自动", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
export const imageRatios = ["21:9", "16:9", "5:4", "4:3", "3:2", "1:1", "2:3", "3:4", "4:5", "9:16"];
export const videoDurations = [4, 5, 6, 7, 8, 9, 10, 11, 12];
export const miniMaxDurations = [4, 5, 6, 7, 8, 9, 10, 11, 12];
export const miniMaxMaxDurations = Array.from({ length: 11 }, (_, index) => index + 5);
// SGLang 部署的 H3 服务端约束 target.duration_seconds ∈ [5, 15]，4 秒会 HTTP 400（官方 API 才允许 4 秒）
export const miniMaxSglangDurations = Array.from({ length: 11 }, (_, index) => index + 5);
export const miniMaxComfyDurations = Array.from({ length: 11 }, (_, index) => index + 5);
export const agnesDurations = Array.from({ length: 9 }, (_, index) => index + 4);
export const videoResolutions = ["480P", "720P", "1080P", "2K", "4K"];
// 图片分辨率档位与图片计费分档保持一致（1K 为基准档）
export const imageResolutions = ["1K", "2K", "4K"];
export const MODE_CAPS = ["t2i", "i2i", "t2v", "r2v", "i2v", "t2a"];

export function canonicalCap(cap) {
  if (cap === "frames" || cap === "frame" || cap === "v2v") return "i2v";
  return cap;
}

export function modelSupports(model, mode) {
  if (mode === "r2v" && isMiniMaxH3Max(model)) return false;
  const caps = Array.isArray(model?.capabilities) ? model.capabilities.map(canonicalCap) : [];
  if (!caps.length) return true;
  const specific = caps.filter((item) => MODE_CAPS.includes(item));
  if (!specific.length) return true;
  return specific.includes(mode);
}

export function supportsLibraryCite(model, generationType, videoMode) {
  if (generationType === "audio") return false;
  if (generationType === "image") return modelSupports(model, "i2i");
  if (videoMode === "frames") return modelSupports(model, "i2v");
  return modelSupports(model, "r2v");
}

export function isMiniMaxH3(model) {
  return model?.adapterKey === "minimax-h3" || String(model?.modelKey || "").toLowerCase().includes("minimax");
}

export function isMiniMaxComfy(model) {
  return isMiniMaxH3(model) && /comfy/i.test(String(model?.provider || ""));
}

export function isMiniMaxSglang(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  return adapter === "minimax-h3-sglang" || (isMiniMaxH3(model) && /sglang/i.test(String(model?.provider || "")));
}

export function isMiniMaxOfficial(model) {
  return isMiniMaxH3(model) && !isMiniMaxComfy(model);
}

export function isAgnes(model) {
  const key = String(model?.adapterKey || model?.modelKey || "").toLowerCase();
  return key.includes("agnes");
}

export function isSeedance25(model) {
  const key = String(model?.adapterKey || model?.modelKey || "").toLowerCase();
  return key.includes("seedance-2.5") || key.includes("seedance-2-5") || key.includes("doubao-seedance-2-5");
}

export function isSeedance20Official(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  return adapter === "seedance-2.0" || key.includes("doubao-seedance-2-0") || key.includes("doubao-seedance-2.0");
}

export function isSeedanceOfficial(model) {
  return isSeedance25(model) || isSeedance20Official(model);
}

export function isSeedanceFast(model) {
  return String(model?.modelKey || "").toLowerCase().includes("fast");
}

export function isSeedanceMini(model) {
  return String(model?.modelKey || "").toLowerCase().includes("mini");
}

export function imageOnlyRefs(model) {
  return isAgnes(model);
}

/**
 * 模型是否接受「视频参考素材」（整段视频透传给生成模型）。
 * 仅图片参考的通道（Agnes）不支持；其余按 r2v 能力判定。
 */
export function supportsVideoReference(model) {
  if (imageOnlyRefs(model)) return false;
  return modelSupports(model, "r2v");
}

export function isMiniMaxH3Max(model) {
  return String(model?.modelKey || "").toLowerCase().includes("h3-max")
    || String(model?.modelKey || "").toLowerCase().includes("h3_max");
}

export function durationOptionsFor(model) {
  if (isMiniMaxSglang(model)) return miniMaxSglangDurations;
  if (isMiniMaxH3Max(model)) return miniMaxMaxDurations;
  if (isMiniMaxComfy(model)) return miniMaxComfyDurations;
  if (isMiniMaxH3(model)) return miniMaxDurations;
  if (isAgnes(model)) return agnesDurations;
  return videoDurations;
}

export function videoResolutionsFor(model) {
  if (isAgnes(model)) return ["720P"];
  if (isMiniMaxH3Max(model) && isMiniMaxOfficial(model)) return ["480P", "768P"];
  if (isMiniMaxOfficial(model)) return ["768P", "2K"];
  if (isMiniMaxComfy(model)) return videoResolutions;
  // Seedance fast 与 mini 官方仅支持 480P / 720P
  if (isSeedance25(model) || (isSeedance20Official(model) && (isSeedanceFast(model) || isSeedanceMini(model)))) return ["480P", "720P"];
  if (isSeedance20Official(model)) return ["480P", "720P", "1080P"];
  // Wan 3.0 官方接口只支持 480P / 720P / 1080P，其余档位会被服务端静默降级成 720P，
  // 展示出来会导致按高档位收费却只生成 720P
  if (isWan3Model(model)) return ["480P", "720P", "1080P"];
  return videoResolutions;
}

// 各创作类型的可选分辨率：视频按模型能力收敛，图片固定 1K/2K/4K（与计费分档一致）
export function resolutionOptionsFor(model, generationType) {
  if (generationType === "video") return videoResolutionsFor(model);
  if (generationType === "image") return imageResolutions;
  return [];
}

export function clampDurationForModel(model, duration) {
  const options = durationOptionsFor(model);
  if (options.includes(duration)) return duration;
  return options.find((item) => item >= duration) || options[options.length - 1] || 5;
}

export function isMockModel(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  const provider = String(model?.provider || "").toLowerCase();
  const endpoint = String(model?.endpoint || "").toLowerCase();
  return adapter === "mock" || key.startsWith("mock") || provider.includes("mock") || endpoint.includes("/mock-api");
}

export function isSeedreamModel(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  return adapter.startsWith("seedream") || key.includes("seedream");
}

export function isOpenAiImageModel(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  return adapter === "gpt-image-2.0" || adapter === "gpt-image-2.5"
    || ((adapter.startsWith("gpt-image") || key.includes("gpt-image")) && /官方|openai/i.test(String(model?.provider || "")));
}

export function isWan3Model(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  const provider = String(model?.provider || "").toLowerCase();
  return adapter === "wan3" || key.includes("wan3") || key.includes("wan-3")
    || provider.includes("dashscope") || provider.includes("百炼");
}

export function isRunningHubModel(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  return adapter === "gpt-image-2" || adapter === "seedance-2"
    || String(model?.provider || "").toLowerCase() === "runninghub";
}

export function maxCopiesFor(model) {
  if (model?.category === "audio") return 1;
  const configured = Number(model?.maxCopies ?? model?.adapterConfig?.maxCopies ?? model?.pricing?.maxCopies);
  if (Number.isFinite(configured)) return Math.min(4, Math.max(1, Math.floor(configured)));
  if (isRunningHubModel(model) || isAgnes(model) || isMiniMaxH3(model) || isSeedanceOfficial(model)) return 1;
  if (isSeedreamModel(model) || isOpenAiImageModel(model) || isWan3Model(model)
    || /comfyui/i.test(String(model?.provider || ""))) {
    return 4;
  }
  return isMockModel(model) ? 4 : 1;
}

// 节点上只存模型名，售价（pricing）在模型目录里：优先取实时目录，其次取节点自带的那份。
export function findWorkflowModel(models, modelName) {
  const list = Array.isArray(models) ? models : [];
  const target = String(modelName ?? "").trim();
  if (!target) return null;
  return list.find((item) => {
    if (typeof item === "string") return item === target;
    return String(item?.name ?? "").trim() === target;
  }) || null;
}

// 高级工作台视频节点的生成模式：中文档位 ↔ 模型能力（对齐小云雀两形态）
//   参考视频 = r2v，图片+视频(+音频)混合参考（视频整段透传，保留动作/运镜/节奏；图片定人物/风格）
//   参考帧   = i2v，首帧 + 尾帧显式图框（起止画面硬约束，只吃图片，与参考素材互斥）
// value 是**落库 + 发给后端**的档位名。后端 WorkflowGraphPlanner 按显式白名单判定，
// 新旧档位写法（参考帧 / 首尾帧）都认；「参考视频」判定视频整段透传。
export const WORKFLOW_VIDEO_MODES = [
  { value: "参考视频", label: "参考生成", cap: "r2v", videoRef: true, default: true },
  { value: "参考帧", label: "首尾帧", cap: "i2v" },
];

// 旧工作流落库的档位名 → 现档位。「参考图/全能参考」本质是 r2v 图片参考，
// 与「参考视频」同一 API 形态，统一归到「参考视频」（上游图片连线行为不变）。
const LEGACY_VIDEO_MODE = { 全能参考: "参考视频", 参考图: "参考视频", 首尾帧: "参考帧" };

/** 旧档位名归一（读旧数据时用，避免模式被误判成「不支持」而重置）。 */
export function normalizeWorkflowVideoMode(mode) {
  const raw = String(mode ?? "").trim();
  return LEGACY_VIDEO_MODE[raw] || raw;
}

// 档位值 → 展示文案；未登记的值原样返回
export function workflowModeLabel(mode) {
  const hit = WORKFLOW_VIDEO_MODES.find((item) => item.value === mode);
  return hit ? hit.label : mode;
}
const WORKFLOW_COPY_LIMIT = 4;

// 节点只存模型名；目录里查不到（离线兜底模型 / 纯字符串）时按「无能力约束」处理，保持旧行为。
export function resolveWorkflowModel(models, fallbackModels, modelName) {
  const found = findWorkflowModel(models, modelName) || findWorkflowModel(fallbackModels, modelName);
  return found && typeof found === "object" ? found : null;
}

// 工作台节点卡片「生成设置」的可选项，按所选模型能力收敛（与快速创作同口径）。
export function workflowMediaOptions(model, isVideo) {
  const generationType = isVideo ? "video" : "image";
  const copyLimit = model ? maxCopiesFor(model) : WORKFLOW_COPY_LIMIT;
  const modes = isVideo
    ? WORKFLOW_VIDEO_MODES
      .filter((item) => {
        if (item.cap === "i2v") {
          // 首尾帧：仍按模型 i2v 能力过滤（RunningHub 的 Seedance-2 不支持首尾帧）
          return modelSupports(model, "i2v");
        }
        // 参考视频（r2v）：与后端 AdapterCatalog 对齐——所有视频适配器都支持 r2v，
        // 故视频节点默认即可走（即便 DB capabilities 漏写 r2v、或历史 H3-Max 限制，也按后端口径放行）
        if (item.videoRef) {
          return !imageOnlyRefs(model) || model?.category === "video";
        }
        return modelSupports(model, item.cap);
      })
      .map((item) => item.value)
    : [];
  return {
    ratios: isVideo ? videoRatios : imageRatios,
    resolutions: resolutionOptionsFor(model, generationType),
    durations: isVideo ? durationOptionsFor(model) : [],
    copies: Array.from({ length: copyLimit }, (_, index) => index + 1),
    // 模型声明的能力一个都对不上时不把入口全藏掉，退回全部模式，由提交时的校验兜底
    modes: isVideo ? (modes.length ? modes : WORKFLOW_VIDEO_MODES.map((item) => item.value)) : [],
  };
}

function pickResolution(current, options, preferred) {
  if (!options.length) return current;
  const hit = options.find((item) => item.toLowerCase() === String(current ?? "").toLowerCase());
  if (hit) return hit;
  return options.find((item) => preferred.includes(item)) || options[0];
}

// 把节点当前取值收敛到模型支持的范围内；返回完整的归一化结果与需要回写的差异。
export function normalizeWorkflowMedia(media = {}, model, isVideo) {
  const options = workflowMediaOptions(model, isVideo);
  const next = {
    ratio: options.ratios.includes(media.ratio) ? media.ratio : "16:9",
    resolution: pickResolution(media.resolution, options.resolutions, isVideo ? ["1080P", "720P"] : ["1K"]),
    copies: Math.min(options.copies.length, Math.max(1, Number(media.copies) || 1)),
  };
  if (isVideo) {
    const duration = Number(media.duration ?? media.durationSec) || 5;
    const clamped = clampDurationForModel(model, duration);
    next.duration = clamped;
    next.durationSec = clamped;
    // 旧工作流存的是「全能参考/参考图」，先归一成「参考视频」再判断是否受支持
    const currentMode = normalizeWorkflowVideoMode(media.mode);
    next.mode = options.modes.includes(currentMode) ? currentMode : options.modes[0];
  }
  const patch = {};
  Object.entries(next).forEach(([key, value]) => {
    if (media[key] !== value) patch[key] = value;
  });
  return { options, values: next, patch };
}
