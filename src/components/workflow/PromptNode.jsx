import { useState } from "react";
import { MessageSquareText, SlidersHorizontal } from "lucide-react";
import { nodeViewModel } from "./nodeViewModel.js";
import { NodeCard, controlClass, stopNodePointer } from "./NodeCardParts.jsx";
import StableTextarea from "./StableTextarea.jsx";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";

// 提示词字数上限（需求 4.2.2.1）：与 JSON 协议示例中的 maxLength 保持一致
const MAX_LENGTH = 4000;

export default function PromptNode({ id, data, selected }) {
  const { updatePrompt, getVariableScopes } = useWorkflowNode();
  const [varsOpen, setVarsOpen] = useState(false);
  const media = { prompt: data.prompt || data.fields?.[0]?.value || "", variables: data.variables || {}, ...data.media, scopes: getVariableScopes(id) };
  const view = nodeViewModel("Prompt", media, data.runtime);
  const patch = (change) => updatePrompt(id, change);
  const length = String(media.prompt || "").length;
  const maxLength = Number(data.maxLength) > 0 ? Number(data.maxLength) : MAX_LENGTH;
  const overLimit = length > maxLength;
  return <NodeCard id={id} data={data} selected={selected} kind="prompt" view={view} icon={MessageSquareText} footer="提示词">
    <div className="workflow-card__body" onPointerDown={stopNodePointer}>
      <label className="workflow-card__label" htmlFor={`prompt-${id}`}>提示词模板</label>
      <StableTextarea id={`prompt-${id}`} className={controlClass} value={media.prompt || ""} onChange={(value) => patch({ prompt: value })} placeholder="输入提示词，使用 {{变量名}} 插入变量" rows={3} />
      <div className="workflow-card__counter" aria-live="polite"><span className={overLimit ? "is-over" : ""}>{length} / {maxLength} 字</span></div>
      {view.placeholders.length > 0 && <button type="button" className="workflow-card__meta" aria-expanded={varsOpen} onClick={() => setVarsOpen((value) => !value)}><span>{view.placeholders.length} 个变量：{view.placeholders.map((name) => `{{${name}}}`).join(" ")}</span><SlidersHorizontal size={12} /></button>}
      {view.placeholders.length > 0 && varsOpen && <div className="workflow-card__settings workflow-card__settings--panel">
        {view.placeholders.map((name) => <label className="workflow-card__settings--full" key={name}><span>{name}</span><input className={controlClass} value={media.variables?.[name] || ""} onChange={(event) => patch({ variables: { ...(media.variables || {}), [name]: event.target.value } })} placeholder="变量值" /></label>)}
      </div>}
      {overLimit && <p className="workflow-card__notice workflow-card__notice--error" role="alert">提示词超出 {maxLength} 字上限，请精简后再执行。</p>}
      {view.missing.length > 0 && <p className="workflow-card__notice">缺少变量：{view.missing.join("、")}</p>}
      {view.conflicts.length > 0 && <p className="workflow-card__notice workflow-card__notice--error">变量冲突或循环引用：{view.conflicts.join("、")}</p>}
    </div>
  </NodeCard>;
}
