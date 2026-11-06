import { Handle, Position } from "@xyflow/react";
import { ChevronDown, Download, Lock, RotateCcw, Trash2, Unlock, ZoomIn } from "lucide-react";
import { useState } from "react";
import { ImageLightbox } from "../../lib/ImageLightbox.jsx";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";

export const stopNodePointer = (event) => event.stopPropagation();
export const controlClass = "nodrag nowheel";

/**
 * 节点标签徽标（需求 1.3 AC-016）：展示节点已打的标签（角色/场景/道具/参考）。
 * 画布节点卡与工作台卡片两处共用。
 */
export function NodeTagBadges({ tags = [], limit = 4 }) {
  const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!list.length) return null;
  return <div className="comfy-node__tags">
    {list.slice(0, limit).map((tag) => <em key={tag}>{tag}</em>)}
    {list.length > limit && <small>+{list.length - limit}</small>}
  </div>;
}

// 节点删除入口（需求 4.2.5）：悬停卡片时出现在标题栏右侧，点击即删（可 Ctrl+Z 撤销）
export function NodeDeleteButton({ id, title, locked }) {
  const { remove } = useWorkflowNode();
  if (!id || !remove) return null;
  return <button type="button" className="comfy-node__delete nodrag" aria-label={`删除节点：${title || id}`} title={locked ? "节点已锁定，解锁后可删除" : "删除节点（Ctrl+Z 可撤销）"}
    disabled={Boolean(locked)}
    onPointerDown={stopNodePointer} onClick={(event) => { event.stopPropagation(); if (!locked) remove(id); }}><Trash2 size={12} /></button>;
}

// 节点锁定开关（需求 4.1.2.5）：锁定后不可拖拽、不可删除，画布层同步 draggable/deletable=false
export function NodeLockButton({ id, locked }) {
  const { toggleLock } = useWorkflowNode();
  if (!id || !toggleLock) return null;
  return <button type="button" className={`comfy-node__lock nodrag ${locked ? "is-locked" : ""}`}
    aria-label={locked ? `解锁节点：${id}` : `锁定节点：${id}`}
    aria-pressed={Boolean(locked)}
    title={locked ? "解锁节点（恢复拖拽与删除）" : "锁定节点（禁止拖拽与删除）"}
    onPointerDown={stopNodePointer}
    onClick={(event) => { event.stopPropagation(); toggleLock(id); }}>
    {locked ? <Lock size={11} /> : <Unlock size={11} />}
  </button>;
}

// 节点折叠开关（需求 4.1.2.6）：折叠后仅保留标题栏与端口，内容区整体隐藏
export function NodeCollapseButton({ id, collapsed }) {
  const { toggleCollapse } = useWorkflowNode();
  if (!id || !toggleCollapse) return <span className="comfy-node__chevron" aria-hidden="true"><ChevronDown size={12} /></span>;
  return <button type="button" className={`comfy-node__collapse nodrag ${collapsed ? "is-collapsed" : ""}`}
    aria-label={collapsed ? `展开节点：${id}` : `折叠节点：${id}`}
    aria-expanded={!collapsed}
    title={collapsed ? "展开节点" : "折叠节点"}
    onPointerDown={stopNodePointer}
    onClick={(event) => { event.stopPropagation(); toggleCollapse(id); }}>
    <ChevronDown size={12} />
  </button>;
}

// 折叠态根类名（配合 CSS .comfy-node--collapsed 隐藏 header 以外内容）
export const nodeCollapsedClass = (data) => (data?.collapsed ? "comfy-node--collapsed" : "");

export function NodeCard({ id, data, selected, kind, view, icon: Icon, children, footer }) {
  return <div className={`comfy-node workflow-card workflow-card--${kind} comfy-node--${data.tone || "blue"} ${selected ? "comfy-node--selected" : ""} ${nodeCollapsedClass(data)}`}>
    {view.hasInputHandle && <Handle id="input" type="target" position={Position.Left} className="comfy-node__unified-handle comfy-node__unified-handle--input" />}
    {view.hasOutputHandle && <Handle id="output" type="source" position={Position.Right} className="comfy-node__unified-handle comfy-node__unified-handle--output" />}
    <header><NodeCollapseButton id={id} collapsed={data.collapsed} /><strong>{data.title || kind}</strong>{Icon && <Icon size={14} />}<NodeLockButton id={id} locked={data.locked} /><NodeDeleteButton id={id} title={data.title || kind} locked={data.locked} /></header>
    <NodeTagBadges tags={data.tags} />
    {children}
    <footer><span>光驭画布节点</span><small>{footer}</small></footer>
  </div>;
}

export function GenerationSkeleton({ progress = 0 }) {
  return <div className="workflow-card__skeleton" role="status" aria-label={`生成中 ${progress}%`}>
    <span className="workflow-card__skeleton-art" /><span className="workflow-card__skeleton-line" />
    <div className="workflow-card__progress"><span style={{ width: `${progress}%` }} /></div>
  </div>;
}

export function NodeError({ message, onRetry }) {
  return <div className="workflow-card__error" role="alert"><span>{message || "生成失败，请重试"}</span><button className={controlClass} onPointerDown={stopNodePointer} onClick={onRetry}><RotateCcw size={12} />重试</button></div>;
}

// 媒体预览失败兜底（需求 4.2.1.5）：加载失败时给出占位与重新加载入口
export function MediaFallback({ label, onRetry }) {
  return <div className="workflow-card__media-error" role="alert">
    <span>{label}</span>
    {onRetry && <button className={controlClass} onPointerDown={stopNodePointer} onClick={onRetry}><RotateCcw size={12} />重新加载</button>}
  </div>;
}

// 预览媒体：图片支持点击放大（需求 4.2.3.5），媒体加载失败时可重新加载
function PreviewMedia({ output, kind, index }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(null);
  const reload = () => { setFailed(false); setAttempt((value) => value + 1); };
  if (failed) return <MediaFallback label="媒体加载失败" onRetry={reload} />;
  if (kind === "video") return <video key={attempt} controls playsInline preload="metadata" src={output.url} poster={output.posterUrl} onError={() => setFailed(true)} />;
  if (kind === "audio") return <audio key={attempt} controls preload="metadata" src={output.url} onError={() => setFailed(true)} />;
  return <div className="workflow-card__image-preview">
    <img key={attempt} src={output.url} alt={`生成结果 ${index + 1}`} onError={() => setFailed(true)} />
    <button className={`${controlClass} workflow-card__zoom`} aria-label={`放大预览结果 ${index + 1}`} onPointerDown={stopNodePointer} onClick={(event) => { event.stopPropagation(); setZoom({ src: output.url, title: output.name || `生成结果 ${index + 1}` }); }}><ZoomIn size={13} /></button>
    {zoom && <ImageLightbox preview={zoom} onClose={() => setZoom(null)} />}
  </div>;
}

// 结果网格（小云雀式）：缩略图带序号角标，点击整个格子即选为主结果
export function OutputGrid({ outputs = [], kind = "image", selectedOutput, onSelect }) {
  const usable = outputs.filter((output) => output?.url);
  return <div className="workflow-card__outputs">
    {usable.map((output, index) => <div
      className={`workflow-card__output ${onSelect ? "is-selectable" : ""} ${selectedOutput === output ? "is-selected" : ""}`}
      key={output.storageKey || `${output.url}-${index}`}
      onClick={onSelect ? (event) => { if (event.target.closest("a, button, audio, video")) return; onSelect(outputs.indexOf(output)); } : undefined}
    >
      <PreviewMedia output={output} kind={kind} index={index} />
      <b className="workflow-card__output-index" aria-hidden="true">{index + 1}</b>
      {selectedOutput === output && <span className="workflow-card__output-picked">主结果</span>}
      <a className={controlClass} href={output.url} download={output.name || `output-${index + 1}`} onPointerDown={stopNodePointer} aria-label={`下载结果 ${index + 1}`}><Download size={13} /></a>
    </div>)}
  </div>;
}
