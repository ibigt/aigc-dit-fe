import { Check, FileJson, Film, Image, Search, Sparkles, Upload, WandSparkles, X } from "lucide-react";
import { useRef, useState } from "react";

const templates = [
  { id: 1, title: "电影感文生视频", desc: "从提示词生成具有镜头运动的 8 秒视频", icon: Film, nodes: 6, color: "blue" },
  { id: 2, title: "产品图动态展示", desc: "将产品图片转为环绕运镜广告短片", icon: Image, nodes: 8, color: "amber" },
  { id: 3, title: "风格一致性分镜", desc: "保持角色与场景一致的多镜头生成", icon: WandSparkles, nodes: 12, color: "violet" },
  { id: 4, title: "高清修复与补帧", desc: "画质增强、智能补帧与视频放大", icon: Sparkles, nodes: 5, color: "green" },
];

export function TemplateModal({ open, onClose, onUse }) {
  const [imported, setImported] = useState(null);
  const fileRef = useRef(null);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="template-modal" role="dialog" aria-modal="true" aria-labelledby="template-title">
        <header><div><span className="modal-kicker">WORKFLOW TEMPLATES</span><h2 id="template-title">从模板开始</h2><p>选择官方模板，或导入已有的 ComfyUI 工作流。</p></div><button className="modal-close" aria-label="关闭模板窗口" onClick={onClose}><X size={19} /></button></header>
        <div className="template-modal__toolbar"><label><Search size={16} /><input placeholder="搜索模板" /></label><div><button className="active">推荐</button><button>视频</button><button>图像</button></div></div>
        <div className="template-grid">{templates.map((item) => { const Icon = item.icon; return <article key={item.id} className="template-card"><div className={`template-art template-art--${item.color}`}><Icon size={30} /><span className="node-mini node-mini--1" /><span className="node-mini node-mini--2" /><span className="node-mini node-mini--3" /></div><div><span className="official-badge"><Check size={11} /> 官方</span><h3>{item.title}</h3><p>{item.desc}</p><footer><span>{item.nodes} 个节点</span><button onClick={() => onUse(item)}>使用模板</button></footer></div></article>; })}</div>
        <div className="workflow-import" onClick={() => fileRef.current?.click()}><span><FileJson size={22} /></span><div><strong>{imported ? `已选择：${imported}` : "导入 ComfyUI 工作流"}</strong><small>支持 .json 与工作流图片，导入后可继续编辑</small></div><button><Upload size={16} /> 选择文件</button><input ref={fileRef} hidden type="file" accept=".json,.png,.webp" onChange={(e) => setImported(e.target.files?.[0]?.name || null)} /></div>
      </section>
    </div>
  );
}
