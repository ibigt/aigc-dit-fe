import { useEffect, useMemo, useRef, useState } from "react";
import { mediaUrl } from "../../../lib/media.js";
import {
  ASPECTS, activeClipsAt, clipDuration, clipEnd, clipFilter, formatTime, mainVideoTrack, playableAudioClips, timelineDuration,
} from "./model.js";
import { useEditingStore } from "./store.js";
import { timelineActionsRef } from "./Timeline.jsx";
import Icon from "./Icons.jsx";
import { EDITING_ASSISTANT_ENABLED } from "./flags.js";

export default function PlayerStage({ store }) {
  const state = useEditingStore(store);
  const { timeline, selection } = state.doc;
  const soloClipId = state.view.soloClipId;
  const playing = Boolean(state.view.playing);
  const [volume, setVolume] = useState(0.8);
  const videoA = useRef(null);
  const videoB = useRef(null);
  const audioEl = useRef(null);
  const timeRef = useRef(null);
  const overlayRef = useRef(null);
  const activeRef = useRef({ index: -1, src: "" });
  const playingRef = useRef(false);
  const volumeRef = useRef(0.8);
  playingRef.current = playing;
  volumeRef.current = volume;

  // 独奏预览：只播放选中的那一个片段；playhead 仍走全局时间轴，时间线上可见进度
  const soloClip = useMemo(() => soloClipId
    ? timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === soloClipId) || null
    : null, [timeline, soloClipId]);
  const rangeStart = soloClip ? Number(soloClip.start) || 0 : 0;
  const rangeEnd = soloClip ? clipEnd(soloClip) : timelineDuration(timeline);

  const clips = useMemo(() => {
    // 独奏是音频片段时，画面区留空，声音由 audioClips 单独驱动
    const source = soloClip
      ? (soloClip.type !== "audio" && soloClip.storageKey ? [soloClip] : [])
      : (mainVideoTrack(timeline)?.clips || []);
    return source
      .filter((clip) => clip.enabled !== false && clip.storageKey)
      .sort((a, b) => a.start - b.start)
      .map((clip) => ({ ...clip, url: mediaUrl(clip.storageKey) }));
  }, [timeline, soloClip]);

  // 音频轨预览：与视频共用同一个播放头。独奏音频片段时只播这一段。
  const audioClips = useMemo(() => {
    if (soloClip) return soloClip.type === "audio" && soloClip.storageKey ? [{ ...soloClip }] : [];
    return playableAudioClips(timeline);
  }, [timeline, soloClip]);
  const aspect = ASPECTS.find((item) => item.id === timeline.aspect) || ASPECTS[0];
  const selected = (timeline.tracks || []).flatMap((track) => track.clips).find((clip) => selection.includes(clip.id));
  const filterTarget = soloClip || selected;

  // 切换独奏对象时把播放头放到片段起点，并强制下一帧重新装载视频源
  useEffect(() => {
    activeRef.current = { index: -1, src: "" };
    store.setTime(rangeStart);
  }, [soloClipId, rangeStart, store]);

  // 挂载时把滑块音量同步给两个 video（默认 100% 与轨道头滑杆读数不一致）
  useEffect(() => {
    if (videoA.current) videoA.current.volume = volumeRef.current;
  }, []);

  // 播放循环：rAF 推进播放头（transient 通道），双 video 链按片段边界切换，音频轨同源跟随
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current && (clips.length || audioClips.length) && rangeEnd > rangeStart) {
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
        syncAudio(t);
      } else {
        if (videoA.current && !videoA.current.paused) videoA.current.pause();
        if (audioEl.current && !audioEl.current.paused) audioEl.current.pause();
        // 暂停 / 刚打开时把画面停在播放头所在片段的对应帧，避免监视器全黑。
        // 只接管未播放态；开始播放后上面的分支会自行换源与 seek，二者共用 activeRef 不冲突。
        const stillTime = store.getTime();
        const stillIndex = clips.findIndex((clip) => stillTime >= clip.start && stillTime < clipEnd(clip));
        const stillVideo = videoA.current;
        if (stillVideo && stillIndex >= 0) {
          const clip = clips[stillIndex];
          const expected = (Number(clip.trimStart) || 0) + Math.max(0, stillTime - clip.start);
          if (activeRef.current.src !== clip.url) {
            stillVideo.src = clip.url;
            activeRef.current = { index: stillIndex, src: clip.url };
            stillVideo.onloadedmetadata = () => {
              try { stillVideo.currentTime = expected; } catch { /* seek before metadata */ }
            };
            stillVideo.load();
          } else if (stillVideo.readyState >= 1 && Math.abs(stillVideo.currentTime - expected) > 0.35) {
            try { stillVideo.currentTime = expected; } catch { /* noop */ }
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    // 音频轨跟随：切片段换源 + seek，同片段内只做 >0.35s 的漂移校正（与视频同一套容差）
    function syncAudio(t) {
      const audio = audioEl.current;
      if (!audio) return;
      const active = audioClips.find((clip) => t >= (Number(clip.start) || 0) && t < clipEnd(clip)) || null;
      if (!active) {
        if (!audio.paused) audio.pause();
        audio.dataset.clipId = "";
        return;
      }
      audio.volume = Math.min(1, volumeRef.current * (Number.isFinite(Number(active.volume)) ? Number(active.volume) : 1));
      if (audio.dataset.clipId !== active.id) {
        audio.dataset.clipId = active.id;
        audio.src = mediaUrl(active.storageKey);
        audio.onloadedmetadata = () => {
          try { audio.currentTime = (Number(active.trimStart) || 0) + Math.max(0, store.getTime() - (Number(active.start) || 0)); } catch { /* seek before metadata */ }
          audio.play().catch(() => { /* 浏览器拦截自动播放时静默降级为静音预览 */ });
        };
        audio.load();
        return;
      }
      const expected = (Number(active.trimStart) || 0) + Math.max(0, t - (Number(active.start) || 0));
      if (Math.abs(audio.currentTime - expected) > 0.35) {
        try { audio.currentTime = expected; } catch { /* noop */ }
      }
      if (audio.paused) audio.play().catch(() => { /* noop */ });
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clips, audioClips, timeline, store, rangeStart, rangeEnd]);

  // 时间码 / 叠加层：直接写 DOM，不触发 React 渲染（60fps）
  // 叠加层 = 播放头处生效的文字 + 图形片段；文字带样式，图形按 x/y/scale/opacity 定位
  useEffect(() => store.subscribeTime((t) => {
    if (timeRef.current) {
      const shown = soloClip ? t - rangeStart : t;
      const total = soloClip ? rangeEnd - rangeStart : timelineDuration(timeline);
      timeRef.current.innerHTML = `<b>${formatTime(shown)}</b> <span>/ ${formatTime(total)}</span>`;
    }
    if (overlayRef.current) {
      const active = activeClipsAt(timeline, t);
      const html = active.map(({ clip }) => {
        if (clip.type === "text") {
          const style = clip.textStyle || {};
          const size = Number(style.fontSize) || 16;
          const color = style.color || "#ffffff";
          const weight = Number(style.weight) || 400;
          const align = style.align || "center";
          const pos = align === "left" ? "left:6%" : align === "right" ? "right:6%" : "left:50%;transform:translateX(-50%)";
          return `<div class="ce-ov-text" style="font-size:${size}px;color:${color};font-weight:${weight};text-align:${align};${pos}">${escapeHtml(clip.text || "")}</div>`;
        }
        if (clip.type === "graphic") {
          const g = clip.graphic || {};
          const color = g.color || "#6cb2ec";
          const scale = (Number(g.scale) || 100) / 100;
          const opacity = (Number(g.opacity) ?? 100) / 100;
          const left = Number(g.x) ?? 50;
          const top = Number(g.y) ?? 50;
          return `<div class="ce-ov-graphic ce-ov-shape-${g.shape || "rect"}" style="--c:${color};left:${left}%;top:${top}%;transform:translate(-50%,-50%) scale(${scale});opacity:${opacity}"></div>`;
        }
        return "";
      }).join("");
      if (overlayRef.current.innerHTML !== html) overlayRef.current.innerHTML = html;
    }
  }), [store, timeline, soloClip, rangeStart, rangeEnd]);

  // 视频滤镜：当前播放头处视频片段的调节 + 特效（未播放时回落到选中片段）
  const [liveFilter, setLiveFilter] = useState("none");
  useEffect(() => store.subscribeTime((t) => {
    const active = activeClipsAt(timeline, t).find(({ clip }) => clip.type === "video");
    const next = active ? clipFilter(active.clip) : filterTarget ? clipFilter(filterTarget) : "none";
    setLiveFilter((current) => (current === next ? current : next));
  }), [store, timeline, filterTarget]);

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
        <video ref={videoA} playsInline preload="auto" style={{ filter: liveFilter }} />
        <video ref={videoB} playsInline preload="auto" style={{ display: "none" }} />
        {/* 音频轨独立通道：与画面共用播放头，不进画面合成 */}
        <audio ref={audioEl} preload="auto" />
        {!clips.length && !audioClips.length && <div className="empty"><Icon name="film" /> 时间线为空，先添加素材</div>}
        <div className="ce-overlay" ref={overlayRef}></div>
        {EDITING_ASSISTANT_ENABLED && (
          <button className="ce-aipill" title="打开剪辑助手（下个版本上线）"
            onClick={() => store.setView({ rightTab: "assistant", rightCollapsed: false })}>
            <Icon name="sparkle" size={14} /> 剪辑助手
          </button>
        )}
      </div>
      <div className="ce-transport">
        <button className="iconbtn" title="上一段" onClick={() => jump(-1)}><Icon name="skipBack" /></button>
        <button className="ce-tplay" title={playing ? "暂停 (Space)" : "播放 (Space)"}
          onClick={() => {
            if (!clips.length && !audioClips.length) { store.toast("时间线暂无可播放片段", "error"); return; }
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
            onChange={(event) => {
              const value = Number(event.target.value);
              setVolume(value);
              volumeRef.current = value;
              if (videoA.current) videoA.current.volume = value;
              if (audioEl.current) audioEl.current.volume = value;
            }} />
        </span>
      </div>
    </div>
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}
