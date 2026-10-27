import { useState } from "react";
import { Film, Image as ImageIcon, Plus, Settings2, WandSparkles, X, Zap } from "lucide-react";
import { calculateCreditEstimate } from "../../lib/pricing.js";
import { nodeViewModel } from "./nodeViewModel.js";
import { videoOutputSelection } from "./nodeInteractions.js";
import { GenerationSkeleton, NodeCard, NodeError, OutputGrid, controlClass, stopNodePointer } from "./NodeCardParts.jsx";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";

function selectedPricing(models, media) {
  const candidate = [...models, ...(media.models || []).filter((model) => typeof model === "object")]
    .find((model) => String(model.id) === String(media.modelId) || model.name === media.model);
  return candidate?.pricing;
}

export default function MediaGeneratorNode({ id, data, selected }) {
  const { updateMedia, selectOutput, execute, getVariableScopes, getReferences, removeReference, openReferencePicker, models = [] } = useWorkflowNode();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const media = data.media || {};
  const runtime = data.runtime || {};
  const isVideo = data.kind === "VideoGenerator" || media.type === "video";
  const kind = isVideo ? "VideoGenerator" : "ImageGenerator";
  const view = nodeViewModel(kind, { ...media, scopes: getVariableScopes(id) }, runtime);
  const videoSelection = videoOutputSelection(view.outputs, view.selectedOutput?.storageKey || view.selectedOutput?.url);
  const selectedVideo = videoSelection.selected;
  const references = getReferences(id);
  const patch = (change) => updateMedia(id, change);
  const choices = (media.models || []).map((model) => typeof model === "string" ? { value: model, label: model } : { value: model.name, label: model.name });
  const estimate = calculateCreditEstimate({
    pricing: selectedPricing(models, media),
    category: isVideo ? "video" : "image",
    resolution: media.resolution,
    quality: ({ 低: "LOW", 中: "MEDIUM", 高: "HIGH" })[media.quality] || media.quality,
    durationSec: media.durationSec ?? media.duration,
    copies: media.copies,
  });
  return <NodeCard data={data} selected={selected} kind={isVideo ? "video" : "image"} view={view} icon={isVideo ? Film : ImageIcon} footer={isVideo ? "视频" : "图像"}>
    <div className="workflow-card__body" onPointerDown={stopNodePointer}>
      {view.isBusy ? <GenerationSkeleton progress={view.progress} />
        : view.hasError ? <NodeError message={runtime.error || (view.status === "BLOCKED" ? "上游节点失败，当前节点未运行" : "")} onRetry={() => execute(id)} />
          : view.status === "SUCCEEDED" && view.outputs.length ? (isVideo
            ? <><div className="workflow-card__video-result"><video key={selectedVideo?.storageKey || selectedVideo?.url} controls playsInline preload="metadata" src={selectedVideo?.url} poster={selectedVideo?.posterUrl} />{selectedVideo?.url && <a className={controlClass} href={selectedVideo.url} download={selectedVideo.name || "video.mp4"}>下载视频</a>}</div>
              {videoSelection.options.length > 1 && <div className="workflow-card__output-tabs" role="group" aria-label="生成视频副本">{videoSelection.options.map((option, index) => <button key={option.key} className={`${controlClass} ${(selectedVideo?.storageKey || selectedVideo?.url) === option.key ? "active" : ""}`} onClick={() => selectOutput(id, view.outputs.indexOf(option.output))}>视频 {index + 1}</button>)}</div>}</>
            : <OutputGrid outputs={view.outputs} selectedOutput={view.selectedOutput} onSelect={(index) => selectOutput(id, index)} />)
            : <div className="workflow-card__empty">{data.preview ? <img src={data.preview} alt="生成预览" /> : <span>{isVideo ? "等待生成视频" : "等待生成图像"}</span>}</div>}
      <div className="media-node__references" aria-label="已引用素材"><button className="media-node__reference" aria-label="添加参考素材" onClick={() => openReferencePicker(id)}><Plus size={16} /></button>{references.map((reference) => <div className="media-node__reference-chip" key={reference.edgeId} title={reference.title}><img src={reference.preview} alt={reference.title} />{reference.type === "VIDEO" && <span><Film size={9} /></span>}<button aria-label={`移除引用：${reference.title}`} onClick={() => removeReference(id, reference.sourceId)}><X size={10} /></button><small>{reference.title}</small></div>)}</div>
      {isVideo && <div className="workflow-card__segmented">{["全能参考", "首尾帧"].map((mode) => <button key={mode} className={`${controlClass} ${media.mode === mode ? "active" : ""}`} onClick={() => patch({ mode })}>{mode}</button>)}</div>}
      <label className="workflow-card__label" htmlFor={`media-prompt-${id}`}>画面描述</label>
      <textarea id={`media-prompt-${id}`} className={controlClass} value={media.prompt || ""} onChange={(event) => patch({ prompt: event.target.value })} placeholder={isVideo ? "描述希望生成的视频" : "描述希望生成的图像"} rows={4} />
      {view.missing.length > 0 && <p className="workflow-card__notice">缺少变量：{view.missing.join("、")}</p>}
      {view.conflicts.length > 0 && <p className="workflow-card__notice workflow-card__notice--error">变量冲突：{view.conflicts.join("、")}</p>}
      <div className="workflow-card__control-row">
        <select className={controlClass} aria-label="生成模型" value={media.model || ""} onChange={(event) => patch({ model: event.target.value })}>{choices.map((choice) => <option value={choice.value} key={choice.value}>{choice.label}</option>)}</select>
        <button className={controlClass} aria-label="生成设置" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)}><Settings2 size={14} /></button>
        <select className={controlClass} aria-label="生成副本数量" value={media.copies || 1} onChange={(event) => patch({ copies: Number(event.target.value) })}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 份</option>)}</select>
      </div>
      {settingsOpen && <div className="workflow-card__settings">
        <label>比例<select className={controlClass} value={media.ratio || "16:9"} onChange={(event) => patch({ ratio: event.target.value })}>{["1:1", "16:9", "9:16", "4:3", "3:4"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>清晰度<select className={controlClass} value={media.resolution || "1080P"} onChange={(event) => patch({ resolution: event.target.value })}>{(isVideo ? ["480P", "720P", "1080P", "2K", "4K"] : ["1K", "2K", "4K"]).map((value) => <option key={value}>{value}</option>)}</select></label>
        {isVideo ? <><label>时长（秒）<input className={controlClass} type="number" min="1" max="60" value={media.durationSec ?? media.duration ?? 5} onChange={(event) => patch({ durationSec: Number(event.target.value) })} /></label><label className="workflow-card__check"><input type="checkbox" checked={media.audio !== false} onChange={(event) => patch({ audio: event.target.checked })} />生成音效</label></>
          : <label>质量<select className={controlClass} value={media.quality || "高"} onChange={(event) => patch({ quality: event.target.value })}>{["低", "中", "高"].map((value) => <option key={value}>{value}</option>)}</select></label>}
      </div>}
      <div className="workflow-card__action-row"><span><Zap size={13} />{runtime.creditCost != null ? `实际 ${runtime.creditCost}` : `预计 ${estimate}`} 积分</span><button className={`${controlClass} workflow-card__primary`} disabled={view.actionDisabled} onClick={() => execute(id)}><WandSparkles size={13} />{view.actionLabel}</button></div>
    </div>
  </NodeCard>;
}
