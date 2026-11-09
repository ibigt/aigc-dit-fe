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
  GripVertical,
  Loader,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mediaUrl } from "../../lib/media.js";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";
import { MediaFallback, NodeCollapseButton, NodeDeleteButton, NodeLockButton, NodeTagBadges, nodeCollapsedClass } from "./NodeCardParts.jsx";
import { clipEnabled, enabledClips } from "./nodeInteractions.js";

const isSameClip = (a, b) => a?.sourceNodeId === b?.sourceNodeId && Number(a?.outputIndex) === Number(b?.outputIndex);

// 片段源视频时长（秒），无元数据时返回 null
function sourceDuration(clip) {
  const value = Number(clip?.output?.durationSec ?? clip?.output?.duration ?? clip?.output?.metadata?.durationSec);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// 片段裁剪区间的本地校验：与 timeline.js createClip 同口径
function trimError(clip, start, end) {
  const duration = sourceDuration(clip);
  if (!Number.isFinite(start) || start < 0) return "入点无效";
  if (!Number.isFinite(end) || end <= start) return "出点必须大于入点";
  if (duration != null && (start >= duration || end > duration)) return "超出源视频时长";
  return "";
}

// 秒 → 可编辑文本（保留 1 位小数，去尾零）
function secondsToText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.round(number * 10) / 10);
}

function textToSeconds(text) {
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 10) / 10 : NaN;
}

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
  const { getClips, updateClips, getEditingSources, execute, refreshRuntime, openEditingSuite } = useWorkflowNode();
  const filmRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [trimClip, setTrimClip] = useState(null); // { nodeId, outputIndex, start, end, error }
  const dragIndex = useRef(null);
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  // 成片播放失败（产物地址过期 / 文件被清）：给兜底 + 重新加载，需求 4.2.1.5、4.2.5.9
  const [filmFailed, setFilmFailed] = useState(false);
  const [filmAttempt, setFilmAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // 完整片段列表（含禁用项，需求 4.2.5.3）：由画布沿连线实时聚合，连线变化/上游生成完成后自动刷新
  const clips = getClips?.(id) || [];
  const playable = enabledClips(clips);
  const trimTarget = trimClip ? clips.find((clip) => isSameClip(trimClip, clip)) : null;

  // 合成成片（需求 4.2.5.5）：运行工作流后由后端 FfmpegWorkflowFilmComposer 合成，随 step 输出返回
  const runStatus = data.runtime?.status || "";
  const film = (data.runtime?.outputs || []).find((output) => output?.url || output?.storageKey);
  const filmSrc = film ? (film.storageKey ? mediaUrl(film.storageKey) : film.url) : "";

  // 换了成片地址（重新合成 / 刷新产物）就复位失败态，否则兜底会一直挂在新的可用产物上
  useEffect(() => { setFilmFailed(false); }, [filmSrc]);

  // 刷新产物（需求 4.2.5.9）：上游失败 / 产物缺失 / 地址过期时重拉运行时快照，换最新地址
  const refreshProduct = async () => {
    if (refreshing || !refreshRuntime) return;
    setRefreshing(true);
    try {
      await refreshRuntime();
    } finally {
      setRefreshing(false);
    }
  };

  // 上游视频源（需求 4.2.5.6）：区分未连线 / 等待生成 / 上游失败
  const sources = getEditingSources?.(id) || [];
  const missingSources = sources.filter((source) => !clips.some((clip) => clip.sourceNodeId === source.id));

  const updatePlaying = (value) => setPlaying(value);

  // 合成成片：走单节点运行（后端只执行该 EDIT 步骤，上游视频按指纹复用历史产物，不重生成）。
  // 有启用中的片段即可合成；合成中（runStatus=RUNNING/EDITING）禁用防重复提交
  const composing = runStatus === "RUNNING" || runStatus === "EDITING";
  const composeFilm = () => {
    if (composing || !playable.length) return;
    execute?.(id);
  };

  const togglePlayback = () => {
    const video = filmRef.current;
    if (!video || !filmSrc) return;
    if (video.paused) {
      video.play().catch(() => updatePlaying(false));
    } else {
      video.pause();
    }
  };

  // 只持久化轻量字段（与运行工作流时的写回形状一致），避免把 output 大对象塞进节点数据
  // clipId 要带上：同一上游节点的同一输出可能被拆成多段，后端按它区分片段，
  // 丢了会导致同源多段被去重成一条（导出只剩选中的那一段）。
  const persistClips = (nextClips) => {
    updateClips?.(id, nextClips.map((clip, order) => ({
      clipId: clip.clipId,
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

  // 拖拽排序：落在目标项上时交换位置并持久化（GripVertical 为拖拽把手）
  const dropClip = (index) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from == null || from === index) return;
    const next = [...clips];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    persistClips(next);
  };

  // 打开裁剪编辑：预填当前 trim 区间（出点缺省取源时长）
  const openTrim = (clip) => {
    const duration = sourceDuration(clip);
    setTrimClip({
      sourceNodeId: clip.sourceNodeId,
      outputIndex: Number(clip.outputIndex),
      start: secondsToText(clip.trimStart ?? 0),
      end: secondsToText(clip.trimEnd ?? (duration != null ? duration : "")),
      error: "",
    });
  };

  const updateTrimField = (field, value) => {
    setTrimClip((state) => ({ ...state, [field]: value, error: "" }));
  };

  // 应用裁剪区间：校验通过才写入，否则行内提示错误（后端 compose 有同口径校验兜底）
  const applyTrim = () => {
    if (!trimClip) return;
    const target = clips.find((clip) => isSameClip(clip, trimClip));
    if (!target) {
      setTrimClip(null);
      return;
    }
    const start = textToSeconds(trimClip.start);
    const end = textToSeconds(trimClip.end);
    const error = trimError(target, start, end);
    if (error) {
      setTrimClip((state) => ({ ...state, error }));
      return;
    }
    persistClips(clips.map((clip) => (isSameClip(clip, target) ? { ...clip, trimStart: start, trimEnd: end } : clip)));
    setTrimClip(null);
  };

  // 片段下载地址：优先 storageKey 走媒体代理，其次运行态直链
  const clipDownloadUrl = (clip) => {
    const key = clip?.output?.storageKey || clip?.storageKey;
    if (key) return mediaUrl(key);
    return clip?.output?.url || "";
  };

  const statusText = runStatus === "RUNNING" || runStatus === "EDITING"
    ? "成片合成中…"
    : runStatus === "FAILED"
      ? "合成失败，请重试合成"
      : (film ? "剪辑成功" : "")
        || (clips.length ? `已收录 ${playable.length}/${clips.length} 个片段` : "");
  const durationLabel = film?.durationSec
    ? formatSeconds(film.durationSec)
    : totalDuration(playable) > 0
      ? formatSeconds(totalDuration(playable))
      : "--:--";
  const emptyHint = film
    ? ""
    : clips.length
      ? "点击「合成成片」生成剪辑成片"
      : sources.length
        ? "上游视频尚未就绪"
        : "等待上游视频连线";

  return (
    <>
      <div
      className={`comfy-node video-editing-node comfy-node--blue ${selected ? "comfy-node--selected" : ""} ${nodeCollapsedClass(data)}`}
    >
      <UnifiedHandles hasInput={!!data.inputs?.length} hasOutput={false} />
      <header>
        <NodeCollapseButton id={id} collapsed={data.collapsed} />
        <strong>视频剪辑</strong>
        <Clapperboard size={14} />
        <NodeLockButton id={id} locked={data.locked} />
        <NodeDeleteButton id={id} title="视频剪辑" locked={data.locked} />
      </header>
      <NodeTagBadges tags={data.tags} />
      <div
        className="video-editing-node__player nodrag nowheel"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {film && filmFailed ? (
          <div className="video-editing-node__fallback nodrag">
            <MediaFallback
              label="成片加载失败，产物地址可能已过期"
              onRetry={() => { setFilmFailed(false); setFilmAttempt((value) => value + 1); }}
            />
            <button type="button" className="video-editing-node__fallback-refresh" onClick={refreshProduct} disabled={refreshing}>
              {refreshing ? <Loader size={11} className="spin" /> : <RefreshCw size={11} />}
              刷新产物
            </button>
          </div>
        ) : film ? (
          <>
            <video
              key={`${filmSrc}-${filmAttempt}`}
              ref={filmRef}
              controls
              playsInline
              preload="metadata"
              poster={film.posterUrl ? mediaUrl(film.posterUrl) : undefined}
              onPlay={() => updatePlaying(true)}
              onPause={() => updatePlaying(false)}
              onError={() => setFilmFailed(true)}
            >
              <source src={filmSrc} />
            </video>
            <span>
              {runStatus === "FAILED" ? <TriangleAlert size={11} /> : <Check size={11} />}
              {statusText}
            </span>
          </>
        ) : (
          <div className="video-editing-node__empty">
            {runStatus === "RUNNING" || runStatus === "EDITING" ? <Loader size={28} className="spin" /> : <Film size={28} />}
            {emptyHint && <small>{emptyHint}</small>}
            {!sources.length && (
              <small className="video-editing-node__empty-hint">
                将视频生成节点的输出连到本节点左侧端口
              </small>
            )}
          </div>
        )}
      </div>
      {missingSources.length > 0 && (
        <>
          <ul className="video-editing-node__sources nodrag" aria-label="上游视频状态">
            {missingSources.map((source) => (
              <li key={source.id} data-severity={source.status === "FAILED" || source.enabled === false ? "error" : "pending"}>
                {source.status === "FAILED" || source.enabled === false ? <TriangleAlert size={11} /> : <Loader size={11} className="spin" />}
                <span title={`${source.title}：${sourceReason(source)}`}>{source.title}</span>
                <em>{sourceReason(source)}</em>
              </li>
            ))}
          </ul>
          <small className="video-editing-node__sources-hint">上游失败或产物地址过期时，点下方「刷新产物」重新拉取</small>
        </>
      )}
      {clips.length > 0 && (
        <div className="video-editing-node__queue nodrag nowheel">
          <button
            type="button"
            className="video-editing-node__queue-toggle"
            aria-expanded={queueOpen}
            onClick={() => setQueueOpen((value) => !value)}
          >
            <ChevronDown size={11} style={{ transform: queueOpen ? "none" : "rotate(-90deg)" }} />
            片段队列（{playable.length}/{clips.length}）
          </button>
          {queueOpen && (
            <ul className="video-editing-node__clips">
              {clips.map((clip, index) => {
                const enabled = clipEnabled(clip);
                const length = trimLength(clip);
                const editing = trimClip && isSameClip(trimClip, clip);
                const previewUrl = clipDownloadUrl(clip);
                const posterUrl = clip.output?.posterUrl ? mediaUrl(clip.output.posterUrl) : undefined;
                return (
                  <li
                    key={`${clip.sourceNodeId}-${clip.outputIndex}`}
                    className={`video-editing-node__clip${editing ? " is-active" : ""}`}
                    data-disabled={!enabled}
                    data-dragging={draggingIndex === index}
                    data-drop-target={dragOverIndex === index}
                    onDragEnd={() => {
                      dragIndex.current = null;
                      setDraggingIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragOver={(event) => {
                      if (dragIndex.current == null) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      if (dragOverIndex !== index) setDragOverIndex(index);
                    }}
                    onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropClip(index);
                      setDragOverIndex(null);
                    }}
                  >
                    <span
                      className="video-editing-node__clip-grip nodrag"
                      title="拖动调整顺序"
                      draggable
                      onDragStart={(event) => {
                        dragIndex.current = index;
                        setDraggingIndex(index);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", `${clip.sourceNodeId}-${clip.outputIndex}`);
                      }}
                    >
                      <GripVertical size={12} />
                    </span>
                    <span className="video-editing-node__clip-index">{index + 1}</span>
                    <span className="video-editing-node__clip-thumb">
                      {previewUrl ? (
                        <video src={previewUrl} poster={posterUrl} muted preload="metadata" playsInline />
                      ) : (
                        <Film size={12} />
                      )}
                    </span>
                    <span className="video-editing-node__clip-info">
                      <span className="video-editing-node__clip-name" title={clip.sourceTitle || clip.sourceNodeId}>
                        {clip.sourceTitle || clip.sourceNodeId}
                      </span>
                      {clip.validationError ? (
                        <span className="video-editing-node__clip-error" title={clip.validationError}>⚠ {clip.validationError}</span>
                      ) : (
                        <span className="video-editing-node__clip-sub">
                          第 {Number(clip.outputIndex) + 1} 段
                          {length != null ? ` · ${formatSeconds(length)}` : " · 时长未知"}
                        </span>
                      )}
                    </span>
                    <div className="video-editing-node__clip-tools">
                      <button
                        type="button"
                        className="nodrag"
                        draggable={false}
                        title={editing ? "收起裁剪" : "裁剪片段"}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          if (editing) setTrimClip(null);
                          else openTrim(clip);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          if (editing) setTrimClip(null);
                          else openTrim(clip);
                        }}
                      >
                        <Scissors size={11} />
                      </button>
                      {previewUrl && (
                        <a
                          className="video-editing-node__clip-download nodrag"
                          href={previewUrl}
                          download={`clip-${clip.sourceNodeId}-${Number(clip.outputIndex) + 1}.mp4`}
                          title="下载片段原视频"
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <Download size={11} />
                        </a>
                      )}
                      <button
                        type="button"
                        className="nodrag"
                        title={enabled ? "禁用片段" : "启用片段"}
                        onClick={() => toggleClipEnabled(clip)}
                      >
                        {enabled ? <Eye size={11} /> : <EyeOff size={11} />}
                      </button>
                      <button
                        type="button"
                        className="nodrag"
                        title="上移"
                        disabled={index === 0}
                        onClick={() => moveClip(index, -1)}
                      >
                        <ChevronUp size={11} />
                      </button>
                      <button
                        type="button"
                        className="nodrag"
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
        </div>
      )}
      <div className="video-editing-node__meta">
        <span>
          <Clapperboard size={11} />
          首尾拼接
        </span>
        <span>
          <Clock3 size={11} />
          {durationLabel}
        </span>
      </div>
      <div className="video-editing-node__actions">
        <button
          type="button"
          className="video-editing-node__open-suite nodrag"
          onClick={() => openEditingSuite?.(id)}
          onPointerDown={(event) => event.stopPropagation()}
          title="打开独立剪辑台：多轨时间线、剪切、拖拽、导出成片"
        >
          <Clapperboard size={12} />
          打开剪辑台
        </button>
        <button
          className="video-editing-node__compose nodrag"
          onClick={composeFilm}
          disabled={composing || !playable.length}
          title={playable.length ? "按当前片段队列在服务端合成成片（上游视频复用已生成结果，不重复生成）" : "暂无可合成的片段，请先生成上游视频"}
        >
          {composing ? (
            <>
              <Loader size={12} className="spin" />
              合成中…
            </>
          ) : (
            <>
              <Clapperboard size={12} />
              {film ? "重新合成成片" : "合成成片"}
            </>
          )}
        </button>
        <button
          type="button"
          className="video-editing-node__refresh nodrag"
          onClick={refreshProduct}
          disabled={refreshing || composing}
          title="重新拉取运行结果：上游失败后重跑过、或产物地址过期时用它换成最新地址"
        >
          {refreshing ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />}
          刷新产物
        </button>
      </div>
      <footer>
        <span>工作流末端节点</span>
        <small>{clips.length ? `${playable.length} 个片段` : "成片"}</small>
      </footer>
    </div>
      {trimClip && trimTarget && createPortal(
        <div
          className="clip-trim-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setTrimClip(null);
          }}
        >
          <div className="clip-trim-panel" onPointerDown={(event) => event.stopPropagation()}>
            <strong title={trimTarget.sourceTitle}>裁剪「{trimTarget.sourceTitle || trimTarget.sourceNodeId}」</strong>
            <label>
              入点(秒)
              <input
                type="number"
                min="0"
                step="0.1"
                value={trimClip.start}
                onChange={(event) => updateTrimField("start", event.target.value)}
              />
            </label>
            <label>
              出点(秒)
              <input
                type="number"
                min="0"
                step="0.1"
                value={trimClip.end}
                onChange={(event) => updateTrimField("end", event.target.value)}
              />
            </label>
            <div className="clip-trim-actions">
              <button type="button" onClick={applyTrim}>确定</button>
              <button type="button" onClick={() => setTrimClip(null)}>取消</button>
            </div>
            <small>
              {trimClip.error
                ? trimClip.error
                : sourceDuration(trimTarget) != null
                  ? `源视频时长 ${secondsToText(sourceDuration(trimTarget))} 秒`
                  : "源视频时长未知"}
            </small>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

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
