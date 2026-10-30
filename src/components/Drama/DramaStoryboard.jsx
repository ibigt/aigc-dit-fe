import { Check, ChevronDown, CircleCheck, Film, Lock, Maximize2, Pencil, Plus, RefreshCw, Sparkles, Trash2, Video, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bindDramaVideoModel,
  clearDramaShotEndFrame,
  clearDramaShotFirstFrame,
  compileDramaShot,
  compileDramaStoryboard,
  convertDramaAssetToSeedream,
  copyDramaShotPrevEndFrame,
  createDramaShot,
  deleteDramaShot,
  deleteDramaShotGeneration,
  draftDramaStoryboard,
  fetchDramaAssetGenerateTask,
  fetchDramaShotCaptions,
  fetchDramaShotGenerations,
  fetchDramaStoryboard,
  fetchDramaVideoModels,
  fetchActiveDramaShotBatchGenerate,
  generateDramaShot,
  pollDramaShotBatchGenerate,
  pollDramaShotGenerate,
  retryDramaShotCaptions,
  saveDramaShotCaptions,
  selectDramaShotGeneration,
  startDramaShotBatchGenerate,
  updateDramaSeries,
  updateDramaShot,
  uploadDramaShotEndFrame,
  uploadDramaShotFirstFrame,
  useDramaShotAssetEndFrame,
  useDramaShotAssetFirstFrame,
} from "../../api/drama.js";
import { fetchAssets } from "../../api/assets.js";
import { MEDIA_THUMB_WIDTH, authenticatedApiUrl, mediaUrl } from "../../lib/media.js";
import { ImageLightbox } from "../../lib/ImageLightbox.jsx";
import { isRetryableRequestError } from "../../api/client.js";
import { ConfirmDialog } from "../ConfirmDialog.jsx";
import { BatchGenerateModal } from "./BatchGenerateModal.jsx";
import { PromptChipEditor } from "./PromptChipEditor.jsx";
import {
  narrativeMentionCount,
  parsePromptToTokens,
  referenceIdsOf,
  serializeTokensToPrompt,
} from "../../lib/promptChips.js";
import { modelLogoSrc } from "../../lib/modelLogos.js";
import { GenerationHistoryPanel, SwitchFinalModal } from "./GenerationHistoryPanel.jsx";
import { VideoLightbox } from "./VideoLightbox.jsx";
import { DRAMA_ASPECT_RATIOS, preferredResolution, resolutionOptionsFor } from "./dramaSpecs.js";

const DURATIONS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const DIALOGUE_EMOTIONS = new Set(["高兴", "愤怒", "悲伤", "恐惧", "惊讶", "厌恶", "紧张"]);

/** 镜头序列编辑器暂不展示，shot_beats 仍随草稿落库并参与编译。 */
const SHOW_SHOT_BEAT_EDITOR = false;

function hasShotBeats(shot) {
  return (shot?.shotBeats?.beats || []).some((beat) => (
    beat && (String(beat.camera || "").trim() || String(beat.action || "").trim() || String(beat.dialogue || "").trim())
  ));
}

function joinedBeatDialogue(shotBeats) {
  return (shotBeats?.beats || [])
    .map((beat) => String(beat?.dialogue || "").trim())
    .filter(Boolean)
    .join("\n");
}

function ShotBeatsEditor({ shotBeats, frozen, onSave }) {
  const [blocking, setBlocking] = useState(shotBeats?.blocking || "");
  const [beats, setBeats] = useState(() => (shotBeats?.beats || []).map((beat) => ({
    camera: beat?.camera || "",
    action: beat?.action || "",
    continuity: beat?.continuity || "",
    dialogue: beat?.dialogue || "",
  })));

  function commit(nextBlocking, nextBeats) {
    onSave({
      blocking: nextBlocking,
      beats: nextBeats.map((beat) => ({
        camera: beat.camera,
        action: beat.action,
        continuity: beat.continuity,
        dialogue: beat.dialogue,
      })),
    });
  }

  return (
    <div className="youxi-beat-editor">
      <label>
        <span>起始站位</span>
        <textarea
          rows={2}
          disabled={frozen}
          value={blocking}
          onChange={(event) => setBlocking(event.target.value)}
          onBlur={(event) => {
            const value = event.target.value;
            if (value === (shotBeats?.blocking || "")) return;
            setBlocking(value);
            commit(value, beats);
          }}
          placeholder="谁在画面左/右，门和关键道具在哪"
        />
      </label>
      {beats.map((beat, index) => (
        <section key={`beat-${index}`} className="youxi-beat-card">
          <h3>镜头{index + 1}</h3>
          <label>
            <span>景别</span>
            <input
              disabled={frozen}
              value={beat.camera}
              onChange={(event) => {
                const value = event.target.value;
                setBeats((current) => current.map((item, i) => (i === index ? { ...item, camera: value } : item)));
              }}
              onBlur={(event) => {
                const value = event.target.value;
                if (value === (shotBeats?.beats?.[index]?.camera || "")) return;
                const next = beats.map((item, i) => (i === index ? { ...item, camera: value } : item));
                setBeats(next);
                commit(blocking, next);
              }}
            />
          </label>
          <label>
            <span>动作</span>
            <textarea
              rows={2}
              disabled={frozen}
              value={beat.action}
              onChange={(event) => {
                const value = event.target.value;
                setBeats((current) => current.map((item, i) => (i === index ? { ...item, action: value } : item)));
              }}
              onBlur={(event) => {
                const value = event.target.value;
                if (value === (shotBeats?.beats?.[index]?.action || "")) return;
                const next = beats.map((item, i) => (i === index ? { ...item, action: value } : item));
                setBeats(next);
                commit(blocking, next);
              }}
            />
          </label>
          <label>
            <span>连续性</span>
            <input
              disabled={frozen}
              value={beat.continuity}
              onChange={(event) => {
                const value = event.target.value;
                setBeats((current) => current.map((item, i) => (i === index ? { ...item, continuity: value } : item)));
              }}
              onBlur={(event) => {
                const value = event.target.value;
                if (value === (shotBeats?.beats?.[index]?.continuity || "")) return;
                const next = beats.map((item, i) => (i === index ? { ...item, continuity: value } : item));
                setBeats(next);
                commit(blocking, next);
              }}
              placeholder="接上一镜头的哪一个动作"
            />
          </label>
          <label>
            <span>本镜头台词</span>
            <textarea
              rows={2}
              disabled={frozen}
              value={beat.dialogue}
              onChange={(event) => {
                const value = event.target.value;
                setBeats((current) => current.map((item, i) => (i === index ? { ...item, dialogue: value } : item)));
              }}
              onBlur={(event) => {
                const value = event.target.value;
                if (value === (shotBeats?.beats?.[index]?.dialogue || "")) return;
                const next = beats.map((item, i) => (i === index ? { ...item, dialogue: value } : item));
                setBeats(next);
                commit(blocking, next);
              }}
              placeholder="可空。角色（情绪）：这一句"
            />
          </label>
        </section>
      ))}
    </div>
  );
}

/** 只读解析「角色（情绪）：台词」行，供 badge 展示；非法情绪忽略。 */
function parseDialogueEmotionBadges(dialogue) {
  if (!dialogue || !String(dialogue).trim()) return [];
  const badges = [];
  for (const raw of String(dialogue).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(.{1,32}?)(?:[（(]([^）)]+)[）)])?\s*[：:]\s*(.+)$/);
    if (!match) continue;
    const speaker = match[1].trim();
    const emotion = (match[2] || "").trim();
    if (!DIALOGUE_EMOTIONS.has(emotion) || speaker === "旁白") continue;
    badges.push({ speaker, emotion });
  }
  return badges;
}

const CAST_TYPES = [
  { type: "角色", key: "characterNames" },
  { type: "场景", key: "locationName" },
  { type: "道具", key: "propNames" },
];

function castOf(shot) {
  return {
    characterNames: (shot?.characterNames || []).filter(Boolean),
    locationName: shot?.locationName || "",
    propNames: (shot?.propNames || []).filter(Boolean),
  };
}

function durationOptionsFor(model) {
  const listed = Array.isArray(model?.durations)
    ? model.durations.map(Number).filter((item) => DURATIONS.includes(item))
    : [];
  return listed.length ? listed : DURATIONS;
}

function clampDuration(options, value) {
  const list = options?.length ? options : DURATIONS;
  if (list.includes(value)) return value;
  return [...list].reverse().find((item) => item <= value) || list[list.length - 1] || 15;
}

function statusLabel(status) {
  if (status === "已锁定") return "已确认";
  return status || "未开始";
}

function isOfficialSeedance(model) {
  const adapter = String(model?.adapterKey || "").toLowerCase();
  const key = String(model?.modelKey || "").toLowerCase();
  return adapter === "seedance-2.0" || adapter === "seedance-2.5"
    || key.includes("doubao-seedance-2.0") || key.includes("doubao-seedance-2-0")
    || key.includes("doubao-seedance-2.5") || key.includes("doubao-seedance-2-5");
}

function modelSupportsR2v(model) {
  if (!model) return true;
  return model.supportsR2v !== false;
}

/** 没单独保存过的镜头按参考图；模型只有首尾帧时默认首尾帧。 */
function shotGenerateMode(shot, model) {
  const supportsI2v = modelSupportsI2v(model);
  if (!modelSupportsR2v(model) && supportsI2v) return "i2v";
  if (shot?.videoGenerateMode === "i2v" && supportsI2v) return "i2v";
  return "r2v";
}

function previousEpisodeShot(shot, shots) {
  if (!shot) return null;
  return (shots || [])
    .filter((item) => item.id !== shot.id && Number(item.shotIndex) < Number(shot.shotIndex))
    .sort((a, b) => Number(b.shotIndex) - Number(a.shotIndex))[0] || null;
}

function previousFrameReady(shot) {
  return Boolean(shot && (shot.endFrameKey || shot.endFrameUrl || shot.videoTailKey || shot.videoTailUrl || shot.videoKey || shot.videoUrl));
}

/** 接口未返回 supportsI2v 时，按适配协议判断；RunningHub 的 seedance-2 没有首尾帧。 */
function modelSupportsI2v(model) {
  if (!model) return false;
  if (model.supportsI2v === true) return true;
  if (model.supportsI2v === false) return false;
  const adapter = String(model.adapterKey || "").toLowerCase();
  if (adapter === "seedance-2") return false;
  return isOfficialSeedance(model)
    || adapter === "minimax-h3"
    || adapter === "agnes-video-2.5";
}

function isRealPersonReject(message) {
  const text = message || "";
  return /real person/i.test(text) || text.includes("真人");
}

function friendlyShotError(message, model) {
  const text = message || "出片失败";
  if (isRealPersonReject(text)) {
    return "官方 Seedance 把本镜参考图判成了真人脸，已停止出片。可对相关角色资产使用「转资产图」后再出片，或换用其他视频模型。";
  }
  if (isOfficialSeedance(model) && /agnes/i.test(text)) {
    return "官方 Seedance 仍在生成中，请稍后刷新。若确认失败，请换参考图后再点「生成当前镜头」";
  }
  return text;
}

function pictureRefs(shot) {
  return (shot?.references || []).filter((item) => item?.assetId);
}

function characterPictureRefs(shot) {
  return pictureRefs(shot).filter((item) => item.type === "角色");
}

function convertProgressText(index, total, name, phase) {
  const who = name ? `「${name}」` : "";
  const step = `${index}/${total}`;
  if (phase === "describe") {
    return `正在转资产图 ${step}：${who}图生文中…`;
  }
  if (phase === "t2i") {
    return `正在转资产图 ${step}：${who}文生图中…`;
  }
  return `正在转资产图 ${step}${who ? `：${who}` : ""}…`;
}

function isInFlightStatus(status) {
  return status === "PENDING" || status === "RUNNING";
}

function isShotGenerating(shot, busy, batchLocked = false) {
  const status = shot?.genTaskStatus;
  return Boolean(
    batchLocked
    || shot?.generating
    || shot?.generatingStill
    || isInFlightStatus(status)
    || (shot?.id && (busy?.[shot.id] === "generate" || busy?.[shot.id] === "still"))
  );
}

function inFlightShots(shots) {
  return (shots || []).filter((shot) => (
    shot?.genTaskId
    && (shot.generating || shot.generatingStill || isInFlightStatus(shot.genTaskStatus))
    && shot.genTaskStatus !== "FAILED"
    && shot.genTaskStatus !== "CANCELLED"
    && shot.genTaskStatus !== "SUCCEEDED"
  ));
}

function shotPoster(shot) {
  return mediaUrl(shot?.videoPosterUrl || shot?.videoPosterKey);
}

function ShotThumbPreview({ shot, busy, batchLocked = false }) {
  const generating = isShotGenerating(shot, busy, batchLocked);
  const ready = Boolean(shot?.videoKey) && !generating;
  if (generating) {
    return (
      <span className="youxi-shot-thumb__mark is-generating">
        <span className="youxi-shot-thumb__spinner" aria-hidden="true" />
        <b>生成中</b>
      </span>
    );
  }
  if (ready) {
    return (
      <span className="youxi-shot-thumb__mark is-ready">
        <span className="youxi-shot-thumb__play" aria-hidden="true"><Video size={16} /></span>
      </span>
    );
  }
  return (
    <span className="youxi-shot-thumb__mark">
      <Video size={18} />
      <b>未生成</b>
    </span>
  );
}

export function dramaStoryboardStatus(board) {
  return board?.status || "未开始";
}

function isFirstInChapter(shot, shots) {
  if (!shot) return true;
  const peers = (shots || []).filter((item) => item.chapterId === shot.chapterId);
  if (!peers.length) return true;
  const min = Math.min(...peers.map((item) => item.shotIndex ?? Number.POSITIVE_INFINITY));
  return shot.shotIndex === min;
}

function imageCap(model) {
  const cap = Number(model?.maxImageReferences);
  if (!Number.isFinite(cap) || cap <= 0 || cap >= 100000) return null;
  return cap;
}

function FrameLibraryDialog({ label, assets, loading, error, busy, onClose, onConfirm }) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = assets.find((item) => String(item.id) === String(selectedId)) || null;
  const body = (
    <div
      className="drama-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="creation-asset-dialog" role="dialog" aria-modal="true" aria-labelledby="frame-library-title">
        <header>
          <div>
            <small>素材库</small>
            <h2 id="frame-library-title">选择{label}</h2>
          </div>
          <button type="button" aria-label="关闭素材选择" disabled={busy} onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="creation-asset-grid">
          {loading && <p className="creation-asset-empty">正在加载图片素材…</p>}
          {!loading && error && <p className="creation-asset-empty">{error}</p>}
          {!loading && !error && !assets.length && <p className="creation-asset-empty">素材库还没有图片</p>}
          {!loading && !error && assets.map((asset) => {
            const name = asset.title || asset.name || "未命名";
            const preview = mediaUrl(asset.poster || asset.posterUrl || asset.src || asset.url || asset.storageKey, { w: MEDIA_THUMB_WIDTH });
            const picked = String(asset.id) === String(selectedId);
            return (
              <button
                type="button"
                className={picked ? "selected" : ""}
                key={asset.id || preview}
                aria-pressed={picked}
                disabled={busy}
                onClick={() => setSelectedId(asset.id)}
              >
                <img src={preview} alt={name} />
                <span>
                  <strong>{name}</strong>
                  <small>图片素材</small>
                </span>
                {picked && (
                  <span className="creation-asset-check" aria-hidden="true">
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <footer>
          <span>{selected ? `已选择 ${selected.title || selected.name || "未命名"}` : "请选择一张图片"}</span>
          <div>
            <button type="button" disabled={busy} onClick={onClose}>取消</button>
            <button
              type="button"
              className="primary"
              disabled={busy || !selected}
              onClick={() => onConfirm(selected.id)}
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

function ShotPromptPane({
  selected,
  frozen,
  lockedAssets,
  durationOptions,
  ratio,
  resolution,
  resolutionOptions,
  videoModels,
  videoModelId,
  selectedVideoModel,
  onVideoModel,
  onRatio,
  onResolution,
  onSave,
  onGenerate,
  generateDisabled,
  generateTitle,
  generating,
  onCompileShot,
  compilingShot,
  onZoom,
  onUploadFrame,
  onUseAssetFrame,
  onClearFrame,
  onCopyPrevEnd,
  canCopyPrevEnd,
  frameBusy,
}) {
  const serverPrompt = selected?.visiblePrompt || "";
  const [draft, setDraft] = useState(serverPrompt);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [menu, setMenu] = useState(null);
  const [librarySlot, setLibrarySlot] = useState(null);
  const [titleRenameOpen, setTitleRenameOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const expandedEditorRef = useRef(null);
  const commitPromptRef = useRef(async () => {});
  const draftRef = useRef(draft);
  const promptCtxRef = useRef({ selected, lockedAssets, serverPrompt, onSave });
  const barRef = useRef(null);
  const firstInputRef = useRef(null);
  const endInputRef = useRef(null);
  const titleInputRef = useRef(null);
  draftRef.current = draft;
  promptCtxRef.current = { selected, lockedAssets, serverPrompt, onSave };
  const supportsI2v = modelSupportsI2v(selectedVideoModel);
  const supportsR2v = modelSupportsR2v(selectedVideoModel);
  const framesMode = shotGenerateMode(selected, selectedVideoModel) === "i2v";
  const modeValue = framesMode ? "i2v" : "r2v";
  const libraryQuery = useQuery({
    queryKey: ["account-image-assets"],
    queryFn: () => fetchAssets({ kind: "image" }),
    enabled: Boolean(librarySlot),
    staleTime: 30_000,
  });
  const libraryImages = libraryQuery.data || [];
  const videoModelName = selectedVideoModel?.name
    || videoModels.find((item) => String(item.id) === String(videoModelId))?.name
    || "请选择视频模型";
  const resolutionLabel = resolutionOptions?.includes(resolution) ? resolution : (resolutionOptions?.[resolutionOptions.length - 1] || "720P");
  const cap = imageCap(selectedVideoModel);
  const mentionCount = narrativeMentionCount(draft, lockedAssets);
  const overLimit = cap != null && mentionCount > cap;
  const missing = (() => {
    const tokens = parsePromptToTokens(draft, {
      lockedAssets,
      referenceAssetIds: selected?.referenceAssetIds,
    });
    const names = [];
    const seen = new Set();
    for (const token of tokens) {
      if (token.kind !== "chip") continue;
      const key = token.assetId != null ? `id:${token.assetId}` : `name:${token.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (token.asset?.imageUrl || token.asset?.imageStorageKey) continue;
      names.push(token.name);
    }
    return names;
  })();

  useEffect(() => {
    setDraft(serverPrompt);
    setPromptExpanded(false);
    setMenu(null);
    setLibrarySlot(null);
    setTitleRenameOpen(false);
    setTitleDraft(selected?.title?.trim() || "");
  }, [selected?.id, serverPrompt, selected?.title]);

  useEffect(() => {
    if (!titleRenameOpen) return;
    const input = titleInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, [titleRenameOpen]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (barRef.current && !barRef.current.contains(event.target)) setMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  useEffect(() => {
    if (!promptExpanded) return undefined;
    const timer = window.setTimeout(() => expandedEditorRef.current?.focus(), 30);
    function onKey(event) {
      if (event.key !== "Escape") return;
      if (document.querySelector(".drama-mention-dropdown")) return;
      setPromptExpanded(false);
      commitPromptRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [promptExpanded]);

  function refsEqual(left, right) {
    const a = left || [];
    const b = right || [];
    if (a.length !== b.length) return false;
    return a.every((id, index) => String(id) === String(b[index]));
  }

  async function commitPromptText(text, shot, assets, serverText, save) {
    const persist = save || onSave;
    if (!shot?.id || !persist) return;
    const tokens = parsePromptToTokens(text, {
      lockedAssets: assets || [],
      referenceAssetIds: shot.referenceAssetIds || [],
    });
    const visiblePrompt = serializeTokensToPrompt(tokens);
    const nextRefs = referenceIdsOf(tokens);
    if (visiblePrompt === (serverText || "") && refsEqual(nextRefs, shot.referenceAssetIds)) {
      return;
    }
    try {
      await persist(shot, {
        visiblePrompt,
        referenceAssetIds: nextRefs,
      });
    } catch {
      // 父组件已写入错误横幅
    }
  }

  async function commitPrompt() {
    const ctx = promptCtxRef.current;
    await commitPromptText(
      draftRef.current,
      ctx.selected,
      ctx.lockedAssets,
      ctx.serverPrompt,
      ctx.onSave,
    );
  }
  commitPromptRef.current = commitPrompt;

  // 改 @ 角色版本后若不失焦就切页/刷新，原先不会落库。draft 与服务端不一致时短防抖自动保存。
  useEffect(() => {
    if (!selected?.id) return undefined;
    const tokens = parsePromptToTokens(draft, {
      lockedAssets,
      referenceAssetIds: selected.referenceAssetIds || [],
    });
    const nextRefs = referenceIdsOf(tokens);
    if (draft === serverPrompt && refsEqual(nextRefs, selected.referenceAssetIds)) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      commitPromptRef.current();
    }, 320);
    return () => window.clearTimeout(timer);
  }, [draft, serverPrompt, lockedAssets, selected?.id, selected?.referenceAssetIds]);

  // 切镜或离开分镜页时立刻刷盘；shot 用创建时快照，资产列表取最新以免解析不到版本 id。
  useEffect(() => {
    const shot = selected;
    const serverText = serverPrompt;
    return () => {
      const ctx = promptCtxRef.current;
      void commitPromptText(
        draftRef.current,
        shot,
        ctx.lockedAssets,
        serverText,
        ctx.onSave,
      );
    };
  }, [selected?.id]);

  // 刷新 / 切标签页前再刷一次，兜住防抖窗口内的未提交改动。
  useEffect(() => {
    const flush = () => {
      void commitPromptRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function closeExpandedPrompt() {
    setPromptExpanded(false);
    commitPrompt();
  }

  function pickFile(slot, file) {
    if (!file || frozen) return;
    setMenu(null);
    onUploadFrame?.(slot, file);
  }

  function pickAsset(slot, assetId) {
    setMenu(null);
    setLibrarySlot(null);
    onUseAssetFrame?.(slot, assetId);
  }

  function commitTitleRename() {
    const name = titleDraft.trim();
    const current = selected?.title?.trim() || "";
    if (!name) {
      setTitleDraft(current);
      setTitleRenameOpen(false);
      return;
    }
    if (name === current) {
      setTitleRenameOpen(false);
      return;
    }
    setTitleRenameOpen(false);
    onSave?.(selected, { title: name }).catch(() => {
      setTitleDraft(current);
    });
  }

  if (!selected) return null;
  const durationValue = clampDuration(durationOptions, selected.durationSec);
  return (
    <div className="youxi-shot-editor" ref={barRef}>
      <div className="youxi-shot-editor__controls">
        <div className="youxi-shot-editor__title">
          <span className="youxi-shot-editor__mark" aria-hidden="true">
            <Video size={19} />
          </span>
          <span>
            <small>镜头 {String(selected.shotIndex).padStart(2, "0")}</small>
            {titleRenameOpen ? (
              <input
                ref={titleInputRef}
                type="text"
                name="drama-shot-title"
                autoComplete="off"
                spellCheck={false}
                className={`youxi-shot-title-input${titleDraft.trim() ? "" : " is-invalid"}`}
                aria-invalid={!titleDraft.trim()}
                aria-label="修改镜头名称"
                maxLength={128}
                value={titleDraft}
                disabled={frozen}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitleRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitTitleRename();
                  } else if (event.key === "Escape") {
                    setTitleDraft(selected.title?.trim() || "");
                    setTitleRenameOpen(false);
                  }
                }}
              />
            ) : (
              <span className="youxi-shot-editor__name">
                <strong>{selected.title?.trim() || "未命名"}</strong>
                <button
                  className="youxi-shot-rename"
                  type="button"
                  aria-label="修改镜头名称"
                  disabled={frozen}
                  title={frozen ? "当前不可修改镜头名称" : "修改镜头名称"}
                  onClick={() => {
                    setTitleDraft(selected.title?.trim() || "");
                    setTitleRenameOpen(true);
                  }}
                >
                  <Pencil size={13} />
                </button>
              </span>
            )}
          </span>
        </div>
        <div className="youxi-shot-spec">
          <button
            type="button"
            className="youxi-shot-spec__trigger"
            aria-label="分镜视频模型"
            aria-expanded={menu === "model"}
            disabled={frozen}
            onClick={() => setMenu((current) => (current === "model" ? null : "model"))}
          >
            <img className="model-brand-logo" src={modelLogoSrc(selectedVideoModel || { name: videoModelName })} alt="" />
            <span>{videoModelName}</span>
            <ChevronDown size={14} />
          </button>
          {menu === "model" && (
            <div className="youxi-shot-spec__menu" role="listbox">
              {!videoModels.length && <p>暂无已启用视频模型</p>}
              {videoModels.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={String(item.id) === String(videoModelId)}
                  onClick={() => {
                    setMenu(null);
                    if (String(item.id) !== String(videoModelId)) onVideoModel(String(item.id));
                  }}
                >
                  <img className="model-brand-logo" src={modelLogoSrc(item)} alt="" />
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="youxi-shot-spec">
          <button
            type="button"
            className="youxi-shot-spec__trigger"
            aria-label="清晰度与比例"
            aria-expanded={menu === "spec"}
            disabled={frozen}
            onClick={() => setMenu((current) => (current === "spec" ? null : "spec"))}
          >
            <span>{resolutionLabel} · {ratio}</span>
            <ChevronDown size={14} />
          </button>
          {menu === "spec" && (
            <div className="youxi-shot-spec__panel">
              <p>比例</p>
              <div className="youxi-shot-spec__ratios" role="listbox" aria-label="视频比例">
                {DRAMA_ASPECT_RATIOS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={item.id === ratio}
                    onClick={() => {
                      setMenu(null);
                      if (item.id !== ratio) onRatio(item.id);
                    }}
                  >
                    <i data-ratio={item.id} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <p>清晰度</p>
              <div className="youxi-shot-spec__grid" role="listbox" aria-label="视频清晰度">
                {(resolutionOptions || []).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="option"
                    aria-selected={item === resolutionLabel}
                    onClick={() => {
                      setMenu(null);
                      if (item !== resolution) onResolution(item);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="youxi-shot-modebar">
        <div className="youxi-shot-gen">
          <button
            type="button"
            className="youxi-shot-mode__trigger"
            aria-label="生成方式"
            aria-expanded={menu === "mode"}
            disabled={frozen}
            onClick={() => setMenu((current) => (current === "mode" ? null : "mode"))}
          >
            <span className="youxi-shot-mode__mark" aria-hidden="true">◇</span>
            <span>{modeValue === "i2v" ? "首尾帧" : "参考图"}</span>
            <ChevronDown size={14} />
          </button>
          {menu === "mode" && (
            <div className="youxi-shot-mode__menu" role="listbox" aria-label="视频生成方式">
              {(supportsR2v || (!supportsR2v && !supportsI2v)) && (
                <button
                  type="button"
                  role="option"
                  aria-selected={modeValue === "r2v"}
                  onClick={() => {
                    setMenu(null);
                    if (modeValue !== "r2v") onSave(selected, { videoGenerateMode: "r2v" }).catch(() => {});
                  }}
                >
                  <span>
                    <strong>参考图</strong>
                    <small>使用已引用的角色、场景或道具图片作为视频参考</small>
                  </span>
                </button>
              )}
              {supportsI2v && (
                <button
                  type="button"
                  role="option"
                  aria-selected={modeValue === "i2v"}
                  onClick={() => {
                    setMenu(null);
                    if (modeValue !== "i2v") onSave(selected, { videoGenerateMode: "i2v" }).catch(() => {});
                  }}
                >
                  <span>
                    <strong>首尾帧</strong>
                    <small>控制视频的开始画面和结束画面</small>
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
        <div className="youxi-shot-duration">
          <button
            type="button"
            className="youxi-shot-mode__trigger"
            aria-label="本镜时长"
            aria-expanded={menu === "duration"}
            disabled={frozen}
            onClick={() => setMenu((current) => (current === "duration" ? null : "duration"))}
          >
            <span>{durationValue}s</span>
            <ChevronDown size={14} />
          </button>
          {menu === "duration" && (
            <div className="youxi-shot-duration__menu" role="listbox" aria-label="视频时长">
              {(durationOptions?.length ? durationOptions : DURATIONS).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="option"
                  aria-selected={Number(item) === Number(durationValue)}
                  onClick={() => {
                    setMenu(null);
                    if (Number(item) !== Number(durationValue)) onSave(selected, { durationSec: Number(item) }).catch(() => {});
                  }}
                >
                  {item}s
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="youxi-field drama-prompt-field">
        <span className="drama-prompt-field__head">
          <strong>视频提示词</strong>
          {selected.legacyOverride ? <em className="drama-engine">旧覆盖</em> : null}
        </span>
        <div
          className={`drama-prompt-field__box${framesMode ? " is-keyframes" : ""}`}
          onBlur={(event) => {
            if (promptExpanded) return;
            if (event.currentTarget.contains(event.relatedTarget)) return;
            commitPrompt();
          }}
        >
          {framesMode && (
        <div className="youxi-shot-frames">
          <input
            ref={firstInputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            aria-label="上传首帧"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              pickFile("first", file);
            }}
          />
          <input
            ref={endInputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            aria-label="上传尾帧"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              pickFile("end", file);
            }}
          />
          <div className="youxi-shot-frame-pair">
            {["first", "end"].map((slot, index) => {
              const isFirst = slot === "first";
              const url = isFirst ? selected.firstFrameUrl : selected.endFrameUrl;
              const openKey = isFirst ? "first" : "end";
              const label = isFirst ? "首帧" : "尾帧";
              return (
                <div className="youxi-shot-frame-pair__item" key={slot}>
                  {index === 1 && <span className="youxi-shot-frame-link" aria-hidden="true">⇄</span>}
                  <div className={`youxi-shot-frame${isFirst ? "" : " is-end"}`}>
                    <div className={`youxi-shot-frame__card${url ? " has-image" : ""}`}>
                      {url ? <img src={mediaUrl(url)} alt="" /> : null}
                      <button
                        type="button"
                        className="youxi-shot-frame__select"
                        disabled={frozen || frameBusy}
                        aria-label={url ? `替换${label}` : `选择${label}`}
                        aria-expanded={menu === openKey}
                        onClick={() => setMenu((current) => (current === openKey ? null : openKey))}
                      >
                        {url ? <span className="youxi-shot-frame__replace">替换</span> : <span className="youxi-shot-frame__plus">＋</span>}
                        <strong>{label}</strong>
                      </button>
                      {url && (
                        <button
                          type="button"
                          className="youxi-shot-frame__clear"
                          aria-label={`删除${label}`}
                          disabled={frozen || frameBusy}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onClearFrame?.(slot);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {menu === openKey && (
                      <div className="youxi-shot-frame__menu" role="menu">
                        <button type="button" onClick={() => (isFirst ? firstInputRef : endInputRef).current?.click()}>
                          本地上传
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMenu(null);
                            setLibrarySlot(slot);
                          }}
                        >
                          素材库
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="youxi-shot-frame__prev"
            disabled={frozen || frameBusy || !canCopyPrevEnd}
            title={canCopyPrevEnd ? "把上一镜尾帧复制到本镜首帧" : "上一镜还没有尾帧"}
            onClick={() => onCopyPrevEnd?.()}
          >
            加载上一镜尾帧
          </button>
        </div>
          )}
          {librarySlot && (
            <FrameLibraryDialog
              label={librarySlot === "end" ? "尾帧" : "首帧"}
              assets={libraryImages}
              loading={libraryQuery.isLoading}
              error={libraryQuery.isError ? (libraryQuery.error?.message || "素材加载失败") : ""}
              busy={frameBusy}
              onClose={() => {
                if (!frameBusy) setLibrarySlot(null);
              }}
              onConfirm={(id) => pickAsset(librarySlot, id)}
            />
          )}
          <PromptChipEditor
            inline
            value={draft}
            lockedAssets={lockedAssets}
            referenceAssetIds={selected.referenceAssetIds}
            disabled={frozen || promptExpanded}
            onChange={setDraft}
            onZoom={onZoom}
          />
          <button
            type="button"
            className="drama-prompt-field__expand"
            aria-label="放大编辑视频提示词"
            title="放大编辑"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPromptExpanded(true)}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      {promptExpanded && typeof document !== "undefined"
        ? createPortal(
          <div
            className="drama-dialog-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeExpandedPrompt();
            }}
          >
            <section
              className="drama-dialog drama-dialog--prompt"
              role="dialog"
              aria-modal="true"
              aria-label="视频提示词"
            >
              <header>
                <h2>视频提示词</h2>
                <button type="button" aria-label="关闭" onClick={closeExpandedPrompt}>
                  <X size={18} />
                </button>
              </header>
              <div className="drama-prompt-editor">
                <PromptChipEditor
                  ref={expandedEditorRef}
                  value={draft}
                  lockedAssets={lockedAssets}
                  referenceAssetIds={selected.referenceAssetIds}
                  disabled={frozen}
                  onChange={setDraft}
                  onZoom={onZoom}
                />
              </div>
              <footer className="drama-dialog__actions">
                <button type="button" className="button button--primary" onClick={closeExpandedPrompt}>
                  完成
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )
        : null}
      <p className={!framesMode && (overLimit || missing.length) ? "drama-form-error" : "youxi-shot-editor__hint"}>
        {framesMode
          ? (selected.firstFrameKey
            ? "首尾帧出片使用本镜首帧，尾帧可以不设。"
            : "请先设置首帧后再生成。尾帧可以不设。")
          : overLimit
            ? `当前模型最多支持 ${cap} 张`
            : `叙述里的 @ 会计入参考图，重复引用只算一张。当前 ${mentionCount} 张${cap != null ? `，当前模型最多 ${cap} 张` : ""}。`}
        {!framesMode && missing.length ? ` 还没有参考图：${missing.join("、")}。` : ""}
      </p>
      <div className="youxi-shot-editor__actions">
        <button
          className="youxi-shot-recompile"
          type="button"
          disabled={frozen || compilingShot}
          title="按这一镜的镜头结构和已绑定资产重算核心提示词，会覆盖这一镜的手改"
          onClick={onCompileShot}
        >
          <RefreshCw size={14} /> {compilingShot ? "编译中…" : "重新编译本镜"}
        </button>
        <button
          className="youxi-toolbar-primary"
          type="button"
          disabled={generateDisabled || (!framesMode && (overLimit || missing.length > 0))}
          title={framesMode && !selected.firstFrameKey
            ? "请先设置首帧"
            : !framesMode && overLimit
              ? `当前模型最多支持 ${cap} 张`
              : !framesMode && missing.length
                ? "叙述里的引用还没有参考图"
                : generateTitle}
          onClick={onGenerate}
        >
          <Video size={14} /> {generating ? "出片中…" : "生成当前镜头"}
        </button>
      </div>
    </div>
  );
}

function captionStatusLabel(status, sourceType, fallbackReason) {
  if (status === "PENDING" || status === "RUNNING") return "字幕处理中…";
  if (status === "NO_SPEECH") return "未检测到语音";
  if (status === "FAILED") return null;
  if (status === "READY") {
    const estimated = sourceType === "ESTIMATED"
      || (typeof fallbackReason === "string" && fallbackReason.includes("ESTIMATED"));
    return estimated ? "字幕已就绪（估算，可能不准）" : "字幕已就绪";
  }
  return "";
}

function msToSecInput(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "";
  return (Math.round(n / 100) / 10).toFixed(1);
}

function secInputToMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1000);
}

function CaptionCueEditor({ open, shot, busy, onClose, onSaved, onError }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cues, setCues] = useState([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!open || !shot?.id) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    fetchDramaShotCaptions(shot.id)
      .then((doc) => {
        if (cancelled) return;
        setCues((doc?.cues || []).map((cue, index) => ({
          key: `${cue.startMs}-${cue.endMs}-${index}`,
          startMs: Number(cue.startMs) || 0,
          endMs: Number(cue.endMs) || 0,
          text: cue.text || "",
        })));
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error.message || "字幕加载失败");
        setCues([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, shot?.id]);

  if (!open || typeof document === "undefined") return null;

  async function handleSave() {
    if (!shot?.id || saving || busy) return;
    setSaving(true);
    try {
      await saveDramaShotCaptions(shot.id, {
        cues: cues.map((cue) => ({
          startMs: cue.startMs,
          endMs: cue.endMs,
          text: cue.text,
        })),
      });
      onSaved?.();
    } catch (error) {
      onError?.(error.message || "字幕保存失败");
    } finally {
      setSaving(false);
    }
  }

  function updateCue(index, patch) {
    setCues((current) => current.map((cue, i) => (i === index ? { ...cue, ...patch } : cue)));
  }

  return createPortal(
    <div
      className="drama-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving && !busy) onClose?.();
      }}
    >
      <section
        className="drama-dialog drama-dialog--caption-editor"
        role="dialog"
        aria-modal="true"
        aria-label="编辑字幕"
      >
        <header>
          <div>
            <span>字幕</span>
            <h2>编辑镜 {shot?.shotIndex ?? ""} 字幕</h2>
          </div>
          <button type="button" aria-label="关闭" disabled={saving || busy} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="youxi-caption-editor">
          {loading && <p className="youxi-caption-editor__empty">正在加载字幕…</p>}
          {!loading && loadError && <p className="drama-form-error">{loadError}</p>}
          {!loading && !loadError && !cues.length && (
            <p className="youxi-caption-editor__empty">暂无字幕条目</p>
          )}
          {!loading && !loadError && cues.map((cue, index) => (
            <div className="youxi-caption-editor__row" key={cue.key}>
              <label>
                <span>开始(s)</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={msToSecInput(cue.startMs)}
                  disabled={saving}
                  onChange={(event) => updateCue(index, { startMs: secInputToMs(event.target.value) })}
                />
              </label>
              <label>
                <span>结束(s)</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={msToSecInput(cue.endMs)}
                  disabled={saving}
                  onChange={(event) => updateCue(index, { endMs: secInputToMs(event.target.value) })}
                />
              </label>
              <label className="youxi-caption-editor__text">
                <span>文案</span>
                <input
                  type="text"
                  value={cue.text}
                  disabled={saving}
                  onChange={(event) => updateCue(index, { text: event.target.value })}
                />
              </label>
            </div>
          ))}
        </div>
        <footer className="drama-dialog__actions">
          <button type="button" disabled={saving || busy} onClick={onClose}>取消</button>
          <button
            type="button"
            className="button button--primary"
            disabled={saving || busy || loading || Boolean(loadError)}
            onClick={handleSave}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ShotPreview({
  selected,
  generating,
  videoSrc,
  poster,
  ratio,
  captionSrc,
  captionStatus,
  captionSourceType,
  captionFallbackReason,
  captionErrorMessage,
  showCaptions,
  onToggleCaptions,
  onRetryCaptions,
  onEditCaptions,
  captionBusy,
  generations,
  generationsLoading,
  historyBusy,
  onSwitchFinal,
  onPreviewGeneration,
  onDeleteGeneration,
}) {
  const locked = selected?.status === "已锁定";
  const status = captionStatus || "";
  const bannerText = captionStatusLabel(status, captionSourceType, captionFallbackReason);
  const showCaptionBar = Boolean(videoSrc && !generating && status);
  const canRetry = ["FAILED", "NO_SPEECH", "READY"].includes(status);
  const canEdit = status === "READY";
  const bannerWarn = status === "FAILED"
    || status === "NO_SPEECH"
    || (status === "READY" && (
      captionSourceType === "ESTIMATED"
      || (typeof captionFallbackReason === "string" && captionFallbackReason.includes("ESTIMATED"))
    ));

  return (
    <aside className="youxi-inspector youxi-story-inspector">
      <div className="youxi-inspector-tabs">
        <button type="button" className="active">预览</button>
      </div>
      <div className="youxi-inspector-scroll">
        {!selected ? (
          <p className="youxi-story-side-empty">选中分镜后，视频预览和生成记录会显示在这里</p>
        ) : (
          <>
            <div className="youxi-story-preview youxi-story-preview--side">
              {videoSrc && !generating ? (
                <div className="youxi-story-preview__video-wrap">
                  <video
                    key={`${videoSrc}|${captionSrc || "no-cap"}`}
                    controls
                    playsInline
                    preload="metadata"
                    data-ratio={ratio}
                    src={videoSrc}
                    poster={poster || undefined}
                  >
                    {captionSrc ? (
                      <track kind="captions" src={captionSrc} srcLang="zh-CN" label="中文" default />
                    ) : null}
                  </video>
                </div>
              ) : (
                <div className="youxi-story-empty-preview" data-ratio={ratio}>
                  <div className="youxi-story-empty-state">
                    <Video size={24} />
                    <strong>{generating ? "正在生成视频" : "尚未生成视频"}</strong>
                    <span>出片使用叙述里的参考图</span>
                  </div>
                </div>
              )}
              {showCaptionBar ? (
                <div className="youxi-story-caption-bar">
                  <div className="drama-view-switch youxi-story-caption-toggle" role="group" aria-label="显示字幕">
                    <button
                      type="button"
                      className={showCaptions ? "active" : ""}
                      aria-pressed={showCaptions}
                      onClick={() => onToggleCaptions?.(true)}
                    >
                      显示字幕
                    </button>
                    <button
                      type="button"
                      className={!showCaptions ? "active" : ""}
                      aria-pressed={!showCaptions}
                      onClick={() => onToggleCaptions?.(false)}
                    >
                      隐藏
                    </button>
                  </div>
                  {status === "FAILED" ? (
                    <p className="youxi-film-banner youxi-film-banner--warn">
                      {captionErrorMessage || "字幕生成失败"}
                    </p>
                  ) : bannerText ? (
                    <p className={`youxi-film-banner${bannerWarn ? " youxi-film-banner--warn" : ""}`}>
                      {bannerText}
                    </p>
                  ) : null}
                  {(canRetry || canEdit) ? (
                    <div className="youxi-story-caption-actions">
                      {canRetry ? (
                        <button
                          type="button"
                          disabled={captionBusy}
                          onClick={() => onRetryCaptions?.()}
                        >
                          <RefreshCw size={12} />
                          {captionBusy ? "处理中…" : "重新生成字幕"}
                        </button>
                      ) : null}
                      {canEdit ? (
                        <button type="button" disabled={captionBusy} onClick={() => onEditCaptions?.()}>
                          编辑字幕
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {!generationsLoading && (
              <GenerationHistoryPanel
                switchLabel="切换最终分镜"
                records={generations}
                locked={locked}
                mediaKind="video"
                busy={historyBusy}
                onSwitchClick={onSwitchFinal}
                onPreview={onPreviewGeneration}
                onDelete={onDeleteGeneration}
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}


export function DramaStoryboard({ series, episode }) {
  const queryClient = useQueryClient();
  const seriesId = series?.id;
  const episodes = series?.episodes?.length ? series.episodes : (episode ? [episode] : []);
  const [episodeId, setEpisodeId] = useState(episode?.id || episodes[0]?.id || null);
  const [shotId, setShotId] = useState(null);
  const [videoModelId, setVideoModelId] = useState(series?.videoModelId || "");
  const [draftDurationSec, setDraftDurationSec] = useState(15);
  const [busy, setBusy] = useState({});
  const [actionError, setActionError] = useState("");
  const [realPersonConvertShotId, setRealPersonConvertShotId] = useState(null);
  const [convertingAssets, setConvertingAssets] = useState(false);
  const [convertProgress, setConvertProgress] = useState("");
  const [preview, setPreview] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [switchFinalOpen, setSwitchFinalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteGenerationTarget, setDeleteGenerationTarget] = useState(null);
  const [draftConfirmOpen, setDraftConfirmOpen] = useState(false);
  const [compileConfirmOpen, setCompileConfirmOpen] = useState(false);
  const [compileShotOpen, setCompileShotOpen] = useState(false);
  const [compileNotice, setCompileNotice] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchJob, setBatchJob] = useState(null);
  const [batchToast, setBatchToast] = useState("");
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [captionEditorOpen, setCaptionEditorOpen] = useState(false);
  const [captionBusy, setCaptionBusy] = useState(false);
  const wasRecompiling = useRef(false);
  const batchPollRef = useRef(0);

  const activeEpisode = episodes.find((item) => item.id === episodeId) || episodes[0] || episode;
  const activeEpisodeId = activeEpisode?.id;

  useEffect(() => {
    if (episode?.id && !episodes.some((item) => item.id === episodeId)) {
      setEpisodeId(episode.id);
    }
  }, [episode?.id, episodeId, episodes]);

  useEffect(() => {
    setVideoModelId(series?.videoModelId || "");
  }, [series?.videoModelId]);

  useEffect(() => {
    setCompileNotice("");
    setDraftConfirmOpen(false);
    setCompileConfirmOpen(false);
    setSelectedIds(new Set());
    setBatchSelectMode(false);
    setBatchModalOpen(false);
    setBatchJob(null);
    setBatchToast("");
    setCaptionEditorOpen(false);
  }, [activeEpisodeId]);

  useEffect(() => {
    if (!compileNotice) return undefined;
    const timer = window.setTimeout(() => setCompileNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [compileNotice]);

  useEffect(() => {
    if (!batchToast) return undefined;
    const timer = window.setTimeout(() => setBatchToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [batchToast]);

  const videoModelsQuery = useQuery({
    queryKey: ["drama-video-models"],
    queryFn: fetchDramaVideoModels,
  });
  const boardQuery = useQuery({
    queryKey: ["drama-storyboard", activeEpisodeId],
    queryFn: () => fetchDramaStoryboard(activeEpisodeId),
    enabled: Boolean(activeEpisodeId),
    refetchInterval: (query) => {
      const data = query.state.data;
      const chapters = data?.chapters || [];
      const list = chapters.flatMap((item) => item.shots || []);
      if (data?.drafting || data?.promptRecompiling || data?.activeBatchJobId
        || activeEpisode?.analyzing || inFlightShots(list).length) return 1500;
      return false;
    },
  });

  const board = boardQuery.data;
  const chapters = board?.chapters || [];
  const shots = useMemo(() => chapters.flatMap((item) => item.shots || []), [chapters]);
  const lockedAssets = board?.lockedAssets || [];
  const hasReadyReference = lockedAssets.some((asset) => asset?.imageStorageKey || asset?.imageUrl);
  const selected = shots.find((item) => item.id === shotId) || shots[0];
  const generationsQuery = useQuery({
    queryKey: ["drama-shot-generations", selected?.id],
    queryFn: () => fetchDramaShotGenerations(selected.id),
    enabled: Boolean(selected?.id),
  });
  const generations = generationsQuery.data || [];
  const scriptLocked = activeEpisode?.status === "已锁定";
  const canUseTextModel = activeEpisode?.canGenerate !== false;
  const autoDrafting = Boolean(board?.drafting);
  const videoModels = videoModelsQuery.data || [];
  const selectedVideoModel = videoModels.find((item) => String(item.id) === String(videoModelId));
  const recompiling = Boolean(board?.promptRecompiling || series?.promptRecompiling);
  const supportsI2v = modelSupportsI2v(selectedVideoModel);
  const durationOptions = useMemo(
    () => durationOptionsFor(videoModels.find((item) => String(item.id) === String(videoModelId))),
    [videoModels, videoModelId]
  );
  const ratio = series?.aspectRatio || "16:9";
  const resolutionOptions = useMemo(
    () => resolutionOptionsFor(selectedVideoModel),
    [selectedVideoModel],
  );
  const resolution = resolutionOptions.includes(series?.defaultResolution)
    ? series.defaultResolution
    : preferredResolution(resolutionOptions, series?.defaultResolution);
  const batchRunning = batchJob?.status === "RUNNING" || batchJob?.status === "PENDING";
  const batchLockedIds = useMemo(() => {
    if (!batchRunning || !batchJob?.items?.length) return new Set();
    return new Set(
      batchJob.items
        .filter((item) => item.status === "PENDING" || item.status === "RUNNING")
        .map((item) => item.shotId)
    );
  }, [batchRunning, batchJob]);
  const selectionHasFirstInChapter = useMemo(() => {
    if (!selectedIds.size) return false;
    return shots.some((shot) => selectedIds.has(shot.id) && isFirstInChapter(shot, shots));
  }, [selectedIds, shots]);

  useEffect(() => {
    setDraftDurationSec((current) => clampDuration(durationOptions, current));
  }, [durationOptions]);

  useEffect(() => {
    if (!selected?.id) return;
    if (shotId !== selected.id) setShotId(selected.id);
  }, [selected?.id, shotId]);

  useEffect(() => {
    if (wasRecompiling.current && !recompiling) {
      setCompileNotice("已重新编译分镜提示词");
    }
    wasRecompiling.current = recompiling;
  }, [recompiling]);

  useEffect(() => {
    if (!activeEpisodeId) return undefined;
    let cancelled = false;
    const jobId = board?.activeBatchJobId;
    if (!jobId) {
      if (!batchPollRef.current) setBatchJob(null);
      return undefined;
    }
    if (batchJob?.id && Number(batchJob.id) === Number(jobId) && batchRunning) {
      return undefined;
    }
    const token = ++batchPollRef.current;
    (async () => {
      try {
        const active = await fetchActiveDramaShotBatchGenerate(activeEpisodeId);
        if (cancelled || token !== batchPollRef.current) return;
        if (!active?.id) {
          setBatchJob(null);
          return;
        }
        setBatchJob(active);
        if (active.status === "RUNNING" || active.status === "PENDING") {
          const done = await pollDramaShotBatchGenerate(activeEpisodeId, active.id, {
            onProgress: (progress) => {
              if (!cancelled && token === batchPollRef.current) setBatchJob(progress);
            },
          });
          if (cancelled || token !== batchPollRef.current) return;
          setBatchJob(done);
          await queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
          if (done?.status === "FAILED") {
            setActionError(done.errorMessage || "批量出片失败");
          } else if (done?.status === "SUCCEEDED") {
            setCompileNotice("批量出片完成");
            setSelectedIds(new Set());
            setBatchSelectMode(false);
          }
        }
      } catch (error) {
        if (!cancelled && token === batchPollRef.current) {
          setActionError(error.message || "恢复批量出片进度失败");
        }
      } finally {
        if (token === batchPollRef.current) batchPollRef.current = 0;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEpisodeId, board?.activeBatchJobId]);

  function exitBatchSelect() {
    setBatchSelectMode(false);
    setSelectedIds(new Set());
    setBatchModalOpen(false);
  }

  function toggleShotSelect(shot, event) {
    event?.stopPropagation?.();
    if (!batchSelectMode || !shot?.id || batchRunning) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(shot.id)) {
        next.delete(shot.id);
        return next;
      }
      next.add(shot.id);
      return next;
    });
  }

  function toggleSelectAllShots() {
    if (batchRunning || !shots.length) return;
    const allSelected = shots.every((shot) => selectedIds.has(shot.id));
    setSelectedIds(allSelected ? new Set() : new Set(shots.map((shot) => shot.id)));
  }

  async function confirmBatchGenerate(config) {
    if (!activeEpisodeId || !selectedIds.size || batchRunning) return;
    setBatchSubmitting(true);
    setActionError("");
    const token = ++batchPollRef.current;
    try {
      const job = await startDramaShotBatchGenerate(activeEpisodeId, {
        shotIds: [...selectedIds],
        videoGenerateMode: config.videoGenerateMode,
        // 参考图批量不再支持链式尾帧，始终并行；i2v 串行由 i2vFirstFrameMode 决定
        chainPrevTail: false,
        i2vFirstFrameMode: config.i2vFirstFrameMode,
        firstShotAutoStill: config.firstShotAutoStill,
      });
      setBatchModalOpen(false);
      setBatchSelectMode(false);
      setSelectedIds(new Set());
      setBatchJob(job);
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      if (job?.status === "RUNNING" || job?.status === "PENDING") {
        const done = await pollDramaShotBatchGenerate(activeEpisodeId, job.id, {
          onProgress: (progress) => {
            if (token === batchPollRef.current) setBatchJob(progress);
          },
        });
        if (token !== batchPollRef.current) return;
        setBatchJob(done);
        await queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
        if (done?.status === "FAILED") {
          setActionError(done.errorMessage || "批量出片失败");
        } else if (done?.status === "SUCCEEDED") {
          setCompileNotice("批量出片完成");
          setSelectedIds(new Set());
          setBatchSelectMode(false);
        }
      }
    } catch (error) {
      setActionError(error.message || "批量出片失败");
    } finally {
      setBatchSubmitting(false);
      if (token === batchPollRef.current) batchPollRef.current = 0;
    }
  }

  const draftMutation = useMutation({
    mutationFn: () => draftDramaStoryboard(activeEpisodeId, draftDurationSec),
    onMutate: () => {
      setDraftConfirmOpen(false);
      setActionError("");
      queryClient.setQueryData(["drama-storyboard", activeEpisodeId], (current) => (
        current ? { ...current, drafting: true, draftError: null } : current
      ));
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["drama-storyboard", activeEpisodeId], data);
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      if (!data?.drafting) {
        queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
        queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
        queryClient.invalidateQueries({ queryKey: ["creations"] });
        setShotId(data?.chapters?.[0]?.shots?.[0]?.id || null);
      }
      setActionError("");
    },
    onError: (error) => {
      setActionError(error.message || "拆镜失败");
      queryClient.setQueryData(["drama-storyboard", activeEpisodeId], (current) => (
        current ? { ...current, drafting: false } : current
      ));
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
    },
  });

  const compileAllMutation = useMutation({
    mutationFn: () => compileDramaStoryboard(activeEpisodeId),
    onMutate: () => {
      setCompileConfirmOpen(false);
      setCompileNotice("");
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["drama-storyboard", activeEpisodeId], data);
      setActionError("");
      const count = (data?.chapters || []).reduce((sum, chapter) => sum + (chapter.shots?.length || 0), 0);
      setCompileNotice(count > 0
        ? `已重新编译本集 ${count} 个分镜的视频提示词`
        : "本集分镜已重新编译");
    },
    onError: (error) => {
      setCompileNotice("");
      setActionError(error.message || "编译失败");
    },
  });

  async function compileCurrentShot() {
    if (!selected?.id) return;
    setCompileShotOpen(false);
    const index = selected.shotIndex;
    try {
      await runShot(selected.id, "compile", () => compileDramaShot(selected.id));
      setCompileNotice(`已重新编译镜 ${index} 的视频提示词`);
    } catch {
      setCompileNotice("");
    }
  }

  const createShotMutation = useMutation({
    mutationFn: (payload) => createDramaShot(activeEpisodeId, payload),
    onSuccess: (shot) => {
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
      if (shot?.id) setShotId(shot.id);
      setActionError("");
    },
    onError: (error) => setActionError(error.message || "新增分镜失败"),
  });

  const deleteShotMutation = useMutation({
    mutationFn: (target) => deleteDramaShot(target.id),
    onSuccess: (data, target) => {
      queryClient.setQueryData(["drama-storyboard", activeEpisodeId], data);
      queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
      queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
      queryClient.invalidateQueries({ queryKey: ["creations"] });
      const pool = (data?.chapters || []).flatMap((item) => item.shots || []);
      const back = pool.find((item) => item.chapterId === target.chapterId) || pool[0];
      setShotId(back?.id || null);
      setDeleteTarget(null);
      setActionError("");
    },
    onError: (error) => setActionError(error.message || "删除分镜失败"),
  });

  function insertAfter(shot) {
    if (!shot?.id || draftMutation.isPending) return;
    createShotMutation.mutate({
      chapterId: shot.chapterId,
      afterShotId: shot.id,
    });
  }

  function insertBefore(shot) {
    if (!shot?.id || draftMutation.isPending) return;
    createShotMutation.mutate({
      chapterId: shot.chapterId,
      beforeShotId: shot.id,
    });
  }

  function requestRemoveShot(shot) {
    if (!shot?.id) return;
    setDeleteTarget(shot);
  }

  function confirmRemoveShot() {
    if (!deleteTarget?.id) return;
    deleteShotMutation.mutate({ id: deleteTarget.id, chapterId: deleteTarget.chapterId });
  }

  function draftBlockedReason() {
    if (autoDrafting || draftMutation.isPending) return "正在拆镜，请稍候";
    if (recompiling) return "正在重新编译提示词，请稍候";
    if (!scriptLocked) return "请先锁定分场剧本再拆镜";
    if (!canUseTextModel) return "请先在剧本页绑定可用文本模型";
    return "";
  }

  function requestDraft() {
    if (autoDrafting || draftMutation.isPending || recompiling || !scriptLocked || !canUseTextModel) return;
    // 失败后无分镜：直接重试，不再弹确认。
    if (shots.length) {
      setDraftConfirmOpen(true);
      return;
    }
    draftMutation.mutate();
  }

  function deleteBlockedReason(shot) {
    if (autoDrafting || draftMutation.isPending) return "正在拆镜，请稍候";
    if (recompiling) return "正在重新编译提示词，请稍候";
    if (batchLockedIds.has(shot?.id)) return "该镜正在批量生成中";
    if (shots.length <= 1) return "至少保留一个分镜";
    if (isShotGenerating(shot, busy)) return "该镜正在生成，请等任务结束再删除";
    return "";
  }

  useEffect(() => {
    const current = series?.defaultResolution;
    if (!seriesId || !selectedVideoModel || !current) return undefined;
    const options = resolutionOptionsFor(selectedVideoModel);
    if (options.includes(current)) return undefined;
    let cancelled = false;
    updateDramaSeries(seriesId, { defaultResolution: preferredResolution(options, current) })
      .then(() => {
        if (!cancelled) queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
      })
      .catch((error) => {
        if (!cancelled) setActionError(error.message || "清晰度保存失败");
      });
    return () => {
      cancelled = true;
    };
  }, [seriesId, selectedVideoModel, series?.defaultResolution, queryClient]);

  const bindMutation = useMutation({
    mutationFn: async (id) => {
      await bindDramaVideoModel(seriesId, Number(id));
      const model = videoModels.find((item) => String(item.id) === String(id));
      const options = resolutionOptionsFor(model);
      if (series?.defaultResolution && !options.includes(series.defaultResolution)) {
        await updateDramaSeries(seriesId, { defaultResolution: preferredResolution(options, series.defaultResolution) });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      setActionError("");
    },
    onError: (error) => setActionError(error.message || "绑定视频模型失败"),
  });

  const ratioMutation = useMutation({
    mutationFn: (aspectRatio) => updateDramaSeries(seriesId, { aspectRatio }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
      setActionError("");
    },
    onError: (error) => setActionError(error.message || "更新视频比例失败"),
  });

  const resolutionMutation = useMutation({
    mutationFn: (defaultResolution) => updateDramaSeries(seriesId, { defaultResolution }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
      setActionError("");
    },
    onError: (error) => setActionError(error.message || "更新清晰度失败"),
  });

  async function changeFrame(task) {
    if (!selected?.id) return;
    try {
      const result = await runShot(selected.id, "frame", task);
      patchShot(result);
    } catch {
      // runShot 已写入错误横幅
    }
  }

  function patchShot(next) {
    if (!next?.id) return;
    queryClient.setQueryData(["drama-storyboard", activeEpisodeId], (current) => {
      if (!current?.chapters) return current;
      return {
        ...current,
        chapters: current.chapters.map((chapter) => ({
          ...chapter,
          shots: (chapter.shots || []).map((shot) => (shot.id === next.id ? { ...shot, ...next } : shot)),
        })),
      };
    });
  }

  async function runShot(id, key, task) {
    setBusy((current) => ({ ...current, [id]: key }));
    setActionError("");
    try {
      const result = await task();
      patchShot(result?.shot || result);
      return result;
    } catch (error) {
      setActionError(error.message || "操作失败");
      throw error;
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }

  async function saveShot(shot, patch) {
    const payload = {};
    if (Object.prototype.hasOwnProperty.call(patch, "title")) {
      payload.title = patch.title;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "visiblePrompt")) {
      payload.visiblePrompt = patch.visiblePrompt;
      payload.referenceAssetIds = patch.referenceAssetIds || [];
    }
    if (Object.prototype.hasOwnProperty.call(patch, "dialogue")
        && !Object.prototype.hasOwnProperty.call(patch, "visiblePrompt")) {
      payload.dialogue = patch.dialogue;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "durationSec")) {
      payload.durationSec = patch.durationSec;
      setDraftDurationSec(Number(patch.durationSec));
    }
    if (Object.prototype.hasOwnProperty.call(patch, "videoGenerateMode")) {
      payload.videoGenerateMode = patch.videoGenerateMode;
    }
    const result = await runShot(shot.id, "save", () => updateDramaShot(shot.id, payload));
    if (Object.prototype.hasOwnProperty.call(patch, "title")) {
      patchShot({
        id: shot.id,
        title: result?.title ?? patch.title,
      });
    }
    if (Object.prototype.hasOwnProperty.call(patch, "visiblePrompt")) {
      patchShot({
        id: shot.id,
        visiblePrompt: result?.visiblePrompt ?? patch.visiblePrompt,
        promptOverride: null,
        legacyOverride: false,
        referenceAssetIds: result?.referenceAssetIds || payload.referenceAssetIds,
        dialogue: result?.dialogue ?? shot.dialogue,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
    queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
    if (shot.videoKey && patch.durationSec != null && Number(patch.durationSec) !== Number(shot.durationSec)) {
      setActionError("须重新生成当前镜头");
    }
    return result;
  }

  async function selectShotGeneration(record) {
    if (!selected?.id || !record?.id) return;
    setBusy((current) => ({ ...current, [selected.id]: "history" }));
    setActionError("");
    try {
      const updated = await selectDramaShotGeneration(selected.id, record.id);
      patchShot(updated);
      setSwitchFinalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      queryClient.invalidateQueries({ queryKey: ["drama-shot-generations", selected.id] });
      queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
    } catch (error) {
      setActionError(error.message || "切换最终分镜失败");
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[selected.id];
        return next;
      });
    }
  }

  function requestDeleteShotGeneration(record) {
    if (!selected?.id || !record?.id) return;
    setDeleteGenerationTarget(record);
  }

  async function confirmDeleteShotGeneration() {
    const record = deleteGenerationTarget;
    if (!selected?.id || !record?.id) return;
    setBusy((current) => ({ ...current, [selected.id]: "history" }));
    setActionError("");
    try {
      await deleteDramaShotGeneration(selected.id, record.id);
      setDeleteGenerationTarget(null);
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      queryClient.invalidateQueries({ queryKey: ["drama-shot-generations", selected.id] });
      queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
      queryClient.invalidateQueries({ queryKey: ["creations"] });
    } catch (error) {
      setActionError(error.message || "删除生成记录失败");
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[selected.id];
        return next;
      });
    }
  }

  async function generate(shot) {
    if (!shot?.id) return;
    if (batchLockedIds.has(shot.id)) {
      setActionError("该镜正在批量生成中");
      return;
    }
    setBusy((current) => ({ ...current, [shot.id]: "generate" }));
    setActionError("");
    patchShot({
      ...shot,
      generating: true,
      genErrorMessage: "",
      genTaskStatus: "PENDING",
    });
    try {
      const result = await generateDramaShot(shot.id);
      patchShot(result?.shot || result);
      if (result?.task?.id) {
        const done = await pollDramaShotGenerate(shot.id, result.task.id);
        patchShot(done?.shot || done);
        if (done?.task?.status === "FAILED") {
          const msg = done.task.errorMessage;
          setActionError(friendlyShotError(msg, videoModels.find((item) => String(item.id) === String(videoModelId))));
          setRealPersonConvertShotId(isRealPersonReject(msg) ? shot.id : null);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      queryClient.invalidateQueries({ queryKey: ["drama-shot-generations", shot.id] });
      queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
      queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
    } catch (error) {
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      queryClient.invalidateQueries({ queryKey: ["drama-shot-generations", shot.id] });
      if (!isRetryableRequestError(error)) {
        setActionError(error.message || "出片失败");
        setRealPersonConvertShotId(isRealPersonReject(error.message) ? shot.id : null);
      }
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[shot.id];
        return next;
      });
    }
  }

  async function convertShotRefsAfterRealPersonReject(shot) {
    const refs = characterPictureRefs(shot);
    const targets = [];
    const seen = new Set();
    for (const item of refs) {
      const assetId = item.assetId;
      if (!assetId || seen.has(assetId)) continue;
      seen.add(assetId);
      targets.push({ assetId, name: item.name || `资产 ${assetId}` });
    }
    if (!targets.length) {
      setActionError("本镜没有可转的角色参考图");
      return;
    }
    setConvertingAssets(true);
    setConvertProgress(`正在转资产图 0/${targets.length}…`);
    setActionError(`正在转资产图 0/${targets.length}…`);
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const { assetId, name } = targets[i];
        const index = i + 1;
        const total = targets.length;
        setConvertProgress(convertProgressText(index, total, name, "describe"));
        setActionError(convertProgressText(index, total, name, "describe"));
        const result = await convertDramaAssetToSeedream(assetId, {});
        const taskId = result?.task?.id;
        if (!taskId) {
          throw new Error(`「${name}」转图未返回任务`);
        }
        let status = result?.task?.status;
        let sawRunning = status === "RUNNING";
        while (status === "PENDING" || status === "RUNNING") {
          if (status === "RUNNING" && !sawRunning) {
            sawRunning = true;
            setConvertProgress(convertProgressText(index, total, name, "t2i"));
            setActionError(convertProgressText(index, total, name, "t2i"));
          }
          await new Promise((resolve) => setTimeout(resolve, 4000));
          const done = await fetchDramaAssetGenerateTask(assetId, taskId);
          status = done?.task?.status;
          if (status === "FAILED") {
            throw new Error(done?.task?.errorMessage || `「${name}」转图失败`);
          }
        }
        if (status && status !== "SUCCEEDED" && status !== "SUCCESS") {
          throw new Error(`「${name}」转图异常：${status}`);
        }
      }
      setConvertProgress("");
      setActionError("转资产图完成，请确认选用图后再次生成当前镜头。");
      setRealPersonConvertShotId(null);
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      queryClient.invalidateQueries({ queryKey: ["drama-assets", activeEpisodeId] });
    } catch (error) {
      setActionError(error.message || "转资产图失败");
    } finally {
      setConvertingAssets(false);
      setConvertProgress("");
    }
  }

  const inflightKey = inFlightShots(shots).map((item) => `${item.id}:${item.genTaskId}`).join(",");

  useEffect(() => {
    const targets = inFlightShots(shots).filter((shot) => !busy[shot.id]);
    if (!targets.length) return undefined;
    let cancelled = false;
    targets.forEach((shot) => {
      setBusy((current) => ({ ...current, [shot.id]: "generate" }));
      pollDramaShotGenerate(shot.id, shot.genTaskId)
        .then((done) => {
          if (cancelled) return;
          patchShot(done?.shot || done);
          if (done?.task?.status === "FAILED" && selected?.id === shot.id) {
            setActionError(friendlyShotError(done.task.errorMessage, videoModels.find((item) => String(item.id) === String(videoModelId))));
          }
          queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
          queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
          queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
        })
        .catch((error) => {
          if (cancelled || selected?.id !== shot.id) return;
          if (isRetryableRequestError(error)) return;
          setActionError(error.message || "出片失败");
        })
        .finally(() => {
          setBusy((current) => {
            const next = { ...current };
            delete next[shot.id];
            return next;
          });
        });
    });
    return () => {
      cancelled = true;
    };
  }, [inflightKey]);

  useEffect(() => {
    if (!selected?.id || !["PENDING", "RUNNING"].includes(selected.captionStatus)) return undefined;
    const timer = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.captionStatus, activeEpisodeId, queryClient]);

  const selectedBatchLocked = Boolean(selected?.id && batchLockedIds.has(selected.id));
  const generating = Boolean(selected && isShotGenerating(selected, busy, selectedBatchLocked));
  const drafting = autoDrafting || draftMutation.isPending;
  const boardBusy = boardQuery.isLoading || drafting;
  const frozenByRecompile = recompiling;
  const batchCheckedCount = shots.filter((shot) => selectedIds.has(shot.id)).length;
  const allShotsSelected = batchCheckedCount > 0 && batchCheckedCount === shots.length;
  const batchButtonDisabled = batchRunning
    || drafting
    || frozenByRecompile
    || (!batchSelectMode && !shots.length)
    || (batchSelectMode && batchCheckedCount > 0 && !videoModelId);
  const mentionCount = narrativeMentionCount(selected?.visiblePrompt || "", lockedAssets);
  const imageLimit = imageCap(selectedVideoModel);
  const overImageLimit = imageLimit != null && mentionCount > imageLimit;
  const missingRefs = (selected?.unboundNames || []).length > 0;
  const framesMode = shotGenerateMode(selected, selectedVideoModel) === "i2v";
  const missingFirstFrame = framesMode && !selected?.firstFrameKey;
  const generateDisabled = !selected || generating || drafting || frozenByRecompile || !videoModelId || selectedBatchLocked
    || missingFirstFrame
    || (!framesMode && (overImageLimit || missingRefs));
  const generateTitle = selectedBatchLocked
    ? "该镜正在批量生成中"
    : frozenByRecompile
      ? "正在重新编译提示词，暂不可出片"
      : drafting
        ? "正在拆镜，暂不可出片"
        : missingFirstFrame
          ? "请先设置首帧"
          : !framesMode && overImageLimit
            ? `当前模型最多支持 ${imageLimit} 张`
            : !framesMode && missingRefs
              ? "叙述里的引用还没有参考图"
              : undefined;
  const queryError = boardQuery.error && !isRetryableRequestError(boardQuery.error)
    ? boardQuery.error
    : null;
  const persistedDraftError = !drafting && board?.draftError ? board.draftError : "";
  const emptyDraftLabel = drafting
    ? "拆镜中…"
    : (persistedDraftError || actionError || shots.length ? "重新拆镜" : "智能分镜");
  const draftActionTitle = draftBlockedReason() || emptyDraftLabel;
  const draftActionDisabled = drafting || frozenByRecompile || !scriptLocked || !canUseTextModel;
  const error = queryError || bindMutation.error
    || (actionError ? { message: actionError } : null)
    || (persistedDraftError ? { message: persistedDraftError } : null);
  // Soft preview always uses the original clip; burned captionVideoUrl is for export only.
  const videoSrc = mediaUrl(selected?.videoUrl || selected?.videoKey);
  const captionSrc = showCaptions
    && videoSrc
    && selected?.id
    && selected?.captionStatus === "READY"
    ? authenticatedApiUrl(
      `/api/drama/shots/${selected.id}/captions.vtt?v=${encodeURIComponent(selected.updatedAt || selected.subtitleJsonKey || "")}`,
    )
    : "";

  async function handleRetryCaptions() {
    if (!selected?.id || captionBusy) return;
    setCaptionBusy(true);
    setActionError("");
    try {
      await retryDramaShotCaptions(selected.id);
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
    } catch (error) {
      setActionError(error.message || "字幕重新生成失败");
    } finally {
      setCaptionBusy(false);
    }
  }

  function handleCaptionSaved() {
    setCaptionEditorOpen(false);
    queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
    queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
  }

  return (
    <section className="youxi-storyboard-layout youxi-storyboard-layout--board">
      <aside className="youxi-chapters" aria-label="集数">
        <header>
          <strong>章节列表</strong>
        </header>
        <div>
          {episodes.map((item) => (
            <button
              type="button"
              key={item.id}
              className={activeEpisodeId === item.id ? "active" : ""}
              onClick={() => {
                setEpisodeId(item.id);
                setShotId(null);
                setActionError("");
              }}
            >
              <span>
                <strong>{item.name || `第 ${item.episodeNumber} 集`}</strong>
                <small>{statusLabel(item.status)}</small>
              </span>
            </button>
          ))}
          {!episodes.length && <p className="youxi-story-side-empty">暂无剧集</p>}
        </div>
      </aside>

      <div className="youxi-shots-center">
        <div className="youxi-shots-center__body">
        {!boardBusy && (
        <div className="youxi-story-banners">
        {!scriptLocked && (
          <div className="drama-asset-gate youxi-story-gate">
            <Lock size={16} />
            <div>
              <strong>先锁定分场剧本</strong>
              <p>剧本锁定后才能拆分镜。出片会使用资产当前选用的参考图。</p>
            </div>
          </div>
        )}

        {scriptLocked && !canUseTextModel && (
          <div className="drama-asset-gate youxi-story-gate">
            <Wand2 size={16} />
            <div>
              <strong>需要可用文本模型</strong>
              <p>分镜拆分只能走文本模型。请到剧本页绑定可用模型后再拆镜。</p>
            </div>
          </div>
        )}

        {scriptLocked && !hasReadyReference && (
          <div className="drama-asset-gate youxi-story-gate">
            <Lock size={16} />
            <div>
              <strong>还没有可用参考图</strong>
              <p>出片只上传镜头说明里 @ 到的参考图。</p>
            </div>
          </div>
        )}

        {frozenByRecompile && (
          <div className="drama-asset-gate youxi-story-gate">
            <RefreshCw size={16} />
            <div>
              <strong>正在重新编译</strong>
              <p>正在重算分镜提示词，出片、编译和拆镜暂不可用。</p>
            </div>
          </div>
        )}

        {(error || actionError) && (
          <div className="youxi-story-error-row">
            <p className="drama-form-error youxi-story-error">{error?.message || actionError}</p>
            {persistedDraftError && !shots.length && (
              <button
                type="button"
                className="youxi-story-error-retry"
                disabled={draftActionDisabled}
                title={draftActionTitle}
                onClick={() => requestDraft()}
              >
                <Wand2 size={14} /> 重新拆镜
              </button>
            )}
          </div>
        )}
        {realPersonConvertShotId && selected?.id === realPersonConvertShotId && (
          <div className="youxi-story-gate" style={{ marginTop: 8 }}>
            <button
              type="button"
              disabled={convertingAssets || frozenByRecompile}
              onClick={() => convertShotRefsAfterRealPersonReject(selected)}
            >
              {convertingAssets
                ? (convertProgress || "正在转资产图…")
                : "对参考资产转 Seedream 资产图"}
            </button>
          </div>
        )}
        </div>
        )}

        {boardBusy ? (
          <div className="youxi-storyboard-main youxi-storyboard-main--loading" aria-busy="true">
            <p className="youxi-storyboard-loading" role="status">分镜信息加载中</p>
          </div>
        ) : !shots.length ? (
          <div className="youxi-storyboard-main">
            <div className="youxi-story-preview">
              <div className="youxi-story-empty-preview" data-ratio={ratio}>
                <div className="youxi-story-empty-state">
                  <Film size={24} />
                  <strong>还没有分镜</strong>
                  <span>
                    {persistedDraftError || actionError
                      ? "拆镜未完成，可检查文本模型后重试。"
                      : "锁定剧本后点「智能分镜」，由文本模型按场排出本集镜头"}
                  </span>
                  <label className="youxi-shot-model">
                    <span>视频模型</span>
                    <select
                      aria-label="分镜视频模型"
                      value={videoModelId}
                      disabled={frozenByRecompile || drafting}
                      onChange={(event) => {
                        const value = event.target.value;
                        setVideoModelId(value);
                        if (value) bindMutation.mutate(value);
                      }}
                    >
                      <option value="">{videoModels.length ? "请选择视频模型" : "暂无已启用视频模型"}</option>
                      {videoModels.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="youxi-story-empty-draft"
                    disabled={draftActionDisabled}
                    title={draftActionTitle}
                    onClick={() => requestDraft()}
                  >
                    <Wand2 size={14} /> {emptyDraftLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <section className="youxi-storyboard-main">
            <ShotPromptPane
              selected={selected}
              frozen={drafting || frozenByRecompile || selectedBatchLocked || Boolean(selected && busy[selected.id])}
              lockedAssets={lockedAssets}
              durationOptions={durationOptions}
              ratio={ratio}
              resolution={resolution}
              resolutionOptions={resolutionOptions}
              videoModels={videoModels}
              videoModelId={videoModelId}
              selectedVideoModel={selectedVideoModel}
              onVideoModel={(value) => {
                setVideoModelId(value);
                if (value) bindMutation.mutate(value);
              }}
              onRatio={(value) => ratioMutation.mutate(value)}
              onResolution={(value) => resolutionMutation.mutate(value)}
              onSave={saveShot}
              onGenerate={() => generate(selected)}
              generateDisabled={generateDisabled}
              generateTitle={generateTitle}
              generating={generating}
              onCompileShot={() => setCompileShotOpen(true)}
              compilingShot={Boolean(selected && busy[selected.id] === "compile")}
              onZoom={setPreview}
              onUploadFrame={(slot, file) => changeFrame(() => (
                slot === "end" ? uploadDramaShotEndFrame(selected.id, file) : uploadDramaShotFirstFrame(selected.id, file)
              ))}
              onUseAssetFrame={(slot, assetId) => changeFrame(() => (
                slot === "end" ? useDramaShotAssetEndFrame(selected.id, assetId) : useDramaShotAssetFirstFrame(selected.id, assetId)
              ))}
              onClearFrame={(slot) => changeFrame(async () => {
                const result = slot === "end"
                  ? await clearDramaShotEndFrame(selected.id)
                  : await clearDramaShotFirstFrame(selected.id);
                if (slot === "end") {
                  return { ...result, endFrameKey: null, endFrameUrl: null, endFrameSource: "none" };
                }
                return {
                  ...result,
                  firstFrameKey: null,
                  firstFrameUrl: null,
                  firstFrameSource: result?.firstFrameSource === "prev-tail" ? "prev-tail" : "none",
                };
              })}
              onCopyPrevEnd={() => changeFrame(() => copyDramaShotPrevEndFrame(selected.id))}
              canCopyPrevEnd={previousFrameReady(previousEpisodeShot(selected, shots))}
              frameBusy={Boolean(selected && busy[selected.id] === "frame")}
            />
            <div className="youxi-story-actions">
              <div>
                <strong>全部分镜</strong>
                <span>共{shots.length}个分镜 · {shots.filter((item) => item.videoKey).length} 已出片</span>
              </div>
              <div className="drama-shot-tools">
                <button
                  type="button"
                  title="按当前镜头结构和已绑定资产重算核心提示词，会覆盖手改"
                  disabled={compileAllMutation.isPending || frozenByRecompile || !shots.length || drafting}
                  onClick={() => setCompileConfirmOpen(true)}
                >
                  <RefreshCw size={14} /> {compileAllMutation.isPending || frozenByRecompile ? "编译中…" : "重新编译"}
                </button>
                <button
                  type="button"
                  disabled={draftActionDisabled}
                  title={draftActionTitle}
                  onClick={() => requestDraft()}
                >
                  <Wand2 size={14} /> {drafting ? "拆镜中…" : "重新拆镜"}
                </button>
                {batchSelectMode && !batchRunning && (
                  <button
                    type="button"
                    title={allShotsSelected ? "取消勾选全部分镜" : "勾选全部分镜"}
                    onClick={toggleSelectAllShots}
                  >
                    {allShotsSelected ? <X size={14} /> : <Check size={14} />} {allShotsSelected ? "取消全选" : "全选"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={batchButtonDisabled}
                  title={batchRunning
                    ? "分镜批量生成中"
                    : batchSelectMode && !batchCheckedCount
                      ? "退出批量生成"
                      : batchSelectMode && !videoModelId
                        ? "先选择视频模型"
                        : batchSelectMode
                          ? "批量生成选中镜头"
                          : "勾选要生成的分镜"}
                  onClick={() => {
                    if (!batchSelectMode) {
                      setBatchSelectMode(true);
                      setSelectedIds(new Set());
                      return;
                    }
                    if (!batchCheckedCount) {
                      exitBatchSelect();
                      return;
                    }
                    setBatchModalOpen(true);
                    setActionError("");
                  }}
                >
                  {batchRunning
                    ? <Sparkles size={14} />
                    : batchSelectMode && !batchCheckedCount
                      ? <X size={14} />
                      : <Sparkles size={14} />}
                  {" "}
                  {batchRunning
                    ? "分镜批量生成中"
                    : !batchSelectMode
                      ? "批量生成镜头"
                      : batchCheckedCount
                        ? `批量生成镜头（${batchCheckedCount}）`
                        : "取消"}
                </button>
              </div>
            </div>
            <div className="youxi-filmstrip" role="list">
              {shots.map((shot, shotPos) => {
                const active = selected?.id === shot.id;
                const batchLocked = batchLockedIds.has(shot.id);
                const deleteReason = deleteBlockedReason(shot);
                const checked = selectedIds.has(shot.id);
                const addDisabled = createShotMutation.isPending || deleteShotMutation.isPending || drafting || frozenByRecompile || batchRunning;
                return (
                  <div className="youxi-filmstrip-unit" key={shot.id}>
                    {shotPos === 0 && (
                      <button
                        type="button"
                        className="youxi-shot-add"
                        disabled={addDisabled}
                        title="在镜 1 之前插入一镜"
                        aria-label="在镜 1 之前添加分镜"
                        onClick={() => insertBefore(shot)}
                      >
                        <Plus size={14} />
                      </button>
                    )}
                    <article className={`youxi-shot-thumb ${active ? "active" : ""} ${batchSelectMode && checked ? "is-batch-selected" : ""} ${batchLocked ? "is-batch-locked" : ""}`}>
                      {batchSelectMode && (
                        <button
                          type="button"
                          className={`youxi-shot-thumb__check ${checked ? "is-checked" : ""}`}
                          disabled={batchRunning}
                          title={batchRunning ? "批量生成中" : checked ? "取消选择" : "加入批量"}
                          aria-label={checked ? `取消选择镜 ${shot.shotIndex}` : `选择镜 ${shot.shotIndex}`}
                          aria-pressed={checked}
                          onClick={(event) => toggleShotSelect(shot, event)}
                        />
                      )}
                      <button
                        type="button"
                        className="youxi-shot-thumb__preview"
                        onClick={() => {
                          setShotId(shot.id);
                          setActionError("");
                        }}
                      >
                        <span className="youxi-shot-thumb__media">
                          <ShotThumbPreview shot={shot} busy={busy} batchLocked={batchLocked} />
                        </span>
                        <span className="youxi-shot-thumb__copy">
                          <b>镜 {shot.shotIndex}</b>
                          <strong title={shot.title || ""}>{shot.title?.trim() || "未命名"}</strong>
                          <small>{shot.durationSec || 5}s</small>
                        </span>
                      </button>
                      <footer>
                        <button
                          type="button"
                          className="youxi-shot-thumb__delete"
                          disabled={Boolean(deleteReason) || createShotMutation.isPending || deleteShotMutation.isPending}
                          title={deleteReason || "删除这一镜"}
                          aria-label={`删除镜 ${shot.shotIndex}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            requestRemoveShot(shot);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </footer>
                    </article>
                    <button
                      type="button"
                      className="youxi-shot-add"
                      disabled={addDisabled}
                      title="在此之后插入一镜"
                      aria-label={`在镜 ${shot.shotIndex} 之后添加分镜`}
                      onClick={() => insertAfter(shot)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        </div>
      </div>
      <ShotPreview
        selected={drafting || !shots.length ? null : selected}
        generating={generating}
        videoSrc={videoSrc}
        poster={shotPoster(selected)}
        ratio={ratio}
        captionSrc={captionSrc}
        captionStatus={selected?.captionStatus}
        captionSourceType={selected?.captionSourceType}
        captionFallbackReason={selected?.captionFallbackReason}
        captionConfidence={selected?.captionConfidence}
        captionErrorMessage={selected?.captionErrorMessage}
        showCaptions={showCaptions}
        onToggleCaptions={setShowCaptions}
        onRetryCaptions={handleRetryCaptions}
        onEditCaptions={() => setCaptionEditorOpen(true)}
        captionBusy={captionBusy}
        generations={generations}
        generationsLoading={generationsQuery.isLoading}
        historyBusy={Boolean(selected && busy[selected.id] === "history")}
        onSwitchFinal={() => {
          if (selected?.status === "已锁定") return;
          setSwitchFinalOpen(true);
        }}
        onPreviewGeneration={(record) => setVideoPreview({
          src: mediaUrl(record.videoUrl || record.videoKey),
          poster: mediaUrl(record.videoPosterUrl || record.videoPosterKey),
          title: `镜 ${selected?.shotIndex || ""} · ${record.label}`,
        })}
        onDeleteGeneration={requestDeleteShotGeneration}
      />
      <CaptionCueEditor
        open={captionEditorOpen && Boolean(selected?.id)}
        shot={selected}
        busy={captionBusy}
        onClose={() => setCaptionEditorOpen(false)}
        onSaved={handleCaptionSaved}
        onError={(message) => setActionError(message)}
      />
      <SwitchFinalModal
        open={switchFinalOpen}
        title="切换最终分镜"
        records={generations}
        locked={selected?.status === "已锁定"}
        mediaKind="video"
        busy={Boolean(selected && busy[selected.id] === "history")}
        onClose={() => setSwitchFinalOpen(false)}
        onConfirm={selectShotGeneration}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        eyebrow="分镜"
        title="删除这一镜？"
        message={deleteTarget
          ? `确定删除镜 ${deleteTarget.shotIndex}${deleteTarget.title ? `「${deleteTarget.title}」` : ""}？剩余分镜会重新编号。若本集已拼接成片，成片将作废并删除，需重新拼接。已出片并出现在我的创作中的视频也会一并删除。不可撤销。`
          : ""}
        confirmLabel="删除"
        busy={deleteShotMutation.isPending}
        busyLabel="删除中…"
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmRemoveShot}
      />
      <ConfirmDialog
        open={draftConfirmOpen}
        eyebrow="分镜"
        title="重新拆镜？"
        message="重新拆镜会删除本集全部分镜和已出片结果，然后按当前剧本重新拆分。已拼接成片也会作废。已出现在我的创作中的分镜视频也会一并删除。此操作不可撤销。"
        confirmLabel="确认重新拆镜"
        busy={draftMutation.isPending}
        onClose={() => setDraftConfirmOpen(false)}
        onConfirm={() => draftMutation.mutate()}
      />
      <ConfirmDialog
        open={compileShotOpen}
        eyebrow="分镜"
        title="重新编译这一镜？"
        message={selected
          ? `将按镜 ${selected.shotIndex}${selected.title ? `「${selected.title}」` : ""}的镜头结构和已绑定资产，重算这一镜的核心提示词，并覆盖这一镜手改过的内容。不会生成视频，也不会改动其他分镜。`
          : ""}
        confirmLabel="确认重新编译"
        busy={Boolean(selected && busy[selected.id] === "compile")}
        busyLabel="编译中…"
        danger={false}
        onClose={() => setCompileShotOpen(false)}
        onConfirm={compileCurrentShot}
      />
      <ConfirmDialog
        open={compileConfirmOpen}
        eyebrow="分镜"
        title="重新编译本集提示词？"
        message={`将按当前镜头结构和已绑定资产，重算本集全部 ${shots.length} 个分镜的核心提示词，并覆盖手改过的核心提示词。不会生成视频，也不会重新拆镜。`}
        confirmLabel="确认重新编译"
        busy={compileAllMutation.isPending}
        busyLabel="编译中…"
        danger={false}
        onClose={() => setCompileConfirmOpen(false)}
        onConfirm={() => compileAllMutation.mutate()}
      />
      <ConfirmDialog
        open={Boolean(deleteGenerationTarget)}
        eyebrow="生成记录"
        title="删除生成记录？"
        message={deleteGenerationTarget
          ? `确定删除「${deleteGenerationTarget.label}」？此操作不可撤销。若这段视频已在我的创作中，会一并删除。`
          : ""}
        confirmLabel="删除"
        busy={Boolean(selected && busy[selected.id] === "history")}
        busyLabel="删除中…"
        onClose={() => setDeleteGenerationTarget(null)}
        onConfirm={confirmDeleteShotGeneration}
      />
      {compileNotice && (
        <div className="drama-toast" role="status">
          <CircleCheck size={16} />
          {compileNotice}
        </div>
      )}
      {batchToast && (
        <div className="drama-toast" role="status">
          {batchToast}
        </div>
      )}
      <BatchGenerateModal
        open={batchModalOpen}
        onClose={() => !batchSubmitting && setBatchModalOpen(false)}
        onConfirm={confirmBatchGenerate}
        supportsR2v={selectedVideoModel?.supportsR2v !== false}
        supportsI2v={supportsI2v}
        selectionHasFirstInChapter={selectionHasFirstInChapter}
        error={actionError}
        busy={batchSubmitting}
      />
      <ImageLightbox preview={preview} onClose={() => setPreview(null)} />
      <VideoLightbox preview={videoPreview} onClose={() => setVideoPreview(null)} />
    </section>
  );
}
