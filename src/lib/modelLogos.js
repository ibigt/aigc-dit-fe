export const MODEL_LOGO_CATALOG = [
  { file: "/model-logos/agnes.svg", label: "Agnes AI", keys: ["agnes"] },
  { file: "/model-logos/deepseek.svg", label: "DeepSeek", keys: ["deepseek", "深度求索"] },
  { file: "/model-logos/xiaomi-color.svg", label: "小米 / MiMo", keys: ["mimo", "xiaomi", "小米"] },
  { file: "/model-logos/zhipu-color.svg", label: "智谱 / GLM", keys: ["zhipu", "智谱", "质谱", "glm", "chatglm", "cogvideo", "清影"] },
  { file: "/model-logos/kimi.svg", label: "Kimi / 月之暗面", keys: ["kimi", "moonshot", "月之暗面"] },
  { file: "/model-logos/openai.svg", label: "OpenAI / GPT", keys: ["gpt-image", "gpt", "openai", "dall-e", "dalle", "sora"] },
  { file: "/model-logos/bytedance-color.svg", label: "字节 / Seedance", keys: ["seedance", "seedream", "bytedance"] },
  { file: "/model-logos/doubao-color.svg", label: "豆包", keys: ["doubao", "豆包"] },
  { file: "/model-logos/midjourney.svg", label: "Midjourney / Niji", keys: ["midjourney", "niji"] },
  { file: "/model-logos/qwen-color.svg", label: "通义千问", keys: ["qwen", "tongyi", "千问"] },
  { file: "/model-logos/kling-color.svg", label: "可灵", keys: ["kling", "可灵"] },
  { file: "/model-logos/alibabacloud-color.svg", label: "阿里 / 万相", keys: ["wan2", "wan3", "wan-", "万相", "alibaba", "aliyun"] },
  { file: "/model-logos/minimax-color.svg", label: "MiniMax", keys: ["minimax"] },
  { file: "/model-logos/hailuo-color.svg", label: "海螺", keys: ["hailuo", "海螺"] },
  { file: "/model-logos/runway.svg", label: "Runway", keys: ["runway", "aleph"] },
  { file: "/model-logos/google-color.svg", label: "Google", keys: ["google", "gemini", "imagen", "veo", "omni"] },
  { file: "/model-logos/lightricks.svg", label: "Lightricks / LTX", keys: ["ltx", "lightricks"] },
  { file: "/model-logos/nanobanana-color.svg", label: "Banana", keys: ["banana"] },
  { file: "/model-logos/elevenlabs.svg", label: "ElevenLabs", keys: ["eleven"] },
  { file: "/model-logos/comfyui-color.svg", label: "ComfyUI", keys: ["comfy"] },
];
export const FALLBACK_LOGO = "/model-logos/comfyui-color.svg";

/** 归一化：抹掉分隔符，让「Wan 3.0」「wan3.0-video」「WAN-3」都能命中 wan3。 */
function normalizeLogoText(value) {
  return String(value || "").toLowerCase().replace(/[\s._\-/\\]+/g, "");
}

/** 传入名称 / 模型标识 / 适配协议 / 来源中任意几项，取命中最长的品牌。 */
export function matchModelLogo(...parts) {
  const raw = parts.filter(Boolean).join(" ").toLowerCase();
  const compact = normalizeLogoText(raw);
  let best = null;
  let bestLen = 0;
  for (const item of MODEL_LOGO_CATALOG) {
    for (const key of item.keys) {
      const compactKey = normalizeLogoText(key);
      if (!compactKey || compactKey.length <= bestLen) continue;
      if (raw.includes(key.toLowerCase()) || compact.includes(compactKey)) {
        best = item.file;
        bestLen = compactKey.length;
      }
    }
  }
  if (best) return best;
  return FALLBACK_LOGO;
}

export function modelLogoSrc(model) {
  const stored = model?.logo;
  const matched = matchModelLogo(model?.name, model?.modelKey, model?.provider, model?.adapterKey);
  if (!stored || stored === FALLBACK_LOGO) return matched;
  if (stored === "/model-logos/openai.svg" && (matched === "/model-logos/agnes.svg" || matched === "/model-logos/deepseek.svg")) {
    return matched;
  }
  return stored;
}
