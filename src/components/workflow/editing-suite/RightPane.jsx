import { useEffect, useState } from "react";
import {
  EFFECT_PRESETS, TRANSITION_PRESETS, clipDuration, mainVideoTrack, removeTrack,
  trimRangeOf, updateClip, updateTrack, validateTrim,
} from "./model.js";
import { useEditingStore } from "./store.js";
import { downloadMediaFile, mediaDownloadName } from "../../../lib/media.js";
import Icon from "./Icons.jsx";
import AssistantPane from "./AssistantPane.jsx";
import { EDITING_ASSISTANT_ENABLED } from "./flags.js";

const trimText = (value) => String(Math.round((Number(value) || 0) * 1000) / 1000);

export default function RightPane({ store }) {
  const state = useEditingStore(store);
  const { timeline, selection } = state.doc;
  const view = state.view;
  const clip = timeline.tracks.flatMap((track) => track.clips).find((item) => selection.includes(item.id));
  const track = view.activeTrackId ? timeline.tracks.find((item) => item.id === view.activeTrackId) : null;
  // V2 画中画：片段是否在副视频轨（非主轨 V1 的 video 轨）——决定是否显示画中画控件
  const clipOnPipTrack = clip ? timeline.tracks.some((item) => item.type === "video"
    && item.id !== mainVideoTrack(timeline)?.id && item.clips.some((entry) => entry.id === clip.id)) : false;
  const [draft, setDraft] = useState({});
  // 初值直接取首个 clip 的真实裁剪区间，避免首帧闪一下「出点必须大于入点」。
  const [trimDraft, setTrimDraft] = useState(() => {
    const range = trimRangeOf(clip);
    return { trimStart: trimText(range.trimStart), trimEnd: trimText(range.trimEnd) };
  });
  const [downloading, setDownloading] = useState(false);
  // 拖动中的值在 draft 里，松手才写入 timeline。依赖必须覆盖这些字段，撤销或时间线改动才能把滑杆拉回来。
  useEffect(() => { setDraft(clip || {}); }, [
    clip?.id,
    clip?.volume,
    clip?.opacity,
    clip?.pip?.x, clip?.pip?.y, clip?.pip?.scale, clip?.pip?.opacity,
    clip?.adjust?.brightness, clip?.adjust?.contrast, clip?.adjust?.saturate,
    clip?.text,
    clip?.graphic?.color, clip?.graphic?.x, clip?.graphic?.y, clip?.graphic?.scale, clip?.graphic?.opacity,
  ]);

  const isMediaClip = clip?.type === "video" || clip?.type === "audio";
  // 剪辑助手入口隐藏期间，rightTab 不允许停在 "assistant"（否则右栏既没有 Tab 也没有内容，一片空白）。
  // store 每次挂载新建、默认 rightTab="props"，这里只是兜住开发期开关从 true 翻成 false 的热更新场景。
  const activeTab = EDITING_ASSISTANT_ENABLED ? view.rightTab : "props";
  // 切换片段 / 裁剪被时间线拖拽改动时，输入框回填真实值；输入过程中不回填，避免打断「1.」这类中间态。
  useEffect(() => {
    if (!isMediaClip) return;
    const range = trimRangeOf(clip);
    setTrimDraft({ trimStart: trimText(range.trimStart), trimEnd: trimText(range.trimEnd) });
  }, [clip?.id, clip?.trimStart, clip?.trimEnd, clip?.duration, isMediaClip]);

  // 源时长参与校验：出点超素材实际时长时直接标错，不必等导出被 ffmpeg 拦
  const trimResult = isMediaClip ? validateTrim({ ...trimDraft, sourceDuration: clip?.sourceDuration }) : null;

  function apply(patch) {
    if (!clip) return;
    store.commit("调整参数", (doc) => ({ ...doc, timeline: updateClip(doc.timeline, clip.id, patch) }));
  }

  // 失焦 / 回车提交：非法输入保留输入态并标错提示，不写 timeline；值未变不压撤销栈。
  function commitTrim() {
    if (!clip || !isMediaClip) return;
    const result = validateTrim({ ...trimDraft, sourceDuration: clip.sourceDuration });
    if (!result.ok) {
      store.toast(result.error, "error");
      return;
    }
    const current = validateTrim(trimRangeOf(clip));
    if (current.ok && current.patch.trimStart === result.patch.trimStart
      && current.patch.trimEnd === result.patch.trimEnd) return;
    apply(result.patch);
  }

  async function downloadClip() {
    if (!clip?.storageKey || downloading) return;
    setDownloading(true);
    try {
      const filename = mediaDownloadName({
        title: clip.sourceTitle || "片段",
        fallback: clip.type === "audio" ? "音频素材" : "视频素材",
        type: clip.type,
        storageKey: clip.storageKey,
      });
      await downloadMediaFile(clip.storageKey, filename);
      store.toast("原始素材已开始下载", "ok");
    } catch {
      store.toast("下载失败，请检查素材是否仍有效", "error");
    } finally {
      setDownloading(false);
    }
  }

  const adjust = draft.adjust || clip?.adjust || {};
  // 规范 §9.1：4px 槽 + 12px 白拖柄，填充段用所属参数组的语义色
  const slider = (label, key, min, max, fill = "var(--fx)", value, onChange, onCommit) => {
    const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    return (
      <div className="ce-slid" key={key}>
        <div className="row"><span>{label}</span><b>{min < 0 && value > 0 ? `+${value}` : value}</b></div>
        <input className="ce-range" type="range" min={min} max={max} value={value}
          style={{ "--pct": `${pct}%`, "--range-fill": fill }}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerUp={(event) => onCommit(Number(event.target.value))} />
      </div>
    );
  };

  const adjustSlider = (label, key, min, max) => slider(label, key, min, max, "var(--fx)",
    Number(adjust[key] || 0),
    (value) => setDraft((current) => ({ ...current, adjust: { ...adjust, [key]: value } })),
    (value) => apply({ adjust: { ...adjust, [key]: value } }));

  const volume = numberOr(draft.volume, clip?.volume, 1);
  const opacity = numberOr(draft.opacity, clip?.opacity, 100);
  const pipLive = { ...(clip?.pip || {}), ...(draft.pip || {}) };
  const graphic = draft.graphic || clip?.graphic || {};
  const textStyle = draft.textStyle || clip?.textStyle || {};
  const effect = (clip?.effects || [])[0] || null;

  return (
    <div className="ce-right">
      <div className="ce-tabs">
        <button className={activeTab === "props" ? "on" : ""} onClick={() => store.setView({ rightTab: "props" })}>属性</button>
        {EDITING_ASSISTANT_ENABLED && (
          <button className={`ai ${activeTab === "assistant" ? "on" : ""}`} onClick={() => store.setView({ rightTab: "assistant" })}>
            <Icon name="sparkle" size={13} /> 助手
          </button>
        )}
      </div>
      <div className="ce-rbody">
        {EDITING_ASSISTANT_ENABLED && activeTab === "assistant" && <AssistantPane store={store} />}

        {activeTab === "props" && track && !clip && (
          <>
            <div className="ce-grp">轨道 · {track.name}</div>
            <div className="ce-field-row">
              <label className="ce-field-label">名称</label>
              <input className="ce-input" value={draft.trackName ?? track.name}
                onChange={(event) => setDraft((current) => ({ ...current, trackName: event.target.value }))}
                onBlur={(event) => {
                  if (event.target.value && event.target.value !== track.name) {
                    store.commit("重命名轨道", (doc) => ({ ...doc, timeline: updateTrack(doc.timeline, track.id, { name: event.target.value }) }));
                  }
                }} />
            </div>
            <div className="ce-check"><input type="checkbox" checked={Boolean(track.locked)}
              onChange={(event) => store.commit("锁定轨道", (doc) => ({ ...doc, timeline: updateTrack(doc.timeline, track.id, { locked: event.target.checked }) }))} /> 锁定轨道（禁止拖动片段）</div>
            <div className="ce-check"><input type="checkbox" checked={track.visible !== false}
              onChange={(event) => store.commit("切换轨道可见", (doc) => ({ ...doc, timeline: updateTrack(doc.timeline, track.id, { visible: event.target.checked }) }))} /> 显示轨道</div>
            <div className="ce-check"><input type="checkbox" checked={!track.muted}
              onChange={(event) => store.commit("切换轨道静音", (doc) => ({ ...doc, timeline: updateTrack(doc.timeline, track.id, { muted: !event.target.checked }) }))} /> 取消静音</div>
            <div className="ce-sep"></div>
            <div className="ce-grp">轨道信息</div>
            <div className="ce-slid"><div className="row"><span>片段数</span><b>{track.clips.length}</b></div></div>
            <div className="ce-slid"><div className="row"><span>类型</span><b>{track.type}</b></div></div>
            <button className="btn2 ce-danger" style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
              onClick={() => {
                store.commit("删除轨道", (doc) => ({ ...doc, timeline: removeTrack(doc.timeline, track.id), selection: [] }));
                store.setView({ activeTrackId: null });
              }}>
              <Icon name="trash" size={13} /> 删除轨道
            </button>
            <div className="ce-hint">主视频轨不可删除（成片依赖它）。</div>
          </>
        )}

        {activeTab === "props" && !clip && !track && (
          <div className="ce-empty"><Icon name="mousePointer" />选中时间线片段以编辑属性</div>
        )}

        {activeTab === "props" && clip && (
          <>
            <div className="ce-grp">选中片段 · {clip.sourceTitle || clip.type}</div>
            {isMediaClip && (
              <div className="ce-clip-actions">
                <button className={`btn2 ce-solo-btn ${view.soloClipId === clip.id ? "on" : ""}`}
                  disabled={!clip.storageKey}
                  title="单独播放此片段（快捷键 P）"
                  onClick={() => {
                    if (view.soloClipId === clip.id) { store.setView({ soloClipId: null, playing: false }); return; }
                    if (!clip.storageKey) { store.toast("该片段暂无可播放产物", "error"); return; }
                    store.setView({ soloClipId: clip.id, playing: true });
                  }}>
                  <Icon name={view.soloClipId === clip.id ? "x" : "play"} size={13} />
                  {view.soloClipId === clip.id ? "退出预览" : "单独播放"}
                </button>
                <button className="btn2 ce-download-btn" disabled={!clip.storageKey || downloading}
                  title="下载该片段的上游原始素材文件（不含裁剪 / 音量 / 特效）"
                  onClick={downloadClip}>
                  <Icon name="download" size={13} />
                  {downloading ? "下载中…" : "下载素材"}
                </button>
              </div>
            )}
            {isMediaClip && !clip.storageKey && (
              <div className="ce-hint" style={{ marginTop: -4 }}>该片段暂无上游产物，播放与下载暂不可用。</div>
            )}
            <div className="ce-slid">
              <div className="row"><span>时间</span><b>{(Number(clip.start) || 0).toFixed(1)}s → {(Number(clip.start) + clipDuration(clip)).toFixed(1)}s</b></div>
            </div>

            {isMediaClip && (
              <>
                <div className="ce-sep"></div>
                <div className="ce-grp">裁剪（源素材时间 · 秒）</div>
                <div className="ce-trim-grid">
                  <div className="ce-trim-cell">
                    <label htmlFor={`trim-start-${clip.id}`}>入点</label>
                    <input id={`trim-start-${clip.id}`}
                      className={`ce-input ${trimResult?.ok ? "" : "err"}`}
                      type="number" min="0" step="0.1" value={trimDraft.trimStart}
                      onChange={(event) => setTrimDraft((current) => ({ ...current, trimStart: event.target.value }))}
                      onBlur={commitTrim}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                  </div>
                  <div className="ce-trim-cell">
                    <label htmlFor={`trim-end-${clip.id}`}>出点</label>
                    <input id={`trim-end-${clip.id}`}
                      className={`ce-input ${trimResult?.ok ? "" : "err"}`}
                      type="number" min="0" step="0.1" value={trimDraft.trimEnd}
                      onChange={(event) => setTrimDraft((current) => ({ ...current, trimEnd: event.target.value }))}
                      onBlur={commitTrim}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                  </div>
                </div>
                {trimResult?.ok ? (
                  <div className="ce-hint">裁后时长 {trimResult.duration.toFixed(1)}s；数值同步作用于预览与成片导出。片段在时间线上的位置不变，后续片段如需顺延请自行拖动。</div>
                ) : (
                  <div className="ce-field-error">{trimResult?.error}</div>
                )}
                <div className="ce-hint">下载的是上游原始素材文件，不含裁剪、音量与特效；裁剪后的画面请用「导出成片」。</div>
              </>
            )}

            {/* 副轨与主轨同一套音量 / 静音：未静音时预览出声，成片在素材有音轨时混入 */}
            {(clip.type === "video" || clip.type === "audio") && (
              <>
                <div className="ce-grp">音频</div>
                <div className="ce-slid">
                  <div className="row"><span>音量</span><b>{Math.round(volume * 100)}</b></div>
                  <input className="ce-range" type="range" min="0" max="2" step="0.05" value={volume}
                    style={{ "--pct": `${Math.min(100, volume / 2 * 100)}%`, "--range-fill": "var(--a)" }}
                    onChange={(event) => setDraft((current) => ({ ...current, volume: Number(event.target.value) }))}
                    onPointerUp={(event) => {
                      const next = Number(event.target.value);
                      setDraft((current) => ({ ...current, volume: next }));
                      apply({ volume: next });
                    }} />
                </div>
                <label className="ce-check"><input type="checkbox" checked={Boolean(clip.muted)} onChange={(event) => apply({ muted: event.target.checked })} /> 静音</label>
                <label className="ce-check"><input type="checkbox" checked={clip.enabled !== false} onChange={(event) => apply({ enabled: event.target.checked })} /> 启用片段</label>
              </>
            )}

            {clip.type === "video" && (
              <>
                <div className="ce-sep"></div>
                <div className="ce-grp">画面</div>
                {!clipOnPipTrack && (
                  <div className="ce-slid">
                    <div className="row"><span>不透明度</span><b>{Math.round(opacity)}</b></div>
                    <input className="ce-range" type="range" min="0" max="100" value={opacity}
                      style={{ "--pct": `${opacity}%`, "--range-fill": "var(--v)" }}
                      onChange={(event) => setDraft((current) => ({ ...current, opacity: Number(event.target.value) }))}
                      onPointerUp={(event) => {
                        const next = Number(event.target.value);
                        setDraft((current) => ({ ...current, opacity: next }));
                        apply({ opacity: next });
                      }} />
                  </div>
                )}
                {clipOnPipTrack && (
                  <>
                    <div className="ce-hint">画中画：该片段叠在主画面上方导出，预览与成片同口径。</div>
                    {(() => {
                      const pipSlider = (label, key, min, max, def) => {
                        const value = numberOr(pipLive[key], undefined, def);
                        return (
                          <div className="ce-slid" key={key}>
                            <div className="row"><span>{label}</span><b>{key === "scale" || key === "opacity" ? Math.round(value) : `${Math.round(value)}%`}</b></div>
                            <input className="ce-range" type="range" min={min} max={max} value={value}
                              style={{ "--pct": `${(value - min) / (max - min) * 100}%`, "--range-fill": "var(--v)" }}
                              onChange={(event) => {
                                const next = Number(event.target.value);
                                setDraft((current) => ({
                                  ...current,
                                  pip: { ...(clip.pip || {}), ...(current.pip || {}), [key]: next },
                                }));
                              }}
                              onPointerUp={(event) => {
                                const next = Number(event.target.value);
                                const pip = { ...(clip.pip || {}), ...(draft.pip || {}), [key]: next };
                                setDraft((current) => ({ ...current, pip }));
                                apply({ pip });
                              }} />
                          </div>
                        );
                      };
                      return (
                        <>
                          {pipSlider("水平位置", "x", 0, 100, 70)}
                          {pipSlider("垂直位置", "y", 0, 100, 25)}
                          {pipSlider("大小（画面宽 %）", "scale", 5, 100, 30)}
                          {pipSlider("不透明度", "opacity", 0, 100, 100)}
                        </>
                      );
                    })()}
                  </>
                )}
              </>
            )}

            {(clip.type === "text" || clip.type === "graphic") && (
              <>
                <div className="ce-grp">{clip.type === "text" ? "内容" : "图形"}</div>
                {clip.type === "text" && (
                  <textarea className="ce-field" value={draft.text ?? clip.text ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
                    onBlur={(event) => { if (event.target.value !== clip.text) apply({ text: event.target.value }); }} />
                )}
                {clip.type === "text" && (
                  <>
                    <div className="ce-field-row">
                      <label className="ce-field-label">字号</label>
                      <input className="ce-input" type="number" min="8" max="120" value={Number(textStyle.fontSize ?? 16)}
                        onChange={(event) => setDraft((current) => ({ ...current, textStyle: { ...textStyle, fontSize: Number(event.target.value) } }))}
                        onBlur={(event) => apply({ textStyle: { ...textStyle, fontSize: Number(event.target.value) } })} />
                    </div>
                    <div className="ce-field-row">
                      <label className="ce-field-label">颜色</label>
                      <input className="ce-color" type="color" value={textStyle.color || "#ffffff"}
                        onChange={(event) => setDraft((current) => ({ ...current, textStyle: { ...textStyle, color: event.target.value } }))}
                        onBlur={(event) => apply({ textStyle: { ...textStyle, color: event.target.value } })} />
                      <div className="ce-align">
                        {["left", "center", "right"].map((align) => (
                          <button key={align} className={`ce-align-btn ${textStyle.align === align ? "on" : ""}`}
                            onClick={() => apply({ textStyle: { ...textStyle, align } })}>
                            {align === "left" ? "左" : align === "center" ? "中" : "右"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {clip.type === "graphic" && (
                  <>
                    <div className="ce-field-row">
                      <label className="ce-field-label">颜色</label>
                      <input className="ce-color" type="color" value={graphic.color || "#6cb2ec"}
                        onChange={(event) => setDraft((current) => ({ ...current, graphic: { ...graphic, color: event.target.value } }))}
                        onBlur={(event) => apply({ graphic: { ...graphic, color: event.target.value } })} />
                    </div>
                    <div className="ce-field-row">
                      <label className="ce-field-label">横向</label>
                      <input className="ce-range" type="range" min="0" max="100" value={Number(graphic.x ?? 50)}
                        style={{ "--pct": `${Number(graphic.x ?? 50)}%`, "--range-fill": "var(--g)" }}
                        onChange={(event) => setDraft((current) => ({ ...current, graphic: { ...graphic, x: Number(event.target.value) } }))}
                        onPointerUp={(event) => apply({ graphic: { ...graphic, x: Number(event.target.value) } })} />
                    </div>
                    <div className="ce-field-row">
                      <label className="ce-field-label">纵向</label>
                      <input className="ce-range" type="range" min="0" max="100" value={Number(graphic.y ?? 50)}
                        style={{ "--pct": `${Number(graphic.y ?? 50)}%`, "--range-fill": "var(--g)" }}
                        onChange={(event) => setDraft((current) => ({ ...current, graphic: { ...graphic, y: Number(event.target.value) } }))}
                        onPointerUp={(event) => apply({ graphic: { ...graphic, y: Number(event.target.value) } })} />
                    </div>
                    {slider("缩放", "scale", 10, 200, "var(--g)", Number(graphic.scale ?? 100),
                      (value) => setDraft((current) => ({ ...current, graphic: { ...graphic, scale: value } })),
                      (value) => apply({ graphic: { ...graphic, scale: value } }))}
                    {slider("不透明度", "opacity", 0, 100, "var(--g)", Number(graphic.opacity ?? 100),
                      (value) => setDraft((current) => ({ ...current, graphic: { ...graphic, opacity: value } })),
                      (value) => apply({ graphic: { ...graphic, opacity: value } }))}
                  </>
                )}
              </>
            )}

            {(clip.type === "video" || clip.type === "audio") && (
              <>
                <div className="ce-sep"></div>
                <div className="ce-grp">特效</div>
                {effect ? (
                  <div className="ce-effect-row">
                    <span className="ce-effect-name">{effect.label}</span>
                    <button className="ce-linkbtn" onClick={() => apply({ effects: [] })}>清除</button>
                  </div>
                ) : (
                  <div className="ce-hint">未施加特效。在左侧「特效」面板点选预设即可施加。</div>
                )}
                {clip.transitionOut ? (
                  <>
                    <div className="ce-grp" style={{ marginTop: 12 }}>转场（右邻接缝）</div>
                    <div className="ce-effect-row">
                      <span className="ce-effect-name">{clip.transitionOut.label} · {clip.transitionOut.duration}s</span>
                      <button className="ce-linkbtn" onClick={() => apply({ transitionOut: null })}>清除</button>
                    </div>
                  </>
                ) : null}
                <div className="ce-sep"></div>
                <div className="ce-grp">调节（预览）</div>
                {adjustSlider("亮度", "brightness", -50, 50)}
                {adjustSlider("对比度", "contrast", -50, 50)}
                {adjustSlider("饱和度", "saturate", -50, 50)}
                <div className="ce-hint">调节与特效实时作用于预览，导出成片时也会一并渲染；文字与图形按时间线位置烧录到画面。</div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function numberOr(primary, fallback, def) {
  const raw = primary ?? fallback ?? def;
  return Number.isFinite(Number(raw)) ? Number(raw) : def;
}
