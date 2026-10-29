import { Handle, Position } from "@xyflow/react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Clock3,
  Download,
  Eye,
  EyeOff,
  Film,
  Loader,
  Pause,
  Play,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "../../lib/media.js";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";
import { NodeCollapseButton, NodeLockButton, nodeCollapsedClass } from "./NodeCardParts.jsx";
import { applyClipAudio, clipEnabled, enabledClips, syncClipPlayback } from "./nodeInteractions.js";
import { nextPlaybackPosition } from "./timeline.js";

function UnifiedHandles({ hasInput, hasOutput }) {
  return (
    <>
      {hasInput && (
        <Handle
          id="input"
          type="target"
          position={Position.Left}
          className="comfy-node__unified-handle comfy-node__unified-handle--input"
        />
      )}
      {hasOutput && (
        <Handle
          id="output"
          type="source"
          position={Position.Right}
          className="comfy-node__unified-handle comfy-node__unified-handle--output"
        />
      )}
    </>
  );
}

const isSameClip = (a, b) => a?.sourceNodeId === b?.sourceNodeId && Number(a?.outputIndex) === Number(b?.outputIndex);

// 片段有效时长（trimEnd 缺失时无法得知，返回 null）
function trimLength(clip) {
  const start = Number(clip?.trimStart) || 0;
  const end = Number(clip?.trimEnd);
  return Number.isFinite(end) && end > start ? end - start : null;
}

function formatSeconds(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const totalDuration = (clips) => clips.reduce((sum, clip) => sum + (trimLength(clip) || 0), 0);

// 上游视频源未进入片段队列的原因（需求 4.2.5.6：可理解错误提示）
function sourceReason(source) {
  if (source.enabled === false) return "节点已停用";
  if (source.status === "FAILED") return "生成失败，请重跑该节点";
  if (source.status === "RUNNING") return "生成中…";
  if (source.status === "SUCCEEDED") return "无可合成的视频输出";
  return "等待生成";
}

export default function VideoEditingNode({ id, data, selected }) {
  const { getClips, updateClips, getEditingSources } = useWorkflowNode();
  const editing = data.editing || {};
  const videoRef = useRef(null);
  const filmRef = useRef(null);
  const playingRef = useRef(false);
  const advancingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // 预览模式（需求 4.2.5.5）：null = 自动（有合成成片看成片，否则看片段），手动切换后固定
  const [mode, setMode] = useState(null);

  // 完整片段列表（含禁用项，需求 4.2.5.3）：由画布沿连线实时聚合，连线变化/上游生成完成后自动刷新
  const clips = getClips?.(id) || [];
  const playable = enabledClips(clips);
  const activeClip = playable[Math.min(activeIndex, Math.max(playable.length - 1, 0))] || null;
  const currentIndex = activeClip ? playable.findIndex((clip) => isSameClip(clip, activeClip)) : -1;
  const activeSrc = activeClip ? mediaUrl(activeClip.output?.url || activeClip.storageKey) : "";

  // 合成成片（需求 4.2.5.5）：运行工作流后由后端 FfmpegWorkflowFilmComposer 合成，随 step 输出返回
  const runStatus = data.runtime?.status || "";
  const film = (data.runtime?.outputs || []).find((output) => output?.url || output?.storageKey);
  const filmSrc = film ? (film.storageKey ? mediaUrl(film.storageKey) : film.url) : "";
  const effectiveMode = mode || (film ? "film" : "clips");

  // 上游视频源（需求 4.2.5.6）：区分未连线 / 等待生成 / 上游失败
  const sources = getEditingSources?.(id) || [];
  const missingSources = sources.filter((source) => !clips.some((clip) => clip.sourceNodeId === source.id));
  const failedSources = missingSources.filter((source) => source.status === "FAILED" || source.enabled === false);

  // 切换片段后重置"推进锁"，避免 onTimeUpdate 连续触发导致跳片段
  useEffect(() => {
    advancingRef.current = false;
  }, [activeSrc]);

  const updatePlaying = (value) => {
    playingRef.current = value;
    setPlaying(value);
  };

  // 连续播放（需求 4.2.5.4）：播完当前片段自动切下一个启用片段，全部播完停在末尾
  const advance = () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    const next = nextPlaybackPosition(playable, currentIndex);
    if (next) setActiveIndex(next.index);
    else updatePlaying(false);
    videoRef.current?.pause();
  };

  const startClip = (index) => {
    if (index === currentIndex) {
      playingRef.current = true;
      setPlaying(true);
      videoRef.current?.play().catch(() => updatePlaying(false));
      return;
    }
    setActiveIndex(index);
    updatePlaying(true);
  };

  const activeVideo = () => (effectiveMode === "film" ? filmRef.current : videoRef.current);
  const canPlay = effectiveMode === "film" ? Boolean(filmSrc) : Boolean(activeClip);

  const togglePlayback = () => {
    const video = activeVideo();
    if (!video || !canPlay) return;
    if (video.paused) {
      playingRef.current = true;
      setPlaying(true);
      video.play().catch(() => updatePlaying(false));
    } else {
      video.pause();
    }
  };

  // 只持久化轻量字段（与运行工作流时的写回形状一致），避免把 output 大对象塞进节点数据
  const persistClips = (nextClips) => {
    updateClips?.(id, nextClips.map((clip, order) => ({
      sourceNodeId: clip.sourceNodeId,
      outputIndex: clip.outputIndex,
      order,
      trimStart: clip.trimStart,
      trimEnd: clip.trimEnd,
      muted: Boolean(clip.muted),
      volume: clip.volume,
      enabled: clipEnabled(clip),
    })));
  };

  const toggleClipEnabled = (clip) => {
    persistClips(clips.map((item) => (isSameClip(item, clip) ? { ...item, enabled: !clipEnabled(item) } : item)));
  };

  const moveClip = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= clips.length) return;
    const next = [...clips];
    [next[index], next[target]] = [next[target], next[index]];
    persistClips(next);
  };

  const statusText = runStatus === "RUNNING"
    ? "成片合成中…"
    : runStatus === "FAILED"
      ? "合成失败，请重跑工作流"
      : (editing.status
        || (effectiveMode === "film" && film ? "剪辑成功" : "")
        || (clips.length ? `已收录 ${playable.length}/${clips.length} 个片段` : ""));
  const durationLabel = effectiveMode === "film" && film?.durationSec
    ? formatSeconds(film.durationSec)
    : totalDuration(playable) > 0
      ? formatSeconds(totalDuration(playable))
      : (editing.duration || "--:--");
  const emptyHint = clips.length ? "所有片段均已禁用" : sources.length ? "上游视频尚未就绪" : "等待上游视频连线";

  return (
    <div
      className={`comfy-node video-editing-node comfy-node--blue ${selected ? "comfy-node--selected" : ""} ${nodeCollapsedClass(data)}`}
    >
      <UnifiedHandles hasInput={!!data.inputs?.length} hasOutput={false} />
      <header>
        <NodeCollapseButton id={id} collapsed={data.collapsed} />
        <strong>视频剪辑</strong>
        <Clapperboard size={14} />
        <NodeLockButton id={id} locked={data.locked} />
      </header>
      {film && clips.length > 0 && (
        <div className="video-editing-node__modes nodrag" role="tablist" aria-label="预览模式">
          <button
            type="button"
            role="tab"
            aria-selected={effectiveMode === "film"}
            className={effectiveMode === "film" ? "active" : ""}
            onClick={() => setMode("film")}
          >
            成片
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={effectiveMode === "clips"}
            className={effectiveMode === "clips" ? "active" : ""}
            onClick={() => setMode("clips")}
          >
            片段
          </button>
        </div>
      )}
      <div
        className="video-editing-node__player nodrag nowheel"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {effectiveMode === "film" && film ? (
          <>
            <video
              key={filmSrc}
              ref={filmRef}
              controls
              playsInline
              preload="metadata"
              poster={film.posterUrl ? mediaUrl(film.posterUrl) : undefined}
              onPlay={() => updatePlaying(true)}
              onPause={() => updatePlaying(false)}
            >
              <source src={filmSrc} />
            </video>
            <span>
              {runStatus === "FAILED" ? <TriangleAlert size={11} /> : <Check size={11} />}
              {statusText}
            </span>
          </>
        ) : activeClip ? (
          <>
            <video
              key={activeSrc}
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              poster={activeClip.output?.posterUrl ? mediaUrl(activeClip.output.posterUrl) : undefined}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                applyClipAudio(video, activeClip);
                const start = Number(activeClip.trimStart) || 0;
                if (start > 0 && Number.isFinite(video.duration) && start < video.duration) {
                  video.currentTime = start;
                }
                if (playingRef.current) video.play().catch(() => updatePlaying(false));
              }}
              onPlay={() => updatePlaying(true)}
              onPause={() => updatePlaying(false)}
              onEnded={advance}
              onTimeUpdate={(event) => {
                const hasNext = Boolean(nextPlaybackPosition(playable, currentIndex));
                if (syncClipPlayback(event.currentTarget, activeClip, hasNext, false)) advance();
              }}
            >
              <source src={activeSrc} />
            </video>
            <span>
              <Check size={11} />
              {statusText}
            </span>
          </>
        ) : (
          <div className="video-editing-node__empty">
            {runStatus === "RUNNING" ? <Loader size={28} className="spin" /> : <Film size={28} />}
            <small>{emptyHint}</small>
            {!sources.length && (
              <small className="video-editing-node__empty-hint">
                将视频生成节点的输出连到本节点左侧端口
              </small>
            )}
          </div>
        )}
      </div>
      {missingSources.length > 0 && (
        <ul className="video-editing-node__sources nodrag" aria-label="上游视频状态">
          {missingSources.map((source) => (
            <li key={source.id} data-severity={source.status === "FAILED" || source.enabled === false ? "error" : "pending"}>
              {source.status === "FAILED" || source.enabled === false ? <TriangleAlert size={11} /> : <Loader size={11} className="spin" />}
              <span title={`${source.title}：${sourceReason(source)}`}>{source.title}</span>
              <em>{sourceReason(source)}</em>
            </li>
          ))}
        </ul>
      )}
      {clips.length > 0 && (
        <ul className="video-editing-node__clips nodrag nowheel">
          {clips.map((clip, index) => {
            const enabled = clipEnabled(clip);
            const active = activeClip && isSameClip(clip, activeClip);
            const length = trimLength(clip);
            return (
              <li
                key={`${clip.sourceNodeId}-${clip.outputIndex}`}
                className={active ? "is-active" : ""}
                data-disabled={!enabled}
              >
                <span className="video-editing-node__clip-order">{index + 1}</span>
                <button
                  type="button"
                  className="video-editing-node__clip-name"
                  disabled={!enabled}
                  title={enabled ? "点击播放该片段" : "片段已禁用"}
                  onClick={() => startClip(playable.findIndex((item) => isSameClip(item, clip)))}
                >
                  {clip.sourceTitle || clip.sourceNodeId}
                </button>
                {clip.validationError ? (
                  <em title={clip.validationError}>{clip.validationError}</em>
                ) : (
                  <small>{length != null ? formatSeconds(length) : "时长未知"}</small>
                )}
                <div className="video-editing-node__clip-tools">
                  <button
                    type="button"
                    title={enabled ? "禁用片段" : "启用片段"}
                    onClick={() => toggleClipEnabled(clip)}
                  >
                    {enabled ? <Eye size={11} /> : <EyeOff size={11} />}
                  </button>
                  <button
                    type="button"
                    title="上移"
                    disabled={index === 0}
                    onClick={() => moveClip(index, -1)}
                  >
                    <ChevronUp size={11} />
                  </button>
                  <button
                    type="button"
                    title="下移"
                    disabled={index === clips.length - 1}
                    onClick={() => moveClip(index, 1)}
                  >
                    <ChevronDown size={11} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="video-editing-node__meta">
        <span>
          <Clapperboard size={11} />
          {editing.mode || "智能对齐"}
        </span>
        <span>
          <Clock3 size={11} />
          {durationLabel}
        </span>
        <span>{editing.resolution || "成片预览"}</span>
      </div>
      <div className="video-editing-node__actions">
        <button
          className="video-editing-node__action nodrag"
          onClick={togglePlayback}
          disabled={!canPlay}
        >
          {playing ? (
            <>
              <Pause size={12} />
              暂停播放
            </>
          ) : (
            <>
              <Play size={12} />
              {effectiveMode === "film" ? "播放合成成片" : "播放剪辑成片"}
            </>
          )}
        </button>
        {film && (
          <a
            className="video-editing-node__download nodrag"
            href={filmSrc}
            download={film.name || `workflow-film-${id}.mp4`}
            aria-label="下载合成成片"
            title="下载合成成片 MP4"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Download size={12} />
            下载成片
          </a>
        )}
      </div>
      <footer>
        <span>工作流末端节点</span>
        <small>{clips.length ? `${playable.length} 个片段` : "成片"}</small>
      </footer>
    </div>
  );
}
