import { AudioLines, CalendarDays, Check, Copy, Download, Expand, FolderInput, Grid3X3, Image, List, Play, Search, SlidersHorizontal, Sparkles, Trash2, Video, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteCreation, fetchCreations, saveCreationToAsset } from "../api/creations.js";
import { creationTitleForDisplay, promptForDisplay } from "../lib/createFlow.js";
import { MediaCover } from "../lib/MediaCover.jsx";
import { formatDateTime, MEDIA_THUMB_WIDTH, mediaUrl } from "../lib/media.js";
import { zipStore } from "../lib/zipStore.js";
import { ConfirmDialog } from "./ConfirmDialog.jsx";

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

function typeLabel(type) {
  return TYPE_LABELS[type] || "作品";
}

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

function extensionOf(item) {
  const source = String(item.storageKey || item.src || "").split("?")[0];
  const match = source.match(/\.([a-z0-9]{2,5})$/i);
  if (match) return match[1].toLowerCase();
  if (item.type === "video") return "mp4";
  if (item.type === "audio") return "mp3";
  return "png";
}

function fileNameOf(item, used) {
  const base = String(creationTitleForDisplay(item) || "作品").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 40) || "作品";
  const ext = extensionOf(item);
  let name = `${base}.${ext}`;
  let index = 2;
  while (used.has(name)) {
    name = `${base}-${index}.${ext}`;
    index += 1;
  }
  used.add(name);
  return name;
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
  const creationsQuery = useQuery({
    queryKey: ["creations", filter, query, timeRange, projectFilter],
    queryFn: () => fetchCreations({
      category: filter === "all" ? undefined : filter,
      q: query || undefined,
      project: projectFilter === "all" ? undefined : projectFilter,
      from: createdFrom(timeRange),
    }),
    refetchInterval: 10000,
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

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
        if (!response.ok) throw new Error(`下载失败：${item.title || "作品"}`);
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
    <div className="creations-page">
      <header className="page-heading">
        <div><h1>我的创作</h1><p>查看、播放与下载你生成的全部作品。</p></div>
        <div className="creation-stat"><strong>{visible.length}</strong><span>全部作品</span></div>
      </header>
      <section className="creation-toolbar">
        <div className="filter-tabs">{[{ id: "all", label: "全部" }, { id: "video", label: "视频" }, { id: "image", label: "图片" }, { id: "audio", label: "语音" }].map((item) => (
          <button key={item.id} type="button" className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>
            {item.id === "video" ? <Video size={15} /> : item.id === "image" ? <Image size={15} /> : item.id === "audio" ? <AudioLines size={15} /> : <SlidersHorizontal size={15} />}
            {item.label}
          </button>
        ))}</div>
        <div className="library-tools">
          <select aria-label="时间范围" value={timeRange} onChange={(event) => setTimeRange(event.target.value)}>
            {TIME_RANGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select aria-label="所属项目" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            {PROJECT_FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <label><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索提示词或作品" /></label>
          <button type="button" aria-label="网格视图" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid3X3 size={16} /></button>
          <button type="button" aria-label="列表视图" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={16} /></button>
        </div>
      </section>
      {visible.length > 0 && (
        <div className="creation-batch">
          <span>已选 {visible.filter((item) => picked.includes(item.id)).length} 项</span>
          <button className="button button--ghost" type="button" onClick={toggleVisible}>{allVisiblePicked ? "取消全选" : "全选当前"}</button>
          <button className="button button--primary" type="button" disabled={packing || !picked.some((id) => visibleIds.includes(id))} onClick={downloadPicked}>
            <Download size={14} /> {packing ? "打包中…" : "打包下载"}
          </button>
          {picked.length > 0 && <button className="button button--ghost" type="button" onClick={() => setPicked([])}>清除选择</button>}
        </div>
      )}
      {notice && <p className={`creation-notice ${notice.tone === "error" ? "is-error" : ""}`}>{notice.text}</p>}
      <section className={`creation-grid ${view === "list" ? "creation-grid--list" : ""}`}>
        {visible.map((item) => {
          const title = creationTitleForDisplay(item);
          const promptText = promptForDisplay(item.prompt) || "—";
          return (
          <article className={`creation-card ${item.type === "audio" ? "creation-card--audio" : ""} ${picked.includes(item.id) ? "is-picked" : ""}`} key={item.id}>
            <label className="creation-pick">
              <input type="checkbox" checked={picked.includes(item.id)} onChange={() => togglePicked(item.id)} aria-label={`选择${title}`} />
            </label>
            <button className={`creation-card__preview ${item.type === "audio" ? "is-audio" : ""}`} type="button" onClick={() => setSelected(item)} aria-label={`查看作品：${title}`}>
              <MediaCover item={item} />
              <span className={`creation-type creation-type--${item.type}`}>{typeLabel(item.type)}</span>
              <span className="creation-spec">{item.type === "audio" ? "音频" : <>{item.ratio} · {item.resolution}{item.type === "video" ? ` · ${item.duration}` : ""}</>}</span>
              <span className="creation-play">{item.type === "video" ? <Play size={17} fill="currentColor" /> : item.type === "audio" ? <AudioLines size={17} /> : <Expand size={17} />}</span>
            </button>
            <div className="creation-card__body">
              <div>
                <strong title={title}>{title}</strong>
                <small className="creation-card__model" title={item.model || undefined}>{item.model || "未记录模型"}</small>
                <p title={promptText}>{promptText}</p>
              </div>
              <footer>
                <span><CalendarDays size={12} /> {item.createdAtLabel} · {item.elapsed}</span>
                <div className="creation-card__actions">
                  <a href={item.src} download aria-label={`下载${title}`}><Download size={15} /></a>
                  <button type="button" className="danger" aria-label={`删除${title}`} onClick={() => confirmDelete(item)}><Trash2 size={15} /></button>
                </div>
              </footer>
            </div>
          </article>
          );
        })}
      </section>
      {selected && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <section className="creation-viewer" role="dialog" aria-modal="true">
            <header>
              <div><span className="modal-kicker">CREATION PREVIEW</span><h2>{creationTitleForDisplay(selected)}</h2></div>
              <button className="modal-close" type="button" aria-label="关闭作品预览" onClick={() => setSelected(null)}><X size={19} /></button>
            </header>
            <div className={`creation-viewer__media ${selected.type === "audio" ? "is-audio" : ""}`}>
              {selected.type === "video"
                ? <video src={selected.src} poster={selected.poster} controls playsInline />
                : selected.type === "audio"
                  ? <div className="creation-audio-viewer"><span><AudioLines size={26} /></span><div><small>音频作品</small><strong>{creationTitleForDisplay(selected)}</strong></div><audio src={selected.src} controls preload="metadata" /></div>
                  : <img src={selected.src} alt={creationTitleForDisplay(selected)} />}
            </div>
            <div className="creation-viewer__meta">
              <div><span>生成提示</span><p>{promptForDisplay(selected.prompt) || "—"}</p></div>
              <dl>
                <div><dt>规格</dt><dd>{selected.type === "audio" ? "音频" : `${selected.ratio} · ${selected.resolution}${selected.type === "video" ? ` · ${selected.duration}` : ""}`}</dd></div>
                <div><dt>模型</dt><dd>{selected.model || "未记录模型"}</dd></div>
                <div><dt>耗时</dt><dd>{selected.elapsed || "—"}</dd></div>
                <div><dt>项目</dt><dd>{selected.projectName || "未归入项目"}</dd></div>
                <div><dt>消耗</dt><dd>{selected.cost} 积分</dd></div>
              </dl>
              <div className="creation-viewer__actions">
                <a className="button button--primary" href={selected.src} download><Download size={16} /> 下载到本地</a>
                <button className="button button--ghost" type="button" onClick={() => copyLink(selected)}><Copy size={16} /> 复制链接</button>
                <button className="button button--ghost" type="button" disabled={saveMutation.isPending && saveMutation.variables === selected.id} onClick={() => saveMutation.mutate(selected.id)}>
                  {savedIds.includes(selected.id) ? <Check size={16} /> : <FolderInput size={16} />}
                  {savedIds.includes(selected.id) ? "已存入素材库" : "存入素材库"}
                </button>
                <button className="button button--ghost" type="button" onClick={() => reuse(selected)}><Sparkles size={16} /> 基于此生成</button>
                <button className="button button--danger" type="button" onClick={() => confirmDelete(selected)}><Trash2 size={16} /> 删除</button>
              </div>
            </div>
          </section>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        eyebrow="我的创作"
        title="删除作品？"
        message={deleteTarget
          ? `确定删除作品「${creationTitleForDisplay(deleteTarget)}」吗？删除后不可恢复。`
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
    </div>
  );
}
