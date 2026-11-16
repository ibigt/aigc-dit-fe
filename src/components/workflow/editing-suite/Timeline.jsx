import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icons.jsx";
import MediaThumb, { resolveThumbUrls } from "./MediaThumb.jsx";
import { ZOOM_LEVELS, addTrack, clipDuration, exportFlatClips, filmDuration, findSnap, formatTime, mainVideoTrack, mediaKindOf, snapTargets, splitAt, timelineDuration, updateClip, updateTrack, moveClipToTrack, removeClips, addClip, sourceClipFromQueue } from "./model.js";
import { useEditingStore } from "./store.js";

const THUMB_SHADES = ["linear-gradient(160deg,#31445f,#22304a)", "linear-gradient(160deg,#4a3a6e,#2c2444)",
  "linear-gradient(160deg,#3a6350,#26413a)", "linear-gradient(160deg,#63503a,#3a3026)",
  "linear-gradient(160deg,#2b3a52,#1e2a40)", "linear-gradient(160deg,#52406b,#332a4a)"];
// 轨道语义色 / 图标（视觉规范 §10.3：激活指示条跟随轨道类型，不固定蓝色）
const TRACK_SEM = { text: "var(--tx)", video: "var(--v)", audio: "var(--a)", graphic: "var(--g)" };
const TRACK_ICON = { text: "text", video: "video", audio: "audio", graphic: "graphic" };
const TRACK_LABEL = { text: "文字", graphic: "图形", video: "视频", audio: "音频" };
const TRACK_HINT = { text: "拖入文字 / 导入 SRT", video: "拖入视频素材", audio: "拖入音频素材", graphic: "拖入图形素材" };

export default function Timeline({ store, sources }) {
  const state = useEditingStore(store);
  const { timeline, selection } = state.doc;
  const view = state.view;
  const lanesRef = useRef(null);
  const rulerRef = useRef(null);
  const dragRef = useRef(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [preview, setPreview] = useState(null);
  const [addTrackOpen, setAddTrackOpen] = useState(false);
  const [dragOverTrack, setDragOverTrack] = useState(null);
  // 文字/图形片段内联编辑态（双击片段或点 ✎ 进入），提交时走一次 commit = 一条撤销记录
  const [editing, setEditing] = useState(null);
  const pxPerSec = view.pxPerSec;
  const soloClip = view.soloClipId
    ? timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === view.soloClipId) || null
    : null;
  const duration = timelineDuration(timeline);
  const contentWidth = Math.max(duration + 10, 60) * pxPerSec + 160;
  const step = pxPerSec >= 80 ? 1 : pxPerSec >= 40 ? 2 : pxPerSec >= 20 ? 5 : 10;
  const ticks = useMemo(() => {
    const list = [];
    for (let t = 0; t <= Math.max(duration + 10, 60); t += step / 2) list.push(t);
    return list;
  }, [duration, step]);

  // 播放头拖拽 / 标尺 seek：直接改 transient 时间，不触发 React 渲染
  function seekFromEvent(event, dragging = false) {
    const strip = rulerRef.current?.querySelector(".ce-ruler-strip");
    const rect = strip?.getBoundingClientRect();
    if (!rect) return;
    const at = (clientX) => Math.max(0, (clientX - rect.left + (lanesRef.current?.scrollLeft || 0)) / pxPerSec);
    store.setTime(at(event.clientX));
    if (dragging) {
      const onMove = (moveEvent) => store.setTime(at(moveEvent.clientX));
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
  }

  // 片段拖拽 / 修剪：拖拽中只走本地 preview，松手才 commit 一条历史
  function beginDrag(event, clip, track, mode) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (track.locked) {
      store.toast(`轨道「${track.name}」已锁定，先解锁再编辑`, "error");
      return;
    }
    store.setView({}); // 触发一次渲染保证 selection 生效
    const fromTrackId = track.id;
    const original = { start: Number(clip.start) || 0, duration: clipDuration(clip), trimStart: Number(clip.trimStart) || 0, trimEnd: Number(clip.trimEnd) || 0 };
    dragRef.current = { clip, track, mode, fromTrackId, startX: event.clientX, original, last: null };
    const onMove = (moveEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaSec = (moveEvent.clientX - drag.startX) / pxPerSec;
      const targets = view.snap ? snapTargets(timeline, store.getTime(), [clip.id]) : [];
      let next = { ...drag.original };
      if (mode === "move") {
        const wanted = Math.max(0, drag.original.start + deltaSec);
        const snap = view.snap ? findSnap(wanted, targets, pxPerSec) : null;
        next.start = snap ? Math.max(0, snap.time) : wanted;
        const under = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const targetTrackId = under?.closest("[data-track-id]")?.dataset.trackId || fromTrackId;
        const targetTrack = timeline.tracks.find((item) => item.id === targetTrackId);
        next.trackId = targetTrack && targetTrack.type === track.type ? targetTrackId : fromTrackId;
        next.snap = snap;
      } else if (mode === "trim-left") {
        const maxStart = drag.original.start + drag.original.duration - 0.1;
        const wanted = Math.min(maxStart, Math.max(0, drag.original.start + deltaSec));
        const snap = view.snap ? findSnap(wanted, targets, pxPerSec) : null;
        const start = snap ? Math.min(maxStart, Math.max(0, snap.time)) : wanted;
        const shift = start - drag.original.start;
        next.start = start;
        next.duration = drag.original.duration - shift;
        next.trimStart = drag.original.trimStart + shift;
        next.snap = snap;
      } else {
        next.duration = Math.max(0.1, drag.original.duration + deltaSec);
        next.trimEnd = drag.original.trimStart + next.duration;
      }
      drag.last = next;
      setPreview({ clipId: clip.id, ...next });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const drag = dragRef.current;
      const result = drag?.last;
      dragRef.current = null;
      setPreview(null);
      if (!drag || !result) return;
      const patch = { start: result.start, duration: result.duration };
      if (drag.clip.type === "video" || drag.clip.type === "audio") {
        patch.trimStart = result.trimStart;
        patch.trimEnd = drag.mode === "trim-right" ? result.trimEnd : result.trimStart + result.duration;
      }
      store.commit(drag.mode === "move" ? "移动片段" : "裁剪片段", (doc) => {
        let nextDoc = doc;
        if (drag.mode === "move" && result.trackId !== fromTrackId) {
          nextDoc = { ...nextDoc, timeline: moveClipToTrack(nextDoc.timeline, drag.clip.id, fromTrackId, result.trackId, result.start) };
        } else {
          nextDoc = { ...nextDoc, timeline: updateClip(nextDoc.timeline, drag.clip.id, patch) };
        }
        return { ...nextDoc, selection: [drag.clip.id] };
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function split() {
    const t = store.getTime();
    const result = splitAt(timeline, t);
    if (!result) {
      store.toast("播放头不在片段内部，无法剪切", "error");
      return;
    }
    store.commit("剪切片段", (doc) => ({ ...doc, timeline: result.timeline, selection: [] }));
    store.toast(`已在 ${formatTime(t)} 剪切 ${result.count} 个片段`, "ok");
  }

  function removeSelected() {
    if (!selection.length) return;
    store.commit("删除片段", (doc) => ({ ...doc, timeline: removeClips(doc.timeline, selection), selection: [] }));
  }

  // 文字/图形片段内联编辑：一次输入会话 = 一条撤销记录
  function startEdit(clip) {
    setEditing({ id: clip.id, value: clip.text || "" });
  }

  function commitEdit() {
    if (!editing) return;
    const { id, value } = editing;
    const original = timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id);
    setEditing(null);
    if (!original || (original.text || "") === value) return;
    store.commit("编辑文字", (doc) => ({ ...doc, timeline: updateClip(doc.timeline, id, { text: value }) }));
  }

  // 独奏预览：播放器只播这一个片段（播放头仍走全局时间轴，时间线上可见进度）
  function startSolo(clip) {
    if (!clip || (clip.type !== "video" && clip.type !== "audio")) return;
    if (!clip.storageKey) { store.toast("该片段暂无可播放产物", "error"); return; }
    store.select([clip.id]);
    store.setView({ soloClipId: clip.id, playing: true });
  }

  function exitSolo() {
    store.setView({ soloClipId: null, playing: false });
  }

  // 独奏片段被删除/撤销掉时自动退回全片预览，避免播放器卡在不存在的 id 上
  useEffect(() => {
    if (view.soloClipId && !soloClip) store.setView({ soloClipId: null, playing: false });
  }, [view.soloClipId, soloClip, store]);

  // 左栏「＋添加文字」发信号：新片段立刻进入内联编辑，点完按钮即可打字
  useEffect(() => {
    if (!view.editClipId) return;
    const clip = timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === view.editClipId);
    if (clip) setEditing({ id: clip.id, value: clip.text || "" });
    store.setView({ editClipId: null });
  }, [view.editClipId, timeline, store]);

  // 轨道开关：锁定 / 可见 / 静音，均进撤销栈
  function toggleTrack(track, key) {
    const next = key === "visible" ? track.visible === false : key === "muted" ? !track.muted : !track.locked;
    const labels = { locked: "锁定轨道", visible: "切换轨道可见", muted: "切换轨道静音" };
    store.commit(labels[key], (doc) => ({ ...doc, timeline: updateTrack(doc.timeline, track.id, { [key]: next }) }));
    const stateText = key === "visible" ? (next ? "显示" : "隐藏") : key === "muted" ? (next ? "取消静音" : "静音") : (next ? "锁定" : "解锁");
    store.toast(`已${stateText}轨道「${track.name}」`, "ok");
  }

  function addTrackByType(type) {
    store.commit("添加轨道", (doc) => ({ ...doc, timeline: addTrack(doc.timeline, type) }));
    store.toast(`已添加${TRACK_LABEL[type]}轨`, "ok");
  }

  // 暴露给顶栏/快捷键：用 ref 承接，避免每层透传
  useEffect(() => {
    timelineActionsRef.current = { split, removeSelected, startSolo, exitSolo };
  });

  // 素材拖入轨道的落点判定：视频/图片素材进视频轨（图片按时长烧录静帧）、音频素材进音频轨（文字/图形轨不接收外部素材）
  function dropKindOf(event) {
    const raw = event.dataTransfer.getData("application/x-editing-source");
    if (!raw) return null;
    const item = sources[Number(raw)];
    if (!item) return null;
    const kind = mediaKindOf(item);
    return { item, kind: kind === "audio" ? "audio" : "video" };
  }

  function dropSource(event, track) {
    event.preventDefault();
    setDragOverTrack(null);
    const drop = dropKindOf(event);
    if (!drop) return;
    const { item, kind } = drop;
    if (!item.output?.storageKey && !item.storageKey) { store.toast("该素材暂无可播放产物", "error"); return; }
    if (track.type !== kind) {
      store.toast(kind === "audio"
        ? `音频素材只能落在音频轨，「${track.name}」不接收`
        : `视频/图片素材只能落在视频轨，「${track.name}」不接收`, "error");
      return;
    }
    if (track.locked) { store.toast(`轨道「${track.name}」已锁定，先解锁再拖入素材`, "error"); return; }
    const rect = lanesRef.current?.getBoundingClientRect();
    const start = Math.max(0, (event.clientX - (rect?.left || 0)) + (lanesRef.current?.scrollLeft || 0)) / pxPerSec;
    const source = sourceClipFromQueue(item);
    store.commit(kind === "audio" ? "添加音频" : "添加素材", (doc) => ({
      ...doc, timeline: addClip(doc.timeline, track.id, { ...source, start }), selection: [],
    }));
  }

  const main = mainVideoTrack(timeline);
  const flatCount = exportFlatClips(timeline).length;

  return (
    <div className="ce-timeline">
      <div className="ce-tools">
        <button className="iconbtn on" title="选择"><Icon name="pointer" /></button>
        <button className={`iconbtn ce-snap ${view.snap ? "on" : ""}`} title="吸附（Alt 临时关闭）"
          onClick={() => store.setView({ snap: !view.snap })}><Icon name="magnet" /></button>
        <button className="iconbtn" title="剪切 (S)" onClick={split}><Icon name="scissors" /></button>
        <button className="iconbtn" title="删除 (Delete)" onClick={removeSelected}><Icon name="trash" /></button>
        <span className="sep"></span>
        <button className="iconbtn" disabled={!store.canUndo()} onClick={() => store.undo()} title="撤销 (Ctrl+Z)"><Icon name="undo" /></button>
        <button className="iconbtn" disabled={!store.canRedo()} onClick={() => store.redo()} title="重做 (Ctrl+Shift+Z)"><Icon name="redo" /></button>
        <span className="bigtc">{formatTime(store.getTime(), true)}</span>
        <span className="meta">成片 {formatTime(filmDuration(timeline))} · {flatCount} 段</span>
        {soloClip && (
          <span className="ce-solo-chip" title="当前只播放选中的这一片段">
            <Icon name="play" size={10} /> 单独预览 · {soloClip.sourceTitle || "片段"} · {clipDuration(soloClip).toFixed(1)}s
            <button onClick={exitSolo} title="退出单独预览（P）"><Icon name="x" size={10} /></button>
          </span>
        )}
        <div className="zoom">
          <button className="iconbtn" title="缩小" onClick={() => setZoom(store, view.zoomIndex - 1)}><Icon name="minus" /></button>
          <input className="ce-range" type="range" min="0" max={ZOOM_LEVELS.length - 1} value={view.zoomIndex}
            style={{ "--pct": `${view.zoomIndex / (ZOOM_LEVELS.length - 1) * 100}%` }}
            onChange={(event) => store.setView({ zoomIndex: Number(event.target.value), pxPerSec: ZOOM_LEVELS[Number(event.target.value)] })} />
          <button className="iconbtn" title="放大" onClick={() => setZoom(store, view.zoomIndex + 1)}><Icon name="plus" /></button>
          <button className="ce-fit" onClick={() => fitZoom(store, lanesRef.current, duration)}>适应</button>
        </div>
      </div>
      <div className="ce-ruler" ref={rulerRef} onPointerDown={(event) => seekFromEvent(event, true)}>
        <div className="ce-corner"></div>
        <div className="ce-ruler-strip">
          {ticks.map((t) => (
            <div key={t} className={`ce-tick ${Number.isInteger(t / step) ? "" : "minor"}`}
              style={{ left: t * pxPerSec - scrollLeft }}>
              {Number.isInteger(t / step) && <small>{formatTime(t)}</small>}
            </div>
          ))}
        </div>
      </div>
      <div className="ce-tracks">
        <div className="ce-thead">
          {timeline.tracks.map((track) => (
            <div key={track.id}
              className={`ce-trk-h ${track.id === main?.id ? "active" : ""} ${view.activeTrackId === track.id ? "selected" : ""} ${track.locked ? "locked" : ""} ${track.visible === false ? "hidden-track" : ""}`}
              style={{ height: track.height, "--sem": TRACK_SEM[track.type] || "var(--v)" }}
              onClick={() => store.setView({ activeTrackId: view.activeTrackId === track.id ? null : track.id })}>
              <Icon name={TRACK_ICON[track.type] || "video"} size={14} className="ico" />
              <b>{track.name}</b>
              <span className="ops">
                <span className={track.locked ? "on" : ""} title={track.locked ? "已锁定，点击解锁" : "锁定轨道"}
                  onClick={(event) => { event.stopPropagation(); toggleTrack(track, "locked"); }}>
                  <Icon name="lock" />
                </span>
                <span className={track.visible === false ? "off" : ""} title={track.visible === false ? "已隐藏，点击显示" : "隐藏轨道"}
                  onClick={(event) => { event.stopPropagation(); toggleTrack(track, "visible"); }}>
                  <Icon name="eye" />
                </span>
                {track.type === "audio" && (
                  <span className={track.muted ? "off" : ""} title={track.muted ? "已静音，点击取消" : "静音轨道"}
                    onClick={(event) => { event.stopPropagation(); toggleTrack(track, "muted"); }}>
                    <Icon name={track.muted ? "mute" : "volume"} />
                  </span>
                )}
              </span>
            </div>
          ))}
          <div className="ce-addtrk-wrap">
            {addTrackOpen && (
              <div className="ce-addtrk-menu">
                {["text", "graphic", "video", "audio"].map((type) => (
                  <button key={type} onClick={() => { addTrackByType(type); setAddTrackOpen(false); }}>
                    <Icon name={TRACK_ICON[type]} size={13} /> {TRACK_LABEL[type]}轨
                  </button>
                ))}
              </div>
            )}
            <div className="ce-addtrk" onClick={() => setAddTrackOpen((open) => !open)}>
              <Icon name="plus" size={12} /> 添加轨道
            </div>
          </div>
        </div>
        <div className="ce-lanes" ref={lanesRef} onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}>
          <div className="ce-lanes-inner" style={{ width: contentWidth }}>
            {timeline.tracks.map((track) => (
              <div key={track.id} className={`ce-lane ${dragOverTrack === track.id ? "dragover" : ""}`} data-track-id={track.id} style={{ height: track.height }}
                onDragOver={(event) => {
                  if (track.type !== "video" && track.type !== "audio") return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDragOverTrack((current) => (current === track.id ? current : track.id));
                }}
                onDragLeave={() => setDragOverTrack((current) => (current === track.id ? null : current))}
                onDrop={(event) => dropSource(event, track)}>
                {track.clips.length === 0 && <div className="ce-lane-hint">{TRACK_HINT[track.type]}</div>}
                {track.clips.map((clip) => {
                  const shown = preview?.clipId === clip.id ? { ...clip, ...preview } : clip;
                  const width = Math.max(8, clipDuration(shown) * pxPerSec);
                  const isText = clip.type === "text" || clip.type === "graphic";
                  const playable = (clip.type === "video" || clip.type === "audio" || clip.type === "image") && Boolean(clip.storageKey);
                  const isEditing = editing?.id === clip.id;
                  // 视频片段没有海报图时用 mp4 的 <video> 首帧，底层纯色格留作加载中/失败兜底；
                  // 图片片段直接用 poster 展示静帧
                  const thumbUrls = clip.type === "video" || clip.type === "image"
                    ? resolveThumbUrls({ output: clip.output, storageKey: clip.storageKey, posterKey: clip.posterKey }, 120)
                    : { poster: "", video: "" };
                  return (
                    <Fragment key={clip.id}>
                    <div
                      className={`ce-clip c-${clip.type} ${selection.includes(clip.id) ? "sel" : ""} ${clip.enabled === false ? "disabled" : ""} ${preview?.clipId === clip.id ? "dragging" : ""} ${isEditing ? "editing" : ""}`}
                      style={{ left: (Number(shown.start) || 0) * pxPerSec, width }}
                      title={isText ? "双击编辑文字" : playable ? "双击单独播放此片段" : undefined}
                      onPointerDown={(event) => beginDrag(event, clip, track, "move")}
                      onClick={(event) => { event.stopPropagation(); store.select([clip.id]); }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (isText) startEdit(clip);
                        else if (playable) startSolo(clip);
                      }}>
                      {clip.type === "video" && (
                        <div className="thumbs">
                          {Array.from({ length: Math.min(12, Math.ceil(width / 40)) }, (_, i) => (
                            <i key={i} style={{ background: THUMB_SHADES[(i + clip.id.length) % THUMB_SHADES.length] }} />
                          ))}
                          <MediaThumb poster={thumbUrls.poster} video={thumbUrls.video} />
                        </div>
                      )}
                      {clip.type === "image" && (
                        <div className="thumbs img">
                          <MediaThumb poster={thumbUrls.poster} video={thumbUrls.video} />
                        </div>
                      )}
                      {clip.type === "audio" && <div className="wv">{Array.from({ length: Math.ceil(width / 3) }, (_, i) => (
                        <i key={i} style={{ height: 6 + (Math.sin(i * 1.7) + 1) * 10 }} />
                      ))}</div>}
                      {/* 文字/图形只渲染一行预览，不再叠加名称标签（避免文字重影） */}
                      {isText && (
                        <div className="tprev">
                          <Icon name={clip.type === "text" ? "text" : "graphic"} size={10} />
                          <span>{clip.text || (clip.type === "text" ? "文字片段" : "图形")}</span>
                        </div>
                      )}
                      {!isText && <span className="lbl">{clip.sourceTitle || clip.type}</span>}
                      <span className="dur">{clipDuration(shown).toFixed(1)}s</span>
                      <span className="ce-clip-actions">
                        {isText && (
                          <button title="编辑文字" onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => { event.stopPropagation(); startEdit(clip); }}><Icon name="text" size={10} /></button>
                        )}
                        {playable && (
                          <button title="单独播放此片段" onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => { event.stopPropagation(); startSolo(clip); }}><Icon name="play" size={10} /></button>
                        )}
                      </span>
                      <span className="handle l" onPointerDown={(event) => beginDrag(event, clip, track, "trim-left")}><u></u><u></u></span>
                      <span className="handle r" onPointerDown={(event) => beginDrag(event, clip, track, "trim-right")}><u></u><u></u></span>
                      {clip.effects?.length > 0 && <span className="ce-fxbadge"><Icon name="sparkle" size={9} /></span>}
                      {isEditing && (
                        <input className="ce-clip-input" autoFocus value={editing.value}
                          placeholder="输入文字…"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onChange={(event) => setEditing({ id: clip.id, value: event.target.value })}
                          onBlur={commitEdit}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Enter") { event.preventDefault(); commitEdit(); }
                            if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
                          }} />
                      )}
                    </div>
                    {clip.transitionOut && (
                      <span className="ce-transbadge" style={{ left: (Number(shown.start) || 0) * pxPerSec + width - 10 }}>
                        <Icon name="arrowLR" size={11} />
                      </span>
                    )}
                    </Fragment>
                  );
                })}
              </div>
            ))}
            <SnapLine store={store} timeline={timeline} pxPerSec={pxPerSec} preview={preview} />
            <Playhead store={store} pxPerSec={pxPerSec} />
            <div className="ce-playhead-anchor" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}></div>
          </div>
        </div>
      </div>
      {view.toast && <div className="ce-toast" data-tone={view.toast.tone}>{view.toast.message}</div>}
    </div>
  );
}

// 顶栏/键盘复用的动作句柄（同一个 store 只挂一份）
export const timelineActionsRef = { current: null };

function Playhead({ store, pxPerSec }) {
  const ref = useRef(null);
  useEffect(() => store.subscribeTime((t) => { if (ref.current) ref.current.style.left = `${t * pxPerSec}px`; }), [store, pxPerSec]);
  return <div className="ce-playhead" ref={ref}></div>;
}

function SnapLine({ store, timeline, pxPerSec, preview }) {
  const ref = useRef(null);
  const target = preview?.snap;
  useEffect(() => {
    if (!ref.current) return;
    if (!target) { ref.current.style.display = "none"; return; }
    ref.current.style.display = "block";
    ref.current.style.left = `${target.time * pxPerSec}px`;
  }, [target, pxPerSec]);
  return <div className="ce-snapline" ref={ref} style={{ display: "none" }}></div>;
}

function setZoom(store, index) {
  const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index));
  store.setView({ zoomIndex: next, pxPerSec: ZOOM_LEVELS[next] });
}

function fitZoom(store, lanes, duration) {
  const width = lanes?.clientWidth || 800;
  const value = Math.max(ZOOM_LEVELS[0], Math.min(ZOOM_LEVELS.at(-1), (width - 40) / Math.max(duration, 1)));
  store.setView({ pxPerSec: value, zoomIndex: ZOOM_LEVELS.findIndex((level) => level >= value) });
}

