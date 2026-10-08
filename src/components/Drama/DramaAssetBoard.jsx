import {
  CircleAlert,
  Clapperboard,
  AudioLines,
  Check,
  Image as ImageIcon,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAssets } from "../../api/assets.js";
import {
  bindDramaAssetImageFromLibrary,
  bindDramaAssetVoiceReference,
  bindDramaImageModel,
  createDramaAsset,
  deleteDramaAsset,
  deleteDramaAssetGeneration,
  extractDramaAssets,
  fetchDramaAssetGenerations,
  fetchDramaAssets,
  fetchDramaImageModels,
  generateDramaAssetImage,
  importDramaAssetGeneration,
  lockDramaScript,
  pollDramaAssetGenerate,
  selectDramaAssetGeneration,
  updateDramaAsset,
  uploadDramaAssetImage,
  uploadDramaAssetVoiceReference,
} from "../../api/drama.js";
import { MEDIA_THUMB_WIDTH, mediaUrl } from "../../lib/media.js";
import { ImageLightbox } from "../../lib/ImageLightbox.jsx";
import { ConfirmDialog } from "../ConfirmDialog.jsx";
import { AssetPickerDialog } from "../AssetPickerDialog.jsx";
import { sameAsset } from "../../lib/assetPicker.js";
import { GenerationHistoryPanel, SwitchFinalModal } from "./GenerationHistoryPanel.jsx";

const TYPES = [
  { id: "角色", label: "角色", Icon: UsersRound },
  { id: "场景", label: "场景", Icon: ImageIcon },
  { id: "道具", label: "道具", Icon: Clapperboard },
];
const RESOLUTIONS = ["1K", "2K"];
const PROMPT_MAX = 4000;
const BATCH_LIMIT = 4;
const emptyCreate = { name: "", meta: "", prompt: "" };

function sameAssetId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function ImageLibraryDialog({ assets, loading, busy, error, onClose, onConfirm }) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = assets.find((item) => sameAssetId(item.id, selectedId)) || null;

  const body = (
    <div
      className="drama-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="creation-asset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-library-title"
      >
        <header>
          <div>
            <small>素材库</small>
            <h2 id="image-library-title">引用素材</h2>
          </div>
          <button type="button" aria-label="关闭素材选择" disabled={busy} onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="creation-asset-grid">
          {loading && <p className="creation-asset-empty">正在加载图片素材…</p>}
          {!loading && !assets.length && <p className="creation-asset-empty">暂无可用图片素材</p>}
          {!loading && assets.map((asset) => {
            const label = asset.title || asset.name;
            const preview = mediaUrl(asset.poster || asset.src || asset.url || asset.storageKey, { w: MEDIA_THUMB_WIDTH });
            const isSelected = sameAssetId(asset.id, selectedId);
            return (
              <button
                type="button"
                className={isSelected ? "selected" : ""}
                key={asset.id || asset.storageKey || preview}
                aria-pressed={isSelected}
                disabled={busy}
                onClick={() => setSelectedId(asset.id)}
              >
                <img src={preview} alt={label} />
                <span>
                  <strong>{label}</strong>
                  <small>图片素材</small>
                </span>
                {isSelected && (
                  <span className="creation-asset-check" aria-hidden="true">
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <footer>
          <span>{error ? <em className="drama-form-error" style={{ fontStyle: "normal" }}>{error}</em> : (selected ? "已选择 1 项" : "请选择一张图片")}</span>
          <div>
            <button type="button" disabled={busy} onClick={onClose}>取消</button>
            <button
              type="button"
              className="primary"
              disabled={busy || !selected}
              onClick={() => {
                if (!selected) return;
                onConfirm(selected);
              }}
            >
              {busy ? "引用中…" : "引用素材"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );

  return createPortal(body, document.body);
}

function VoiceLibraryDialog({ targetName, assets, loading, busy, onClose, onSelect, onUpload }) {
  return (
    <div className="drama-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="drama-dialog drama-voice-library" role="dialog" aria-modal="true" aria-labelledby="voice-library-title">
        <header>
          <div><span>参考音频</span><h2 id="voice-library-title">为“{targetName}”选择音色</h2></div>
        </header>
        <div className="drama-voice-library__body">
          <button className="drama-voice-library__upload" type="button" disabled={busy} onClick={onUpload}>
            <Upload size={18} /><span><strong>自定义上传</strong><small>上传后自动同步到音频素材库</small></span>
          </button>
          <div className="drama-voice-library__list">
            {loading && <p>正在加载音频素材…</p>}
            {!loading && !assets.length && <p>音频库暂无素材，可先自定义上传。</p>}
            {assets.map((item) => (
              <article key={item.id}>
                <AudioLines size={18} />
                <span><strong>{item.title || item.name}</strong><audio controls preload="metadata" src={mediaUrl(item.src || item.url || item.storageKey)} /></span>
                <button type="button" disabled={busy} onClick={() => onSelect(item)}>{busy ? "绑定中…" : "选择"}</button>
              </article>
            ))}
          </div>
        </div>
        <footer><button type="button" disabled={busy} onClick={onClose}>取消</button></footer>
      </section>
    </div>
  );
}

function promptOf(asset) {
  return asset?.imagePrompt || asset?.description || "";
}

function statusLabel(status) {
  if (status === "已锁定") return "已确认";
  if (!status || status === "待确认" || status === "未开始") return "";
  return status;
}

function stateLabel(tag) {
  if (tag === "dream") return "入梦";
  if (tag === "costume") return "换装";
  return "";
}

function identityOf(asset) {
  return asset?.identityInvariants?.trim() || "";
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

function ImageModelSelect({
  imageModels,
  imageModelId,
  seriesImageModelId,
  seriesImageModelName,
  disabled,
  onBindModel,
}) {
  return (
    <label className="youxi-shot-model">
      图像模型
      <select
        aria-label="全局图片生成模型"
        value={imageModelId}
        disabled={disabled}
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
    </label>
  );
}

function SubjectInspector({
  asset,
  type,
  resolution,
  prompt,
  nameDraft,
  summaryDraft,
  generating,
  busy,
  summaryChanged,
  summarySaving,
  onNameChange,
  onNameBlur,
  onSummaryChange,
  onSummaryBlur,
  onSummarySave,
  onPromptChange,
  onPromptSave,
  promptChanged,
  promptSaving,
  onResolution,
  onCiteClick,
  onUploadClick,
  voiceLock,
  voiceBusy,
  onVoiceLockChange,
  onVoiceSave,
  onVoiceUploadClick,
  voiceReferenceStatus,
  generations = [],
  generationsLoading = false,
  historyBusy = false,
  onSwitchFinal,
  onPreviewGeneration,
  onDeleteGeneration,
  onImportGeneration,
}) {
  const voiceDescriptionChanged = (voiceLock || "").trim() !== (asset?.voiceLock || "").trim();
  const effectiveVoiceReferenceStatus = asset?.voiceReferenceUrl && voiceReferenceStatus.state === "ready"
    ? { ...voiceReferenceStatus, state: "success", label: "已绑定参考音频" }
    : voiceReferenceStatus;
  return (
    <aside className="youxi-inspector youxi-subject-inspector">
      <div className="youxi-inspector-tabs">
        <button type="button" className="active">资产图</button>
      </div>
      <div className="youxi-inspector-scroll">
        {asset ? (
          <>
            <label className="youxi-field">
              <span>名称</span>
              <input
                value={nameDraft}
                maxLength={128}
                onChange={onNameChange}
                onBlur={onNameBlur}
                placeholder={`${type}名称`}
              />
            </label>

            <div className="youxi-prompt-block">
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
            </div>

            {type === "角色" && (
              <section className="youxi-voice-block">
                <label className="youxi-field">
                  <span>
                    音色
                    <em data-state={effectiveVoiceReferenceStatus.state}>{effectiveVoiceReferenceStatus.label}</em>
                  </span>
                  <input
                    value={voiceLock}
                    onChange={onVoiceLockChange}
                    placeholder="例：30岁低沉男声，普通话，克制冷静"
                  />
                </label>
                {asset.voiceReferenceUrl && (
                  <audio controls preload="metadata" src={mediaUrl(asset.voiceReferenceUrl) || asset.voiceReferenceUrl} />
                )}
                <div className="youxi-voice-block__actions">
                  <button
                    type="button"
                    onClick={onVoiceUploadClick}
                    disabled={voiceBusy}
                  >
                    <AudioLines size={13} /> {effectiveVoiceReferenceStatus.state === "loading" ? "检查中…" : asset.voiceReferenceUrl ? "更换参考音频" : "绑定参考音频"}
                  </button>
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={onVoiceSave}
                    disabled={voiceBusy || !voiceDescriptionChanged}
                  >
                    <Save size={13} /> 保存
                  </button>
                </div>
                <small>{effectiveVoiceReferenceStatus.help}</small>
              </section>
            )}

            <div className="youxi-prompt-block">
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
              <button
                className={`button youxi-prompt-save ${summaryChanged ? "button--primary" : ""}`}
                type="button"
                disabled={!summaryChanged || generating || busy || summarySaving}
                onClick={onSummarySave}
              >
                <Save size={14} /> {summarySaving ? "保存中…" : "保存摘要"}
              </button>
            </div>

            <div className="youxi-field youxi-resolution-field">
              <span>分辨率</span>
              <div className="generation-chip-grid" style={{ gridTemplateColumns: `repeat(${RESOLUTIONS.length}, minmax(0, 1fr))` }}>
                {RESOLUTIONS.map((item) => (
                  <button
                    type="button"
                    className={resolution === item ? "active" : ""}
                    key={item}
                    onClick={() => onResolution(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {asset.genErrorMessage && <p className="drama-form-error">{asset.genErrorMessage}</p>}

            {!generationsLoading && (
              <GenerationHistoryPanel
                switchLabel="切换最终资产"
                records={generations}
                locked={false}
                mediaKind="image"
                showImport
                compactActions
                busy={historyBusy || generating || busy}
                onSwitchClick={onSwitchFinal}
                onPreview={onPreviewGeneration}
                onDelete={onDeleteGeneration}
                onImport={onImportGeneration}
                onCiteClick={onCiteClick}
                onUploadClick={onUploadClick}
                uploadLabel="上传"
              />
            )}

            <p className="youxi-inspector-hint">生成或上传后，当前选用的图会直接作为分镜参考。切换最终资产后，分镜会改用新图。</p>
          </>
        ) : (
          <p className="youxi-story-side-empty">选中{type}后，可在此改提示词并生图。</p>
        )}
      </div>
    </aside>
  );
}

export function DramaAssetBoard({ series, episode }) {
  const queryClient = useQueryClient();
  const episodeId = episode?.id;
  const seriesId = series?.id;
  const fileRef = useRef(null);
  const voiceFileRef = useRef(null);
  const [type, setType] = useState("角色");
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [imageModelId, setImageModelId] = useState(series?.imageModelId || "");
  const [resolution, setResolution] = useState("1K");
  const [nameDraft, setNameDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [voiceLockDraft, setVoiceLockDraft] = useState("");
  const [voiceLibraryOpen, setVoiceLibraryOpen] = useState(false);
  const [imageLibraryOpen, setImageLibraryOpen] = useState(false);
  const [imageLibraryError, setImageLibraryError] = useState("");
  const [voiceTarget, setVoiceTarget] = useState(null);
  const [voicePending, setVoicePending] = useState([]);
  const [promptDirty, setPromptDirty] = useState(false);
  const [summaryDirty, setSummaryDirty] = useState(false);
  const [busy, setBusy] = useState({});
  const [actionError, setActionError] = useState("");
  const [preview, setPreview] = useState(null);
  const [switchFinalOpen, setSwitchFinalOpen] = useState(false);
  const [deleteGenerationTarget, setDeleteGenerationTarget] = useState(null);
  const toastTimer = useRef(0);

  function showToast(message) {
    if (!message) return;
    setActionError(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setActionError(""), 2400);
  }

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const imageModelsQuery = useQuery({
    queryKey: ["drama-image-models"],
    queryFn: fetchDramaImageModels,
  });
  const assetsQuery = useQuery({
    queryKey: ["drama-assets", episodeId],
    queryFn: () => fetchDramaAssets(episodeId),
    enabled: Boolean(episodeId),
  });
  const voiceLibraryQuery = useQuery({
    queryKey: ["assets", "audio", ""],
    queryFn: () => fetchAssets({ kind: "audio" }),
    enabled: voiceLibraryOpen,
  });
  const imageLibraryQuery = useQuery({
    queryKey: ["assets", "image", ""],
    queryFn: () => fetchAssets({ kind: "image" }),
    enabled: imageLibraryOpen,
  });

  const imageModels = imageModelsQuery.data || [];
  const voiceReferenceStatus = {
    state: "ready",
    label: "可绑定参考音频",
    help: "可先为角色保存参考音频；到分镜阶段将按所选视频模型能力决定是否使用。",
  };
  const assets = assetsQuery.data || [];
  const scriptLocked = episode?.status === "已锁定";
  const canUseTextModel = episode?.canGenerate !== false;

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

  const generationsQuery = useQuery({
    queryKey: ["drama-asset-generations", selected?.id],
    queryFn: () => fetchDramaAssetGenerations(selected.id),
    enabled: Boolean(selected?.id),
  });
  const generations = generationsQuery.data || [];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    if (!filtered.length && selectedId != null) setSelectedId(null);
  }, [filtered, selected, selectedId]);

  useEffect(() => {
    setPromptDirty(false);
    setSummaryDirty(false);
    setNameDraft(selected?.name || "");
    setSummaryDraft(identityOf(selected));
    setPromptDraft(promptOf(selected));
    setVoiceLockDraft(selected?.voiceLock || "");
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || promptDirty) return;
    setPromptDraft(promptOf(selected));
  }, [selected?.imagePrompt, selected?.identityInvariants, selected?.description, promptDirty]);

  useEffect(() => {
    if (summaryDirty) return;
    setSummaryDraft(identityOf(selected));
  }, [selected?.id, selected?.identityInvariants, summaryDirty]);

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["drama-assets", episodeId] }),
    queryClient.invalidateQueries({ queryKey: ["drama-asset-generations", selected?.id] }),
    queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] }),
    queryClient.invalidateQueries({ queryKey: ["drama-storyboard", episodeId] }),
  ]);

  const invalidateAssetHistory = (assetId) => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["drama-assets", episodeId] }),
    queryClient.invalidateQueries({ queryKey: ["drama-asset-generations", assetId] }),
    queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] }),
    queryClient.invalidateQueries({ queryKey: ["drama-storyboard", episodeId] }),
  ]);

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
    onError: (err) => showToast(err.message),
  });
  const extractMutation = useMutation({
    mutationFn: () => extractDramaAssets(episodeId),
    onSuccess: () => {
      setPromptDirty(false);
      invalidate();
    },
    onError: (err) => showToast(err.message),
  });
  const lockScriptMutation = useMutation({
    mutationFn: () => lockDramaScript(episodeId),
    onSuccess: invalidate,
    onError: (err) => showToast(err.message),
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
      showToast("当前分类没有待生成的资产图");
      return;
    }
    await Promise.all(pending.map((item) => generate(item)));
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

  async function onCiteFromLibrary(libraryAsset) {
    const targetId = selected?.id;
    const libraryId = libraryAsset?.id;
    if (!targetId || libraryId == null) return;
    setImageLibraryError("");
    markBusy(targetId, "upload", true);
    try {
      const updated = await bindDramaAssetImageFromLibrary(targetId, libraryId);
      queryClient.setQueryData(["drama-assets", episodeId], (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry));
      });
      setImageLibraryOpen(false);
      setImageLibraryError("");
      await invalidateAssetHistory(targetId);
      invalidate();
      showToast("已引用素材");
    } catch (err) {
      const message = err?.message || "引用失败";
      setImageLibraryError(message);
      showToast(message);
    } finally {
      markBusy(targetId, "upload", false);
    }
  }

  async function selectGeneration(record) {
    if (!selected?.id || !record?.id) return;
    markBusy(selected.id, "history", true);
    try {
      await selectDramaAssetGeneration(selected.id, record.id);
      setSwitchFinalOpen(false);
      await invalidateAssetHistory(selected.id);
      invalidate();
    } catch (err) {
      showToast(err.message);
    } finally {
      markBusy(selected.id, "history", false);
    }
  }

  function requestDeleteGeneration(record) {
    if (!selected?.id || !record?.id) return;
    setDeleteGenerationTarget(record);
  }

  async function confirmDeleteGeneration() {
    const record = deleteGenerationTarget;
    if (!selected?.id || !record?.id) return;
    markBusy(selected.id, "history", true);
    try {
      await deleteDramaAssetGeneration(selected.id, record.id);
      setDeleteGenerationTarget(null);
      await invalidateAssetHistory(selected.id);
      invalidate();
    } catch (err) {
      showToast(err.message);
    } finally {
      markBusy(selected.id, "history", false);
    }
  }

  async function importGeneration(record) {
    if (!selected?.id || !record?.id || record.imported || record.libraryAssetId) return;
    markBusy(selected.id, "history", true);
    try {
      await importDramaAssetGeneration(selected.id, record.id);
      await invalidateAssetHistory(selected.id);
      showToast(`「${record.label}」已导入素材库`);
    } catch (err) {
      showToast(err.message);
    } finally {
      markBusy(selected.id, "history", false);
    }
  }

  async function saveVoice() {
    if (!selected) return;
    markBusy(selected.id, "voice", true);
    try {
      await updateDramaAsset(selected.id, { voiceLock: voiceLockDraft.trim() });
      invalidate();
    } finally {
      markBusy(selected.id, "voice", false);
    }
  }

  async function onVoiceUpload(file) {
    const target = voiceTarget;
    if (!file || !target?.id) return;
    markBusy(target.id, "voice", true);
    try {
      const updated = await uploadDramaAssetVoiceReference(target.id, file);
      queryClient.setQueryData(["drama-assets", episodeId], (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
      });
      setVoiceLibraryOpen(false);
      setVoiceTarget(null);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      invalidate();
    } finally {
      markBusy(target.id, "voice", false);
    }
  }

  async function onVoiceLibrarySelect(libraryAsset) {
    const target = voiceTarget;
    if (!libraryAsset?.id || !target?.id) return;
    markBusy(target.id, "voice", true);
    try {
      const updated = await bindDramaAssetVoiceReference(target.id, libraryAsset.id);
      queryClient.setQueryData(["drama-assets", episodeId], (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
      });
      setVoiceLibraryOpen(false);
      setVoiceTarget(null);
      invalidate();
    } finally {
      markBusy(target.id, "voice", false);
    }
  }

  const modelBound = Boolean(imageModelId);
  const selectedBusy = isBusy(selected?.id, "lock") || isBusy(selected?.id, "save") || isBusy(selected?.id, "upload");
  const selectedGenerating = Boolean(selected?.generating) || isBusy(selected?.id, "generate");
  const promptChanged = Boolean(selected) && promptDraft.trim() !== promptOf(selected).trim();
  const summaryChanged = Boolean(selected) && summaryDraft.trim() !== identityOf(selected);

  async function saveSummary() {
    if (!selected || !summaryChanged) return;
    markBusy(selected.id, "summary", true);
    try {
      await saveFields(selected);
      await invalidate();
      setSummaryDirty(false);
    } finally {
      markBusy(selected.id, "summary", false);
    }
  }

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
      {actionError && (
        <div className="drama-toast drama-toast--error" role="status">
          <CircleAlert size={16} />{actionError}
        </div>
      )}
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
          <ImageModelSelect
            imageModels={imageModels}
            imageModelId={imageModelId}
            seriesImageModelId={series?.imageModelId}
            seriesImageModelName={series?.imageModelName}
            disabled={bindMutation.isPending}
            onBindModel={(value) => {
              setImageModelId(value);
              if (value) bindMutation.mutate(value);
            }}
          />
          {scriptLocked ? (
            <button
              type="button"
              disabled={!episodeId || extractMutation.isPending || !canUseTextModel}
              title={!canUseTextModel ? "请先在剧本页绑定可用文本模型" : undefined}
              onClick={() => extractMutation.mutate()}
            >
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
              onClick={() => generateBatch().catch((err) => showToast(err.message))}
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
                <p>锁定后可从剧本当中提取角色、场景、道具。已有选用图的资产会直接作为分镜参考。</p>
              </div>
            </div>
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
                const src = mediaUrl(item.imageStorageKey || item.imageUrl, { w: MEDIA_THUMB_WIDTH });
                const generating = Boolean(item.generating) || isBusy(item.id, "generate");
                const cardPrompt = (item.id === selected?.id ? promptDraft : promptOf(item)).trim();
                const badge = generating ? "生成中" : statusLabel(item.status);
                const meta = cardMeta(item);
                return (
                  <article className={`youxi-subject-card ${selected?.id === item.id ? "active" : ""}`} key={item.id}>
                    <header>
                      <strong>{item.name}</strong>
                      <div className="youxi-subject-card__actions">
                        <button
                          type="button"
                          className="youxi-subject-card__gen"
                          aria-label={generating ? "生成中" : item.imageStorageKey ? `重新生成${item.name}` : `生成${item.name}图片`}
                          disabled={!modelBound || generating || !cardPrompt || isBusy(item.id, "delete")}
                          title={!modelBound ? "先选择顶部图像模型" : !cardPrompt ? "先填写图片提示词" : (item.imageStorageKey ? "按当前提示词重新生成设定图" : "生成设定图")}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(item.id);
                            generate(item).catch((err) => showToast(err.message));
                          }}
                        >
                          <Sparkles size={13} />
                          <span className="youxi-subject-card__label">{generating ? "生成中" : item.imageStorageKey ? "重新生成" : "图片生成"}</span>
                        </button>
                        <button
                          type="button"
                          className="youxi-subject-card__trash"
                          aria-label={`删除${item.name}`}
                          disabled={generating || isBusy(item.id, "delete")}
                          onClick={(event) => {
                            event.stopPropagation();
                            remove(item).catch((err) => showToast(err.message));
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
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
                            {badge ? <span>{badge}</span> : null}
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
                    {meta ? <p className="youxi-subject-card__meta">{meta}</p> : null}
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
        resolution={resolution}
        prompt={promptDraft}
        nameDraft={nameDraft}
        summaryDraft={summaryDraft}
        generating={selectedGenerating}
        busy={selectedBusy}
        promptChanged={promptChanged}
        promptSaving={isBusy(selected?.id, "save")}
        summaryChanged={summaryChanged}
        summarySaving={isBusy(selected?.id, "summary")}
        onNameChange={(event) => setNameDraft(event.target.value)}
        onNameBlur={() => {
          if (!selected || nameDraft.trim() === selected.name) return;
          saveFields(selected, { name: nameDraft }).then(invalidate).catch((err) => showToast(err.message));
        }}
        onSummaryChange={(event) => {
          setSummaryDirty(true);
          setSummaryDraft(event.target.value);
        }}
        onSummaryBlur={() => {
          if (!selected || summaryDraft.trim() === identityOf(selected)) {
            setSummaryDirty(false);
            return;
          }
          saveFields(selected)
            .then(() => invalidate())
            .then(() => setSummaryDirty(false))
            .catch((err) => showToast(err.message));
        }}
        onSummarySave={() => saveSummary().catch((err) => showToast(err.message))}
        onPromptChange={(event) => {
          setPromptDirty(true);
          setPromptDraft(event.target.value);
        }}
        onPromptSave={() => savePrompt().catch((err) => showToast(err.message))}
        onResolution={setResolution}
        onCiteClick={() => {
          setImageLibraryError("");
          setImageLibraryOpen(true);
        }}
        onUploadClick={() => fileRef.current?.click()}
        voiceLock={voiceLockDraft}
        voiceBusy={isBusy(selected?.id, "voice")}
        onVoiceLockChange={(event) => setVoiceLockDraft(event.target.value)}
        onVoiceSave={() => saveVoice().catch((err) => showToast(err.message))}
        onVoiceUploadClick={() => {
          if (!selected) return;
          setVoiceTarget({ id: selected.id, name: selected.name });
          setVoicePending([]);
          setVoiceLibraryOpen(true);
        }}
        voiceReferenceStatus={voiceReferenceStatus}
        generations={generations}
        generationsLoading={generationsQuery.isLoading}
        historyBusy={isBusy(selected?.id, "history")}
        onSwitchFinal={() => setSwitchFinalOpen(true)}
        onPreviewGeneration={(record) => setPreview({
          src: mediaUrl(record.url || record.storageKey),
          title: `${selected?.name || ""} · ${record.label}`,
        })}
        onDeleteGeneration={requestDeleteGeneration}
        onImportGeneration={importGeneration}
      />

      <SwitchFinalModal
        open={switchFinalOpen}
        title="切换最终资产"
        records={generations}
        locked={false}
        mediaKind="image"
        busy={isBusy(selected?.id, "history")}
        onClose={() => setSwitchFinalOpen(false)}
        onConfirm={selectGeneration}
      />

      <ConfirmDialog
        open={Boolean(deleteGenerationTarget)}
        eyebrow="生成记录"
        title="删除生成记录？"
        message={deleteGenerationTarget
          ? `确定删除「${deleteGenerationTarget.label}」？此操作不可撤销。`
          : ""}
        confirmLabel="删除"
        busy={isBusy(selected?.id, "history")}
        busyLabel="删除中…"
        onClose={() => setDeleteGenerationTarget(null)}
        onConfirm={confirmDeleteGeneration}
      />

      <input
        ref={voiceFileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          onVoiceUpload(file).catch((err) => showToast(err.message));
        }}
      />

      {voiceLibraryOpen && (
        <AssetPickerDialog
          title={`为“${voiceTarget?.name || "当前角色"}”选择参考音频`}
          hint="角色音色参考"
          emptyText="音频素材库暂无可用素材"
          assets={voiceLibraryQuery.data || []}
          selectedItems={voicePending}
          loading={voiceLibraryQuery.isLoading}
          error={voiceLibraryQuery.error?.message || ""}
          maxSelection={1}
          onToggle={(item) => setVoicePending((current) => current.some((selectedItem) => sameAsset(selectedItem, item)) ? [] : [item])}
          onClose={() => {
            setVoiceLibraryOpen(false);
            setVoiceTarget(null);
            setVoicePending([]);
          }}
          onConfirm={() => {
            const item = voicePending[0];
            if (!item) {
              showToast("请选择一段参考音频");
              return;
            }
            onVoiceLibrarySelect(item).catch((err) => showToast(err.message));
          }}
        />
      )}

      {imageLibraryOpen && (
        <ImageLibraryDialog
          assets={Array.isArray(imageLibraryQuery.data) ? imageLibraryQuery.data : []}
          loading={imageLibraryQuery.isLoading}
          busy={isBusy(selected?.id, "upload")}
          error={imageLibraryError}
          onClose={() => {
            if (!isBusy(selected?.id, "upload")) {
              setImageLibraryOpen(false);
              setImageLibraryError("");
            }
          }}
          onConfirm={(item) => onCiteFromLibrary(item)}
        />
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          onUpload(file).catch((err) => showToast(err.message));
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
