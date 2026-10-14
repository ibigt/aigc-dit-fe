import {
  CircleAlert,
  Clapperboard,
  AudioLines,
  Check,
  Folder,
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
  fetchDramaArkReviewAvailability,
  fetchDramaAssetGenerations,
  fetchDramaAssets,
  fetchDramaImageModels,
  generateDramaAssetImage,
  importDramaAssetGeneration,
  lockDramaScript,
  reviewDramaAsset,
  pollDramaAssetGenerate,
  selectDramaAssetGeneration,
  updateDramaAsset,
  uploadDramaAssetImage,
  uploadDramaAssetVoiceReference,
} from "../../api/drama.js";
import { MEDIA_THUMB_WIDTH, mediaUrl, retryMediaOnce } from "../../lib/media.js";
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
// 并发数与后端 DramaContract.MAX_ASSET_GENERATE 对齐：一次点击滚动跑完所有勾选资产。
const BATCH_CONCURRENCY = 16;
const emptyCreate = { name: "", meta: "" };

function sameAssetId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function ImageLibraryDialog({ assets, loading, busy, error, onClose, onConfirm }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const selected = assets.filter((item) => selectedIds.some((id) => sameAssetId(id, item.id)));

  function toggle(id) {
    setSelectedIds((current) => (
      current.some((item) => sameAssetId(item, id))
        ? current.filter((item) => !sameAssetId(item, id))
        : [...current, id]
    ));
  }

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
            const isSelected = selectedIds.some((id) => sameAssetId(id, asset.id));
            return (
              <button
                type="button"
                className={isSelected ? "selected" : ""}
                key={asset.id || asset.storageKey || preview}
                aria-pressed={isSelected}
                disabled={busy}
                onClick={() => toggle(asset.id)}
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
          <span>{error ? <em className="drama-form-error" style={{ fontStyle: "normal" }}>{error}</em> : (selected.length ? `已选择 ${selected.length} 项` : "请选择图片，支持多选")}</span>
          <div>
            <button type="button" disabled={busy} onClick={onClose}>取消</button>
            <button
              type="button"
              className="primary"
              disabled={busy || selected.length === 0}
              onClick={() => {
                if (!selected.length) return;
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

function isSkeletonIdentity(asset) {
  const id = asset?.identityInvariants?.trim() || "";
  if (!id) return true;
  if (id.includes("外貌、发型、服装和年龄必须保持一致")) return true;
  if (id.includes("与主身份同一张脸和发型")) return true;
  if (id.includes("空间结构、陈设与光影氛围必须保持一致")) return true;
  if (id.includes("外形、材质与标志性细节必须保持一致")) return true;
  return false;
}

function isCharacterIdentityMisapplied(asset) {
  const type = asset?.type;
  if (type === "角色" || !type) return false;
  const id = asset?.identityInvariants?.trim() || "";
  return id.includes("外貌、发型、服装和年龄必须保持一致")
    || id.includes("与主身份同一张脸和发型");
}

function settingLabel(type) {
  if (type === "场景") return "场景设定";
  if (type === "道具") return "道具设定";
  return "外形设定";
}

function looksLikeImageTemplate(text) {
  const value = (text || "").trim();
  if (!value) return false;
  return value.includes("角色设定图")
    || value.includes("三视图")
    || value.includes("固定四格")
    || value.includes("场景概念图")
    || value.includes("道具设定图")
    || value.includes("只要这一个角色");
}

/** 设定摘要：只展示真实内容；骨架空话 / 误套角色句一律视为未生成。 */
function identityOf(asset) {
  const id = asset?.identityInvariants?.trim() || "";
  if (id && !isSkeletonIdentity(asset) && !isCharacterIdentityMisapplied(asset)) return id;
  const desc = asset?.description?.trim() || "";
  if (desc && !looksLikeImageTemplate(desc) && desc.length <= 220 && !isSkeletonIdentity({ identityInvariants: desc })) {
    // 场景/道具不要把角色外貌短句当设定展示。
    if (asset?.type !== "角色" && (desc.includes("外貌") || desc.includes("发型"))) {
      return "";
    }
    return desc;
  }
  return "";
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
            {settingLabel(type)}
            <textarea
              rows={5}
              maxLength={512}
              value={form.meta}
              onChange={(event) => setForm({ ...form, meta: event.target.value })}
              placeholder={type === "角色"
                ? "例：女性；青年；短发；清秀面容；浅色衬衫。构图与风格由系统自动附加。"
                : type === "场景"
                  ? "例：开放式办公区，玻璃隔断，夕阳侧光，地面反光。构图与风格由系统自动附加。"
                  : "例：金属外壳磨损，侧面有划痕，可手持。构图与风格由系统自动附加。"}
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
  analyzing = false,
  onNameChange,
  onNameBlur,
  onSummaryChange,
  onSummaryBlur,
  onSummarySave,
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
  reviewing = false,
  onReview,
  reviewEnabled = false,
}) {
  const voiceDescriptionChanged = (voiceLock || "").trim() !== (asset?.voiceLock || "").trim();
  const currentGeneration = generations.find((item) => item.selected)
    || generations.find((item) => item.storageKey && item.storageKey === asset?.imageStorageKey);
  const reviewStatus = reviewing
    ? "reviewing"
    : currentGeneration?.arkReviewStatus === "Active"
      ? "active"
      : "idle";
  const reviewError = reviewStatus === "idle" && currentGeneration?.arkReviewStatus === "Failed"
    ? (currentGeneration.arkReviewError || "素材入库失败")
    : "";
  const characterReview = reviewEnabled && type === "角色" ? {
    status: reviewStatus,
    disabled: !asset?.imageStorageKey,
    error: reviewError,
    onClick: onReview,
  } : null;
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
              <label className="youxi-field youxi-field--summary">
                <span>{settingLabel(type)}</span>
                <textarea
                  rows={8}
                  maxLength={512}
                  value={summaryDraft}
                  onChange={onSummaryChange}
                  onBlur={onSummaryBlur}
                  placeholder={type === "角色"
                    ? "例：20岁，女，杏眼，黑色短发，白色圆领T恤，深蓝工装背心，深色长裤。须含性别、年龄、长相、衣着。"
                    : type === "场景"
                      ? "例：开放式办公区，玻璃隔断与工位，夕阳侧光，地面轻微反光。只写空间与陈设，不要人物外貌。"
                      : "例：金属外壳磨损，侧面划痕，可手持。只写外形材质，不要人物外貌。"}
                />
              </label>
              <div className="field-count">{(summaryDraft || "").length} / 512</div>
              <p className="youxi-prompt-hint">
                {!summaryDraft && analyzing
                  ? "设定仍在生成中，请稍候；也可直接手写完善后保存。"
                  : !summaryDraft && (isSkeletonIdentity(asset) || isCharacterIdentityMisapplied(asset))
                    ? `系统未写出可用的${settingLabel(type)}，请手写完善后保存（不会再自动变）。`
                    : type === "角色"
                      ? "此处只编辑性别、年龄、长相、衣着等角色信息（主展示，不会折叠）。三视图构图与视觉风格由系统在生图时自动附加。"
                      : type === "场景"
                        ? "此处只编辑空间结构、陈设与光影氛围，不要填写外貌、发型、服装或年龄。构图与风格由系统在生图时自动附加。"
                        : "此处只编辑外形、材质与标志性细节，不要填写人物外貌。构图与风格由系统在生图时自动附加。"}
              </p>
              <button
                className={`button youxi-prompt-save ${summaryChanged ? "button--primary" : ""}`}
                type="button"
                disabled={!summaryChanged || generating || busy || summarySaving}
                onClick={onSummarySave}
              >
                <Save size={14} /> {summarySaving ? "保存中…" : `保存${settingLabel(type)}`}
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

            <details className="youxi-prompt-advanced">
              <summary>完整生图提示词（系统自动拼装，只读）</summary>
              <pre className="youxi-prompt-compiled">{prompt || "保存外形设定或生图后可在此预览完整提示词"}</pre>
            </details>

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

            <section className="youxi-material-block" aria-label="参考图片">
              <header>
                <strong>参考图片</strong>
                <span>支持多选</span>
              </header>
              <div>
                <button
                  type="button"
                  className="youxi-upload-tile"
                  disabled={busy || generating || historyBusy}
                  onClick={onUploadClick}
                >
                  <Upload size={16} />
                  本地上传
                </button>
                <button
                  type="button"
                  className="youxi-upload-tile"
                  disabled={busy || generating || historyBusy}
                  onClick={onCiteClick}
                >
                  <Folder size={16} />
                  素材库
                </button>
              </div>
            </section>

            {!generationsLoading && (
              <GenerationHistoryPanel
                switchLabel="切换最终资产"
                records={generations}
                locked={false}
                mediaKind="image"
                showImport
                compactActions
                busy={historyBusy || generating || busy || reviewing}
                onSwitchClick={onSwitchFinal}
                onPreview={onPreviewGeneration}
                onDelete={onDeleteGeneration}
                onImport={onImportGeneration}
                review={characterReview}
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
  const [summaryDirty, setSummaryDirty] = useState(false);
  const [batchAssetIds, setBatchAssetIds] = useState(() => new Set());
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
  const reviewAvailabilityQuery = useQuery({
    queryKey: ["drama-ark-review"],
    queryFn: fetchDramaArkReviewAvailability,
  });
  const reviewEnabled = reviewAvailabilityQuery.data?.configured === true;
  const assetsQuery = useQuery({
    queryKey: ["drama-assets", episodeId],
    queryFn: () => fetchDramaAssets(episodeId),
    enabled: Boolean(episodeId),
    // 仅分析进行中才轮询；分析已结束后骨架空话不等于“还在补全”。
    refetchInterval: episode?.analyzing ? 2500 : false,
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
  const checkedCount = filtered.filter((item) => batchAssetIds.has(String(item.id))).length;
  const allChecked = filtered.length > 0 && checkedCount === filtered.length;

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
    setSummaryDirty(false);
    setNameDraft(selected?.name || "");
    setSummaryDraft(identityOf(selected));
    setPromptDraft(promptOf(selected));
    setVoiceLockDraft(selected?.voiceLock || "");
  }, [selected?.id]);

  // 分析增强完成后同一资产 id 会补上详细设定；未手改时同步刷新展示。
  useEffect(() => {
    if (summaryDirty) return;
    setSummaryDraft(identityOf(selected));
  }, [selected?.id, selected?.identityInvariants, selected?.description, summaryDirty]);

  useEffect(() => {
    setPromptDraft(promptOf(selected));
  }, [selected?.imagePrompt, selected?.description]);

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
      setSummaryDirty(false);
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
    }),
    onSuccess: (created) => {
      setCreating(false);
      if (created?.id) setSelectedId(created.id);
      invalidate();
    },
  });

  async function saveFields(asset, extra = {}) {
    const name = (extra.name ?? (asset.id === selected?.id ? nameDraft : asset.name)).trim();
    const identity = (extra.identityInvariants ?? (asset.id === selected?.id ? summaryDraft : identityOf(asset))).trim();
    await updateDramaAsset(asset.id, {
      name,
      identityInvariants: identity,
    });
    setSummaryDirty(false);
  }

  async function generate(asset) {
    markBusy(asset.id, "generate", true);
    try {
      if (asset.id === selected?.id && summaryChanged) {
        await saveFields(asset);
      }
      const result = await generateDramaAssetImage(asset.id, { resolution });
      await pollDramaAssetGenerate(asset.id, result.task.id);
      invalidate();
    } finally {
      markBusy(asset.id, "generate", false);
    }
  }

  async function generateBatch() {
    const checkedAssets = filtered.filter((item) => batchAssetIds.has(String(item.id)));
    if (!checkedAssets.length) {
      showToast("请先勾选要生成的资产");
      return;
    }
    // 方案 A：生图由后端按外形设定拼模板，不再要求库里已有整段 imagePrompt。
    const queue = checkedAssets.filter((item) => !item.generating && !isBusy(item.id, "generate"));
    if (!queue.length) {
      showToast("勾选的资产正在生成中，请稍后再试");
      return;
    }
    const limitRetries = new Map();
    const failures = [];
    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const runQueued = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          await generate(item);
        } catch (error) {
          const retried = limitRetries.get(item.id) || 0;
          // 后端限制同集并发生图数，撞上限说明名额被占用（一张图要生成几十秒）：
          // 属于排队等待而非失败，排到队尾 3 秒后重试，累计可等 6 分钟再判失败。
          if (retried < 120 && /同时生图不能超过/.test(error?.message || "")) {
            limitRetries.set(item.id, retried + 1);
            queue.push(item);
            await wait(3000);
          } else {
            failures.push(`${item.name}：${error?.message || "生成失败"}`);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, () => runQueued()));
    if (failures.length) {
      showToast(`批量生图完成，${failures.length} 个失败：${failures.join("；")}`);
    }
  }

  function toggleBatchAsset(id) {
    setBatchAssetIds((current) => {
      const next = new Set(current);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllBatchAssets() {
    setBatchAssetIds((current) => {
      const next = new Set(current);
      const shouldClear = filtered.every((item) => current.has(String(item.id)));
      if (shouldClear) {
        filtered.forEach((item) => next.delete(String(item.id)));
      } else {
        filtered.forEach((item) => next.add(String(item.id)));
      }
      return next;
    });
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

  function rememberAsset(updated) {
    if (!updated?.id) return;
    queryClient.setQueryData(["drama-assets", episodeId], (current) => {
      if (!Array.isArray(current)) return current;
      return current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
    });
  }

  async function onUploadFiles(files) {
    const list = Array.from(files || []).filter(Boolean);
    const targetId = selected?.id;
    if (!list.length || !targetId) return;
    markBusy(targetId, "upload", true);
    try {
      let updated = null;
      for (const file of list) {
        updated = await uploadDramaAssetImage(targetId, file);
        rememberAsset(updated);
      }
      invalidate();
    } finally {
      markBusy(targetId, "upload", false);
    }
  }

  async function onCiteFromLibrary(libraryAssets) {
    const items = (Array.isArray(libraryAssets) ? libraryAssets : [libraryAssets]).filter((item) => item?.id != null);
    const targetId = selected?.id;
    if (!targetId || !items.length) return;
    setImageLibraryError("");
    markBusy(targetId, "upload", true);
    let done = 0;
    try {
      for (const item of items) {
        const updated = await bindDramaAssetImageFromLibrary(targetId, item.id);
        rememberAsset(updated);
        done += 1;
      }
      setImageLibraryOpen(false);
      setImageLibraryError("");
      await invalidateAssetHistory(targetId);
      invalidate();
      showToast(done > 1 ? `已引用 ${done} 个素材` : "已引用素材");
    } catch (err) {
      const message = err?.message || "引用失败";
      setImageLibraryError(message);
      showToast(message);
      if (done > 0) {
        await invalidateAssetHistory(targetId);
        invalidate();
      }
    } finally {
      markBusy(targetId, "upload", false);
    }
  }

  async function reviewCharacter(asset) {
    if (!asset?.id || !asset.imageStorageKey) return;
    markBusy(asset.id, "review", true);
    try {
      await reviewDramaAsset(asset.id);
      await invalidateAssetHistory(asset.id);
    } catch (err) {
      showToast(err.message);
      await invalidateAssetHistory(asset.id);
    } finally {
      markBusy(asset.id, "review", false);
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
                setSummaryDirty(false);
              }}
            >
              <item.Icon size={16} />
              {item.label}
              <span>{counts[item.id] || 0}</span>
            </button>
          ))}
        </div>
        <p>在三个标签页中管理全剧统一使用的角色、场景与道具。角色填外形，场景填空间陈设，道具填材质细节；构图与风格由系统在生图时自动附加。</p>
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
            <label className="youxi-batch-select">
              <input
                type="checkbox"
                checked={allChecked}
                disabled={!filtered.length}
                aria-label={`全选当前${type}`}
                onChange={toggleAllBatchAssets}
              />
              <span>全选{filtered.length ? `(${checkedCount}/${filtered.length})` : ""}</span>
            </label>
            <button
              type="button"
              className="youxi-batch-generate"
              disabled={!modelBound || extractMutation.isPending || !checkedCount}
              title={!modelBound ? "先选择顶部图像模型" : (checkedCount ? `生成已勾选的 ${checkedCount} 个${type}，并发生成、逐个完成` : "先勾选要生成的资产")}
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
                          disabled={!modelBound || generating || isBusy(item.id, "delete")}
                          title={!modelBound ? "先选择顶部图像模型" : (item.imageStorageKey ? "按当前外形设定重新生成设定图" : "按外形设定生成设定图")}
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
                        <label className="youxi-subject-card__check">
                          <input
                            type="checkbox"
                            checked={batchAssetIds.has(String(item.id))}
                            disabled={generating}
                            aria-label={`勾选${item.name}参与批量生图`}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggleBatchAsset(item.id)}
                          />
                        </label>
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
                            <img key={src} src={src} alt={item.name} onError={retryMediaOnce} />
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
        summaryChanged={summaryChanged}
        summarySaving={isBusy(selected?.id, "summary")}
        analyzing={Boolean(episode?.analyzing)}
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
        reviewing={isBusy(selected?.id, "review")}
        reviewEnabled={reviewEnabled}
        onReview={() => reviewCharacter(selected)}
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
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          onUploadFiles(files).catch((err) => showToast(err.message));
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
