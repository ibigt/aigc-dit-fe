import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  CircleAlert,
  Clapperboard,
  Check,
  Expand,
  Folder,
  Image as ImageIcon,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAssets } from "../../api/assets.js";
import { DemoSelect } from "../DemoSelect.jsx";
import {
  bindDramaAssetImageFromLibrary,
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
  pollDramaAssetGenerate,
  selectDramaAssetGeneration,
  updateDramaAsset,
  uploadDramaAssetImage,
  uploadDramaAssetVoiceReference,
  bindDramaAssetVoiceReference,
  createDramaAssetVersion,
} from "../../api/drama.js";
import {
  assetIdentityKey,
  baseNameOf,
  familyKey,
  familyVersions,
  groupAssetCards,
  isBaseAsset,
  isStateAsset,
  mergeEpisodeAssets,
  siblingAssets,
  versionLabelOf,
} from "../../lib/dramaAssets.js";
import { MEDIA_THUMB_WIDTH, formatDateTime, mediaUrl, retryMediaOnce } from "../../lib/media.js";
import { ImageLightbox } from "../../lib/ImageLightbox.jsx";
import { ConfirmDialog } from "../ConfirmDialog.jsx";
import { GenerationHistoryPanel } from "./GenerationHistoryPanel.jsx";

const TYPES = [
  { id: "角色", label: "角色", Icon: UsersRound },
  { id: "场景", label: "场景", Icon: ImageIcon },
  { id: "道具", label: "道具", Icon: Clapperboard },
];
const RESOLUTIONS = ["1K", "2K"];
// 并发数与后端 DramaContract.MAX_ASSET_GENERATE 对齐：一次点击滚动跑完所有勾选资产。
const BATCH_CONCURRENCY = 16;
const emptyCreate = { name: "", meta: "" };

function stateLabel(asset) {
  return versionLabelOf(asset);
}

/** 资产有没有可用图（延伸版生图前要看基础/父版有没有图）。 */
function hasImage(asset) {
  return Boolean(asset?.imageStorageKey || asset?.imageUrl || asset?.imageAssetId);
}

/** 版本资产的基础版；不存在时返回 null。 */
function baseAssetOf(asset, list) {
  if (!isStateAsset(asset)) return null;
  const key = familyKey(asset);
  return (list || []).find((item) => familyKey(item) === key && isBaseAsset(item)) || null;
}

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

function VoiceLibraryDialog({ assets, loading, busy, error, onClose, onConfirm, onUpload }) {
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
      <section className="creation-asset-dialog asset-voice-library" role="dialog" aria-modal="true" aria-labelledby="voice-library-title">
        <header>
          <div>
            <small>素材库</small>
            <h2 id="voice-library-title">绑定参考音频</h2>
          </div>
          <div className="asset-voice-library-tools">
            <button type="button" disabled={busy} onClick={onUpload}>
              <Upload size={15} /> 上传本地音频
            </button>
            <button type="button" aria-label="关闭音频选择" disabled={busy} onClick={onClose}>
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="creation-asset-grid">
          {loading && <p className="creation-asset-empty">正在加载音频素材…</p>}
          {!loading && !assets.length && <p className="creation-asset-empty">暂无可用音频素材</p>}
          {!loading && assets.map((asset) => {
            const label = asset.title || asset.name || "未命名音频";
            const isSelected = sameAssetId(asset.id, selectedId);
            return (
              <button
                type="button"
                className={isSelected ? "selected" : ""}
                key={asset.id || asset.storageKey || label}
                aria-pressed={isSelected}
                disabled={busy}
                onClick={() => setSelectedId(asset.id)}
              >
                <AudioLines size={16} />
                <span>
                  <strong>{label}</strong>
                  <small>音频素材</small>
                </span>
                {isSelected && <Check size={14} />}
              </button>
            );
          })}
        </div>
        <footer>
          <span>{error ? <em className="drama-form-error" style={{ fontStyle: "normal" }}>{error}</em> : (selected ? "已选择 1 项" : "请选择一段参考音频")}</span>
          <div>
            <button type="button" disabled={busy} onClick={onClose}>取消</button>
            <button
              type="button"
              className="primary"
              disabled={busy || !selected}
              onClick={() => selected && onConfirm(selected)}
            >
              {busy ? "绑定中…" : "绑定"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );

  return createPortal(body, document.body);
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
  if (isStateAsset(asset)) {
    // 状态资产编辑的是「状态外观」：相对本体的变化；本体外形由后端继承，不在这里重复。
    const desc = asset?.description?.trim() || "";
    if (desc && !looksLikeImageTemplate(desc) && !isSkeletonIdentity({ identityInvariants: desc })) {
      return desc;
    }
    const id = asset?.identityInvariants?.trim() || "";
    if (id && !isSkeletonIdentity(asset)) return id;
    return "";
  }
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
          {type === "角色" && (
            <p className="drama-form-hint">
              将作为基础设定。换装/状态等版本请在卡片上「延伸」或「查看全部版本」创建。
            </p>
          )}
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

function imageModelLabel(item) {
  return `${item.name}${item.provider ? ` · ${item.provider}` : ""}`;
}

function historyPreviewDetail(record) {
  return [record?.modelName, record?.resolution].filter(Boolean).join(" · ");
}

function ImageModelSelect({
  imageModels,
  imageModelsLoading,
  imageModelsError,
  imageModelId,
  seriesImageModelId,
  seriesImageModelName,
  disabled,
  onBindModel,
}) {
  const options = [];
  if (!imageModels.length) {
    options.push({ value: "", label: "暂无已启用图像模型", disabled: true });
  }
  if (seriesImageModelId && !imageModels.some((item) => String(item.id) === String(seriesImageModelId))) {
    options.push({
      value: String(seriesImageModelId),
      label: seriesImageModelName || "已绑定（当前已停用）",
    });
  }
  imageModels.forEach((item) => {
    options.push({ value: String(item.id), label: imageModelLabel(item) });
  });

  return (
    <div className="asset-model-control">
      <label>图像模型</label>
      <DemoSelect
        className="asset-model-select"
        ariaLabel="全局图片生成模型"
        placeholder={imageModels.length ? "请选择图像模型" : "暂无已启用图像模型"}
        value={imageModelId ? String(imageModelId) : ""}
        disabled={disabled}
        options={[
          ...(imageModelsLoading ? [{ value: "", label: "正在加载图像模型…", disabled: true }] : []),
          ...(imageModelsError ? [{ value: "", label: "图像模型加载失败", disabled: true }] : []),
          ...(!imageModelsLoading && !imageModelsError && imageModels.length === 0
            ? [{ value: "", label: "暂无已启用图像模型", disabled: true }]
            : []),
          ...(seriesImageModelId && !imageModels.some((item) => String(item.id) === String(seriesImageModelId))
            ? [{ value: seriesImageModelId, label: seriesImageModelName || "已绑定（当前已停用）" }]
            : []),
          ...imageModels.map((item) => ({
            value: String(item.id),
            label: `${item.name}${item.provider ? ` · ${item.provider}` : ""}`,
          })),
        ]}
        onChange={onBindModel}
      />
    </div>
  );
}

export function DramaAssetBoard({ series, episode, onPrev, onNext }) {
  const queryClient = useQueryClient();
  const episodeId = episode?.id;
  const seriesId = series?.id;
  const fileRef = useRef(null);
  const voiceFileRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const [type, setType] = useState("角色");
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [imageModelId, setImageModelId] = useState(series?.imageModelId || "");
  const [resolution, setResolution] = useState("1K");
  const [nameDraft, setNameDraft] = useState("");
  const [editingNameId, setEditingNameId] = useState(null);
  const [promptDrafts, setPromptDrafts] = useState({});
  const [voiceDrafts, setVoiceDrafts] = useState({});
  const [voiceLibraryOpen, setVoiceLibraryOpen] = useState(false);
  const [voiceLibraryError, setVoiceLibraryError] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [finalSelectMode, setFinalSelectMode] = useState(false);
  const [imageLibraryOpen, setImageLibraryOpen] = useState(false);
  const [imageLibraryError, setImageLibraryError] = useState("");
  // 批量生图为整页全局：切 tab 不退出勾选、不清空已选；一次单队列滚动执行。
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchChecked, setBatchChecked] = useState(() => new Set());
  const [deleteAssetTarget, setDeleteAssetTarget] = useState(null);
  const [extendSource, setExtendSource] = useState(null);
  const [extendStateName, setExtendStateName] = useState("");
  const [extendDescription, setExtendDescription] = useState("");
  /** 资产页本地快切：familyKey → version assetId；不影响分镜 @。 */
  const [previewVersionIds, setPreviewVersionIds] = useState({});
  const [workspaceFamilyId, setWorkspaceFamilyId] = useState(null);
  const [workspaceVersionId, setWorkspaceVersionId] = useState(null);
  const [busy, setBusy] = useState({});
  const [actionError, setActionError] = useState("");
  const [preview, setPreview] = useState(null);
  const [deleteGenerationTarget, setDeleteGenerationTarget] = useState(null);
  const toastTimer = useRef(0);

  function showToast(message) {
    if (!message) return;
    setActionError(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setActionError(""), 2400);
  }

  function openExtendDialog(asset) {
    setExtendSource(asset);
    setExtendStateName("");
    setExtendDescription("");
  }

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const imageModelsQuery = useQuery({
    queryKey: ["drama-image-models"],
    queryFn: fetchDramaImageModels,
  });
  const episodeList = series?.episodes?.length ? series.episodes : (episode ? [episode] : []);
  const episodeIds = episodeList.map((item) => item.id).filter(Boolean);
  const anyAnalyzing = episodeList.some((item) => item.analyzing);
  const assetQueries = useQueries({
    queries: episodeIds.map((id) => ({
      queryKey: ["drama-assets", id],
      queryFn: () => fetchDramaAssets(id),
      enabled: Boolean(id),
      // 仅分析进行中才轮询；分析已结束后骨架空话不等于“还在补全”。
      refetchInterval: anyAnalyzing ? 2500 : false,
    })),
  });
  const imageLibraryQuery = useQuery({
    queryKey: ["assets", "image", ""],
    queryFn: () => fetchAssets({ kind: "image" }),
    enabled: imageLibraryOpen,
  });
  const voiceLibraryQuery = useQuery({
    queryKey: ["assets", "audio", ""],
    queryFn: () => fetchAssets({ kind: "audio" }),
    enabled: voiceLibraryOpen,
  });

  const imageModels = imageModelsQuery.data || [];
  const allAssets = assetQueries.flatMap((query) => query.data || []);
  const assets = mergeEpisodeAssets(assetQueries.map((query) => query.data));
  const scriptLocked = episode?.status === "已锁定";
  const canUseTextModel = episode?.canGenerate !== false;

  useEffect(() => {
    setImageModelId(series?.imageModelId || "");
  }, [series?.imageModelId]);

  // 角色按族一人一卡；场景/道具仍一资产一卡。
  const cardsByType = useMemo(() => ({
    角色: groupAssetCards(assets, "角色"),
    场景: groupAssetCards(assets, "场景"),
    道具: groupAssetCards(assets, "道具"),
  }), [assets]);

  const counts = useMemo(() => ({
    角色: cardsByType.角色.length,
    场景: cardsByType.场景.length,
    道具: cardsByType.道具.length,
  }), [cardsByType]);

  const filtered = cardsByType[type];
  const flatItems = useMemo(
    () => filtered.flatMap((card) => card.versions || [card.asset]),
    [filtered],
  );

  function activeVersionOf(card) {
    const versions = card?.versions || (card?.asset ? [card.asset] : []);
    if (!versions.length) return null;
    const key = familyKey(card.asset || versions[0]);
    const preferredId = previewVersionIds[key];
    if (preferredId != null) {
      const hit = versions.find((item) => String(item.id) === String(preferredId));
      if (hit) return hit;
    }
    return versions.find((item) => isBaseAsset(item)) || versions[0];
  }

  function setActiveVersion(asset) {
    if (!asset) return;
    const key = familyKey(asset);
    if (!key) return;
    setPreviewVersionIds((current) => ({ ...current, [key]: asset.id }));
    setSelectedId(asset.id);
  }

  const selected = flatItems.find((item) => item.id === selectedId) || filtered[0]?.asset || null;
  const checkedCount = assets.filter((item) => batchChecked.has(String(item.id))).length;
  const allAssetsChecked = assets.length > 0 && checkedCount === assets.length;
  const allAssetsIndeterminate = checkedCount > 0 && !allAssetsChecked;
  const typeCheckedCount = flatItems.filter((item) => batchChecked.has(String(item.id))).length;
  const allTypeChecked = flatItems.length > 0 && typeCheckedCount === flatItems.length;
  const typeIndeterminate = typeCheckedCount > 0 && !allTypeChecked;

  const historyAssetId = detailId || selected?.id;
  const generationsQuery = useQuery({
    queryKey: ["drama-asset-generations", historyAssetId],
    queryFn: () => fetchDramaAssetGenerations(historyAssetId),
    enabled: Boolean(historyAssetId),
  });
  const generations = generationsQuery.data || [];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    if (!flatItems.length && selectedId != null) setSelectedId(null);
  }, [flatItems, selected, selectedId]);

  useEffect(() => {
    setNameDraft(selected?.name || "");
  }, [selected?.id, selected?.name]);

  function draftOf(asset) {
    if (!asset) return "";
    if (Object.prototype.hasOwnProperty.call(promptDrafts, asset.id)) return promptDrafts[asset.id];
    return identityOf(asset);
  }

  function dirtyOf(asset) {
    if (!asset || !Object.prototype.hasOwnProperty.call(promptDrafts, asset.id)) return false;
    return promptDrafts[asset.id].trim() !== identityOf(asset);
  }

  function voiceDraftOf(asset) {
    if (!asset) return "";
    if (Object.prototype.hasOwnProperty.call(voiceDrafts, asset.id)) return voiceDrafts[asset.id];
    return asset.voiceLock || "";
  }

  function voiceDirtyOf(asset) {
    if (!asset) return false;
    return voiceDraftOf(asset).trim() !== (asset.voiceLock || "").trim();
  }

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["drama-assets"] }),
    queryClient.invalidateQueries({ queryKey: ["drama-asset-generations", selected?.id] }),
    queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] }),
    queryClient.invalidateQueries({ queryKey: ["drama-storyboard"] }),
  ]);

  const invalidateAssetHistory = (assetId) => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["drama-assets"] }),
    queryClient.invalidateQueries({ queryKey: ["drama-asset-generations", assetId] }),
    queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] }),
    queryClient.invalidateQueries({ queryKey: ["drama-storyboard"] }),
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
      setPromptDrafts({});
      invalidate();
    },
    onError: (err) => showToast(err.message),
  });
  const createMutation = useMutation({
    mutationFn: (form) => {
      const name = form.name.trim();
      if (assets.some((item) => assetIdentityKey(item) === assetIdentityKey({ type, name }))) {
        throw new Error(`该${type}已经存在`);
      }
      return createDramaAsset(episodeId, {
        name,
        type,
        description: form.meta.trim() || undefined,
        identityInvariants: form.meta.trim() || undefined,
      });
    },
    onSuccess: (created) => {
      setCreating(false);
      if (created?.id) setSelectedId(created.id);
      invalidate();
    },
  });
  const extendMutation = useMutation({
    mutationFn: ({ source, stateName, description }) => {
      const family = baseNameOf(source.name);
      const label = (stateName || "").trim();
      if (!label) {
        throw new Error("请填写版本标签");
      }
      if (!description.trim()) {
        throw new Error("请填写变化描述，例如「穿红色晚礼服，头发扎起」");
      }
      const versions = familyVersions(source, assets);
      if (versions.some((item) => versionLabelOf(item) === label)) {
        throw new Error(`「${family}」的「${label}」版本已经存在`);
      }
      return createDramaAssetVersion(source.id, {
        versionLabel: label,
        changeDescription: description.trim(),
        parentAssetId: source.id,
      });
    },
    onSuccess: (created) => {
      setExtendSource(null);
      setExtendDescription("");
      if (created?.id) {
        setActiveVersion(created);
        setWorkspaceVersionId(created.id);
      }
      invalidate();
    },
    onError: (err) => showToast(err.message),
  });

  async function saveFields(asset, extra = {}) {
    const payload = {};
    if (extra.name != null) payload.name = extra.name.trim();
    if (extra.identityInvariants != null) payload.identityInvariants = extra.identityInvariants.trim();
    if (extra.description != null) payload.description = extra.description.trim();
    if (!Object.keys(payload).length) return;
    await Promise.all(siblingAssets(asset, allAssets).map((item) => updateDramaAsset(item.id, payload)));
    if (extra.identityInvariants != null || extra.description != null) {
      setPromptDrafts((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, asset.id)) return current;
        const next = { ...current };
        delete next[asset.id];
        return next;
      });
    }
  }

  async function savePrompt(asset) {
    if (!asset || !dirtyOf(asset)) return;
    markBusy(asset.id, "summary", true);
    try {
      // 状态资产存的是「状态外观」（相对本体的变化），本体资产存外形设定。
      if (isStateAsset(asset)) {
        await saveFields(asset, { description: draftOf(asset) });
      } else {
        await saveFields(asset, { identityInvariants: draftOf(asset) });
      }
      await invalidate();
    } finally {
      markBusy(asset.id, "summary", false);
    }
  }

  async function saveVoice(asset) {
    if (!asset || !voiceDirtyOf(asset)) return;
    markBusy(asset.id, "voice", true);
    try {
      const voiceLock = voiceDraftOf(asset).trim();
      const updatedList = await Promise.all(
        siblingAssets(asset, allAssets).map((item) => updateDramaAsset(item.id, { voiceLock })),
      );
      updatedList.forEach(rememberAsset);
      setVoiceDrafts((current) => {
        const next = { ...current };
        delete next[asset.id];
        return next;
      });
      await invalidate();
    } catch (err) {
      showToast(err.message);
    } finally {
      markBusy(asset.id, "voice", false);
    }
  }

  async function onUploadVoice(file) {
    const targetId = detailId || selected?.id;
    if (!file || !targetId) return;
    markBusy(targetId, "voice-file", true);
    setVoiceLibraryError("");
    try {
      const updated = await uploadDramaAssetVoiceReference(targetId, file);
      rememberAsset(updated);
      setVoiceLibraryOpen(false);
      await invalidate();
      showToast("已绑定参考音频");
    } catch (err) {
      const message = err?.message || "绑定参考音频失败";
      setVoiceLibraryError(message);
      showToast(message);
    } finally {
      markBusy(targetId, "voice-file", false);
    }
  }

  async function onBindVoiceFromLibrary(libraryAsset) {
    const targetId = detailId || selected?.id;
    if (!libraryAsset?.id || !targetId) return;
    markBusy(targetId, "voice-file", true);
    setVoiceLibraryError("");
    try {
      const updated = await bindDramaAssetVoiceReference(targetId, libraryAsset.id);
      rememberAsset(updated);
      setVoiceLibraryOpen(false);
      await invalidate();
      showToast("已绑定参考音频");
    } catch (err) {
      const message = err?.message || "绑定参考音频失败";
      setVoiceLibraryError(message);
      showToast(message);
    } finally {
      markBusy(targetId, "voice-file", false);
    }
  }

  async function commitName(asset) {
    const name = nameDraft.trim();
    if (!name) {
      showToast("请输入名称");
      return;
    }
    setEditingNameId(null);
    if (name === asset.name) return;
    // 名字是状态与引用的身份，同系列内不能重名（后端新增时也会拦）。
    const clash = assets.find((item) => item.type === asset.type
      && (item.name || "").trim() === name
      && !siblingAssets(asset, allAssets).some((sibling) => sibling.id === item.id));
    if (clash) {
      showToast(`已存在同名${asset.type}「${name}」`);
      return;
    }
    markBusy(asset.id, "save", true);
    try {
      await saveFields(asset, { name });
      await invalidate();
    } catch (err) {
      showToast(err.message);
    } finally {
      markBusy(asset.id, "save", false);
    }
  }

  async function generate(asset) {
    if (!asset) return;
    if (isStateAsset(asset)) {
      const base = baseAssetOf(asset, assets);
      // 状态图是本体图的改图：本体还没有图就生成，出来的是另一张新脸。
      if (base && !hasImage(base)) {
        showToast(`请先给基础版「${base.name}」生成设定图，再生成延伸版`);
        return;
      }
    }
    if (dirtyOf(asset) || !identityOf(asset)) {
      showToast("请先填写并保存图片提示词");
      return;
    }
    markBusy(asset.id, "generate", true);
    try {
      const result = await generateDramaAssetImage(asset.id, { resolution });
      await pollDramaAssetGenerate(asset.id, result.task.id);
      invalidate();
    } finally {
      markBusy(asset.id, "generate", false);
    }
  }

  async function generateBatch() {
    const checkedAssets = assets.filter((item) => batchChecked.has(String(item.id)));
    if (!checkedAssets.length) {
      showToast("请先勾选要生成的资产");
      return;
    }
    const blockedStates = checkedAssets.filter((item) => {
      if (!isStateAsset(item)) return false;
      const base = baseAssetOf(item, assets);
      return Boolean(base) && !hasImage(base);
    });
    const skipped = checkedAssets.filter((item) => dirtyOf(item) || !identityOf(item)).length + blockedStates.length;
    const queue = checkedAssets.filter((item) => identityOf(item)
      && !dirtyOf(item)
      && !blockedStates.includes(item)
      && !item.generating
      && !isBusy(item.id, "generate"));
    const queuedCount = queue.length;
    if (!queue.length) {
      showToast(blockedStates.length
        ? `有 ${blockedStates.length} 个状态需先给本体生成设定图，已跳过`
        : skipped ? "所选资产暂无可用提示词，请先填写并保存" : "勾选的资产正在生成中，请稍后再试");
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
    setBatchRunning(true);
    try {
      await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, () => runQueued()));
      setBatchSelectMode(false);
      setBatchChecked(new Set());
      if (failures.length) {
        showToast(`批量生图完成，${failures.length} 个失败：${failures.join("；")}`);
      } else if (skipped) {
        showToast(`批量生图完成：成功 ${queuedCount} 项，跳过 ${skipped} 项`);
      }
    } finally {
      setBatchRunning(false);
    }
  }

  function exitBatchSelectMode() {
    setBatchSelectMode(false);
    setBatchChecked(new Set());
  }

  function toggleBatchAsset(id) {
    setBatchChecked((current) => {
      const next = new Set(current);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAllAssets() {
    setBatchChecked((current) => {
      const allSelected = assets.length > 0 && assets.every((item) => current.has(String(item.id)));
      if (allSelected) return new Set();
      return new Set(assets.map((item) => String(item.id)));
    });
  }

  function toggleSelectAllInType() {
    setBatchChecked((current) => {
      const next = new Set(current);
      const typeItems = assets.filter((item) => item.type === type);
      const allSelected = typeItems.length > 0 && typeItems.every((item) => next.has(String(item.id)));
      if (allSelected) {
        typeItems.forEach((item) => next.delete(String(item.id)));
      } else {
        typeItems.forEach((item) => next.add(String(item.id)));
      }
      return next;
    });
  }

  async function remove(asset) {
    markBusy(asset.id, "delete", true);
    try {
      const targets = siblingAssets(asset, allAssets);
      await Promise.all(targets.map((item) => deleteDramaAsset(item.id)));
      if (targets.some((item) => item.id === selectedId)) setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ["creations"] });
      invalidate();
    } finally {
      markBusy(asset.id, "delete", false);
    }
  }

  function rememberAsset(updated) {
    if (!updated?.id) return;
    for (const id of episodeIds) {
      queryClient.setQueryData(["drama-assets", id], (current) => {
        if (!Array.isArray(current) || !current.some((item) => item.id === updated.id)) return current;
        return current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
      });
    }
  }

  async function onUploadFiles(files) {
    const list = Array.from(files || []).filter(Boolean);
    const targetId = uploadTargetRef.current || selected?.id;
    if (!list.length || !targetId) return;
    markBusy(targetId, "upload", true);
    try {
      let updated = null;
      for (const file of list) {
        updated = await uploadDramaAssetImage(targetId, file);
        rememberAsset(updated);
      }
      await invalidateAssetHistory(targetId);
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

  async function selectGeneration(record) {
    if (!selected?.id || !record?.id || record.selected) return;
    markBusy(selected.id, "history", true);
    try {
      await selectDramaAssetGeneration(selected.id, record.id);
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
      queryClient.invalidateQueries({ queryKey: ["creations"] });
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

  const modelBound = Boolean(imageModelId);
  const selectedBusy = isBusy(selected?.id, "lock") || isBusy(selected?.id, "save") || isBusy(selected?.id, "upload");
  const selectedGenerating = Boolean(selected?.generating) || isBusy(selected?.id, "generate");
  const detailAsset = assets.find((item) => item.id === detailId) || null;
  const workspaceSeed = workspaceFamilyId != null
    ? assets.find((item) => String(item.id) === String(workspaceFamilyId))
    : null;
  const workspaceVersions = workspaceSeed ? familyVersions(workspaceSeed, assets) : [];
  const workspaceAsset = workspaceVersions.find((item) => String(item.id) === String(workspaceVersionId))
    || workspaceVersions.find((item) => isBaseAsset(item))
    || workspaceVersions[0]
    || null;
  const workspaceBase = workspaceAsset ? (isBaseAsset(workspaceAsset) ? workspaceAsset : baseAssetOf(workspaceAsset, assets)) : null;
  const workspaceHistoryId = workspaceAsset?.id;
  const workspaceGenerationsQuery = useQuery({
    queryKey: ["drama-asset-generations", workspaceHistoryId],
    queryFn: () => fetchDramaAssetGenerations(workspaceHistoryId),
    enabled: Boolean(workspaceHistoryId),
  });
  const workspaceGenerations = workspaceGenerationsQuery.data || [];

  useEffect(() => {
    setFinalSelectMode(false);
  }, [detailId]);

  function openDetail(asset) {
    setSelectedId(asset.id);
    setDetailId(asset.id);
  }

  function pickUpload(asset) {
    uploadTargetRef.current = asset.id;
    setSelectedId(asset.id);
    fileRef.current?.click();
  }

  return (
    <div className="drama-asset-board youxi-subject-layout">
      {actionError && createPortal(
        <div className="drama-toast drama-toast--error drama-toast--float" role="status">
          <CircleAlert size={16} />{actionError}
        </div>,
        document.body,
      )}
      <section className="asset-workbench">
        <header className="asset-category-row">
          <div className="asset-category-tabs" role="tablist" aria-label="资产分类">
            {TYPES.map((item) => {
              const typeHasChecked = batchRunning && assets.some(
                (asset) => asset.type === item.id && batchChecked.has(String(asset.id)),
              );
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={type === item.id}
                  className={`asset-category-tab${type === item.id ? " is-active" : ""}`}
                  onClick={() => {
                    setType(item.id);
                    setDetailId(null);
                    const first = assets.find((asset) => asset.type === item.id);
                    setSelectedId(first?.id || null);
                  }}
                >
                  <item.Icon size={18} />
                  <span>{item.label}</span>
                  <strong>{counts[item.id] || 0}</strong>
                  {typeHasChecked && <span className="asset-spinner" aria-label="批量生图中" />}
                </button>
              );
            })}
          </div>
          <div className="asset-category-actions">
            {!batchSelectMode ? (
              <button
                className="asset-secondary-button"
                type="button"
                disabled={!assets.length || extractMutation.isPending || batchRunning}
                title="进入勾选，再生成已选项"
                onClick={() => setBatchSelectMode(true)}
              >
                <Sparkles size={17} />
                <span>批量生图</span>
              </button>
            ) : (
              <>
                <button
                  className={`asset-secondary-button${batchRunning ? " is-loading" : ""}`}
                  type="button"
                  disabled={checkedCount === 0 || !modelBound || batchRunning || extractMutation.isPending}
                  title={!modelBound ? "先选择图像模型" : checkedCount ? `生成已选 ${checkedCount} 项` : "请先勾选资产"}
                  onClick={() => generateBatch().catch((err) => showToast(err.message))}
                >
                  {batchRunning ? <span className="asset-spinner" /> : <Sparkles size={17} />}
                  <span>{batchRunning ? `正在生成 ${checkedCount} 项…` : checkedCount ? `批量生图（${checkedCount}）` : "批量生图"}</span>
                </button>
                <button
                  className="asset-secondary-button"
                  type="button"
                  disabled={batchRunning}
                  title="退出批量勾选"
                  onClick={exitBatchSelectMode}
                >
                  <X size={17} />
                  <span>取消</span>
                </button>
              </>
            )}
            <button
              className={`asset-extract-button${extractMutation.isPending ? " is-loading" : ""}`}
              type="button"
              disabled={!scriptLocked || !episodeId || extractMutation.isPending || !canUseTextModel || batchRunning}
              title={scriptLocked
                ? (!canUseTextModel ? "请先在剧本页绑定可用文本模型" : "按当前剧本重新提取资产")
                : "请先回剧本页完成一键分析"}
              onClick={() => extractMutation.mutate()}
            >
              {extractMutation.isPending ? <span className="asset-spinner" /> : <Sparkles size={17} />}
              <span>{extractMutation.isPending ? "正在重新提取中" : "从剧本提取"}</span>
            </button>
          </div>
        </header>
        {!scriptLocked && <p className="drama-asset-analyze-hint">请先回到剧本页，完成一键分析后再提取。</p>}
        <div className="asset-toolbar">
          <ImageModelSelect
            imageModels={imageModels}
            imageModelsLoading={imageModelsQuery.isLoading}
            imageModelsError={imageModelsQuery.isError}
            imageModelId={imageModelId}
            seriesImageModelId={series?.imageModelId}
            seriesImageModelName={series?.imageModelName}
            disabled={bindMutation.isPending || batchRunning}
            onBindModel={(value) => {
              setImageModelId(value);
              if (value) bindMutation.mutate(value);
            }}
          />
          <div className="asset-toolbar-actions">
            {batchSelectMode && (
              <>
                <label className={`asset-select-all${allAssetsIndeterminate ? " is-indeterminate" : ""}`}>
                  <input
                    type="checkbox"
                    checked={allAssetsChecked}
                    disabled={!assets.length || batchRunning}
                    aria-label="一键全选全部资产"
                    ref={(node) => {
                      if (node) node.indeterminate = allAssetsIndeterminate;
                    }}
                    onChange={toggleSelectAllAssets}
                  />
                  <span className="asset-checkbox" aria-hidden="true"><Check size={12} /></span>
                  <span>一键全选</span>
                </label>
                <label className={`asset-select-all${typeIndeterminate ? " is-indeterminate" : ""}`}>
                  <input
                    type="checkbox"
                    checked={allTypeChecked}
                    disabled={!filtered.length || batchRunning}
                    aria-label={`一键全选${type}`}
                    ref={(node) => {
                      if (node) node.indeterminate = typeIndeterminate;
                    }}
                    onChange={toggleSelectAllInType}
                  />
                  <span className="asset-checkbox" aria-hidden="true"><Check size={12} /></span>
                  <span>一键全选{type}</span>
                </label>
                <span className="asset-selected-count">已选 <strong>{checkedCount}</strong> 项</span>
              </>
            )}
            <button className="asset-primary-button" type="button" disabled={batchRunning} onClick={() => setCreating(true)}>
              <Plus size={17} />
              <span>新增{type}</span>
            </button>
          </div>
        </div>

        <div className="asset-content">
          {filtered.length === 0 ? (
            <section className="asset-empty-state">
              <div className="asset-empty-icon">{type === "场景" ? <ImageIcon size={31} /> : type === "道具" ? <Clapperboard size={31} /> : <UsersRound size={31} />}</div>
              <h3>暂无{type}资产</h3>
              <p>可以从剧本中提取{type}，或手动新增{type}资产。</p>
              <button className="asset-primary-button" type="button" onClick={() => setCreating(true)}>
                <Plus size={17} />
                <span>新增{type}</span>
              </button>
            </section>
          ) : (
            <div className="asset-grid">
              {filtered.map((card) => {
                const versions = card.versions || [card.asset];
                const item = activeVersionOf(card) || card.asset;
                const familyName = baseNameOf(item?.name || card.asset?.name);
                const base = versions.find((v) => isBaseAsset(v)) || card.asset;
                const src = mediaUrl(item.imageStorageKey || item.imageUrl, { w: MEDIA_THUMB_WIDTH });
                const generating = Boolean(item.generating) || isBusy(item.id, "generate");
                const uploading = isBusy(item.id, "upload");
                const busyCard = generating || uploading || batchRunning;
                const selectedCard = versions.some((v) => batchChecked.has(String(v.id)));
                const promptDirty = dirtyOf(item);
                const promptSaving = isBusy(item.id, "summary");
                const versionCount = versions.length;
                const showVersionBar = item.type === "角色" && versionCount > 0;
                return (
                  <article className={`asset-card${selectedCard ? " is-selected" : ""}`} key={familyKey(card.asset) || item.id} data-asset-card={item.id}>
                    <header className="asset-card-header">
                      {editingNameId === (base?.id || item.id) ? (
                        <input
                          className="asset-name-input"
                          autoFocus
                          maxLength={128}
                          aria-label="修改资产名称"
                          value={nameDraft}
                          onChange={(event) => setNameDraft(event.target.value)}
                          onBlur={() => commitName(base || item)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitName(base || item);
                            } else if (event.key === "Escape") {
                              setNameDraft(familyName);
                              setEditingNameId(null);
                            }
                          }}
                        />
                      ) : (
                        <div className="asset-title-group">
                          {batchSelectMode && (
                            <label className="asset-card-select" title={`${selectedCard ? "取消选择" : "选择"} ${familyName}`}>
                              <input
                                type="checkbox"
                                checked={selectedCard}
                                disabled={batchRunning}
                                aria-label={`选择 ${familyName}`}
                                onChange={() => toggleBatchAsset(item.id)}
                              />
                              <span className="asset-checkbox" aria-hidden="true"><Check size={12} /></span>
                            </label>
                          )}
                          <h3 title={familyName}>{familyName}</h3>
                          {item.type === "角色" && versionCount > 1 && (
                            <span className="asset-state-chip">共 {versionCount} 版</span>
                          )}
                          <button
                            className="asset-edit-name"
                            type="button"
                            aria-label={`修改 ${familyName} 的名称`}
                            disabled={busyCard}
                            onClick={() => {
                              setSelectedId((base || item).id);
                              setNameDraft(familyName);
                              setEditingNameId((base || item).id);
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                        </div>
                      )}
                      {showVersionBar && versionCount > 1 ? (
                        <DemoSelect
                          className="asset-version-select"
                          ariaLabel={`切换 ${familyName} 的版本`}
                          placeholder="选择版本"
                          value={String(item.id)}
                          disabled={batchRunning}
                          options={versions.map((ver) => ({
                            value: String(ver.id),
                            label: stateLabel(ver),
                          }))}
                          onChange={(value) => {
                            const next = versions.find((ver) => String(ver.id) === String(value));
                            if (next) setActiveVersion(next);
                          }}
                        />
                      ) : null}
                      <div className="asset-card-actions">
                        {item.type === "角色" && (
                          <button type="button" aria-label={`延伸 ${familyName}`} title="延伸版本" disabled={batchRunning} onClick={() => openExtendDialog(item)}>
                            <Sparkles size={17} />
                          </button>
                        )}
                        <button className="danger" type="button" aria-label={`删除 ${isBaseAsset(item) ? familyName : stateLabel(item)}`} title={isBaseAsset(item) ? "删除整族" : "删除此版本"} disabled={batchRunning || isBusy(item.id, "delete")} onClick={() => setDeleteAssetTarget(item)}>
                          <Trash2 size={17} />
                        </button>
                        <button type="button" aria-label={`上传 ${familyName} 的图片`} title="上传图片" disabled={busyCard} onClick={() => pickUpload(item)}>
                          <Upload size={17} />
                        </button>
                      </div>
                    </header>
                    <div className="asset-image-wrap">
                      {src ? (
                        <button className="asset-card-image-button" type="button" aria-label={`打开 ${familyName} 的图片生成弹窗`} disabled={busyCard} onClick={() => openDetail(item)}>
                          <img key={src} src={src} alt={familyName} onError={retryMediaOnce} />
                          <span className="asset-card-image-open" aria-hidden="true"><Expand size={15} /></span>
                        </button>
                      ) : (
                        <div className="asset-placeholder">
                          <ImageIcon size={32} />
                          <button type="button" disabled={busyCard} onClick={() => pickUpload(item)}>上传图片</button>
                          <span>或在下方生成资产图</span>
                        </div>
                      )}
                      {(generating || uploading) && (
                        <div className="asset-image-status" role="status">
                          <span className="asset-spinner" />
                          <strong>{uploading ? "正在上传…" : "正在生成…"}</strong>
                        </div>
                      )}
                      {showVersionBar && versionCount > 1 && (
                        <button
                          type="button"
                          className="asset-version-all-corner"
                          disabled={batchRunning}
                          title="查看全部版本"
                          onClick={() => {
                            setWorkspaceFamilyId(base?.id || item.id);
                            setWorkspaceVersionId(item.id);
                          }}
                        >
                          查看全部版本
                        </button>
                      )}
                    </div>
                    <div className="asset-prompt-field">
                      <label htmlFor={`prompt-${item.id}`}>{isStateAsset(item) ? "变化描述" : "外形设定"}</label>
                      <textarea
                        id={`prompt-${item.id}`}
                        rows={4}
                        maxLength={512}
                        disabled={batchRunning}
                        value={draftOf(item)}
                        placeholder={isStateAsset(item) ? "写这一版本相对基础的变化，如：穿红色晚礼服，头发扎起" : "输入外形设定…"}
                        onChange={(event) => {
                          const value = event.target.value;
                          setPromptDrafts((current) => ({ ...current, [item.id]: value }));
                        }}
                      />
                    </div>
                    <footer className="asset-card-footer">
                      <div className="asset-card-footer-actions">
                        <button
                          className="asset-generate-button"
                          type="button"
                          disabled={!modelBound || busyCard}
                          title={!modelBound ? "先选择图像模型" : "按已保存的设定生成"}
                          onClick={() => {
                            setActiveVersion(item);
                            generate(item).catch((err) => showToast(err.message));
                          }}
                        >
                          {generating ? <span className="asset-spinner small" /> : <Sparkles size={14} />}
                          <span>{generating ? "生成中…" : "图片生成"}</span>
                        </button>
                        <button
                          className={`asset-save-prompt${promptDirty ? " is-dirty" : ""}`}
                          type="button"
                          disabled={!promptDirty || promptSaving || batchRunning}
                          onClick={() => savePrompt(item).catch((err) => showToast(err.message))}
                        >
                          {promptSaving ? "正在保存…" : "保存提示词"}
                        </button>
                        {item.type === "角色" && (
                          <button
                            type="button"
                            className="asset-save-prompt"
                            disabled={batchRunning}
                            onClick={() => {
                              setWorkspaceFamilyId(base?.id || item.id);
                              setWorkspaceVersionId(item.id);
                            }}
                          >
                            全部版本
                          </button>
                        )}
                      </div>
                      <button className="asset-expand-button" type="button" aria-label={`查看 ${familyName} 详情`} title="查看详情" disabled={batchRunning} onClick={() => openDetail(item)}>
                        <Expand size={17} />
                      </button>
                    </footer>
                  </article>
                );
              })}
              <button className="asset-add-card" type="button" disabled={batchRunning} onClick={() => setCreating(true)}>
                <Plus size={20} />
                <strong>新增{type}</strong>
                <span>创建一个空白{type}资产</span>
              </button>
            </div>
          )}
        </div>
        <section className="drama-asset-guide asset-stage-guide" aria-label="资产设置流程引导">
          <strong><Sparkles size={14} /> 角色和场景设定会应用到整部剧集中，建议调整完毕后再继续哦</strong>
          <div className="asset-stage-guide-actions">
            <button className="asset-stage-guide-previous" type="button" aria-label="上一步：返回剧本" onClick={() => onPrev?.()}>
              <ArrowLeft size={17} />
            </button>
            <button className="script-complete-action" type="button" onClick={() => onNext?.()}>
              <span>下一步</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </section>

      {detailAsset && createPortal(
        <div
          className="drama-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !selectedGenerating) setDetailId(null);
          }}
        >
          <section className={`asset-image-modal has-history is-detail${detailAsset.type === "角色" ? "" : " is-compact"}`} role="dialog" aria-modal="true" aria-labelledby="asset-image-modal-title">
            <header className="asset-image-modal-header">
              {editingNameId === detailAsset.id ? (
                <input
                  className="asset-name-input"
                  autoFocus
                  maxLength={128}
                  aria-label="修改资产名称"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={() => commitName(detailAsset)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitName(detailAsset);
                    } else if (event.key === "Escape") {
                      setNameDraft(detailAsset.name);
                      setEditingNameId(null);
                    }
                  }}
                />
              ) : (
                <div className="asset-modal-title">
                  <h2 id="asset-image-modal-title">{detailAsset.name}</h2>
                  <button
                    type="button"
                    aria-label={`修改 ${detailAsset.name} 的名称`}
                    onClick={() => {
                      setNameDraft(detailAsset.name);
                      setEditingNameId(detailAsset.id);
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              )}
              <button type="button" aria-label="关闭" onClick={() => setDetailId(null)}><X size={18} /></button>
            </header>
            <div className="asset-image-modal-body">
              <div className="asset-modal-config">
                <section className="asset-modal-section">
                  <div className="asset-modal-parameter-grid">
                    <ImageModelSelect
                      imageModels={imageModels}
                      imageModelsLoading={imageModelsQuery.isLoading}
                      imageModelsError={imageModelsQuery.isError}
                      imageModelId={imageModelId}
                      seriesImageModelId={series?.imageModelId}
                      seriesImageModelName={series?.imageModelName}
                      disabled={bindMutation.isPending || selectedGenerating}
                      onBindModel={(value) => {
                        setImageModelId(value);
                        if (value) bindMutation.mutate(value);
                      }}
                    />
                    <div className="asset-modal-resolution">
                      <span>分辨率</span>
                      <div role="group" aria-label="分辨率">
                        {RESOLUTIONS.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className={resolution === item ? "is-active" : ""}
                            onClick={() => setResolution(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="asset-modal-prompt-head">
                    <label htmlFor="asset-modal-prompt">{isStateAsset(detailAsset) ? "变化描述" : "外形设定"}</label>
                    <button
                      type="button"
                      disabled={!dirtyOf(detailAsset) || isBusy(detailAsset.id, "summary") || selectedGenerating}
                      onClick={() => savePrompt(detailAsset).catch((err) => showToast(err.message))}
                    >
                      {isBusy(detailAsset.id, "summary") ? "正在保存…" : dirtyOf(detailAsset) ? "保存提示词" : "已保存"}
                    </button>
                  </div>
                  <textarea
                    id="asset-modal-prompt"
                    className="asset-modal-prompt asset-detail-prompt"
                    maxLength={512}
                    value={draftOf(detailAsset)}
                    placeholder={isStateAsset(detailAsset) ? "写这一版本相对基础的变化，如：穿红色晚礼服，头发扎起" : "输入外形设定…"}
                    disabled={selectedGenerating}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPromptDrafts((current) => ({ ...current, [detailAsset.id]: value }));
                    }}
                  />
                </section>
                {detailAsset.type === "角色" && (
                  <section className="asset-modal-section asset-voice-section">
                    <div className="asset-voice-head">
                      <h3>音色</h3>
                      <span>{detailAsset.voiceReferenceUrl ? "已绑定参考音频" : "可绑定参考音频"}</span>
                    </div>
                    <input
                      className="asset-voice-input"
                      maxLength={256}
                      value={voiceDraftOf(detailAsset)}
                      placeholder="例：30岁低沉男声，普通话，克制冷静"
                      disabled={selectedGenerating || isBusy(detailAsset.id, "voice")}
                      onChange={(event) => {
                        const value = event.target.value;
                        setVoiceDrafts((current) => ({ ...current, [detailAsset.id]: value }));
                      }}
                    />
                    <div className="asset-voice-actions">
                      <button
                        type="button"
                        className="asset-voice-bind"
                        disabled={selectedGenerating || isBusy(detailAsset.id, "voice-file")}
                        onClick={() => {
                          setSelectedId(detailAsset.id);
                          setVoiceLibraryError("");
                          setVoiceLibraryOpen(true);
                        }}
                      >
                        <AudioLines size={15} /> {isBusy(detailAsset.id, "voice-file") ? "正在绑定…" : "绑定参考音频"}
                      </button>
                      <button
                        type="button"
                        className="asset-voice-save"
                        disabled={!voiceDirtyOf(detailAsset) || isBusy(detailAsset.id, "voice") || selectedGenerating}
                        onClick={() => saveVoice(detailAsset)}
                      >
                        <Check size={15} /> {isBusy(detailAsset.id, "voice") ? "保存中…" : "保存"}
                      </button>
                    </div>
                    {detailAsset.voiceReferenceUrl && (
                      <audio
                        className="asset-voice-player"
                        controls
                        src={mediaUrl(detailAsset.voiceReferenceKey || detailAsset.voiceReferenceUrl)}
                      />
                    )}
                    <p className="asset-voice-hint">可为角色保存参考音频；到分镜阶段将按所选视频模型能力决定是否使用。</p>
                  </section>
                )}
                <section className="asset-modal-section asset-reference-section">
                  <div className="asset-modal-section-head asset-reference-head">
                    <h3>参考图片</h3>
                    <div className="asset-reference-actions">
                      <button type="button" disabled={selectedBusy || selectedGenerating} onClick={() => pickUpload(detailAsset)}>
                        <Upload size={15} /> 上传图片
                      </button>
                      <button
                        type="button"
                        disabled={selectedBusy || selectedGenerating}
                        onClick={() => {
                          setSelectedId(detailAsset.id);
                          setImageLibraryError("");
                          setImageLibraryOpen(true);
                        }}
                      >
                        <Folder size={15} /> 素材库选择
                      </button>
                    </div>
                  </div>
                  <p className="asset-reference-hint">可上传本地图片，或从素材库中选择。选中后会替换当前资产图，并写入生成历史。</p>
                </section>
                <div className="asset-generate-action">
                  <button
                    type="button"
                    className="asset-modal-generate"
                    disabled={!modelBound || selectedGenerating || selectedBusy}
                    onClick={() => generate(detailAsset).catch((err) => showToast(err.message))}
                  >
                    {selectedGenerating ? "正在生成…" : <><Sparkles size={16} /> 开始生成</>}
                  </button>
                </div>
              </div>
              <aside className="asset-history-panel">
                <GenerationHistoryPanel
                  title="生成历史"
                  countLabel={`${generations.length}`}
                  titleBadge={detailAsset.type === "角色" ? stateLabel(detailAsset) : ""}
                  hint={(
                    <>
                      “当前选中”即页面正在使用的图片。
                      <br />
                      点击缩略图可看大图、生成时间与模型来源。
                    </>
                  )}
                  switchLabel="切换当前资产"
                  records={generations}
                  locked={false}
                  mediaKind="image"
                  showImport
                  compactActions
                  selecting={finalSelectMode}
                  selectedBadge="当前选中"
                  itemName={detailAsset.name}
                  busy={isBusy(detailAsset.id, "history") || generationsQuery.isLoading || selectedGenerating}
                  onSwitchClick={() => setFinalSelectMode((current) => !current)}
                  onSelect={(record) => selectGeneration(record)}
                  onPreview={(record) => setPreview({
                    src: mediaUrl(record.url || record.storageKey),
                    title: `${detailAsset.name || ""} · ${record.label}`,
                    time: formatDateTime(record.createdAt),
                    detail: historyPreviewDetail(record),
                  })}
                  onDelete={requestDeleteGeneration}
                  onImport={importGeneration}
                />
              </aside>
            </div>
          </section>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={Boolean(deleteAssetTarget)}
        eyebrow="资产"
        title={deleteAssetTarget && isBaseAsset(deleteAssetTarget) ? "删除整个角色？" : "删除此版本？"}
        message={deleteAssetTarget
          ? (isBaseAsset(deleteAssetTarget)
            ? `将删除「${baseNameOf(deleteAssetTarget.name)}」及其全部版本。此操作不可撤销。`
            : `将删除「${baseNameOf(deleteAssetTarget.name)}·${stateLabel(deleteAssetTarget)}」。此操作不可撤销。`)
          : ""}
        confirmLabel="删除"
        busy={isBusy(deleteAssetTarget?.id, "delete")}
        busyLabel="删除中…"
        onClose={() => setDeleteAssetTarget(null)}
        onConfirm={() => {
          const target = deleteAssetTarget;
          if (!target) return;
          remove(target)
            .then(() => {
              setDeleteAssetTarget(null);
              if (detailId === target.id) setDetailId(null);
              if (String(workspaceVersionId) === String(target.id)) setWorkspaceVersionId(null);
            })
            .catch((err) => showToast(err.message));
        }}
      />

      {extendSource && createPortal(
        <div
          className="drama-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !extendMutation.isPending) setExtendSource(null);
          }}
        >
          <section className="creation-asset-dialog" role="dialog" aria-modal="true" aria-labelledby="extend-state-title" style={{ maxWidth: 420 }}>
            <header>
              <div>
                <small>延伸创作</small>
                <h2 id="extend-state-title">基于「{stateLabel(extendSource)}」延伸</h2>
              </div>
              <button type="button" aria-label="关闭延伸" disabled={extendMutation.isPending} onClick={() => setExtendSource(null)}>
                <X size={17} />
              </button>
            </header>
            <div className="drama-extend-form">
              <label>
                <span>版本标签</span>
                <input
                  aria-label="版本标签"
                  maxLength={16}
                  placeholder="如：换装、湿身、校服"
                  value={extendStateName}
                  onChange={(event) => setExtendStateName(event.target.value)}
                />
              </label>
              <label>
                <span>变化描述（必填）</span>
                <textarea
                  rows={3}
                  maxLength={512}
                  placeholder="如：穿红色晚礼服，头发扎起，佩戴珍珠耳环…"
                  value={extendDescription}
                  onChange={(event) => setExtendDescription(event.target.value)}
                />
              </label>
              <p className="drama-extend-hint">
                分镜引用为「@{baseNameOf(extendSource.name)}·{extendStateName.trim() || "标签"}」。
                延伸创作将自动保持样貌/身高等与基础版一致。
              </p>
            </div>
            <footer>
              <span>{extendMutation.isPending ? "正在创建…" : ""}</span>
              <div>
                <button type="button" disabled={extendMutation.isPending} onClick={() => setExtendSource(null)}>取消</button>
                <button
                  type="button"
                  className="primary"
                  disabled={extendMutation.isPending}
                  onClick={() => extendMutation.mutate({
                    source: extendSource,
                    stateName: extendStateName,
                    description: extendDescription,
                  })}
                >
                  创建版本
                </button>
              </div>
            </footer>
          </section>
        </div>,
        document.body,
      )}

      {workspaceAsset && createPortal(
        <div
          className="drama-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setWorkspaceFamilyId(null);
              setWorkspaceVersionId(null);
            }
          }}
        >
          <section className="asset-image-modal has-history" role="dialog" aria-modal="true" aria-labelledby="version-workspace-title">
            <header className="asset-image-modal-header">
              <div className="asset-modal-title">
                <h2 id="version-workspace-title">{baseNameOf(workspaceAsset.name)} · 版本工作台</h2>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => {
                  setWorkspaceFamilyId(null);
                  setWorkspaceVersionId(null);
                }}
              >
                <X size={18} />
              </button>
            </header>
            <div className="asset-image-modal-body">
              <div className="asset-modal-config">
                <p className="drama-extend-hint">
                  延伸创作将自动带上「样貌/身高等与基础版一致」的系统句；当前选中：{stateLabel(workspaceAsset)}
                </p>
                <section className="asset-modal-section">
                  <div className="asset-modal-prompt-head">
                    <label htmlFor="workspace-prompt">{isStateAsset(workspaceAsset) ? "变化描述" : "外形设定"}</label>
                    <button
                      type="button"
                      disabled={!dirtyOf(workspaceAsset) || isBusy(workspaceAsset.id, "summary")}
                      onClick={() => savePrompt(workspaceAsset).catch((err) => showToast(err.message))}
                    >
                      {isBusy(workspaceAsset.id, "summary") ? "正在保存…" : dirtyOf(workspaceAsset) ? "保存" : "已保存"}
                    </button>
                  </div>
                  <textarea
                    id="workspace-prompt"
                    className="asset-modal-prompt workspace-version-prompt"
                    maxLength={512}
                    value={draftOf(workspaceAsset)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPromptDrafts((current) => ({ ...current, [workspaceAsset.id]: value }));
                    }}
                  />
                  <div className="workspace-version-actions">
                    <button
                      type="button"
                      className="asset-generate-button"
                      disabled={!modelBound || isBusy(workspaceAsset.id, "generate")}
                      onClick={() => {
                        setActiveVersion(workspaceAsset);
                        generate(workspaceAsset).catch((err) => showToast(err.message));
                      }}
                    >
                      {(Boolean(workspaceAsset.generating) || isBusy(workspaceAsset.id, "generate"))
                        ? "生成中…"
                        : "图片生成"}
                    </button>
                    <button type="button" className="asset-generate-button" onClick={() => pickUpload(workspaceAsset)}>
                      上传图片
                    </button>
                    <button type="button" className="asset-generate-button" onClick={() => openExtendDialog(workspaceAsset)}>
                      基于此版延伸
                    </button>
                  </div>
                  {(() => {
                    const src = mediaUrl(workspaceAsset.imageStorageKey || workspaceAsset.imageUrl, { w: 960 });
                    return src ? (
                      <button
                        type="button"
                        className="workspace-version-preview"
                        onClick={() => setPreview({
                          src: mediaUrl(workspaceAsset.imageStorageKey || workspaceAsset.imageUrl),
                          title: `${baseNameOf(workspaceAsset.name)}·${stateLabel(workspaceAsset)}`,
                        })}
                      >
                        <img src={src} alt="" onError={retryMediaOnce} />
                      </button>
                    ) : (
                      <div className="workspace-version-preview is-empty">
                        <ImageIcon size={32} />
                        <span>暂无图片</span>
                      </div>
                    );
                  })()}
                </section>
              </div>
              <aside className="asset-history-panel">
                <div className="asset-modal-states" style={{ flexWrap: "wrap", marginBottom: 12 }}>
                  {workspaceVersions.map((ver) => {
                    const parent = ver.parentAssetId
                      ? workspaceVersions.find((v) => v.id === ver.parentAssetId)
                      : null;
                    const label = parent
                      ? `${stateLabel(parent)} → ${stateLabel(ver)}`
                      : stateLabel(ver);
                    return (
                      <button
                        key={ver.id}
                        type="button"
                        className={String(ver.id) === String(workspaceAsset.id) ? "is-active" : ""}
                        title={label}
                        onClick={() => {
                          setWorkspaceVersionId(ver.id);
                          setActiveVersion(ver);
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <GenerationHistoryPanel
                  title="本版生成历史"
                  countLabel={`${workspaceGenerations.length}`}
                  hint="与「版本」正交：同一服装/状态下的多张候选图。"
                  switchLabel="切换当前选用"
                  records={workspaceGenerations}
                  locked={false}
                  mediaKind="image"
                  showImport
                  compactActions
                  selecting={finalSelectMode}
                  selectedBadge="当前选中"
                  itemName={`${baseNameOf(workspaceAsset.name)}·${stateLabel(workspaceAsset)}`}
                  busy={isBusy(workspaceAsset.id, "history") || workspaceGenerationsQuery.isLoading}
                  onSwitchClick={() => setFinalSelectMode((current) => !current)}
                  onSelect={(record) => {
                    setSelectedId(workspaceAsset.id);
                    selectGeneration(record);
                  }}
                  onPreview={(record) => setPreview({
                    src: mediaUrl(record.url || record.storageKey),
                    title: `${baseNameOf(workspaceAsset.name)} · ${record.label}`,
                    time: formatDateTime(record.createdAt),
                    detail: historyPreviewDetail(record),
                  })}
                  onDelete={requestDeleteGeneration}
                  onImport={importGeneration}
                />
              </aside>
            </div>
          </section>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={Boolean(deleteGenerationTarget)}
        eyebrow="生成记录"
        title="删除生成记录？"
        message={deleteGenerationTarget
          ? `确定删除「${deleteGenerationTarget.label}」？此操作不可撤销。若这张图片已在我的创作中，会一并删除。`
          : ""}
        confirmLabel="删除"
        busy={isBusy(selected?.id, "history")}
        busyLabel="删除中…"
        onClose={() => setDeleteGenerationTarget(null)}
        onConfirm={confirmDeleteGeneration}
      />

      {voiceLibraryOpen && (
        <VoiceLibraryDialog
          assets={Array.isArray(voiceLibraryQuery.data) ? voiceLibraryQuery.data : []}
          loading={voiceLibraryQuery.isLoading}
          busy={isBusy(detailId || selected?.id, "voice-file")}
          error={voiceLibraryError}
          onUpload={() => voiceFileRef.current?.click()}
          onClose={() => {
            if (!isBusy(detailId || selected?.id, "voice-file")) {
              setVoiceLibraryOpen(false);
              setVoiceLibraryError("");
            }
          }}
          onConfirm={(item) => onBindVoiceFromLibrary(item)}
        />
      )}

      <input
        ref={voiceFileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onUploadVoice(file);
        }}
      />

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
