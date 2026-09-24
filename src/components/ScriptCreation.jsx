import {
  BookOpen, ChevronRight, ClipboardCheck, Copy, FileText, History, Paperclip,
  PenLine, Plus, Save, Search, Send, Sparkles, WandSparkles, Brain, Film,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  createDramaFromScript,
  createScriptTask,
  fetchScriptModels,
  fetchScriptTask,
  fetchScriptTasks,
  generateScriptTask,
  saveScriptDocument,
  streamScriptChat,
  updateScriptModel,
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

function ScriptSidebar({ page, onPage, onNew, tasks, activeTaskId, onOpen, query, setQuery }) {
  const recent = tasks.slice(0, 7);
  return <aside className="script-history">
    <button className="script-new" type="button" onClick={onNew}><Plus size={16} /> 新建任务</button>
    <button className={`script-library-entry ${page === "scripts" ? "active" : ""}`} type="button" onClick={() => onPage("scripts")}><BookOpen size={16} /> 我的剧本 <span>{tasks.length}</span></button>
    <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索创作记录" /></label>
    <span className="script-history__label"><History size={13} /> 最近创作</span>
    <div>{recent.map((item) => <button type="button" className={page === "create" && activeTaskId === item.id ? "active" : ""} onClick={() => onOpen(item.id)} key={item.id}><FileText size={15} /><span><strong>{item.title}</strong><small>{modeOf(item.mode).title} · {formatTime(item.updatedAt)}</small></span></button>)}</div>
    {!recent.length && <p className="script-history__empty">还没有创作记录</p>}
  </aside>;
}

function ScriptLibrary({ tasks, onNew, onOpen, onConvert }) {
  return <section className="script-library">
    <header><div><h1>我的剧本</h1><p>管理光驭精灵生成、改编和评估的剧本任务</p></div><button type="button" onClick={onNew}><Plus size={16} /> 新建任务</button></header>
    <div className="script-library__filters"><span>全部 {tasks.length}</span><span>创作中 {tasks.filter((item) => item.status === "RUNNING" || item.status === "DRAFT").length}</span><span>已完成 {tasks.filter((item) => item.status === "SUCCEEDED").length}</span></div>
    {!tasks.length ? <div className="script-library__empty"><FileText size={30} /><strong>还没有剧本任务</strong><p>从一个灵感、一个 TXT 小说或一份现有剧本开始。</p><button type="button" onClick={onNew}>开始创作</button></div> : <div className="script-library__grid">{tasks.map((item) => <article key={item.id}>
      <div className="script-library__cover"><span>{modeOf(item.mode).title}</span><FileText size={34} /></div>
      <div><span className={`script-status script-status--${String(item.status || "").toLowerCase()}`}>{statusLabel(item.status)}</span><h2>{item.title}</h2><p>{item.genre || "未设置题材"} · 目标 {item.targetEpisodes || 6} 集</p><footer><small>{formatTime(item.updatedAt)} 更新</small><div><button type="button" onClick={() => onOpen(item.id)}>继续创作</button>{item.dramaSeriesId ? <button type="button" onClick={() => onConvert(item)}>进入短剧</button> : null}</div></footer></div>
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

function Message({ task, message, onInsert }) {
  const assistant = message.role === "assistant";
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const content = messageText(task, message);
  return <article className={`script-message script-message--${message.role}`}>
    {assistant ? <AssistantMark /> : <span className="script-user-mark">你</span>}
    <div><strong>{assistant ? "光驭精灵" : "你"}</strong>
      {assistant && message.thinkingProcess ? <div className="script-thinking-panel"><button type="button" onClick={() => setThinkingOpen((open) => !open)}><Brain size={14} /> Thinking Process <ChevronRight size={13} className={thinkingOpen ? "is-open" : ""} /></button>{thinkingOpen && <p>{message.thinkingProcess}</p>}</div> : null}
      {assistant ? <MarkdownText>{content}</MarkdownText> : <p>{content}</p>}
      {assistant && <div className="script-message-actions"><button type="button" onClick={() => navigator.clipboard?.writeText(content)}><Copy size={13} /> 复制</button><button type="button" onClick={() => onInsert(content)}><PenLine size={13} /> 插入正文</button></div>}
    </div>
  </article>;
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
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [query, setQuery] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(true);
  const [streamMessages, setStreamMessages] = useState([]);
  const [streamThinking, setStreamThinking] = useState("");
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");
  const uploadRef = useRef(null);
  const attachmentRef = useRef(null);
  const bodyRef = useRef(null);

  const tasksQuery = useQuery({ queryKey: ["script-tasks", query], queryFn: () => fetchScriptTasks(query) });
  const modelsQuery = useQuery({ queryKey: ["script-models"], queryFn: fetchScriptModels });
  const taskQuery = useQuery({ queryKey: ["script-task", activeTaskId], queryFn: () => fetchScriptTask(activeTaskId), enabled: Boolean(activeTaskId) });
  const tasks = tasksQuery.data || [];
  const task = taskQuery.data;
  const textModels = modelsQuery.data || [];
  const activeMode = modeOf(task?.mode || mode);
  const ActiveModeIcon = activeMode.icon;
  const messages = [...(task?.messages || []), ...streamMessages];

  useEffect(() => {
    if (textModels.length && !modelId) setModelId(String(textModels[0].id));
  }, [textModels, modelId]);

  useEffect(() => {
    if (task?.modelId) setModelId(String(task.modelId));
  }, [task?.modelId]);

  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTo({ top: bodyRef.current.scrollHeight, behavior: streaming ? "smooth" : "auto" });
  }, [messages.length, streamText, streamThinking, streaming]);

  const createMutation = useMutation({ mutationFn: createScriptTask });
  const generateMutation = useMutation({ mutationFn: generateScriptTask });
  const saveMutation = useMutation({ mutationFn: ({ id, document }) => saveScriptDocument(id, document) });
  const modelMutation = useMutation({ mutationFn: ({ id, model }) => updateScriptModel(id, model) });
  const dramaMutation = useMutation({ mutationFn: createDramaFromScript });

  function reset() {
    setPage("create"); setMode("idea"); setPrompt(""); setGenre(""); setEpisodes(6); setModelId(""); setAttachments([]); setActiveTaskId(null); setStreamMessages([]); setStreamText(""); setStreamThinking(""); setError("");
  }

  async function generate() {
    const text = prompt.trim();
    if (!text || generateMutation.isPending || streaming) return;
    setError("");
    try {
      let id = activeTaskId;
      if (!id) {
        const references = attachments.map((item) => `\n\n【参考附件：${item.name}】\n${item.content}`).join("");
        const inputText = `${text}${references}`.slice(0, 200000);
        const created = await createMutation.mutateAsync({ title: text.slice(0, 24), mode, genre, targetEpisodes: Number(episodes), modelId: modelId ? Number(modelId) : undefined, inputText, attachments: attachments.map((item) => item.name) });
        id = created.id;
        setActiveTaskId(id);
      }
      const result = await generateMutation.mutateAsync(id);
      queryClient.setQueryData(["script-task", id], result);
      queryClient.invalidateQueries({ queryKey: ["script-tasks"] });
      setPrompt("");
    } catch (requestError) {
      setError(requestError.message || "生成失败，请检查文本模型配置");
    }
  }

  async function sendChat() {
    const text = prompt.trim();
    if (!text || streaming) return;
    if (!activeTaskId) { await generate(); return; }
    setError(""); setPrompt(""); setStreaming(true); setStreamText(""); setStreamThinking("");
    setStreamMessages((current) => [...current, { role: "user", content: text }]);
    try {
      await streamScriptChat(activeTaskId, { message: text, thinking }, {
        onEvent: ({ type, data }) => {
          if (type === "thinking") setStreamThinking((current) => `${current}${current ? "\n" : ""}${data.stage}：${data.detail}`);
          if (type === "delta") setStreamText((current) => current + (data.text || ""));
          if (type === "error") setError(data.message || "对话失败");
          if (type === "done") {
            setStreamMessages((current) => [...current, { role: "assistant", content: data.content || "", thinkingProcess: thinking ? streamThinking : "" }]);
            setStreamText(""); setStreamThinking("");
          }
        },
      });
      const fresh = await queryClient.fetchQuery({ queryKey: ["script-task", activeTaskId], queryFn: () => fetchScriptTask(activeTaskId) });
      queryClient.setQueryData(["script-task", activeTaskId], fresh);
      setStreamMessages([]);
    } catch (requestError) {
      setError(requestError.message || "对话失败，请检查模型配置");
    } finally {
      setStreaming(false);
    }
  }

  function openTask(id) {
    setPage("create"); setActiveTaskId(id); setStreamMessages([]); setError("");
  }

  function insertIntoDocument(content) {
    const next = `${task?.document || draftFallback}\n\n${content}`;
    if (activeTaskId) saveMutation.mutate({ id: activeTaskId, document: next }, { onSuccess: (saved) => queryClient.setQueryData(["script-task", activeTaskId], saved) });
  }

  async function convertToDrama(item = task) {
    if (!item?.id) return;
    try {
      const series = await dramaMutation.mutateAsync(item.id);
      navigate(`/console/drama/${series.id}`);
    } catch (requestError) {
      setError(requestError.message || "创建短剧工程失败");
    }
  }

  async function onUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setMode("adapt"); setPrompt(text); setGenre(genre || "小说改编");
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

  const welcome = !activeTaskId && !messages.length;
  return <section className={`script-creation ${welcome ? "is-welcome" : "has-session"}`}>
    <ScriptSidebar page={page} onPage={setPage} onNew={reset} tasks={tasks} activeTaskId={activeTaskId} onOpen={openTask} query={query} setQuery={setQuery} />
    {page === "scripts" ? <ScriptLibrary tasks={tasks} onNew={reset} onOpen={openTask} onConvert={convertToDrama} /> : <>
      <section className="script-chat">
        <header><div><AssistantMark /><span><strong>光驭精灵</strong><small>剧本创作助手 · 多轮上下文已开启</small></span></div><em><i /> {textModels.length ? "模型已就绪" : "等待文本模型配置"}</em></header>
        <div className={`script-chat__body ${messages.length || streaming ? "has-messages" : ""}`} ref={bodyRef}>
          {welcome ? <div className="script-welcome">
            <AssistantMark />
            <h1>让光驭精灵陪你孵化下一部剧本</h1>
            <p>从灵感、小说到专业剧本格式，一次对话完成结构设计、改编和商业化评估。</p>
            <div className="script-mode-cards">{modes.map((item) => { const Icon = item.icon; return <button type="button" className={mode === item.id ? "active" : ""} key={item.id} onClick={() => setMode(item.id)}><span><Icon size={17} /></span><strong>{item.title}</strong><p>{item.description}</p><em>开始{item.title} <ChevronRight size={12} /></em></button>; })}</div>
            <div className="script-launch-composer">
              <div className="script-launch-tabs">{modes.map((item) => <button type="button" className={mode === item.id ? "active" : ""} onClick={() => setMode(item.id)} key={item.id}>{item.title}</button>)}</div>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleEnter(generate)} placeholder={activeMode.placeholder} />
              <div className="script-launch-options"><label>题材 <select value={genre} onChange={(event) => setGenre(event.target.value)}><option value="">自动判断</option>{genres.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>目标集数 <input type="number" min="1" max="99" value={episodes} onChange={(event) => setEpisodes(event.target.value)} /></label><label>模型 <select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!textModels.length}><option value="">请选择模型</option>{textModels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
              <div className="script-launch-actions"><button type="button" onClick={() => uploadRef.current?.click()}><Paperclip size={15} /> 上传 TXT 小说</button><button type="button" onClick={() => attachmentRef.current?.click()}><Paperclip size={15} /> 挂载参考附件</button><input ref={attachmentRef} hidden multiple type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onAttachment} /><span>{attachments.length ? `已挂载 ${attachments.length} 个参考附件` : (textModels.length ? "结构化输出 · 自动保存版本" : "请先在管理后台配置文本模型")}</span><button className="script-send" disabled={!prompt.trim() || generateMutation.isPending} onClick={generate}><Send size={15} /> {generateMutation.isPending ? "生成中" : "开始生成"}</button></div>
              {attachments.length > 0 && <div className="script-attachment-list">{attachments.map((item) => <button type="button" key={item.name} onClick={() => setAttachments((current) => current.filter((entry) => entry.name !== item.name))}>{item.name} ×</button>)}</div>}
            </div>
            <div className="script-genres"><span><Sparkles size={14} /> 热门题材：</span>{genres.map((item) => <button type="button" key={item} onClick={() => { setGenre(item); setPrompt(`请以“${item}”为核心题材，设计一部节奏紧凑、每集结尾有钩子的竖屏短剧。`); }}>{item}</button>)}</div>
          </div> : <div className="script-messages">{messages.map((message, index) => <Message key={`${message.id || "local"}-${index}`} task={task} message={message} onInsert={insertIntoDocument} />)}{streaming && <article className="script-message script-message--assistant"><AssistantMark /><div><strong>光驭精灵</strong>{streamThinking && <div className="script-thinking-panel is-streaming"><Brain size={14} /> {streamThinking}</div>}<MarkdownText>{streamText || "正在组织答案…"}</MarkdownText></div></article>}</div>}
        </div>
        {!welcome && <footer className="script-composer"><div className="script-mode-chip"><ActiveModeIcon size={14} />{activeMode.title}</div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleEnter(sendChat)} placeholder="描述你的创意、改编要求或希望修改的内容…" /><div><button type="button" onClick={() => uploadRef.current?.click()}><Paperclip size={15} /> 上传小说或剧本</button><label className="script-model-select"><span>模型</span><select value={modelId} onChange={(event) => changeModel(event.target.value)} disabled={!textModels.length || modelMutation.isPending}><option value="">请选择模型</option>{textModels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="script-thinking-toggle"><input type="checkbox" checked={thinking} onChange={(event) => setThinking(event.target.checked)} /> 深度思考</label><span>Enter 发送 · Shift + Enter 换行</span><button className="script-send" disabled={!prompt.trim() || streaming} onClick={sendChat} aria-label="发送给光驭精灵"><Send size={16} /></button></div></footer>}
      </section>
      <aside className="script-document"><header><div><span>故事底稿 · {task?.version ? `v${task.version}` : "未保存"}</span><strong>{task?.title || "新剧本"}</strong></div><div className="script-document-actions"><button type="button" onClick={() => activeTaskId && saveMutation.mutate({ id: activeTaskId, document: task?.document || "" })}><Save size={14} /> {saveMutation.isPending ? "保存中" : "保存"}</button>{task && <button type="button" className="script-convert" onClick={() => convertToDrama(task)}><Film size={14} /> 创建短剧</button>}</div></header><div className="script-outline"><button type="button" className="active">剧本正文</button><button type="button">故事设定</button><button type="button">人物小传</button><button type="button">分集大纲</button></div><textarea aria-label="剧本正文" value={task?.document || draftFallback} onChange={(event) => { if (!task) return; queryClient.setQueryData(["script-task", activeTaskId], { ...task, document: event.target.value }); }} /><footer><span>{(task?.document || "").length} 字 · 自动版本 {task?.version || 0}</span><button type="button" onClick={() => { setPrompt("请根据当前故事底稿续写下一集，并保持每集结尾有明确动作钩子。"); }}>续写下一集 <ChevronRight size={13} /></button></footer></aside>
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
