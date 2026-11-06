import { Check, FileJson, Film, Image, LayoutGrid, Music2, Search, Upload, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { listWorkflowTemplates } from "../api/workflows.js";
import { parseImportedFileText } from "./workflow/serializer.js";
import { WorksTypeIcon } from "./WorksTypeIcon.jsx";

const thumbnailTones = {
  rose: "#c86f83",
  yellow: "#c5a246",
  pink: "#bb6cae",
  violet: "#806bc5",
  red: "#c36d68",
  blue: "#557fb8",
  green: "#51977a",
  amber: "#d08a3c",
  gray: "#8b939d",
};

const CATEGORIES = [
  { id: "all", label: "推荐" },
  { id: "video", label: "视频", Icon: Film },
  { id: "image", label: "图像", Icon: Image },
  { id: "audio", label: "音频", Icon: Music2 },
];

// 节点拓扑缩略图：用后端下发的坐标直接画 SVG，避免加载完整画布（需求 4.3.1.4 / 4.3.2.2）
function TopologyThumbnail({ topology, cover }) {
  const nodes = Array.isArray(topology?.nodes) ? topology.nodes : [];
  const edges = Array.isArray(topology?.edges) ? topology.edges : [];
  if (!nodes.length) {
    return cover ? <img className="template-card__cover" src={cover} alt="" /> : <div className="template-card__cover template-card__cover--empty"><LayoutGrid size={22} /></div>;
  }
  return (
    <svg className="template-card__cover" viewBox="0 0 440 230" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect width="440" height="230" className="workflow-canvas-thumb__base" />
      {edges.map(([from, to], index) => {
        const source = nodes[from];
        const target = nodes[to];
        if (!source || !target) return null;
        const x1 = source.x + (source.w || 60);
        const y1 = source.y + 14;
        const x2 = target.x;
        const y2 = target.y + 14;
        return <path key={`${from}-${to}-${index}`} d={`M ${x1} ${y1} C ${x1 + 24} ${y1}, ${x2 - 24} ${y2}, ${x2} ${y2}`} className="workflow-canvas-thumb__edge" />;
      })}
      {nodes.map((node, index) => (
        <g key={`${node.label}-${index}`} className="workflow-canvas-thumb__node">
          <rect x={node.x} y={node.y} width={node.w || 60} height="28" rx="4" />
          <rect x={node.x} y={node.y} width="4" height="28" fill={thumbnailTones[node.tone] || thumbnailTones.blue} />
          <text x={node.x + 8} y={node.y + 17}>{node.label}</text>
        </g>
      ))}
    </svg>
  );
}

export function TemplateModal({ open, onClose, onUse, onImportFile }) {
  const [templates, setTemplates] = useState([]);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(null);
  const [imported, setImported] = useState(null);
  const [importError, setImportError] = useState("");
  const [pending, setPending] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setStatus({ text: "正在加载模板…" });
    listWorkflowTemplates().then((items) => {
      if (cancelled) return;
      setTemplates(items || []);
      setStatus(null);
    }).catch((error) => {
      if (cancelled) return;
      setTemplates([]);
      setStatus({ text: error.message || "模板列表加载失败", error: true });
    });
    return () => { cancelled = true; };
  }, [open]);

  // 关闭弹窗时清理一次性导入状态，避免下次打开残留
  useEffect(() => {
    if (open) return;
    setImported(null);
    setImportError("");
    setPending(null);
  }, [open]);

  // 内置官方模板已下线：模板库只展示后续「保存为模板」写入的用户模板
  const visible = useMemo(() => templates.filter((item) => {
    if (item.builtin) return false;
    if (category !== "all" && item.category !== category) return false;
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return `${item.title}${item.description}${item.modelLabel}${(item.outputModels || []).join("")}${(item.tags || []).join("")}`.toLowerCase().includes(keyword);
  }), [templates, category, query]);

  // 导入本地工作流 JSON（需求 4.4.2）：先读文件并做格式校验，失败时给出逐项错误清单且不改动画布
  async function selectFile(file) {
    if (!file) return;
    setImportError("");
    setImported(null);
    let text = "";
    try {
      text = await file.text();
    } catch (error) {
      setImportError(error.message || "文件读取失败");
      return;
    }
    const parsed = parseImportedFileText(text);
    if (!parsed.ok) {
      setImportError(parsed.errors.join("；"));
      return;
    }
    setImported({ fileName: file.name, kind: parsed.kind, json: parsed.json });
    setPending({ source: "import", fileName: file.name, kind: parsed.kind, json: parsed.json });
  }

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="template-modal" role="dialog" aria-modal="true" aria-labelledby="template-title">
        <header><div><span className="modal-kicker">WORKFLOW TEMPLATES</span><h2 id="template-title">从模板开始</h2><p>选择已保存的工作流模板一键实例化到画布，也可导入已有的 ComfyUI 或工作台 JSON。</p></div><button className="modal-close" aria-label="关闭模板窗口" onClick={onClose}><X size={19} /></button></header>
        <div className="template-modal__toolbar works-controls">
          <div className="works-type-tabs" role="tablist" aria-label="模板分类">
            {CATEGORIES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={category === item.id}
                className={`works-type-tab${category === item.id ? " is-active active" : ""}`}
                onClick={() => setCategory(item.id)}
              >
                <WorksTypeIcon type={item.id} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <label className="works-search">
            <Search size={17} aria-hidden="true" />
            <span className="visually-hidden">搜索模板</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板名称或模型" autoComplete="off" />
          </label>
        </div>
        {status && <p className={`template-modal__status${status.error ? " is-error" : ""}`}>{status.text}</p>}
        {!status && visible.length === 0 && <p className="template-modal__status">暂无模板，把生成的工作流保存为模板后会显示在这里。</p>}
        <div className="template-grid">{visible.map((item) => (
          <article key={item.id} className="template-card">
            <TopologyThumbnail topology={item.topology} cover={item.coverPath} />
            <div>
              <span className="official-badge"><Check size={11} /> 我的模板</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              {(item.tags || []).length > 0 && <div className="template-card__tags">{item.tags.map((tag) => <em key={tag}>{tag}</em>)}</div>}
              <footer>
                <span>{item.nodeCount ? `${item.nodeCount} 个节点` : "我的模板"}{item.version ? ` · v${item.version}` : ""}</span>
                <button onClick={() => setPending({ source: "template", ...item })}>使用模板</button>
              </footer>
            </div>
          </article>
        ))}</div>
        {pending && <div className="template-instance" role="dialog" aria-modal="true" aria-label="实例化模板">
          <div className="template-instance__box">
            <strong>「{pending.source === "import" ? pending.fileName : pending.title}」如何打开？</strong>
            <small>模板实例化不会直接覆盖当前画布。</small>
            <div>
              {pending.source === "import" ? (
                <>
                  <button onClick={() => { onImportFile?.({ fileName: pending.fileName, kind: pending.kind, json: pending.json, mode: "new" }); setPending(null); }}><WandSparkles size={15} /> 新建画布</button>
                  <button onClick={() => { onImportFile?.({ fileName: pending.fileName, kind: pending.kind, json: pending.json, mode: "append" }); setPending(null); }}><LayoutGrid size={15} /> 追加到当前画布</button>
                </>
              ) : (
                <>
                  <button onClick={() => { onUse({ ...pending, mode: "new" }); setPending(null); }}><WandSparkles size={15} /> 新建画布</button>
                  <button onClick={() => { onUse({ ...pending, mode: "append" }); setPending(null); }}><LayoutGrid size={15} /> 追加到当前画布</button>
                </>
              )}
            </div>
          </div>
        </div>}
        <div className="workflow-import" onClick={() => fileRef.current?.click()}><span><FileJson size={22} /></span><div><strong>{imported ? `已选择：${imported.fileName}` : "导入 ComfyUI 或工作台 JSON"}</strong><small>{importError ? <em className="workflow-import__error">{importError}</em> : "支持 .json，导入后可继续编辑"}</small></div><button><Upload size={16} /> 选择文件</button><input ref={fileRef} hidden type="file" accept=".json,.png,.webp" onChange={(e) => selectFile(e.target.files?.[0])} /></div>
      </section>
    </div>
  );
}
