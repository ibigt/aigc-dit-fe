import { useEffect, useState } from "react";
import { clipDuration, updateClip } from "./model.js";
import { useEditingStore } from "./store.js";
import Icon from "./Icons.jsx";

export default function RightPane({ store }) {
  const state = useEditingStore(store);
  const { timeline, selection } = state.doc;
  const view = state.view;
  const clip = timeline.tracks.flatMap((track) => track.clips).find((item) => selection.includes(item.id));
  const [draft, setDraft] = useState({});
  useEffect(() => { setDraft(clip || {}); }, [clip?.id, clip?.adjust?.brightness, clip?.adjust?.contrast, clip?.adjust?.saturate, clip?.text]);

  function apply(patch) {
    if (!clip) return;
    store.commit("调整参数", (doc) => ({ ...doc, timeline: updateClip(doc.timeline, clip.id, patch) }));
  }

  const adjust = draft.adjust || clip?.adjust || {};
  // 规范 §9.1：4px 槽 + 12px 白拖柄，填充段用所属参数组的语义色
  const slider = (label, key, min, max, fill = "var(--fx)") => {
    const value = Number(adjust[key] || 0);
    const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    return (
      <div className="ce-slid" key={key}>
        <div className="row"><span>{label}</span><b>{min < 0 && value > 0 ? `+${value}` : value}</b></div>
        <input className="ce-range" type="range" min={min} max={max} value={value}
          style={{ "--pct": `${pct}%`, "--range-fill": fill }}
          onChange={(event) => setDraft((current) => ({ ...current, adjust: { ...adjust, [key]: Number(event.target.value) } }))}
          onPointerUp={(event) => apply({ adjust: { ...adjust, [key]: Number(event.target.value) } })} />
      </div>
    );
  };

  const volume = Number(clip?.volume ?? 1);

  return (
    <div className="ce-right">
      <div className="ce-tabs">
        <button className={view.rightTab === "props" ? "on" : ""} onClick={() => store.setView({ rightTab: "props" })}>属性</button>
        <button className={`ai ${view.rightTab === "assistant" ? "on" : ""}`} onClick={() => store.setView({ rightTab: "assistant" })}>
          <Icon name="sparkle" size={13} /> 助手
        </button>
      </div>
      <div className="ce-rbody">
        {view.rightTab === "assistant" && (
          <div className="ce-empty"><Icon name="sparkle" />剪辑助手<br />P2 上线：对话式批量动作（自动配乐 / 一键字幕等），动作可撤销</div>
        )}
        {view.rightTab === "props" && !clip && (
          <div className="ce-empty"><Icon name="mousePointer" />选中时间线片段以编辑属性</div>
        )}
        {view.rightTab === "props" && clip && (
          <>
            <div className="ce-grp">选中片段 · {clip.sourceTitle || clip.type}</div>
            {(clip.type === "video" || clip.type === "audio") && (
              <button className={`btn2 ce-solo-btn ${view.soloClipId === clip.id ? "on" : ""}`}
                disabled={!clip.storageKey}
                onClick={() => {
                  if (view.soloClipId === clip.id) { store.setView({ soloClipId: null, playing: false }); return; }
                  if (!clip.storageKey) { store.toast("该片段暂无可播放产物", "error"); return; }
                  store.setView({ soloClipId: clip.id, playing: true });
                }}>
                <Icon name={view.soloClipId === clip.id ? "x" : "play"} size={13} />
                {view.soloClipId === clip.id ? "退出单独预览" : "单独播放此片段（P）"}
              </button>
            )}
            <div className="ce-slid">
              <div className="row"><span>时间</span><b>{(Number(clip.start) || 0).toFixed(1)}s → {(Number(clip.start) + clipDuration(clip)).toFixed(1)}s</b></div>
            </div>
            {(clip.type === "video" || clip.type === "audio") && (
              <>
                <div className="ce-slid">
                  <div className="row"><span>音量</span><b>{Math.round(volume * 100)}</b></div>
                  <input className="ce-range" type="range" min="0" max="2" step="0.05" value={volume}
                    style={{ "--pct": `${Math.min(100, volume / 2 * 100)}%`, "--range-fill": "var(--a)" }}
                    onChange={(event) => setDraft((current) => ({ ...current, volume: Number(event.target.value) }))}
                    onPointerUp={(event) => apply({ volume: Number(event.target.value) })} />
                </div>
                <label className="ce-check"><input type="checkbox" checked={Boolean(clip.muted)} onChange={(event) => apply({ muted: event.target.checked })} /> 静音</label>
                <label className="ce-check"><input type="checkbox" checked={clip.enabled !== false} onChange={(event) => apply({ enabled: event.target.checked })} /> 启用片段</label>
              </>
            )}
            {(clip.type === "text" || clip.type === "graphic") && (
              <div className="ce-slid">
                <div className="row"><span>内容</span></div>
                <textarea className="ce-field" value={draft.text ?? clip.text ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
                  onBlur={(event) => { if (event.target.value !== clip.text) apply({ text: event.target.value }); }} />
              </div>
            )}
            <div className="ce-sep"></div>
            <div className="ce-grp">调节（预览）</div>
            {slider("亮度", "brightness", -50, 50)}
            {slider("对比度", "contrast", -50, 50)}
            {slider("饱和度", "saturate", -50, 50)}
            <div style={{ fontSize: 10, color: "var(--t3)", lineHeight: 1.7 }}>调节仅作用于预览；特效 / 转场 / 图形在 MVP 期导出暂不包含。</div>
          </>
        )}
      </div>
    </div>
  );
}
