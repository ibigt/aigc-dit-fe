import test from "node:test";
import assert from "node:assert/strict";
import { adapterSpecificFields, adaptersMatchingProvider, audioFormatsForAdapter, providerChoicesForAdapters, sanitizeAdapterSpecificConfig, textReasoningEnabled, withTextReasoning } from "../src/components/adminModelConfig.js";

test("text reasoning defaults to disabled", () => {
  assert.equal(textReasoningEnabled(undefined), false);
  assert.equal(textReasoningEnabled({}), false);
  assert.equal(withTextReasoning({}, undefined).enableThinking, false);
});

test("text reasoning preserves explicit setting", () => {
  assert.equal(textReasoningEnabled({ enableThinking: true }), true);
  assert.equal(withTextReasoning({ chatModel: "qwen" }, true).enableThinking, true);
});

const adapters = [
  { key: "seedance-2", provider: "RunningHub" },
  { key: "seedance-2.0", provider: "官方API" },
  { key: "minimax-h3", provider: "官方API" },
];

test("model source choices are derived before adapter selection", () => {
  assert.deepEqual(providerChoicesForAdapters(adapters), ["RunningHub", "官方API", "官方API（token plan）", "ComfyUI"]);
});

test("adapter choices are limited by selected source", () => {
  assert.deepEqual(adaptersMatchingProvider(adapters, "RunningHub").map((item) => item.key), ["seedance-2"]);
  assert.deepEqual(adaptersMatchingProvider(adapters, "ComfyUI").map((item) => item.key), ["minimax-h3"]);
  assert.deepEqual(adaptersMatchingProvider(adapters, "官方API（token plan）").map((item) => item.key), ["seedance-2.0"]);
  assert.deepEqual(adaptersMatchingProvider(adapters, "官方API").map((item) => item.key), ["seedance-2.0", "minimax-h3"]);
});

test("audio formats follow the selected speech protocol", () => {
  assert.deepEqual(audioFormatsForAdapter("minimax-speech"), ["mp3", "wav", "flac", "pcm"]);
  assert.deepEqual(audioFormatsForAdapter("openai-speech"), ["mp3", "wav", "aac", "flac", "opus", "pcm"]);
});

test("provider-specific fields are exposed only for the matching transport", () => {
  assert.deepEqual(adapterSpecificFields("seedance-2.5", "官方API"), ["generateAudio"]);
  assert.deepEqual(adapterSpecificFields("minimax-h3", "ComfyUI"), ["steps", "unetName", "loraName"]);
  assert.deepEqual(adapterSpecificFields("minimax-h3", "官方API"), []);
  assert.deepEqual(adapterSpecificFields("openai-speech", "自定义配置"), ["instructions"]);
});

test("hidden protocol fields do not leak after switching adapters", () => {
  const config = { generateAudio: false, steps: 30, instructions: "warm", defaultVoice: "alloy" };
  assert.deepEqual(sanitizeAdapterSpecificConfig("openai-speech", "自定义配置", config), {
    instructions: "warm",
    defaultVoice: "alloy",
  });
  assert.deepEqual(sanitizeAdapterSpecificConfig("seedance-2", "RunningHub", config), {
    defaultVoice: "alloy",
  });
});
