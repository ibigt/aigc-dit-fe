import { AudioLines, CalendarDays, Download, Expand, Grid3X3, Image, List, Play, Search, SlidersHorizontal, Trash2, Video, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteCreation, fetchCreations } from "../api/creations.js";
import { MediaCover } from "../lib/MediaCover.jsx";
import { formatDateTime, mediaUrl } from "../lib/media.js";

export function MyCreations() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("grid");
  const [selected, setSelected] = useState(null);
  const creationsQuery = useQuery({
    queryKey: ["creations", filter, query],
    queryFn: () => fetchCreations({ category: filter === "all" ? undefined : filter, q: query || undefined }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteCreation,
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["creations"] });
      setSelected((current) => (current?.id === id ? null : current));
    },
  });
  const creations = useMemo(() => (creationsQuery.data || []).map((item) => ({
    ...item,
    src: mediaUrl(item.src || item.storageKey),
    poster: mediaUrl(item.poster || item.posterKey),
    createdAt: formatDateTime(item.createdAt),
    duration: item.duration || (item.durationSec ? `${item.durationSec} 秒` : "—"),
    cost: item.creditCost || 0,
    model: item.modelName,
    type: item.type || item.category,
  })), [creationsQuery.data]);

  function confirmDelete(item) {
    if (!window.confirm(`确定删除作品“${item.title || "未命名"}”吗？删除后不可恢复。`)) return;
    deleteMutation.mutate(item.id);
  }

  return (
    <div className="creations-page">
      <header className="page-heading">
        <div><h1>我的创作</h1><p>查看、播放与下载你生成的全部作品。</p></div>
        <div className="creation-stat"><strong>{creations.length}</strong><span>全部作品</span></div>
      </header>
      <section className="creation-toolbar">
        <div className="filter-tabs">{[{ id: "all", label: "全部" }, { id: "video", label: "视频" }, { id: "image", label: "图片" }, { id: "audio", label: "语音" }].map((item) => (
          <button key={item.id} type="button" className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>
            {item.id === "video" ? <Video size={15} /> : item.id === "image" ? <Image size={15} /> : item.id === "audio" ? <AudioLines size={15} /> : <SlidersHorizontal size={15} />}
            {item.label}
          </button>
        ))}</div>
        <div className="library-tools">
          <label><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索提示词或作品" /></label>
          <button type="button" aria-label="网格视图" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid3X3 size={16} /></button>
          <button type="button" aria-label="列表视图" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={16} /></button>
        </div>
      </section>
      <section className={`creation-grid ${view === "list" ? "creation-grid--list" : ""}`}>
        {creations.map((item) => (
          <article className="creation-card" key={item.id}>
            <button className="creation-card__preview" type="button" onClick={() => setSelected(item)} aria-label={`查看作品：${item.title}`}>
              <MediaCover item={item} />
              <span className="creation-spec">{item.type === "audio" ? "音频" : <>{item.ratio} · {item.resolution}{item.type === "video" ? ` · ${item.duration}` : ""}</>}</span>
              <span className="creation-play">{item.type === "video" ? <Play size={17} fill="currentColor" /> : item.type === "audio" ? <AudioLines size={17} /> : <Expand size={17} />}</span>
            </button>
            <div className="creation-card__body">
              <div><strong>{item.title}</strong><p>{item.prompt}</p></div>
              <footer>
                <span><CalendarDays size={12} /> {item.createdAt}</span>
                <div className="creation-card__actions">
                  <a href={item.src} download aria-label={`下载${item.title}`}><Download size={15} /></a>
                  <button type="button" className="danger" aria-label={`删除${item.title}`} onClick={() => confirmDelete(item)}><Trash2 size={15} /></button>
                </div>
              </footer>
            </div>
          </article>
        ))}
      </section>
      {selected && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <section className="creation-viewer" role="dialog" aria-modal="true">
            <header>
              <div><span className="modal-kicker">CREATION PREVIEW</span><h2>{selected.title}</h2></div>
              <button className="modal-close" type="button" aria-label="关闭作品预览" onClick={() => setSelected(null)}><X size={19} /></button>
            </header>
            <div className="creation-viewer__media">
              {selected.type === "video"
                ? <video src={selected.src} poster={selected.poster} controls playsInline />
                : selected.type === "audio"
                  ? <audio src={selected.src} controls preload="metadata" />
                  : <img src={selected.src} alt={selected.title} />}
            </div>
            <div className="creation-viewer__meta">
              <div><span>生成提示</span><p>{selected.prompt}</p></div>
              <dl>
                <div><dt>规格</dt><dd>{selected.type === "audio" ? "音频" : `${selected.ratio} · ${selected.resolution}${selected.type === "video" ? ` · ${selected.duration}` : ""}`}</dd></div>
                <div><dt>模型</dt><dd>{selected.model}</dd></div>
                <div><dt>消耗</dt><dd>{selected.cost} 积分</dd></div>
              </dl>
              <div className="creation-viewer__actions">
                <a className="button button--primary" href={selected.src} download><Download size={16} /> 下载作品</a>
                <button className="button button--danger" type="button" onClick={() => confirmDelete(selected)}><Trash2 size={16} /> 删除</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
