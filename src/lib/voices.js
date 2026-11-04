import { findWorkflowModel } from "./modelCapabilities.js";

// 语音音色工具：快速创作（FastCreate）与高级工作台（WorkflowStudio 音频节点）共用，
// 保证两端「音色 / 格式 / 语速」参数完全一致——同一份模型目录配置、同一套字段口径。

// MiniMax 系统音色的中文名（模型目录里音色已有 name，缺省时用这张表兜底）
export const voiceLabels = {
  "male-qn-qingse": "青涩青年男声",
  "male-qn-jingying": "精英青年男声",
  "male-qn-badao": "霸道青年男声",
  "male-qn-daxuesheng": "青年大学生",
  "female-shaonv": "少女音",
  "female-yujie": "御姐音",
  "female-chengshu": "成熟女声",
  "female-tianmei": "甜美女声",
};

// 音色展示名：对象取 name/label/id，字符串优先用中文名表
export function voiceLabel(voice) {
  if (voice && typeof voice === "object") return voice.name || voice.label || voice.id;
  return voiceLabels[voice] || voice;
}

// 音色 ID：后端 voiceId 字段必须是它
export function voiceIdOf(voice) {
  return voice && typeof voice === "object" ? voice.id : voice;
}

// 音色语言：对象取 language，字符串视为"其他"
export function voiceLanguage(voice) {
  return voice && typeof voice === "object" ? voice.language || "其他" : "其他";
}

/**
 * 从模型目录解析语音参数，口径与快速创作完全一致：
 * voices 取模型 audioOptions.voices（元素为 {id,name,language} 或纯 id），
 * 缺省回退到 audioOptions.defaultVoice；formats 缺省回退 defaultFormat；
 * 语速范围取 audioOptions.minSpeed/maxSpeed。
 */
export function resolveAudioOptions({ models = [], modelName = "" } = {}) {
  const model = findWorkflowModel(models, modelName)
    || (Array.isArray(models) ? models.find((item) => item?.category === "audio" && item?.enabled !== false) : null);
  const audioOptions = model?.audioOptions || {};
  const voices = (audioOptions.voices?.length ? audioOptions.voices : [audioOptions.defaultVoice || "alloy"])
    .filter((item) => voiceIdOf(item));
  const formats = audioOptions.formats?.length ? audioOptions.formats : [audioOptions.defaultFormat || "mp3"];
  const voiceIds = voices.map(voiceIdOf);
  return {
    model: model || null,
    voices,
    voiceIds,
    formats,
    defaultVoice: audioOptions.defaultVoice || voiceIds[0] || "alloy",
    defaultFormat: audioOptions.defaultFormat || formats[0] || "mp3",
    minSpeed: Number(audioOptions.minSpeed ?? 0.25),
    maxSpeed: Number(audioOptions.maxSpeed ?? 4),
  };
}

/**
 * 校正节点上已有的语音参数：音色/格式必须落在当前模型可选范围内，
 * 语速必须落在 [minSpeed, maxSpeed]。返回需要写回的补丁（无变化时返回 null）。
 */
export function normalizeAudioParams({ voiceId, format, speed, options }) {
  const patch = {};
  const nextVoice = voiceId && options.voiceIds.includes(voiceId) ? voiceId : options.defaultVoice;
  if (nextVoice !== voiceId) patch.voiceId = nextVoice;
  const nextFormat = format && options.formats.includes(format) ? format : options.defaultFormat;
  if (nextFormat !== format) patch.format = nextFormat;
  const rawSpeed = Number(speed);
  const clamped = Number.isFinite(rawSpeed) && rawSpeed > 0
    ? Math.min(options.maxSpeed, Math.max(options.minSpeed, rawSpeed))
    : 1;
  if (clamped !== rawSpeed) patch.speed = clamped;
  return Object.keys(patch).length ? patch : null;
}
