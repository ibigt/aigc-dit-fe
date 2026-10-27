import { MessageSquareText } from "lucide-react";
import { nodeViewModel } from "./nodeViewModel.js";
import { NodeCard, controlClass, stopNodePointer } from "./NodeCardParts.jsx";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";

export default function PromptNode({ id, data, selected }) {
  const { updatePrompt, getVariableScopes } = useWorkflowNode();
  const media = { prompt: data.prompt || data.fields?.[0]?.value || "", variables: data.variables || {}, ...data.media, scopes: getVariableScopes(id) };
  const view = nodeViewModel("Prompt", media, data.runtime);
  const patch = (change) => updatePrompt(id, change);
  return <NodeCard data={data} selected={selected} kind="prompt" view={view} icon={MessageSquareText} footer="提示词">
    <div className="workflow-card__body" onPointerDown={stopNodePointer}>
      <label className="workflow-card__label" htmlFor={`prompt-${id}`}>提示词模板</label>
      <textarea id={`prompt-${id}`} className={controlClass} value={media.prompt || ""} onChange={(event) => patch({ prompt: event.target.value })} placeholder="输入提示词，使用 {{变量名}} 插入变量" rows={5} />
      {view.placeholders.length > 0 && <div className="workflow-card__chips" aria-label="检测到的变量">{view.placeholders.map((name) => <span key={name}>{`{{${name}}}`}</span>)}</div>}
      {view.placeholders.map((name) => <label className="workflow-card__variable" key={name}><span>{name}</span><input className={controlClass} value={media.variables?.[name] || ""} onChange={(event) => patch({ variables: { ...(media.variables || {}), [name]: event.target.value } })} placeholder="变量值" /></label>)}
      {view.missing.length > 0 && <p className="workflow-card__notice">缺少变量：{view.missing.join("、")}</p>}
      {view.conflicts.length > 0 && <p className="workflow-card__notice workflow-card__notice--error">变量冲突：{view.conflicts.join("、")}</p>}
    </div>
  </NodeCard>;
}
