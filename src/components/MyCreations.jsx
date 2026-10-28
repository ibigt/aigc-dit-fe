import { CalendarDays, Check, Copy, Download, FolderInput, Grid3X3, Image, List, Search, Sparkles, Trash2, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteCreation, fetchCreations, saveCreationToAsset } from "../api/creations.js";
import { creationTitleForDisplay, promptForDisplay } from "../lib/createFlow.js";
import { ImageLightbox } from "../lib/ImageLightbox.jsx";
import { MediaCover } from "../lib/MediaCover.jsx";
import { downloadMediaFile, formatDateTime, MEDIA_THUMB_WIDTH, mediaDownloadName, mediaUrl } from "../lib/media.js";
import { zipStore } from "../lib/zipStore.js";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { DemoSelect } from "./DemoSelect.jsx";
import { AudioPreview, WorkWaveform } from "./AudioPreview.jsx";
import { WorksTypeIcon } from "./WorksTypeIcon.jsx";

const TIME_RANGES = [
  { id: "all", label: "全部时间" },
  { id: "today", label: "今天" },
  { id: "7d", label: "近7天" },
  { id: "30d", label: "近30天" },
];

const PROJECT_FILTERS = [
  { id: "all", label: "全部项目" },
  { id: "quick", label: "快速创作" },
  { id: "drama", label: "短剧创作" },
];

const TYPE_LABELS = { video: "视频", image: "图片", audio: "语音" };
const PROJECT_LABELS = { quick: "快速创作", drama: "短剧创作" };

function typeLabel(type) {
  return TYPE_LABELS[type] || "作品";
}

function projectLabel(item) {
  return PROJECT_LABELS[item.projectKind] || item.projectName || "未归入项目";
}

function WorkPlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m9 7 8 5-8 5V7Z" />
    </svg>
  );
}

function WorkExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
  );
}

function WorkAudioIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8" />
    </svg>
  );
}

function WorkGridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}

function durationSecondsOf(item) {
  const rawValue = item?.durationSec ?? item?.duration;
  const parsedValue = Number(rawValue);
  if (Number.isFinite(parsedValue) && parsedValue > 0) return parsedValue;
  const matchedValue = Number(String(rawValue || "").match(/[\d.]+/)?.[0]);
  return Number.isFinite(matchedValue) && matchedValue >= 0 ? matchedValue : null;
}

function formatPlaybackDuration(seconds) {
  const totalSeconds = Number(seconds);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const wholeSeconds = Math.floor(totalSeconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function formatVideoDuration(item) {
  const seconds = durationSecondsOf(item);
  return seconds == null ? "—" : `${seconds}秒`;
}

const AUDIO_MIME_FORMATS = {
  "audio/mpeg": "MP3",
  "audio/wav": "WAV",
  "audio/x-wav": "WAV",
  "audio/mp4": "M4A",
  "audio/aac": "AAC",
  "audio/flac": "FLAC",
  "audio/ogg": "OGG",
  "audio/opus": "OPUS",
  "audio/L16": "PCM",
};

function actualExtensionOf(item) {
  for (const rawSource of [item?.storageKey, item?.src, item?.url]) {
    if (!rawSource) continue;
    let source = String(rawSource);
    try {
      source = decodeURIComponent(source);
    } catch {
    }
    const keyMatch = source.match(/[?&]key=([^&]+)/);
    const mediaPath = (keyMatch ? keyMatch[1] : source).split(/[?#]/)[0];
    const extension = mediaPath.match(/\.([a-z0-9]{2,5})$/i)?.[1];
    if (extension) return extension.toLowerCase();
  }
  return "";
}

function audioFormatOf(item) {
  const explicitFormat = String(item?.format || item?.audioFormat || "").trim();
  if (explicitFormat && explicitFormat.toLowerCase() !== "音频") {
    return AUDIO_MIME_FORMATS[explicitFormat.toLowerCase()] || explicitFormat.toUpperCase();
  }
  const mimeType = AUDIO_MIME_FORMATS[String(item?.mimeType || item?.mime_type || "").toLowerCase()];
  if (mimeType) return mimeType;
  const extension = actualExtensionOf(item);
  return AUDIO_MIME_FORMATS[extension] || extension.toUpperCase();
}

const AudioSpecText = memo(function AudioSpecText({ item }) {
  // 后端若已返回 durationSec 就直接用；不再前端创建 <audio> 加载 metadata，避免切分类时大量并行音频下载。
  const seconds = durationSecondsOf(item);
  return <>{audioFormatOf(item) || "音频"} · {formatPlaybackDuration(seconds)}</>;
});

function createdFrom(range) {
  if (!range || range === "all") return undefined;
  if (range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  const days = range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function fileNameOf(item, used) {
  return mediaDownloadName({
    title: creationTitleForDisplay(item),
    fallback: "作品",
    type: item.type,
    storageKey: item.storageKey,
    src: item.src,
    createdAt: item.createdAt || item.createdAtLabel,
    used,
  });
}

export function MyCreations({ onReuse }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [timeRange, setTimeRange] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [view, setView] = useState("grid");
  const [selected, setSelected] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [picked, setPicked] = useState([]);
  const [packing, setPacking] = useState(false);
  const [savedIds, setSavedIds] = useState([]);
  const [notice, setNotice] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [promptOverflow, setPromptOverflow] = useState(false);
  const [promptTooltip, setPromptTooltip] = useState(null);
  const promptRef = useRef(null);
  const promptTooltipTimerRef = useRef(null);
  const creationsQuery = useQuery({
    queryKey: ["creations", filter, query, timeRange, projectFilter],
    queryFn: () => fetchCreations({
      category: filter === "all" ? undefined : filter,
      q: query || undefined,
      project: projectFilter === "all" ? undefined : projectFilter,
      from: createdFrom(timeRange),
    }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: false,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteCreation,
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["creations"] });
      setSelected((current) => (current?.id === id ? null : current));
      setPicked((ids) => ids.filter((item) => item !== id));
    },
  });
  const saveMutation = useMutation({
    mutationFn: saveCreationToAsset,
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setSavedIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
      setNotice({ tone: "ok", text: "已存入素材库" });
    },
    onError: (error) => setNotice({ tone: "error", text: error.message || "存入素材库失败" }),
  });
  const creations = useMemo(() => (creationsQuery.data || []).map((item) => ({
    ...item,
    src: mediaUrl(item.src || item.storageKey),
    poster: mediaUrl(item.poster || item.posterKey, { w: MEDIA_THUMB_WIDTH }),
    thumb: mediaUrl(item.poster || item.src || item.storageKey, { w: MEDIA_THUMB_WIDTH }),
    createdAtLabel: formatDateTime(item.createdAt),
    duration: item.duration || (item.durationSec ? `${item.durationSec} 秒` : "—"),
    cost: item.creditCost || 0,
    model: item.modelName,
    elapsed: item.elapsed || "—",
    type: item.type || item.category,
  })), [creationsQuery.data]);
  const visible = creations;
  const visibleIds = visible.map((item) => item.id);
  const allVisiblePicked = visibleIds.length > 0 && visibleIds.every((id) => picked.includes(id));
  const selectedPrompt = promptForDisplay(selected?.prompt) || "—";

  useEffect(() => {
    const node = promptRef.current;
    if (!node) {
      setPromptOverflow(false);
      return undefined;
    }
    const updateOverflow = () => setPromptOverflow(node.scrollWidth > node.clientWidth + 1);
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [selectedPrompt]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setPromptTooltip(null);
    setLightbox(null);
  }, [selected?.id]);

  useEffect(() => () => window.clearTimeout(promptTooltipTimerRef.current), []);

  function showPromptTooltip() {
    window.clearTimeout(promptTooltipTimerRef.current);
    const rect = promptRef.current?.getBoundingClientRect();
    if (rect) setPromptTooltip({ left: rect.left, viewportTop: rect.top });
  }

  function schedulePromptTooltipClose() {
    window.clearTimeout(promptTooltipTimerRef.current);
    promptTooltipTimerRef.current = window.setTimeout(() => setPromptTooltip(null), 180);
  }

  function hidePromptTooltip() {
    window.clearTimeout(promptTooltipTimerRef.current);
    setPromptTooltip(null);
  }

  function confirmDelete(item) {
    setDeleteTarget(item);
  }

  function togglePicked(id) {
    setPicked((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  }

  function toggleVisible() {
    setPicked((ids) => {
      if (allVisiblePicked) return ids.filter((id) => !visibleIds.includes(id));
      return [...new Set([...ids, ...visibleIds])];
    });
  }

  async function copyLink(item) {
    const url = new URL(item.src, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ tone: "ok", text: "已复制链接" });
    } catch {
      setNotice({ tone: "error", text: "复制失败，请手动复制地址" });
    }
  }

  function reuse(item) {
    onReuse?.({
      token: Date.now(),
      type: item.type,
      modelId: item.modelId,
      ratio: item.ratio,
      resolution: item.resolution,
      durationSec: item.durationSec,
      prompt: promptForDisplay(item.prompt) || "",
      sessionId: item.sessionId,
    });
    setSelected(null);
  }

  async function downloadOne(item) {
    if (!item?.src) {
      setNotice({ tone: "error", text: "该作品暂无可下载文件" });
      return;
    }
    try {
      await downloadMediaFile(item.src, fileNameOf(item));
      setNotice({ tone: "ok", text: "已开始下载" });
    } catch (error) {
      setNotice({ tone: "error", text: error.message || "下载失败" });
    }
  }

  async function downloadPicked() {
    const items = visible.filter((item) => picked.includes(item.id) && item.src);
    if (!items.length) {
      setNotice({ tone: "error", text: "请先选择要下载的作品" });
      return;
    }
    setPacking(true);
    setNotice(null);
    try {
      const used = new Set();
      const files = [];
      for (const item of items) {
        const response = await fetch(item.src);
        if (!response.ok) throw new Error(`下载失败：${creationTitleForDisplay(item)}`);
        files.push({ name: fileNameOf(item, used), data: new Uint8Array(await response.arrayBuffer()) });
      }
      const blob = zipStore(files);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `我的创作-${formatDateTime(new Date()).slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: "ok", text: `已打包 ${files.length} 个作品` });
    } catch (error) {
      setNotice({ tone: "error", text: error.message || "打包下载失败" });
    } finally {
      setPacking(false);
    }
  }

  return (
    <section className="page standard-content-page works-page">
      <header className="page-header works-header">
        <div><h1>我的创作</h1><p>查看、播放与下载你生成的全部作品。</p></div>
        <div className="works-total"><strong>{visible.length}</strong><span>{filter === "all" ? "全部作品" : `找到 ${visible.length} 个作品`}</span></div>
      </header>

      <div className="works-controls">
        <div className="works-type-tabs" role="tablist" aria-label="作品类型">
          {[["all", "全部"], ["video", "视频"], ["image", "图片"], ["audio", "语音"]].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} className={`works-type-tab${filter === value ? " is-active" : ""}`} onClick={() => setFilter(value)}>
              <WorksTypeIcon type={value} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="works-filter-group">
          <label className="works-select">
            <span className="visually-hidden">时间范围</span>
            <DemoSelect ariaLabel="时间范围" value={timeRange} onChange={setTimeRange} options={TIME_RANGES.map((item) => ({ value: item.id, label: item.label }))} />
          </label>
          <label className="works-select">
            <span className="visually-hidden">所属项目</span>
            <DemoSelect ariaLabel="所属项目" value={projectFilter} onChange={setProjectFilter} options={PROJECT_FILTERS.map((item) => ({ value: item.id, label: item.label }))} />
          </label>
          <label className="works-search">
            <Search size={17} aria-hidden="true" />
            <span className="visually-hidden">搜索作品</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索提示词或作品" autoComplete="off" />
            <kbd aria-hidden="true">/</kbd>
          </label>
          <div className="works-view-switch" aria-label="展示模式">
            <button type="button" className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")} aria-label="卡片模式" aria-pressed={view === "grid"}><Grid3X3 size={17} /></button>
            <button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")} aria-label="列表模式" aria-pressed={view === "list"}><List size={17} /></button>
          </div>
        </div>
      </div>

      {visible.length > 0 && (
        <div className="works-batch-bar">
          <div className="works-selected-count" aria-live="polite">
            已选 <strong>{visible.filter((item) => picked.includes(item.id)).length}</strong> 项
            {picked.length > 0 && visibleIds.length > 0 && (
              <span> · 当前结果 {visible.filter((item) => picked.includes(item.id)).length} 项</span>
            )}
          </div>
          <div className="works-batch-actions">
            <button type="button" className="works-text-button" onClick={toggleVisible}>{allVisiblePicked ? "取消全选" : "全选当前"}</button>
            <button type="button" className="works-download-button" disabled={packing || !picked.some((id) => visibleIds.includes(id))} onClick={downloadPicked}>
              <Download size={16} aria-hidden="true" /> {packing ? "正在打包…" : "打包下载"}
            </button>
            {picked.length > 0 && <button type="button" className="works-clear-button" onClick={() => setPicked([])}>清除选择</button>}
          </div>
        </div>
      )}

      {notice && <p className={`creation-notice ${notice.tone === "error" ? "is-error" : ""}`} role="status">{notice.text}</p>}

      <div className="works-result-summary">
        <span>{filter === "all" ? "全部作品" : `找到 ${visible.length} 个作品`}</span>
        <span>按创建时间排序</span>
      </div>

      {visible.length === 0 ? (
        <div className="works-empty">
          <div className="works-empty-icon" aria-hidden="true"><Image size={28} /></div>
          <h2>暂无作品</h2>
          <p>完成一次图片、视频或语音创作后，作品会集中显示在这里。</p>
        </div>
      ) : (
        <div className={view === "grid" ? "works-grid" : "works-list"}>
          {visible.map((item) => {
            const title = creationTitleForDisplay(item);
            const promptText = promptForDisplay(item.prompt) || "—";
            const isPicked = picked.includes(item.id);
            const specText = item.type === "audio"
              ? <AudioSpecText item={item} />
              : `${item.ratio || "—"} · ${item.resolution || "—"}${item.type === "video" ? ` · ${formatVideoDuration(item)}` : ""}`;
            return view === "grid" ? (
              <article key={item.id} className={`work-card${isPicked ? " is-selected" : ""}`} data-work-item={item.id}>
                <div className={`work-thumb${item.type === "audio" ? " is-audio" : ""}`}>
                  {item.type === "audio" ? <WorkWaveform /> : <MediaCover item={item} />}
                  <label className="work-check">
                    <input type="checkbox" checked={isPicked} onChange={() => togglePicked(item.id)} aria-label={`选择${title}`} />
                    <span aria-hidden="true"><Check size={13} strokeWidth={2.4} /></span>
                  </label>
                  <span className="work-spec">{specText}</span>
                  <span className="work-kind">{typeLabel(item.type)}</span>
                  <button type="button" className="work-preview-button" onClick={() => setSelected(item)} aria-label={`预览${title}`}>
                    {item.type === "image" ? <WorkExpandIcon /> : <WorkPlayIcon />}
                  </button>
                </div>
                <div className="work-card-body">
                  <h3 title={title}>{title}</h3>
                  <div className="work-model" title={item.model || undefined}>{item.model || "未记录模型"}</div>
                  <p>{promptText}</p>
                </div>
                <footer className="work-card-footer">
                  <span><CalendarDays size={12} /> {item.createdAtLabel} · {item.elapsed}</span>
                  <div className="work-actions">
                    <button type="button" aria-label={`下载${title}`} title="下载" onClick={() => downloadOne(item)}><Download size={16} /></button>
                    <button type="button" className="is-danger" aria-label={`删除${title}`} title="删除" onClick={() => confirmDelete(item)}><Trash2 size={16} /></button>
                  </div>
                </footer>
              </article>
            ) : (
              <article key={item.id} className={`work-list-item${isPicked ? " is-selected" : ""}`} data-work-item={item.id}>
                <div className={`work-thumb${item.type === "audio" ? " is-audio" : ""}`}>
                  {item.type === "audio" ? <WorkWaveform /> : <MediaCover item={item} />}
                  <label className="work-check">
                    <input type="checkbox" checked={isPicked} onChange={() => togglePicked(item.id)} aria-label={`选择${title}`} />
                    <span aria-hidden="true"><Check size={13} strokeWidth={2.4} /></span>
                  </label>
                  <span className="work-spec">{specText}</span>
                  <span className="work-kind">{typeLabel(item.type)}</span>
                  <button type="button" className="work-preview-button" onClick={() => setSelected(item)} aria-label={`预览${title}`}>
                    {item.type === "image" ? <WorkExpandIcon /> : <WorkPlayIcon />}
                  </button>
                </div>
                <div className="work-list-copy">
                  <div className="work-list-heading">
                    <div>
                      <h3>{title}</h3>
                      <span>{item.model || "未记录模型"}</span>
                    </div>
                    <div className="work-actions">
                      <button type="button" aria-label={`下载${title}`} title="下载" onClick={() => downloadOne(item)}><Download size={16} /></button>
                      <button type="button" className="is-danger" aria-label={`删除${title}`} title="删除" onClick={() => confirmDelete(item)}><Trash2 size={16} /></button>
                    </div>
                  </div>
                  <p>{promptText}</p>
                  <footer>
                    <span>{projectLabel(item)}</span>
                    <span>{item.createdAtLabel} · 生成耗时 {item.elapsed}</span>
                  </footer>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="work-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <section className="work-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="workPreviewTitle" tabIndex={-1}>
            <header>
              <div><span>{typeLabel(selected.type)}预览</span><h2 id="workPreviewTitle">{creationTitleForDisplay(selected)}</h2></div>
              <button className="modal-close" type="button" onClick={() => setSelected(null)} aria-label="关闭预览"><X size={19} /></button>
            </header>
            <div className={`work-preview-stage${selected.type === "audio" ? " is-audio" : ""}`}>
              {selected.type === "video"
                ? <video src={selected.src} poster={selected.poster} controls playsInline />
                : selected.type === "audio"
                  ? <AudioPreview
                      src={selected.src}
                      title={creationTitleForDisplay(selected)}
                      format={audioFormatOf(selected)}
                      duration={durationSecondsOf(selected)}
                    />
                  : <figure className="work-preview-art">
                      <img
                        src={selected.src}
                        alt={creationTitleForDisplay(selected)}
                        onClick={() => setLightbox({ src: selected.src, title: creationTitleForDisplay(selected) })}
                      />
                    </figure>}
            </div>
            <footer>
              <div className="work-preview-dialog__meta">
                <strong>{selected.model || "未记录模型"}</strong>
                <div
                  ref={promptRef}
                  className={`work-preview-dialog__prompt${promptOverflow ? " is-overflow" : ""}`}
                  aria-describedby={promptTooltip ? "workPromptTooltip" : undefined}
                  tabIndex={0}
                  onMouseEnter={showPromptTooltip}
                  onMouseLeave={schedulePromptTooltipClose}
                  onFocus={showPromptTooltip}
                  onBlur={hidePromptTooltip}
                >
                  <p>{selectedPrompt}</p>
                </div>
              </div>
              <div className="work-preview-dialog__actions">
                <button type="button" className="works-text-button" onClick={() => copyLink(selected)}><Copy size={15} /> 复制链接</button>
                <button type="button" className="works-download-button" disabled={saveMutation.isPending && saveMutation.variables === selected.id} onClick={() => saveMutation.mutate(selected.id)}>
                  {savedIds.includes(selected.id) ? <Check size={16} /> : <FolderInput size={16} />}
                  {savedIds.includes(selected.id) ? "已存入素材库" : "存入素材库"}
                </button>
                <button type="button" className="works-download-button" onClick={() => reuse(selected)}><Sparkles size={16} /> 基于此生成</button>
                <button type="button" className="works-download-button" onClick={() => downloadOne(selected)}><Download size={16} /> 下载作品</button>
                <button type="button" className="works-download-button is-danger" onClick={() => confirmDelete(selected)} aria-label={`删除${creationTitleForDisplay(selected)}`} title="删除"><Trash2 size={16} /> 删除</button>
              </div>
            </footer>
          </section>
          {promptTooltip && (
            <div
              id="workPromptTooltip"
              className="work-prompt-tooltip"
              role="tooltip"
              onMouseEnter={() => window.clearTimeout(promptTooltipTimerRef.current)}
              onMouseLeave={hidePromptTooltip}
              style={{ left: `${promptTooltip.left}px`, bottom: `calc(100dvh - ${promptTooltip.viewportTop}px + 8px)` }}
            >
              {selectedPrompt}
            </div>
          )}
        </div>
      )}
      {selected && lightbox && (
        <ImageLightbox
          preview={{ ...lightbox, title: lightbox.title || "作品预览" }}
          onClose={() => setLightbox(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        eyebrow="我的创作"
        title="删除作品？"
        message={deleteTarget
          ? deleteTarget.projectKind === "drama"
            ? `“${creationTitleForDisplay(deleteTarget)}”会从我的创作中删除，短剧里的资产图片和分镜视频仍会保留。`
            : `“${creationTitleForDisplay(deleteTarget)}”删除后将无法恢复，请确认是否继续。`
          : ""}
        confirmLabel="删除"
        busy={deleteMutation.isPending}
        busyLabel="删除中…"
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.id, {
            onSuccess: () => setDeleteTarget(null),
          });
        }}
      />
    </section>
  );
}
