import { AudioLines, Check, Clock3, Download, Filter, Grid3X3, Image, List, Plus, Search, Trash2, Upload, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteAsset, fetchAssets, uploadAsset } from "../api/assets.js";
import { MediaCover } from "../lib/MediaCover.jsx";
import { formatDateTime, mediaUrl } from "../lib/media.js";
import { validateAssetFile } from "../lib/assetUpload.js";
import { formatMediaMeta, runBatchDelete } from "../lib/assetBatch.js";
import { ConfirmDialog } from "./ConfirmDialog.jsx";

const AUTO_DISMISS_DELAY_MS = 3000;
const ORDER_OPTIONS = [
  { value: "time_desc", label: "最新上传" },
  { value: "time_asc", label: "最早上传" },
];

export function AssetLibrary() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("grid");
  const [query, setQuery] = useState("");
  const [orderBy, setOrderBy] = useState("time_desc");
  const [selected, setSelected] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [batchDelete, setBatchDelete] = useState(null);
  const [pickedIds, setPickedIds] = useState(() => new Set());
  const [batchToast, setBatchToast] = useState(null);
  const [audioQueue, setAudioQueue] = useState([]);
  const [audioName, setAudioName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [batchUploads, setBatchUploads] = useState([]);
  const [batchExpanded, setBatchExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef(null);
  const dropRef = useRef(null);
  const audioFile = audioQueue[0] || null;
  const assetsQuery = useQuery({
    queryKey: ["assets", filter, query, orderBy],
    queryFn: () => fetchAssets({
      kind: filter === "all" ? undefined : filter,
      q: query || undefined,
      orderBy: orderBy === "time_desc" ? undefined : orderBy,
    }),
  });
  const uploadMutation = useMutation({
    mutationFn: ({ file, name, onProgress }) => uploadAsset(file, { name, onProgress }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAsset,
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setSelected((current) => (current?.id === id ? null : current));
      setPickedIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    },
  });
  const assets = useMemo(
    () => (assetsQuery.data || []).map((item) => ({
      ...item,
      title: item.title || item.name,
      type: item.type || item.kind,
      src: mediaUrl(item.src || item.storageKey),
      poster: mediaUrl(item.poster || item.posterKey),
      meta: formatMediaMeta(item),
      createdAt: formatDateTime(item.createdAt),
    })),
    [assetsQuery.data],
  );

  const pickedItems = useMemo(
    () => assets.filter((item) => pickedIds.has(item.id)),
    [assets, pickedIds],
  );

  const batchSummary = useMemo(() => {
    if (batchUploads.length === 0) return null;
    const total = batchUploads.length;
    const done = batchUploads.filter((item) => item.status === "done").length;
    const errored = batchUploads.filter((item) => item.status === "error").length;
    const inFlight = total - done - errored;
    const totalProgress = batchUploads.reduce((sum, item) => sum + (item.progress || 0), 0);
    const overall = total === 0 ? 0 : Math.round(totalProgress / total);
    return { total, done, errored, inFlight, overall };
  }, [batchUploads]);

  useEffect(() => {
    if (pickedIds.size === 0 || batchDelete) return;
    const known = new Set(assets.map((item) => item.id));
    setPickedIds((current) => {
      let changed = false;
      const next = new Set();
      for (const id of current) {
        if (known.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [assets, pickedIds, batchDelete]);

  useEffect(() => {
    if (!audioFile) return;
    setAudioName(audioFile.name.replace(/\.[^.]+$/, ""));
    setUploadProgress(0);
  }, [audioFile]);

  useEffect(() => {
    if (!batchToast) return;
    const delay = batchToast.failed.length > 0 ? 8000 : 3000;
    const timer = setTimeout(() => setBatchToast(null), delay);
    return () => clearTimeout(timer);
  }, [batchToast]);

  function updateBatchUpload(id, patch) {
    setBatchUploads((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function uploadBatchFile(item) {
    try {
      await uploadAsset(item.file, { onProgress: (progress) => updateBatchUpload(item.id, { progress }) });
      updateBatchUpload(item.id, { progress: 100, status: "done" });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setTimeout(() => {
        setBatchUploads((current) => current.filter((entry) => entry.id !== item.id));
      }, AUTO_DISMISS_DELAY_MS);
    } catch (error) {
      updateBatchUpload(item.id, { status: "error", error: error?.message || "上传失败" });
    }
  }

  function onUpload(event) {
    const files = Array.from(event.target.files || []);
    enqueueFiles(files);
    event.target.value = "";
  }

  const enqueueFiles = useCallback((files) => {
    if (!files.length) return;
    const checked = files.map((file, index) => ({
      file,
      validation: validateAssetFile(file),
      id: `${Date.now()}-${index}-${file.name}`,
    }));
    const audioFiles = checked.filter((item) => item.validation.valid && item.validation.kind === "audio").map((item) => item.file);
    const batchItems = checked.filter((item) => item.validation.kind !== "audio").map((item) => ({
      id: item.id,
      file: item.file,
      progress: 0,
      status: item.validation.valid ? "uploading" : "error",
      error: item.validation.message,
    }));
    if (batchItems.length) {
      setBatchUploads((current) => [...batchItems, ...current].slice(0, 20));
      batchItems.filter((item) => item.status === "uploading").forEach(uploadBatchFile);
    }
    if (audioFiles.length) setAudioQueue((current) => [...current, ...audioFiles]);
    const invalidAudio = checked.filter((item) => !item.validation.valid && item.validation.kind === "audio").map((item) => ({ id: item.id, file: item.file, progress: 0, status: "error", error: item.validation.message }));
    if (invalidAudio.length) setBatchUploads((current) => [...invalidAudio, ...current].slice(0, 20));
  }, [uploadBatchFile]);

  useEffect(() => {
    const node = dropRef.current;
    if (!node) return;
    let counter = 0;
    const onEnter = (event) => {
      if (!event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
      counter += 1;
      setIsDragging(true);
    };
    const onOver = (event) => {
      if (!event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event) => {
      counter = Math.max(0, counter - 1);
      if (counter === 0) setIsDragging(false);
    };
    const onDrop = (event) => {
      event.preventDefault();
      counter = 0;
      setIsDragging(false);
      const files = Array.from(event.dataTransfer?.files || []);
      enqueueFiles(files);
    };
    node.addEventListener("dragenter", onEnter);
    node.addEventListener("dragover", onOver);
    node.addEventListener("dragleave", onLeave);
    node.addEventListener("drop", onDrop);
    return () => {
      node.removeEventListener("dragenter", onEnter);
      node.removeEventListener("dragover", onOver);
      node.removeEventListener("dragleave", onLeave);
      node.removeEventListener("drop", onDrop);
    };
  }, [enqueueFiles]);

  function confirmAudioUpload(event) {
    event.preventDefault();
    if (!audioFile || !audioName.trim() || uploadMutation.isPending) return;
    setUploadProgress(0);
    uploadMutation.mutate({
      file: audioFile,
      name: audioName,
      onProgress: setUploadProgress,
    }, {
      onSuccess: () => setAudioQueue((current) => current.slice(1)),
    });
  }

  function closeAudioUpload() {
    if (uploadMutation.isPending) return;
    setAudioQueue((current) => current.slice(1));
  }

  function confirmDelete(item) {
    setDeleteTarget(item);
  }

  function togglePicked(item) {
    setPickedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }

  function clearPicked() {
    setPickedIds(new Set());
  }

  function askBatchDelete() {
    if (pickedItems.length === 0) return;
    setBatchDelete({ items: pickedItems });
  }

  async function runBatchDeleteNow() {
    if (!batchDelete || batchDelete.busy) return;
    setBatchDelete({ items: batchDelete.items, busy: true });
    const result = await runBatchDelete(batchDelete.items, deleteAsset);
    queryClient.invalidateQueries({ queryKey: ["assets"] });
    setPickedIds((current) => {
      if (current.size === 0) return current;
      const next = new Set(current);
      for (const failed of result.failed) next.delete(failed.id);
      for (const item of result.succeeded) next.delete(item.id);
      return next;
    });
    setBatchToast(result);
    setBatchDelete(null);
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
        <div className="library-toolbar__right">
          {pickedIds.size > 0 && (
            <div className="asset-batch-bar" role="status">
              <strong>已选 {pickedIds.size} 项</strong>
              <button type="button" onClick={clearPicked}>取消选择</button>
              <button className="button button--danger" type="button" onClick={askBatchDelete}><Trash2 size={15} /> 删除所选</button>
            </div>
          )}
          {batchToast && (
            <div className="asset-batch-toast" role="status">
              <span>已删除 {batchToast.succeeded.length} 个素材{batchToast.failed.length > 0 ? `，${batchToast.failed.length} 个失败` : ""}</span>
              {batchToast.failed.length > 0 && (
                <small>{batchToast.failed.map((entry) => entry.name).join("、")}</small>
              )}
              <button type="button" onClick={() => setBatchToast(null)}><X size={14} /></button>
            </div>
          )}
          <div className="library-tools">

            <div className="asset-order">
              <select value={orderBy} onChange={(event) => setOrderBy(event.target.value)} aria-label="素材排序">
                {ORDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <label><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材" /></label>
            <button type="button" aria-label="筛选素材"><Filter size={16} /></button>
            <span />
            <button type="button" aria-label="网格视图" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid3X3 size={16} /></button>
            <button type="button" aria-label="列表视图" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={16} /></button>
          </div>
        </div>
      </section>
      {batchSummary && (
        <section className="asset-upload-batch" aria-live="polite">
          <header>
            <strong>上传队列</strong>
            <span>
              {batchSummary.done}/{batchSummary.total} 完成
              {batchSummary.errored > 0 ? ` · ${batchSummary.errored} 失败` : ""}
            </span>
            <i className="asset-upload-batch__bar"><b style={{ width: `${batchSummary.overall}%` }} /></i>
            <em>{batchSummary.inFlight > 0 ? `${batchSummary.overall}%` : "已完成"}</em>
            {batchSummary.done + batchSummary.errored > 0 && (
              <button type="button" onClick={() => setBatchUploads((current) => current.filter((item) => item.status === "uploading"))}>清除已结束</button>
            )}
            {batchSummary.errored > 0 && (
              <button type="button" onClick={() => setBatchExpanded((value) => !value)}>
                {batchExpanded ? "收起详情" : "查看失败"}
              </button>
            )}
          </header>
          {batchExpanded && batchSummary.errored > 0 && (
            <ul>
              {batchUploads.filter((item) => item.status === "error").map((item) => (
                <li key={item.id} className="asset-upload-batch__item asset-upload-batch__item--error">
                  <span className="asset-upload-batch__name" title={item.error}>{item.file.name}</span>
                  <span className="asset-upload-batch__pct">{item.error || "上传失败"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className={`asset-grid ${view === "list" ? "asset-grid--list" : ""} ${isDragging ? "asset-grid--drag" : ""}`} ref={dropRef}>
        <button className="upload-card" type="button" onClick={() => fileRef.current?.click()}><span><Plus size={22} /></span><strong>{isDragging ? "松开即可上传" : "上传新素材"}</strong><small>图片、视频或音频</small></button>
        {isDragging && <div className="asset-grid__drop-mask" aria-hidden="true" />}
        {assets.map((item) => {
          const isPicked = pickedIds.has(item.id);
          const meta = item.meta;
          return (
            <article className={`asset-card ${isPicked ? "asset-card--picked" : ""}`} key={item.id}>
              <div className="asset-card__media">
                <button className="asset-card__preview" type="button" onClick={() => setSelected(item)} aria-label={`查看素材：${item.title}`}>
                  <MediaCover item={item} />
                  <div className="asset-card__type">{item.type === "audio" ? <><AudioLines size={13} /> 音频</> : item.type === "video" ? <><Video size={13} /> 视频</> : <><Image size={13} /> 图片</>}</div>
                </button>
                <label className="asset-card__pick" onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={isPicked} onChange={() => togglePicked(item)} aria-label={`选择素材：${item.title}`} />
                </label>
                <button className="asset-menu" type="button" aria-label={`删除素材：${item.title}`} onClick={() => confirmDelete(item)}><Trash2 size={15} /></button>
              </div>
              <div className="asset-card__info">
                <div>
                  <strong>{item.title}</strong>
                  {(meta.size || meta.duration) ? (
                    <small>
                      {meta.size ? <span>{meta.size}</span> : null}
                      {meta.size && meta.duration ? <i aria-hidden="true">·</i> : null}
                      {meta.duration ? <span>{meta.duration}</span> : null}
                    </small>
                  ) : (
                    <small>{item.createdAt}</small>
                  )}
                </div>
                <span title="已入库"><Check size={13} /></span>
              </div>
            </article>
          );
        })}
      </section>
      <div className="library-summary"><Clock3 size={15} /> 共 {assets.length} 个素材<button type="button"><Download size={15} /> 导出清单</button></div>
      {audioFile && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAudioUpload(); }}>
          <section className="asset-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="audio-upload-title">
            <header>
              <div><span className="modal-kicker">AUDIO ASSET</span><h2 id="audio-upload-title">上传音频素材</h2><p>确认素材名称后上传，文件将保存到音频库。</p></div>
              <button className="modal-close" type="button" aria-label="关闭音频上传" disabled={uploadMutation.isPending} onClick={closeAudioUpload}><X size={19} /></button>
            </header>
            <form onSubmit={confirmAudioUpload}>
              <div className="asset-upload-file"><AudioLines size={22} /><span><strong>{audioFile.name}</strong><small>{(audioFile.size / 1024 / 1024).toFixed(2)} MB{audioQueue.length > 1 ? ` · 另有 ${audioQueue.length - 1} 个待上传` : ""}</small></span></div>
              <label><span>素材名称</span><input autoFocus maxLength={128} value={audioName} disabled={uploadMutation.isPending} onChange={(event) => setAudioName(event.target.value)} placeholder="请输入音频素材名称" /></label>
              {(uploadMutation.isPending || uploadProgress > 0) && <div className="asset-upload-progress" aria-live="polite"><div><span>{uploadProgress < 100 ? "正在上传…" : "正在保存…"}</span><b>{uploadProgress}%</b></div><i><span style={{ width: `${uploadProgress}%` }} /></i></div>}
              {uploadMutation.isError && <p className="asset-upload-error">{uploadMutation.error?.message || "上传失败，请重试"}</p>}
              <footer><button className="button button--ghost" type="button" disabled={uploadMutation.isPending} onClick={closeAudioUpload}>取消</button><button className="button button--primary" type="submit" disabled={!audioName.trim() || uploadMutation.isPending}>{uploadMutation.isPending ? "上传中…" : "确认上传"}</button></footer>
            </form>
          </section>
        </div>
      )}
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
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        eyebrow="素材库"
        title="删除素材？"
        message={deleteTarget
          ? `确定删除素材「${deleteTarget.title || "未命名"}」吗？删除后不可恢复。`
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
      <ConfirmDialog
        open={Boolean(batchDelete)}
        eyebrow="素材库"
        title="批量删除所选素材？"
        message={batchDelete
          ? `即将删除 ${batchDelete.items.length} 个素材，操作不可恢复。`
          : ""}
        confirmLabel="删除"
        busy={Boolean(batchDelete?.busy)}
        busyLabel="删除中…"
        onClose={() => { if (!batchDelete?.busy) setBatchDelete(null); }}
        onConfirm={runBatchDeleteNow}
      />
    </div>
  );
}
