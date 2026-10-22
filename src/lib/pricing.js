const DEFAULT_UNIT_PRICE = { image: 2, video: 12, audio: 3, text: 0 };

export const PRICING_UNITS = {
  image: ["张"],
  video: ["秒", "次"],
  audio: ["千字符", "万字符"],
  text: ["千Token", "百万Token"],
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
    for (const [unit, raw] of Object.entries(pricing?.[side]?.tiers || {})) {
      const amount = configuredPricingAmount(raw);
      if (amount == null) return `${sideLabel}分档价（${unit}）必须包含有效数字`;
      if (amount < 0) return `${sideLabel}分档价（${unit}）不能为负数`;
    }
  }
  return "";
}

export const VIDEO_RESOLUTION_MULTIPLIERS = { "480P": 0.5, "768P": 0.5, "720P": 0.75, "1080P": 1, "2K": 1.5, "4K": 2.5 };
export const IMAGE_RESOLUTION_MULTIPLIERS = { "2K": 2, "4K": 4 };
export const IMAGE_QUALITY_MULTIPLIERS = { MEDIUM: 1.5, HIGH: 2 };

// 分档价：视频/图片可按分辨率逐档定价（pricing.sale.tiers / pricing.cost.tiers），无 tiers 时回退基准价 × 全局倍率
export const TIER_UNITS = {
  video: Object.keys(VIDEO_RESOLUTION_MULTIPLIERS),
  image: ["1K", "2K", "4K"],
};
export const BASE_TIER = { video: "1080P", image: "1K" };

export function tierUnits(category) {
  return TIER_UNITS[category] || null;
}

export function formatCreditAmount(value) {
  return String(Math.round(value * 100) / 100);
}

// 按基准价 × 全局倍率推导各档价，作为编辑初值；售价带「积分」后缀、成本带「¥」前缀，与基准价写法一致
export function deriveTierPrices(basePrice, category, currency) {
  const units = TIER_UNITS[category];
  if (!units) return null;
  const entries = units.map((unit) => {
    const multiplier = category === "video"
      ? VIDEO_RESOLUTION_MULTIPLIERS[unit]
      : (IMAGE_RESOLUTION_MULTIPLIERS[unit] || 1);
    const amount = formatCreditAmount(basePrice * multiplier);
    return [unit, currency === "yuan" ? `¥${amount}` : `${amount} 积分`];
  });
  return Object.fromEntries(entries);
}

// tiers 缺失或残缺时按基准价补全推导值，保证视频/图片模型每档都有价
export function normalizeTierPricing(tiers, category, basePrice, currency) {
  const units = TIER_UNITS[category];
  if (!units) return tiers || undefined;
  const merged = { ...(tiers || {}) };
  const derived = deriveTierPrices(basePrice, category, currency);
  for (const unit of units) {
    if (!String(merged[unit] ?? "").trim()) merged[unit] = derived[unit];
  }
  return merged;
}

export function normalizePricing(category, pricing) {
  const defaults = defaultPricing(category);
  const current = pricing || {};
  const normalized = {
    ...defaults,
    ...current,
    unit: normalizePricingUnit(category, current.unit),
    sale: { ...defaults.sale, ...(current.sale || {}) },
    cost: { ...defaults.cost, ...(current.cost || {}) },
  };
  if (TIER_UNITS[category]) {
    // 视频/图片：按基准价补全各档价（sale.tiers / cost.tiers），计费优先取分档价，缺档回退基准 × 全局倍率
    normalized.sale.tiers = normalizeTierPricing(normalized.sale.tiers, category, parsePricingAmount(normalized.sale.output), "credit");
    normalized.cost.tiers = normalizeTierPricing(normalized.cost.tiers, category, parsePricingAmount(normalized.cost.output), "yuan");
  } else {
    delete normalized.sale.tiers;
    delete normalized.cost.tiers;
  }
  return normalized;
}

export function calculateCreditEstimate({ pricing, category, resolution, quality, durationSec, characterCount, copies = 1 }) {
  const configured = configuredPricingAmount(pricing?.sale?.output ?? pricing?.sale);
  const unitPrice = configured == null ? (DEFAULT_UNIT_PRICE[category] || 0) : Math.max(0, configured);
  const res = String(resolution || "").toUpperCase();
  let multiplier = 1;
  let qualityMultiplier = 1;
  if (category === "video") {
    multiplier = VIDEO_RESOLUTION_MULTIPLIERS[res] || 1;
  } else if (category === "image") {
    multiplier = IMAGE_RESOLUTION_MULTIPLIERS[res] || 1;
    qualityMultiplier = IMAGE_QUALITY_MULTIPLIERS[String(quality || "LOW").toUpperCase()] || 1;
  }
  // 有分档价：直接取该档价（图片清晰度倍率仍叠加）；无分档价：基准价 × 全局倍率
  const tierPrice = configuredPricingAmount(pricing?.sale?.tiers?.[res]);
  const effectivePrice = tierPrice == null
    ? unitPrice * multiplier * qualityMultiplier
    : Math.max(0, tierPrice) * qualityMultiplier;

  let quantity = 1;
  if (category === "video" && pricing?.unit === "秒") quantity = Math.max(1, Number(durationSec) || 1);
  if (category === "audio") {
    const count = Math.max(1, Number(characterCount) || 1);
    if (pricing?.unit === "千字符") quantity = count / 1000;
    if (pricing?.unit === "万字符") quantity = count / 10000;
  }
  const safeCopies = Math.min(4, Math.max(1, Number(copies) || 1));
  return Math.ceil(effectivePrice * quantity * safeCopies);
}
