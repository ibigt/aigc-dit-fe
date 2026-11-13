export function textReasoningEnabled(adapterConfig) {
  return adapterConfig?.enableThinking === true;
}

export function withTextReasoning(adapterConfig, enabled = false, identity = {}) {
  const next = {
    ...(adapterConfig || {}),
    enableThinking: enabled === true,
  };
  delete next.thinkingField;
  delete next.thinkingType;
  if (enabled === true || !usesOfficialThinkingSwitch(next, identity)) {
    return next;
  }
  next.thinkingField = "thinking";
  next.thinkingType = "disabled";
  return next;
}

function usesOfficialThinkingSwitch(adapterConfig, identity) {
  const haystack = [identity?.modelKey, identity?.endpoint, identity?.name, adapterConfig?.chatModel]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("deepseek") || haystack.includes("minimax");
}

const OFFICIAL_TOKEN_PLAN = "官方API（token plan）";

function adapterProviders(adapter) {
  if (adapter?.key === "minimax-h3") return ["官方API", "ComfyUI"];
  if (adapter?.key === "seedance-2.0" || adapter?.key === "seedance-2.5") {
    return ["官方API", OFFICIAL_TOKEN_PLAN];
  }
  if (adapter?.key === "wan3") return ["官方API"];
  return adapter?.provider ? [adapter.provider] : [];
}

export function providerChoicesForAdapters(adapters = []) {
  return [...new Set(adapters.flatMap(adapterProviders))];
}

export function adaptersMatchingProvider(adapters = [], provider) {
  return adapters.filter((adapter) => adapterProviders(adapter).includes(provider));
}

const OPENAI_AUDIO_FORMATS = ["mp3", "wav", "aac", "flac", "opus", "pcm"];
const MINIMAX_AUDIO_FORMATS = ["mp3", "wav", "flac", "pcm"];

export function audioFormatsForAdapter(adapterKey) {
  return adapterKey === "minimax-speech" ? MINIMAX_AUDIO_FORMATS : OPENAI_AUDIO_FORMATS;
}

export function adapterSpecificFields(adapterKey, provider) {
  if (adapterKey === "wan3") return ["generateAudio"];
  if (adapterKey === "minimax-h3-sglang") return ["shortEdge", "numInferenceSteps", "flowShift", "audioFlowShift", "seed"];
  if ((adapterKey === "seedance-2.0" || adapterKey === "seedance-2.5") && String(provider || "").startsWith("官方API")) {
    return ["generateAudio"];
  }
  if (adapterKey === "minimax-h3" && /comfy/i.test(String(provider || ""))) {
    return ["steps", "unetName", "loraName"];
  }
  if (adapterKey === "openai-speech") return ["instructions"];
  if (adapterKey === "minimax-speech") {
    return ["volume", "pitch", "sampleRate", "bitrate", "channel", "languageBoost"];
  }
  return [];
}

const ALL_ADAPTER_SPECIFIC_FIELDS = [
  "shortEdge", "numInferenceSteps", "flowShift", "audioFlowShift", "seed",
  "generateAudio", "steps", "unetName", "loraName", "instructions",
  "volume", "pitch", "sampleRate", "bitrate", "channel", "languageBoost",
];

export function sanitizeAdapterSpecificConfig(adapterKey, provider, config = {}) {
  const allowed = new Set(adapterSpecificFields(adapterKey, provider));
  const next = { ...config };
  for (const field of ALL_ADAPTER_SPECIFIC_FIELDS) {
    if (!allowed.has(field)) delete next[field];
  }
  return next;
}
