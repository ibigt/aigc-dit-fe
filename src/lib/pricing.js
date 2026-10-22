const DEFAULT_UNIT_PRICE = { image: 2, video: 12, audio: 3, text: 0 };

export const PRICING_UNITS = {
  image: ["张", "次"],
  video: ["秒", "次"],
  audio: ["千字符", "万字符", "次"],
  text: ["千Token", "百万Token", "次"],
};

export function pricingUnits(category) {
  return PRICING_UNITS[category] || ["次"];
}

export function defaultPricing(category = "image") {
  const unit = pricingUnits(category)[0];
  const output = DEFAULT_UNIT_PRICE[category] || 0;
  return {
    unit,
    sale: { input: "0", output: `${output} 积分`, cache: "0" },
    cost: { input: "0", output: "¥0", cache: "0" },
  };
}

export function normalizePricingUnit(category, unit) {
  return pricingUnits(category).includes(unit) ? unit : pricingUnits(category)[0];
}

export function normalizePricing(category, pricing) {
  const defaults = defaultPricing(category);
  const current = pricing || {};
  return {
    ...defaults,
    ...current,
    unit: normalizePricingUnit(category, current.unit),
    sale: { ...defaults.sale, ...(current.sale || {}) },
    cost: { ...defaults.cost, ...(current.cost || {}) },
  };
}

export function parsePricingAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function configuredPricingAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function pricingValidationError(pricing, category) {
  const unit = pricing?.unit;
  if (!pricingUnits(category).includes(unit)) return "请选择与模型类型匹配的计费单位";
  const dimensions = category === "text" ? ["input", "output", "cache"] : ["output"];
  const labels = { input: "输入", output: category === "text" ? "输出" : "单价", cache: "缓存命中" };
  for (const [side, sideLabel] of [["sale", "售价"], ["cost", "成本"]]) {
    for (const dimension of dimensions) {
      const raw = pricing?.[side]?.[dimension];
      if (raw == null || String(raw).trim() === "") return `${sideLabel}${labels[dimension]}不能为空`;
      const amount = configuredPricingAmount(raw);
      if (amount == null) return `${sideLabel}${labels[dimension]}必须包含有效数字`;
      if (amount < 0) return `${sideLabel}${labels[dimension]}不能为负数`;
    }
  }
  return "";
}

export function calculateCreditEstimate({ pricing, category, resolution, quality, durationSec, characterCount, copies = 1 }) {
  const configured = configuredPricingAmount(pricing?.sale?.output ?? pricing?.sale);
  const unitPrice = configured == null ? (DEFAULT_UNIT_PRICE[category] || 0) : Math.max(0, configured);
  let multiplier = 1;
  if (category === "video") {
    multiplier = ({ "480P": 0.5, "768P": 0.5, "720P": 0.75, "1080P": 1, "2K": 1.5, "4K": 2.5 })[String(resolution || "").toUpperCase()] || 1;
  } else if (category === "image") {
    const resolutionMultiplier = ({ "2K": 2, "4K": 4 })[String(resolution || "").toUpperCase()] || 1;
    const qualityMultiplier = ({ MEDIUM: 1.5, HIGH: 2 })[String(quality || "LOW").toUpperCase()] || 1;
    multiplier = resolutionMultiplier * qualityMultiplier;
  }

  let quantity = 1;
  if (category === "video" && pricing?.unit === "秒") quantity = Math.max(1, Number(durationSec) || 1);
  if (category === "audio") {
    const count = Math.max(1, Number(characterCount) || 1);
    if (pricing?.unit === "千字符") quantity = count / 1000;
    if (pricing?.unit === "万字符") quantity = count / 10000;
  }
  const safeCopies = Math.min(4, Math.max(1, Number(copies) || 1));
  return Math.ceil(unitPrice * quantity * multiplier * safeCopies);
}
