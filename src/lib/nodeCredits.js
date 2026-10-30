import { billableCharacters, calculateCreditEstimate, resolveCjkWeight } from "./pricing.js";
import { findWorkflowModel } from "./modelCapabilities.js";

// 高级工作台节点的「图像质量」用中文档位，定价口径用 LOW/MEDIUM/HIGH（与后端 CreditCalculator 一致）。
const QUALITY_KEYS = { 低: "LOW", 中: "MEDIUM", 高: "HIGH" };

export function workflowQualityKey(quality) {
  const raw = String(quality ?? "").trim();
  if (!raw) return "HIGH";
  const mapped = QUALITY_KEYS[raw];
  if (mapped) return mapped;
  const upper = raw.toUpperCase();
  return upper === "LOW" || upper === "MEDIUM" || upper === "HIGH" ? upper : "HIGH";
}

// 节点上只存模型名，售价（pricing）在模型目录里：优先取实时目录，其次取节点自带的那份。
// 实现与模型能力判定放在同一共享模块，这里仅转出，保持既有 import 路径可用。
export { findWorkflowModel };

function safeCopies(copies) {
  return Math.min(4, Math.max(1, Number(copies) || 1));
}

// 媒体节点（图像/视频）按「所选模型 + 分辨率 + 清晰度 + 时长 + 副本数」估价。
export function mediaNodeCreditCost({ media = {}, models = [], isVideo = false, referenceVideoSeconds = 0 } = {}) {
  const copies = safeCopies(media.copies);
  const model = findWorkflowModel(models, media.model) || findWorkflowModel(media.models, media.model);
  if (!model?.pricing) {
    // 模型没下发布价（离线兜底模型）时退回节点自带的静态价，别显示一个假价格
    return (Number(media.points) || (isVideo ? 600 : 80)) * copies;
  }
  return calculateCreditEstimate({
    pricing: model.pricing,
    category: isVideo ? "video" : "image",
    resolution: media.resolution,
    quality: workflowQualityKey(media.quality),
    durationSec: Number(media.duration ?? media.durationSec) || 5,
    // 参考视频（r2v 的视频输入）按模型最高档价计，与后端 CreditCalculator 同口径
    referenceVideoSeconds,
    copies,
  });
}

// 音频节点按所选语音模型的「千字符/万字符」口径估价。
export function audioNodeCreditCost({ media = {}, models = [] } = {}) {
  const copies = safeCopies(media.copies);
  const modelName = media.model;
  const model = findWorkflowModel(models, modelName) || findWorkflowModel(media.models, modelName);
  if (!model?.pricing) {
    return (Number(media.points) || 20) * copies;
  }
  return calculateCreditEstimate({
    pricing: model.pricing,
    category: "audio",
    characterCount: billableCharacters(
      media.prompt || "",
      resolveCjkWeight(model.pricing, model.adapterKey),
    ),
    copies,
  });
}
