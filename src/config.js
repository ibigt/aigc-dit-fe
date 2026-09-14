
const logoByModel = {
  "minimax-h3": "/model-logos/hailuo-color.svg",
  "wan-2-2": "/model-logos/alibabacloud-color.svg",
  "ltx-2-3": "/model-logos/lightricks.svg",
  "seedream-5": "/model-logos/bytedance-color.svg",
  "seedream-4-5": "/model-logos/bytedance-color.svg",
  "seedream-4": "/model-logos/bytedance-color.svg",
  "banana-2": "/model-logos/nanobanana-color.svg",
  "banana-pro": "/model-logos/nanobanana-color.svg",
  "gpt-image-2": "/model-logos/openai.svg",
  "midjourney-7": "/model-logos/midjourney.svg",
  "midjourney-8-1": "/model-logos/midjourney.svg",
  "niji-7": "/model-logos/midjourney.svg",
  "qwen-image-3": "/model-logos/qwen-color.svg",
  "qwen-image-3-pro": "/model-logos/qwen-color.svg",
  "seedance-2": "/model-logos/doubao-color.svg",
  "seedance-2.5": "/model-logos/doubao-color.svg",
  "seedance-2-fast": "/model-logos/doubao-color.svg",
  "seedance-2-global": "/model-logos/bytedance-color.svg",
  "happyhorse-1": "/model-logos/alibabacloud-color.svg",
  "wan-2-7": "/model-logos/alibabacloud-color.svg",
  "kling-o1": "/model-logos/kling-color.svg",
  "google-omni-flash": "/model-logos/google-color.svg",
  "runway-aleph": "/model-logos/runway.svg",
  "wan-2-7-edit": "/model-logos/alibabacloud-color.svg",
  "minimax-2-8-hd": "/model-logos/minimax-color.svg",
  "eleven-v3": "/model-logos/elevenlabs.svg",
};

const pricing = (unit, saleOutput, costOutput, saleInput = "0", costInput = "0", saleCache = "0", costCache = "0") => ({
  unit,
  sale: { input: saleInput, output: saleOutput, cache: saleCache },
  cost: { input: costInput, output: costOutput, cache: costCache },
});

const pricingByModel = {
  "minimax-h3": pricing("秒", "12 积分", "¥0.42"),
  "wan-2-2": pricing("秒", "5 积分", "¥0.34"),
  "ltx-2-3": pricing("秒", "4 积分", "¥0.28"),
  "seedream-5": pricing("张", "5 积分", "¥0.32"),
  "seedream-4-5": pricing("张", "4 积分", "¥0.29"),
  "seedream-4": pricing("张", "3 积分", "¥0.22"),
  "banana-2": pricing("张", "4 积分", "¥0.19"),
  "banana-pro": pricing("张", "6 积分", "¥0.43"),
  "gpt-image-2": pricing("张", "2 积分", "¥0.12", "1 积分", "¥0.05", "0.2 积分", "¥0.01"),
  "midjourney-7": pricing("次", "7 积分", "¥0.48"),
  "midjourney-8-1": pricing("次", "9 积分", "¥0.66"),
  "niji-7": pricing("次", "7 积分", "¥0.46"),
  "qwen-image-3": pricing("张", "3 积分", "¥0.16", "0.5 积分", "¥0.02", "0.1 积分", "¥0.005"),
  "qwen-image-3-pro": pricing("张", "5 积分", "¥0.29", "0.8 积分", "¥0.04", "0.1 积分", "¥0.008"),
  "seedance-2": pricing("秒", "8 积分", "¥0.72"),
  "seedance-2.5": pricing("秒", "8 积分", "按方舟计价"),
  "seedance-2-fast": pricing("秒", "5 积分", "¥0.58"),
  "seedance-2-global": pricing("秒", "9 积分", "¥0.68"),
  "happyhorse-1": pricing("秒", "6 积分", "¥0.40"),
  "wan-2-7": pricing("秒", "7 积分", "¥0.49"),
  "kling-o1": pricing("秒", "10 积分", "¥0.78"),
  "google-omni-flash": pricing("秒", "8 积分", "¥0.61", "1 积分", "¥0.06", "0.2 积分", "¥0.01"),
  "runway-aleph": pricing("秒", "12 积分", "¥0.92"),
  "wan-2-7-edit": pricing("秒", "8 积分", "¥0.58"),
  "minimax-2-8-hd": pricing("万字符", "12 积分", "¥0.86", "4 积分", "¥0.25", "1 积分", "¥0.05"),
  "eleven-v3": pricing("万字符", "16 积分", "¥1.18", "5 积分", "¥0.34", "1 积分", "¥0.08"),
};

function decorateModel(model) {
  return {
    ...model,
    logo: logoByModel[model.id] || "/model-logos/comfyui-color.svg",
    pricing: pricingByModel[model.id] || pricing(model.category === "video" ? "秒" : model.category === "audio" ? "万字符" : "次", "3 积分", "¥0.20"),
  };
}

export const fallbackConfig = {
  appName: "同道",
  shortName: "同道",
  tagline: "把想象，编排成光影",
  description: "面向创作者的 AI 影像生成平台",
  apiBaseUrl: "/api",
  service: {
    environment: "local",
    enableRegistration: true,
    enableWorkflowImport: false,
    enableLocalMedia: true,
  },
  models: [
    { id: "minimax-h3", name: "MiniMax-H3", description: "官方 API 或 ComfyUI · 有声成片", badge: "推荐", category: "video", capabilities: ["video", "t2v", "r2v", "i2v"], provider: "官方API", adapterKey: "minimax-h3", modelKey: "MiniMax-H3", endpoint: "https://api.minimax.cn", enabled: true },
    { id: "wan-2-2", name: "Wan2.2", description: "镜头质感 · 动作流畅", badge: "工作流", category: "video", capabilities: ["image", "video", "workflow"], provider: "ComfyUI", modelKey: "wan2.2", endpoint: "http://127.0.0.1:8188", enabled: true },
    { id: "ltx-2-3", name: "LTX2.3", description: "快速生成 · 风格灵活", badge: "极速", category: "video", capabilities: ["image", "video", "workflow"], provider: "ComfyUI", modelKey: "ltx-2.3", endpoint: "http://127.0.0.1:8188", enabled: true },
    { id: "seedream-5", name: "Seedream 5.0", description: "角色一致性与商业设计增强", badge: "图像", category: "image", provider: "RunningHub", modelKey: "seedream-5.0", endpoint: "https://www.runninghub.cn/api", enabled: true },
    { id: "seedream-4-5", name: "Seedream 4.5", description: "中文文字与多图融合", badge: "图像", category: "image", provider: "RunningHub", modelKey: "seedream-4.5", endpoint: "https://www.runninghub.cn/api", enabled: true },
    { id: "seedream-4", name: "Seedream 4.0", description: "2K/4K 高清直出", badge: "图像", category: "image", provider: "RunningHub", modelKey: "seedream-4.0", endpoint: "https://www.runninghub.cn/api", enabled: true },
    { id: "banana-2", name: "Banana 2", description: "极端画幅与中文文本渲染", badge: "图像", category: "image", provider: "手动配置", modelKey: "banana-2", endpoint: "/mock-api/images", enabled: true },
    { id: "banana-pro", name: "Banana Pro", description: "高质量图像生成与编辑", badge: "图像", category: "image", provider: "手动配置", modelKey: "banana-pro", endpoint: "/mock-api/images", enabled: true },
    { id: "gpt-image-2", name: "GPT Image 2", description: "Low / 标准 / High 三档", badge: "图像", category: "image", capabilities: ["image", "t2i"], provider: "手动配置", modelKey: "gpt-image-2", endpoint: "/mock-api/images", enabled: true },
    { id: "midjourney-7", name: "Midjourney 7", description: "艺术表现与风格化生成", badge: "图像", category: "image", provider: "RunningHub", modelKey: "midjourney-v7", endpoint: "https://www.runninghub.cn/api", enabled: true },
    { id: "midjourney-8-1", name: "Midjourney 8.1", description: "新一代风格化图像生成", badge: "图像", category: "image", provider: "RunningHub", modelKey: "midjourney-v8.1", endpoint: "https://www.runninghub.cn/api", enabled: true },
    { id: "niji-7", name: "Niji 7", description: "动漫与二次元风格", badge: "图像", category: "image", provider: "RunningHub", modelKey: "niji-v7", endpoint: "https://www.runninghub.cn/api", enabled: true },
    { id: "qwen-image-3", name: "Qwen Image 3.0", description: "文生图、参考图与编辑", badge: "图像", category: "image", provider: "ComfyUI", modelKey: "qwen-image-3", endpoint: "http://127.0.0.1:8188", enabled: true },
    { id: "qwen-image-3-pro", name: "Qwen Image 3.0 Pro", description: "专业商业视觉生产", badge: "图像", category: "image", provider: "ComfyUI", modelKey: "qwen-image-3-pro", endpoint: "http://127.0.0.1:8188", enabled: true },
    { id: "seedance-2", name: "Seedance 2.0", description: "文生视频，4–15 秒高质量有声成片", badge: "视频", category: "video", capabilities: ["video", "t2v"], provider: "RunningHub", modelKey: "seedance-2.0", endpoint: "https://www.runninghub.ai", enabled: true },
    { id: "seedance-2.5", name: "Seedance 2.5", description: "火山方舟官方 API，4–15 秒 480P/720P 有声成片", badge: "视频", category: "video", capabilities: ["video", "t2v", "r2v", "i2v"], provider: "官方API", adapterKey: "seedance-2.5", modelKey: "doubao-seedance-2-5-260628", endpoint: "https://ark.cn-beijing.volces.com/api/v3", enabled: true },
    { id: "seedance-2-fast", name: "Seedance 2.0 Fast", description: "快速多模态视频生成", badge: "视频", category: "video", provider: "RunningHub", modelKey: "seedance-2.0-fast", endpoint: "https://www.runninghub.cn/api", enabled: true },
    { id: "seedance-2-global", name: "Seedance 2.0 海外版", description: "面向国际素材的合规生成链路", badge: "视频", category: "video", provider: "RunningHub", modelKey: "seedance-2.0-global", endpoint: "https://www.runninghub.cn/api", enabled: true },
    { id: "happyhorse-1", name: "HappyHorse 1.0", description: "文生视频、首帧与多图参考", badge: "视频", category: "video", provider: "手动配置", modelKey: "happyhorse-1.0", endpoint: "/mock-api/video", enabled: true },
    { id: "wan-2-7", name: "万相 2.7", description: "首尾帧与多模态参考", badge: "视频", category: "video", provider: "RunningHub", modelKey: "wan2.7", endpoint: "https://www.runninghub.cn/api", enabled: true },
    { id: "kling-o1", name: "可灵 O1", description: "视频指令变换与风格编辑", badge: "视频编辑", category: "video", provider: "RunningHub", modelKey: "kling-o1", endpoint: "https://www.runninghub.cn/api", enabled: true },
    { id: "google-omni-flash", name: "Google Omni Flash", description: "视频编辑、续写与文生视频", badge: "视频编辑", category: "video", provider: "手动配置", modelKey: "google-omni-flash", endpoint: "/mock-api/video-edit", enabled: true },
    { id: "runway-aleph", name: "Runway Aleph", description: "视频内容编辑与图片参考", badge: "视频编辑", category: "video", provider: "手动配置", modelKey: "runway-aleph", endpoint: "/mock-api/video-edit", enabled: true },
    { id: "wan-2-7-edit", name: "万相 2.7 视频编辑", description: "风格迁移、局部替换与主体编辑", badge: "视频编辑", category: "video", provider: "RunningHub", modelKey: "wan2.7-edit", endpoint: "https://www.runninghub.cn/api", enabled: true },
  ].filter((model) => model.category === "image" || model.category === "video").map(decorateModel),
  integrations: {
    comfyui: { url: "http://127.0.0.1:8188", apiKey: "", enabled: true },
    video: { provider: "Mock Video Gateway", baseUrl: "/mock-api/video", defaultModel: "minimax-h3" },
    text: { provider: "OpenAI Compatible", baseUrl: "/mock-api/text", defaultModel: "creative-writer-v1" },
    audio: { provider: "Mock Audio Gateway", baseUrl: "/mock-api/audio", defaultModel: "voice-studio-v1" },
  },
  demoUser: {
    name: "张某某",
    email: "zhang@example.com",
    role: "创作团队 · 管理员",
    credits: 1280,
  },
  media: [
    { id: "racer", title: "极速叙事", type: "video", src: "/media/comfy-racer.webm", poster: "/media/comfy-racer-poster.webp", model: "Minimax-H3" },
    { id: "seedance", title: "城市醒来", type: "video", src: "/media/seedance-20.webm", poster: "/media/seedance-20-poster.webp", model: "Wan2.2" },
    { id: "grok", title: "异星漫游", type: "video", src: "/media/grok-video.webm", poster: "/media/grok-video-poster.webp", model: "LTX2.3" },
    { id: "wan", title: "风的形状", type: "video", src: "/media/wan-22.webm", poster: "/media/wan-22-poster.webp", model: "Wan2.2" },
    { id: "gpt", title: "静物剧场", type: "video", src: "/media/gpt-image-2.webm", poster: "/media/gpt-image-2-poster.webp", model: "Minimax-H3" },
    { id: "banana", title: "梦境拼贴", type: "image", src: "/media/nano-banana-pro.webp", model: "Minimax-H3" },
    { id: "qwen", title: "材质重绘", type: "image", src: "/media/qwen-image-edit.webp", model: "Wan2.2" },
  ],
};

export async function loadRuntimeConfig() {
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Runtime config unavailable");
    const runtime = await response.json();
    const runtimeModels = Array.isArray(runtime.models) ? runtime.models : [];
    const configuredIds = new Set(runtimeModels.map((model) => model.id));
    const models = [
      ...fallbackConfig.models.map((model) => ({ ...model, ...(runtimeModels.find((item) => item.id === model.id) || {}) })),
      ...runtimeModels.filter((model) => !fallbackConfig.models.some((item) => item.id === model.id)),
    ];
    return { ...fallbackConfig, ...runtime, models: models.filter((model, index) => !configuredIds.has(model.id) || models.findIndex((item) => item.id === model.id) === index) };
  } catch {
    return fallbackConfig;
  }
}