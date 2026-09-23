import { ArrowLeftRight, AtSign, AudioLines, Box, Check, CheckCircle2, ChevronDown, Coins, Download, Film, Image, Images, Layers3, Maximize2, MoreHorizontal, Pencil, Plus, RectangleHorizontal, RectangleVertical, RefreshCw, RotateCcw, Save, ScanLine, Sparkles, Square, Trash2, Video, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAssets } from "../api/assets.js";
import { createSession, deleteSession, fetchSession, fetchSessions, saveCreationToAsset } from "../api/creations.js";
import { IMAGE_POLL_TIMEOUT_MS, pollGenerateTask, submitGenerate, VIDEO_POLL_TIMEOUT_MS } from "../api/generate.js";
import { friendlyGenerateError, FRAMES_EMPTY_PROMPT_LABEL, materialToAsset, promptForResult, tasksToMessages, taskToResultMessage } from "../lib/createFlow.js";
import { formatDateTime, mediaUrl, storageKeyOf } from "../lib/media.js";
import { ConfirmDialog } from "./ConfirmDialog.jsx";

const videoRatios = ["自动", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const imageRatios = ["21:9", "16:9", "5:4", "4:3", "3:2", "1:1", "2:3", "3:4", "4:5", "9:16"];
const videoDurations = Array.from({ length: 12 }, (_, index) => index + 4);
const miniMaxDurations = Array.from({ length: 12 }, (_, index) => index + 4);
const miniMaxMaxDurations = Array.from({ length: 11 }, (_, index) => index + 5);
const miniMaxComfyDurations = Array.from({ length: 11 }, (_, index) => index + 5);
const agnesDurations = Array.from({ length: 9 }, (_, index) => index + 4);
const videoResolutions = ["480P", "720P", "1080P", "2K", "4K"];
const videoResolutionMultipliers = { "480P": 0.5, "720P": 0.75, "768P": 0.8, "1080P": 1, "2K": 1.5, "4K": 2.5 };
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
  if (isSeedance25(model) || (isSeedance20Official(model) && isSeedanceFast(model))) return ["480P", "720P"];
  if (isSeedance20Official(model)) return ["480P", "720P", "1080P"];
  return videoResolutions;
}
function clampDurationForModel(model, duration) {
  const options = durationOptionsFor(model);
  if (options.includes(duration)) return duration;
  return options.find((item) => item >= duration) || options[options.length - 1] || 5;
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
function sameMaterial(a, b) {
  if (!a || !b) return false;
  if (a.storageKey && b.storageKey) return a.storageKey === b.storageKey;
  if (a.id != null && b.id != null) return String(a.id) === String(b.id);
  const left = a.url || a.src;
  const right = b.url || b.src;
  return Boolean(left && right && left === right);
}
function toReferenceMaterial(asset) {
  const url = mediaUrl(asset.src || asset.url || asset.storageKey);
  const poster = mediaUrl(asset.poster || asset.posterUrl || asset.posterKey) || url;
  return {
    id: asset.id,
    name: asset.title || asset.name,
    url,
    poster,
    type: asset.type === "audio" || asset.kind === "audio" ? "audio" : asset.type === "video" || asset.kind === "video" ? "video" : "image",
    storageKey: asset.storageKey || storageKeyOf(asset.src || asset.url) || storageKeyOf(url),
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

function CosmicBackdrop({ active }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPlayback = () => {
      const video = videoRef.current;
      if (!video) return;
      if (!active || reducedMotion.matches) video.pause();
      else video.play().catch(() => {});
    };
    syncPlayback();
    reducedMotion.addEventListener("change", syncPlayback);
    return () => reducedMotion.removeEventListener("change", syncPlayback);
  }, [active]);

  return <div className="fast-cosmic-backdrop" aria-hidden="true">
    <video ref={videoRef} muted loop playsInline preload="metadata" poster="/media/quick-create/cosmic-flight-poster.jpg" tabIndex={-1}>
      <source media="(max-width: 720px)" src="/media/quick-create/cosmic-nebula-mobile.mp4" type="video/mp4" />
      <source src="/media/quick-create/cosmic-flight-bg.mp4" type="video/mp4" />
    </video>
    <span className="fast-cosmic-backdrop__beam" />
    <span className="fast-cosmic-backdrop__veil" />
  </div>;
}

function GravityDots() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    const pointer = { x: -1000, y: -1000, active: false };
    let frame = 0;
    let width = 0;
    let height = 0;
    let density = 1;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      density = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * density));
      canvas.height = Math.max(1, Math.floor(height * density));
      context.setTransform(density, 0, 0, density, 0, 0);
    };
    const move = (event) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
      pointer.active = pointer.x >= 0 && pointer.x <= width && pointer.y >= 0 && pointer.y <= height;
    };
    const leave = () => { pointer.active = false; };
    const draw = (time) => {
      context.clearRect(0, 0, width, height);
      const spacing = 24;
      const radius = 290;
      for (let y = 12; y < height; y += spacing) {
        for (let x = 12; x < width; x += spacing) {
          let drawX = x;
          let drawY = y;
          let alpha = 0.22;
          if (pointer.active) {
            const dx = pointer.x - x;
            const dy = pointer.y - y;
            const distance = Math.hypot(dx, dy);
            if (distance < radius && distance > 0) {
              const envelope = Math.pow(1 - distance / radius, 1.6);
              const ripple = Math.sin(distance * 0.055 - time * 0.00145) * envelope * 8;
              drawX -= (dx / distance) * ripple;
              drawY -= (dy / distance) * ripple;
              alpha = 0.22 + envelope * 0.2;
            }
          }
          context.beginPath();
          context.arc(drawX, drawY, 1.05, 0, Math.PI * 2);
          context.fillStyle = `rgba(92, 102, 123, ${alpha})`;
          context.fill();
        }
      }
      frame = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerleave", leave);
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <canvas ref={canvasRef} className="create-gravity-dots" aria-hidden="true" />;
}

function makeInitialSession() {
  return {
    id: DEFAULT_SESSION_ID,
    title: "新建创作",
    generationType: "video",
    updated: "刚刚",
    messages: [],
  };
}

function ResultMessage({ message, onReuse, onSave, savedIds = [], savingId }) {
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
  if (message.pending) {
    return (
      <div className="message message--result">
        <span><Sparkles size={16} /></span>
        <div className="generating-line"><i /><i /><i /> {message.text}</div>
      </div>
    );
  }
  return (
    <div className="message message--result">
      <span><Sparkles size={16} /></span>
      <div className="result-content">
        <p>{message.text}</p>
        {saved && <div className="result-save-banner"><Check size={14} /> 已保存到素材库</div>}
        {items.length > 0 && (
          <div className="result-media-wrap">
            {items.map((media) => media.type === "video"
              ? <video key={media.id || media.src} src={media.src} poster={media.poster} controls playsInline><track kind="captions" src="/media/demo-captions.vtt" srcLang="zh" label="中文" /></video>
              : media.type === "audio"
                ? <div className="creation-audio-result" key={media.id || media.src}><span><AudioLines size={24} /></span><div><small>语音作品</small><strong>{media.title || "语音作品"}</strong><audio src={media.src} controls preload="metadata" /></div></div>
                : <img key={media.id || media.src} src={media.src} alt={media.title || ""} />)}
            {message.creationType !== "语音" && <span className="media-spec-badge">{message.ratio} · {message.resolution}{message.creationType === "视频" ? ` · ${message.duration}` : ""}</span>}
          </div>
        )}
        <div className="result-meta-grid">
          <span><small>模型</small><strong>{message.model}</strong></span>
          <span><small>类型</small><strong>{message.creationType}</strong></span>
          <span><small>创建时间</small><strong>{message.createdAt}</strong></span>
          <span><small>耗时</small><strong>{message.elapsed}</strong></span>
          <span><small>积分消耗</small><strong>{message.credits} 积分</strong></span>
        </div>
        <div className="result-actions">
          <button type="button" onClick={() => onReuse(message, "edit")}><Pencil size={13} /> 重新编辑</button>
          <button type="button" onClick={() => onReuse(message, "regenerate")}><RefreshCw size={13} /> 再次生成</button>
          {primaryId && (
            <button type="button" className={saved ? "is-saved" : ""} disabled={saved || saving} onClick={() => onSave(primaryId)}>
              <Save size={13} /> {saved ? "已保存" : saving ? "保存中…" : "保存到素材库"}
            </button>
          )}
          {items[0]?.src && <a href={items[0].src} download><Download size={13} /> 下载</a>}
        </div>
      </div>
    </div>
  );
}

function UploadTile({ label, detail, material, onClick, onRemove }) {
  const preview = material ? mediaUrl(material.poster || material.url) : "";
  const isVideo = material?.type === "video";
  const isAudio = material?.type === "audio";
  return (
    <div className={`creation-upload ${material ? "has-preview" : ""}`}>
      <button type="button" onClick={onClick}>
        {material
          ? isAudio
            ? <span className="creation-upload__audio"><AudioLines size={22} /><small>{material.name || "参考音频"}</small></span>
            : isVideo && !material.poster
            ? <video src={mediaUrl(material.url)} muted playsInline preload="metadata" aria-label={`${label}视频预览`} />
            : <img src={preview} alt={`${label}预览`} />
          : <><Plus size={24} /><span>{label}</span><small>{detail}</small></>}
      </button>
      {material && <span className="creation-upload__type">{isAudio ? <AudioLines size={10} /> : isVideo ? <Video size={10} /> : <Image size={10} />}</span>}
      {material && <button className="creation-upload__remove" type="button" aria-label={`移除${label}`} onClick={onRemove}><X size={12} /></button>}
    </div>
  );
}

function SegmentedOptions({ options, value, onChange, formatter = (item) => item }) {
  return <div className="creation-option-grid">{options.map((item) => <button type="button" className={value === item ? "active" : ""} key={item} onClick={() => onChange(item)}>{formatter(item)}{value === item && <Check size={11} />}</button>)}</div>;
}

function RatioOption({ ratio }) {
  const [width = 1, height = 1] = ratio.split(":").map(Number);
  const Icon = ratio === "自动" ? ScanLine : width === height ? Square : width > height ? RectangleHorizontal : RectangleVertical;
  return <span className="ratio-option"><Icon size={12} /><small>{ratio}</small></span>;
}

function ParameterPanel({ generationType, ratio, setRatio, resolution, setResolution, duration, setDuration, quality, setQuality, durationOptions = videoDurations, resolutionOptions }) {
  const resolutions = resolutionOptions || (generationType === "video" ? videoResolutions : ["1K", "2K", "4K"]);
  return <div className={`creation-popover creation-parameter-popover is-${generationType}`}>
    <section><label>比例</label><SegmentedOptions options={generationType === "video" ? videoRatios : imageRatios} value={ratio} onChange={setRatio} formatter={(item) => <RatioOption ratio={item} />} /></section>
    <section><label>分辨率</label><SegmentedOptions options={resolutions} value={resolution} onChange={setResolution} /></section>
    {generationType === "video" ? <section><label>时长</label><SegmentedOptions options={durationOptions} value={duration} onChange={setDuration} formatter={(item) => `${item}s`} /></section> : <section><label>画质</label><SegmentedOptions options={qualityLevels} value={quality} onChange={setQuality} /></section>}
  </div>;
}

function AudioParameterPanel({ voices, formats, voiceId, setVoiceId, audioFormat, setAudioFormat, speed, setSpeed, minSpeed, maxSpeed }) {
  const [voiceKeyword, setVoiceKeyword] = useState("");
  const [voiceLanguageFilter, setVoiceLanguageFilter] = useState("全部");
  const languages = [...new Set(voices.map(voiceLanguage))];
  const normalizedKeyword = voiceKeyword.trim().toLowerCase();
  const visibleVoices = voices.filter((voice) => {
    const matchesLanguage = voiceLanguageFilter === "全部" || voiceLanguage(voice) === voiceLanguageFilter;
    const matchesKeyword = !normalizedKeyword || `${voiceLabel(voice)} ${voiceIdOf(voice)}`.toLowerCase().includes(normalizedKeyword);
    return matchesLanguage && matchesKeyword;
  });
  return <div className="creation-popover creation-parameter-popover is-audio">
    <section className="creation-voice-section"><label><span>音色</span><small>共 {voices.length} 个</small></label><div className="creation-voice-tools"><input value={voiceKeyword} onChange={(event) => setVoiceKeyword(event.target.value)} placeholder="搜索音色名称或 Voice ID" /><select value={voiceLanguageFilter} onChange={(event) => setVoiceLanguageFilter(event.target.value)}><option value="全部">全部语言</option>{languages.map((language) => <option key={language} value={language}>{language}</option>)}</select></div><div className="creation-voice-grid">{visibleVoices.map((voice) => { const id = voiceIdOf(voice); return <button type="button" className={voiceId === id ? "active" : ""} key={id} onClick={() => setVoiceId(id)}><span>{voiceLabel(voice)}</span><small>{voiceLanguage(voice)} · {id}</small>{voiceId === id && <Check size={12} />}</button>; })}</div>{!visibleVoices.length && <div className="creation-voice-empty">没有匹配的音色</div>}</section>
    <section><label>格式</label><SegmentedOptions options={formats} value={audioFormat} onChange={setAudioFormat} formatter={(item) => item.toUpperCase()} /></section>
    <section className="creation-speed-control"><label><span>语速</span><b>{speed.toFixed(2)}x</b></label><input type="range" min={minSpeed} max={maxSpeed} step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /><div><small>{minSpeed}x</small><small>{maxSpeed}x</small></div></section>
  </div>;
}

function CreationPresetCards({ generationType, onSelect }) {
  return <div className="creation-preset-grid">{creationPresets[generationType].map((preset) => (
    <button type="button" className="creation-preset-card" key={preset.id} onClick={() => onSelect(preset)}>
      {generationType === "video" ? (
        <span className="creation-preset-card__media"><video src={preset.video} poster={preset.poster} muted loop autoPlay playsInline preload="metadata" aria-hidden="true" tabIndex={-1} /></span>
      ) : generationType === "audio" ? (
        <span className="creation-preset-card__media"><span className="audio-preview"><AudioLines size={34} /><span /><span /><span /><span /></span></span>
      ) : (
        <span className="creation-preset-card__media is-image">
          <img className="creation-preset-card__backdrop" src={preset.image} alt="" aria-hidden="true" />
          <img className="creation-preset-card__subject" src={preset.image} alt={preset.title} />
        </span>
      )}
      <span className="creation-preset-card__shade" />
      <span className="creation-preset-card__content"><strong>{preset.title}</strong><em>{preset.description}</em></span>
    </button>
  ))}</div>;
}

function AssetPicker({ assets, selectedItems, onToggle, onClose, onConfirm, title = "选择引用素材", hint, emptyText = "暂无可用素材" }) {
  return (
    <div className="creation-asset-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="creation-asset-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title">
        <header>
          <div><small>素材库</small><h2 id="asset-picker-title">{title}</h2></div>
          <button type="button" aria-label="关闭素材选择" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="creation-asset-grid">
          {!assets.length && <p className="creation-asset-empty">{emptyText}</p>}
          {assets.map((asset) => {
            const label = asset.title || asset.name;
            const preview = asset.poster || asset.src || asset.url;
            const selected = selectedItems.some((item) => sameMaterial(item, asset));
            return (
              <button type="button" className={selected ? "selected" : ""} key={asset.id || asset.storageKey || preview} aria-pressed={selected} onClick={() => onToggle(asset)}>
                {asset.type === "audio" ? <AudioLines size={28} /> : <img src={preview} alt={label} />}
                <span><strong>{label}</strong><small>{asset.type === "audio" ? "音频素材" : asset.type === "video" ? "视频素材" : "图片素材"}</small></span>
                {selected && <span className="creation-asset-check" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>}
              </button>
            );
          })}
        </div>
        <footer>
          <span>{hint ? `${hint} · 已选择 ${selectedItems.length} 项` : `已选择 ${selectedItems.length} 项`}</span>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" className="primary" onClick={onConfirm}>引用素材</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

/**
 * 把字符串草稿落到 sessionStorage，切换 tab 后重新挂载能读回。
 *
 * 父容器按 active tab 卸载 FastCreate，{@code useState} 的 prompt 会随卸载丢失，
 * 用户在创作框写一半的字、切到「历史创作」再回来就没了。把 prompt 临时缓存到这里，
 * 切换 tab 不丢，关闭页面后自动清，不会泄露到别的 tab。
 *
 * 用法跟 useState 一致；写入空串会自动清掉缓存，避免重启 tab 时还残留旧草稿。
 */
function useSessionDraft(key, initial = "") {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.sessionStorage.getItem(key);
      return stored !== null && stored !== undefined ? stored : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      if (value) {
        window.sessionStorage.setItem(key, value);
      } else {
        window.sessionStorage.removeItem(key);
      }
    } catch {
      // 隐私模式 / quota / 关闭了 storage 时降级为纯内存，不影响功能
    }
  }, [key, value]);
  return [value, setValue];
}

export function FastCreate({ config, onConsumeCredits = () => {}, theme = "light", onOpenAssets }) {
  const queryClient = useQueryClient();
  const [sessions, setSessions] = useState(() => [makeInitialSession()]);
  const [activeSessionId, setActiveSessionId] = useState(DEFAULT_SESSION_ID);
  const [generationType, setGenerationType] = useState("video");
  const availableModels = useMemo(() => (config.models || []).filter((item) => item.enabled !== false && (item.category === generationType || item.capabilities?.includes(generationType))), [config.models, generationType]);
  const [model, setModel] = useState(() => String(config.models.find((item) => item.enabled !== false && (item.category === "video" || item.capabilities?.includes("video")))?.id || config.models[0]?.id || ""));
  // 创作框内容走 sessionStorage 兜底，tab 切换不丢；其余状态按需再扩。
  const [prompt, setPrompt] = useSessionDraft("fastcreate.composer.prompt", "");
  const [generatingSessionIds, setGeneratingSessionIds] = useState([]);
  const [submitError, setSubmitError] = useState("");
  const [deleteSessionTarget, setDeleteSessionTarget] = useState(null);
  const [savedCreationIds, setSavedCreationIds] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState([]);
  const [videoMode, setVideoMode] = useState("reference");
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720P");
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState("Low");
  const [copies, setCopies] = useState(1);
  const [voiceId, setVoiceId] = useState("alloy");
  const [speed, setSpeed] = useState(1);
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [openPanel, setOpenPanel] = useState(null);
  const [referenceImages, setReferenceImages] = useState([]);
  const [firstFrame, setFirstFrame] = useState(null);
  const [lastFrame, setLastFrame] = useState(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [pendingAssets, setPendingAssets] = useState([]);
  const [sessionMenuId, setSessionMenuId] = useState(null);
  const referenceInputRef = useRef(null);
  const firstFrameInputRef = useRef(null);
  const lastFrameInputRef = useRef(null);
  const generatingSessionRef = useRef(new Set());
  const sessionMenuRef = useRef(null);
  const watchingTasksRef = useRef(new Set());
  const activeSessionIdRef = useRef(activeSessionId);
  const activeSession = sessions.find((item) => item.id === activeSessionId) || sessions[0];
  const sessionGenerating = isSessionGenerating(activeSession, generatingSessionIds);
  const selectedModel = useMemo(() => availableModels.find((item) => String(item.id) === String(model)) || availableModels[0], [availableModels, model]);
  const audioOptions = selectedModel?.audioOptions || {};
  const voices = (audioOptions.voices?.length ? audioOptions.voices : [audioOptions.defaultVoice || "alloy"]).filter((item) => voiceIdOf(item));
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
  const canSubmit = Boolean((videoMode === "frames" && generationType === "video" ? framesReady : (prompt.trim() || audioOnlyReady)) && !sessionGenerating);
  const showVideoModes = generationType === "video" && (modelSupports(selectedModel, "r2v") || supportsFrames);
  const copiesLimited = generationType === "audio"
    || selectedModel?.adapterKey === "gpt-image-2"
    || selectedModel?.adapterKey === "seedance-2"
    || selectedModel?.adapterKey === "seedance-2.0"
    || selectedModel?.adapterKey === "seedance-2.5"
    || String(selectedModel?.provider || "").toLowerCase() === "runninghub"
    || isAgnes(selectedModel)
    || isMiniMaxH3(selectedModel)
    || isSeedanceOfficial(selectedModel);
  const unitPrice = Number.parseFloat(selectedModel?.pricing?.sale?.output) || (generationType === "video" ? 12 : generationType === "audio" ? 3 : 2);
  const parameterMultiplier = generationType === "audio" ? 1 : generationType === "video"
    ? (videoResolutionMultipliers[resolution] || 1)
    : ({ "1K": 1, "2K": 2, "4K": 4 }[resolution] || 1) * ({ Low: 1, Medium: 1.5, High: 2 }[quality] || 1);
  const audioUnit = selectedModel?.pricing?.unit === "万字符" ? 10000 : selectedModel?.pricing?.unit === "千字符" ? 1000 : 0;
  const quantityCost = generationType === "video" && selectedModel?.pricing?.unit === "秒" ? unitPrice * duration : generationType === "audio" && audioUnit ? unitPrice * Math.max(1, prompt.length) / audioUnit : unitPrice;
  const creditCost = Math.ceil(quantityCost * parameterMultiplier * (copiesLimited ? 1 : copies));
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { if (availableModels.length && !availableModels.some((item) => String(item.id) === String(model))) setModel(String(availableModels[0].id)); }, [availableModels, model]);
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
    if (generationType !== "video") return;
    const options = videoResolutionsFor(selectedModel);
    if (!options.includes(resolution)) setResolution(options[0] || "720P");
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
    let cancelled = false;
    fetchSessions().then(async (items) => {
      if (cancelled) return;
      if (!items?.length) {
        const created = await createSession({ title: "新建创作", category: "video" });
        if (cancelled) return;
        setSessions([{ ...makeInitialSession(), id: created.id, title: created.title, generationType: created.category || "video" }]);
        setActiveSessionId(created.id);
        return;
      }
      const mapped = items.map((item) => ({
        id: item.id,
        title: item.title || "未命名创作",
        generationType: item.category || "video",
        updated: formatDateTime(item.updatedAt) || "刚刚",
        messages: [],
      }));
      setSessions(mapped);
      setActiveSessionId(mapped[0].id);
      const detail = await fetchSession(mapped[0].id);
      if (!cancelled && detail) applySessionDetail(detail);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
      if (event.target.closest(".creation-control-wrap")) return;
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
    setActiveSessionId(session.id);
    setGenerationType(session.generationType);
    setPrompt("");
    fetchSession(session.id).then(applySessionDetail).catch(() => {});
  }

  function createSessionLocal() {
    createSession({ title: "未命名创作", category: generationType }).then((created) => {
      const next = { id: created.id, title: created.title || "未命名创作", generationType, updated: "刚刚", messages: [] };
      setSessions((items) => [next, ...items.filter((item) => item.id !== DEFAULT_SESSION_ID)]);
      setActiveSessionId(created.id);
      setPrompt("");
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
        const created = await createSession({ title: "未命名创作", category: generationType });
        const next = { id: created.id, title: created.title || "未命名创作", generationType, updated: "刚刚", messages: [] };
        setSessions([next]);
        setActiveSessionId(created.id);
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
    window.setTimeout(() => document.querySelector(".creation-composer textarea")?.focus(), 0);
  }

  function openAssetPicker() {
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
    fetchAssets().then((items) => setLibraryAssets(items || [])).catch(() => setLibraryAssets([]));
  }

  function togglePendingAsset(asset) {
    const next = toReferenceMaterial(asset);
    const framesPicker = generationType === "video" && videoMode === "frames";
    if (framesPicker && !isImageMaterial(next)) return;
    setPendingAssets((items) => {
      if (items.some((item) => sameMaterial(item, next))) {
        return items.filter((item) => !sameMaterial(item, next));
      }
      if (framesPicker && items.length >= 2) {
        setSubmitError("首尾帧最多引用两张图片，第 1 张为首帧、第 2 张为尾帧");
        return items;
      }
      return [...items, next];
    });
  }

  function addReferenceImages(files) {
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
    setReferenceImages((items) => [...items, ...accepted]);
  }

  function setFrame(file, setter) {
    if (!file) return;
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
    const displayText = text || (framesReadyNow ? FRAMES_EMPTY_PROMPT_LABEL : "");
    setSubmitError("");
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
    });
    try {
      if (!currentModel?.id || Number.isNaN(Number(currentModel.id))) {
        throw new Error("暂无可用模型，请先在管理后台添加 Mock 或启用模型");
      }
      if (!sessionId) {
        const created = await createSession({ title: text.slice(0, 12) || displayText.slice(0, 12) || "未命名创作", category: currentType });
        sessionId = created.id;
        setActiveSessionId(created.id);
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
      if (!useFrames) setReferenceImages(references);
      const submitted = await submitGenerate({
        modelId: Number(currentModel.id),
        sessionId,
        prompt: displayText,
        category: currentType,
        ratio,
        resolution,
        quality,
        durationSec: currentType === "video" ? clampDurationForModel(currentModel, duration) : undefined,
        voiceId: currentType === "audio" ? voiceId : undefined,
        speed: currentType === "audio" ? speed : undefined,
        audioFormat: currentType === "audio" ? audioFormat : undefined,
        copies: copiesLimited ? 1 : copies,
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

  function reuseResult(message, action) {
    setPrompt(promptForResult(activeSession.messages, message));
    if (action === "regenerate" || action === "edit") {
      window.setTimeout(() => document.querySelector(".creation-composer textarea")?.focus(), 0);
    }
    if (message.media?.type && message.media.type !== generationType) changeType(message.media.type);
  }

  return (
    <div className="create-layout">
      <aside className="session-sidebar">
        <button className="new-session" onClick={createSessionLocal}><Plus size={16} /> 新建创作</button>
        <span className="sidebar-label">会话历史</span>
        {sessions.map((session) => (
          <div className={`session-item ${session.id === activeSessionId ? "active" : ""} ${sessionMenuId === session.id ? "menu-open" : ""}`} key={session.id}>
            <button type="button" className="session-open" onClick={() => { setSessionMenuId(null); switchSession(session); }}>
              {session.generationType === "video" ? <Video size={15} /> : session.generationType === "audio" ? <AudioLines size={15} /> : <Image size={15} />}
              <span>{session.title}<small>{isSessionGenerating(session, generatingSessionIds) ? "生成中" : session.updated}</small></span>
            </button>
            <div className="session-menu-wrap" ref={sessionMenuId === session.id ? sessionMenuRef : null}>
              <button
                type="button"
                className="session-menu-trigger"
                aria-haspopup="menu"
                aria-expanded={sessionMenuId === session.id}
                aria-label={`会话操作：${session.title}`}
                onClick={() => setSessionMenuId((id) => (id === session.id ? null : session.id))}
              >
                <MoreHorizontal size={15} />
              </button>
              {sessionMenuId === session.id && (
                <div className="session-menu" role="menu">
                  <button type="button" role="menuitem" className="danger" onClick={() => { setSessionMenuId(null); requestDeleteSession(session); }}>
                    <Trash2 size={14} /> 删除
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </aside>
      <section className="create-main">
        <CosmicBackdrop active={theme === "dark"} />
        <div className={`conversation ${activeSession.messages.length ? "conversation--active" : ""}`}>
          {!activeSession.messages.length ? <><GravityDots /><div className="create-welcome"><div className="create-welcome__title"><span>使用</span><span className="create-welcome__kind">{generationType === "video" ? <Video size={15} /> : generationType === "audio" ? <AudioLines size={15} /> : <Image size={15} />}{generationType === "video" ? "视频" : generationType === "audio" ? "语音" : "图片"}</span><span>开启今日创作</span></div><p>选择一个灵感场景，素材与提示词将自动带入输入框</p><div className="create-welcome__section-label">灵感场景</div><CreationPresetCards generationType={generationType} onSelect={applyPreset} /></div></> : <div className="message-list">{activeSession.messages.map((message, index) => message.type === "user" ? <div className="message message--user" key={`${activeSession.id}-${index}`}><span>你</span><p>{message.text}</p></div> : <ResultMessage key={`${activeSession.id}-${index}`} message={message} onReuse={reuseResult} onSave={saveResult} savedIds={savedCreationIds} savingId={savingId} />)}{sessionGenerating && !activeSession.messages.some((item) => item.pending) && <div className="message message--result"><span><Sparkles size={16} /></span><div className="generating-line"><i /><i /><i /> {generationType === "audio" ? "正在合成语音…" : "正在构思画面与光线…"}</div></div>}</div>}
        </div>
        <div className="composer-shell composer-shell--expanded">
          <div className={`composer creation-composer ${referenceImages.length || firstFrame || lastFrame ? "has-material" : ""}`}>
            <input ref={referenceInputRef} aria-label="上传参考素材" className="visually-hidden" type="file" accept={generationType === "video" && !imageOnlyRefs(selectedModel) ? "image/*,video/*" : "image/*"} multiple disabled={!supportsLibrary} onChange={(event) => { addReferenceImages(event.target.files); event.target.value = ""; }} />
            <input ref={firstFrameInputRef} aria-label="上传视频首帧" className="visually-hidden" type="file" accept="image/*" disabled={!supportsFrames} onChange={(event) => { setFrame(event.target.files?.[0], setFirstFrame); event.target.value = ""; }} />
            <input ref={lastFrameInputRef} aria-label="上传视频尾帧" className="visually-hidden" type="file" accept="image/*" disabled={!supportsFrames} onChange={(event) => { setFrame(event.target.files?.[0], setLastFrame); event.target.value = ""; }} />
            <div className="composer-kind-tabs" role="tablist" aria-label="创作类型"><button role="tab" aria-selected={generationType === "video"} className={generationType === "video" ? "active" : ""} onClick={() => changeType("video")}><Video size={14} />视频</button><button role="tab" aria-selected={generationType === "image"} className={generationType === "image" ? "active" : ""} onClick={() => changeType("image")}><Image size={14} />图片</button><button role="tab" aria-selected={generationType === "audio"} className={generationType === "audio" ? "active" : ""} onClick={() => changeType("audio")}><AudioLines size={14} />语音</button></div>
            {submitError && <p className="create-submit-error">{submitError}</p>}
            <div className="creation-composer__body">
              <div className={`creation-reference-slots ${videoMode === "frames" && generationType === "video" ? "is-frames" : ""}`}>
                {generationType === "video" && videoMode === "frames" ? <><UploadTile label="首帧" detail="起始画面" material={firstFrame} onClick={() => firstFrameInputRef.current?.click()} onRemove={() => setFirstFrame(null)} /><ArrowLeftRight className="frame-bridge" size={15} /><UploadTile label="尾帧" detail="结束画面" material={lastFrame} onClick={() => lastFrameInputRef.current?.click()} onRemove={() => setLastFrame(null)} /></> : supportsLibrary ? <>{referenceImages.map((item, index) => <UploadTile key={item.storageKey || item.id || `${item.url}-${index}`} label={item.name || `参考 ${index + 1}`} material={item} onRemove={() => setReferenceImages((items) => items.filter((_, itemIndex) => itemIndex !== index))} />)}<UploadTile label="参考" detail={generationType === "video" ? (imageOnlyRefs(selectedModel) ? "图片" : "图片 / 视频") : "图片（可多选）"} onClick={() => referenceInputRef.current?.click()} /></> : null}
              </div>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendPrompt(); } }} placeholder={generationType === "video" ? (videoMode === "frames" ? "可选：描述镜头运动与画面变化。不填则根据首帧自动生成。" : "描述您想要生成的视频内容，例如，“一个孩子在公园里放风筝，金色阳光，镜头上移。”") : generationType === "audio" ? "输入需要朗读的文本，例如，“欢迎使用同道智能语音创作平台。”" : "描述您想生成的图片，例如，“夕阳映照在海面上，鲜艳的色彩与汹涌的波涛交相辉映。”"} maxLength={4096} />
              <span className={`creation-character-count${prompt.length >= 3800 ? " is-warning" : ""}`}>{prompt.length} / 4096{prompt.length >= 3800 ? " · 接近字数上限，请精简" : ""}</span>
            </div>
            <footer className="creation-composer__footer">
              <div className="creation-controls">
                <div className="creation-control-wrap">
                  <button type="button" className="creation-pill creation-model-pill" aria-haspopup="listbox" aria-expanded={openPanel === "model"} aria-label="选择模型" onClick={() => { setOpenPanel(openPanel === "model" ? null : "model"); setAssetPickerOpen(false); }}>
                    <Box size={14} /><span>{selectedModel?.name || "选择模型"}</span><ChevronDown size={13} />
                  </button>
                  {openPanel === "model" && <div className="creation-popover creation-model-popover" role="listbox" aria-label="可用模型">{availableModels.map((item) => {
                    const selected = String(item.id) === String(selectedModel?.id);
                    return <button type="button" role="option" aria-selected={selected} className={selected ? "active" : ""} key={item.id} onClick={() => { setModel(String(item.id)); setOpenPanel(null); setAssetPickerOpen(false); }}><span><strong>{item.name}</strong><small>{item.description || item.badge || item.provider}</small></span>{selected && <Check size={14} />}</button>;
                  })}</div>}
                </div>
                {showVideoModes && <div className="creation-control-wrap"><button type="button" className="creation-pill" aria-expanded={openPanel === "mode"} onClick={() => setOpenPanel(openPanel === "mode" ? null : "mode")}><Film size={14} />{videoMode === "reference" ? "参考生成" : "首/尾帧"}<ChevronDown size={13} /></button>{openPanel === "mode" && <div className="creation-popover creation-mode-popover"><button className={videoMode === "reference" ? "active" : ""} onClick={() => { setVideoMode("reference"); setFirstFrame(null); setLastFrame(null); setOpenPanel(null); }}><Images size={14} /><span><strong>参考生成</strong><small>{imageOnlyRefs(selectedModel) ? "可用图片作为参考（不支持参考视频）" : "可用图片或视频作为参考"}</small></span>{videoMode === "reference" && <Check size={14} />}</button><button className={videoMode === "frames" ? "active" : ""} disabled={!supportsFrames} onClick={() => { if (!supportsFrames) return; setVideoMode("frames"); setReferenceImages([]); setOpenPanel(null); }}><Film size={14} /><span><strong>首/尾帧</strong><small>{supportsFrames ? "控制视频起始与结束画面" : "当前模型不支持首尾帧"}</small></span>{videoMode === "frames" && <Check size={14} />}</button></div>}</div>}
                <div className="creation-control-wrap"><button type="button" className={`creation-pill creation-spec-pill ${generationType === "audio" ? "is-audio" : ""}`} aria-expanded={openPanel === "params"} onClick={() => setOpenPanel(openPanel === "params" ? null : "params")}>{generationType === "audio" ? <AudioLines size={14} /> : <Maximize2 size={14} />}<span>{generationType === "video" ? `${resolution} · ${duration}s · ${ratio}` : generationType === "audio" ? `${voiceLabel(voices.find((voice) => voiceIdOf(voice) === voiceId) || voiceId)} · ${speed.toFixed(2)}x · ${audioFormat.toUpperCase()}` : `${resolution} · ${quality} · ${ratio}`}</span><ChevronDown size={13} /></button>{openPanel === "params" && (generationType === "audio" ? <AudioParameterPanel voices={voices} formats={audioFormats} voiceId={voiceId} setVoiceId={setVoiceId} audioFormat={audioFormat} setAudioFormat={setAudioFormat} speed={speed} setSpeed={setSpeed} minSpeed={minSpeed} maxSpeed={maxSpeed} /> : <ParameterPanel generationType={generationType} ratio={ratio} setRatio={setRatio} resolution={resolution} setResolution={setResolution} duration={duration} setDuration={setDuration} quality={quality} setQuality={setQuality} durationOptions={durationOptionsFor(selectedModel)} resolutionOptions={generationType === "video" ? videoResolutionsFor(selectedModel) : ["1K", "2K", "4K"]} />)}</div>
                {generationType !== "audio" && <button type="button" className="creation-icon-action" title={supportsLibrary ? (generationType === "video" ? (videoMode === "frames" ? "从素材库引用首尾帧图片" : "从素材库引用图片或视频") : "从素材库引用") : (generationType === "video" && videoMode === "frames" ? "当前模型不支持首尾帧" : "当前模型不支持参考素材")} aria-label={videoMode === "frames" && generationType === "video" ? "从素材库引用首尾帧" : "从素材库引用素材"} disabled={!supportsLibrary} onClick={() => { if (supportsLibrary) openAssetPicker(); }}><AtSign size={16} /></button>}
                <button type="button" className="creation-icon-action" title="重置输入" aria-label="重置输入内容与参数" onClick={resetComposer}><RotateCcw size={15} /></button>
              </div>
              <div className="creation-submit-group">
                <div className="creation-control-wrap"><button type="button" className="creation-copy-button" aria-label={`副本数 ${copiesLimited ? 1 : copies}`} aria-expanded={openPanel === "copies"} disabled={copiesLimited} title={copiesLimited ? "当前模型仅支持 1 份" : undefined} onClick={() => { if (!copiesLimited) setOpenPanel(openPanel === "copies" ? null : "copies"); }}><Layers3 size={15} /><span>{copiesLimited ? 1 : copies}</span></button>{!copiesLimited && openPanel === "copies" && <div className="creation-popover creation-copy-popover">{[1, 2, 3, 4].map((item) => <button key={item} className={copies === item ? "active" : ""} onClick={() => { setCopies(item); setOpenPanel(null); }}>{item}{copies === item && <Check size={13} />}</button>)}</div>}</div>
                <span className="creation-cost" title="根据模型售价、参数与副本数计算"><Coins size={15} /><b>{creditCost}</b></span>
                <button className="creation-submit" aria-label="开始创作" onClick={sendPrompt} disabled={!canSubmit}><Sparkles size={16} />{sessionGenerating ? "生成中" : "创作"}</button>
              </div>
            </footer>
          </div>
        </div>
      </section>
      {assetPickerOpen && supportsLibrary && (
        <AssetPicker
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
