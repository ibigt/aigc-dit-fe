import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAudioParams, resolveAudioOptions, voiceIdOf, voiceLabel, voiceLanguage } from "../src/lib/voices.js";

const models = [
  { id: 7, name: "Speech-2.8-HD", category: "audio", enabled: true, audioOptions: {
    voices: [
      { id: "female-shaonv", name: "少女音", language: "中文" },
      { id: "male-qn-qingse", name: "青涩青年男声", language: "中文" },
      { id: "English-Trusty_Man", name: "Trusty Man", language: "英文" },
    ],
    formats: ["mp3", "wav"],
    defaultVoice: "female-shaonv",
    defaultFormat: "mp3",
    minSpeed: 0.5,
    maxSpeed: 2,
  } },
  { id: 8, name: "Music-3.0", category: "audio", enabled: true },
];

test("音色列表与快速创作同源：取自模型 audioOptions", () => {
  const options = resolveAudioOptions({ models, modelName: "Speech-2.8-HD" });
  assert.deepEqual(options.voiceIds, ["female-shaonv", "male-qn-qingse", "English-Trusty_Man"]);
  assert.equal(options.defaultVoice, "female-shaonv");
  assert.deepEqual(options.formats, ["mp3", "wav"]);
  assert.equal(options.defaultFormat, "mp3");
  assert.equal(options.minSpeed, 0.5);
  assert.equal(options.maxSpeed, 2);
});

test("模型未配置音色时回退默认音色，不返回空列表", () => {
  const options = resolveAudioOptions({ models, modelName: "Music-3.0" });
  assert.ok(options.voiceIds.length >= 1);
  assert.ok(options.formats.length >= 1);
});

test("音色展示名优先用模型下发的 name，其次中文名表", () => {
  assert.equal(voiceLabel({ id: "female-shaonv", name: "少女音" }), "少女音");
  assert.equal(voiceLabel("female-shaonv"), "少女音");
  assert.equal(voiceLabel("unknown-voice"), "unknown-voice");
  assert.equal(voiceIdOf({ id: "female-shaonv" }), "female-shaonv");
  assert.equal(voiceIdOf("female-shaonv"), "female-shaonv");
  assert.equal(voiceLanguage({ id: "x", language: "英文" }), "英文");
  assert.equal(voiceLanguage("x"), "其他");
});

test("切换模型后越界音色/格式/语速自动校正到合法值", () => {
  const options = resolveAudioOptions({ models, modelName: "Speech-2.8-HD" });
  const patch = normalizeAudioParams({ voiceId: "stale-voice", format: "aac", speed: 9, options });
  assert.equal(patch.voiceId, "female-shaonv");
  assert.equal(patch.format, "mp3");
  assert.equal(patch.speed, 2);
});

test("合法参数不产生写回补丁", () => {
  const options = resolveAudioOptions({ models, modelName: "Speech-2.8-HD" });
  assert.equal(normalizeAudioParams({ voiceId: "male-qn-qingse", format: "wav", speed: 1.2, options }), null);
});
