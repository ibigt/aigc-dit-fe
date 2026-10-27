import { AudioLines, Box, Check, CheckCircle2, Download, Film, Image, Images, Maximize2, Pencil, Plus, RefreshCw, Save, Sparkles, Video, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchAssets } from "../api/assets.js";
import { createSession, deleteSession, fetchSession, fetchSessions, renameSession, saveCreationToAsset } from "../api/creations.js";
import { IMAGE_POLL_TIMEOUT_MS, pollGenerateTask, submitGenerate, VIDEO_POLL_TIMEOUT_MS } from "../api/generate.js";
import { friendlyGenerateError, FRAMES_EMPTY_PROMPT_LABEL, materialToAsset, promptForDisplay, promptForResult, tasksToMessages, taskToResultMessage } from "../lib/createFlow.js";
import { formatDateTime, mediaUrl, storageKeyOf } from "../lib/media.js";
import { billableCharacters, calculateCreditEstimate, resolveCjkWeight } from "../lib/pricing.js";
import { modelCatalogMessage } from "../lib/modelCatalog.js";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { AssetPickerDialog } from "./AssetPickerDialog.jsx";
import { sameAsset } from "../lib/assetPicker.js";
import { WorksTypeIcon } from "./WorksTypeIcon.jsx";
import { WorkWaveform } from "./AudioPreview.jsx";

const videoRatios = ["自动", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const imageRatios = ["21:9", "16:9", "5:4", "4:3", "3:2", "1:1", "2:3", "3:4", "4:5", "9:16"];
const videoDurations = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const miniMaxDurations = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const miniMaxMaxDurations = Array.from({ length: 11 }, (_, index) => index + 5);
const miniMaxComfyDurations = Array.from({ length: 11 }, (_, index) => index + 5);
const agnesDurations = Array.from({ length: 9 }, (_, index) => index + 4);
const videoResolutions = ["480P", "720P", "1080P", "2K", "4K"];
// 图片分辨率档位与图片计费分档保持一致（1K 为基准档）
const imageResolutions = ["1K", "2K", "4K"];
const qualityLevels = ["Low", "Medium", "High"];
const DEFAULT_SESSION_ID = "new-creation-default";
const MODE_CAPS = ["t2i", "i2i", "t2v", "r2v", "i2v", "t2a"];
const voiceLabels = {
  "male-qn-qingse": "青涩青年男声",
  "male-qn-jingying": "精英青年男声",
  "male-qn-badao": "霸道青年男声",
  "male-qn-daxuesheng": "青年大学生",
  "female-shaonv": "少女音",
  "female-yujie": "御姐音",
  "female-chengshu": "成熟女声",
  "female-tianmei": "甜美女声",
};
function voiceLabel(voice) {
  if (voice && typeof voice === "object") return voice.name || voice.label || voice.id;
  return voiceLabels[voice] || voice;
}
function voiceIdOf(voice) {
  return voice && typeof voice === "object" ? voice.id : voice;
}
function voiceLanguage(voice) {
  return voice && typeof voice === "object" ? voice.language || "其他" : "其他";
}
function canonicalCap(cap) {
  if (cap === "frames" || cap === "frame" || cap === "v2v") return "i2v";
  return cap;
}
function modelSupports(model, mode) {
  if (mode === "r2v" && isMiniMaxH3Max(model)) return false;
  const caps = Array.isArray(model?.capabilities) ? model.capabilities.map(canonicalCap) : [];
  if (!caps.length) return true;
  const specific = caps.filter((item) => MODE_CAPS.includes(item));
  if (!specific.length) return true;
  return specific.includes(mode);
}
function supportsLibraryCite(model, generationType, videoMode) {
  if (generationType === "audio") return false;
  if (generationType === "image") return modelSupports(model, "i2i");
  if (videoMode === "frames") return modelSupports(model, "i2v");
  return modelSupports(model, "r2v");
}

const videoDurationCache = new Map();
// 读参考视频时长（秒），读不到按 0：本地新选的素材服务端还没探测时长，先用浏览器元数据估。
function readVideoDuration(url) {
  if (!url) return Promise.resolve(0);
  if (videoDurationCache.has(url)) return videoDurationCache.get(url);
  const promise = new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const settle = (value) => {
      video.removeAttribute("src");
      video.load();
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    };
    video.onloadedmetadata = () => settle(video.duration);
    video.onerror = () => settle(0);
    video.src = url;
  });
  videoDurationCache.set(url, promise);
  return promise;
}

// 参考视频计费秒数：与服务端同口径（各视频时长求和后按秒四舍五入）。
// 优先用服务端探测的 durationMs（素材库已有），本地新选的才读浏览器元数据。
function sumReferenceVideoSeconds(items) {
  const videos = (items || []).filter((item) => item?.type === "video" || item?.kind === "video");
  if (!videos.length) return Promise.resolve(0);
  return Promise.all(videos.map((item) => (
    Number.isFinite(item?.durationMs) && item.durationMs > 0
      ? Promise.resolve(item.durationMs)
      : readVideoDuration(item.url || item.src).then((seconds) => seconds * 1000)
  ))).then(
    (durations) => Math.max(1, Math.round(durations.reduce((sum, value) => sum + value, 0) / 1000)),
  );
}

function isImageMaterial(item) {
  return item?.type !== "video" && item?.type !== "audio" && item?.kind !== "video" && item?.kind !== "audio";
}
function isMiniMaxH3(model) {
  return model?.adapterKey === "minimax-h3" || String(model?.modelKey || "").toLowerCase().includes("minimax");
}
function isMiniMaxComfy(model) {
  return isMiniMaxH3(model) && /comfy/i.test(String(model?.provider || ""));
}
function isMiniMaxOfficial(model) {
  return isMiniMaxH3(model) && !isMiniMaxComfy(model);
}
function isAgnes(model) {
  const key = String(model?.adapterKey || model?.modelKey || "").toLowerCase();
  return key.includes("agnes");
}
function isSeedance25(model) {
  const key = String(model?.adapterKey || model?.modelKey || "").toLowerCase();
  return key.includes("seedance-2.5") || key.includes("seedance-2-5") || key.includes("doubao-seedance-2-5");
}
function isSeedance20Official(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  return adapter === "seedance-2.0" || key.includes("doubao-seedance-2-0") || key.includes("doubao-seedance-2.0");
}
function isSeedanceOfficial(model) {
  return isSeedance25(model) || isSeedance20Official(model);
}
function isSeedanceFast(model) {
  return String(model?.modelKey || "").toLowerCase().includes("fast");
}
function isSeedanceMini(model) {
  return String(model?.modelKey || "").toLowerCase().includes("mini");
}
function imageOnlyRefs(model) {
  return isAgnes(model);
}
function isMiniMaxH3Max(model) {
  return String(model?.modelKey || "").toLowerCase().includes("h3-max")
    || String(model?.modelKey || "").toLowerCase().includes("h3_max");
}
function durationOptionsFor(model) {
  if (isMiniMaxH3Max(model)) return miniMaxMaxDurations;
  if (isMiniMaxComfy(model)) return miniMaxComfyDurations;
  if (isMiniMaxH3(model)) return miniMaxDurations;
  if (isAgnes(model)) return agnesDurations;
  return videoDurations;
}
function videoResolutionsFor(model) {
  if (isAgnes(model)) return ["720P"];
  if (isMiniMaxH3Max(model) && isMiniMaxOfficial(model)) return ["480P", "768P"];
  if (isMiniMaxOfficial(model)) return ["768P", "2K"];
  if (isMiniMaxComfy(model)) return videoResolutions;
  // Seedance fast 与 mini 官方仅支持 480P / 720P
  if (isSeedance25(model) || (isSeedance20Official(model) && (isSeedanceFast(model) || isSeedanceMini(model)))) return ["480P", "720P"];
  if (isSeedance20Official(model)) return ["480P", "720P", "1080P"];
  // Wan 3.0 官方接口只支持 480P / 720P / 1080P，其余档位会被服务端静默降级成 720P，
  // 展示出来会导致按高档位收费却只生成 720P
  if (isWan3Model(model)) return ["480P", "720P", "1080P"];
  return videoResolutions;
}
// 各创作类型的可选分辨率：视频按模型能力收敛，图片固定 1K/2K/4K（与计费分档一致）
function resolutionOptionsFor(model, generationType) {
  if (generationType === "video") return videoResolutionsFor(model);
  if (generationType === "image") return imageResolutions;
  return [];
}
function clampDurationForModel(model, duration) {
  const options = durationOptionsFor(model);
  if (options.includes(duration)) return duration;
  return options.find((item) => item >= duration) || options[options.length - 1] || 5;
}
function isMockModel(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  const provider = String(model?.provider || "").toLowerCase();
  const endpoint = String(model?.endpoint || "").toLowerCase();
  return adapter === "mock" || key.startsWith("mock") || provider.includes("mock") || endpoint.includes("/mock-api");
}
function isSeedreamModel(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  return adapter.startsWith("seedream") || key.includes("seedream");
}
function isOpenAiImageModel(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  return adapter === "gpt-image-2.0" || adapter === "gpt-image-2.5"
    || ((adapter.startsWith("gpt-image") || key.includes("gpt-image")) && /官方|openai/i.test(String(model?.provider || "")));
}
function isWan3Model(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  const provider = String(model?.provider || "").toLowerCase();
  return adapter === "wan3" || key.includes("wan3") || key.includes("wan-3")
    || provider.includes("dashscope") || provider.includes("百炼");
}
function isRunningHubModel(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  return adapter === "gpt-image-2" || adapter === "seedance-2"
    || String(model?.provider || "").toLowerCase() === "runninghub";
}
function maxCopiesFor(model) {
  if (model?.category === "audio") return 1;
  const configured = Number(model?.maxCopies ?? model?.adapterConfig?.maxCopies ?? model?.pricing?.maxCopies);
  if (Number.isFinite(configured)) return Math.min(4, Math.max(1, Math.floor(configured)));
  if (isRunningHubModel(model) || isAgnes(model) || isMiniMaxH3(model) || isSeedanceOfficial(model)) return 1;
  if (isSeedreamModel(model) || isOpenAiImageModel(model) || isWan3Model(model)
    || /comfyui/i.test(String(model?.provider || ""))) {
    return 4;
  }
  return isMockModel(model) ? 4 : 1;
}
function capabilityBlockReason(model, generationType, referenceImages, firstFrame, lastFrame, videoMode) {
  const hasRefs = (referenceImages || []).length > 0;
  const audioCount = (referenceImages || []).filter((item) => item?.type === "audio").length;
  const visualCount = (referenceImages || []).filter((item) => item?.type !== "audio").length;
  const hasFrames = Boolean(firstFrame || lastFrame);
  if (generationType === "audio" && !modelSupports(model, "t2a")) {
    return "当前模型不支持文本生成语音";
  }
  if (generationType === "image" && hasRefs && !modelSupports(model, "i2i")) {
    return "当前模型不支持参考图，请移除参考素材后再创作";
  }
  if (generationType === "video" && (videoMode === "frames" || hasFrames) && hasFrames && !modelSupports(model, "i2v")) {
    return "当前模型不支持首尾帧，请移除首尾帧后再创作";
  }
  if (generationType === "video" && videoMode !== "frames" && hasRefs && !modelSupports(model, "r2v")) {
    return "当前模型不支持参考生视频，请移除参考素材后再创作";
  }
  if (audioCount && !model?.supportsAudioReference) {
    return "当前模型不支持上传参考音频，请移除音频后再创作";
  }
  if (audioCount > Number(model?.maxAudioReferences || 0)) {
    return `当前模型最多支持 ${model.maxAudioReferences} 段参考音频`;
  }
  if (audioCount && !visualCount && !hasFrames && !model?.supportsAudioOnlyReference) {
    return "当前模型的参考音频必须搭配图片或视频";
  }
  return "";
}
function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}
function sessionHasPending(session) {
  return (session?.messages || []).some((item) => item.pending);
}
function isSessionGenerating(session, generatingIds) {
  if (!session) return false;
  if (sessionHasPending(session)) return true;
  return (generatingIds || []).some((id) => sameId(id, session.id));
}
function replacePendingMessage(items, pendingKey, next) {
  const index = items.findIndex((item) => pendingKey && item.pendingKey === pendingKey);
  const fallback = index < 0 ? items.findIndex((item) => item.pending) : index;
  if (fallback < 0) return [...items, next];
  const copy = items.slice();
  copy[fallback] = next;
  return copy;
}
function toReferenceMaterial(asset) {
  const url = mediaUrl(asset.src || asset.url || asset.storageKey);
  const poster = mediaUrl(asset.poster || asset.posterUrl || asset.posterKey) || url;
  const width = Number.isFinite(asset.width) ? asset.width : null;
  const height = Number.isFinite(asset.height) ? asset.height : null;
  const durationMs = Number.isFinite(asset.durationMs) ? asset.durationMs : null;
  return {
    id: asset.id,
    name: asset.title || asset.name,
    url,
    poster,
    type: asset.type === "audio" || asset.kind === "audio" ? "audio" : asset.type === "video" || asset.kind === "video" ? "video" : "image",
    storageKey: asset.storageKey || storageKeyOf(asset.src || asset.url) || storageKeyOf(url),
    width,
    height,
    durationMs,
  };
}
const creationPresets = {
  audio: [
    { id: "brand-voice", title: "品牌旁白", description: "清晰沉稳的产品与品牌解说", prompt: "欢迎来到同道创作平台，让每一个灵感都拥有自己的声音。" },
    { id: "story-voice", title: "故事讲述", description: "自然、有温度的叙事表达", prompt: "夜幕降临，城市的灯光次第亮起，一段新的故事正悄然开始。" },
    { id: "short-video", title: "短视频口播", description: "紧凑有力的社交媒体口播", prompt: "只需几步，就能把你的创意快速变成可分享的作品。" },
  ],
  video: [
    {
      id: "street-rhythm", mode: "reference", title: "节奏复刻", description: "跟随人物动作完成富有节奏的镜头切换", video: "/media/seedance-20.webm", poster: "/media/seedance-20-poster.webp",
      materials: [
        { name: "街头人物", url: "/media/quick-create/video-rhythm.jpg", type: "image" },
        { name: "鱼眼动作", url: "/media/seedance-20.webm", poster: "/media/seedance-20-poster.webp", type: "video" },
        { name: "时装姿态", url: "/media/quick-create/image-fashion.jpg", type: "image" },
        { name: "竞速节奏", url: "/media/comfy-racer.webm", poster: "/media/comfy-racer-poster.webp", type: "video" },
        { name: "东京造型", url: "/media/quick-create/image-tokyo.jpg", type: "image" },
        { name: "机甲转场", url: "/media/grok-video.webm", poster: "/media/grok-video-poster.webp", type: "video" },
      ],
      prompt: "严格参考已选素材中的人物动作、服装轮廓与镜头节奏：主角从城市街头走入未来场景，镜头在鱼眼近景、低机位跟拍与快速横移之间自然衔接。保持主体一致，转场跟随动作发生，节拍清晰，真实电影质感。",
    },
    {
      id: "wildlife-track", mode: "frames", title: "疾速追踪", description: "从蓄势到冲刺，完成稳定连贯的首尾帧变化", video: "/media/comfy-racer.webm", poster: "/media/comfy-racer-poster.webp",
      frames: [
        { name: "首帧·进入赛道", url: "/media/quick-create/frames-racer-start.jpg", type: "image" },
        { name: "尾帧·全速推进", url: "/media/quick-create/frames-racer-end.jpg", type: "image" },
      ],
      prompt: "基于首尾帧生成连续的高速追踪镜头。飞行器沿荒漠赛道迅速加速并平稳向画面纵深移动，第一视角贴近驾驶舱，背景自然运动模糊；保持赛道、天空与舱体结构稳定，完整过渡到尾帧构图。",
    },
    {
      id: "mecha-awakening", mode: "frames", title: "机甲觉醒", description: "双帧锁定角色，由全身装甲推进至面部特写", video: "/media/grok-video.webm", poster: "/media/grok-video-poster.webp",
      frames: [
        { name: "首帧·机甲全身", url: "/media/quick-create/frames-mecha-start.jpg", type: "image" },
        { name: "尾帧·面部特写", url: "/media/quick-create/frames-mecha-end.jpg", type: "image" },
      ],
      prompt: "由首帧机甲全身像自然推进到尾帧面部特写：白色未来装甲从黑暗中被轮廓光点亮，镜头缓慢、稳定地向前推近；机械结构逐层展开，最终露出驾驶员面部，保持装甲材质、中心构图与光线方向一致。",
    },
  ],
  image: [
    { id: "editorial-portrait", title: "人像写真", description: "自然光与城市纵深塑造杂志封面质感", image: "/media/quick-create/image-fashion.jpg", materials: [{ name: "主体人像", url: "/media/quick-create/image-fashion.jpg", type: "image" }, { name: "城市构图", url: "/media/quick-create/video-rhythm.jpg", type: "image" }, { name: "造型参考", url: "/media/quick-create/image-tokyo.jpg", type: "image" }], prompt: "综合参考素材中的人物、造型与城市构图，生成一张街头时装肖像。午后柔和自然光，浅景深，人物姿态自信松弛，服装面料与肤质细节真实，高级杂志编辑摄影风格。" },
    { id: "tokyo-diary", title: "旅行纪实", description: "胶片色彩记录年轻而真实的旅行瞬间", image: "/media/quick-create/image-tokyo.jpg", materials: [{ name: "东京造型", url: "/media/quick-create/image-tokyo.jpg", type: "image" }, { name: "街道光线", url: "/media/quick-create/video-rhythm.jpg", type: "image" }, { name: "人物姿态", url: "/media/quick-create/image-fashion.jpg", type: "image" }], prompt: "融合多张参考图的人物造型、街道光线与抓拍姿态，在东京安静街巷生成一张旅行纪实照片。略带冷调的胶片色彩，柔和环境光，真实、松弛、有故事感。" },
    { id: "product-splash", title: "商业视觉", description: "高速凝固水花，打造鲜明的广告主视觉", image: "/media/quick-create/image-product.jpg", materials: [{ name: "产品主体", url: "/media/quick-create/image-product.jpg", type: "image" }, { name: "冷色氛围", url: "/media/quick-create/video-neon-ride.jpg", type: "image" }, { name: "运动构图", url: "/media/quick-create/video-wildlife.jpg", type: "image" }], prompt: "综合参考素材中的产品主体、冷色氛围与运动构图，生成清爽饮品广告主视觉。产品居中悬浮，晶莹水花在高速快门下凝固，罐身细节锐利，棚拍光线干净。" },
  ],
};

function makeInitialSession() {
  return {
    id: DEFAULT_SESSION_ID,
    title: "新建创作",
    generationType: "video",
    updated: "刚刚",
    messages: [],
  };
}

function extensionFromName(value) {
  const source = String(value || "");
  let name = source.split("#")[0];
  try {
    if (source.includes("key=")) {
      const key = new URL(source, window.location.origin).searchParams.get("key");
      if (key) name = key;
    }
  } catch {
    // 地址无法解析时退回路径本身
  }
  const match = name.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : "";
}

function extensionFromContentType(contentType) {
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  const known = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
  };
  return known[mime] || "";
}

function extensionOf(url, type, contentType) {
  const fromName = extensionFromName(url);
  if (fromName && fromName !== "bin") return fromName;
  const fromType = extensionFromContentType(contentType);
  if (fromType) return fromType;
  if (type === "video") return "mp4";
  if (type === "audio") return "mp3";
  if (type === "image") return "png";
  return "bin";
}

const MAX_REFERENCE_ASSETS = 15;

function QuickAudioPopover({ voices, formats, voiceId, setVoiceId, audioFormat, setAudioFormat, speed, setSpeed, minSpeed, maxSpeed }) {
  const [voiceKeyword, setVoiceKeyword] = useState("");
  const [voiceLanguageFilter, setVoiceLanguageFilter] = useState("全部");
  const languages = [...new Set(voices.map(voiceLanguage))];
  const normalizedKeyword = voiceKeyword.trim().toLowerCase();
  const visibleVoices = voices.filter((voice) => {
    const matchesLanguage = voiceLanguageFilter === "全部" || voiceLanguage(voice) === voiceLanguageFilter;
    const matchesKeyword = !normalizedKeyword || `${voiceLabel(voice)} ${voiceIdOf(voice)}`.toLowerCase().includes(normalizedKeyword);
    return matchesLanguage && matchesKeyword;
  });
  const speedProgress = Math.min(100, Math.max(0, ((speed - minSpeed) / (maxSpeed - minSpeed || 1)) * 100));
  return (
    <div className="select-menu quick-audio-popover" role="dialog" aria-label="语音参数设置">
      <section className="quick-audio-section">
        <label><span>音色</span><small>共 {voices.length} 个</small></label>
        <div className="quick-voice-tools">
          <input value={voiceKeyword} onChange={(event) => setVoiceKeyword(event.target.value)} placeholder="搜索音色名称或 Voice ID" />
          <select value={voiceLanguageFilter} onChange={(event) => setVoiceLanguageFilter(event.target.value)}>
            <option value="全部">全部语言</option>
            {languages.map((language) => <option key={language} value={language}>{language}</option>)}
          </select>
        </div>
        <div className="quick-voice-grid">
          {visibleVoices.map((voice) => {
            const id = voiceIdOf(voice);
            const selected = voiceId === id;
            return (
              <button type="button" className={selected ? "selected" : ""} key={id} onClick={() => setVoiceId(id)}>
                <span>{voiceLabel(voice)}</span>
                <small>{voiceLanguage(voice)} · {id}</small>
                {selected && <Check size={12} className="quick-option-check" />}
              </button>
            );
          })}
        </div>
        {!visibleVoices.length && <div className="quick-voice-empty">没有匹配的音色</div>}
      </section>

      <section className="quick-audio-section">
        <label>格式</label>
        <div className="quick-format-grid">
          {formats.map((fmt) => {
            const selected = audioFormat === fmt;
            return (
              <button type="button" role="option" aria-selected={selected} className={`quick-param-option ${selected ? "selected" : ""}`} key={fmt} onClick={() => setAudioFormat(fmt)}>
                <span>{fmt.toUpperCase()}</span>
                {selected && <Check size={13} className="quick-option-check" />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="quick-audio-section quick-audio-speed">
        <label><span>语速</span><b>{speed.toFixed(2)}x</b></label>
        <input type="range" style={{ "--range-progress": `${speedProgress}%` }} min={minSpeed} max={maxSpeed} step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
        <div><small>{minSpeed}x</small><small>{maxSpeed}x</small></div>
      </section>
    </div>
  );
}

/**
 * 单条生成结果的消息卡片。
 * - 上方：媒体回显（视频 / 音频 / 图片）；
 * - 中间：精简元信息（模型/类型/参数/耗时/积分）；
 * - 下方：可折叠的 Prompt 与四个动作（复用参数 / 再次生成 / 保存 / 高清下载）。
 */
function ResultMessage({ message, onReuse, onSave, savedIds = [], savingId }) {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const items = (message.creations || []).map((item) => ({
    id: item.id,
    type: item.type || item.category,
    src: mediaUrl(item.src || item.url || item.storageKey),
    poster: mediaUrl(item.poster || item.posterUrl || item.posterKey),
    title: item.title,
  }));
  if (!items.length && message.media?.src) {
    items.push({ type: message.media.type, src: mediaUrl(message.media.src), poster: mediaUrl(message.media.poster), title: message.media.title });
  }
  const primaryId = items[0]?.id;
  const saved = Boolean(primaryId && savedIds.includes(primaryId));
  const saving = savingId === primaryId;
  const downloadable = items.filter((item) => item.src);

  async function downloadAll() {
    if (!downloadable.length || downloading) return;
    setDownloading(true);
    try {
      for (let index = 0; index < downloadable.length; index += 1) {
        const file = downloadable[index];
        try {
          const response = await fetch(file.src);
          if (!response.ok) throw new Error("下载失败");
          const blob = await response.blob();
          const href = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = href;
          const ext = extensionOf(file.src, file.type, blob.type || response.headers.get("content-type"));
          link.download = `${message.model || "作品"}${downloadable.length > 1 ? `-${index + 1}` : ""}.${ext}`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(href);
        } catch {
          window.open(file.src, "_blank");
        }
      }
    } finally {
      setDownloading(false);
    }
  }

  if (message.pending) {
    return (
      <div className="quick-message quick-message--result">
        <span className="quick-message__avatar"><Sparkles size={16} /></span>
        <div className="quick-message__body">
          <div className="quick-generating-line"><i /><i /><i /> {message.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="quick-message quick-message--result">
      <span className="quick-message__avatar"><Sparkles size={16} /></span>
      <div className="quick-result-card">
        <p className="quick-result-card__headline">{message.text}</p>
        {saved && <div className="quick-result-card__saved"><Check size={14} /> 已保存到素材库</div>}
        {items.length > 0 && (
          <div className="quick-result-media">
            {items.map((media) => media.type === "video"
              ? <video key={media.id || media.src} src={media.src} poster={media.poster} controls playsInline><track kind="captions" src="/media/demo-captions.vtt" srcLang="zh" label="中文" /></video>
              : media.type === "audio"
                ? <div className="quick-result-audio" key={media.id || media.src}><span><AudioLines size={24} /></span><div><small>语音作品</small><strong>{media.title || "语音作品"}</strong><audio src={media.src} controls preload="metadata" /></div></div>
                : <img key={media.id || media.src} src={media.src} alt={media.title || ""} />)}
            {message.creationType !== "语音" && <span className="quick-result-spec">{message.ratio} · {message.resolution}{message.creationType === "视频" ? ` · ${message.duration}` : ""}</span>}
          </div>
        )}
        {message.error && <div className="quick-result-error">生成失败：{message.text}</div>}
        <div className="quick-result-meta">
          <span><small>模型</small><strong>{message.model}</strong></span>
          <span><small>类型</small><strong>{message.creationType}</strong></span>
          {message.createdAt && <span><small>创建时间</small><strong>{message.createdAt}</strong></span>}
          <span><small>耗时</small><strong>{message.elapsed}</strong></span>
          <span><small>积分消耗</small><strong>{message.credits} 积分</strong></span>
        </div>
        {message.prompt && (
          <div
            className={`quick-result-prompt${promptExpanded ? " is-expanded" : ""}`}
            role="button"
            tabIndex={0}
            aria-expanded={promptExpanded}
            title={promptExpanded ? "收起完整 Prompt" : "展开完整 Prompt"}
            onClick={() => setPromptExpanded((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setPromptExpanded((value) => !value);
              }
            }}
          >
            <small>生成 Prompt</small>
            <p>{promptForDisplay(message.prompt) || message.prompt}</p>
          </div>
        )}
        <div className="quick-result-actions">
          <button type="button" onClick={() => onReuse(message, "edit")}><Pencil size={13} /> 复用参数</button>
          <button type="button" onClick={() => onReuse(message, "regenerate")}><RefreshCw size={13} /> 再次生成</button>
          {primaryId && (
            <button type="button" className={saved ? "is-saved" : ""} disabled={saved || saving} onClick={() => onSave(primaryId)}>
              <Save size={13} /> {saved ? "已保存" : saving ? "保存中…" : "保存到素材库"}
            </button>
          )}
          {downloadable.length > 0 && (
            <button type="button" disabled={downloading} onClick={downloadAll}>
              <Download size={13} /> {downloading ? "下载中…" : downloadable.length > 1 ? `高清下载 · ${downloadable.length} 个` : "高清下载"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const SESSION_DRAFT_KEY = "fastcreate.composer.drafts";
function readAllSessionDrafts() {
  try {
    const raw = window.sessionStorage.getItem(SESSION_DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
/**
 * 把 prompt 草稿按 session 持久化：
 * - 在同一 session 内切走再切回，草稿还在；
 * - 切到「历史创作」等 tab 再返回，整页重新挂载 FastCreate 时按 session 读回；
 * - 切到其他 session 后再切回来，原 session 的草稿仍在。
 *
 * 草稿统一存到 sessionStorage 的一个 JSON map（key = sessionId），关页面自动清。
 */
function usePerSessionDraft(activeSessionId, initial = "") {
  const [drafts, setDrafts] = useState(readAllSessionDrafts);
  const value = drafts[activeSessionId] ?? initial;
  const setValue = useCallback(
    (next) => {
      setDrafts((current) => {
        const updated = { ...current };
        const draft = typeof next === "function" ? next(updated[activeSessionId] ?? initial) : next;
        if (draft) updated[activeSessionId] = draft;
        else delete updated[activeSessionId];
        return updated;
      });
    },
    [activeSessionId, initial]
  );
  useEffect(() => {
    try {
      if (Object.keys(drafts).length > 0) {
        window.sessionStorage.setItem(SESSION_DRAFT_KEY, JSON.stringify(drafts));
      } else {
        window.sessionStorage.removeItem(SESSION_DRAFT_KEY);
      }
    } catch {
      // 隐私模式 / quota 降级为纯内存，不影响功能
    }
  }, [drafts]);
  return [value, setValue];
}

export function FastCreate({ config, onConsumeCredits = () => {}, theme = "light", onOpenAssets, modelCatalogLoading = false, modelCatalogError = null, credits = null, onNeedRecharge = null, reuse = null, onReuseApplied = () => {}, onRequestCollapseSidebar = null }) {
  const queryClient = useQueryClient();
  const [sessions, setSessions] = useState(() => [makeInitialSession()]);
  const [activeSessionId, setActiveSessionId] = useState(DEFAULT_SESSION_ID);
  const [generationType, setGenerationType] = useState("video");
  const conversationSessions = sessions.filter((item) => item.id !== DEFAULT_SESSION_ID);
  const showConversationRail = conversationSessions.length > 0;
  const availableModels = useMemo(() => (config.models || []).filter((item) => item.enabled !== false && (item.category === generationType || item.capabilities?.includes(generationType))), [config.models, generationType]);
  const [model, setModel] = useState(() => String(config.models.find((item) => item.enabled !== false && (item.category === "video" || item.capabilities?.includes("video")))?.id || config.models[0]?.id || ""));
  // 创作框内容按 session 持久化，切走/切回不丢；关 tab 自动清。
  const [prompt, setPrompt] = usePerSessionDraft(activeSessionId, "");
  const [generatingSessionIds, setGeneratingSessionIds] = useState([]);
  const [submitError, setSubmitError] = useState("");
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const [regenerateTick, setRegenerateTick] = useState(0);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState(null);
  const [savedCreationIds, setSavedCreationIds] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [videoMode, setVideoMode] = useState("reference");
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720P");
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState("Low");
  const [copies, setCopies] = useState(1);
  const [voiceId, setVoiceId] = useState("alloy");
  const [speed, setSpeed] = useState(1);
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [referenceImages, setReferenceImages] = useState([]);
  const [referenceVideoSeconds, setReferenceVideoSeconds] = useState(0);
  const [openPanel, setOpenPanel] = useState(null);
  const [dropup, setDropup] = useState(false);

  function togglePanel(panelName, event) {
    if (openPanel === panelName) {
      setOpenPanel(null);
      return;
    }
    if (event?.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedHeight = panelName === "params" && generationType === "audio" ? 400 : 280;
      const needDropup = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
      setDropup(needDropup);
    } else {
      setDropup(false);
    }
    setOpenPanel(panelName);
    setAssetPickerOpen(false);
  }
  const [firstFrame, setFirstFrame] = useState(null);
  const [lastFrame, setLastFrame] = useState(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [pendingAssets, setPendingAssets] = useState([]);
  const [sessionMenuId, setSessionMenuId] = useState(null);
  const [queuedPrompt, setQueuedPrompt] = useState(null);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const referenceInputRef = useRef(null);
  const firstFrameInputRef = useRef(null);
  const lastFrameInputRef = useRef(null);
  const textareaRef = useRef(null);
  const generatingSessionRef = useRef(new Set());
  const regenerateRef = useRef(false);
  const sessionMenuRef = useRef(null);
  const conversationRef = useRef(null);
  const [historyScrollToken, setHistoryScrollToken] = useState(0);
  const watchingTasksRef = useRef(new Set());
  const activeSessionIdRef = useRef(activeSessionId);
  const activeSession = sessions.find((item) => item.id === activeSessionId) || sessions[0];
  const sessionGenerating = isSessionGenerating(activeSession, generatingSessionIds);
  const hasConversationHistory = activeSession.messages.length > 0;

  const selectedModel = useMemo(() => availableModels.find((item) => String(item.id) === String(model)) || availableModels[0], [availableModels, model]);
  const audioOptions = selectedModel?.audioOptions || {};
  const availableVoices = (audioOptions.voices?.length ? audioOptions.voices : [audioOptions.defaultVoice || "alloy"]).filter((item) => voiceIdOf(item));
  const voices = availableVoices;
  const voiceIds = voices.map(voiceIdOf);
  const audioFormats = audioOptions.formats?.length ? audioOptions.formats : [audioOptions.defaultFormat || "mp3"];
  const minSpeed = Number(audioOptions.minSpeed ?? 0.25);
  const maxSpeed = Number(audioOptions.maxSpeed ?? 4);
  const supportsAudioReference = generationType === "video" && Boolean(selectedModel?.supportsAudioReference);
  const maxAudioReferences = supportsAudioReference ? Number(selectedModel?.maxAudioReferences || 0) : 0;
  const supportsFrames = modelSupports(selectedModel, "i2v");
  const supportsLibrary = supportsLibraryCite(selectedModel, generationType, videoMode);
  const framesReady = generationType === "video" && videoMode === "frames" && Boolean(firstFrame);
  const audioOnlyReady = Boolean(selectedModel?.supportsAudioOnlyReference && referenceImages.some((item) => item.type === "audio"));
  const canSubmit = Boolean(selectedModel && (videoMode === "frames" && generationType === "video" ? framesReady : (prompt.trim() || audioOnlyReady)) && !sessionGenerating);
  const showVideoModes = generationType === "video" && (modelSupports(selectedModel, "r2v") || supportsFrames);
  const maxCopies = maxCopiesFor(selectedModel);
  const activeCopies = Math.min(maxCopies, Math.max(1, copies));
  const creditCost = selectedModel ? calculateCreditEstimate({
    pricing: selectedModel?.pricing,
    category: generationType,
    resolution,
    quality,
    durationSec: duration,
    referenceVideoSeconds: generationType === "video" && videoMode !== "frames" ? referenceVideoSeconds : 0,
    characterCount: generationType === "audio"
      ? billableCharacters(prompt, resolveCjkWeight(selectedModel?.pricing, selectedModel?.adapterKey))
      : prompt.length,
    copies: activeCopies,
  }) : 0;
  const balanceCredits = Number(credits);
  const creditShortage = Boolean(selectedModel) && Number.isFinite(balanceCredits) && creditCost > balanceCredits;
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { if (availableModels.length && !availableModels.some((item) => String(item.id) === String(model))) setModel(String(availableModels[0].id)); }, [availableModels, model]);

  // 加载 / 切换历史会话后默认滚到最新消息；token 不变时消息异步到位也会再滚一次。
  useLayoutEffect(() => {
    if (!historyScrollToken) return;
    const el = conversationRef.current;
    if (!el || !activeSession.messages.length) return;
    el.scrollTop = el.scrollHeight;
  }, [historyScrollToken, activeSessionId, activeSession.messages]);
  // 参考视频秒数：读各参考视频时长求和（向上取整），计费并入按秒单价
  useEffect(() => {
    let alive = true;
    sumReferenceVideoSeconds(referenceImages).then((seconds) => {
      if (alive) setReferenceVideoSeconds(seconds);
    });
    return () => { alive = false; };
  }, [referenceImages]);
  useEffect(() => {
    if (generationType !== "audio") return;
    const nextVoice = audioOptions.defaultVoice || voiceIds[0] || "alloy";
    const nextFormat = audioOptions.defaultFormat || audioFormats[0] || "mp3";
    setVoiceId((current) => voiceIds.includes(current) ? current : nextVoice);
    setAudioFormat((current) => audioFormats.includes(current) ? current : nextFormat);
    setSpeed((current) => Math.min(maxSpeed, Math.max(minSpeed, current || 1)));
  }, [generationType, selectedModel?.id]);
  useEffect(() => {
    const next = clampDurationForModel(selectedModel, duration);
    if (next !== duration) setDuration(next);
  }, [selectedModel, duration]);
  useEffect(() => {
    // 分辨率必须落在当前类型的可选档位内：切换会话/模型/创作类型后仍可能残留旧值（如图片模式残留 720P）
    const options = resolutionOptionsFor(selectedModel, generationType);
    if (!options.length) return;
    if (!options.includes(resolution)) setResolution(options[0]);
  }, [selectedModel, generationType, resolution]);
  useEffect(() => {
    if (!supportsLibrary) {
      setReferenceImages([]);
      setAssetPickerOpen(false);
    }
    if (!supportsFrames) {
      setFirstFrame(null);
      setLastFrame(null);
      if (videoMode === "frames") setVideoMode("reference");
    }
    if (!supportsAudioReference) {
      setReferenceImages((items) => items.filter((item) => item.type !== "audio"));
    }
  }, [supportsLibrary, supportsFrames, supportsAudioReference, videoMode]);
  useEffect(() => {
    if (!queuedPrompt || !sameId(activeSessionId, queuedPrompt.sessionId)) return;
    setPrompt(queuedPrompt.text);
    setQueuedPrompt(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [queuedPrompt, activeSessionId, setPrompt]);
  useEffect(() => {
    let cancelled = false;
    const seed = reuse;
    fetchSessions().then(async (items) => {
      if (cancelled) return;
      if (!items?.length) {
        setSessions([makeInitialSession()]);
        setActiveSessionId(DEFAULT_SESSION_ID);
        activeSessionIdRef.current = DEFAULT_SESSION_ID;
        if (seed) queueCreationSeed(seed, DEFAULT_SESSION_ID);
        return;
      }
      const mapped = items.map((item) => ({
        id: item.id,
        title: item.title || "未命名创作",
        generationType: item.category || "video",
        updated: formatDateTime(item.updatedAt) || "刚刚",
        messages: [],
      }));
      const preferred = seed?.sessionId != null ? mapped.find((item) => sameId(item.id, seed.sessionId)) : null;
      const first = preferred || mapped[0];
      setSessions(mapped);
      setActiveSessionId(first.id);
      activeSessionIdRef.current = first.id;
      setHistoryScrollToken((token) => token + 1);
      const detail = await fetchSession(first.id);
      if (!cancelled && detail) applySessionDetail(detail);
      if (!cancelled && seed) queueCreationSeed(seed, first.id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function queueCreationSeed(seed, sessionId) {
    const category = ["video", "image", "audio"].includes(seed.type) ? seed.type : "image";
    setGenerationType(category);
    if (seed.modelId != null && seed.modelId !== "") setModel(String(seed.modelId));
    if (seed.ratio && seed.ratio !== "—") setRatio(seed.ratio);
    if (seed.resolution && seed.resolution !== "—") setResolution(seed.resolution);
    const seconds = Number(seed.durationSec);
    if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds);
    setQueuedPrompt({ sessionId, text: seed.prompt || "" });
    onReuseApplied();
  }

  useEffect(() => {
    if (sessionMenuId == null) return undefined;
    const close = (event) => {
      if (!sessionMenuRef.current?.contains(event.target)) setSessionMenuId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sessionMenuId]);
  useEffect(() => {
    if (!openPanel) return undefined;
    const close = (event) => {
      if (
        event.target.closest(".quick-config-group") ||
        event.target.closest(".quick-prompt-wrap") ||
        event.target.closest(".quick-popover") ||
        event.target.closest(".select-menu")
      ) return;
      setOpenPanel(null);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpenPanel(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [openPanel]);

  // 「再次生成」：复用参数回填完成后自动重新提交一次（回填状态在本轮 render 全部生效）。
  useEffect(() => {
    if (!regenerateTick || !regenerateRef.current) return;
    regenerateRef.current = false;
    sendPrompt();
  }, [regenerateTick, sendPrompt]);

  function beginGenerating(sessionId) {
    if (sessionId == null) return;
    const key = String(sessionId);
    generatingSessionRef.current.add(key);
    setGeneratingSessionIds((ids) => (ids.includes(key) ? ids : [...ids, key]));
  }

  function endGenerating(sessionId) {
    if (sessionId == null) return;
    const key = String(sessionId);
    generatingSessionRef.current.delete(key);
    setGeneratingSessionIds((ids) => ids.filter((id) => id !== key));
  }

  function applySessionDetail(detail) {
    setSessions((items) => items.map((session) => {
      if (!sameId(session.id, detail.id)) return session;
      const incoming = tasksToMessages(detail.tasks);
      const localInflight = (session.messages || []).filter((item) => item.pendingKey);
      let messages = incoming;
      if (localInflight.length && !incoming.some((item) => item.pending)) {
        const extras = [];
        for (const pending of localInflight) {
          const index = session.messages.indexOf(pending);
          const user = index > 0 ? session.messages[index - 1] : null;
          if (user?.type === "user" && !incoming.some((item) => item.type === "user" && item.text === user.text)) {
            extras.push(user);
          }
          extras.push(pending);
        }
        messages = [...incoming, ...extras];
      }
      return {
        ...session,
        title: detail.title || session.title,
        generationType: detail.category || session.generationType,
        updated: formatDateTime(detail.updatedAt) || session.updated,
        messages,
      };
    }));
    if (detail.category && sameId(detail.id, activeSessionIdRef.current)) {
      setGenerationType(detail.category);
    }
    watchPendingTasks(detail.tasks, detail.id);
  }

  function watchPendingTasks(tasks, sessionId) {
    (tasks || []).forEach((task) => {
      if (!task?.id || (task.status !== "PENDING" && task.status !== "RUNNING")) return;
      if (watchingTasksRef.current.has(task.id)) return;
      watchingTasksRef.current.add(task.id);
      const ownerId = task.sessionId ?? sessionId ?? activeSessionIdRef.current;
      if (ownerId != null) beginGenerating(ownerId);
      const timeout = task.category === "video" ? VIDEO_POLL_TIMEOUT_MS : IMAGE_POLL_TIMEOUT_MS;
      pollGenerateTask(task.id, { interval: 2000, timeout })
        .then(async () => {
          watchingTasksRef.current.delete(task.id);
          if (persistedSessionId(ownerId)) {
            const detail = await fetchSession(ownerId);
            applySessionDetail(detail);
          }
          endGenerating(ownerId);
        })
        .catch(async (error) => {
          watchingTasksRef.current.delete(task.id);
          if (error?.stillGoing && persistedSessionId(ownerId)) {
            const detail = await fetchSession(ownerId).catch(() => null);
            if (detail) applySessionDetail(detail);
            return;
          }
          endGenerating(ownerId);
        });
    });
  }

  function switchSession(session) {
    setHistoryScrollToken((token) => token + 1);
    setActiveSessionId(session.id);
    setGenerationType(session.generationType);
    fetchSession(session.id).then(applySessionDetail).catch(() => {});
  }

  function createSessionLocal() {
    createSession({ title: "未命名创作", category: generationType }).then((created) => {
      const next = { id: created.id, title: created.title || "未命名创作", generationType, updated: "刚刚", messages: [] };
      setSessions((items) => [next, ...items.filter((item) => item.id !== DEFAULT_SESSION_ID)]);
      setActiveSessionId(created.id);
      setPrompt("");
      onRequestCollapseSidebar?.();
    }).catch((error) => setSubmitError(error.message || "无法新建会话"));
  }

  function persistedSessionId(id) {
    return id != null && id !== DEFAULT_SESSION_ID && /^\d+$/.test(String(id));
  }

  function requestDeleteSession(session) {
    if (generatingSessionRef.current.has(String(session.id)) || sessionHasPending(session)) {
      setSubmitError("请等待当前生成完成后再删除该会话");
      return;
    }
    setDeleteSessionTarget(session);
  }

  async function confirmDeleteSession() {
    const session = deleteSessionTarget;
    if (!session) return;
    setSubmitError("");
    try {
      if (persistedSessionId(session.id)) {
        await deleteSession(session.id);
      }
      const remaining = sessions.filter((item) => item.id !== session.id);
      setDeleteSessionTarget(null);
      if (!remaining.length) {
        setSessions([makeInitialSession()]);
        setActiveSessionId(DEFAULT_SESSION_ID);
        setPrompt("");
        return;
      }
      setSessions(remaining);
      if (session.id === activeSessionId) {
        switchSession(remaining[0]);
      }
    } catch (error) {
      setSubmitError(error.message || "删除会话失败");
    }
  }

  function changeType(type) {
    setGenerationType(type);
    setOpenPanel(null);
    setReferenceImages([]);
    setFirstFrame(null);
    setLastFrame(null);
    setVideoMode("reference");
    setRatio(type === "video" ? "16:9" : type === "image" ? "9:16" : "");
    setResolution(type === "video" ? "720P" : type === "image" ? "1K" : "");
  }

  function resetComposer() {
    setPrompt("");
    setReferenceImages([]);
    setFirstFrame(null);
    setLastFrame(null);
    setVideoMode("reference");
    setRatio(generationType === "video" ? "16:9" : generationType === "image" ? "9:16" : "");
    setResolution(generationType === "video" ? "720P" : generationType === "image" ? "1K" : "");
    setDuration(5);
    setQuality("Low");
    setCopies(1);
    setSpeed(1);
    setOpenPanel(null);
  }

  function applyPreset(preset) {
    setPrompt(preset.prompt);
    if (generationType === "video" && preset.mode === "frames") {
      if (!supportsFrames) {
        setVideoMode("reference");
        setReferenceImages(supportsLibrary ? (preset.materials || []) : []);
        setFirstFrame(null);
        setLastFrame(null);
      } else {
        setVideoMode("frames");
        setReferenceImages([]);
        setFirstFrame(preset.frames[0]);
        setLastFrame(preset.frames[1]);
      }
    } else {
      setVideoMode("reference");
      setReferenceImages(supportsLibrary ? (preset.materials || []) : []);
      setFirstFrame(null);
      setLastFrame(null);
    }
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function openAssetPicker() {
    if (sessionGenerating) {
      setSubmitError("生成中的任务已锁定引用素材，完成后才能调整");
      return;
    }
    if (!supportsLibrary) {
      setSubmitError(generationType === "image"
        ? "当前模型不支持参考图"
        : videoMode === "frames"
          ? "当前模型不支持首尾帧"
          : "当前模型不支持参考生视频");
      return;
    }
    setSubmitError("");
    const framesPending = [firstFrame, lastFrame].filter(Boolean);
    setPendingAssets(generationType === "video" && videoMode === "frames" ? framesPending : referenceImages);
    setAssetPickerOpen(true);
    setLibraryLoading(true);
    setLibraryError("");
    fetchAssets()
      .then((items) => setLibraryAssets(items || []))
      .catch((error) => {
        setLibraryAssets([]);
        setLibraryError(error.message || "素材加载失败，请关闭后重试");
      })
      .finally(() => setLibraryLoading(false));
  }

  function togglePendingAsset(asset) {
    if (sessionGenerating) return;
    const next = toReferenceMaterial(asset);
    const framesPicker = generationType === "video" && videoMode === "frames";
    if (framesPicker && !isImageMaterial(next)) return;
    setPendingAssets((items) => {
      if (items.some((item) => sameAsset(item, next))) {
        return items.filter((item) => !sameAsset(item, next));
      }
      if (framesPicker && items.length >= 2) {
        setSubmitError("首尾帧最多引用两张图片，第 1 张为首帧、第 2 张为尾帧");
        return items;
      }
      if (!framesPicker && items.length >= MAX_REFERENCE_ASSETS) {
        setSubmitError(`参考素材最多选择 ${MAX_REFERENCE_ASSETS} 个`);
        return items;
      }
      return [...items, next];
    });
  }

  function addReferenceImages(files) {
    if (sessionGenerating) {
      setSubmitError("生成中的任务已锁定引用素材，完成后才能调整");
      return;
    }
    if (!supportsLibrary) {
      setSubmitError(generationType === "image" ? "当前模型不支持参考图" : "当前模型不支持参考生视频");
      return;
    }
    const next = Array.from(files || [])
      .filter((file) => {
        if (file.type.startsWith("audio/")) return false;
        if (!file.type.startsWith("video/")) return true;
        return generationType === "video" && !imageOnlyRefs(selectedModel);
      })
      .map((file) => ({ name: file.name, url: URL.createObjectURL(file), file, type: file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "video" : "image" }));
    const availableAudioSlots = Math.max(0, maxAudioReferences - referenceImages.filter((item) => item.type === "audio").length);
    let addedAudio = 0;
    const accepted = next.filter((item) => item.type !== "audio" || addedAudio++ < availableAudioSlots);
    if (accepted.length < next.length) setSubmitError(`当前模型最多支持 ${maxAudioReferences} 段参考音频`);
    setReferenceImages((items) => {
      const slots = Math.max(0, MAX_REFERENCE_ASSETS - items.length);
      if (accepted.length > slots) setSubmitError(`参考素材最多选择 ${MAX_REFERENCE_ASSETS} 个`);
      return [...items, ...accepted.slice(0, slots)];
    });
  }

  function setFrame(file, setter) {
    if (!file) return;
    if (sessionGenerating) {
      setSubmitError("生成中的任务已锁定引用素材，完成后才能调整");
      return;
    }
    if (!supportsFrames) {
      setSubmitError("当前模型不支持首尾帧");
      return;
    }
    setter({ name: file.name, url: URL.createObjectURL(file), file, type: "image" });
  }

  function updateSessionMessages(sessionId, updater, options = {}) {
    if (sessionId == null) return;
    setSessions((items) => items.map((session) => {
      if (!sameId(session.id, sessionId)) return session;
      return {
        ...session,
        generationType: options.category || session.generationType,
        title: session.messages.length ? session.title : ((options.titleSource || "").trim().slice(0, 12) || session.title),
        updated: "刚刚",
        messages: updater(session.messages),
      };
    }));
  }

  async function sendPrompt() {
    const text = prompt.trim();
    const audioOnlyAllowed = generationType === "video"
      && selectedModel?.supportsAudioOnlyReference
      && referenceImages.some((item) => item.type === "audio");
    const framesReadyNow = generationType === "video" && videoMode === "frames" && supportsFrames && Boolean(firstFrame);
    if (generationType === "video" && videoMode === "frames") {
      if (!framesReadyNow || sessionGenerating) return;
    } else if ((!text && !audioOnlyAllowed) || sessionGenerating) return;
    const blocked = capabilityBlockReason(selectedModel, generationType, referenceImages, firstFrame, lastFrame, videoMode);
    if (blocked) {
      setSubmitError(blocked);
      return;
    }
    if (activeCopies < 1 || activeCopies > maxCopies) {
      setSubmitError(`当前模型每次最多生成 ${maxCopies} 个`);
      return;
    }
    const displayText = text || (framesReadyNow ? FRAMES_EMPTY_PROMPT_LABEL : "");
    setSubmitError("");
    setInsufficientCredits(false);
    setPrompt("");
    const currentType = generationType;
    const currentModel = selectedModel;
    const pendingKey = `pending-${Date.now()}`;
    const pendingMessage = {
      type: "result",
      pending: true,
      pendingKey,
      prompt: displayText,
      text: currentType === "video" ? "视频生成中，通常需要几分钟，请稍候…" : currentType === "audio" ? "语音生成中，请稍候…" : "图片生成中，请稍候…",
    };
    let sessionId = activeSessionId === DEFAULT_SESSION_ID ? null : activeSessionId;
    let keepBusy = false;
    let submittedId = null;
    let uploadedReferences = null;
    let uploadedFrames = null;
    const failResult = (message) => ({
      type: "result",
      prompt: displayText,
      text: message,
      error: true,
      model: currentModel?.name || "模型",
      creationType: currentType === "video" ? "视频" : currentType === "audio" ? "语音" : "图片",
      createdAt: formatDateTime(new Date()),
      elapsed: "—",
      credits: 0,
      ratio,
      resolution,
      duration: currentType === "video" ? `${duration} 秒` : "—",
      media: { type: currentType, src: "" },
      creations: [],
      reuse: {
        category: currentType,
        modelId: currentModel?.id != null && !Number.isNaN(Number(currentModel.id)) ? Number(currentModel.id) : null,
        mode: currentType === "video" ? (videoMode === "frames" ? "i2v" : "r2v") : currentType === "image" ? (referenceImages.length ? "i2i" : "t2i") : "t2a",
        framesMode: currentType === "video" && videoMode === "frames",
        ratio,
        resolution,
        quality,
        durationSec: currentType === "video" ? duration : null,
        copies: activeCopies,
        voiceId: currentType === "audio" ? voiceId : "",
        speed: currentType === "audio" ? speed : null,
        audioFormat: currentType === "audio" ? audioFormat : "",
        references: uploadedReferences ?? referenceImages,
        frames: uploadedFrames ?? { firstFrame, lastFrame },
      },
    });
    try {
      if (!currentModel?.id || Number.isNaN(Number(currentModel.id))) {
        throw new Error("暂无可用模型，请先在管理后台添加 Mock 或启用模型");
      }
      if (!sessionId) {
        const created = await createSession({ title: text.slice(0, 12) || displayText.slice(0, 12) || "未命名创作", category: currentType });
        sessionId = created.id;
        setActiveSessionId(created.id);
        onRequestCollapseSidebar?.();
        setSessions((items) => [{
          id: created.id,
          title: created.title,
          generationType: currentType,
          updated: "刚刚",
          messages: [{ type: "user", text: displayText }, pendingMessage],
        }, ...items.filter((item) => item.id !== DEFAULT_SESSION_ID)]);
      } else {
        updateSessionMessages(sessionId, (items) => [...items, { type: "user", text: displayText }, pendingMessage], {
          category: currentType,
          titleSource: text || displayText,
        });
      }
      beginGenerating(sessionId);
      const useFrames = currentType === "video" && videoMode === "frames" && supportsFrames;
      if (useFrames && !firstFrame) {
        throw new Error("首尾帧模式请先添加首帧");
      }
      if (!useFrames && referenceImages.length && !supportsLibrary) {
        throw new Error(currentType === "image" ? "当前模型不支持参考图，请移除参考素材后再创作" : "当前模型不支持参考生视频，请移除参考素材后再创作");
      }
      const references = useFrames || !supportsLibrary ? [] : await Promise.all(referenceImages.map((item) => materialToAsset(item)));
      const frames = useFrames ? {
        firstFrameKey: firstFrame ? (await materialToAsset(firstFrame)).storageKey : undefined,
        lastFrameKey: lastFrame ? (await materialToAsset(lastFrame)).storageKey : undefined,
      } : undefined;
      uploadedReferences = references;
      uploadedFrames = useFrames ? { firstFrame, lastFrame } : { firstFrame: null, lastFrame: null };
      if (!useFrames) setReferenceImages(references);
      // 参考视频秒数：仅在服务端探测不到素材时长时兜底（服务端取较大值，前端报多报少都不会让我们亏本）
      const referenceSeconds = currentType === "video" && !useFrames
        ? await sumReferenceVideoSeconds(references)
        : 0;
      const submitted = await submitGenerate({
        modelId: Number(currentModel.id),
        sessionId,
        prompt: displayText,
        category: currentType,
        ratio,
        resolution,
        quality,
        durationSec: currentType === "video" ? clampDurationForModel(currentModel, duration) : undefined,
        referenceVideoSeconds: referenceSeconds || undefined,
        voiceId: currentType === "audio" ? voiceId : undefined,
        speed: currentType === "audio" ? speed : undefined,
        audioFormat: currentType === "audio" ? audioFormat : undefined,
        copies: activeCopies,
        references: useFrames ? undefined : references.map((item) => ({
          type: item.type,
          storageKey: item.storageKey,
          assetId: item.id != null && !Number.isNaN(Number(item.id)) ? Number(item.id) : undefined,
        })),
        frames,
      });
      watchingTasksRef.current.add(submitted.id);
      submittedId = submitted.id;
      onConsumeCredits(submitted.creditCost || 0, { model: currentModel.name, type: currentType });
      const finished = await pollGenerateTask(submitted.id, {
        interval: 2000,
        timeout: currentType === "video" ? VIDEO_POLL_TIMEOUT_MS : IMAGE_POLL_TIMEOUT_MS,
      });
      watchingTasksRef.current.delete(submitted.id);
      const result = finished.status === "FAILED"
        ? failResult(friendlyGenerateError(finished.errorMessage, currentModel))
        : taskToResultMessage(finished);
      updateSessionMessages(sessionId, (items) => replacePendingMessage(items, pendingKey, result));
      onConsumeCredits(0, { model: currentModel.name, type: currentType, refresh: true });
    } catch (error) {
      if (error?.stillGoing && sessionId) {
        keepBusy = true;
        if (submittedId) watchingTasksRef.current.delete(submittedId);
        const detail = await fetchSession(sessionId).catch(() => null);
        if (detail) applySessionDetail(detail);
        return;
      }
      if (sameId(activeSessionIdRef.current, sessionId)) {
        setSubmitError(error.message || "提交失败");
        if (/积分不足/.test(String(error?.message || ""))) {
          setInsufficientCredits(true);
        }
      }
      if (sessionId) {
        updateSessionMessages(sessionId, (items) => replacePendingMessage(items, pendingKey, failResult(error.message || "提交失败")));
      }
    } finally {
      if (!keepBusy) {
        if (submittedId) watchingTasksRef.current.delete(submittedId);
        endGenerating(sessionId);
      }
    }
  }

  async function saveResult(creationId) {
    setSavingId(creationId);
    setSubmitError("");
    try {
      await saveCreationToAsset(creationId);
      setSavedCreationIds((ids) => (ids.includes(creationId) ? ids : [...ids, creationId]));
      setSaveSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (error) {
      setSubmitError(error.message || "保存失败");
    } finally {
      setSavingId(null);
    }
  }

  function toReuseMaterial(item) {
    if (!item || !(item.url || item.storageKey)) return null;
    return {
      ...item,
      url: item.url || mediaUrl(item.storageKey),
      poster: item.poster || "",
    };
  }

  /**
   * 复用参数：把历史任务的模型、比例、分辨率、时长、画质、副本、参考图/首尾帧与音色参数
   * 全量回填到当前输入区；非法值由既有的模型约束 useEffect 自动校正（时长/分辨率钳制）。
   */
  function applyReusePayload(reuse) {
    if (!reuse) return;
    const category = ["video", "image", "audio"].includes(reuse.category) ? reuse.category : generationType;
    setGenerationType(category);
    if (reuse.modelId != null) setModel(String(reuse.modelId));
    const framesMode = category === "video" && Boolean(reuse.framesMode);
    if (category === "video") setVideoMode(framesMode ? "frames" : "reference");
    if (reuse.ratio) setRatio(reuse.ratio);
    if (reuse.resolution) setResolution(reuse.resolution);
    if (reuse.quality) setQuality(reuse.quality);
    if (reuse.durationSec) setDuration(reuse.durationSec);
    if (reuse.copies) setCopies(Math.min(maxCopies, Math.max(1, reuse.copies)));
    if (category === "audio") {
      if (reuse.voiceId) setVoiceId(reuse.voiceId);
      if (reuse.speed) setSpeed(reuse.speed);
      if (reuse.audioFormat) setAudioFormat(reuse.audioFormat);
    }
    if (framesMode) {
      setReferenceImages([]);
      setFirstFrame(toReuseMaterial(reuse.frames?.firstFrame));
      setLastFrame(toReuseMaterial(reuse.frames?.lastFrame));
    } else {
      setFirstFrame(null);
      setLastFrame(null);
      setReferenceImages((reuse.references || []).map(toReuseMaterial).filter(Boolean));
    }
  }

  function reuseResult(message, action) {
    const raw = promptForResult(activeSession.messages, message);
    setPrompt(promptForDisplay(raw) || raw || "");
    applyReusePayload(message.reuse);
    if (action === "regenerate") {
      regenerateRef.current = true;
      setRegenerateTick((tick) => tick + 1);
      return;
    }
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function beginRenameSession(session) {
    setSessionMenuId(null);
    setEditingSessionId(session.id);
  }

  async function commitRenameSession(session, nextTitle) {
    const title = String(nextTitle || "").trim().slice(0, 30) || "未命名创作";
    const previous = session.title;
    setSessions((items) => items.map((item) => item.id === session.id ? { ...item, title } : item));
    setEditingSessionId(null);
    if (!persistedSessionId(session.id) || title === previous) return;
    try {
      const updated = await renameSession(session.id, title);
      const saved = updated?.title || title;
      setSessions((items) => items.map((item) => item.id === session.id ? { ...item, title: saved } : item));
    } catch (error) {
      setSessions((items) => items.map((item) => item.id === session.id ? { ...item, title: previous } : item));
      setSubmitError(error.message || "重命名失败");
    }
  }

  function promptPlaceholder() {
    if (generationType === "video") {
      return videoMode === "frames"
        ? "可选：描述镜头运动与画面变化。不填则根据首帧自动生成。"
        : "描述您想要生成的视频内容，例如，「一个孩子在公园里放风筝，金色阳光，镜头上移。」";
    }
    if (generationType === "audio") {
      return "输入需要朗读的文本，例如，「欢迎使用同道智能语音创作平台。」";
    }
    return "描述您想生成的图片，例如，「夕阳映照在海面上，鲜艳的色彩与汹涌的波涛交相辉映。」";
  }

  function configLabel() {
    if (generationType === "video") return `${resolution} · ${duration}s · ${ratio}`;
    if (generationType === "audio") {
      const voiceName = voiceLabel(voices.find((voice) => voiceIdOf(voice) === voiceId) || voiceId);
      return `${voiceName} · ${speed.toFixed(2)}x · ${audioFormat.toUpperCase()}`;
    }
    return `${resolution} · ${quality} · ${ratio}`;
  }

  function refArt(ref) {
    if (!ref) return "none";
    const url = mediaUrl(ref.poster || ref.url);
    if (!url) return "none";
    return `url("${url}")`;
  }

  function inspirationArt(preset, index) {
    if (preset.video) return `url("${preset.poster || preset.video}")`;
    if (preset.image) return `url("${preset.image}")`;
    if (preset.frames?.length) return `url("${mediaUrl(preset.frames[0].url)}")`;
    // 语音模式的封面由 .inspiration-card.is-audio 自身的渐变 + WorkWaveform 接管，这里返回 null
    if (generationType === "audio") return null;
    return `url("/media/quick-create/image-product.jpg")`;
  }

  const presets = creationPresets[generationType] || [];
  const paramButtonIcon = generationType === "audio" ? <AudioLines size={14} /> : <Maximize2 size={14} />;

  function renderCreationTypeSwitch() {
    return (
      <div className="creation-type-switch" role="group" aria-label="创作类型">
        <button type="button" className={`creation-type-button ${generationType === "video" ? "active" : ""}`} aria-pressed={generationType === "video"} onClick={() => changeType("video")}>
          <WorksTypeIcon type="video" /><span>视频</span>
        </button>
        <button type="button" className={`creation-type-button ${generationType === "image" ? "active" : ""}`} aria-pressed={generationType === "image"} onClick={() => changeType("image")}>
          <WorksTypeIcon type="image" /><span>图片</span>
        </button>
        <button type="button" className={`creation-type-button ${generationType === "audio" ? "active" : ""}`} aria-pressed={generationType === "audio"} onClick={() => changeType("audio")}>
          <WorksTypeIcon type="audio" /><span>语音</span>
        </button>
      </div>
    );
  }

  function renderCreationPanel() {
    return (
      <>
        <input ref={referenceInputRef} aria-label="上传参考素材" className="visually-hidden" type="file"
          accept={generationType === "video" && !imageOnlyRefs(selectedModel) ? `image/*,video/*${supportsAudioReference ? ",audio/*,.mp3,.wav,.m4a,.aac" : ""}` : "image/*"}
          multiple
          disabled={!supportsLibrary || sessionGenerating}
          onChange={(event) => { addReferenceImages(event.target.files); event.target.value = ""; }} />
        <input ref={firstFrameInputRef} aria-label="上传视频首帧" className="visually-hidden" type="file" accept="image/*"
          disabled={!supportsFrames || sessionGenerating}
          onChange={(event) => { setFrame(event.target.files?.[0], setFirstFrame); event.target.value = ""; }} />
        <input ref={lastFrameInputRef} aria-label="上传视频尾帧" className="visually-hidden" type="file" accept="image/*"
          disabled={!supportsFrames || sessionGenerating}
          onChange={(event) => { setFrame(event.target.files?.[0], setLastFrame); event.target.value = ""; }} />

        {!hasConversationHistory && renderCreationTypeSwitch()}

        <div className="quick-creation-shell">
          <div className="quick-reference-toolbar">
            {generationType === "video" && videoMode === "frames" ? (
              <>
                {firstFrame && (
                  <div className="quick-reference is-frame-first" style={{ "--reference-art": refArt(firstFrame) }}>
                    <span>{firstFrame.name || "首帧"}</span>
                    <button type="button" aria-label="移除首帧" onClick={() => setFirstFrame(null)}>×</button>
                  </div>
                )}
                {!firstFrame && (
                  <button type="button" className="quick-frame-slot" onClick={() => firstFrameInputRef.current?.click()}>
                    <span aria-hidden="true">＋</span><strong>首帧</strong><small>起始画面</small>
                  </button>
                )}
                <span className="quick-frame-link" aria-hidden="true">⇌</span>
                {lastFrame && (
                  <div className="quick-reference is-frame-last" style={{ "--reference-art": refArt(lastFrame) }}>
                    <span>{lastFrame.name || "尾帧"}</span>
                    <button type="button" aria-label="移除尾帧" onClick={() => setLastFrame(null)}>×</button>
                  </div>
                )}
                {!lastFrame && (
                  <button type="button" className="quick-frame-slot" onClick={() => lastFrameInputRef.current?.click()}>
                    <span aria-hidden="true">＋</span><strong>尾帧</strong><small>结束画面</small>
                  </button>
                )}
              </>
            ) : supportsLibrary ? (
              <>
                {referenceImages.length < MAX_REFERENCE_ASSETS && (
                  <button type="button" className="quick-add-reference" onClick={() => referenceInputRef.current?.click()}>
                    <span aria-hidden="true">＋</span>
                    <strong>参考素材</strong>
                    <small>支持多选</small>
                  </button>
                )}
                {referenceImages.length > 0 && (
                  <div className="quick-reference-list">
                    {referenceImages.map((ref, index) => (
                      <div key={ref.storageKey || ref.id || `${ref.url}-${index}`} className="quick-reference" style={{ "--reference-art": refArt(ref) }}>
                        <span>{ref.type === "video" ? "视频" : ref.type === "audio" ? "音频" : "图片"}</span>
                        <button type="button" aria-label={`删除参考素材 ${ref.name || `参考 ${index + 1}`}`} onClick={() => setReferenceImages((items) => items.filter((_, idx) => idx !== index))}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </div>

          <section className="quick-creation-panel" aria-label="创作输入">
            <div className="quick-ambient" aria-hidden="true">
              <i className="quick-glow quick-glow-blue" />
              <i className="quick-glow quick-glow-violet" />
              <i className="quick-glow quick-glow-pink" />
              <i className="quick-glow quick-glow-white" />
            </div>
            <div className={`quick-panel-head${hasConversationHistory ? " has-type-switch" : ""}`}>
              {hasConversationHistory && renderCreationTypeSwitch()}
              {/*<span className="quick-draft-status">内容自动保存</span>*/}
            </div>

        <div className="quick-prompt-wrap">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendPrompt(); } }}
            placeholder={promptPlaceholder()}
            maxLength={4096}
          />
          <div className="quick-prompt-meta">
            <div className="quick-prompt-actions">
              <button type="button" aria-label="引用素材" disabled={!supportsLibrary || sessionGenerating} onClick={openAssetPicker}>@</button>
              <button type="button" aria-label="重置输入" onClick={resetComposer}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 4v6h6"/><path d="M5.5 15a8 8 0 1 0 1-8L4 10"/></svg>
              </button>
            </div>
            <span className={prompt.length >= 3800 ? "is-warning" : ""}>{prompt.length} / 4096</span>
          </div>
        </div>
        {submitError && (
          <p className="create-submit-error">
            {submitError}
            {insufficientCredits && onNeedRecharge && (
              <button type="button" className="creation-recharge-link" onClick={() => { setSubmitError(""); setInsufficientCredits(false); onNeedRecharge(); }}>去充值</button>
            )}
          </p>
        )}
        {!selectedModel && <p className="create-submit-error">{modelCatalogMessage({ loading: modelCatalogLoading, error: modelCatalogError, category: generationType })}</p>}

        <div className="quick-config-row">
          <div className="quick-config-group">
            <div className={`custom-select quick-select ${dropup ? "dropup" : ""} ${openPanel === "model" ? "open" : ""}`}>
              <button
                type="button"
                className="select-trigger"
                aria-haspopup="listbox"
                aria-expanded={openPanel === "model"}
                aria-label="选择模型"
                disabled={!availableModels.length}
                onClick={(event) => togglePanel("model", event)}
              >
                {selectedModel?.logo ? (
                  <img src={selectedModel.logo} alt="" style={{ width: 15, height: 15, borderRadius: 3 }} />
                ) : (
                  <Box size={15} />
                )}
                <span className="select-value">{selectedModel?.name || "选择模型"}</span>
                <svg className="select-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="m6 8 4 4 4-4" />
                </svg>
              </button>
              {openPanel === "model" && (
                <div className="select-menu quick-model-menu" role="listbox" aria-label="可用模型">
                  {availableModels.map((item) => {
                    const selected = String(item.id) === String(selectedModel?.id);
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`select-option ${selected ? "selected" : ""}`}
                        key={item.id}
                        onClick={() => {
                          setModel(String(item.id));
                          setCopies(1);
                          setOpenPanel(null);
                          setAssetPickerOpen(false);
                        }}
                      >
                        <span>{item.name}</span>
                        {selected && (
                          <svg className="quick-option-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                            <path d="m5 10 3 3 7-7" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {showVideoModes && (
              <div className={`custom-select quick-select quick-mode-select ${dropup ? "dropup" : ""} ${openPanel === "mode" ? "open" : ""}`}>
                <button
                  type="button"
                  className="select-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={openPanel === "mode"}
                  onClick={(event) => togglePanel("mode", event)}
                >
                  <span className="quick-control-symbol">◇</span>
                  <span className="select-value">{videoMode === "reference" ? "参考生成" : "首/尾帧"}</span>
                  <svg className="select-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="m6 8 4 4 4-4" />
                  </svg>
                </button>
                {openPanel === "mode" && (
                  <div className="select-menu quick-mode-menu" role="listbox" aria-label="生成模式">
                    <button
                      type="button"
                      role="option"
                      aria-selected={videoMode === "reference"}
                      className={`select-option quick-mode-option ${videoMode === "reference" ? "selected" : ""}`}
                      onClick={() => {
                        setVideoMode("reference");
                        setFirstFrame(null);
                        setLastFrame(null);
                        setOpenPanel(null);
                      }}
                    >
                      <span className="quick-mode-copy">
                        <strong>参考生成</strong>
                        <small>{imageOnlyRefs(selectedModel) ? "可用图片作为参考（不支持参考视频）" : "可用图片或视频作为参考"}</small>
                      </span>
                      {videoMode === "reference" && (
                        <svg className="quick-option-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="m5 10 3 3 7-7" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      role="option"
                      aria-selected={videoMode === "frames"}
                      className={`select-option quick-mode-option ${videoMode === "frames" ? "selected" : ""}`}
                      disabled={!supportsFrames}
                      onClick={() => {
                        if (!supportsFrames) return;
                        setVideoMode("frames");
                        setReferenceImages([]);
                        setOpenPanel(null);
                      }}
                    >
                      <span className="quick-mode-copy">
                        <strong>首/尾帧</strong>
                        <small>{supportsFrames ? "控制视频起始与结束画面" : "当前模型不支持首尾帧"}</small>
                      </span>
                      {videoMode === "frames" && (
                        <svg className="quick-option-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="m5 10 3 3 7-7" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className={`custom-select quick-select quick-params-select ${generationType === "audio" ? "quick-audio-select" : ""} ${dropup ? "dropup" : ""} ${openPanel === "params" ? "open" : ""}`}>
              <button
                type="button"
                className="select-trigger"
                aria-haspopup="dialog"
                aria-expanded={openPanel === "params"}
                onClick={(event) => togglePanel("params", event)}
              >
                {generationType === "audio" && <AudioLines size={15} />}
                <span className="select-value">{configLabel()}</span>
                <svg className="select-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="m6 8 4 4 4-4" />
                </svg>
              </button>
              {openPanel === "params" && generationType !== "audio" && (
                <div className="select-menu quick-parameter-menu" role="dialog" aria-label="参数设置">
                  <section>
                    <h3>比例</h3>
                    <div className="quick-ratio-grid">
                      {(generationType === "video" ? videoRatios : imageRatios).map((r) => {
                        const selected = ratio === r;
                        return (
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`quick-param-option ${selected ? "selected" : ""}`}
                            key={r}
                            onClick={() => setRatio(r)}
                          >
                            <span className="quick-ratio-icon" />
                            <span>{r}</span>
                            {selected && (
                              <svg className="quick-option-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                <path d="m5 10 3 3 7-7" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section>
                    <h3>分辨率</h3>
                    <div className="quick-resolution-grid">
                      {resolutionOptionsFor(selectedModel, generationType).map((res) => {
                        const selected = resolution === res;
                        return (
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`quick-param-option ${selected ? "selected" : ""}`}
                            key={res}
                            onClick={() => setResolution(res)}
                          >
                            <span>{res}</span>
                            {selected && (
                              <svg className="quick-option-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                <path d="m5 10 3 3 7-7" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section>
                    <h3>{generationType === "video" ? "时长" : "画质"}</h3>
                    <div className="quick-duration-grid">
                      {(generationType === "video" ? durationOptionsFor(selectedModel) : qualityLevels).map((opt) => {
                        const selected = generationType === "video" ? duration === opt : quality === opt;
                        return (
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`quick-param-option ${selected ? "selected" : ""}`}
                            key={String(opt)}
                            onClick={() => (generationType === "video" ? setDuration(opt) : setQuality(opt))}
                          >
                            <span>{generationType === "video" ? `${opt}s` : opt}</span>
                            {selected && (
                              <svg className="quick-option-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                <path d="m5 10 3 3 7-7" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </div>
              )}
              {openPanel === "params" && generationType === "audio" && (
                <QuickAudioPopover
                  voices={voices}
                  formats={audioFormats}
                  voiceId={voiceId}
                  setVoiceId={setVoiceId}
                  audioFormat={audioFormat}
                  setAudioFormat={setAudioFormat}
                  speed={speed}
                  setSpeed={setSpeed}
                  minSpeed={minSpeed}
                  maxSpeed={maxSpeed}
                />
              )}
            </div>
          </div>

          <div className="quick-submit-group">
            <div className="quick-quantity" title={maxCopies === 1 ? "当前模型每次生成 1 个" : `当前模型最多生成 ${maxCopies} 个`}>
              <button type="button" disabled={activeCopies <= 1} onClick={() => setCopies(activeCopies - 1)} aria-label="减少生成数量">−</button>
              <span>生成 {activeCopies} 个</span>
              <button type="button" disabled={activeCopies >= maxCopies} onClick={() => setCopies(activeCopies + 1)} aria-label="增加生成数量">＋</button>
            </div>
            <span className={`quick-points ${creditShortage ? "is-insufficient" : ""}`} title={selectedModel ? "根据模型售价、参数与副本数计算" : "暂无可用模型"}>
              ✦ {selectedModel ? `${creditCost} 积分` : "--"}
            </span>
            {creditShortage && onNeedRecharge && (
              <button type="button" className="creation-recharge-link" onClick={onNeedRecharge}>积分不足 · 去充值</button>
            )}
            <button type="button" className="quick-create-button" aria-label="开始创作" onClick={sendPrompt} disabled={!canSubmit}>
              <Sparkles size={15} />
              {sessionGenerating ? "生成中" : "创作"}
            </button>
          </div>
        </div>
      </section>
        </div>
      </>
    );
  }

  return (
    <div className={`creator-page ${showConversationRail ? "has-conversations" : "no-conversations"}`}>
      {showConversationRail && (
        <aside className="conversation-rail" aria-label="创作会话">
        <button className="new-button" type="button" onClick={createSessionLocal}>
          <span aria-hidden="true">＋</span>
          <span>新建创作</span>
        </button>
        <div className="rail-label">
          <span>会话历史</span>
          <span>{conversationSessions.length}</span>
        </div>
        <div className="conversation-list">
          {sessions.map((session) => {
            const editing = editingSessionId === session.id;
            const active = session.id === activeSessionId;
            const menuOpen = sessionMenuId === session.id;
            const busy = isSessionGenerating(session, generatingSessionIds);
            return (
              <article
                key={session.id}
                className={`conversation ${active ? "active" : ""} ${editing ? "is-editing" : ""} ${menuOpen ? "menu-open" : ""} ${busy ? "is-busy" : ""}`}
                tabIndex={0} role="button"
                aria-current={active ? "true" : "false"}
                onClick={() => { setSessionMenuId(null); switchSession(session); }}
              >
                <span className="conversation-type" aria-hidden="true"><WorksTypeIcon type={session.generationType} /></span>
                <span className="conversation-copy">
                  {editing
                    ? <input className="conversation-name-input" autoFocus maxLength={30} defaultValue={session.title}
                        onBlur={(event) => commitRenameSession(session, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") { event.currentTarget.blur(); setEditingSessionId(null); }
                        }} />
                    : <strong title={session.title}>{session.title}</strong>}
                  <time>{busy ? "生成中…" : session.updated}</time>
                </span>
                <button className="conversation-more" type="button"
                  aria-label={`${session.title} 的更多操作`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={(event) => { event.stopPropagation(); setSessionMenuId(menuOpen ? null : session.id); }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
                </button>
                {menuOpen && (
                  <div className="quick-session-menu" role="menu" ref={sessionMenuRef} onClick={(event) => event.stopPropagation()}>
                    <button type="button" role="menuitem" onClick={() => beginRenameSession(session)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 20 4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.8 7.5 3 3"/></svg>
                      <span>重命名</span>
                    </button>
                    <button type="button" role="menuitem" className="danger" onClick={() => { setSessionMenuId(null); requestDeleteSession(session); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg>
                      <span>删除会话</span>
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </aside>
      )}
      <section className={`creator-workspace ${activeSession.messages.length ? "has-history" : ""}`}>
        {!showConversationRail && (
          <div className="workspace-new-action">
            <button className="new-button" type="button" onClick={createSessionLocal}>
              <span aria-hidden="true">＋</span>
              <span>新建创作</span>
            </button>
          </div>
        )}
        <div className={`quick-content ${activeSession.messages.length ? "has-history" : ""}`}>
          {activeSession.messages.length > 0 && (
            <section ref={conversationRef} className="quick-conversation" aria-label="会话消息">
              <div className="quick-message-list">
                {activeSession.messages.map((message, index) => message.type === "user"
                  ? <div className="quick-message quick-message--user" key={`${activeSession.id}-${index}`}>
                      <span className="quick-message__avatar">你</span>
                      <div className="quick-message__bubble"><p>{message.text}</p></div>
                    </div>
                  : <ResultMessage
                      key={`${activeSession.id}-${index}`}
                      message={message}
                      onReuse={reuseResult}
                      onSave={saveResult}
                      savedIds={savedCreationIds}
                      savingId={savingId}
                    />)}
                {sessionGenerating && !activeSession.messages.some((item) => item.pending) && (
                  <div className="quick-message quick-message--result">
                    <span className="quick-message__avatar"><Sparkles size={16} /></span>
                    <div className="quick-message__body">
                      <div className="quick-generating-line"><i /><i /><i /> {generationType === "audio" ? "正在合成语音…" : "正在构思画面与光线…"}</div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {!activeSession.messages.length && (
            <header className="quick-heading">
              <h1>今天想创作什么？</h1>
              <p>输入创意描述，或选择下方灵感场景快速开始创作</p>
            </header>
          )}

          {renderCreationPanel()}

          {!activeSession.messages.length && (
            <section className="quick-inspiration">
              <div className="quick-section-head">
                <div>
                  <h2>灵感场景</h2>
                  <p>选择一个灵感场景，素材与提示词将自动带入输入框</p>
                </div>
              </div>
              <div className="inspiration-grid">
                {presets.map((preset, index) => {
                  const isAudio = generationType === "audio";
                  const art = isAudio ? undefined : inspirationArt(preset, index);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`inspiration-card${isAudio ? " is-audio" : ""}`}
                      style={art ? { "--art": art } : undefined}
                      onClick={() => applyPreset(preset)}
                    >
                      {isAudio && <span className="inspiration-waveform"><WorkWaveform /></span>}
                      <span className="inspiration-apply">应用场景</span>
                      <span className="card-copy"><strong>{preset.title}</strong><span>{preset.description}</span></span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </section>
      {assetPickerOpen && supportsLibrary && (
        <AssetPickerDialog
          title={generationType === "video" && videoMode === "frames" ? "选择首尾帧图片" : "选择引用素材"}
          hint={generationType === "video" && videoMode === "frames" ? "第 1 张为首帧，第 2 张为尾帧" : undefined}
          emptyText={generationType === "video" && videoMode === "frames" ? "暂无可用图片素材" : "暂无可用素材"}
          assets={libraryAssets
            .filter((item) => {
              if (generationType === "video" && videoMode === "frames") return isImageMaterial(item);
              if (generationType === "video") return item.type !== "audio" && item.kind !== "audio";
              return item.type !== "video" && item.kind !== "video" && item.type !== "audio" && item.kind !== "audio";
            })
            .map((item) => toReferenceMaterial(item))}
          selectedItems={pendingAssets}
          loading={libraryLoading}
          error={libraryError}
          maxSelection={generationType === "video" && videoMode === "frames" ? 2 : MAX_REFERENCE_ASSETS}
          onToggle={togglePendingAsset}
          onClose={() => setAssetPickerOpen(false)}
          onConfirm={() => {
            if (!supportsLibrary) {
              setAssetPickerOpen(false);
              return;
            }
            if (generationType === "video" && videoMode === "frames") {
              const images = pendingAssets.filter((item) => item.url && isImageMaterial(item));
              if (!images.length) {
                setSubmitError("请选择图片素材作为首帧或尾帧");
                return;
              }
              setFirstFrame(images[0] || null);
              setLastFrame(images[1] || null);
              setSubmitError(images.length > 2 ? "首尾帧最多两张图片，已使用前两张" : "");
              setAssetPickerOpen(false);
              return;
            }
            setReferenceImages(pendingAssets.filter((item) => item.url));
            setAssetPickerOpen(false);
          }}
        />
      )}
      {saveSuccess && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSaveSuccess(false); }}>
          <section className="save-success-dialog" role="dialog" aria-modal="true" aria-labelledby="save-success-title">
            <span className="save-success-dialog__icon"><CheckCircle2 size={28} /></span>
            <h2 id="save-success-title">保存成功</h2>
            <p>作品已加入素材库，可在创作时通过 @ 引用，或前往素材库查看。</p>
            <div className="save-success-dialog__actions">
              <button type="button" onClick={() => setSaveSuccess(false)}>继续创作</button>
              <button type="button" className="primary" onClick={() => { setSaveSuccess(false); onOpenAssets?.(); }}>前往素材库</button>
            </div>
          </section>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteSessionTarget)}
        eyebrow="快速创作"
        title="删除会话？"
        message={deleteSessionTarget
          ? `确定删除会话「${deleteSessionTarget.title || "未命名创作"}」吗？侧栏对话记录会消失，已生成的作品仍保留在「我的创作」中。`
          : ""}
        confirmLabel="删除"
        onClose={() => setDeleteSessionTarget(null)}
        onConfirm={() => { confirmDeleteSession().catch(() => {}); }}
      />
    </div>
  );
}
