import {
  Clapperboard,
  Image as ImageIcon,
  ImagePlus,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react";
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
import { ImageLightbox } from "../../lib/ImageLightbox.jsx";

const TYPES = [
  { id: "角色", label: "角色", Icon: UsersRound },
  { id: "场景", label: "场景", Icon: ImageIcon },
  { id: "道具", label: "道具", Icon: Clapperboard },
];
const RESOLUTIONS = ["1K", "2K"];
const PROMPT_MAX = 4000;
const BATCH_LIMIT = 4;
const emptyCreate = { name: "", meta: "", prompt: "" };

function promptOf(asset) {
  return asset?.imagePrompt || asset?.description || "";
}

function statusLabel(status) {
  if (status === "已锁定") return "已确认";
  return status || "未开始";
}

function stateLabel(tag) {
  if (tag === "dream") return "入梦";
  if (tag === "costume") return "换装";
  return "";
}

function identityOf(asset) {
  if (!asset) return "";
  const invariants = asset.identityInvariants?.trim();
  if (invariants) return invariants;
  const description = asset.description?.trim();
  const prompt = promptOf(asset);
  if (description && description !== prompt) return description;
  const tag = stateLabel(asset.stateTag);
  return [asset.type, tag, statusLabel(asset.status)].filter(Boolean).join(" · ");
}

function cardMeta(asset) {
  const tag = stateLabel(asset.stateTag);
  return [tag, statusLabel(asset.status)].filter(Boolean).join(" · ");
}

function SubjectCreateDialog({ type, pending, error, onClose, onCreate }) {
  const [form, setForm] = useState(emptyCreate);
  return (
    <div className="drama-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <section className="drama-dialog" role="dialog" aria-modal="true">
        <header>
          <div>
            <span>统一资产设定</span>
            <h2>新增{type}</h2>
          </div>
        </header>
        <form
          className="drama-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate(form);
          }}
        >
          <label>
            {type}名称
            <input
              autoFocus
              required
              maxLength={128}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={`输入${type}名称`}
            />
          </label>
          <label>
            设定摘要
            <input
              maxLength={256}
              value={form.meta}
              onChange={(event) => setForm({ ...form, meta: event.target.value })}
              placeholder={`补充${type}身份、环境或用途`}
            />
          </label>
          <label>
            图片提示词
            <textarea
              rows={5}
              maxLength={PROMPT_MAX}
              value={form.prompt}
              onChange={(event) => setForm({ ...form, prompt: event.target.value })}
              placeholder="可留空，创建后会按风格自动生成可改的设定图提示词。入梦、换装请另建一条。"
            />
          </label>
          {error && <p className="drama-form-error">{error}</p>}
          <footer>
            <button type="button" disabled={pending} onClick={onClose}>取消</button>
            <button className="button button--primary" type="submit" disabled={pending || !form.name.trim()}>
              {pending ? "创建中…" : `创建${type}`}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function SubjectInspector({
  asset,
  type,
  imageModels,
  imageModelId,
  seriesImageModelId,
  seriesImageModelName,
  resolution,
  prompt,
  nameDraft,
  summaryDraft,
  generating,
  modelBound,
  busy,
  actionError,
  onNameChange,
  onNameBlur,
  onSummaryChange,
  onSummaryBlur,
  onPromptChange,
  onPromptSave,
  promptChanged,
  promptSaving,
  onBindModel,
  onResolution,
  onGenerate,
  onUploadClick,
  onZoom,
  onLock,
}) {
  const src = mediaUrl(asset?.imageStorageKey || asset?.imageUrl);
  const generateLabel = asset?.imageStorageKey ? "重新生成" : "图片生成";
  return (
    <aside className="youxi-inspector youxi-subject-inspector">
      <div className="youxi-inspector-tabs">
        <button type="button" className="active">资产图</button>
      </div>
      <div className="youxi-inspector-scroll">
        {asset ? (
          <>
            <label className="youxi-field">
              <span>{type}名称</span>
              <input value={nameDraft} maxLength={128} onChange={onNameChange} onBlur={onNameBlur} />
            </label>
            <label className="youxi-field youxi-field--summary">
              <span>设定摘要</span>
              <textarea
                rows={3}
                maxLength={512}
                value={summaryDraft}
                onChange={onSummaryChange}
                onBlur={onSummaryBlur}
                placeholder={`${type}身份、外形或用途，入梦/换装须独立成条`}
              />
            </label>
            <label className="youxi-field">
              <span>图片提示词</span>
              <textarea
                value={prompt}
                maxLength={PROMPT_MAX}
                onChange={onPromptChange}
                placeholder="提取后会自动带出设定图提示词，可按角色/场景/道具继续改"
              />
            </label>
            <div className="field-count">{(prompt || "").length} / {PROMPT_MAX}</div>
            <button
              className={`button youxi-prompt-save ${promptChanged ? "button--primary" : ""}`}
              type="button"
              disabled={!promptChanged || generating || busy || promptSaving}
              onClick={onPromptSave}
            >
              <Save size={14} /> {promptSaving ? "保存中…" : "保存修改"}
            </button>
            <label className="youxi-field youxi-field--compact">
              <span>出图分辨率</span>
              <select aria-label="出图分辨率" value={resolution} onChange={(event) => onResolution(event.target.value)}>
                {RESOLUTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <div className="youxi-model-row">
              <select
                aria-label="图片生成模型"
                value={imageModelId}
                onChange={(event) => onBindModel(event.target.value)}
              >
                <option value="">{imageModels.length ? "请选择图像模型" : "暂无已启用图像模型"}</option>
                {seriesImageModelId && !imageModels.some((item) => String(item.id) === String(seriesImageModelId)) && (
                  <option value={seriesImageModelId}>{seriesImageModelName || "已绑定（当前已停用）"}</option>
                )}
                {imageModels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.provider ? ` · ${item.provider}` : ""}
                  </option>
                ))}
              </select>
              <button
                className="button button--primary"
                type="button"
                disabled={!modelBound || generating || !prompt.trim() || busy}
                onClick={onGenerate}
              >
                <Sparkles size={15} /> {generating ? "生成中…" : modelBound ? generateLabel : "先选模型"}
              </button>
            </div>
            {asset.genErrorMessage && <p className="drama-form-error">{asset.genErrorMessage}</p>}
            <section className="youxi-material-block">
              <header>
                <strong>资产图</strong>
                <div className="material-actions">
                  <button type="button" onClick={onUploadClick} disabled={generating || busy}>
                    <Upload size={14} /> 本地上传
                  </button>
                </div>
              </header>
              <div>
                {src ? (
                  <button
                    className="youxi-media-zoom"
                    type="button"
                    aria-label={`放大${asset.name}资产图`}
                    onClick={onZoom}
                  >
                    <img
                      key={src}
                      className="youxi-subject-media-preview"
                      src={src}
                      alt={`${asset.name}资产图`}
                    />
                  </button>
                ) : (
                  <button className="youxi-empty-subject-media" type="button" onClick={onUploadClick}>
                    <ImagePlus size={22} />
                    <span>上传图片</span>
                  </button>
                )}
              </div>
            </section>
            <div className="youxi-inspector-actions">
              <button
                className="button button--primary"
                type="button"
                disabled={busy || generating || !asset.imageStorageKey || asset.status === "已锁定"}
                onClick={onLock}
              >
                {asset.status === "已锁定" ? "已锁定" : busy ? "锁定中…" : "锁定资产"}
              </button>
              <p>锁定且有图后，才能作为分镜参考。改提示词或重生成会重新待确认。</p>
            </div>
          </>
        ) : (
          <>
            <p className="youxi-story-side-empty">选中{type}后，可在此改提示词、选全局图像模型并生图。</p>
            <div className="youxi-model-row">
              <select
                aria-label="图片生成模型"
                value={imageModelId}
                onChange={(event) => onBindModel(event.target.value)}
              >
                <option value="">{imageModels.length ? "请选择图像模型" : "暂无已启用图像模型"}</option>
                {seriesImageModelId && !imageModels.some((item) => String(item.id) === String(seriesImageModelId)) && (
                  <option value={seriesImageModelId}>{seriesImageModelName || "已绑定（当前已停用）"}</option>
                )}
                {imageModels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.provider ? ` · ${item.provider}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {actionError && <p className="drama-form-error">{actionError}</p>}
      </div>
    </aside>
  );
}

export function DramaAssetBoard({ series, episode }) {
  const queryClient = useQueryClient();
  const episodeId = episode?.id;
  const seriesId = series?.id;
  const fileRef = useRef(null);
  const [type, setType] = useState("角色");
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [imageModelId, setImageModelId] = useState(series?.imageModelId || "");
  const [resolution, setResolution] = useState("1K");
  const [nameDraft, setNameDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [busy, setBusy] = useState({});
  const [actionError, setActionError] = useState("");
  const [preview, setPreview] = useState(null);

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

  const filtered = useMemo(
    () => assets.filter((item) => item.type === type),
    [assets, type],
  );
  const counts = useMemo(() => {
    const byType = { 角色: 0, 场景: 0, 道具: 0 };
    for (const item of assets) {
      if (byType[item.type] != null) byType[item.type] += 1;
    }
    return byType;
  }, [assets]);

  const selected = filtered.find((item) => item.id === selectedId) || filtered[0] || null;

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    if (!filtered.length && selectedId != null) setSelectedId(null);
  }, [filtered, selected, selectedId]);

  useEffect(() => {
    setPromptDirty(false);
    setNameDraft(selected?.name || "");
    setSummaryDraft(identityOf(selected));
    setPromptDraft(promptOf(selected));
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || promptDirty) return;
    setPromptDraft(promptOf(selected));
    setSummaryDraft(identityOf(selected));
  }, [selected?.imagePrompt, selected?.identityInvariants, selected?.description, promptDirty]);

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
  const isBusy = (id, action) => Boolean(id && busy[`${id}:${action}`]);

  const bindMutation = useMutation({
    mutationFn: (id) => bindDramaImageModel(seriesId, Number(id)),
    onSuccess: invalidate,
  });
  const extractMutation = useMutation({
    mutationFn: () => extractDramaAssets(episodeId),
    onSuccess: () => {
      setPromptDirty(false);
      invalidate();
    },
  });
  const lockScriptMutation = useMutation({
    mutationFn: () => lockDramaScript(episodeId),
    onSuccess: invalidate,
  });
  const createMutation = useMutation({
    mutationFn: (form) => createDramaAsset(episodeId, {
      name: form.name.trim(),
      type,
      description: form.meta.trim() || undefined,
      identityInvariants: form.meta.trim() || undefined,
      imagePrompt: form.prompt.trim() || undefined,
    }),
    onSuccess: (created) => {
      setCreating(false);
      if (created?.id) setSelectedId(created.id);
      invalidate();
    },
  });

  async function saveFields(asset, extra = {}) {
    const imagePrompt = (extra.imagePrompt ?? (asset.id === selected?.id ? promptDraft : promptOf(asset))).trim();
    const name = (extra.name ?? (asset.id === selected?.id ? nameDraft : asset.name)).trim();
    const identity = (extra.identityInvariants ?? (asset.id === selected?.id ? summaryDraft : identityOf(asset))).trim();
    await updateDramaAsset(asset.id, {
      name,
      imagePrompt,
      identityInvariants: identity,
    });
    setPromptDirty(false);
  }

  async function generate(asset) {
    const imagePrompt = (asset.id === selected?.id ? promptDraft : promptOf(asset)).trim();
    if (!imagePrompt) return;
    markBusy(asset.id, "generate", true);
    try {
      await saveFields(asset, { imagePrompt });
      const result = await generateDramaAssetImage(asset.id, { resolution });
      await pollDramaAssetGenerate(asset.id, result.task.id);
      invalidate();
    } finally {
      markBusy(asset.id, "generate", false);
    }
  }

  async function generateBatch() {
    const pending = filtered.filter((item) => {
      const imagePrompt = (item.id === selected?.id ? promptDraft : promptOf(item)).trim();
      return imagePrompt && !item.imageStorageKey && !item.generating && !isBusy(item.id, "generate");
    }).slice(0, BATCH_LIMIT);
    if (!pending.length) {
      setActionError("当前分类没有待生成的资产图");
      return;
    }
    setActionError("");
    await Promise.all(pending.map((item) => generate(item)));
  }

  async function confirm(asset) {
    markBusy(asset.id, "lock", true);
    try {
      await saveFields(asset);
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
      if (selectedId === asset.id) setSelectedId(null);
      invalidate();
    } finally {
      markBusy(asset.id, "delete", false);
    }
  }

  async function onUpload(file) {
    if (!file || !selected?.id) return;
    markBusy(selected.id, "upload", true);
    try {
      const updated = await uploadDramaAssetImage(selected.id, file);
      queryClient.setQueryData(["drama-assets", episodeId], (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
      });
      invalidate();
    } finally {
      markBusy(selected.id, "upload", false);
    }
  }

  const modelBound = Boolean(imageModelId);
  const error = bindMutation.error || extractMutation.error || lockScriptMutation.error || createMutation.error;
  const selectedBusy = isBusy(selected?.id, "lock") || isBusy(selected?.id, "save") || isBusy(selected?.id, "upload");
  const selectedGenerating = Boolean(selected?.generating) || isBusy(selected?.id, "generate");
  const promptChanged = Boolean(selected) && promptDraft.trim() !== promptOf(selected).trim();

  async function savePrompt() {
    if (!selected || !promptChanged) return;
    markBusy(selected.id, "save", true);
    try {
      await saveFields(selected, { imagePrompt: promptDraft });
      invalidate();
    } finally {
      markBusy(selected.id, "save", false);
    }
  }

  return (
    <div className="drama-asset-board youxi-subject-layout">
      <aside className="youxi-subject-nav">
        <header>
          <strong>资产分类</strong>
          <span>共{assets.length}个</span>
        </header>
        <div className="youxi-subject-tabs" role="tablist" aria-label="资产类型">
          {TYPES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={type === item.id}
              className={type === item.id ? "active" : ""}
              onClick={() => {
                setType(item.id);
                const first = assets.find((asset) => asset.type === item.id);
                setSelectedId(first?.id || null);
                setPromptDirty(false);
              }}
            >
              <item.Icon size={16} />
              {item.label}
              <span>{counts[item.id] || 0}</span>
            </button>
          ))}
        </div>
        <p>在三个标签页中管理全剧统一使用的角色、场景与道具。提取后会带出可改的图片提示词。</p>
      </aside>

      <section className="youxi-subject-main">
        <div className="youxi-subject-narration">
          {scriptLocked ? (
            <button type="button" disabled={!episodeId || extractMutation.isPending} onClick={() => extractMutation.mutate()}>
              <RefreshCw size={16} />
              <span>从剧本提取</span>
              <strong>{extractMutation.isPending ? "提取中" : `${assets.length}个`}</strong>
            </button>
          ) : (
            <button
              type="button"
              disabled={lockScriptMutation.isPending || !(episode?.sourceText || (episode?.script && Object.keys(episode.script).length))}
              onClick={() => lockScriptMutation.mutate()}
            >
              <Lock size={16} />
              <span>锁定剧本后才能提取</span>
              <strong>{lockScriptMutation.isPending ? "锁定中" : "未锁定"}</strong>
            </button>
          )}
          <div>
            <button
              type="button"
              disabled={!modelBound || extractMutation.isPending}
              onClick={() => generateBatch().catch((err) => setActionError(err.message))}
            >
              <Sparkles size={15} /> 批量生图
            </button>
            <button type="button" onClick={() => setCreating(true)}>
              <Plus size={15} /> 新增{type}
            </button>
          </div>
        </div>

        <div className="youxi-subject-body">
          {!scriptLocked && (
            <div className="drama-asset-gate youxi-subject-gate">
              <Lock size={16} />
              <div>
                <strong>请先锁定分场剧本</strong>
                <p>锁定后可从剧本当中提取角色、场景、道具。未锁定资产不能进分镜。</p>
              </div>
            </div>
          )}

          {(error || actionError) && (
            <p className="drama-form-error youxi-subject-error">{error?.message || actionError}</p>
          )}

          {filtered.length === 0 ? (
            <div className="youxi-subject-grid">
              <button className="youxi-add-subject" type="button" onClick={() => setCreating(true)}>
                <Plus size={22} />
                <strong>新增{type}</strong>
              </button>
            </div>
          ) : (
            <div className="youxi-subject-grid">
              {filtered.map((item) => {
                const src = mediaUrl(item.imageStorageKey || item.imageUrl);
                const generating = Boolean(item.generating) || isBusy(item.id, "generate");
                return (
                  <article className={`youxi-subject-card ${selected?.id === item.id ? "active" : ""}`} key={item.id}>
                    <header>
                      <strong>{item.name}</strong>
                      <button
                        type="button"
                        aria-label={`删除${item.name}`}
                        disabled={generating || isBusy(item.id, "delete")}
                        onClick={(event) => {
                          event.stopPropagation();
                          remove(item).catch((err) => setActionError(err.message));
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </header>
                    <button
                      className="youxi-subject-card__select"
                      type="button"
                      onClick={() => {
                        setSelectedId(item.id);
                      }}
                    >
                      <div className={`${!src ? "is-empty" : ""} ${generating ? "is-generating" : ""}`}>
                        {src ? (
                          <>
                            <img key={src} src={src} alt={item.name} />
                            <span>{generating ? "生成中" : statusLabel(item.status)}</span>
                          </>
                        ) : (
                          <div className="youxi-subject-empty">
                            <ImageIcon size={31} />
                            <b>{generating ? "生成中" : "上传图片"}</b>
                            <small>也可在右侧生成资产图</small>
                          </div>
                        )}
                      </div>
                    </button>
                    <p className="youxi-subject-card__meta">{cardMeta(item)}</p>
                  </article>
                );
              })}
              <button className="youxi-add-subject" type="button" onClick={() => setCreating(true)}>
                <Plus size={22} />
                <strong>新增{type}</strong>
              </button>
            </div>
          )}
        </div>
      </section>

      <SubjectInspector
        asset={selected}
        type={type}
        imageModels={imageModels}
        imageModelId={imageModelId}
        seriesImageModelId={series?.imageModelId}
        seriesImageModelName={series?.imageModelName}
        resolution={resolution}
        prompt={promptDraft}
        nameDraft={nameDraft}
        summaryDraft={summaryDraft}
        generating={selectedGenerating}
        modelBound={modelBound}
        busy={selectedBusy}
        promptChanged={promptChanged}
        promptSaving={isBusy(selected?.id, "save")}
        actionError=""
        onNameChange={(event) => setNameDraft(event.target.value)}
        onNameBlur={() => {
          if (!selected || nameDraft.trim() === selected.name) return;
          saveFields(selected, { name: nameDraft }).then(invalidate).catch((err) => setActionError(err.message));
        }}
        onSummaryChange={(event) => setSummaryDraft(event.target.value)}
        onSummaryBlur={() => {
          if (!selected || summaryDraft.trim() === identityOf(selected)) return;
          saveFields(selected).then(invalidate).catch((err) => setActionError(err.message));
        }}
        onPromptChange={(event) => {
          setPromptDirty(true);
          setPromptDraft(event.target.value);
        }}
        onPromptSave={() => savePrompt().catch((err) => setActionError(err.message))}
        onBindModel={(value) => {
          setImageModelId(value);
          if (value) bindMutation.mutate(value);
        }}
        onResolution={setResolution}
        onGenerate={() => selected && generate(selected).catch((err) => setActionError(err.message))}
        onUploadClick={() => fileRef.current?.click()}
        onZoom={() => selected && setPreview({
          src: mediaUrl(selected.imageStorageKey || selected.imageUrl),
          title: selected.name,
        })}
        onLock={() => selected && confirm(selected).catch((err) => setActionError(err.message))}
      />

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
        <SubjectCreateDialog
          type={type}
          pending={createMutation.isPending}
          error={createMutation.error?.message}
          onClose={() => { if (!createMutation.isPending) setCreating(false); }}
          onCreate={(form) => createMutation.mutate(form)}
        />
      )}

      <ImageLightbox preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

export function dramaAssetsStatus(assets) {
  if (!assets?.length) return "未开始";
  if (assets.every((item) => item.status === "已锁定")) return "已锁定";
  if (assets.some((item) => item.status === "已过期")) return "已过期";
  return "待确认";
}
