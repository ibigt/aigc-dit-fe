import test from "node:test";
import assert from "node:assert/strict";
import { calculateCreditEstimate, configuredPricingAmount, normalizePricing, normalizePricingUnit, parsePricingAmount, pricingUnits, pricingValidationError } from "../src/lib/pricing.js";

test("pricing units are constrained by model category", () => {
  assert.deepEqual(pricingUnits("image"), ["张", "次"]);
  assert.deepEqual(pricingUnits("video"), ["秒", "次"]);
  assert.deepEqual(pricingUnits("audio"), ["千字符", "万字符", "次"]);
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
