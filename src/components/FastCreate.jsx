import { ArrowLeftRight, AtSign, Box, Check, CheckCircle2, ChevronDown, Coins, Download, Film, Image, Images, Layers3, Maximize2, MoreHorizontal, Pencil, Plus, RectangleHorizontal, RectangleVertical, RefreshCw, RotateCcw, Save, ScanLine, Sparkles, Square, Trash2, Video, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAssets } from "../api/assets.js";
import { createSession, deleteSession, fetchSession, fetchSessions, saveCreationToAsset } from "../api/creations.js";
import { pollGenerateTask, submitGenerate } from "../api/generate.js";
import { materialToAsset, tasksToMessages, taskToResultMessage } from "../lib/createFlow.js";
import { formatDateTime, mediaUrl } from "../lib/media.js";

const videoRatios = ["自动", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const imageRatios = ["21:9", "16:9", "5:4", "4:3", "3:2", "1:1", "2:3", "3:4", "4:5", "9:16"];
const videoDurations = Array.from({ length: 12 }, (_, index) => index + 4);
const videoResolutions = ["480P", "720P", "1080P", "2K", "4K"];
const videoResolutionMultipliers = { "480P": 0.5, "720P": 0.75, "1080P": 1, "2K": 1.5, "4K": 2.5 };
const qualityLevels = ["Low", "Medium", "High"];
const DEFAULT_SESSION_ID = "new-creation-default";
const creationPresets = {
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
              : <img key={media.id || media.src} src={media.src} alt={media.title || ""} />)}
            <span className="media-spec-badge">{message.ratio} · {message.resolution}{message.creationType === "视频" ? ` · ${message.duration}` : ""}</span>
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
  return <div className={`creation-upload ${material ? "has-preview" : ""}`}><button type="button" onClick={onClick}>{material ? material.type === "video" ? <video src={material.url} poster={material.poster} muted playsInline preload="metadata" aria-label={`${label}视频预览`} /> : <img src={material.url} alt={`${label}预览`} /> : <><Plus size={24} /><span>{label}</span><small>{detail}</small></>}</button>{material && <span className="creation-upload__type">{material.type === "video" ? <Video size={10} /> : <Image size={10} />}</span>}{material && <button className="creation-upload__remove" type="button" aria-label={`移除${label}`} onClick={onRemove}><X size={12} /></button>}</div>;
}

function SegmentedOptions({ options, value, onChange, formatter = (item) => item }) {
  return <div className="creation-option-grid">{options.map((item) => <button type="button" className={value === item ? "active" : ""} key={item} onClick={() => onChange(item)}>{formatter(item)}{value === item && <Check size={11} />}</button>)}</div>;
}

function RatioOption({ ratio }) {
  const [width = 1, height = 1] = ratio.split(":").map(Number);
  const Icon = ratio === "自动" ? ScanLine : width === height ? Square : width > height ? RectangleHorizontal : RectangleVertical;
  return <span className="ratio-option"><Icon size={12} /><small>{ratio}</small></span>;
}

function ParameterPanel({ generationType, ratio, setRatio, resolution, setResolution, duration, setDuration, quality, setQuality }) {
  return <div className={`creation-popover creation-parameter-popover is-${generationType}`}>
    <section><label>比例</label><SegmentedOptions options={generationType === "video" ? videoRatios : imageRatios} value={ratio} onChange={setRatio} formatter={(item) => <RatioOption ratio={item} />} /></section>
    <section><label>分辨率</label><SegmentedOptions options={generationType === "video" ? videoResolutions : ["1K", "2K", "4K"]} value={resolution} onChange={setResolution} /></section>
    {generationType === "video" ? <section><label>时长</label><SegmentedOptions options={videoDurations} value={duration} onChange={setDuration} formatter={(item) => `${item}s`} /></section> : <section><label>画质</label><SegmentedOptions options={qualityLevels} value={quality} onChange={setQuality} /></section>}
  </div>;
}

function CreationPresetCards({ generationType, onSelect }) {
  return <div className="creation-preset-grid">{creationPresets[generationType].map((preset) => <button type="button" className="creation-preset-card" key={preset.id} onClick={() => onSelect(preset)}>{generationType === "video" ? <video src={preset.video} poster={preset.poster} muted loop autoPlay playsInline preload="metadata" aria-hidden="true" tabIndex={-1} /> : <img src={preset.image} alt={preset.title} />}<span className="creation-preset-card__shade" /><span className="creation-preset-card__content"><strong>{preset.title}</strong><em>{preset.description}</em></span></button>)}</div>;
}

function AssetPicker({ assets, selectedUrls, onToggle, onClose, onConfirm }) {
  return <div className="creation-asset-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="creation-asset-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title"><header><div><small>素材库</small><h2 id="asset-picker-title">选择引用素材</h2></div><button type="button" aria-label="关闭素材选择" onClick={onClose}><X size={17} /></button></header><div className="creation-asset-grid">{assets.map((asset) => { const preview = asset.poster || asset.src; const selected = selectedUrls.includes(asset.src); return <button type="button" className={selected ? "selected" : ""} key={asset.id} onClick={() => onToggle({ name: asset.title, url: asset.src, poster: asset.poster, type: asset.type })}><img src={preview} alt={asset.title} /><span><strong>{asset.title}</strong><small>{asset.type === "video" ? "视频素材" : "图片素材"}</small></span>{selected && <i><Check size={13} /></i>}</button>; })}</div><footer><span>已选择 {selectedUrls.length} 项</span><div><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" onClick={onConfirm}>引用素材</button></div></footer></section></div>;
}

export function FastCreate({ config, onConsumeCredits = () => {}, theme = "light", onOpenAssets }) {
  const queryClient = useQueryClient();
  const [sessions, setSessions] = useState(() => [makeInitialSession()]);
  const [activeSessionId, setActiveSessionId] = useState(DEFAULT_SESSION_ID);
  const [generationType, setGenerationType] = useState("video");
  const availableModels = useMemo(() => config.models.filter((item) => item.enabled !== false && (item.category === generationType || item.capabilities?.includes(generationType))), [config.models, generationType]);
  const [model, setModel] = useState(() => String(config.models.find((item) => item.enabled !== false && (item.category === "video" || item.capabilities?.includes("video")))?.id || config.models[0]?.id || ""));
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [savedCreationIds, setSavedCreationIds] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState([]);
  const [videoMode, setVideoMode] = useState("reference");
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("2K");
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState("Low");
  const [copies, setCopies] = useState(1);
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
  const generatingSessionRef = useRef(null);
  const sessionMenuRef = useRef(null);
  const activeSession = sessions.find((item) => item.id === activeSessionId) || sessions[0];
  const selectedModel = useMemo(() => availableModels.find((item) => String(item.id) === String(model)) || availableModels[0], [availableModels, model]);
  const supportsFrames = !selectedModel?.capabilities?.length || selectedModel.capabilities.includes("frames") || selectedModel.capabilities.includes("video");
  const unitPrice = Number.parseFloat(selectedModel?.pricing?.sale?.output) || (generationType === "video" ? 12 : 2);
  const parameterMultiplier = generationType === "video"
    ? (videoResolutionMultipliers[resolution] || 1)
    : ({ "1K": 1, "2K": 2, "4K": 4 }[resolution] || 1) * ({ Low: 1, Medium: 1.5, High: 2 }[quality] || 1);
  const quantityCost = generationType === "video" && selectedModel?.pricing?.unit === "秒" ? unitPrice * duration : unitPrice;
  const creditCost = Math.ceil(quantityCost * parameterMultiplier * copies);
  useEffect(() => { if (availableModels.length && !availableModels.some((item) => String(item.id) === String(model))) setModel(String(availableModels[0].id)); }, [availableModels, model]);
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

  function applySessionDetail(detail) {
    setSessions((items) => items.map((session) => session.id === detail.id ? {
      ...session,
      title: detail.title || session.title,
      generationType: detail.category || session.generationType,
      updated: formatDateTime(detail.updatedAt) || session.updated,
      messages: tasksToMessages(detail.tasks),
    } : session));
    if (detail.category) setGenerationType(detail.category);
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

  async function deleteSessionLocal(session) {
    if (String(generatingSessionRef.current) === String(session.id)) {
      setSubmitError("请等待当前生成完成后再删除该会话");
      return;
    }
    if (!window.confirm(`确定删除会话「${session.title || "未命名创作"}」吗？侧栏对话记录会消失，已生成的作品仍保留在「我的创作」中。`)) {
      return;
    }
    setSubmitError("");
    try {
      if (persistedSessionId(session.id)) {
        await deleteSession(session.id);
      }
      const remaining = sessions.filter((item) => item.id !== session.id);
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
    setRatio(type === "video" ? "16:9" : "9:16");
    setResolution(type === "video" ? "2K" : "1K");
  }

  function resetComposer() {
    setPrompt("");
    setReferenceImages([]);
    setFirstFrame(null);
    setLastFrame(null);
    setVideoMode("reference");
    setRatio(generationType === "video" ? "16:9" : "9:16");
    setResolution(generationType === "video" ? "2K" : "1K");
    setDuration(5);
    setQuality("Low");
    setCopies(1);
    setOpenPanel(null);
  }

  function applyPreset(preset) {
    setPrompt(preset.prompt);
    if (generationType === "video" && preset.mode === "frames") {
      setVideoMode("frames");
      setReferenceImages([]);
      setFirstFrame(preset.frames[0]);
      setLastFrame(preset.frames[1]);
    } else {
      setVideoMode("reference");
      setReferenceImages(preset.materials || []);
      setFirstFrame(null);
      setLastFrame(null);
    }
    window.setTimeout(() => document.querySelector(".creation-composer textarea")?.focus(), 0);
  }

  function openAssetPicker() {
    setPendingAssets(referenceImages);
    setAssetPickerOpen(true);
    fetchAssets().then((items) => setLibraryAssets(items || [])).catch(() => setLibraryAssets([]));
  }

  function togglePendingAsset(asset) {
    setPendingAssets((items) => items.some((item) => item.url === asset.url) ? items.filter((item) => item.url !== asset.url) : [...items, asset]);
  }

  function addReferenceImages(files) {
    const next = Array.from(files || []).map((file) => ({ name: file.name, url: URL.createObjectURL(file), file, type: file.type.startsWith("video/") ? "video" : "image" }));
    setReferenceImages((items) => [...items, ...next]);
  }

  function setFrame(file, setter) {
    if (!file) return;
    setter({ name: file.name, url: URL.createObjectURL(file), file, type: "image" });
  }

  function updateActiveMessages(updater) {
    setSessions((items) => items.map((session) => session.id === activeSessionId ? { ...session, generationType, title: session.messages.length ? session.title : (prompt.trim().slice(0, 12) || session.title), updated: "刚刚", messages: updater(session.messages) } : session));
  }

  async function sendPrompt() {
    const text = prompt.trim();
    if (!text || generating) return;
    setSubmitError("");
    updateActiveMessages((items) => [...items, { type: "user", text }]);
    setPrompt("");
    setGenerating(true);
    const currentType = generationType;
    const currentModel = selectedModel;
    const currentSessionId = activeSessionId === DEFAULT_SESSION_ID ? null : activeSessionId;
    generatingSessionRef.current = currentSessionId;
    try {
      if (!currentModel?.id || Number.isNaN(Number(currentModel.id))) {
        throw new Error("暂无可用模型，请先在管理后台添加 Mock 或启用模型");
      }
      let sessionId = currentSessionId;
      if (!sessionId) {
        const created = await createSession({ title: text.slice(0, 12) || "未命名创作", category: currentType });
        sessionId = created.id;
        generatingSessionRef.current = created.id;
        setActiveSessionId(created.id);
        setSessions((items) => [{ id: created.id, title: created.title, generationType: currentType, updated: "刚刚", messages: [{ type: "user", text }] }, ...items.filter((item) => item.id !== DEFAULT_SESSION_ID)]);
      }
      const useFrames = currentType === "video" && videoMode === "frames";
      const references = useFrames ? [] : await Promise.all(referenceImages.map((item) => materialToAsset(item)));
      const frames = useFrames ? {
        firstFrameKey: firstFrame ? (await materialToAsset(firstFrame)).storageKey : undefined,
        lastFrameKey: lastFrame ? (await materialToAsset(lastFrame)).storageKey : undefined,
      } : undefined;
      if (!useFrames) setReferenceImages(references);
      const submitted = await submitGenerate({
        modelId: Number(currentModel.id),
        sessionId,
        prompt: text,
        category: currentType,
        ratio,
        resolution,
        quality,
        durationSec: currentType === "video" ? duration : undefined,
        copies,
        references: useFrames ? undefined : references.map((item) => ({ type: item.type, storageKey: item.storageKey })),
        frames,
      });
      onConsumeCredits(submitted.creditCost || 0, { model: currentModel.name, type: currentType });
      const finished = await pollGenerateTask(submitted.id);
      if (finished.status === "FAILED") {
        updateActiveMessages((items) => [...items, { type: "result", text: finished.errorMessage || "生成失败，积分已退还", error: true, model: currentModel.name, creationType: currentType === "video" ? "视频" : "图片", createdAt: formatDateTime(new Date()), elapsed: "—", credits: 0, ratio, resolution, duration: currentType === "video" ? `${duration} 秒` : "—", media: { type: currentType, src: "" }, creations: [] }]);
      } else {
        updateActiveMessages((items) => [...items, taskToResultMessage(finished)]);
      }
      onConsumeCredits(0, { model: currentModel.name, type: currentType, refresh: true });
    } catch (error) {
      setSubmitError(error.message || "提交失败");
      updateActiveMessages((items) => [...items, { type: "result", text: error.message || "提交失败", error: true, model: currentModel?.name || "模型", creationType: currentType === "video" ? "视频" : "图片", createdAt: formatDateTime(new Date()), elapsed: "—", credits: 0, ratio, resolution, duration: currentType === "video" ? `${duration} 秒` : "—", media: { type: currentType, src: "" }, creations: [] }]);
    } finally {
      generatingSessionRef.current = null;
      setGenerating(false);
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
    const sessionPrompt = activeSession.messages.find((item) => item.type === "user")?.text || "";
    setPrompt(sessionPrompt);
    if (action === "regenerate") window.setTimeout(() => document.querySelector(".composer textarea")?.focus(), 0);
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
              {session.generationType === "video" ? <Video size={15} /> : <Image size={15} />}
              <span>{session.title}<small>{session.updated}</small></span>
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
                  <button type="button" role="menuitem" className="danger" onClick={() => { setSessionMenuId(null); deleteSessionLocal(session); }}>
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
          {!activeSession.messages.length ? <><GravityDots /><div className="create-welcome"><div className="create-welcome__title"><span>使用</span><span className="create-welcome__kind">{generationType === "video" ? <Video size={15} /> : <Image size={15} />}{generationType === "video" ? "视频" : "图片"}</span><span>开启今日创作</span></div><p>选择一个灵感场景，素材与提示词将自动带入输入框</p><CreationPresetCards generationType={generationType} onSelect={applyPreset} /></div></> : <div className="message-list">{activeSession.messages.map((message, index) => message.type === "user" ? <div className="message message--user" key={`${activeSession.id}-${index}`}><span>你</span><p>{message.text}</p></div> : <ResultMessage key={`${activeSession.id}-${index}`} message={message} onReuse={reuseResult} onSave={saveResult} savedIds={savedCreationIds} savingId={savingId} />)}{generating && <div className="message message--result"><span><Sparkles size={16} /></span><div className="generating-line"><i /><i /><i /> 正在构思画面与光线…</div></div>}</div>}
        </div>
        <div className="composer-shell composer-shell--expanded">
          <div className={`composer creation-composer ${referenceImages.length || firstFrame || lastFrame ? "has-material" : ""}`}>
            <input ref={referenceInputRef} aria-label="上传参考素材" className="visually-hidden" type="file" accept="image/*,video/*" multiple onChange={(event) => { addReferenceImages(event.target.files); event.target.value = ""; }} />
            <input ref={firstFrameInputRef} aria-label="上传视频首帧" className="visually-hidden" type="file" accept="image/*" onChange={(event) => { setFrame(event.target.files?.[0], setFirstFrame); event.target.value = ""; }} />
            <input ref={lastFrameInputRef} aria-label="上传视频尾帧" className="visually-hidden" type="file" accept="image/*" onChange={(event) => { setFrame(event.target.files?.[0], setLastFrame); event.target.value = ""; }} />
            <div className="composer-kind-tabs" role="tablist" aria-label="创作类型"><button role="tab" aria-selected={generationType === "video"} className={generationType === "video" ? "active" : ""} onClick={() => changeType("video")}><Video size={14} />视频</button><button role="tab" aria-selected={generationType === "image"} className={generationType === "image" ? "active" : ""} onClick={() => changeType("image")}><Image size={14} />图片</button></div>
            {submitError && <p className="create-submit-error">{submitError}</p>}
            <div className="creation-composer__body">
              <div className={`creation-reference-slots ${videoMode === "frames" && generationType === "video" ? "is-frames" : ""}`}>
                {generationType === "video" && videoMode === "frames" ? <><UploadTile label="首帧" detail="起始画面" material={firstFrame} onClick={() => firstFrameInputRef.current?.click()} onRemove={() => setFirstFrame(null)} /><ArrowLeftRight className="frame-bridge" size={15} /><UploadTile label="尾帧" detail="结束画面" material={lastFrame} onClick={() => lastFrameInputRef.current?.click()} onRemove={() => setLastFrame(null)} /></> : <>{referenceImages.map((item, index) => <UploadTile key={`${item.url}-${index}`} label={item.name || `参考 ${index + 1}`} material={item} onRemove={() => setReferenceImages((items) => items.filter((_, itemIndex) => itemIndex !== index))} />)}<UploadTile label="参考" detail="支持多选" onClick={() => referenceInputRef.current?.click()} /></>}
              </div>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendPrompt(); } }} placeholder={generationType === "video" ? "描述您想要生成的视频内容，例如，“一个孩子在公园里放风筝，金色阳光，镜头上移。”" : "描述您想生成的图片，例如，“夕阳映照在海面上，鲜艳的色彩与汹涌的波涛交相辉映。”"} />
            </div>
            <footer className="creation-composer__footer">
              <div className="creation-controls">
                <label className="creation-pill creation-model-pill"><Box size={14} /><select aria-label="选择模型" value={model} onChange={(event) => setModel(event.target.value)}>{availableModels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={13} /></label>
                {generationType === "video" && <div className="creation-control-wrap"><button type="button" className="creation-pill" aria-expanded={openPanel === "mode"} onClick={() => setOpenPanel(openPanel === "mode" ? null : "mode")}><Film size={14} />{videoMode === "reference" ? "参考生成" : "首/尾帧"}<ChevronDown size={13} /></button>{openPanel === "mode" && <div className="creation-popover creation-mode-popover"><button className={videoMode === "reference" ? "active" : ""} onClick={() => { setVideoMode("reference"); setOpenPanel(null); }}><Images size={14} /><span><strong>参考生成</strong><small>可持续添加多张参考素材</small></span>{videoMode === "reference" && <Check size={14} />}</button><button className={videoMode === "frames" ? "active" : ""} disabled={!supportsFrames} onClick={() => { if (!supportsFrames) return; setVideoMode("frames"); setOpenPanel(null); }}><Film size={14} /><span><strong>首/尾帧</strong><small>{supportsFrames ? "控制视频起始与结束画面" : "当前模型不支持首尾帧"}</small></span>{videoMode === "frames" && <Check size={14} />}</button></div>}</div>}
                <div className="creation-control-wrap"><button type="button" className="creation-pill creation-spec-pill" aria-expanded={openPanel === "params"} onClick={() => setOpenPanel(openPanel === "params" ? null : "params")}><Maximize2 size={14} />{generationType === "video" ? `${resolution} · ${duration}s · ${ratio}` : `${resolution} · ${quality} · ${ratio}`}<ChevronDown size={13} /></button>{openPanel === "params" && <ParameterPanel generationType={generationType} ratio={ratio} setRatio={setRatio} resolution={resolution} setResolution={setResolution} duration={duration} setDuration={setDuration} quality={quality} setQuality={setQuality} />}</div>
                <button type="button" className="creation-icon-action" title="从素材库引用" aria-label="从素材库引用素材" onClick={openAssetPicker}><AtSign size={16} /></button>
                <button type="button" className="creation-icon-action" title="重置输入" aria-label="重置输入内容与参数" onClick={resetComposer}><RotateCcw size={15} /></button>
              </div>
              <div className="creation-submit-group">
                <div className="creation-control-wrap"><button type="button" className="creation-copy-button" aria-label={`副本数 ${copies}`} aria-expanded={openPanel === "copies"} onClick={() => setOpenPanel(openPanel === "copies" ? null : "copies")}><Layers3 size={15} /><span>{copies}</span></button>{openPanel === "copies" && <div className="creation-popover creation-copy-popover">{[1, 2, 3, 4].map((item) => <button key={item} className={copies === item ? "active" : ""} onClick={() => { setCopies(item); setOpenPanel(null); }}>{item}{copies === item && <Check size={13} />}</button>)}</div>}</div>
                <span className="creation-cost" title="根据模型售价、参数与副本数计算"><Coins size={15} /><b>{creditCost}</b></span>
                <button className="creation-submit" aria-label="开始创作" onClick={sendPrompt} disabled={!prompt.trim() || generating}><Sparkles size={16} />{generating ? "生成中" : "创作"}</button>
              </div>
            </footer>
          </div>
        </div>
      </section>
      {assetPickerOpen && <AssetPicker assets={libraryAssets.map((item) => ({ id: item.id, title: item.title || item.name, src: mediaUrl(item.src || item.storageKey), poster: mediaUrl(item.poster || item.posterKey), type: item.type, storageKey: item.storageKey }))} selectedUrls={pendingAssets.map((item) => item.url)} onToggle={(asset) => togglePendingAsset({ name: asset.title, url: asset.src, poster: asset.poster, type: asset.type, storageKey: asset.storageKey })} onClose={() => setAssetPickerOpen(false)} onConfirm={() => { setReferenceImages(pendingAssets); setVideoMode("reference"); setAssetPickerOpen(false); }} />}
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
    </div>
  );
}
