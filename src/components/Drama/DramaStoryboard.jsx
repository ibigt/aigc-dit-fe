import { AudioLines, CircleCheck, Film, Lock, Pencil, Plus, RefreshCw, Save, Sparkles, Trash2, Video, Wand2, X, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bindDramaVideoModel,
  clearDramaShotFirstFrame,
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
  updateDramaShot,
  uploadDramaShotFirstFrame,
  generateDramaShotOpeningStill,
  attachDramaShotPrevTail,
} from "../../api/drama.js";
import { promptForDisplay as promptTextForDisplay } from "../../lib/createFlow.js";
import { mediaUrl } from "../../lib/media.js";
import { ImageLightbox } from "../../lib/ImageLightbox.jsx";
import { isRetryableRequestError } from "../../api/client.js";
import { ConfirmDialog } from "../ConfirmDialog.jsx";
import { BatchGenerateModal } from "./BatchGenerateModal.jsx";
import { GenerationHistoryPanel, SwitchFinalModal } from "./GenerationHistoryPanel.jsx";
import { VideoLightbox } from "./VideoLightbox.jsx";

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

function shotModeOf(shot) {
  const mode = shot?.effectiveVideoGenerateMode || shot?.videoGenerateMode;
  return mode === "i2v" ? "i2v" : "r2v";
}

function shotChainOf(shot) {
  if (shot?.effectiveVideoChainPrevTail != null) return Boolean(shot.effectiveVideoChainPrevTail);
  return Boolean(shot?.videoChainPrevTail);
}

function shotPromptText(shot) {
  if (!shot) return "";
  const override = String(shot.promptOverride || "").trim();
  if (override) return override;
  return shot.compiledPrompt || "";
}

function firstFrameTitle(source) {
  if (source === "upload") return "上传";
  if (source === "auto") return "自动";
  if (source === "prev-tail") return "落幅";
  return "首帧";
}

function isFirstInChapter(shot, shots) {
  if (!shot) return true;
  const peers = (shots || []).filter((item) => item.chapterId === shot.chapterId);
  if (!peers.length) return true;
  const min = Math.min(...peers.map((item) => item.shotIndex ?? Number.POSITIVE_INFINITY));
  return shot.shotIndex === min;
}

function ShotInspector({
  selected,
  generating,
  readOnly,
  lockedAssets,
  generateMode,
  chainPrevTail,
  supportsI2v,
  firstInChapter,
  onSave,
  onCompile,
  onZoom,
  onUploadFirstFrame,
  onClearFirstFrame,
  onGenerateStill,
  onUsePrevTail,
  durationOptions,
  generations = [],
  generationsLoading = false,
  historyBusy = false,
  onSwitchFinal,
  onPreviewGeneration,
  onDeleteGeneration,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [casting, setCasting] = useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const promptEditorRef = useRef(null);
  const frozen = generating || readOnly;
  const locked = selected?.status === "已锁定";
  const serverPrompt = shotPromptText(selected);
  const visiblePrompt = promptTextForDisplay(serverPrompt, { keepPictures: true });
  useEffect(() => {
    setPromptEditorOpen(false);
    setPromptDraft("");
    setSavingPrompt(false);
  }, [selected?.id, serverPrompt]);
  useEffect(() => {
    if (!promptEditorOpen) return undefined;
    const timer = window.setTimeout(() => promptEditorRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [promptEditorOpen]);
  if (!selected) {
    return (
      <aside className="youxi-inspector youxi-story-inspector">
        <div className="youxi-inspector-tabs">
          <button type="button" className="active">本镜</button>
        </div>
        <div className="youxi-inspector-scroll">
          <p className="youxi-story-side-empty">选中分镜后，台词与角色会显示在这里</p>
        </div>
      </aside>
    );
  }
  const refs = pictureRefs(selected);
  const cast = castOf(selected);
  const chips = [
    ...cast.characterNames.map((name) => ({ key: "characterNames", label: "角色", name })),
    ...(cast.locationName ? [{ key: "locationName", label: "场景", name: cast.locationName }] : []),
    ...cast.propNames.map((name) => ({ key: "propNames", label: "道具", name })),
  ];

  async function commitCast(next) {
    setCasting(true);
    try {
      await onSave(selected, next);
    } catch {
      // 父组件已把失败写进 actionError 横幅
    } finally {
      setCasting(false);
    }
  }

  function addAsset(asset) {
    if (asset.type === "场景") {
      if (asset.name !== cast.locationName) commitCast({ ...cast, locationName: asset.name });
      return;
    }
    const key = asset.type === "角色" ? "characterNames" : "propNames";
    if (cast[key].includes(asset.name)) return;
    commitCast({ ...cast, [key]: [...cast[key], asset.name] });
  }

  function removeCast(key, name) {
    if (key === "locationName") {
      commitCast({ ...cast, locationName: "" });
      return;
    }
    commitCast({ ...cast, [key]: cast[key].filter((item) => item !== name) });
  }

  function openPromptEditor() {
    setPromptDraft(serverPrompt);
    setPromptEditorOpen(true);
  }

  function closePromptEditor() {
    if (savingPrompt) return;
    setPromptEditorOpen(false);
    setPromptDraft("");
  }

  async function savePrompt(value) {
    if (value === serverPrompt) {
      setPromptEditorOpen(false);
      setPromptDraft("");
      return;
    }
    setSavingPrompt(true);
    try {
      await onSave(selected, { promptOverride: value });
      setPromptEditorOpen(false);
      setPromptDraft("");
    } catch {
      // 父组件已把失败写进 actionError 横幅，保留编辑态方便继续处理。
    } finally {
      setSavingPrompt(false);
    }
  }

  return (
    <aside className="youxi-inspector youxi-story-inspector">
      <div className="youxi-inspector-tabs">
        <button type="button" className="active">本镜</button>
      </div>
      <div className="youxi-inspector-scroll">
        <section className="youxi-shot-mode">
          <header>
            <strong>本镜出片</strong>
          </header>
          <label className="youxi-shot-model">
            <span className="youxi-shot-model-label">生成方式</span>
            <select
              aria-label="本镜生成方式"
              value={generateMode === "i2v" && !firstInChapter ? "i2v" : "r2v"}
              disabled={frozen}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "i2v" && (!supportsI2v || firstInChapter)) return;
                const payload = { videoGenerateMode: next };
                payload.videoChainPrevTail = next === "r2v"
                  ? (generateMode === "r2v" ? Boolean(chainPrevTail) : !firstInChapter)
                  : false;
                onSave(selected, payload).catch(() => {});
              }}
            >
              <option value="r2v">参考图</option>
              <option value="i2v" disabled={!supportsI2v || firstInChapter}>
                {firstInChapter
                  ? "首尾帧（场内第一镜不可用）"
                  : supportsI2v
                    ? "首尾帧"
                    : "首尾帧（当前模型不支持）"}
              </option>
            </select>
          </label>
          <label className="youxi-shot-model">
            <span className="youxi-shot-model-label">分镜时长</span>
            <select
              aria-label="本镜时长"
              value={clampDuration(durationOptions, selected.durationSec)}
              disabled={frozen}
              onChange={(event) => {
                const next = Number(event.target.value);
                onSave(selected, { durationSec: next }).catch(() => {});
              }}
            >
              {(durationOptions?.length ? durationOptions : DURATIONS).map((item) => (
                <option key={item} value={item}>{item} 秒</option>
              ))}
            </select>
          </label>
          {generateMode !== "i2v" && !firstInChapter && (
            <label className="youxi-shot-chain">
              <input
                type="checkbox"
                checked={Boolean(chainPrevTail)}
                disabled={frozen}
                onChange={(event) => onSave(selected, {
                  videoGenerateMode: "r2v",
                  videoChainPrevTail: event.target.checked,
                }).catch(() => {})}
              />
              将上一镜尾帧引用参考
            </label>
          )}
          <button
            type="button"
            className="drama-tool-button drama-tool-button--ghost"
            disabled={frozen}
            title="按本镜生成方式重算提示词，会清除手动覆盖"
            onClick={() => onCompile?.(selected)}
          >
            <RefreshCw size={13} /> 编译本镜
          </button>
        </section>
        <label className="youxi-field drama-prompt-field">
          <span className="drama-prompt-field__head">
            <strong>视频提示词</strong>
            {selected.promptOverride
              ? <em className="drama-engine">手动</em>
              : <em className="drama-engine drama-engine--auto">自动</em>}
            <em className="drama-prompt-field__count">{visiblePrompt.length} 字</em>
          </span>
          <textarea
            rows={10}
            disabled={frozen}
            readOnly
            value={visiblePrompt}
            placeholder={serverPrompt ? "" : "拆镜完成后会自动填入视频提示词，也可直接手写覆盖"}
            title="Picture 编号与下方参考图缩略图对应，视频生成仍使用完整提示词"
          />
          <div className="drama-prompt-field__actions">
            <button
              type="button"
              className="button button--primary drama-prompt-field__save"
              disabled={frozen || !serverPrompt}
              onClick={openPromptEditor}
              title="编辑提交给视频模型的完整提示词"
            >
              <Pencil size={14} /> 编辑完整提示词
            </button>
            {selected.promptOverride && (
              <button
                type="button"
                className="drama-tool-button drama-tool-button--ghost"
                disabled={frozen || savingPrompt}
                onClick={() => savePrompt("")}
              >
                恢复自动编译
              </button>
            )}
          </div>
        </label>
        <section className="youxi-story-cast">
          <header>
            <strong>角色 / 场景 / 道具</strong>
            <button
              type="button"
              className="youxi-story-cast-toggle"
              disabled={frozen}
              onClick={() => setPickerOpen((open) => !open)}
            >
              {pickerOpen ? <X size={12} /> : <Plus size={12} />} {pickerOpen ? "收起" : "添加"}
            </button>
          </header>
          <div className="youxi-story-meta">
            {chips.map((chip) => (
              <em key={`${chip.key}-${chip.name}`}>
                {chip.label} · {chip.name}
                <button
                  type="button"
                  disabled={frozen || casting}
                  aria-label={`从本镜移除${chip.label} ${chip.name}`}
                  onClick={() => removeCast(chip.key, chip.name)}
                >
                  <X size={10} />
                </button>
              </em>
            ))}
            {!chips.length && <em>未提取角色/场景/道具</em>}
          </div>
          {pickerOpen && (
            <div className="youxi-story-cast-picker">
              {CAST_TYPES.map(({ type, key }) => {
                const used = key === "locationName" ? [cast.locationName] : cast[key];
                const options = (lockedAssets || []).filter(
                  (asset) => asset.type === type && !used.includes(asset.name),
                );
                return (
                  <div key={type}>
                    <span>{type}</span>
                    <div>
                      {options.map((asset) => (
                        <button
                          type="button"
                          key={asset.id}
                          disabled={frozen || casting}
                          onClick={() => addAsset(asset)}
                        >
                          <Plus size={11} /> {asset.name}
                        </button>
                      ))}
                      {!options.length && <i>没有可添加的已出图{type}</i>}
                    </div>
                  </div>
                );
              })}
              {!lockedAssets?.length && <i>资产页已选用参考图的设定才能加入本镜。</i>}
            </div>
          )}
        </section>
        {selected.unboundNames?.length > 0 && (
          <p className="drama-form-error">还没有参考图：{selected.unboundNames.join("、")}</p>
        )}
        {selected.compiledStale && (
          <p className="drama-form-error">
            {selected.promptOverride
              ? "模式已变，请改覆盖提示词或清空后用自动编译。"
              : "身份、风格或生成方式已变，已重新编译提示词；请确认后再出片。"}
          </p>
        )}
        {selected.prevTailStale && generateMode === "i2v" && (
          <p className="drama-form-error">上一镜已更新，本镜仍是旧落幅起幅。不会自动重出，需要时请再点生成。</p>
        )}
        {generateMode === "i2v" && (
          <div className="youxi-first-frame">
            <span>首帧</span>
            <figure className={selected.effectiveFirstFrameUrl || selected.firstFrameUrl ? "is-on" : undefined}>
              {selected.effectiveFirstFrameUrl || selected.firstFrameUrl ? (
                <button
                  type="button"
                  className="youxi-ref-zoom"
                  aria-label="放大首帧"
                  onClick={() => onZoom({
                    src: mediaUrl(selected.effectiveFirstFrameUrl || selected.firstFrameUrl),
                    title: firstFrameTitle(selected.firstFrameSource),
                  })}
                >
                  <img src={mediaUrl(selected.effectiveFirstFrameUrl || selected.firstFrameUrl)} alt="" />
                </button>
              ) : <i />}
              <b>
                {selected.generatingStill
                  ? "生成中"
                  : (selected.firstFrameSource && selected.firstFrameSource !== "none"
                    ? firstFrameTitle(selected.firstFrameSource)
                    : "未选择")}
              </b>
            </figure>
            <div className="youxi-first-frame-actions">
              {selected.canUsePrevTail && selected.firstFrameSource !== "prev-tail" && (
                <button type="button" disabled={frozen} onClick={() => onUsePrevTail?.(selected)}>加载上一镜尾帧</button>
              )}
              <button type="button" disabled={frozen} onClick={() => onGenerateStill?.(selected)}>
                {selected.generatingStill ? "生成中…" : "自动生成"}
              </button>
              <label className="youxi-first-frame-upload">
                上传
                <input
                  type="file"
                  accept="image/*"
                  disabled={frozen}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) onUploadFirstFrame?.(selected, file);
                  }}
                />
              </label>
              {selected.firstFrameKey && (
                <button type="button" disabled={frozen} onClick={() => onClearFirstFrame?.(selected)}>清除</button>
              )}
            </div>
          </div>
        )}
        <div className="youxi-story-refs">
          <span>
            {generateMode === "i2v"
              ? "本镜参考图（仅核对身份，出片不上传设定图）"
              : "本镜参考图（出片按 Picture 序号自动绑定）"}
          </span>
          <div>
            {refs.map((ref) => {
              const src = mediaUrl(ref.imageUrl) || ref.imageUrl;
              return (
                <figure key={ref.assetId} className="is-on">
                  {src ? (
                    <button
                      type="button"
                      className="youxi-ref-zoom"
                      aria-label={`放大参考图 ${ref.name}`}
                      onClick={() => onZoom({ src, title: `${ref.name} · Picture ${ref.pictureIndex}` })}
                    >
                      <img src={src} alt="" />
                    </button>
                  ) : <i />}
                  <b>Picture {ref.pictureIndex}</b>
                  {ref.name}
                  <small>{ref.type}{ref.locked === false ? " · 无参考图" : ""}</small>
                </figure>
              );
            })}
            {!refs.length && (
              <em>为本镜指定角色 / 场景 / 道具后，出片会带上当前选用的参考图</em>
            )}
          </div>
        </div>
        {SHOW_SHOT_BEAT_EDITOR && hasShotBeats(selected) ? (
          <>
            {selected.narrativeGoal && (
              <p className="youxi-story-goal">{selected.narrativeGoal}</p>
            )}
            <ShotBeatsEditor
              key={`${selected.id}:${JSON.stringify(selected.shotBeats)}`}
              shotBeats={selected.shotBeats}
              frozen={frozen}
              onSave={(shotBeats) => onSave(selected, { shotBeats }).catch(() => {})}
            />
            {(() => {
              const emotionBadges = parseDialogueEmotionBadges(joinedBeatDialogue(selected.shotBeats));
              if (!emotionBadges.length) return null;
              return (
                <div className="youxi-dialogue-emotions" aria-label="台词情绪">
                  {emotionBadges.map((item, index) => (
                    <span key={`${item.speaker}-${item.emotion}-${index}`} className="drama-tag drama-tag--emotion">
                      {item.speaker} · {item.emotion}
                    </span>
                  ))}
                </div>
              );
            })()}
            {selected.ambianceAudio && (
              <p className="youxi-story-goal">环境声：{selected.ambianceAudio}</p>
            )}
          </>
        ) : (
          <>
            <label className="youxi-field">
              <span>台词</span>
              <small>镜 {selected.shotIndex}</small>
              <p className="youxi-dialogue-hint">
                格式：角色（情绪）：台词；旁白：台词。情绪词表：高兴/愤怒/悲伤/恐惧/惊讶/厌恶/紧张（不明显可省略）
              </p>
              <textarea
                rows={5}
                disabled={frozen}
                defaultValue={selected.dialogue || ""}
                key={`${selected.id}:dialogue:${selected.dialogue || ""}`}
                onBlur={(event) => {
                  const value = event.target.value;
                  if (value === (selected.dialogue || "")) return;
                  onSave(selected, { dialogue: value }).catch(() => {});
                }}
                placeholder={"局长（愤怒）：你给我站住！\n旁白：夜色渐深。"}
              />
              {(() => {
                const emotionBadges = parseDialogueEmotionBadges(selected.dialogue);
                if (!emotionBadges.length) return null;
                return (
                  <div className="youxi-dialogue-emotions" aria-label="台词情绪">
                    {emotionBadges.map((item, index) => (
                      <span key={`${item.speaker}-${item.emotion}-${index}`} className="drama-tag drama-tag--emotion">
                        {item.speaker} · {item.emotion}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </label>
            {selected.ambianceAudio && (
              <p className="youxi-story-goal">环境声：{selected.ambianceAudio}</p>
            )}
          </>
        )}
        {!generationsLoading && (
          <GenerationHistoryPanel
            switchLabel="切换最终分镜"
            records={generations}
            locked={locked}
            mediaKind="video"
            busy={historyBusy || frozen}
            onSwitchClick={onSwitchFinal}
            onPreview={onPreviewGeneration}
            onDelete={onDeleteGeneration}
          />
        )}
      </div>
      {promptEditorOpen && createPortal(
        <div
          className="drama-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePromptEditor();
          }}
        >
          <section
            className="drama-dialog drama-dialog--prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drama-prompt-editor-title"
          >
            <header>
              <div>
                <span>镜 {selected.shotIndex}{selected.title ? ` · ${selected.title}` : ""}</span>
                <h2 id="drama-prompt-editor-title">编辑完整提示词</h2>
              </div>
              <button type="button" aria-label="关闭" disabled={savingPrompt} onClick={closePromptEditor}>
                <X size={18} />
              </button>
            </header>
            <div className="drama-prompt-editor">
              <div className="drama-prompt-editor__meta">
                <span>提交给视频模型的完整提示词</span>
                <em>{promptDraft.length} 字</em>
              </div>
              <textarea
                ref={promptEditorRef}
                value={promptDraft}
                disabled={savingPrompt}
                onChange={(event) => setPromptDraft(event.target.value)}
                placeholder="输入本镜完整视频提示词"
              />
            </div>
            <footer className="drama-dialog__actions">
              <button type="button" disabled={savingPrompt} onClick={closePromptEditor}>取消</button>
              <button
                type="button"
                className="button button--primary"
                disabled={savingPrompt}
                onClick={() => savePrompt(promptDraft)}
              >
                <Save size={14} /> {savingPrompt ? "保存中…" : "保存修改"}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
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
  const generateMode = shotModeOf(selected);
  const chainPrevTail = shotChainOf(selected);
  const firstInChapter = isFirstInChapter(selected, shots);
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
      if (next.size > 0) {
        const firstSelected = shots.find((item) => next.has(item.id));
        if (firstSelected && firstSelected.chapterId !== shot.chapterId) {
          setBatchToast("不能跨场次选择分镜");
          return current;
        }
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

  async function uploadFirstFrame(shot, file) {
    if (!shot?.id || !file) return;
    try {
      const result = await uploadDramaShotFirstFrame(shot.id, file);
      patchShot(result);
      setActionError("");
    } catch (error) {
      setActionError(error.message || "上传首帧失败");
    }
  }

  async function clearFirstFrame(shot) {
    if (!shot?.id) return;
    try {
      const result = await clearDramaShotFirstFrame(shot.id);
      patchShot(result);
      setActionError("");
    } catch (error) {
      setActionError(error.message || "清除首帧失败");
    }
  }

  async function applyPrevTail(shot) {
    if (!shot?.id) return;
    try {
      const result = await attachDramaShotPrevTail(shot.id);
      patchShot(result);
      setActionError("");
    } catch (error) {
      setActionError(error.message || "接入上一镜落幅失败");
    }
  }

  async function generateStill(shot) {
    if (!shot?.id) return;
    setBusy((current) => ({ ...current, [shot.id]: "still" }));
    setActionError("");
    try {
      const result = await generateDramaShotOpeningStill(shot.id);
      patchShot(result?.shot || result);
      if (result?.task?.id) {
        const done = await pollDramaShotGenerate(shot.id, result.task.id);
        patchShot(done?.shot || done);
        if (done?.task?.status === "FAILED") {
          setActionError(done.task.errorMessage || "开场静帧生成失败");
        }
      }
    } catch (error) {
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      if (!isRetryableRequestError(error)) {
        setActionError(error.message || "开场静帧生成失败");
      }
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[shot.id];
        return next;
      });
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
    const payload = {
      durationSec: patch.durationSec ?? shot.durationSec ?? draftDurationSec ?? 15,
      dialogue: patch.dialogue ?? shot.dialogue ?? "",
      continuityIn: patch.continuityIn ?? shot.continuityIn ?? "",
      continuityOut: patch.continuityOut ?? shot.continuityOut ?? "",
      characterNames: patch.characterNames ?? shot.characterNames ?? [],
      propNames: patch.propNames ?? shot.propNames ?? [],
      locationName: patch.locationName ?? shot.locationName ?? "",
    };
    if (Object.prototype.hasOwnProperty.call(patch, "shotBeats")) {
      payload.shotBeats = patch.shotBeats;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "promptOverride")) {
      payload.promptOverride = patch.promptOverride;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "videoGenerateMode")) {
      payload.videoGenerateMode = patch.videoGenerateMode;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "videoChainPrevTail")) {
      payload.videoChainPrevTail = patch.videoChainPrevTail;
    }
    if (patch.durationSec != null) {
      setDraftDurationSec(Number(patch.durationSec));
    }
    const result = await runShot(shot.id, "save", () => updateDramaShot(shot.id, payload));
    // 后端把清空的 promptOverride / locationName 置 null，Jackson 省略该字段，patchShot 浅合并会残留旧值。
    if (Object.prototype.hasOwnProperty.call(patch, "promptOverride")) {
      patchShot({ id: shot.id, promptOverride: (patch.promptOverride || "").trim() || null });
    }
    if (Object.prototype.hasOwnProperty.call(patch, "locationName")) {
      patchShot({ id: shot.id, locationName: (patch.locationName || "").trim() || null });
    }
    if (Object.prototype.hasOwnProperty.call(patch, "videoGenerateMode")
        || Object.prototype.hasOwnProperty.call(patch, "videoChainPrevTail")) {
      patchShot({
        id: shot.id,
        videoGenerateMode: result?.videoGenerateMode ?? null,
        videoChainPrevTail: result?.videoChainPrevTail ?? null,
        videoModeInherited: result?.videoModeInherited,
        videoChainInherited: result?.videoChainInherited,
        effectiveVideoGenerateMode: result?.effectiveVideoGenerateMode,
        effectiveVideoChainPrevTail: result?.effectiveVideoChainPrevTail,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["drama-film", activeEpisodeId] });
    queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
    if (shot.videoKey && patch.durationSec != null && Number(patch.durationSec) !== Number(shot.durationSec)) {
      setActionError("须重新生成当前镜头");
    }
    return result;
  }

  async function compileThisShot(shot) {
    if (!shot?.id) return;
    try {
      const result = await runShot(shot.id, "compile", () => compileDramaShot(shot.id));
      patchShot({ id: shot.id, promptOverride: null });
      setCompileNotice(`已编译镜 ${shot.shotIndex} 的视频提示词`);
      return result;
    } catch {
      // runShot 已把失败写进 actionError
    }
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
  const generateDisabled = !selected || generating || drafting || frozenByRecompile || !videoModelId || selectedBatchLocked;
  const generateTitle = selectedBatchLocked
    ? "该镜正在批量生成中"
    : frozenByRecompile
      ? "正在重新编译提示词，暂不可出片"
      : generateMode === "i2v" && selected?.firstFrameSource === "none"
        ? "将先自动画开场静帧，再生成视频"
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
        <div className="youxi-shot-center-toolbar">
          <div>
            <label className="youxi-shot-model">
              <span>视频模型</span>
              <select
                aria-label="分镜视频模型"
                title={selectedVideoModel
                  ? `${selectedVideoModel.name}${selectedVideoModel.provider ? ` · ${selectedVideoModel.provider}` : ""}${selectedVideoModel.supportsNativeAudio ? " · 原生有声" : ""}`
                  : undefined}
                value={videoModelId}
                disabled={frozenByRecompile || drafting}
                onChange={(event) => {
                  const value = event.target.value;
                  setVideoModelId(value);
                  if (value) bindMutation.mutate(value);
                }}
              >
                <option value="">{videoModels.length ? "请选择视频模型" : "暂无已启用视频模型"}</option>
                {series?.videoModelId && !videoModels.some((item) => String(item.id) === String(series.videoModelId)) && (
                  <option value={series.videoModelId}>{series.videoModelName || "已绑定（当前已停用）"}</option>
                )}
                {videoModels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.provider ? ` · ${item.provider}` : ""}{item.supportsNativeAudio ? " · 原生有声" : ""}
                  </option>
                ))}
              </select>
            </label>
            {(selectedVideoModel?.supportsNativeAudio || selectedVideoModel?.supportsAudioReference) && (
              <span className="youxi-native-audio-badge">
                <AudioLines size={13} /> {selectedVideoModel.supportsNativeAudio ? "视频与声音一次生成" : "支持参考音频"}
                {selectedVideoModel.supportsAudioReference ? ` · 最多 ${selectedVideoModel.maxAudioReferences || 1} 段${selectedVideoModel.supportsAudioOnlyReference ? " · 可仅音频" : ""}` : ""}
              </span>
            )}
          </div>
          <div className="youxi-shot-center-toolbar__actions">
            <button
              type="button"
              title="按当前动作、台词和已选用的资产图，重算本集所有分镜的视频提示词，不会生成视频"
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
              <Wand2 size={14} /> {drafting ? "拆镜中…" : shots.length ? "重新拆镜" : "智能分镜"}
            </button>
            <button
              type="button"
              disabled={batchButtonDisabled}
              title={batchRunning
                ? "分镜批量生成中"
                : selectedIds.size === 0
                  ? "请先在胶片条勾选同场分镜"
                  : "批量生成选中镜头"}
              onClick={() => setBatchModalOpen(true)}
            >
              <Sparkles size={14} /> {batchRunning ? "分镜批量生成中" : "批量生成镜头"}
            </button>
            <button
              className="youxi-toolbar-primary"
              type="button"
              disabled={generateDisabled}
              title={generateTitle}
              onClick={() => generate(selected)}
            >
              <Video size={14} /> {generating ? "出片中…" : "生成当前镜头"}
            </button>
          </div>
        </div>

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
              <p>可先拆镜预览结构；出片时会按本镜角色 / 场景 / 道具绑定当前选用的参考图。</p>
            </div>
          </div>
        )}

        {frozenByRecompile && (
          <div className="drama-asset-gate youxi-story-gate">
            <RefreshCw size={16} />
            <div>
              <strong>正在重新编译</strong>
              <p>正在重算分镜提示词，出片、编译、拆镜和首帧操作暂不可用。</p>
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
            <div className="youxi-story-preview">
              {videoSrc && !generating ? (
                <div className="youxi-story-preview__video-wrap">
                  <video
                    key={videoSrc}
                    controls
                    playsInline
                    preload="metadata"
                    data-ratio={ratio}
                    src={videoSrc}
                    poster={mediaUrl(selected?.videoPosterUrl || selected?.videoPosterKey) || undefined}
                  >
                    {captionSrc && (
                      <track
                        key={captionSrc}
                        kind="captions"
                        src={captionSrc}
                        srcLang="zh-CN"
                        label="中文"
                        default
                      />
                    )}
                  </video>
                  {shotPoster(selected) && (
                    <button
                      type="button"
                      className="youxi-story-preview__zoom"
                      aria-label="放大封面"
                      title="放大封面"
                      onClick={() => setPreview({
                        src: shotPoster(selected),
                        title: `镜 ${selected.shotIndex}${selected.title ? `「${selected.title}」` : ""}`,
                      })}
                    >
                      <ZoomIn size={16} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="youxi-story-empty-preview" data-ratio={ratio}>
                  <div className="youxi-story-empty-state">
                    <Video size={24} />
                    <strong>{generating ? "正在生成视频" : "尚未生成视频"}</strong>
                    <span>
                      {generating
                        ? (selectedBatchLocked && !isInFlightStatus(selected?.genTaskStatus) && !selected?.generating
                          ? "已加入批量队列，等待出片"
                          : generateMode === "i2v"
                          ? (selected?.generatingStill
                            ? "正在画开场静帧，完成后自动出片"
                            : "正在按侧栏首帧出片")
                          : chainPrevTail
                            ? "参考图 + 上一镜尾帧：当前选用的资产图与尾帧一起提交"
                            : "默认参考图：当前选用的资产图 + 编译后的提示词")
                        : selected?.prevTailStale && generateMode === "i2v"
                          ? "上一镜已更新，本镜不会自动重出"
                          : selected?.compiledStale
                            ? (selected.promptOverride
                              ? "模式已变，请改覆盖提示词或清空后用自动编译"
                              : "身份、风格或生成方式已变，提示词已自动重编译")
                            : generateMode === "i2v"
                              ? (selected?.firstFrameSource === "none"
                                ? "将自动画开场静帧后出片"
                                : "将用侧栏首帧起幅出片")
                              : "将按本镜角色 / 场景 / 道具自动绑定 Picture 参考图后出片"}
                    </span>
                    <button type="button" disabled={generateDisabled} title={generateTitle} onClick={() => generate(selected)}>
                      <Sparkles size={14} /> {generating ? "出片中…" : "生成当前镜头"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="youxi-story-actions">
              <div>
                <strong>全部分镜</strong>
                <span>共{shots.length}个分镜 · {shots.filter((item) => item.videoKey).length} 已出片</span>
              </div>
              <div className="drama-shot-tools">
                <span>{selected.title || `镜 ${selected.shotIndex}`}</span>
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
                        {shot.prevTailStale && shotModeOf(shot) === "i2v" && (
                          <em className="youxi-shot-mode-tag is-stale">上一镜已更新</em>
                        )}
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
      <ShotInspector
        key={drafting ? "drafting" : (selected?.id || "none")}
        selected={drafting || !shots.length ? null : selected}
        generating={generating}
        readOnly={drafting || frozenByRecompile || selectedBatchLocked || Boolean(selected && busy[selected.id])}
        lockedAssets={lockedAssets}
        generateMode={generateMode}
        chainPrevTail={chainPrevTail}
        supportsI2v={supportsI2v}
        firstInChapter={firstInChapter}
        onSave={saveShot}
        onCompile={compileThisShot}
        onZoom={setPreview}
        onUploadFirstFrame={uploadFirstFrame}
        onClearFirstFrame={clearFirstFrame}
        onGenerateStill={generateStill}
        onUsePrevTail={applyPrevTail}
        durationOptions={durationOptions}
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
        message={`重新拆镜会删除本集全部 ${shots.length} 个已生成分镜（含已出片镜头和手动修改的提示词），然后按当前剧本重新拆分。已拼接成片也会作废。此操作不可撤销。`}
        confirmLabel="确认重新拆镜"
        busy={draftMutation.isPending}
        onClose={() => setDraftConfirmOpen(false)}
        onConfirm={() => draftMutation.mutate()}
      />
      <ConfirmDialog
        open={compileConfirmOpen}
        eyebrow="分镜"
        title="重新编译本集提示词？"
        message={`将按当前动作、台词和已选用的资产图，重算本集全部 ${shots.length} 个分镜的视频提示词（不会生成视频）。手动编辑过的完整提示词会被清除并恢复为自动编译结果；已锁定且未过期的分镜会跳过。`}
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
        supportsI2v={supportsI2v}
        selectionHasFirstInChapter={selectionHasFirstInChapter}
        busy={batchSubmitting}
      />
      <ImageLightbox preview={preview} onClose={() => setPreview(null)} />
      <VideoLightbox preview={videoPreview} onClose={() => setVideoPreview(null)} />
    </section>
  );
}
