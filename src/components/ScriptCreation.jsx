import {
  BookOpen, Check, ChevronRight, ClipboardCheck, Copy, FileText, History, Paperclip,
  PenLine, Save, Search, Send, Sparkles, WandSparkles, Brain, Film,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  createDramaFromScript,
  completeScriptTask,
  createScriptTask,
  continueScriptTask,
  deleteScriptTask,
  fetchScriptModels,
  fetchScriptTask,
  fetchScriptTasks,
  generateScriptTask,
  repairScriptStructure,
  saveScriptDocument,
  streamScriptChat,
  updateScriptModel,
  updateScriptTitle,
} from "../api/script.js";

const modes = [
  { id: "idea", title: "灵感起草", description: "从一句创意梳理人物、冲突和分集故事。", icon: Sparkles, placeholder: "例如：失踪七年的姐姐突然寄来一封没有日期的信……" },
  { id: "adapt", title: "小说改编", description: "识别对白、旁白、场景转换，重构成短剧。", icon: BookOpen, placeholder: "粘贴小说、故事或上传 TXT，说明希望的集数和节奏。" },
  { id: "review", title: "剧本评估", description: "从人物弧光、钩子、爽点和商业价值诊断剧本。", icon: ClipboardCheck, placeholder: "粘贴现有剧本，或说明你希望重点评估的部分。" },
];

const genres = ["重生逆袭", "豪门复仇", "悬疑反转", "年代情感", "霸总甜虐", "汽车剧情", "互动剧"];
const draftFallback = "在这里编辑你的故事底稿。生成完成后，光驭精灵会把结构化结果同步到正文编辑器。";

function AssistantMark() {
  return <span className="script-assistant-mark"><WandSparkles size={17} /></span>;
}

function modeOf(id) {
  return modes.find((item) => item.id === id) || modes[0];
}

function compactSubmission(mode, text, novelSource, attachments) {
  const names = [novelSource?.name, ...attachments.map((item) => item.name)].filter(Boolean);
  const files = names.length ? `\n已挂载素材：${names.join("、")}` : "";
  if (mode === "adapt" && novelSource) {
    return `已提交小说改编任务：${novelSource.name}（原文已作为任务素材保存）${text ? `\n改编要求：${text}` : ""}${files}`;
  }
  if (mode === "review") {
    return `已提交剧本评估任务${text ? `：${text.slice(0, 240)}${text.length > 240 ? "…" : ""}` : ""}${files}`;
  }
  return `${text.slice(0, 240)}${text.length > 240 ? "…" : ""}${files}`;
}

function messageText(task, message) {
  if (message.content) return message.content;
  if (task?.document) return task.document;
  return "生成完成，请查看右侧剧本正文。";
}

function MarkdownText({ children }) {
  return <div className="script-markdown">{String(children || "").split(/\n{2,}/).map((block, index) => {
    const lines = block.split("\n");
    return <p key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{line}{lineIndex < lines.length - 1 && <br />}</span>)}</p>;
  })}</div>;
}

const documentTabs = [
  { id: "script", label: "剧本正文" },
  { id: "setting", label: "故事设定" },
  { id: "characters", label: "人物设定" },
  { id: "outline", label: "分集大纲" },
];
const reviewTabs = [{ id: "evaluation", label: "评估报告" }];

function tabsForTask(task) {
  return task?.mode === "review" ? reviewTabs : documentTabs;
}

function evaluationDimensions(evaluation) {
  if (Array.isArray(evaluation?.dimensions) && evaluation.dimensions.length) return evaluation.dimensions;
  return [
    ["character_arc", "人物弧光"],
    ["hook", "黄金三秒钩子"],
    ["emotion", "情绪爽点"],
    ["commercial", "商业价值"],
  ].filter(([key]) => evaluation?.[key] !== undefined).map(([key, name]) => ({ key, name, score: evaluation[key] }));
}

function EvaluationDocument({ task }) {
  const evaluation = task?.result?.evaluation || {};
  const dimensions = evaluationDimensions(evaluation);
  const list = (value) => Array.isArray(value) ? value : value ? [value] : [];
  return <div className="script-evaluation">
    <div className="script-evaluation__summary"><span>综合评分</span><strong>{evaluation.overall_score ?? "--"}</strong><small>/ 100</small><p>{evaluation.summary || "暂无评估摘要"}</p></div>
    <div className="script-evaluation__dimensions">{dimensions.map((item, index) => <article key={item.key || index}><header><strong>{item.name || "评估维度"}</strong><b>{item.score ?? "--"}<small>/100</small></b></header><p>{item.comment || "暂无维度分析"}</p>{list(item.suggestions).length > 0 && <ul>{list(item.suggestions).map((suggestion, suggestionIndex) => <li key={suggestionIndex}>{suggestion}</li>)}</ul>}</article>)}</div>
    {(list(evaluation.strengths).length > 0 || list(evaluation.risks).length > 0 || list(evaluation.priority_strategy).length > 0) && <div className="script-evaluation__lists"><section><h4>优势</h4>{list(evaluation.strengths).map((item, index) => <p key={index}>• {item}</p>)}</section><section><h4>风险</h4>{list(evaluation.risks).map((item, index) => <p key={index}>• {item}</p>)}</section><section><h4>优先修改策略</h4>{list(evaluation.priority_strategy).map((item, index) => <p key={index}>{index + 1}. {item}</p>)}</section></div>}
  </div>;
}

function plainResultText(task, tab) {
  const result = task?.result || {};
  if (tab === "evaluation") {
    const evaluation = result.evaluation || {};
    const dimensions = evaluationDimensions(evaluation);
    return [
      `综合评分：${evaluation.overall_score ?? "暂无"} / 100`,
      evaluation.summary,
      ...dimensions.map((item) => `${item.name || "评估维度"}：${item.score ?? "暂无"}分\n${item.comment || ""}`),
      ...(Array.isArray(evaluation.priority_strategy) ? ["优先修改策略：", ...evaluation.priority_strategy.map((item, index) => `${index + 1}. ${item}`)] : []),
    ].filter(Boolean).join("\n\n");
  }
  if (tab === "script") return task?.document || "";
  if (tab === "setting") {
    return [
      result.title || task?.title,
      result.logline && `一句话故事：${result.logline}`,
      task?.genre && `题材：${task.genre}`,
      task?.targetEpisodes && `目标集数：${task.targetEpisodes} 集`,
    ].filter(Boolean).join("\n");
  }
  if (tab === "characters") {
    return (Array.isArray(result.characters) ? result.characters : []).map((item, index) =>
      `${index + 1}. ${item.name || "未命名人物"}｜${item.role || "角色"}\n人物弧光：${item.arc || "暂无"}`
    ).join("\n\n");
  }
  if (tab === "outline") {
    return (Array.isArray(result.outline) ? result.outline : []).map((item) =>
      `第${item.episode || ""}集 ${item.title || "未命名"}\n${item.summary || "暂无剧情摘要"}\n结尾钩子：${item.hook || "暂无"}`
    ).join("\n\n");
  }
  return "";
}

function StructuredDocument({ task, tab, readOnly = false, value, onChange, onRepair, repairing = false }) {
  if (tab === "evaluation") return <EvaluationDocument task={task} />;
  if (tab === "script") {
    if (readOnly) return <pre className="script-document-readonly">{value || draftFallback}</pre>;
    return <textarea aria-label="剧本正文" value={value || ""} onChange={onChange} />;
  }
  const result = task?.result || {};
  if (tab === "setting") {
    return <div className="script-structured-content"><h3>{result.title || task?.title || "未命名剧本"}</h3><p>{result.logline || "暂无一句话故事"}</p><dl><div><dt>题材</dt><dd>{task?.genre || "自动判断"}</dd></div><div><dt>目标集数</dt><dd>{task?.targetEpisodes || 6} 集</dd></div></dl></div>;
  }
  if (tab === "characters") {
    const characters = Array.isArray(result.characters) ? result.characters : [];
    return <div className="script-structured-list">{characters.length ? characters.map((item, index) => <article key={`${item.name || "character"}-${index}`}><strong>{item.name || "未命名人物"}</strong><span>{item.role || "角色"}</span><p>{item.arc || "暂无人物弧光"}</p></article>) : <div className="script-structured-empty"><p>暂无人物设定</p>{!readOnly && <button type="button" onClick={onRepair} disabled={repairing}>{repairing ? "AI补全中…" : "AI补全人物设定"}</button>}</div>}</div>;
  }
  const outline = Array.isArray(result.outline) ? result.outline : [];
  return <div className="script-structured-list script-outline-list">{outline.length ? outline.map((item, index) => <article key={`${item.episode || index}-${item.title || "episode"}`}><strong>第{item.episode || index + 1}集 · {item.title || "未命名"}</strong><p>{item.summary || "暂无剧情摘要"}</p><small>结尾钩子：{item.hook || "暂无"}</small></article>) : <div className="script-structured-empty"><p>暂无分集大纲</p>{!readOnly && <button type="button" onClick={onRepair} disabled={repairing}>{repairing ? "AI补全中…" : "AI补全分集大纲"}</button>}</div>}</div>;
}

function EditableTaskTitle({ title, editing, draft, saving, onStart, onChange, onSave, onCancel }) {
  if (editing) {
    return <div className="script-title-editor"><input autoFocus aria-label="剧本名称" value={draft} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSave(); if (event.key === "Escape") onCancel(); }} /><button type="button" onClick={onSave} disabled={saving}>{saving ? "保存中" : "保存"}</button><button type="button" onClick={onCancel} disabled={saving}>取消</button></div>;
  }
  return <div className="script-title-display"><strong>{title || "未命名剧本"}</strong><button type="button" onClick={onStart}>编辑名称</button></div>;
}

async function copyText(value) {
  const content = String(value || "");
  if (!content) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      // Permission denied or an insecure context: continue with the legacy fallback.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

function ScriptSidebar({ page, onPage, onNew, tasks, activeTaskId, onOpen, query, setQuery }) {
  const recent = tasks.slice(0, 7);
  return <aside className="script-history">
    <button className="script-new" type="button" onClick={onNew}><span aria-hidden="true">＋</span><span>新建任务</span></button>
    <button className={`script-library-entry ${page === "scripts" ? "active" : ""}`} type="button" onClick={() => onPage("scripts")}><BookOpen size={16} /> 我的剧本 <span>{tasks.length}</span></button>
    <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索创作记录" /></label>
    <span className="script-history__label"><History size={13} /> 最近创作</span>
    <div>{recent.map((item) => <button type="button" className={page === "create" && activeTaskId === item.id ? "active" : ""} onClick={() => onOpen(item.id)} key={item.id}><FileText size={15} /><span><strong>{item.title}</strong><small>{modeOf(item.mode).title} · {formatTime(item.updatedAt)}</small></span></button>)}</div>
    {!recent.length && <p className="script-history__empty">还没有创作记录</p>}
  </aside>;
}

function ScriptLibrary({ tasks, onNew, onOpen, onPreview, onConvert, onDelete }) {
  const [filter, setFilter] = useState("all");
  const inProgress = tasks.filter((item) => item.status === "RUNNING" || item.status === "DRAFT");
  const completed = tasks.filter((item) => item.status === "SUCCEEDED");
  const visibleTasks = filter === "progress" ? inProgress : filter === "completed" ? completed : tasks;
  const filters = [
    { id: "all", label: "全部", count: tasks.length },
    { id: "progress", label: "创作中", count: inProgress.length },
    { id: "completed", label: "已完成", count: completed.length },
  ];
  return <section className="script-library">
    <header><div><h1>我的剧本</h1><p>管理光驭精灵生成、改编和评估的剧本任务</p></div><button type="button" onClick={onNew}><span aria-hidden="true">＋</span><span>新建任务</span></button></header>
    <div className="script-library__filters" role="tablist" aria-label="剧本状态筛选">{filters.map((item) => <button type="button" role="tab" aria-selected={filter === item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)} key={item.id}>{item.label} {item.count}</button>)}</div>
    {!tasks.length ? <div className="script-library__empty"><FileText size={30} /><strong>还没有剧本任务</strong><p>从一个灵感、一个 TXT 小说或一份现有剧本开始。</p><button type="button" onClick={onNew}>开始创作</button></div> : !visibleTasks.length ? <div className="script-library__empty"><FileText size={30} /><strong>暂无符合条件的剧本</strong><p>切换其他状态筛选查看全部任务。</p><button type="button" onClick={() => setFilter("all")}>查看全部</button></div> : <div className="script-library__grid">{visibleTasks.map((item) => <article key={item.id}>
      <div className="script-library__cover"><span>{modeOf(item.mode).title}</span><FileText size={34} /></div>
      <div><span className={`script-status script-status--${String(item.status || "").toLowerCase()}`}>{statusLabel(item.status)}</span><h2>{item.title}</h2><p>{item.mode === "review" ? "仅评估报告" : `${item.genre || "未设置题材"} · 目标 ${item.targetEpisodes || 6} 集`}</p><footer><small>{formatTime(item.updatedAt)} 更新</small><div><button type="button" onClick={() => onPreview(item.id)}>{item.mode === "review" ? "查看报告" : "查看"}</button><button type="button" onClick={() => onOpen(item.id)}>继续创作</button>{item.mode !== "review" && (item.dramaSeriesId ? <button type="button" onClick={() => onConvert(item)}>进入短剧</button> : item.status === "SUCCEEDED" ? <button type="button" onClick={() => onConvert(item)}>创建短剧</button> : null)}<button type="button" className="script-delete" onClick={() => onDelete(item)}>删除</button></div></footer></div>
    </article>)}</div>}
  </section>;
}

function formatTime(value) {
  if (!value) return "刚刚";
  try { return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return "最近"; }
}

function statusLabel(status) {
  return ({ DRAFT: "草稿", RUNNING: "生成中", SUCCEEDED: "已完成", FAILED: "需重试" })[status] || "草稿";
}

function Message({ task, message, onInsert, onCopy, copied }) {
  const assistant = message.role === "assistant";
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const content = messageText(task, message);
  return <article className={`script-message script-message--${message.role}`}>
    {assistant ? <AssistantMark /> : <span className="script-user-mark">你</span>}
    <div><strong>{assistant ? "光驭精灵" : "你"}</strong>
      {assistant && message.thinkingProcess ? <div className="script-thinking-panel"><button type="button" onClick={() => setThinkingOpen((open) => !open)}><Brain size={14} /> Thinking Process <ChevronRight size={13} className={thinkingOpen ? "is-open" : ""} /></button>{thinkingOpen && <p>{message.thinkingProcess}</p>}</div> : null}
      {assistant ? <MarkdownText>{content}</MarkdownText> : <p>{content}</p>}
      {assistant && <div className="script-message-actions"><button type="button" className={copied ? "is-copied" : ""} onClick={() => onCopy(content)}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "已复制" : "复制"}</button>{task?.mode !== "review" && <button type="button" onClick={() => onInsert(content)}><PenLine size={13} /> 插入正文</button>}</div>}
    </div>
  </article>;
}

function ScriptPreview({ task, onBack, onOpen, onConvert }) {
  const [tab, setTab] = useState("script");
  const [copied, setCopied] = useState(false);
  const visibleTabs = tabsForTask(task);
  const canCreate = task?.mode !== "review" && task?.status === "SUCCEEDED" && Boolean(task?.document?.trim());
  useEffect(() => setTab(task?.mode === "review" ? "evaluation" : "script"), [task?.mode]);
  if (!task) return <section className="script-library script-library--preview"><p className="script-structured-empty">正在加载剧本…</p></section>;
  async function copyCurrent() {
    if (await copyText(plainResultText(task, tab))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  }
  return <section className="script-library script-library--preview">
    <header><div><button type="button" onClick={onBack}>返回我的剧本</button><span>只读预览 · {statusLabel(task.status)}</span><h1>{task.title}</h1><p>{task.mode === "review" ? "仅评估报告" : `${task.genre || "未设置题材"} · 目标 ${task.targetEpisodes || 6} 集`}</p></div><div className="script-preview-actions"><button type="button" onClick={() => onOpen(task.id)}>继续创作 <ChevronRight size={15} /></button>{task.mode !== "review" && (task.dramaSeriesId ? <button type="button" onClick={() => onConvert(task)}>进入短剧</button> : canCreate ? <button type="button" onClick={() => onConvert(task)}>创建短剧</button> : null)}</div></header>
    <div className="script-preview-body"><div className="script-outline script-preview-tabs">{visibleTabs.map((item) => <button type="button" className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)} key={item.id}>{item.label}</button>)}<button type="button" className={copied ? "is-copied" : ""} onClick={copyCurrent}>{copied ? <><Check size={13} /> 已复制</> : <><Copy size={13} /> 复制本页</>}</button></div><StructuredDocument task={task} tab={tab} readOnly value={task.document} /></div>
  </section>;
}

export function ScriptCreation() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState("create");
  const [mode, setMode] = useState("idea");
  const [prompt, setPrompt] = useState("");
  const [genre, setGenre] = useState("");
  const [episodes, setEpisodes] = useState(6);
  const [modelId, setModelId] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [novelSource, setNovelSource] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [query, setQuery] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(true);
  const [streamMessages, setStreamMessages] = useState([]);
  const [streamThinking, setStreamThinking] = useState("");
  const [streamText, setStreamText] = useState("");
  const [documentTab, setDocumentTab] = useState("script");
  const [copiedKey, setCopiedKey] = useState("");
  const [error, setError] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const uploadRef = useRef(null);
  const attachmentRef = useRef(null);
  const bodyRef = useRef(null);
  const activeTaskRef = useRef(null);
  const streamRequestRef = useRef(0);
  const copyTimerRef = useRef(null);

  const tasksQuery = useQuery({ queryKey: ["script-tasks", query], queryFn: () => fetchScriptTasks(query) });
  const modelsQuery = useQuery({ queryKey: ["script-models"], queryFn: fetchScriptModels });
  const taskQuery = useQuery({ queryKey: ["script-task", activeTaskId], queryFn: () => fetchScriptTask(activeTaskId), enabled: Boolean(activeTaskId) });
  const tasks = tasksQuery.data || [];
  const task = taskQuery.data && String(taskQuery.data.id) === String(activeTaskId) ? taskQuery.data : undefined;
  const textModels = modelsQuery.data || [];
  const activeMode = modeOf(task?.mode || mode);
  const ActiveModeIcon = activeMode.icon;
  const messages = [...(task?.messages || []), ...streamMessages];

  useEffect(() => {
    activeTaskRef.current = activeTaskId;
  }, [activeTaskId]);

  useEffect(() => () => {
    streamRequestRef.current += 1;
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    if (textModels.length && !modelId) setModelId(String(textModels[0].id));
  }, [textModels, modelId]);

  useEffect(() => {
    if (task?.modelId) setModelId(String(task.modelId));
  }, [task?.modelId]);

  useEffect(() => {
    if (task?.mode === "review") setDocumentTab("evaluation");
    if (task?.mode && task.mode !== "review" && documentTab === "evaluation") setDocumentTab("script");
  }, [task?.mode]);

  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTo({ top: bodyRef.current.scrollHeight, behavior: streaming ? "smooth" : "auto" });
  }, [messages.length, streamText, streamThinking, streaming]);

  const createMutation = useMutation({ mutationFn: createScriptTask });
  const generateMutation = useMutation({ mutationFn: generateScriptTask });
  const saveMutation = useMutation({ mutationFn: ({ id, document }) => saveScriptDocument(id, document) });
  const completeMutation = useMutation({ mutationFn: completeScriptTask });
  const continueMutation = useMutation({ mutationFn: continueScriptTask });
  const deleteMutation = useMutation({ mutationFn: deleteScriptTask });
  const structureMutation = useMutation({ mutationFn: repairScriptStructure });
  const modelMutation = useMutation({ mutationFn: ({ id, model }) => updateScriptModel(id, model) });
  const titleMutation = useMutation({ mutationFn: ({ id, title }) => updateScriptTitle(id, title) });
  const dramaMutation = useMutation({ mutationFn: createDramaFromScript });
  const generationPending = createMutation.isPending || generateMutation.isPending;
  const generationStatus = mode === "adapt"
    ? "光驭精灵正在整理小说、拆解章节冲突…"
    : mode === "review"
      ? "光驭精灵正在分析人物弧光、黄金三秒钩子与商业价值…"
      : "光驭精灵正在梳理创意、人物关系与剧情结构…";

  function reset() {
    streamRequestRef.current += 1;
    activeTaskRef.current = null;
    setPage("create"); setMode("idea"); setPrompt(""); setGenre(""); setEpisodes(6); setModelId(""); setAttachments([]); setNovelSource(null); setActiveTaskId(null); setStreaming(false); setStreamMessages([]); setStreamText(""); setStreamThinking(""); setDocumentTab("script"); setCopiedKey(""); setEditingTitle(false); setTitleDraft(""); setError("");
  }

  async function generate() {
    const text = prompt.trim();
    const sourceFile = mode === "adapt" || mode === "review" ? novelSource : null;
    if ((!text && !sourceFile?.content?.trim()) || generateMutation.isPending || createMutation.isPending || streaming) return;
    setError(""); setPrompt("");
    try {
      let id = activeTaskId;
      const displayRequest = compactSubmission(mode, text, sourceFile, attachments);
      setStreamMessages([{ role: "user", content: displayRequest }]);
      if (!id) {
        const references = attachments.map((item) => `\n\n【参考附件：${item.name}】\n${item.content}`).join("");
        const inputText = (sourceFile
          ? `${mode === "review" ? "评估要求" : "改编要求"}：${text || (mode === "review" ? "请评估这份剧本" : "请将上传小说改编为竖屏短剧")}\n\n【${mode === "review" ? "待评估剧本" : "小说原文"}：${sourceFile.name}】\n${sourceFile.content}${references}`
          : `${text}${references}`).slice(0, 200000);
        const attachmentNames = [...(sourceFile ? [sourceFile.name] : []), ...attachments.map((item) => item.name)];
        const created = await createMutation.mutateAsync({ mode, genre: mode === "review" ? undefined : genre, targetEpisodes: mode === "review" ? undefined : Number(episodes), modelId: modelId ? Number(modelId) : undefined, inputText, attachments: [...new Set(attachmentNames)] });
        id = created.id;
        setActiveTaskId(id);
      }
      const result = await generateMutation.mutateAsync(id);
      const serverMessages = Array.isArray(result.messages) ? result.messages : [];
      const hasSubmittedMessage = serverMessages.some((message) => message.role === "user");
      const visibleResult = hasSubmittedMessage ? result : { ...result, messages: [{ role: "user", content: displayRequest }, ...serverMessages] };
      queryClient.setQueryData(["script-task", id], visibleResult);
      setStreamMessages(hasSubmittedMessage ? [] : [{ role: "user", content: displayRequest }]);
      queryClient.invalidateQueries({ queryKey: ["script-tasks"] });
      setNovelSource(null); setAttachments([]);
    } catch (requestError) {
      setError(requestError.message || "生成失败，请检查文本模型配置");
    }
  }

  async function sendChat() {
    const text = prompt.trim();
    if (!text || streaming) return;
    if (!activeTaskId) { await generate(); return; }
    const taskId = activeTaskId;
    const requestId = ++streamRequestRef.current;
    const thinkingBuffer = { value: "" };
    const isCurrentRequest = () => activeTaskRef.current === taskId && streamRequestRef.current === requestId;
    setError(""); setPrompt(""); setStreaming(true); setStreamText(""); setStreamThinking("");
    setStreamMessages((current) => [...current, { role: "user", content: text }]);
    try {
      await streamScriptChat(taskId, { message: text, thinking }, {
        onEvent: ({ type, data }) => {
          if (!isCurrentRequest()) return;
          if (type === "thinking") {
            thinkingBuffer.value = `${thinkingBuffer.value}${thinkingBuffer.value ? "\n" : ""}${data.stage}：${data.detail}`;
            setStreamThinking(thinkingBuffer.value);
          }
          if (type === "delta") setStreamText((current) => current + (data.text || ""));
          if (type === "error") setError(data.message || "对话失败");
          if (type === "done") {
            setStreamMessages((current) => [...current, { role: "assistant", content: data.content || "", thinkingProcess: thinking ? thinkingBuffer.value : "" }]);
            setStreamText(""); setStreamThinking("");
          }
        },
      });
      const fresh = await queryClient.fetchQuery({ queryKey: ["script-task", taskId], queryFn: () => fetchScriptTask(taskId) });
      queryClient.setQueryData(["script-task", taskId], fresh);
      if (isCurrentRequest()) setStreamMessages([]);
    } catch (requestError) {
      if (isCurrentRequest()) setError(requestError.message || "对话失败，请检查模型配置");
    } finally {
      if (isCurrentRequest()) setStreaming(false);
    }
  }

  function openTask(id) {
    streamRequestRef.current += 1;
    activeTaskRef.current = id;
    setPage("create"); setActiveTaskId(id); setPrompt(""); setStreaming(false); setStreamMessages([]); setStreamText(""); setStreamThinking(""); setDocumentTab("script"); setCopiedKey(""); setError("");
  }

  function openPreview(id) {
    streamRequestRef.current += 1;
    activeTaskRef.current = id;
    setPage("preview"); setActiveTaskId(id); setPrompt(""); setStreaming(false); setStreamMessages([]); setStreamText(""); setStreamThinking(""); setDocumentTab("script"); setCopiedKey(""); setError("");
  }

  async function handleCopy(key, content) {
    const copied = await copyText(content);
    if (!copied) {
      setError("复制失败，请手动选择文本");
      return;
    }
    setCopiedKey(key);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedKey(""), 1400);
  }

  function insertIntoDocument(content) {
    const next = `${task?.document || draftFallback}\n\n${content}`;
    saveDocument(next);
  }

  function saveDocument(document = task?.document || "") {
    if (!activeTaskId) return;
    saveMutation.mutate({ id: activeTaskId, document }, {
      onSuccess: (saved) => {
        queryClient.setQueryData(["script-task", activeTaskId], saved);
        queryClient.invalidateQueries({ queryKey: ["script-tasks"] });
        setError("");
      },
      onError: (requestError) => setError(requestError.message || "保存剧本正文失败"),
    });
  }

  async function convertToDrama(item = task) {
    if (!item?.id) return;
    if (item.mode === "review") {
      setError("剧本评估任务只生成评估报告，不能创建短剧");
      return;
    }
    if (!item.dramaSeriesId && !item.document?.trim()) {
      setError("请先生成或填写剧本正文后再创建短剧");
      return;
    }
    if (!item.dramaSeriesId && item.status !== "SUCCEEDED") {
      setError("剧本已保存为草稿，请先点击“完成剧本”后再创建短剧");
      return;
    }
    try {
      const series = await dramaMutation.mutateAsync(item.id);
      navigate(`/console/drama/${series.id}`);
    } catch (requestError) {
      setError(requestError.message || "创建短剧工程失败");
    }
  }

  function completeTask() {
    if (task?.mode === "review") {
      setError("剧本评估任务不需要完成剧本");
      return;
    }
    if (!activeTaskId || !task?.document?.trim()) {
      setError("请先填写剧本正文");
      return;
    }
    completeMutation.mutate(activeTaskId, {
      onSuccess: (saved) => {
        queryClient.setQueryData(["script-task", activeTaskId], saved);
        queryClient.invalidateQueries({ queryKey: ["script-tasks"] });
      },
      onError: (requestError) => setError(requestError.message || "完成剧本失败"),
    });
  }

  function repairTaskStructure() {
    if (!activeTaskId) return;
    if (task?.mode === "review") {
      setError("剧本评估任务不需要补全剧本结构");
      return;
    }
    setError("");
    structureMutation.mutate(activeTaskId, {
      onSuccess: (saved) => {
        queryClient.setQueryData(["script-task", activeTaskId], saved);
        queryClient.invalidateQueries({ queryKey: ["script-tasks"] });
        setDocumentTab((current) => current === "script" ? "characters" : current);
      },
      onError: (requestError) => setError(requestError.message || "结构补全失败，请稍后重试"),
    });
  }

  function removeTask(item) {
    if (!item?.id || !window.confirm(`确认删除剧本“${item.title || "未命名剧本"}”？删除后不可恢复。`)) return;
    deleteMutation.mutate(item.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["script-tasks"] });
        if (String(activeTaskId) === String(item.id)) reset();
      },
      onError: (requestError) => setError(requestError.message || "删除剧本失败"),
    });
  }

  function continueEpisode() {
    if (!activeTaskId || continueMutation.isPending) return;
    if (task?.mode === "review") {
      setError("剧本评估任务不能续写下一集");
      return;
    }
    setError("");
    continueMutation.mutate(activeTaskId, {
      onSuccess: (saved) => {
        queryClient.setQueryData(["script-task", activeTaskId], saved);
        queryClient.invalidateQueries({ queryKey: ["script-tasks"] });
        setDocumentTab("script");
      },
      onError: (requestError) => setError(requestError.message || "续写下一集失败，请稍后重试"),
    });
  }

  function startTitleEdit() {
    setTitleDraft(task?.title || "");
    setEditingTitle(true);
  }

  function saveTitle() {
    const nextTitle = titleDraft.trim();
    if (!activeTaskId || !nextTitle) {
      setError("剧本名称不能为空");
      return;
    }
    titleMutation.mutate({ id: activeTaskId, title: nextTitle }, {
      onSuccess: (saved) => {
        queryClient.setQueryData(["script-task", activeTaskId], saved);
        queryClient.invalidateQueries({ queryKey: ["script-tasks"] });
        setEditingTitle(false);
      },
      onError: (requestError) => setError(requestError.message || "修改剧本名称失败"),
    });
  }

  async function onUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const uploadMode = mode === "review" ? "review" : "adapt";
      setMode(uploadMode); setNovelSource({ name: file.name, content: text, chars: text.length });
      if (uploadMode === "adapt") setGenre(genre || "小说改编");
    } catch { setError("无法读取附件，请改用 TXT 或直接粘贴文本"); }
    event.target.value = "";
  }

  async function onAttachment(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    try {
      const next = await Promise.all(files.map(async (file) => ({
        name: file.name,
        content: (await file.text()).slice(0, 50000),
      })));
      setAttachments((current) => [...current, ...next].slice(0, 5));
    } catch {
      setError("参考附件读取失败，请使用 TXT 或 Markdown 文本文件");
    }
    event.target.value = "";
  }

  function changeModel(value) {
    setModelId(value);
    if (!activeTaskId || !value) return;
    modelMutation.mutate({ id: activeTaskId, model: value }, {
      onSuccess: (saved) => queryClient.setQueryData(["script-task", activeTaskId], saved),
      onError: (requestError) => setError(requestError.message || "切换模型失败"),
    });
  }

  const welcome = !activeTaskId && !messages.length && !generationPending;
  const visibleDocumentTabs = tabsForTask(task);
  const documentCopyKey = task?.mode === "review" ? "evaluation" : "document";
  return <section className={`script-creation ${welcome ? "is-welcome" : "has-session"}`}>
    <ScriptSidebar page={page} onPage={setPage} onNew={reset} tasks={tasks} activeTaskId={activeTaskId} onOpen={openTask} query={query} setQuery={setQuery} />
    {page === "scripts" ? <ScriptLibrary tasks={tasks} onNew={reset} onOpen={openTask} onPreview={openPreview} onConvert={convertToDrama} onDelete={removeTask} /> : page === "preview" ? <ScriptPreview task={task} onBack={() => { setPage("scripts"); setActiveTaskId(null); }} onOpen={openTask} onConvert={convertToDrama} /> : <>
      <section className="script-chat">
        <header><div><AssistantMark /><span><strong>光驭精灵</strong><small>剧本创作助手 · 多轮上下文已开启</small></span></div><em><i /> {textModels.length ? "模型已就绪" : "等待文本模型配置"}</em></header>
        <div className={`script-chat__body ${messages.length || streaming || generationPending ? "has-messages" : ""}`} ref={bodyRef}>
          {welcome ? <div className="script-welcome">
            <AssistantMark />
            <h1>让光驭精灵陪你孵化下一部剧本</h1>
            <p>从灵感、小说到专业剧本格式，一次对话完成结构设计、改编和商业化评估。</p>
            <div className="script-mode-cards">{modes.map((item) => { const Icon = item.icon; return <button type="button" className={mode === item.id ? "active" : ""} key={item.id} onClick={() => setMode(item.id)}><span><Icon size={17} /></span><strong>{item.title}</strong><p>{item.description}</p><em>开始{item.title} <ChevronRight size={12} /></em></button>; })}</div>
            <div className="script-launch-composer">
              <div className="script-launch-tabs">{modes.map((item) => <button type="button" className={mode === item.id ? "active" : ""} onClick={() => setMode(item.id)} key={item.id}>{item.title}</button>)}</div>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleEnter(generate)} placeholder={mode === "adapt" && novelSource ? "补充改编要求，例如：压缩成 6 集、强化前三秒钩子…" : mode === "review" && novelSource ? "补充评估重点，例如：重点看前三集节奏和人物动机…" : activeMode.placeholder} />
              <div className="script-launch-options"><label>题材 <select value={genre} onChange={(event) => setGenre(event.target.value)} disabled={mode === "review"}><option value="">自动判断</option>{genres.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>{mode !== "review" && <label>目标集数 <input type="number" min="1" max="99" value={episodes} onChange={(event) => setEpisodes(event.target.value)} /></label>}<label>模型 <select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!textModels.length}><option value="">请选择模型</option>{textModels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
              <div className="script-launch-actions"><button type="button" onClick={() => uploadRef.current?.click()}><Paperclip size={15} /> {mode === "review" ? "上传 TXT 剧本" : "上传 TXT 小说"}</button><button type="button" onClick={() => attachmentRef.current?.click()}><Paperclip size={15} /> 挂载参考附件</button><input ref={attachmentRef} hidden multiple type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onAttachment} /><span>{novelSource ? `已上传${mode === "review" ? "剧本" : "小说"}：${novelSource.name}` : attachments.length ? `已挂载 ${attachments.length} 个参考附件` : (textModels.length ? "结构化输出 · 自动保存版本" : "请先在管理后台配置文本模型")}</span><button className="script-send" disabled={(!prompt.trim() && !novelSource?.content?.trim()) || generationPending} onClick={generate}><Send size={15} /> {generationPending ? "生成中" : mode === "review" ? "开始评估" : "开始生成"}</button></div>
              {novelSource && <div className="script-source-file"><FileText size={15} /><span><strong>{novelSource.name}</strong><small>{novelSource.chars} 字 · {mode === "review" ? "待评估剧本，提交后不会复制到聊天框" : "主改编素材，提交后不会复制到聊天框"}</small></span><button type="button" onClick={() => setNovelSource(null)} aria-label="移除上传素材">×</button></div>}
              {attachments.length > 0 && <div className="script-attachment-list">{attachments.map((item) => <button type="button" key={item.name} onClick={() => setAttachments((current) => current.filter((entry) => entry.name !== item.name))}>{item.name} ×</button>)}</div>}
            </div>
            <div className="script-genres"><span><Sparkles size={14} /> 热门题材：</span>{genres.map((item) => <button type="button" key={item} onClick={() => { setGenre(item); setPrompt(`请以“${item}”为核心题材，设计一部节奏紧凑、每集结尾有钩子的竖屏短剧。`); }}>{item}</button>)}</div>
          </div> : <div className="script-messages">{messages.map((message, index) => <Message key={`${message.id || "local"}-${index}`} task={task} message={message} onInsert={insertIntoDocument} onCopy={(content) => handleCopy(`message-${message.id || index}`, content)} copied={copiedKey === `message-${message.id || index}`} />)}{generationPending && <article className="script-message script-message--assistant"><AssistantMark /><div><strong>光驭精灵</strong><div className="script-thinking-panel is-streaming"><Brain size={14} /> {generationStatus}</div></div></article>}{streaming && <article className="script-message script-message--assistant"><AssistantMark /><div><strong>光驭精灵</strong><div className="script-thinking-panel is-streaming"><Brain size={14} /> {streamThinking || "光驭精灵正在整理中…"}</div><MarkdownText>{streamText || "正在组织答案…"}</MarkdownText></div></article>}</div>}
        </div>
        {!welcome && <footer className="script-composer"><div className="script-mode-chip"><ActiveModeIcon size={14} />{activeMode.title}</div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleEnter(sendChat)} placeholder="描述你的创意、改编要求或希望修改的内容…" /><div><button type="button" onClick={() => uploadRef.current?.click()}><Paperclip size={15} /> 上传小说或剧本</button><label className="script-model-select"><span>模型</span><select value={modelId} onChange={(event) => changeModel(event.target.value)} disabled={!textModels.length || modelMutation.isPending}><option value="">请选择模型</option>{textModels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="script-thinking-toggle"><input type="checkbox" checked={thinking} onChange={(event) => setThinking(event.target.checked)} /> 深度思考</label><span>Enter 发送 · Shift + Enter 换行</span><button className="script-send" disabled={!prompt.trim() || streaming} onClick={sendChat} aria-label="发送给光驭精灵"><Send size={16} /></button></div></footer>}
      </section>
      <aside className="script-document"><header><div><span>{task?.mode === "review" ? "剧本评估报告" : `故事底稿 · ${task?.version ? `v${task.version}` : "未保存"}`}</span>{task?.mode === "review" ? <strong>仅评估，不生成剧本</strong> : <EditableTaskTitle title={task?.title} editing={editingTitle} draft={titleDraft} saving={titleMutation.isPending} onStart={startTitleEdit} onChange={setTitleDraft} onSave={saveTitle} onCancel={() => setEditingTitle(false)} />}</div><div className="script-document-actions"><button type="button" className={copiedKey === documentCopyKey ? "is-copied" : ""} onClick={() => handleCopy(documentCopyKey, plainResultText(task, documentTab))}>{copiedKey === documentCopyKey ? <><Check size={14} /> 已复制</> : <><Copy size={14} /> {task?.mode === "review" ? "复制报告" : "复制"}</>}</button>{task?.mode !== "review" && <><button type="button" onClick={() => saveDocument()} disabled={saveMutation.isPending}><Save size={14} /> {saveMutation.isPending ? "保存中" : "保存"}</button>{task && task.status !== "SUCCEEDED" && <button type="button" onClick={completeTask} disabled={completeMutation.isPending || !task.document?.trim()}><Check size={14} /> {completeMutation.isPending ? "完成中" : "完成剧本"}</button>}{task && <button type="button" className="script-convert" disabled={dramaMutation.isPending || task.status !== "SUCCEEDED" || !task.document?.trim()} onClick={() => convertToDrama(task)}><Film size={14} /> {dramaMutation.isPending ? "创建中" : task.dramaSeriesId ? "进入短剧" : "创建短剧"}</button>}</>}</div></header><div className="script-outline">{visibleDocumentTabs.map((item) => <button type="button" className={documentTab === item.id ? "active" : ""} onClick={() => setDocumentTab(item.id)} key={item.id}>{item.label}</button>)}</div><StructuredDocument task={task} tab={documentTab} readOnly={task?.mode === "review"} value={task?.document || ""} onRepair={repairTaskStructure} repairing={structureMutation.isPending} onChange={(event) => { if (!task || task.mode === "review") return; queryClient.setQueryData(["script-task", activeTaskId], { ...task, document: event.target.value, status: task.status === "SUCCEEDED" ? "DRAFT" : task.status }); }} /><footer>{task?.mode === "review" ? <span>评估报告已完成</span> : <><span>{(task?.document || "").length} 字 · 自动版本 {task?.version || 0}</span><button type="button" onClick={continueEpisode} disabled={continueMutation.isPending || !task?.document?.trim()}>{continueMutation.isPending ? "续写中…" : "续写下一集"} <ChevronRight size={13} /></button></>}</footer></aside>
    </>}
    {error && <div className="script-toast" role="alert">{error}</div>}
    <input ref={uploadRef} hidden type="file" accept=".txt,text/plain" onChange={onUpload} />
  </section>;
}

function handleEnter(callback) {
  return (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); callback(); }
  };
}
