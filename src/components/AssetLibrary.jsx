import { AudioLines, Check, Clock3, Download, Filter, Grid3X3, Image, List, Plus, Search, Trash2, Upload, Video, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteAsset, fetchAssets, uploadAsset } from "../api/assets.js";
import { MediaCover } from "../lib/MediaCover.jsx";
import { formatDateTime, mediaUrl } from "../lib/media.js";

export function AssetLibrary() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("grid");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const fileRef = useRef(null);
  const assetsQuery = useQuery({
    queryKey: ["assets", filter, query],
    queryFn: () => fetchAssets({ kind: filter === "all" ? undefined : filter, q: query || undefined }),
  });
  const uploadMutation = useMutation({
    mutationFn: uploadAsset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAsset,
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setSelected((current) => (current?.id === id ? null : current));
    },
  });
  const assets = useMemo(
    () => (assetsQuery.data || []).map((item) => ({
      ...item,
      title: item.title || item.name,
      type: item.type || item.kind,
      src: mediaUrl(item.src || item.storageKey),
      poster: mediaUrl(item.poster || item.posterKey),
      createdAt: formatDateTime(item.createdAt),
    })),
    [assetsQuery.data],
  );

  function onUpload(event) {
    const files = Array.from(event.target.files || []);
    files.forEach((file) => uploadMutation.mutate(file));
    event.target.value = "";
  }

  function confirmDelete(item) {
    if (!window.confirm(`确定删除素材“${item.title || "未命名"}”吗？删除后不可恢复。`)) return;
    deleteMutation.mutate(item.id);
  }

  return (
    <div className="library-page">
      <header className="page-heading">
        <div><h1>素材库</h1><p>集中管理你的图片、视频与音频资产，创作和角色音色配置均可直接引用。</p></div>
        <button className="button button--primary" type="button" onClick={() => fileRef.current?.click()}><Upload size={17} /> 上传素材</button>
        <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*,.mp3,.wav,.m4a,.aac" hidden onChange={onUpload} />
      </header>
      <section className="library-toolbar">
        <div className="filter-tabs">{[{ id: "all", label: "全部", icon: Grid3X3 }, { id: "image", label: "图片", icon: Image }, { id: "video", label: "视频", icon: Video }, { id: "audio", label: "音频", icon: AudioLines }].map((item) => {
          const Icon = item.icon;
          return <button className={filter === item.id ? "active" : ""} type="button" key={item.id} onClick={() => setFilter(item.id)}><Icon size={15} />{item.label}</button>;
        })}</div>
        <div className="library-tools">
          <label><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材" /></label>
          <button type="button" aria-label="筛选素材"><Filter size={16} /></button>
          <span />
          <button type="button" aria-label="网格视图" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid3X3 size={16} /></button>
          <button type="button" aria-label="列表视图" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={16} /></button>
        </div>
      </section>
      <section className={`asset-grid ${view === "list" ? "asset-grid--list" : ""}`}>
        <button className="upload-card" type="button" onClick={() => fileRef.current?.click()}><span><Plus size={22} /></span><strong>上传新素材</strong><small>图片、视频或音频</small></button>
        {assets.map((item) => (
          <article className="asset-card" key={item.id}>
            <div className="asset-card__media">
              <button className="asset-card__preview" type="button" onClick={() => setSelected(item)} aria-label={`查看素材：${item.title}`}>
                <MediaCover item={item} />
                <div className="asset-card__type">{item.type === "audio" ? <><AudioLines size={13} /> 音频</> : item.type === "video" ? <><Video size={13} /> 视频</> : <><Image size={13} /> 图片</>}</div>
              </button>
              <button className="asset-menu" type="button" aria-label={`删除素材：${item.title}`} onClick={() => confirmDelete(item)}><Trash2 size={15} /></button>
            </div>
            <div className="asset-card__info">
              <div><strong>{item.title}</strong><small>{item.createdAt}</small></div>
              <span title="已入库"><Check size={13} /></span>
            </div>
          </article>
        ))}
      </section>
      <div className="library-summary"><Clock3 size={15} /> 共 {assets.length} 个素材<button type="button"><Download size={15} /> 导出清单</button></div>
      {selected && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <section className="creation-viewer" role="dialog" aria-modal="true">
            <header>
              <div><span className="modal-kicker">ASSET PREVIEW</span><h2>{selected.title}</h2></div>
              <button className="modal-close" type="button" aria-label="关闭素材预览" onClick={() => setSelected(null)}><X size={19} /></button>
            </header>
            <div className="creation-viewer__media">
              {selected.type === "audio"
                ? <div className="asset-audio-player"><AudioLines size={42} /><strong>{selected.title}</strong><audio src={selected.src} controls preload="metadata" /></div>
                : selected.type === "video"
                  ? <video src={selected.src} poster={selected.poster} controls playsInline />
                  : <img src={selected.src} alt={selected.title} />}
            </div>
            <div className="creation-viewer__meta">
              <div><span>入库时间</span><p>{selected.createdAt}</p></div>
              <div className="creation-viewer__actions">
                <a className="button button--primary" href={selected.src} download><Download size={16} /> 下载素材</a>
                <button className="button button--danger" type="button" onClick={() => confirmDelete(selected)}><Trash2 size={16} /> 删除</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
