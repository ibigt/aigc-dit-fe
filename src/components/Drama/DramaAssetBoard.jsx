import { ImagePlus, Lock, MoreHorizontal, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bindDramaImageModel,
  createDramaAsset,
  deleteDramaAsset,
  extractDramaAssets,
  fetchDramaAssets,
  fetchDramaImageModels,
  generateDramaAssetImage,
  lockDramaAsset,
  lockDramaScript,
  pollDramaAssetGenerate,
  updateDramaAsset,
  uploadDramaAssetImage,
} from "../../api/drama.js";
import { mediaUrl } from "../../lib/media.js";

const TYPES = ["角色", "场景", "道具"];
const RESOLUTIONS = ["1K", "2K"];
const emptyCreate = { name: "", type: "角色" };

function promptOf(asset) {
  return asset?.imagePrompt || asset?.description || "";
}

function statusLabel(status) {
  if (status === "已锁定") return "已确认";
  return status || "未开始";
}

export function DramaAssetBoard({ series, episode }) {
  const queryClient = useQueryClient();
  const episodeId = episode?.id;
  const seriesId = series?.id;
  const fileRef = useRef(null);
  const [typeFilter, setTypeFilter] = useState("全部");
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [imageModelId, setImageModelId] = useState(series?.imageModelId || "");
  const [resolution, setResolution] = useState("1K");
  const [prompts, setPrompts] = useState({});
  const [menuId, setMenuId] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [busy, setBusy] = useState({});
  const [actionError, setActionError] = useState("");

  const imageModelsQuery = useQuery({
    queryKey: ["drama-image-models"],
    queryFn: fetchDramaImageModels,
  });
  const assetsQuery = useQuery({
    queryKey: ["drama-assets", episodeId],
    queryFn: () => fetchDramaAssets(episodeId),
    enabled: Boolean(episodeId),
  });

  const imageModels = imageModelsQuery.data || [];
  const assets = assetsQuery.data || [];
  const scriptLocked = episode?.status === "已锁定";

  useEffect(() => {
    setImageModelId(series?.imageModelId || "");
  }, [series?.imageModelId]);

  useEffect(() => {
    setPrompts((current) => {
      const next = { ...current };
      for (const item of assets) {
        if (next[item.id] === undefined) next[item.id] = promptOf(item);
      }
      return next;
    });
  }, [assets]);

  const filtered = useMemo(() => {
    if (typeFilter === "全部") return assets;
    return assets.filter((item) => item.type === typeFilter);
  }, [assets, typeFilter]);

  const counts = useMemo(() => {
    const byType = { 角色: 0, 场景: 0, 道具: 0 };
    for (const item of assets) {
      if (byType[item.type] != null) byType[item.type] += 1;
    }
    return { 全部: assets.length, ...byType };
  }, [assets]);

  const generatedCount = assets.filter((item) => item.imageStorageKey).length;
  const confirmedCount = assets.filter((item) => item.status === "已锁定").length;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["drama-assets", episodeId] });
    queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
  };

  const markBusy = (id, action, on) => {
    setBusy((current) => {
      const next = { ...current };
      const key = `${id}:${action}`;
      if (on) next[key] = true;
      else delete next[key];
      return next;
    });
  };
  const isBusy = (id, action) => Boolean(busy[`${id}:${action}`]);

  const bindMutation = useMutation({
    mutationFn: (id) => bindDramaImageModel(seriesId, Number(id)),
    onSuccess: invalidate,
  });
  const extractMutation = useMutation({
    mutationFn: () => extractDramaAssets(episodeId),
    onSuccess: invalidate,
  });
  const lockScriptMutation = useMutation({
    mutationFn: () => lockDramaScript(episodeId),
    onSuccess: invalidate,
  });
  const createMutation = useMutation({
    mutationFn: () => createDramaAsset(episodeId, {
      name: createForm.name.trim(),
      type: createForm.type,
    }),
    onSuccess: () => {
      setCreating(false);
      setCreateForm(emptyCreate);
      invalidate();
    },
  });

  async function savePrompt(asset) {
    const imagePrompt = (prompts[asset.id] ?? promptOf(asset)).trim();
    markBusy(asset.id, "save", true);
    try {
      await updateDramaAsset(asset.id, { imagePrompt });
      invalidate();
    } finally {
      markBusy(asset.id, "save", false);
    }
  }

  async function generate(asset) {
    const imagePrompt = (prompts[asset.id] ?? promptOf(asset)).trim();
    if (!imagePrompt) return;
    markBusy(asset.id, "generate", true);
    try {
      await updateDramaAsset(asset.id, { imagePrompt });
      const result = await generateDramaAssetImage(asset.id, { resolution });
      await pollDramaAssetGenerate(asset.id, result.task.id);
      invalidate();
    } finally {
      markBusy(asset.id, "generate", false);
    }
  }

  async function confirm(asset) {
    const imagePrompt = (prompts[asset.id] ?? promptOf(asset)).trim();
    markBusy(asset.id, "lock", true);
    try {
      await updateDramaAsset(asset.id, { imagePrompt });
      await lockDramaAsset(asset.id);
      invalidate();
    } finally {
      markBusy(asset.id, "lock", false);
    }
  }

  async function remove(asset) {
    markBusy(asset.id, "delete", true);
    try {
      await deleteDramaAsset(asset.id);
      setMenuId(null);
      invalidate();
    } finally {
      markBusy(asset.id, "delete", false);
    }
  }

  async function onUpload(file) {
    if (!file || !uploadId) return;
    markBusy(uploadId, "upload", true);
    try {
      await uploadDramaAssetImage(uploadId, file);
      invalidate();
    } finally {
      markBusy(uploadId, "upload", false);
      setUploadId(null);
    }
  }

  const modelBound = Boolean(imageModelId);
  const error = bindMutation.error || extractMutation.error || lockScriptMutation.error || createMutation.error;

  return (
    <section className="drama-asset-board">
      <header className="drama-asset-board__bar">
        <div>
          <h2>角色与场景清单</h2>
          <p>页顶选一次图像模型和分辨率。卡片上改提示词即可生图、上传或确认。</p>
        </div>
        <div className="drama-asset-board__controls">
          <label className="drama-asset-model">
            图像模型
            <select
              value={imageModelId}
              onChange={(event) => {
                const value = event.target.value;
                setImageModelId(value);
                if (value) bindMutation.mutate(value);
              }}
            >
              <option value="">{imageModels.length ? "请选择图像模型" : "暂无已启用图像模型"}</option>
              {series?.imageModelId && !imageModels.some((item) => String(item.id) === String(series.imageModelId)) && (
                <option value={series.imageModelId}>{series.imageModelName || "已绑定（当前已停用）"}</option>
              )}
              {imageModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{item.provider ? ` · ${item.provider}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="drama-asset-model">
            分辨率
            <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
              {RESOLUTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </header>

      {!scriptLocked && (
        <div className="drama-asset-gate">
          <Lock size={16} />
          <div>
            <strong>请先锁定分场剧本</strong>
            <p>锁定后可从剧本当中提取角色、场景、道具。未确认的资产不能进分镜。</p>
          </div>
          <button
            className="button button--primary"
            type="button"
            disabled={lockScriptMutation.isPending || !(episode?.sourceText || (episode?.script && Object.keys(episode.script).length))}
            onClick={() => lockScriptMutation.mutate()}
          >
            {lockScriptMutation.isPending ? "锁定中…" : "锁定剧本"}
          </button>
        </div>
      )}

      <div className="drama-asset-toolbar">
        <div className="filter-tabs">
          {["全部", ...TYPES].map((item) => (
            <button key={item} type="button" className={typeFilter === item ? "active" : ""} onClick={() => setTypeFilter(item)}>
              {item} {counts[item] || 0}
            </button>
          ))}
        </div>
        <div className="drama-asset-toolbar__actions">
          <button className="button button--ghost" type="button" disabled={!scriptLocked || extractMutation.isPending} onClick={() => extractMutation.mutate()}>
            <RefreshCw size={14} /> {extractMutation.isPending ? "提取中…" : "从剧本提取"}
          </button>
          <button className="button button--primary" type="button" onClick={() => setCreating(true)}>
            <Plus size={14} /> 新增资产
          </button>
        </div>
      </div>

      {(error || actionError) && <p className="drama-form-error">{error?.message || actionError}</p>}

      {filtered.length === 0 ? (
        <p className="drama-asset-empty">还没有资产。锁定剧本后提取，或点右上角新增。入梦、换装请另建一条。</p>
      ) : (
        <div className="drama-asset-grid drama-asset-grid--cards">
          {filtered.map((item) => {
            const src = mediaUrl(item.imageStorageKey || item.imageUrl);
            const generating = Boolean(item.generating) || isBusy(item.id, "generate");
            const prompt = prompts[item.id] ?? promptOf(item);
            return (
              <article className="drama-asset-tile" key={item.id}>
                <header>
                  <div>
                    <small>{item.type}</small>
                    <strong>{item.name}</strong>
                  </div>
                  <div className="drama-asset-tile__meta">
                    <em className={`drama-status-chip drama-status-chip--${item.status}`}>{statusLabel(item.status)}</em>
                    <button type="button" className="drama-asset-tile__more" aria-label="更多" onClick={() => setMenuId(menuId === item.id ? null : item.id)}>
                      <MoreHorizontal size={16} />
                    </button>
                    {menuId === item.id && (
                      <div className="drama-asset-menu">
                        <button type="button" onClick={() => { setUploadId(item.id); setMenuId(null); fileRef.current?.click(); }}>
                          <Upload size={14} /> 上传图片
                        </button>
                        <button type="button" disabled={generating || isBusy(item.id, "delete")} onClick={() => remove(item).catch((err) => setActionError(err.message))}>
                          <Trash2 size={14} /> 删除
                        </button>
                      </div>
                    )}
                  </div>
                </header>
                <div className={`drama-asset-tile__cover ${generating ? "is-generating" : ""}`}>
                  {src ? <img src={src} alt="" /> : <span><ImagePlus size={22} />等待生成</span>}
                  {generating && <em>生成中</em>}
                </div>
                {item.genErrorMessage && <p className="drama-form-error">{item.genErrorMessage}</p>}
                <label>
                  中文提示词
                  <textarea
                    rows={4}
                    value={prompt}
                    onChange={(event) => setPrompts((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="中性背景参考图，写清外形与服装即可"
                  />
                </label>
                <footer>
                  <button
                    className="button button--ghost"
                    type="button"
                    disabled={!modelBound || generating || !prompt.trim()}
                    onClick={() => generate(item).catch((err) => setActionError(err.message))}
                  >
                    {generating ? "生成中…" : modelBound ? "生成图片" : "先选模型"}
                  </button>
                  <button
                    className="button button--ghost"
                    type="button"
                    disabled={isBusy(item.id, "save") || !prompt.trim()}
                    onClick={() => savePrompt(item).catch((err) => setActionError(err.message))}
                  >
                    {isBusy(item.id, "save") ? "保存中…" : "保存提示词"}
                  </button>
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={isBusy(item.id, "lock") || !item.imageStorageKey || item.status === "已锁定"}
                    onClick={() => confirm(item).catch((err) => setActionError(err.message))}
                  >
                    {item.status === "已锁定" ? "已确认" : isBusy(item.id, "lock") ? "确认中…" : "确认资产"}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {assets.length > 0 && (
        <p className="drama-asset-summary">
          {generatedCount}/{assets.length} 已生成 · {confirmedCount}/{assets.length} 已确认
          {confirmedCount < assets.length ? "。确认后才能进入分镜。" : ""}
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          onUpload(file).catch((err) => setActionError(err.message));
        }}
      />

      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(false)}>
          <section className="model-dialog drama-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>新增资产</h2>
                <p>入梦、换装请另建一条，不要写进同一条提示词。</p>
              </div>
            </header>
            <form onSubmit={(event) => { event.preventDefault(); createMutation.mutate(); }}>
              <label>名称<input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} required maxLength={128} /></label>
              <label>类型
                <select value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}>
                  {TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              {createMutation.isError && <p className="drama-form-error">{createMutation.error.message}</p>}
              <footer>
                <span />
                <div>
                  <button className="button button--ghost" type="button" onClick={() => setCreating(false)}>取消</button>
                  <button className="button button--primary" type="submit" disabled={createMutation.isPending || !createForm.name.trim()}>
                    {createMutation.isPending ? "创建中…" : "创建"}
                  </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

export function dramaAssetsStatus(assets) {
  if (!assets?.length) return "未开始";
  if (assets.every((item) => item.status === "已锁定")) return "已锁定";
  if (assets.some((item) => item.status === "已过期")) return "已过期";
  return "待确认";
}
