import { useEffect, useRef, useState } from "react";
import { Clapperboard, Download, GripVertical } from "lucide-react";
import { nextPlaybackPosition } from "./timeline.js";
import { nodeViewModel } from "./nodeViewModel.js";
import { applyClipAudio, connectedClipQueue, syncClipPlayback } from "./nodeInteractions.js";
import { GenerationSkeleton, NodeCard, NodeError, controlClass, stopNodePointer } from "./NodeCardParts.jsx";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";

function durableClip(clip, order) {
  return {
    sourceNodeId: clip.sourceNodeId,
    outputIndex: clip.outputIndex || 0,
    order,
    trimStart: Number(clip.trimStart ?? 0),
    trimEnd: clip.trimEnd == null ? null : Number(clip.trimEnd),
    muted: Boolean(clip.muted),
    volume: Math.max(0, Math.min(2, Number(clip.volume ?? 1))),
  };
}

export default function VideoEditingNode({ id, data, selected }) {
  const { updateClips, execute, getClips } = useWorkflowNode();
  const clips = connectedClipQueue(getClips(id));
  const runtime = data.runtime || {};
  const view = nodeViewModel("VideoEditing", data.editing || {}, runtime);
  const [activeIndex, setActiveIndex] = useState(0);
  const dragIndex = useRef(null);
  const videoRef = useRef(null);
  const continuePlayback = useRef(false);
  const currentIndex = Math.min(activeIndex, clips.length - 1);
  const active = clips[currentIndex];
  const previewUrl = active?.output?.url || active?.url;
  const finalOutput = view.selectedOutput;

  useEffect(() => { applyClipAudio(videoRef.current, active); }, [active?.sourceNodeId, active?.outputIndex, active?.volume, active?.muted]);
  useEffect(() => { if (!clips.length) continuePlayback.current = false; }, [clips.length]);

  function saveClips(next) { updateClips(id, next.map(durableClip)); }
  function changeClip(index, patch) { saveClips(clips.map((clip, current) => current === index ? { ...clip, ...patch } : clip)); }
  function moveClip(from, to) {
    if (from < 0 || to < 0 || from >= clips.length || to >= clips.length || from === to) return;
    const next = [...clips];
    next.splice(to, 0, next.splice(from, 1)[0]);
    saveClips(next);
    setActiveIndex(to);
  }
  function advance() {
    const next = nextPlaybackPosition(clips, currentIndex);
    if (next) {
      continuePlayback.current = true;
      setActiveIndex(next.index);
    } else continuePlayback.current = false;
  }
  function syncPlayback(event) {
    if (syncClipPlayback(event.currentTarget, active, currentIndex < clips.length - 1)) advance();
  }
  return <NodeCard data={data} selected={selected} kind="editing" view={view} icon={Clapperboard} footer="成片">
    <div className="workflow-card__body" onPointerDown={stopNodePointer}>
      <div className="workflow-card__video-result">
        {previewUrl ? <video key={`${active?.sourceNodeId}-${active?.outputIndex}`} ref={videoRef} className={controlClass} controls playsInline preload="metadata" src={previewUrl} poster={active?.output?.posterUrl} muted={active?.muted} onLoadedMetadata={(event) => { event.currentTarget.currentTime = active?.trimStart || 0; applyClipAudio(event.currentTarget, active); if (continuePlayback.current) event.currentTarget.play().catch(() => {}); }} onTimeUpdate={syncPlayback} onEnded={(event) => { if (syncClipPlayback(event.currentTarget, active, currentIndex < clips.length - 1, true)) advance(); }} />
          : <div className="workflow-card__empty">连接视频节点后预览剪辑</div>}
      </div>
      <div className="workflow-card__clip-heading"><strong>剪辑队列</strong><span>{clips.length} 段素材</span></div>
      <div className="workflow-card__clips">{clips.map((clip, index) => <div className={`workflow-card__clip ${currentIndex === index ? "active" : ""}`} key={`${clip.sourceNodeId}-${clip.outputIndex}`} draggable onDragStart={(event) => { dragIndex.current = index; event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); moveClip(dragIndex.current, index); dragIndex.current = null; }}>
        <button className={controlClass} aria-label={`预览片段 ${index + 1}`} onClick={() => { continuePlayback.current = false; setActiveIndex(index); }}><GripVertical size={14} /><span>{clip.output?.name || clip.name || `片段 ${index + 1}`}</span></button>
        <div className="workflow-card__clip-order"><button className={controlClass} aria-label={`上移片段 ${index + 1}`} disabled={index === 0} onClick={() => moveClip(index, index - 1)}>↑</button><button className={controlClass} aria-label={`下移片段 ${index + 1}`} disabled={index === clips.length - 1} onClick={() => moveClip(index, index + 1)}>↓</button></div>
        <label>入点<input className={controlClass} type="number" min="0" step="0.1" value={clip.trimStart ?? 0} onChange={(event) => changeClip(index, { trimStart: Number(event.target.value) })} /></label>
        <label>出点<input className={controlClass} type="number" min="0" step="0.1" value={clip.trimEnd ?? 0} onChange={(event) => changeClip(index, { trimEnd: Number(event.target.value) })} /></label>
        <label>音量<input className={controlClass} type="number" min="0" max="2" step="0.1" value={clip.volume ?? 1} onChange={(event) => changeClip(index, { volume: Number(event.target.value) })} /></label>
        <label className="workflow-card__check"><input type="checkbox" checked={Boolean(clip.muted)} onChange={(event) => changeClip(index, { muted: event.target.checked })} />静音</label>
        {clip.validationError && <p className="workflow-card__notice workflow-card__notice--error" role="alert">{clip.validationError}</p>}
      </div>)}</div>
      {view.isBusy && <GenerationSkeleton progress={view.progress} />}
      {view.hasError && <NodeError message={runtime.error || (view.status === "BLOCKED" ? "上游视频失败，无法合成" : "")} onRetry={() => execute(id)} />}
      {view.status === "SUCCEEDED" && finalOutput?.url && <div className="workflow-card__final"><strong>合成成片</strong><video className={controlClass} controls playsInline preload="metadata" src={finalOutput.url} poster={finalOutput.posterUrl} /><a className={controlClass} href={finalOutput.url} download={finalOutput.name || "final-video.mp4"}><Download size={13} />下载成片</a></div>}
      <button className={`${controlClass} workflow-card__primary workflow-card__primary--full`} disabled={view.actionDisabled || clips.length === 0 || clips.some((clip) => clip.validationError)} onClick={() => execute(id)}>{view.actionLabel}</button>
    </div>
  </NodeCard>;
}
