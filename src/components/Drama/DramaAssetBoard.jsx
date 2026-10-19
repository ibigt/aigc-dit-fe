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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "../../api/drama.js";
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
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchAssetIds, setBatchAssetIds] = useState(() => new Set());
  const [deleteAssetTarget, setDeleteAssetTarget] = useState(null);
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

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const imageModelsQuery = useQuery({
    queryKey: ["drama-image-models"],
    queryFn: fetchDramaImageModels,
  });
  const assetsQuery = useQuery({
    queryKey: ["drama-assets", episodeId],
    queryFn: () => fetchDramaAssets(episodeId),
    enabled: Boolean(episodeId),
    // 仅分析进行中才轮询；分析已结束后骨架空话不等于“还在补全”。
    refetchInterval: episode?.analyzing ? 2500 : false,
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

  const historyAssetId = detailId || selected?.id;
  const generationsQuery = useQuery({
    queryKey: ["drama-asset-generations", historyAssetId],
    queryFn: () => fetchDramaAssetGenerations(historyAssetId),
    enabled: Boolean(historyAssetId),
  });
  const generations = generationsQuery.data || [];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    if (!filtered.length && selectedId != null) setSelectedId(null);
  }, [filtered, selected, selectedId]);

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
      setPromptDrafts({});
      invalidate();
    },
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
    const payload = {};
    if (extra.name != null) payload.name = extra.name.trim();
    if (extra.identityInvariants != null) payload.identityInvariants = extra.identityInvariants.trim();
    if (!Object.keys(payload).length) return;
    await updateDramaAsset(asset.id, payload);
    if (extra.identityInvariants != null) {
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
      await saveFields(asset, { identityInvariants: draftOf(asset) });
      await invalidate();
    } finally {
      markBusy(asset.id, "summary", false);
    }
  }

  async function saveVoice(asset) {
    if (!asset || !voiceDirtyOf(asset)) return;
    markBusy(asset.id, "voice", true);
    try {
      const updated = await updateDramaAsset(asset.id, { voiceLock: voiceDraftOf(asset).trim() });
      rememberAsset(updated);
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
    const checkedAssets = filtered.filter((item) => batchAssetIds.has(String(item.id)));
    if (!checkedAssets.length) {
      showToast("请先勾选要生成的资产");
      return;
    }
    const skipped = checkedAssets.filter((item) => dirtyOf(item) || !identityOf(item)).length;
    const queue = checkedAssets.filter((item) => identityOf(item) && !dirtyOf(item) && !item.generating && !isBusy(item.id, "generate"));
    const queuedCount = queue.length;
    if (!queue.length) {
      showToast(skipped ? "所选资产暂无可用提示词，请先填写并保存" : "勾选的资产正在生成中，请稍后再试");
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
      setBatchAssetIds(new Set());
      if (failures.length) {
        showToast(`批量生图完成，${failures.length} 个失败：${failures.join("；")}`);
      } else if (skipped) {
        showToast(`批量生图完成：成功 ${queuedCount} 项，跳过 ${skipped} 项`);
      }
    } finally {
      setBatchRunning(false);
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
      queryClient.invalidateQueries({ queryKey: ["creations"] });
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
      {actionError && (
        <div className="drama-toast drama-toast--error" role="status">
          <CircleAlert size={16} />{actionError}
        </div>
      )}
      <section className="asset-workbench">
        <header className="asset-category-row">
          <div className="asset-category-tabs" role="tablist" aria-label="资产分类">
            {TYPES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={type === item.id}
                className={`asset-category-tab${type === item.id ? " is-active" : ""}`}
                disabled={batchRunning}
                onClick={() => {
                  setType(item.id);
                  setBatchSelectMode(false);
                  setBatchAssetIds(new Set());
                  setDetailId(null);
                  const first = assets.find((asset) => asset.type === item.id);
                  setSelectedId(first?.id || null);
                }}
              >
                <item.Icon size={18} />
                <span>{item.label}</span>
                <strong>{counts[item.id] || 0}</strong>
              </button>
            ))}
          </div>
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
                <label className="asset-select-all">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    disabled={!filtered.length || batchRunning}
                    aria-label={`全选当前${type}`}
                    ref={(node) => {
                      if (node) node.indeterminate = checkedCount > 0 && !allChecked;
                    }}
                    onChange={toggleAllBatchAssets}
                  />
                  <span className="asset-checkbox" aria-hidden="true"><Check size={12} /></span>
                  <span>一键全选</span>
                </label>
                <span className="asset-selected-count">已选 <strong>{checkedCount}</strong> 项</span>
              </>
            )}
            <button
              className={`asset-secondary-button${batchRunning ? " is-loading" : ""}`}
              type="button"
              disabled={batchRunning || (!batchSelectMode && (extractMutation.isPending || !filtered.length)) || (batchSelectMode && checkedCount > 0 && (!modelBound || extractMutation.isPending))}
              title={batchSelectMode && !checkedCount ? "退出批量生图" : !modelBound && batchSelectMode ? "先选择图像模型" : "先进入勾选，再生成已选项"}
              onClick={() => {
                if (!batchSelectMode) {
                  setBatchSelectMode(true);
                  setBatchAssetIds(new Set());
                  return;
                }
                if (!checkedCount) {
                  setBatchSelectMode(false);
                  setBatchAssetIds(new Set());
                  return;
                }
                generateBatch().catch((err) => showToast(err.message));
              }}
            >
              {batchRunning ? <span className="asset-spinner" /> : batchSelectMode && !checkedCount ? <X size={17} /> : <Sparkles size={17} />}
              <span>{batchRunning ? `正在生成 ${checkedCount} 项…` : !batchSelectMode ? "批量生图" : checkedCount ? `批量生图（${checkedCount}）` : "取消"}</span>
            </button>
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
              {filtered.map((item) => {
                const src = mediaUrl(item.imageStorageKey || item.imageUrl, { w: MEDIA_THUMB_WIDTH });
                const generating = Boolean(item.generating) || isBusy(item.id, "generate");
                const uploading = isBusy(item.id, "upload");
                const busyCard = generating || uploading || batchRunning;
                const selectedCard = batchAssetIds.has(String(item.id));
                const promptDirty = dirtyOf(item);
                const promptSaving = isBusy(item.id, "summary");
                return (
                  <article className={`asset-card${selectedCard ? " is-selected" : ""}`} key={item.id} data-asset-card={item.id}>
                    <header className="asset-card-header">
                      {editingNameId === item.id ? (
                        <input
                          className="asset-name-input"
                          autoFocus
                          maxLength={128}
                          aria-label="修改资产名称"
                          value={nameDraft}
                          onChange={(event) => setNameDraft(event.target.value)}
                          onBlur={() => commitName(item)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitName(item);
                            } else if (event.key === "Escape") {
                              setNameDraft(item.name);
                              setEditingNameId(null);
                            }
                          }}
                        />
                      ) : (
                        <div className="asset-title-group">
                          {batchSelectMode && (
                            <label className="asset-card-select" title={`${selectedCard ? "取消选择" : "选择"} ${item.name}`}>
                              <input
                                type="checkbox"
                                checked={selectedCard}
                                disabled={batchRunning}
                                aria-label={`选择 ${item.name}`}
                                onChange={() => toggleBatchAsset(item.id)}
                              />
                              <span className="asset-checkbox" aria-hidden="true"><Check size={12} /></span>
                            </label>
                          )}
                          <h3 title={item.name}>{item.name}</h3>
                          <button
                            className="asset-edit-name"
                            type="button"
                            aria-label={`修改 ${item.name} 的名称`}
                            disabled={busyCard}
                            onClick={() => {
                              setSelectedId(item.id);
                              setNameDraft(item.name);
                              setEditingNameId(item.id);
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                        </div>
                      )}
                      <div className="asset-card-actions">
                        <button className="danger" type="button" aria-label={`删除 ${item.name}`} title="删除" disabled={batchRunning || isBusy(item.id, "delete")} onClick={() => setDeleteAssetTarget(item)}>
                          <Trash2 size={17} />
                        </button>
                        <button type="button" aria-label={`上传 ${item.name} 的图片`} title="上传图片" disabled={busyCard} onClick={() => pickUpload(item)}>
                          <Upload size={17} />
                        </button>
                      </div>
                    </header>
                    <div className="asset-image-wrap">
                      {src ? (
                        <button className="asset-card-image-button" type="button" aria-label={`打开 ${item.name} 的图片生成弹窗`} disabled={busyCard} onClick={() => openDetail(item)}>
                          <img key={src} src={src} alt={item.name} onError={retryMediaOnce} />
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
                    </div>
                    <div className="asset-prompt-field">
                      <label htmlFor={`prompt-${item.id}`}>图片提示词</label>
                      <textarea
                        id={`prompt-${item.id}`}
                        rows={4}
                        maxLength={512}
                        disabled={batchRunning}
                        value={draftOf(item)}
                        placeholder="输入图片提示词…"
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
                            setSelectedId(item.id);
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
                      </div>
                      <button className="asset-expand-button" type="button" aria-label={`查看 ${item.name} 详情`} title="查看详情" disabled={batchRunning} onClick={() => openDetail(item)}>
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
          <section className={`asset-image-modal has-history${detailAsset.type === "角色" ? "" : " is-compact"}`} role="dialog" aria-modal="true" aria-labelledby="asset-image-modal-title">
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
                    <label htmlFor="asset-modal-prompt">图片提示词</label>
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
                    className="asset-modal-prompt"
                    maxLength={512}
                    value={draftOf(detailAsset)}
                    placeholder="输入图片提示词…"
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
                  <div className="asset-modal-section-head">
                    <div>
                      <h3>参考图片</h3>
                      <p>可上传本地图片，或从当前项目的素材库中选择。选中后会替换当前资产图，并写入生成历史。</p>
                    </div>
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
                  hint="“当前选中”即页面资产卡片正在使用的图片。"
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
        title="删除此资产？"
        message={deleteAssetTarget ? `将删除「${deleteAssetTarget.name}」。此操作不可撤销。已生成并出现在我的创作中的图片也会一并删除。` : ""}
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
            })
            .catch((err) => showToast(err.message));
        }}
      />

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
