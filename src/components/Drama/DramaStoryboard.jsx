import { CircleCheck, Film, Lock, Maximize2, Plus, RefreshCw, Sparkles, Trash2, Video, Wand2, X, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bindDramaVideoModel,
  compileDramaShot,
  compileDramaStoryboard,
  createDramaShot,
  deleteDramaShot,
  deleteDramaShotGeneration,
  draftDramaStoryboard,
  fetchDramaShotGenerations,
  fetchDramaStoryboard,
  fetchDramaVideoModels,
  fetchActiveDramaShotBatchGenerate,
  generateDramaShot,
  pollDramaShotBatchGenerate,
  pollDramaShotGenerate,
  selectDramaShotGeneration,
  startDramaShotBatchGenerate,
  updateDramaSeries,
  updateDramaShot,
} from "../../api/drama.js";
import { mediaUrl } from "../../lib/media.js";
import { ImageLightbox } from "../../lib/ImageLightbox.jsx";
import { isRetryableRequestError } from "../../api/client.js";
import { ConfirmDialog } from "../ConfirmDialog.jsx";
import { BatchGenerateModal } from "./BatchGenerateModal.jsx";
import { PromptChipEditor } from "./PromptChipEditor.jsx";
import { narrativeMentionCount, parsePromptToTokens, referenceIdsOf, stripMentionMarks } from "../../lib/promptChips.js";
import { GenerationHistoryPanel, SwitchFinalModal } from "./GenerationHistoryPanel.jsx";
import { VideoLightbox } from "./VideoLightbox.jsx";
import { DRAMA_ASPECT_RATIOS } from "./dramaSpecs.js";

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

function friendlyShotError(message, model) {
  const text = message || "出片失败";
  if (/real person/i.test(text) || text.includes("真人")) {
    return "官方 Seedance 把本镜参考图判成了真人脸，已停止出片。请使用seedream-5.0系列生成角色资产图，或使用其他模型";
  }
  if (isOfficialSeedance(model) && /agnes/i.test(text)) {
    return "官方 Seedance 仍在生成中，请稍后刷新。若确认失败，请换参考图后再点「生成当前镜头」";
  }
  return text;
}

function pictureRefs(shot) {
  return (shot?.references || []).filter((item) => item?.assetId);
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
  const poster = shotPoster(shot);
  const video = mediaUrl(shot?.videoUrl || shot?.videoKey);
  if (!ready) {
    return (
      <div className="youxi-shot-thumb__empty">
        <b>{generating ? "生成中" : "未生成"}</b>
      </div>
    );
  }
  if (poster) {
    return <img src={poster} alt="" />;
  }
  if (video) {
    return <video src={video} muted playsInline preload="metadata" tabIndex={-1} />;
  }
  return (
    <div className="youxi-shot-thumb__empty">
      <b>已出片</b>
    </div>
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

function ShotPromptPane({
  selected,
  frozen,
  lockedAssets,
  durationOptions,
  ratio,
  videoModels,
  videoModelId,
  selectedVideoModel,
  onVideoModel,
  onRatio,
  onSave,
  onGenerate,
  generateDisabled,
  generateTitle,
  generating,
  onCompileShot,
  compilingShot,
  onZoom,
}) {
  const serverPrompt = selected?.visiblePrompt || "";
  const [draft, setDraft] = useState(serverPrompt);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const expandedEditorRef = useRef(null);
  const commitPromptRef = useRef(async () => {});
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
  }, [selected?.id, serverPrompt]);

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

  async function commitPrompt() {
    const tokens = parsePromptToTokens(draft, {
      lockedAssets,
      referenceAssetIds: selected?.referenceAssetIds || [],
    });
    const visiblePrompt = tokens.map((token) => (token.kind === "text" ? token.value || "" : `@${token.name || ""}`)).join("");
    if (visiblePrompt === serverPrompt) return;
    try {
      await onSave(selected, {
        visiblePrompt,
        referenceAssetIds: referenceIdsOf(tokens),
      });
    } catch {
      // 父组件已写入错误横幅
    }
  }
  commitPromptRef.current = commitPrompt;

  function closeExpandedPrompt() {
    setPromptExpanded(false);
    commitPrompt();
  }

  if (!selected) return null;
  return (
    <div className="youxi-shot-editor">
      <div className="youxi-shot-editor__controls">
        <strong className="youxi-shot-editor__title">
          镜 {selected.shotIndex}{selected.title ? ` · ${selected.title}` : ""}
        </strong>
        <label className="youxi-shot-model">
          <span>视频比例</span>
          <select
            aria-label="视频比例"
            value={ratio}
            disabled={frozen}
            onChange={(event) => onRatio(event.target.value)}
          >
            {DRAMA_ASPECT_RATIOS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="youxi-shot-model">
          <span>视频模型</span>
          <select
            aria-label="分镜视频模型"
            value={videoModelId}
            disabled={frozen}
            onChange={(event) => onVideoModel(event.target.value)}
          >
            <option value="">{videoModels.length ? "请选择视频模型" : "暂无已启用视频模型"}</option>
            {videoModels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}{item.provider ? ` · ${item.provider}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="youxi-shot-model">
          <span>生成方式</span>
          <select aria-label="生成方式" value="r2v" disabled>
            <option value="r2v">参考图</option>
          </select>
        </label>
        <label className="youxi-shot-model">
          <span>分镜秒数</span>
          <select
            aria-label="本镜时长"
            value={clampDuration(durationOptions, selected.durationSec)}
            disabled={frozen}
            onChange={(event) => {
              onSave(selected, { durationSec: Number(event.target.value) }).catch(() => {});
            }}
          >
            {(durationOptions?.length ? durationOptions : DURATIONS).map((item) => (
              <option key={item} value={item}>{item} 秒</option>
            ))}
          </select>
        </label>
      </div>
      <div className="youxi-field drama-prompt-field">
        <span className="drama-prompt-field__head">
          <strong>视频提示词</strong>
          {selected.legacyOverride ? <em className="drama-engine">旧覆盖</em> : null}
        </span>
        <div
          className="drama-prompt-field__box"
          onBlur={(event) => {
            if (promptExpanded) return;
            if (event.currentTarget.contains(event.relatedTarget)) return;
            commitPrompt();
          }}
        >
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
      <p className={overLimit || missing.length ? "drama-form-error" : "youxi-shot-editor__hint"}>
        {overLimit
          ? `当前模型最多支持 ${cap} 张`
          : `叙述里的 @ 会计入参考图，重复引用只算一张。当前 ${mentionCount} 张${cap != null ? `，最多 ${cap} 张` : ""}。`}
        {missing.length ? ` 还没有参考图：${missing.join("、")}。` : ""}
      </p>
      <label className="youxi-field">
        <span>台词</span>
        <textarea
          rows={4}
          disabled={frozen}
          defaultValue={selected.dialogue || ""}
          key={`${selected.id}:dialogue:${selected.dialogue || ""}`}
          onBlur={(event) => {
            const value = stripMentionMarks(event.target.value);
            if (value !== event.target.value) event.target.value = value;
            if (value === (selected.dialogue || "")) return;
            onSave(selected, { dialogue: value }).catch(() => {});
          }}
          placeholder={"局长（愤怒）：你给我站住！\n旁白：夜色渐深。"}
        />
      </label>
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
          disabled={generateDisabled || overLimit || missing.length > 0}
          title={overLimit ? `当前模型最多支持 ${cap} 张` : missing.length ? "叙述里的引用还没有参考图" : generateTitle}
          onClick={onGenerate}
        >
          <Video size={14} /> {generating ? "出片中…" : "生成当前镜头"}
        </button>
      </div>
    </div>
  );
}

function ShotPreview({
  selected,
  generating,
  videoSrc,
  poster,
  ratio,
  captionSrc,
  generations,
  generationsLoading,
  historyBusy,
  onZoomPoster,
  onSwitchFinal,
  onPreviewGeneration,
  onDeleteGeneration,
}) {
  const locked = selected?.status === "已锁定";
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
                    key={videoSrc}
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
                  {poster ? (
                    <button
                      type="button"
                      className="youxi-story-preview__zoom"
                      aria-label="放大封面"
                      onClick={() => onZoomPoster({ src: poster, title: `镜 ${selected.shotIndex}` })}
                    >
                      <ZoomIn size={16} />
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="youxi-story-empty-preview" data-ratio={ratio}>
                  <div className="youxi-story-empty-state">
                    <Video size={24} />
                    <strong>{generating ? "正在生成视频" : "尚未生成视频"}</strong>
                    <span>出片使用叙述里的参考图，不附带上一镜尾帧。</span>
                  </div>
                </div>
              )}
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
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchJob, setBatchJob] = useState(null);
  const [batchToast, setBatchToast] = useState("");
  const [batchSubmitting, setBatchSubmitting] = useState(false);
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
    setBatchModalOpen(false);
    setBatchJob(null);
    setBatchToast("");
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

  function toggleShotSelect(shot, event) {
    event?.stopPropagation?.();
    if (!shot?.id || batchRunning) return;
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

  async function confirmBatchGenerate(config) {
    if (!activeEpisodeId || !selectedIds.size || batchRunning) return;
    setBatchSubmitting(true);
    setActionError("");
    const token = ++batchPollRef.current;
    try {
      const job = await startDramaShotBatchGenerate(activeEpisodeId, {
        shotIds: [...selectedIds],
        videoGenerateMode: config.videoGenerateMode,
        chainPrevTail: Boolean(config.chainPrevTail),
        i2vFirstFrameMode: config.i2vFirstFrameMode,
        firstShotAutoStill: config.firstShotAutoStill,
      });
      setBatchModalOpen(false);
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
        current ? { ...current, drafting: true } : current
      ));
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["drama-storyboard", activeEpisodeId], data);
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      if (!data?.drafting) {
        queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
        queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
        setShotId(data?.chapters?.[0]?.shots?.[0]?.id || null);
      }
      setActionError("");
    },
    onError: (error) => {
      setActionError(error.message || "拆镜失败");
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
    return shots.length ? "重新拆镜" : "智能分镜";
  }

  function requestDraft() {
    if (autoDrafting || draftMutation.isPending || recompiling || !scriptLocked || !canUseTextModel) return;
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

  const bindMutation = useMutation({
    mutationFn: (id) => bindDramaVideoModel(seriesId, Number(id)),
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
          setActionError(friendlyShotError(done.task.errorMessage, videoModels.find((item) => String(item.id) === String(videoModelId))));
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
      }
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[shot.id];
        return next;
      });
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
  const frozenByRecompile = recompiling;
  const batchButtonDisabled = batchRunning || selectedIds.size === 0 || drafting || frozenByRecompile || !videoModelId;
  const mentionCount = narrativeMentionCount(selected?.visiblePrompt || "", lockedAssets);
  const imageLimit = imageCap(selectedVideoModel);
  const overImageLimit = imageLimit != null && mentionCount > imageLimit;
  const missingRefs = (selected?.unboundNames || []).length > 0;
  const generateDisabled = !selected || generating || drafting || frozenByRecompile || !videoModelId || selectedBatchLocked || overImageLimit || missingRefs;
  const generateTitle = selectedBatchLocked
    ? "该镜正在批量生成中"
    : frozenByRecompile
      ? "正在重新编译提示词，暂不可出片"
      : drafting
        ? "正在拆镜，暂不可出片"
        : overImageLimit
          ? `当前模型最多支持 ${imageLimit} 张`
          : missingRefs
            ? "叙述里的引用还没有参考图"
            : undefined;
  const queryError = boardQuery.error && !isRetryableRequestError(boardQuery.error)
    ? boardQuery.error
    : null;
  const persistedDraftError = !drafting && board?.draftError ? board.draftError : "";
  const error = queryError || bindMutation.error
    || (actionError ? { message: actionError } : null)
    || (persistedDraftError ? { message: persistedDraftError } : null);
  const captionReady = selected?.captionStatus === "READY" && selected?.captionVideoUrl;
  const selectedVideoUrl = mediaUrl(
    captionReady ? selected.captionVideoUrl : (selected?.videoUrl || selected?.videoKey),
  );
  // captionVideoKey is intentionally stable per source video; add the processor
  // version so a browser cannot reuse the previous VAD-burned object from cache.
  const videoSrc = captionReady && selectedVideoUrl
    ? `${selectedVideoUrl}${selectedVideoUrl.includes("?") ? "&" : "?"}captionVersion=caption-6`
    : selectedVideoUrl;
  // 暂关分镜预览字幕轨道，避免播放器自动叠中文字幕。
  // const captionSrc = videoSrc && selected?.id && selected?.dialogue?.trim()
  //   ? authenticatedApiUrl(`/api/drama/shots/${selected.id}/captions.vtt?v=${encodeURIComponent(selected.updatedAt || "")}`)
  //   : "";
  const captionSrc = "";

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

        {scriptLocked && lockedAssets.length === 0 && (
          <div className="drama-asset-gate youxi-story-gate">
            <Lock size={16} />
            <div>
              <strong>还没有可用参考图</strong>
              <p>可先拆镜。出片只上传镜头说明里 @ 到的参考图。</p>
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

        {(error || actionError) && <p className="drama-form-error youxi-story-error">{error?.message || actionError}</p>}
        </div>

        {boardQuery.isLoading ? (
          <p className="drama-asset-empty">正在读取分镜…</p>
        ) : drafting ? (
          <div className="youxi-storyboard-main">
            <div className="youxi-story-preview">
              <div className="youxi-story-empty-preview" data-ratio={ratio}>
                <div className="youxi-story-empty-state">
                  <Wand2 size={24} />
                  <strong>{shots.length ? "正在重新拆镜中" : "正在自动拆镜中"}</strong>
                  <span>
                    {shots.length
                      ? "正在按当前剧本重新拆镜头，完成后会替换本集分镜，请稍候。"
                      : "分析已完成。正在按对白和动作给每镜估时长并拆镜头，请稍候。"}
                  </span>
                </div>
              </div>
            </div>
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
                      ? "拆镜未完成，请检查文本模型后重试。"
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
                    disabled={drafting || !scriptLocked || !canUseTextModel}
                    title={draftBlockedReason()}
                    onClick={() => requestDraft()}
                  >
                    <Wand2 size={14} /> {drafting ? "拆镜中…" : "智能分镜"}
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
              videoModels={videoModels}
              videoModelId={videoModelId}
              selectedVideoModel={selectedVideoModel}
              onVideoModel={(value) => {
                setVideoModelId(value);
                if (value) bindMutation.mutate(value);
              }}
              onRatio={(value) => ratioMutation.mutate(value)}
              onSave={saveShot}
              onGenerate={() => generate(selected)}
              generateDisabled={generateDisabled}
              generateTitle={generateTitle}
              generating={generating}
              onCompileShot={() => setCompileShotOpen(true)}
              compilingShot={Boolean(selected && busy[selected.id] === "compile")}
              onZoom={setPreview}
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
                  disabled={drafting || frozenByRecompile || !scriptLocked || !canUseTextModel}
                  title={draftBlockedReason()}
                  onClick={() => requestDraft()}
                >
                  <Wand2 size={14} /> {drafting ? "拆镜中…" : "重新拆镜"}
                </button>
                <button
                  type="button"
                  disabled={batchButtonDisabled}
                  title={batchRunning ? "分镜批量生成中" : selectedIds.size === 0 ? "请先勾选分镜" : "批量生成选中镜头"}
                  onClick={() => setBatchModalOpen(true)}
                >
                  <Sparkles size={14} /> {batchRunning ? "分镜批量生成中" : "批量生成镜头"}
                </button>
              </div>
            </div>
            <div className="youxi-filmstrip" role="list">
              {shots.map((shot, shotPos) => {
                const active = selected?.id === shot.id;
                const batchLocked = batchLockedIds.has(shot.id);
                const generatingShot = isShotGenerating(shot, busy, batchLocked);
                const ready = Boolean(shot.videoKey) && !generatingShot;
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
                    <article className={`youxi-shot-thumb ${active ? "active" : ""} ${checked ? "is-batch-selected" : ""} ${batchLocked ? "is-batch-locked" : ""}`}>
                      <button
                        type="button"
                        className={`youxi-shot-thumb__check ${checked ? "is-checked" : ""}`}
                        disabled={batchRunning}
                        title={batchRunning ? "批量生成中" : checked ? "取消选择" : "加入批量"}
                        aria-label={checked ? `取消选择镜 ${shot.shotIndex}` : `选择镜 ${shot.shotIndex}`}
                        aria-pressed={checked}
                        onClick={(event) => toggleShotSelect(shot, event)}
                      />
                      <button
                        type="button"
                        className="youxi-shot-thumb__preview"
                        onClick={() => {
                          setShotId(shot.id);
                          setActionError("");
                        }}
                      >
                        <span className="youxi-shot-thumb__label">
                          <b>镜 {shot.shotIndex}</b>
                          <em title={shot.title || ""}>{shot.title?.trim() || "未命名"}</em>
                        </span>
                        <ShotThumbPreview shot={shot} busy={busy} batchLocked={batchLocked} />
                        <small className={ready ? "is-ready" : ""}>
                          {generatingShot
                            ? "生成中"
                            : ready
                              ? `${shot.durationSec || 5}s · 已生成`
                              : `${shot.durationSec || 5}s`}
                        </small>
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
        generations={generations}
        generationsLoading={generationsQuery.isLoading}
        historyBusy={Boolean(selected && busy[selected.id] === "history")}
        onZoomPoster={setPreview}
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
          ? `确定删除镜 ${deleteTarget.shotIndex}${deleteTarget.title ? `「${deleteTarget.title}」` : ""}？剩余分镜会重新编号。若本集已拼接成片，成片将作废并删除，需重新拼接。不可撤销。`
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
        message="重新拆镜会删除本集全部分镜和已出片结果，然后按当前剧本重新拆分。已拼接成片也会作废。此操作不可撤销。"
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
          ? `确定删除「${deleteGenerationTarget.label}」？此操作不可撤销。`
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
        busy={batchSubmitting}
      />
      <ImageLightbox preview={preview} onClose={() => setPreview(null)} />
      <VideoLightbox preview={videoPreview} onClose={() => setVideoPreview(null)} />
    </section>
  );
}
