import { Handle, Position } from "@xyflow/react";
import { ChevronDown, Download, RotateCcw } from "lucide-react";

export const stopNodePointer = (event) => event.stopPropagation();
export const controlClass = "nodrag nowheel";

export function NodeCard({ data, selected, kind, view, icon: Icon, children, footer }) {
  return <div className={`comfy-node workflow-card workflow-card--${kind} comfy-node--${data.tone || "blue"} ${selected ? "comfy-node--selected" : ""}`}>
    {view.hasInputHandle && <Handle id="input" type="target" position={Position.Left} className="comfy-node__unified-handle comfy-node__unified-handle--input" />}
    {view.hasOutputHandle && <Handle id="output" type="source" position={Position.Right} className="comfy-node__unified-handle comfy-node__unified-handle--output" />}
    <header><span><ChevronDown size={12} /></span><strong>{data.title || kind}</strong>{Icon && <Icon size={14} />}</header>
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

export function OutputGrid({ outputs = [], kind = "image", selectedOutput, onSelect }) {
  const usable = outputs.filter((output) => output?.url);
  return <div className="workflow-card__outputs">
    {usable.map((output, index) => <div className="workflow-card__output" key={output.storageKey || `${output.url}-${index}`}>
      {kind === "video" ? <video controls playsInline preload="metadata" src={output.url} poster={output.posterUrl} />
        : kind === "audio" ? <audio controls preload="metadata" src={output.url} />
          : <img src={output.url} alt={`生成结果 ${index + 1}`} />}
      {onSelect && <button className={controlClass} aria-pressed={selectedOutput === output} onClick={() => onSelect(outputs.indexOf(output))}>{selectedOutput === output ? "已选中" : `选择副本 ${index + 1}`}</button>}
      <a className={controlClass} href={output.url} download={output.name || `output-${index + 1}`} onPointerDown={stopNodePointer} aria-label={`下载结果 ${index + 1}`}><Download size={13} /></a>
    </div>)}
  </div>;
}
