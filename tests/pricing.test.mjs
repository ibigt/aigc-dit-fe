import test from "node:test";
import assert from "node:assert/strict";
import { billableCharacters, calculateCreditEstimate, characterRuleText, configuredPricingAmount, convertPricingUnit, normalizePricing, normalizePricingUnit, parsePricingAmount, pricingUnits, pricingValidationError, resolveCjkWeight } from "../src/lib/pricing.js";

test("pricing units are constrained by model category", () => {
  // 2026-10-22 起「次」已从所有类型移除（视频秒/图片张/语音字符/文本Token）
  assert.deepEqual(pricingUnits("image"), ["张"]);
  assert.deepEqual(pricingUnits("video"), ["秒"]);
  assert.deepEqual(pricingUnits("audio"), ["千字符", "万字符"]);
  assert.deepEqual(pricingUnits("text"), ["千Token", "百万Token"]);
  assert.equal(normalizePricingUnit("video", "张"), "秒");
});

test("category changes retain output price while adding required text dimensions", () => {
  const pricing = normalizePricing("text", { unit: "张", sale: { output: "5 积分" }, cost: { output: "¥0.2" } });
  assert.equal(pricing.unit, "千Token");
  assert.deepEqual(pricing.sale, { input: "0", output: "5 积分", cache: "0" });
  assert.deepEqual(pricing.cost, { input: "0", output: "¥0.2", cache: "0" });
});

test("pricing amount accepts stored labels", () => {
  assert.equal(parsePricingAmount("12.5 积分"), 12.5);
  assert.equal(parsePricingAmount("¥0.20"), 0.2);
  assert.equal(configuredPricingAmount(""), null);
});

test("explicit zero is free and negative pricing cannot add credits", () => {
  assert.equal(calculateCreditEstimate({ pricing: { unit: "张", sale: { output: "0" } }, category: "image" }), 0);
  assert.equal(calculateCreditEstimate({ pricing: { unit: "秒", sale: { output: "-12" } }, category: "video", durationSec: 5 }), 0);
  assert.equal(calculateCreditEstimate({ pricing: null, category: "video", durationSec: 5 }), 12);
});

test("pricing validation accepts free prices and rejects blank or negative values", () => {
  const valid = { unit: "张", sale: { output: "0 积分" }, cost: { output: "¥0" } };
  assert.equal(pricingValidationError(valid, "image"), "");
  assert.match(pricingValidationError({ ...valid, sale: { output: "" } }, "image"), /不能为空/);
  assert.match(pricingValidationError({ ...valid, cost: { output: "-0.1" } }, "image"), /不能为负数/);
  assert.match(pricingValidationError({ ...valid, unit: "秒" }, "image"), /计费单位/);
});

test("video estimate matches backend duration resolution and copies", () => {
  assert.equal(calculateCreditEstimate({
    pricing: { unit: "秒", sale: { output: "12 积分" } },
    category: "video",
    resolution: "2K",
    durationSec: 5,
    copies: 2,
  }), 180);
});

test("image estimate matches backend quality and resolution", () => {
  assert.equal(calculateCreditEstimate({
    pricing: { unit: "张", sale: { output: "3 积分" } },
    category: "image",
    resolution: "2K",
    quality: "High",
  }), 12);
});

test("audio estimate bills fractional character units then rounds once", () => {
  assert.equal(calculateCreditEstimate({
    pricing: { unit: "千字符", sale: { output: "3 积分" } },
    category: "audio",
    characterCount: 1500,
  }), 5);
});

test("billable characters follow the model character weight", () => {
  // MiniMax 口径：1 汉字 = 2 字符
  assert.equal(billableCharacters("你好世界"), 8);
  assert.equal(billableCharacters("abcd"), 4);
  assert.equal(billableCharacters("你好ab，"), 7);
  // 火山/Ark 口径：1 字 = 1 字符
  assert.equal(billableCharacters("你好世界", 1), 4);
  assert.equal(billableCharacters("你好ab，", 1), 5);
});

test("character weight comes from the server resolved value first", () => {
  // 服务端按内置规则表解析后下发 pricing.cjkWeight，前端直接采用
  assert.equal(resolveCjkWeight({ cjkWeight: 1 }, "minimax-speech"), 1);
  assert.equal(resolveCjkWeight({ cjkWeight: 2 }, "openai-speech"), 2);
  // 未下发时（新模型保存前）按内置表镜像兜底
  assert.equal(resolveCjkWeight({}, "minimax-speech"), 2);
  assert.equal(resolveCjkWeight(null, "openai-speech"), 1);
  assert.equal(resolveCjkWeight(null, "unknown-adapter"), 2);
});

test("character rule text prefers the server citation", () => {
  const served = { cjkWeight: 2, cjkWeightLabel: "1 汉字 = 2 字符", cjkWeightSource: "MiniMax 官方计费规则" };
  assert.deepEqual(characterRuleText(served, "minimax-speech"), { label: "1 汉字 = 2 字符", source: "MiniMax 官方计费规则" });
  // 未下发时用内置表镜像
  const builtin = characterRuleText({}, "minimax-speech");
  assert.equal(builtin.label, "1 汉字 = 2 字符");
  assert.match(builtin.source, /MiniMax/);
  // 未登记供应商给出兜底提示
  const fallback = characterRuleText(null, "unknown-adapter");
  assert.equal(fallback.label, "1 汉字 = 2 字符");
  assert.match(fallback.source, /核对/);
});

test("character weight outside 1 or 2 is rejected", () => {
  const valid = { unit: "千字符", sale: { output: "3 积分" }, cost: { output: "¥0.2" } };
  assert.equal(pricingValidationError(valid, "audio"), "");
  assert.match(pricingValidationError({ ...valid, cjkWeight: 3 }, "audio"), /1 或 2/);
});

test("switching token units scales all text dimensions by 1000x", () => {
  // 百万Token → 千Token：三个维度同比例 ÷1000，实际单价不变
  const pricing = {
    unit: "百万Token",
    sale: { input: "26 积分", output: "104 积分", cache: "0.5 积分" },
    cost: { input: "¥2", output: "¥8", cache: "¥0.04" },
  };
  const toThousand = convertPricingUnit(pricing, "text", "千Token");
  assert.equal(toThousand.unit, "千Token");
  assert.deepEqual(toThousand.sale, { input: "0.026 积分", output: "0.104 积分", cache: "0.0005 积分" });
  assert.deepEqual(toThousand.cost, { input: "¥0.002", output: "¥0.008", cache: "¥0.00004" });
  // 千Token → 百万Token：×1000 精确换回，往返无损失
  const back = convertPricingUnit(toThousand, "text", "百万Token");
  assert.deepEqual(back.sale, { input: "26 积分", output: "104 积分", cache: "0.5 积分" });
  assert.deepEqual(back.cost, { input: "¥2", output: "¥8", cache: "¥0.04" });
  // 音频的零值维度不重写，输出维度仍按 10 倍换算
  const audio = convertPricingUnit(
    { unit: "千字符", sale: { input: "0", output: "3 积分", cache: "0" }, cost: { input: "0", output: "¥0.2", cache: "0" } },
    "audio", "万字符",
  );
  assert.equal(audio.sale.input, "0");
  assert.equal(audio.sale.output, "30 积分");
  assert.equal(audio.cost.output, "¥2");
});
