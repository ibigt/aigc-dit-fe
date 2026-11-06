import { useMemo, useRef } from "react";
import { mediaUrl } from "../../../lib/media.js";
import { addClip, clipEnd, mainVideoTrack, sourceClipFromQueue } from "./model.js";
import { parseSrt } from "./srt.js";
import { useEditingStore } from "./store.js";
import Icon from "./Icons.jsx";

const PANELS = [
  { id: "media", label: "素材", icon: "media" },
  { id: "text", label: "文字", icon: "text" },
  { id: "graphic", label: "图形", icon: "graphic" },
  { id: "effect", label: "特效", icon: "effect" },
  { id: "transition", label: "转场", icon: "transition" },
  { id: "adjust", label: "调节", icon: "adjust" },
];
const FILTERS = [
  { id: "all", label: "全部" },
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
  { id: "image", label: "图片" },
];
// 无真实封面时用与效果图一致的四种渐变缩略图，按序轮换
const THUMB_SHADES = [
  "linear-gradient(105deg,#2b3a52 0%,#3a4f6e 30%,#253248 55%,#31445f 80%,#22304a)",
  "linear-gradient(100deg,#3a2f52 0%,#4a3a6e 40%,#2c2444 75%)",
  "linear-gradient(95deg,#2d4a3e 0%,#3a6350 50%,#26413a)",
  "linear-gradient(110deg,#4a3a30 0%,#63503a 45%,#3a3026)",
];

export default function LeftPane({ store, sources }) {
  const state = useEditingStore(store);
  const { timeline } = state.doc;
  const view = state.view;
  const fileRef = useRef(null);
  const filter = view.mediaFilter || "all";
  const visibleSources = useMemo(() => sources.filter((item) => {
    if (filter === "all") return true;
    const kind = (item.output?.type || item.type || (item.mimeType || "").split("/")[0] || "").toLowerCase();
    if (filter === "image") return kind.includes("image");
    if (filter === "audio") return kind.includes("audio") || /\.(mp3|wav|m4a|aac)$/i.test(item.output?.storageKey || item.storageKey || "");
    return kind.includes("video") || /\.mp4$/i.test(item.output?.storageKey || item.storageKey || "") || !kind.includes("image");
  }), [sources, filter]);
  const groups = useMemo(() => {
    const map = new Map();
    for (const item of visibleSources) {
      const key = item.sourceNodeId || "source";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()];
  }, [visibleSources]);

  function appendSource(item) {
    if (!item?.output?.storageKey && !item?.storageKey) { store.toast("该素材暂无可播放产物", "error"); return; }
    const main = mainVideoTrack(timeline);
    if (!main) return;
    const start = main.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
    store.commit("添加素材", (doc) => ({ ...doc, timeline: addClip(doc.timeline, main.id, { ...sourceClipFromQueue(item), start }), selection: [] }));
  }

  async function importSrt(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.srt$/i.test(file.name)) { store.toast("仅支持 .srt 字幕文件", "error"); return; }
    if (file.size > 10 * 1024 * 1024) { store.toast("字幕文件超过 10MB", "error"); return; }
    const { items, skipped } = parseSrt(await file.text());
    if (!items.length) { store.toast("未解析到有效字幕条目", "error"); return; }
    const textTrack = timeline.tracks.find((track) => track.type === "text");
    if (!textTrack) return;
    store.commit("导入字幕", (doc) => ({
      ...doc,
      timeline: {
        ...doc.timeline,
        tracks: doc.timeline.tracks.map((track) => track.id === textTrack.id
          ? { ...track, clips: [...track.clips, ...items.map((item) => ({
            id: `sub-${Math.random().toString(36).slice(2, 9)}`, type: "text",
            start: item.start, duration: item.duration, text: item.text, enabled: true,
          }))] }
          : track),
      },
      selection: [],
    }));
    store.toast(`已导入 ${items.length} 条字幕${skipped ? `，跳过 ${skipped} 条异常` : ""}`, "ok");
  }

  function addText() {
    const track = timeline.tracks.find((item) => item.type === "text");
    if (!track) return;
    const start = store.getTime();
    // 固定 id 便于「添加后立刻选中 + 自动进入内联编辑」，用户点完按钮就能直接打字
    const id = `clip-${Math.random().toString(36).slice(2, 9)}`;
    store.commit("添加文字", (doc) => ({
      ...doc,
      timeline: addClip(doc.timeline, track.id, { id, type: "text", start, duration: 3, text: "", enabled: true }),
      selection: [id],
    }));
    store.setView({ editClipId: id, rightTab: "props", rightCollapsed: false });
  }

  return (
    <>
      <div className="ce-rail">
        {PANELS.map((panel) => (
          <button key={panel.id} className={view.panel === panel.id ? "on" : ""}
            title={panel.label}
            onClick={() => store.setView({ panel: panel.id, leftCollapsed: false })}>
            <Icon name={panel.icon} size={18} />{panel.label}
          </button>
        ))}
        <button className="fold" title="折叠面板" onClick={() => store.setView({ leftCollapsed: !view.leftCollapsed })}><Icon name="fold" size={18} /></button>
      </div>
      {!view.leftCollapsed && (
        <div className="ce-panel">
          <h3>{PANELS.find((item) => item.id === view.panel)?.label} <Icon name="upload" size={14} style={{ color: "var(--t3)" }} /></h3>
          <div className="body" key={view.panel}>
            {view.panel === "media" && (
              <>
                <div className="ce-chips">
                  {FILTERS.map((item) => (
                    <button key={item.id} className={`ce-chip ${filter === item.id ? "on" : ""}`}
                      onClick={() => store.setView({ mediaFilter: item.id })}>{item.label}</button>
                  ))}
                </div>
                {groups.length === 0 && <div className="ce-p2"><Icon name="film" size={24} style={{ margin: "0 auto 8px", opacity: .5 }} />暂无上游视频素材<br />先在画布生成视频并连到剪辑节点</div>}
                {groups.map(([key, items]) => (
                  <div key={key}>
                    <div className="ce-group">节点 {String(key).slice(-6)}</div>
                    <div className="ce-grid2">
                      {items.map((item, index) => {
                        const sourceIndex = sources.indexOf(item);
                        const thumb = item.output?.posterUrl ? mediaUrl(item.output.posterUrl, { w: 160 }) : "";
                        const shade = THUMB_SHADES[index % THUMB_SHADES.length];
                        return (
                          <div key={`${key}-${index}`} className="ce-mcard" draggable
                            title="拖入时间线，或双击追加"
                            onDragStart={(event) => event.dataTransfer.setData("application/x-editing-source", String(sourceIndex))}
                            onDoubleClick={() => appendSource(item)}>
                            <div className="thumb" style={thumb ? { background: `url(${thumb}) center/cover` } : { background: shade }}>
                              <button className="ce-add" title="添加到时间线" onClick={(event) => { event.stopPropagation(); appendSource(item); }}><Icon name="plus" size={12} /></button>
                            </div>
                            <div className="lab"><b>{item.sourceTitle || item.sourceNodeId}</b><em>{(clipEndSource(item)).toFixed(1)}s</em></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="ce-upload" onClick={() => store.toast("本地导入将在 P2 上线，当前请使用画布上游素材", "info")}><Icon name="upload" size={14} /> 导入素材（P2）</div>
              </>
            )}
            {view.panel === "text" && (
              <>
                <button className="btn2" style={{ width: "100%", justifyContent: "center" }} onClick={addText}><Icon name="plus" size={14} /> 添加文字</button>
                <div className="ce-upload" onClick={() => fileRef.current?.click()}><Icon name="download" size={14} /> 导入字幕（SRT）</div>
                <input ref={fileRef} type="file" accept=".srt" hidden onChange={importSrt} />
                <div className="ce-p2">文字样式预设 / 花字<br />P2 上线</div>
              </>
            )}
            {["graphic", "effect", "transition", "adjust"].includes(view.panel) && (
              <div className="ce-p2"><Icon name={PANELS.find((item) => item.id === view.panel)?.icon} size={24} style={{ margin: "0 auto 8px", opacity: .5 }} />
                {PANELS.find((item) => item.id === view.panel)?.label}能力<br />MVP 期先占位，P2 上线<br /><small>调节类参数可在右侧属性面板对选中片段设置</small></div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function clipEndSource(item) {
  const start = Number(item.trimStart) || 0;
  const end = Number(item.trimEnd);
  return Number.isFinite(end) && end > start ? end - start : Number(item.output?.durationSec ?? item.output?.metadata?.durationSec) || 5;
}
