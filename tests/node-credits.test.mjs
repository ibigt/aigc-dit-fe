import test from "node:test";
import assert from "node:assert/strict";
import {
  audioNodeCreditCost,
  findWorkflowModel,
  mediaNodeCreditCost,
  workflowQualityKey,
} from "../src/lib/nodeCredits.js";

// 一个按售价分档的视频模型：1080P 档 2 积分/秒，2K 档 3 积分/秒
const videoModel = {
  id: 1,
  name: "Minimax-H3",
  category: "video",
  adapterKey: "minimax-h3",
  pricing: {
    unit: "秒",
    sale: { output: "2 积分", tiers: { "1080P": "2 积分", "2K": "3 积分" } },
    cost: { output: "¥0.2", tiers: { "1080P": "¥0.2", "2K": "¥0.3" } },
  },
};

// 一个按张计价的图像模型：1K 档 4 积分/张，2K 档 8 积分/张
const imageModel = {
  id: 2,
  name: "SDXL",
  category: "image",
  adapterKey: "sdxl",
  pricing: {
    unit: "张",
    sale: { output: "4 积分", tiers: { "1K": "4 积分", "2K": "8 积分" } },
    cost: { output: "¥0.4", tiers: { "1K": "¥0.4", "2K": "¥0.8" } },
  },
};

const speechModel = {
  id: 3,
  name: "Minimax-Speech",
  category: "audio",
  adapterKey: "minimax-speech",
  pricing: {
    unit: "千字符",
    sale: { input: "0", output: "6 积分", cache: "0" },
    cost: { input: "0", output: "¥0.6", cache: "0" },
  },
};

test("中文清晰度档位映射到定价口径", () => {
  assert.equal(workflowQualityKey("低"), "LOW");
  assert.equal(workflowQualityKey("中"), "MEDIUM");
  assert.equal(workflowQualityKey("高"), "HIGH");
  assert.equal(workflowQualityKey("HIGH"), "HIGH");
  assert.equal(workflowQualityKey(""), "HIGH");
});

test("按模型名在目录里找到带售价的模型对象", () => {
  assert.equal(findWorkflowModel([videoModel, imageModel], "SDXL"), imageModel);
  assert.equal(findWorkflowModel([videoModel], "不存在"), null);
  assert.equal(findWorkflowModel([], "SDXL"), null);
  assert.equal(findWorkflowModel(["SDXL"], "SDXL"), "SDXL");
});

test("视频节点积分随所选模型与分辨率变化", () => {
  const base = { model: "Minimax-H3", resolution: "1080P", duration: 5, copies: 1, points: 600 };
  const hd = mediaNodeCreditCost({ media: base, models: [videoModel, imageModel], isVideo: true });
  const uhd = mediaNodeCreditCost({ media: { ...base, resolution: "2K" }, models: [videoModel, imageModel], isVideo: true });
  assert.equal(hd, 10); // 2 积分/秒 × 5 秒
  assert.equal(uhd, 15); // 3 积分/秒 × 5 秒
  assert.notEqual(hd, uhd);
});

test("视频节点积分随副本数变化", () => {
  const base = { model: "Minimax-H3", resolution: "1080P", duration: 5, copies: 1, points: 600 };
  const one = mediaNodeCreditCost({ media: base, models: [videoModel], isVideo: true });
  const three = mediaNodeCreditCost({ media: { ...base, copies: 3 }, models: [videoModel], isVideo: true });
  assert.equal(one, 10);
  assert.equal(three, 30);
});

test("图像节点按分辨率分档价并叠加清晰度倍率", () => {
  const base = { model: "SDXL", resolution: "2K", quality: "高", copies: 1, points: 80 };
  const high = mediaNodeCreditCost({ media: base, models: [imageModel], isVideo: false });
  const low = mediaNodeCreditCost({ media: { ...base, quality: "低" }, models: [imageModel], isVideo: false });
  assert.equal(high, 16); // 8 积分/张（2K 档）× 清晰度 HIGH 2.0
  assert.equal(low, 8); // 8 积分/张（2K 档）× 清晰度 LOW 1.0
});

test("换模型后积分跟着变（同一档位不同售价）", () => {
  const cheap = { ...videoModel, id: 9, name: "Wan2.2", pricing: { unit: "秒", sale: { output: "1 积分", tiers: { "1080P": "1 积分" } }, cost: { output: "¥0.1" } } };
  const media = { model: "Wan2.2", resolution: "1080P", duration: 5, copies: 1, points: 600 };
  assert.equal(mediaNodeCreditCost({ media, models: [videoModel, cheap], isVideo: true }), 5);
});

test("模型没有售价时退回节点静态价，不显示假价格", () => {
  const media = { model: "未知模型", resolution: "1080P", duration: 5, copies: 2, points: 600 };
  assert.equal(mediaNodeCreditCost({ media, models: [], isVideo: true }), 1200);
});

test("音频节点按千字符口径估价，汉字按 2 字符计", () => {
  const media = { model: "Minimax-Speech", prompt: "你好ab", copies: 1, points: 20 };
  // 2 个汉字 × 2 + 2 个英文字母 = 6 字符 = 0.006 千字符 → 6 × 0.006 = 0.036 → ceil = 1
  assert.equal(audioNodeCreditCost({ media, models: [speechModel] }), 1);
});

test("音频节点无售价时退回静态价", () => {
  const media = { model: "Minimax-Speech", prompt: "台词", copies: 3, points: 20 };
  assert.equal(audioNodeCreditCost({ media, models: [] }), 60);
});
