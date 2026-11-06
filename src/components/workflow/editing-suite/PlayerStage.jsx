import { useEffect, useMemo, useRef, useState } from "react";
import { mediaUrl } from "../../../lib/media.js";
import { ASPECTS, clipDuration, clipEnd, formatTime, mainVideoTrack, timelineDuration } from "./model.js";
import { useEditingStore } from "./store.js";
import { timelineActionsRef } from "./Timeline.jsx";
import Icon from "./Icons.jsx";

export default function PlayerStage({ store }) {
  const state = useEditingStore(store);
  const { timeline, selection } = state.doc;
  const soloClipId = state.view.soloClipId;
  const playing = Boolean(state.view.playing);
  const [volume, setVolume] = useState(0.8);
  const videoA = useRef(null);
  const videoB = useRef(null);
  const timeRef = useRef(null);
  const subtitleRef = useRef(null);
  const activeRef = useRef({ index: -1, src: "" });
  const playingRef = useRef(false);
  playingRef.current = playing;

  // 独奏预览：只播放选中的那一个片段；playhead 仍走全局时间轴，时间线上可见进度
  const soloClip = useMemo(() => soloClipId
    ? timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === soloClipId) || null
    : null, [timeline, soloClipId]);
  const rangeStart = soloClip ? Number(soloClip.start) || 0 : 0;
  const rangeEnd = soloClip ? clipEnd(soloClip) : timelineDuration(timeline);

  const clips = useMemo(() => {
    const source = soloClip ? (soloClip.storageKey ? [soloClip] : []) : (mainVideoTrack(timeline)?.clips || []);
    return source
      .filter((clip) => clip.enabled !== false && clip.storageKey)
      .sort((a, b) => a.start - b.start)
      .map((clip) => ({ ...clip, url: mediaUrl(clip.storageKey) }));
  }, [timeline, soloClip]);
  const textClips = useMemo(() => (timeline.tracks || [])
    .filter((track) => track.type === "text")
    .flatMap((track) => track.clips.filter((clip) => clip.enabled !== false && clip.text)), [timeline]);
  const aspect = ASPECTS.find((item) => item.id === timeline.aspect) || ASPECTS[0];
  const selected = (timeline.tracks || []).flatMap((track) => track.clips).find((clip) => selection.includes(clip.id));
  const filterTarget = soloClip || selected;
  const filter = filterTarget?.adjust
    ? `brightness(${1 + (Number(filterTarget.adjust.brightness) || 0) / 100}) contrast(${1 + (Number(filterTarget.adjust.contrast) || 0) / 100}) saturate(${1 + (Number(filterTarget.adjust.saturate) || 0) / 100})`
    : "none";

  // 切换独奏对象时把播放头放到片段起点，并强制下一帧重新装载视频源
  useEffect(() => {
    activeRef.current = { index: -1, src: "" };
    store.setTime(rangeStart);
  }, [soloClipId, rangeStart, store]);

  // 播放循环：rAF 推进播放头（transient 通道），双 video 链按片段边界切换
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current && clips.length && rangeEnd > rangeStart) {
        // 独奏时播放头被夹在片段区间内；播完回到片段起点并暂停
        let t = Math.max(rangeStart, store.getTime() + dt);
        if (t >= rangeEnd) { t = rangeStart; store.setView({ playing: false }); }
        store.setTime(t);
        const index = clips.findIndex((clip) => t >= clip.start && t < clipEnd(clip));
        const video = videoA.current;
        if (video && index >= 0) {
          const clip = clips[index];
          if (activeRef.current.index !== index || activeRef.current.src !== clip.url) {
            video.src = clip.url;
            activeRef.current = { index, src: clip.url };
            video.onloadedmetadata = () => {
              try { video.currentTime = (Number(clip.trimStart) || 0) + Math.max(0, store.getTime() - clip.start); } catch { /* seek before metadata */ }
              video.play().catch(() => store.setView({ playing: false }));
            };
            video.load();
          } else {
            const expected = (Number(clip.trimStart) || 0) + (t - clip.start);
            if (Math.abs(video.currentTime - expected) > 0.35) {
              try { video.currentTime = expected; } catch { /* noop */ }
            }
            if (video.paused) video.play().catch(() => store.setView({ playing: false }));
          }
          // B 预载下一段（独奏时没有下一段）
          const next = clips[index + 1];
          if (videoB.current && next && videoB.current.dataset.src !== next.url) {
            videoB.current.dataset.src = next.url;
            videoB.current.src = next.url;
            videoB.current.load();
          }
        } else if (video && !video.paused) {
          video.pause();
        }
      } else if (!playingRef.current && videoA.current && !videoA.current.paused) {
        videoA.current.pause();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clips, timeline, store, rangeStart, rangeEnd]);

  // 时间码 / 字幕叠加：直接写 DOM，不触发 React 渲染
  useEffect(() => store.subscribeTime((t) => {
    if (timeRef.current) {
      const shown = soloClip ? t - rangeStart : t;
      const total = soloClip ? rangeEnd - rangeStart : timelineDuration(timeline);
      timeRef.current.innerHTML = `<b>${formatTime(shown)}</b> <span>/ ${formatTime(total)}</span>`;
    }
    if (subtitleRef.current) {
      const active = textClips.filter((clip) => t >= clip.start && t < clip.start + clipDuration(clip));
      subtitleRef.current.textContent = active.map((clip) => clip.text).join("\n");
    }
  }), [store, textClips, timeline, soloClip, rangeStart, rangeEnd]);

  function jump(delta) {
    const t = store.getTime();
    const marks = soloClip ? [rangeStart, rangeEnd] : [0, ...clips.map((clip) => clip.start)];
    const target = delta > 0
      ? marks.find((mark) => mark > t + 0.05)
      : [...marks].reverse().find((mark) => mark < t - 0.05);
    store.setTime(target == null ? (delta > 0 ? rangeEnd : rangeStart) : target);
  }

  function exitSolo() {
    store.setView({ soloClipId: null, playing: false });
  }

  return (
    <div className="ce-stage">
      {soloClip && (
        <div className="ce-solo-bar">
          <Icon name="play" size={12} />
          <span>单独预览 <b>{soloClip.sourceTitle || "片段"}</b> · {clipDuration(soloClip).toFixed(1)}s</span>
          <em>仅预览，不影响导出成片</em>
          <button onClick={exitSolo} title="退出单独预览 (P)"><Icon name="x" size={12} /> 退出</button>
        </div>
      )}
      <div className="ce-monitor" style={{ aspectRatio: `${aspect.w}/${aspect.h}`, "--arn": aspect.w / aspect.h }}>
        <video ref={videoA} playsInline preload="auto" style={{ filter }} />
        <video ref={videoB} playsInline preload="auto" style={{ display: "none" }} />
        {!clips.length && <div className="empty"><Icon name="film" /> 时间线为空，先添加素材</div>}
        <div className="subtitle" ref={subtitleRef}></div>
        <button className="ce-aipill" title="打开剪辑助手（P2 上线对话能力）"
          onClick={() => store.setView({ rightTab: "assistant", rightCollapsed: false })}>
          <Icon name="sparkle" size={14} /> 剪辑助手
        </button>
      </div>
      <div className="ce-transport">
        <button className="iconbtn" title="上一段" onClick={() => jump(-1)}><Icon name="skipBack" /></button>
        <button className="ce-tplay" title={playing ? "暂停 (Space)" : "播放 (Space)"}
          onClick={() => {
            if (!clips.length) { store.toast("时间线暂无可播放片段", "error"); return; }
            if (!playing && store.getTime() >= rangeEnd - 0.05) store.setTime(rangeStart);
            store.setView({ playing: !playing });
          }}>
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
        <button className="iconbtn" title="下一段" onClick={() => jump(1)}><Icon name="skipForward" /></button>
        <button className="iconbtn" title="分割 (S)" onClick={() => timelineActionsRef.current?.split()}><Icon name="scissors" /></button>
        <button className="iconbtn" title="删除选中 (Delete)" onClick={() => timelineActionsRef.current?.removeSelected()}><Icon name="trash" /></button>
        <span className="ce-spacer"></span>
        <span className="ce-tc" ref={timeRef}><b>00:00</b> <span>/ 00:00</span></span>
        <span className="ce-spacer"></span>
        <span className="ce-vol">
          <Icon name={volume ? "volume" : "mute"} size={14} />
          <input className="ce-range" type="range" min="0" max="1" step="0.05" value={volume}
            style={{ "--pct": `${volume * 100}%`, "--range-fill": "var(--t2)" }}
            onChange={(event) => { const value = Number(event.target.value); setVolume(value); if (videoA.current) videoA.current.volume = value; }} />
        </span>
      </div>
    </div>
  );
}
