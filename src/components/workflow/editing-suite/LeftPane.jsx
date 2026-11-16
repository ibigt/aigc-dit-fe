import { useMemo, useRef, useState } from "react";
import {
  ADJUST_PRESETS, EFFECT_PRESETS, GRAPHIC_PRESETS, TEXT_STYLES, TRANSITION_PRESETS,
  addClip, addTrack, applyAdjustPreset, applyEffect, applyGraphic, applyTextStyle, applyTransition,
  audioTracks, clipEnd, importedSourceFromAsset, mainVideoTrack, mediaKindOf, sourceClipFromQueue,
} from "./model.js";
import { uploadAsset } from "../../../api/assets.js";
import { probeLocalDuration } from "./localDuration.js";
import { parseSrt } from "./srt.js";
import { useEditingStore } from "./store.js";
import Icon from "./Icons.jsx";
import MediaThumb, { resolveThumbUrls } from "./MediaThumb.jsx";

// 与后端 AssetUploadPolicy 保持一致；图片可上传列示，但落轨需等静帧合成（排期 #7）
const ACCEPTED = ".mp4,.webm,.mov,.mp3,.wav,.m4a,.aac,.flac,.ogg,.jpg,.jpeg,.png,.webp,.gif";
const MAX_IMPORT_BYTES = { video: 200 * 1024 * 1024, audio: 100 * 1024 * 1024, image: 20 * 1024 * 1024 };

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

export default function LeftPane({ store, sources, onImportSources, onRemoveImported }) {
  const state = useEditingStore(store);
  const { timeline, selection } = state.doc;
  const view = state.view;
  const fileRef = useRef(null);
  const importRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const filter = view.mediaFilter || "all";
  const selectedClip = timeline.tracks.flatMap((track) => track.clips).find((item) => selection.includes(item.id)) || null;

  const visibleSources = useMemo(() => sources.filter((item) => filter === "all" || mediaKindOf(item) === filter), [sources, filter]);
  const groups = useMemo(() => {
    const map = new Map();
    for (const item of visibleSources) {
      const key = item.sourceNodeId || "source";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()];
  }, [visibleSources]);

  // 素材落轨规则：视频/图片 → 主视频轨（图片按时长烧录成静帧段），音频 → 第一条音频轨（没有就自动补一条）。
  // 起始位置取该轨现有片段的末尾，沿用「首尾相接」的直觉；音频轨可再自由拖动对齐。
  function appendSource(item) {
    if (!item?.output?.storageKey && !item?.storageKey) { store.toast("该素材暂无可播放产物", "error"); return; }
    const kind = mediaKindOf(item);
    const trackKind = kind === "audio" ? "audio" : "video";
    let target = "";
    store.commit(kind === "audio" ? "添加音频素材" : kind === "image" ? "添加图片素材" : "添加素材", (doc) => {
      let next = doc.timeline;
      let track = kind === "audio" ? audioTracks(next)[0] : mainVideoTrack(next);
      if (!track) {
        if (kind !== "audio") return doc;
        next = addTrack(next, "audio");
        track = audioTracks(next)[0];
      }
      if (!track) return doc;
      target = track.name;
      const start = track.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
      return { ...doc, timeline: addClip(next, track.id, { ...sourceClipFromQueue(item), start }), selection: [] };
    });
    // 明确告诉用户落在哪条轨道：音频不会跑到视频轨，也不用猜
    if (target) store.toast(`${kind === "audio" ? "音频" : kind === "image" ? "图片" : "视频"}素材已加入「${target}」`, "ok");
  }

  // 本地文件 → 素材库上传 → source 清单。素材只列在剪辑台草稿里，不往画布 graph 塞节点；
  // 落轨仍由用户双击 / 拖拽决定，与「上游产物自动铺 V1/A1」的口径区分开。
  async function importFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || importing) return;
    setImporting(true);
    const imported = [];
    const failures = [];
    try {
      for (const file of files) {
        const kind = fileKindOf(file.name);
        if (!kind) { failures.push(`${file.name}：格式不支持`); continue; }
        if (file.size > MAX_IMPORT_BYTES[kind]) { failures.push(`${file.name}：超过大小上限`); continue; }
        try {
          const asset = await uploadAsset(file, { name: file.name });
          // 后端 ffprobe 可能没解析出时长；本地再读一次 metadata，避免按默认 5s 落轨后
          // 导出时 ffmpeg 报「裁剪范围超过源视频时长」
          if (!(Number(asset?.durationMs) > 0) && kind !== "image") {
            const seconds = await probeLocalDuration(file, kind);
            if (seconds && asset) asset.durationMs = Math.round(seconds * 1000);
          }
          const source = importedSourceFromAsset(asset, file.name);
          if (source) imported.push(source);
          else failures.push(`${file.name}：上传未返回文件路径`);
        } catch (error) {
          failures.push(`${file.name}：${error?.message || "上传失败"}`);
        }
      }
      if (imported.length) onImportSources?.(imported);
      const parts = [];
      if (imported.length) parts.push(`已导入 ${imported.length} 个素材到素材面板，双击或拖入时间线`);
      if (failures.length) parts.push(`${failures.length} 个失败：${failures[0]}`);
      store.toast(parts.join("；") || "未导入任何素材", failures.length && !imported.length ? "error" : (failures.length ? "info" : "ok"));
    } finally {
      setImporting(false);
    }
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

  // 施加类操作统一入口：需要选中片段时给引导提示，否则执行
  function withSelection(label, action) {
    if (!selectedClip) {
      store.toast(`请先在时间线选中一个片段，再施加${label}`, "error");
      return;
    }
    action(selectedClip);
  }

  function applyEffectPreset(preset) {
    withSelection("特效", (clip) => {
      store.commit(preset.id === "none" ? "清除特效" : "施加特效", (doc) => ({
        ...doc, timeline: applyEffect(doc.timeline, clip.id, preset),
      }));
      store.toast(preset.id === "none" ? "已清除特效" : `已施加「${preset.label}」到 ${clip.sourceTitle || clip.type}`, "ok");
    });
  }

  function applyTransitionPreset(preset) {
    withSelection("转场", (clip) => {
      store.commit(preset.id === "none" ? "清除转场" : "施加转场", (doc) => ({
        ...doc, timeline: applyTransition(doc.timeline, clip.id, preset),
      }));
      store.toast(preset.id === "none" ? "已清除转场" : `已施加「${preset.label}」到 ${clip.sourceTitle || clip.type} 的右邻接缝`, "ok");
    });
  }

  function applyAdjustPresetItem(preset) {
    withSelection("调节", (clip) => {
      store.commit("施加调节", (doc) => ({ ...doc, timeline: applyAdjustPreset(doc.timeline, clip.id, preset) }));
      store.toast(`已施加「${preset.label}」到 ${clip.sourceTitle || clip.type}`, "ok");
    });
  }

  function applyTextStylePreset(preset) {
    withSelection("文字样式", (clip) => {
      store.commit("文字样式", (doc) => ({ ...doc, timeline: applyTextStyle(doc.timeline, clip.id, preset) }));
      store.toast(`已应用文字样式「${preset.label}」`, "ok");
    });
  }

  function addGraphic(preset) {
    const track = timeline.tracks.find((item) => item.type === "graphic");
    if (!track) { store.toast("图形轨不存在，请先添加图形轨", "error"); return; }
    const start = store.getTime();
    store.commit("添加图形", (doc) => ({ ...doc, timeline: applyGraphic(doc.timeline, track.id, preset, start) }));
    store.toast(`已在 ${formatStart(start)} 添加「${preset.label}」`, "ok");
  }

  function formatStart(value) {
    const m = String(Math.floor(value / 60)).padStart(2, "0");
    const s = String(Math.floor(value % 60)).padStart(2, "0");
    return `${m}:${s}`;
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
                {groups.length === 0 && <div className="ce-p2"><Icon name="film" size={24} style={{ margin: "0 auto 8px", opacity: .5 }} />暂无素材<br />在画布生成视频或音频并连到剪辑节点，或导入本地文件</div>}
                {groups.map(([key, items]) => (
                  <div key={key}>
                    <div className="ce-group">{items[0]?.sourceTitle || `节点 ${String(key).slice(-6)}`}</div>
                    <div className="ce-grid2">
                      {items.map((item, index) => {
                        const sourceIndex = sources.indexOf(item);
                        const kind = mediaKindOf(item);
                        // 视频产物大多只有 storageKey（mp4）没有海报图，交给 MediaThumb 用 <video> 取首帧
                        const { poster, video } = kind === "audio"
                          ? { poster: "", video: "" }
                          : resolveThumbUrls({ output: item.output, storageKey: item.storageKey }, 160);
                        const shade = THUMB_SHADES[index % THUMB_SHADES.length];
                        return (
                          <div key={`${key}-${index}`} className={`ce-mcard ${item.imported ? "imported" : ""}`} draggable
                            title={`${kind === "image" ? "图片" : kind === "audio" ? "音频" : "视频"}素材：拖入时间线，或双击追加`}
                            onDragStart={(event) => {
                              event.dataTransfer.setData("application/x-editing-source", String(sourceIndex));
                              event.dataTransfer.effectAllowed = "copy";
                            }}
                            onDoubleClick={() => appendSource(item)}>
                            {item.imported && (
                              <button className="ce-mcard-remove" title="从剪辑台素材清单移除（不删除素材库文件）"
                                onClick={(event) => { event.stopPropagation(); onRemoveImported?.(item.sourceNodeId); }}>
                                <Icon name="x" size={10} />
                              </button>
                            )}
                            <div className={`thumb ${kind === "audio" ? "audio" : ""}`}
                              style={kind === "audio" ? undefined : { background: shade }}>
                              {kind !== "audio" && <MediaThumb poster={poster} video={video} />}
                              {kind === "audio" && (
                                <span className="wv">{Array.from({ length: 14 }, (_, i) => (
                                  <i key={i} style={{ height: 6 + (Math.sin(i * 1.9) + 1) * 9 }} />
                                ))}</span>
                              )}
                              {kind !== "audio" && (
                                <button className="ce-add" title="添加到时间线" onClick={(event) => { event.stopPropagation(); appendSource(item); }}><Icon name="plus" size={12} /></button>
                              )}
                            </div>
                            <div className="lab">
                              <b>{item.sourceTitle || item.sourceNodeId}</b>
                              <em>{kind === "image" ? "图片" : `${clipEndSource(item).toFixed(1)}s`}</em>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="ce-hint">音频素材自动落到音频轨 A1，视频/图片素材落到主视频轨 V1（图片默认展示 5 秒，可在右侧调整）；本地导入的素材需手动加入时间线。</div>
                <input ref={importRef} type="file" accept={ACCEPTED} multiple hidden onChange={importFiles} />
                <div className={`ce-upload ${importing ? "busy" : ""}`} onClick={() => !importing && importRef.current?.click()}>
                  <Icon name="upload" size={14} /> {importing ? "上传中…" : "导入本地素材"}
                </div>
              </>
            )}

            {view.panel === "text" && (
              <>
                <button className="btn2" style={{ width: "100%", justifyContent: "center" }} onClick={addText}><Icon name="plus" size={14} /> 添加文字</button>
                <div className="ce-upload" onClick={() => fileRef.current?.click()}><Icon name="download" size={14} /> 导入字幕（SRT）</div>
                <input ref={fileRef} type="file" accept=".srt" hidden onChange={importSrt} />
                <div className="ce-group">文字样式</div>
                <div className="ce-preset-list">
                  {TEXT_STYLES.map((preset) => (
                    <button key={preset.id} className="ce-preset" disabled={!selectedClip}
                      onClick={() => applyTextStylePreset(preset)}>
                      <span className="sw" style={{ fontSize: Math.min(18, preset.fontSize), fontWeight: preset.weight, color: preset.color }}>Aa</span>
                      <em>{preset.label}</em>
                    </button>
                  ))}
                </div>
                <div className="ce-hint">先选中时间线上的文字片段，再点样式即可应用。</div>
              </>
            )}

            {view.panel === "graphic" && (
              <>
                <div className="ce-group">图形预设 · 点击添加到播放头处</div>
                <div className="ce-preset-list">
                  {GRAPHIC_PRESETS.map((preset) => (
                    <button key={preset.id} className="ce-preset" onClick={() => addGraphic(preset)}>
                      <span className="sw"><ShapeSwatch shape={preset.shape} color={preset.color} /></span>
                      <em>{preset.label}</em>
                    </button>
                  ))}
                </div>
                <div className="ce-hint">图形落在图形轨 G1，位置与大小可在右侧属性面板调整。</div>
              </>
            )}

            {view.panel === "effect" && (
              <>
                <div className="ce-group">特效 · 施加到选中片段</div>
                <div className="ce-preset-list">
                  {EFFECT_PRESETS.map((preset) => (
                    <button key={preset.id} className="ce-preset" disabled={!selectedClip}
                      onClick={() => applyEffectPreset(preset)}>
                      <span className="sw" style={{ filter: preset.cssFilter === "none" ? "none" : preset.cssFilter }}><i className="sw-img" /></span>
                      <em>{preset.label}</em>
                    </button>
                  ))}
                </div>
                <div className="ce-hint">{selectedClip ? `将施加到：${selectedClip.sourceTitle || selectedClip.type}` : "请先在时间线选中一个片段。"}</div>
              </>
            )}

            {view.panel === "transition" && (
              <>
                <div className="ce-group">转场 · 施加在选中片段与右邻之间</div>
                <div className="ce-preset-list">
                  {TRANSITION_PRESETS.map((preset) => (
                    <button key={preset.id} className="ce-preset" disabled={!selectedClip}
                      onClick={() => applyTransitionPreset(preset)}>
                      <span className="sw"><Icon name={preset.id === "none" ? "x" : "arrowLR"} size={14} /></span>
                      <em>{preset.label}{preset.duration ? ` ${preset.duration}s` : ""}</em>
                    </button>
                  ))}
                </div>
                <div className="ce-hint">转场骑缝显示在片段右边界；最后一个片段无右邻，转场不生效。</div>
              </>
            )}

            {view.panel === "adjust" && (
              <>
                <div className="ce-group">调节预设 · 施加到选中片段</div>
                <div className="ce-preset-list">
                  {ADJUST_PRESETS.map((preset) => (
                    <button key={preset.id} className="ce-preset" disabled={!selectedClip}
                      onClick={() => applyAdjustPresetItem(preset)}>
                      <span className="sw" style={{ filter: filterOfAdjust(preset.adjust) }}><i className="sw-img" /></span>
                      <em>{preset.label}</em>
                    </button>
                  ))}
                </div>
                <div className="ce-hint">预设之后可在右侧属性面板逐项微调亮度 / 对比度 / 饱和度。</div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function filterOfAdjust(adjust = {}) {
  const parts = [];
  if (Number(adjust.brightness)) parts.push(`brightness(${1 + Number(adjust.brightness) / 100})`);
  if (Number(adjust.contrast)) parts.push(`contrast(${1 + Number(adjust.contrast) / 100})`);
  if (Number(adjust.saturate)) parts.push(`saturate(${1 + Number(adjust.saturate) / 100})`);
  return parts.join(" ") || "none";
}

// 图形形状小色板（预览用，真实渲染在播放器监视器内）
function ShapeSwatch({ shape, color }) {
  if (shape === "circle") return <i className="shape shape-circle" style={{ background: color }} />;
  if (shape === "triangle") return <i className="shape shape-triangle" style={{ borderBottomColor: color }} />;
  if (shape === "arrow") return <i className="shape shape-arrow" style={{ borderLeftColor: color }} />;
  if (shape === "star") return <i className="shape shape-star" style={{ background: color }} />;
  if (shape === "line") return <i className="shape shape-line" style={{ background: color }} />;
  return <i className="shape shape-rect" style={{ background: color }} />;
}

function clipEndSource(item) {
  const start = Number(item.trimStart) || 0;
  const end = Number(item.trimEnd);
  return Number.isFinite(end) && end > start ? end - start : Number(item.output?.durationSec ?? item.output?.metadata?.durationSec) || 5;
}

// 与后端 AssetUploadPolicy 的扩展名白名单一致，前端先拦一道给出可读提示
function fileKindOf(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(ext)) return "audio";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  return "";
}
