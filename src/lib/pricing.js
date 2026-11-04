const DEFAULT_UNIT_PRICE = { image: 2, video: 12, audio: 3, text: 0 };

export const PRICING_UNITS = {
  image: ["张"],
  video: ["秒"],
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
  const cjkWeight = pricing?.cjkWeight;
  if (cjkWeight != null && String(cjkWeight).trim() !== "" && Number(cjkWeight) !== 1 && Number(cjkWeight) !== 2) {
    return "汉字计费口径必须是 1 或 2";
  }
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

// 同类计费单位互转时的换算系数（字符：1 万字符 = 10 千字符；Token：1 百万Token = 1000 千Token）
const UNIT_SCALE = { 千字符: 1, 万字符: 10, 千Token: 1, 百万Token: 1000 };

// 切换计费单位时保持实际单价不变：按换算系数同步缩放售价与成本，
// 避免只改单位导致同一次生成的实际价格瞬间相差 10 倍（字符）或 1000 倍（Token）。
// 文本模型输入/输出/缓存三个维度同比例换算；恒为 0 的维度保持原样不重写。
export function convertPricingUnit(pricing, category, nextUnit) {
  const previousUnit = normalizePricingUnit(category, pricing?.unit);
  const next = { ...(pricing || {}) };
  if (previousUnit === nextUnit) return { ...next, unit: nextUnit };
  const from = UNIT_SCALE[previousUnit];
  const to = UNIT_SCALE[nextUnit];
  if (!from || !to || from === to) return { ...next, unit: nextUnit };
  const factor = to / from;
  for (const side of ["sale", "cost"]) {
    const values = { ...(next[side] || {}) };
    let changed = false;
    for (const dimension of ["input", "output", "cache"]) {
      const amount = configuredPricingAmount(values[dimension]);
      if (amount == null || amount === 0) continue;
      values[dimension] = side === "sale" ? `${formatExactAmount(amount * factor)} 积分` : `¥${formatExactAmount(amount * factor)}`;
      changed = true;
    }
    if (changed) next[side] = values;
  }
  return { ...next, unit: nextUnit };
}

// 单位换算专用格式化：÷1000 会产生 3~5 位小数，保留 6 位并去尾零，保证换算后实际单价分毫不差
function formatExactAmount(value) {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(parseFloat(rounded.toFixed(6)));
}

// 语音计费字符数的默认汉字权重：MiniMax 口径 1 汉字 = 2 字符。
export const DEFAULT_CJK_WEIGHT = 2;

// 供应商计费口径内置表镜像——仅用于「新建模型」时预览口径（服务端尚未下发生效值）。
// 已保存模型的生效口径由服务端从内置规则表解析后写进 pricing.cjkWeight，前端直接读取，不在此处推断。
const BUILTIN_CHARACTER_RULES = {
  "minimax-speech": { weight: 2, label: "1 汉字 = 2 字符", source: "MiniMax 官方计费规则：按输入文本的字符数计费，1 个汉字算 2 个字符" },
  "openai-speech": { weight: 1, label: "1 字 = 1 字符", source: "按输入文本的字符数计费，1 字算 1 字符" },
};

// 汉字计费口径：1 = 1 字 = 1 字符，2 = 1 汉字 = 2 字符。
// 优先读服务端下发的生效值 pricing.cjkWeight；未下发时才按内置表镜像兜底。
export function resolveCjkWeight(pricing, adapterKey) {
  const configured = Number(pricing?.cjkWeight);
  if (configured === 1 || configured === 2) return configured;
  return BUILTIN_CHARACTER_RULES[String(adapterKey || "")]?.weight ?? DEFAULT_CJK_WEIGHT;
}

// 口径的展示文案（说明 + 官方依据）；服务端已下发时直接用其口径，未下发时按内置表镜像兜底。
export function characterRuleText(pricing, adapterKey) {
  const label = pricing?.cjkWeightLabel;
  const source = pricing?.cjkWeightSource;
  if (label) return { label, source: source || "" };
  const builtin = BUILTIN_CHARACTER_RULES[String(adapterKey || "")];
  if (builtin) return { label: builtin.label, source: builtin.source };
  const weight = resolveCjkWeight(pricing, adapterKey);
  return {
    label: weight === 1 ? "1 字 = 1 字符" : "1 汉字 = 2 字符",
    source: "未登记供应商，按默认口径处理；请核对官方计费规则",
  };
}

// 语音计费字符数：汉字（CJK）按 cjkWeight 计，其余字母/数字/标点/空格各算 1。
// 后端 CreditCalculator.billableCharacters 使用同一规则，避免前后端估价与实扣不一致。
export function billableCharacters(text, cjkWeight = DEFAULT_CJK_WEIGHT) {
  const value = String(text ?? "");
  const weight = Number(cjkWeight) === 1 ? 1 : 2;
  let total = 0;
  for (const char of value) {
    total += isCjk(char) ? weight : 1;
  }
  return total;
}

function isCjk(char) {
  // 仅汉字表意文字算 2；标点（含全角标点）、字母、数字、空格等一律算 1
  const code = char.codePointAt(0);
  return (code >= 0x4e00 && code <= 0x9fff)      // CJK 统一表意文字
    || (code >= 0x3400 && code <= 0x4dbf)      // 扩展 A
    || (code >= 0xf900 && code <= 0xfaff);     // 兼容表意文字
}

// 模型最高档单价（每单位）：取 sale.tiers 里最高的档价，与基准价取大者。
// 参考视频查不到自身档位时按此价兜底——上游对输入视频也按 token 计费，保守不亏本。
export function highestTierUnitPrice(pricing, fallbackUnitPrice = 0) {
  let highest = Math.max(0, Number(fallbackUnitPrice) || 0);
  const tiers = pricing?.sale?.tiers || {};
  for (const value of Object.values(tiers)) {
    const amount = configuredPricingAmount(value);
    if (amount != null && amount > highest) highest = amount;
  }
  return highest;
}

// 视频分辨率档位（与后端 VideoTiers 同规则）：上游分辨率名或素材宽高 → 定价档位名。
const VIDEO_TIERS = ["480P", "720P", "768P", "1080P", "2K", "4K"];

export function videoTierOf({ resolution, width, height } = {}) {
  const value = String(resolution ?? "").trim().toUpperCase();
  if (value && VIDEO_TIERS.includes(value)) return value;
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) return null;
  const shortSide = Math.min(w, h);
  if (shortSide <= 480) return "480P";
  if (shortSide <= 720) return "720P";
  if (shortSide <= 768) return "768P";
  if (shortSide <= 1080) return "1080P";
  if (shortSide <= 1440) return "2K";
  return "4K";
}

// 多段参考视频取更贵的一档（档位未知时返回 null，由调用方按最高档兜底）。
export function highestVideoTier(current, candidate) {
  if (!candidate) return current || null;
  if (!current) return candidate;
  const currentRank = VIDEO_TIERS.indexOf(current);
  const candidateRank = VIDEO_TIERS.indexOf(candidate);
  if (currentRank < 0) return candidate;
  if (candidateRank < 0) return current;
  return candidateRank > currentRank ? candidate : current;
}

/**
 * 参考视频（视频输入）的单价：按它自己的分辨率档取价。
 * 上游按输入视频自己的 token 计费，各档售价即各档成本 × 倍率，按自身档计价刚好保本；
 * 查不到档位或该模型没有这一档的价时退回模型最高档，保守不亏本。与后端 CreditCalculator 同口径。
 */
export function referenceUnitPrice(pricing, referenceVideoResolution, fallbackUnitPrice = 0) {
  const tier = String(referenceVideoResolution ?? "").trim().toUpperCase();
  const own = tier ? configuredPricingAmount(pricing?.sale?.tiers?.[tier]) : null;
  if (own != null) return Math.max(0, own);
  return highestTierUnitPrice(pricing, fallbackUnitPrice);
}

/** 1 元 = 10 积分（充值口径）；售价积分 ÷ 10 = 售价金额（元）。 */
export const CREDITS_PER_YUAN = 10;

/**
 * 能力统一价校验：能力之间不分价——同一模型的所有能力共用同一套「分辨率分档价」，
 * 因此任一档的售价都必须覆盖该档成本，否则无论用户选哪个能力都会亏本。
 * 返回错误文案，通过则返回空串。
 */
export function capabilityPricingError(pricing, category) {
  if (!pricing) return "";
  const sale = pricing.sale || {};
  const cost = pricing.cost || {};
  const tiers = sale.tiers || {};
  const costTiers = cost.tiers || {};
  const check = (label, saleRaw, costRaw) => {
    const saleAmount = configuredPricingAmount(saleRaw);
    const costAmount = configuredPricingAmount(costRaw);
    if (saleAmount == null || costAmount == null || costAmount <= 0) return "";
    if (saleAmount / CREDITS_PER_YUAN < costAmount) {
      return `${label} 售价 ${saleAmount} 积分（约 ¥${(saleAmount / CREDITS_PER_YUAN).toFixed(2)}）低于成本 ¥${costAmount}，会亏本`;
    }
    return "";
  };
  const unitNames = TIER_UNITS[category] || [];
  for (const unit of unitNames) {
    const error = check(`${unit} 档`, tiers[unit], costTiers[unit]);
    if (error) return error;
  }
  if (!unitNames.length || !Object.keys(tiers).length) {
    return check("基准档", sale.output, cost.output);
  }
  return "";
}

/** 参考视频（视频输入）那部分的积分：按它自己的分辨率档价 × 秒数。 */
export function referenceVideoCreditCost({ pricing, referenceVideoSeconds = 0, referenceVideoResolution = null } = {}) {
  const seconds = Math.max(0, Number(referenceVideoSeconds) || 0);
  if (seconds <= 0) return 0;
  const unitPrice = configuredPricingAmount(pricing?.sale?.output ?? pricing?.sale) ?? 0;
  return Math.ceil(referenceUnitPrice(pricing, referenceVideoResolution, unitPrice) * seconds);
}

export function calculateCreditEstimate({ pricing, category, resolution, quality, durationSec, referenceVideoSeconds = 0, referenceVideoResolution = null, characterCount, copies = 1 }) {
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
  if (category === "video" && pricing?.unit === "秒") {
    quantity = Math.max(1, Number(durationSec) || 1);
  }
  if (category === "audio") {
    const count = Math.max(1, Number(characterCount) || 1);
    if (pricing?.unit === "千字符") quantity = count / 1000;
    if (pricing?.unit === "万字符") quantity = count / 10000;
  }
  const safeCopies = Math.min(4, Math.max(1, Number(copies) || 1));
  if (category === "video" && pricing?.unit === "秒") {
    // 输出部分：所选分辨率档价 × 时长 × 副本数。
    let total = effectivePrice * quantity * safeCopies;
    // 参考视频（r2v 的视频输入）：按它自己的分辨率档价计一次（同一份输入多副本不重复计）——
    // 上游按输入视频自己的 token 计费，各档售价即各档成本 × 倍率，按自身档计价刚好保本；
    // 查不到参考视频档位时退回模型最高档，保守不亏本。
    const refSeconds = Math.max(0, Number(referenceVideoSeconds) || 0);
    if (refSeconds > 0) {
      total += referenceUnitPrice(pricing, referenceVideoResolution, unitPrice) * refSeconds;
    }
    return Math.ceil(total * qualityMultiplier);
  }
  return Math.ceil(effectivePrice * quantity * safeCopies);
}
