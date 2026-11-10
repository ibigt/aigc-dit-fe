import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ASPECTS, QUALITIES, exportAudioClips, exportFlatClips, filmDuration, formatTime,
  inspectSourceDrift, migrateClips, normalizeImportedSources, resolutionText,
  seedAudioSources, syncTimelineSources,
} from "./model.js";
import { downloadSrt, toSrt } from "./srt.js";
import { createEditingStore, useEditingStore } from "./store.js";
import Timeline, { timelineActionsRef } from "./Timeline.jsx";
import PlayerStage from "./PlayerStage.jsx";
import LeftPane from "./LeftPane.jsx";
import RightPane from "./RightPane.jsx";
import Icon from "./Icons.jsx";
import "./editing-suite.css";

const ASPECT_SHAPE = { "16:9": "r169", "9:16": "r916", "1:1": "r11", "4:3": "r43", "2.35:1": "r235" };

export default function EditingSuite({
  nodeId, title, clips, sources, savedTimeline, savedImportedSources,
  onClose, onDraft, onExport, onRefresh,
}) {
  // 视频片段由 clips 自动聚合到 V1；音频素材只在 sources 里，需同样自动落到 A1。
  // 无草稿 / 已存草稿两条路径都同步，seedAudioSources 按上游产物 key 去重且不会把用户删掉的片段灌回来。
  // 只构造初值、不走 store.commit，故「只打开不编辑」仍不会把画布标成未保存。
  const initial = useMemo(() => {
    const base = savedTimeline?.version === 2
      ? savedTimeline
      : migrateClips(clips.filter((item) => item.enabled !== false));
    return seedAudioSources(base, sources);
  }, [nodeId]);
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createEditingStore(initial);
  const store = storeRef.current;
  const state = useEditingStore(store);
  const { timeline } = state.doc;
  const view = state.view;

  // 本地导入素材不存在于画布 graph，只随剪辑台草稿持久化（data.editing.importedSources）。
  // 与上游产物分两条链：漂移检测 / 自动铺 A1 只认 upstreamSources，避免导入项被误判成
  // 「上游产物已不存在」或每次刷新被灌回时间线。
  const [importedSources, setImportedSources] = useState(() => normalizeImportedSources(savedImportedSources));
  const upstreamSources = clipSources();
  const panelSources = useMemo(() => [...upstreamSources, ...importedSources], [upstreamSources, importedSources]);
  // props 每次渲染都是新数组，用「内容指纹」做触发条件：只有上游产物
  // （storageKey / 海报 / 标题）真的变了才回写时间线，避免每次渲染都跑同步。
  const upstreamFingerprint = useMemo(() => (upstreamSources || [])
    .map((item) => [
      item.sourceNodeId, Number(item.outputIndex) || 0,
      item.output?.storageKey || item.storageKey || "",
      item.output?.posterUrl || item.output?.posterKey || "",
      item.sourceTitle || "",
    ].join(":"))
    .sort()
    .join("|"), [upstreamSources]);
  const drift = useMemo(() => inspectSourceDrift(timeline, upstreamSources), [timeline, upstreamFingerprint]);
  const driftNotes = [
    drift.missing.length ? `${drift.missing.length} 个片段引用的上游产物已不可用（节点被删 / 连线断开 / 输出变更）` : "",
    drift.added.length ? `${drift.added.length} 个新产物已在素材面板，可拖入时间线` : "",
    drift.outdated.length ? `${drift.outdated.length} 个片段的上游产物待同步` : "",
  ].filter(Boolean);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const firstSyncRef = useRef(true);

  // 上游产物变化 → 回写媒体引用。initial 已按挂载时的 sources 构造，故跳过首帧。
  // 走 store.syncTimeline 而非 commit：刷新是跟随外部状态，不进撤销栈、不标 dirty。
  // effect 只由上游指纹 / 刷新计数触发，undo 改 timeline 不会重新触发，
  // 不会出现「撤销又被拉回」的循环；用户点刷新时用 refreshTick 在最新 props 下强制再同步一次。
  useEffect(() => {
    if (firstSyncRef.current) { firstSyncRef.current = false; return; }
    const current = store.getState().doc.timeline;
    const result = syncTimelineSources(current, upstreamSources);
    if (result.timeline === current) return;
    store.syncTimeline(result.timeline);
    const parts = [];
    if (result.updated) parts.push(`更新 ${result.updated} 个片段的媒体引用`);
    if (result.addedAudio) parts.push(`补入 ${result.addedAudio} 段音频到 A1`);
    store.toast(`已同步最新产物：${parts.join("、") || "时间线已更新"}`, "ok");
  }, [upstreamFingerprint, refreshTick]);

  async function refreshSources() {
    if (refreshing || !onRefresh) return;
    setRefreshing(true);
    try {
      const ok = await onRefresh();
      if (ok === false) {
        store.toast("刷新失败：画布可能还没有运行记录，或网络异常，请稍后重试", "error");
        return;
      }
      // onRefresh 内部 setNodes 可能与本次渲染合并；计数触发的这次渲染必定带上
      // 最新 sources，effect 里的同步因此拿到的不会是过期闭包。
      setRefreshTick((value) => value + 1);
      store.toast("已重新拉取运行产物", "ok");
    } catch (error) {
      store.toast(`刷新失败：${error?.message || "请重试"}`, "error");
    } finally {
      setRefreshing(false);
    }
  }

  // 双写：每次草稿变更同步回画布（timeline v2 + 扁平 clips[] + audioClips[] + 导入清单）。
  // audioClips 是音频轨的扁平导出，后端 compose 据此把 A1 混入成片（amix）。
  // importedSources 独立持久化，否则关闭剪辑台后本地素材就只剩时间线里的片段、素材面板空了。
  // 跳过挂载首帧：只打开不编辑不应把画布标成「未保存」。
  const firstDraftRef = useRef(true);
  useEffect(() => {
    if (firstDraftRef.current) { firstDraftRef.current = false; return; }
    onDraft?.({
      timeline,
      clips: exportFlatClips(timeline),
      audioClips: exportAudioClips(timeline),
      importedSources,
    });
  }, [timeline, importedSources]);

  // 导入清单变更是用户操作：去重后追加，标脏交给上面的草稿双写统一完成。
  function addImportedSources(items) {
    if (!Array.isArray(items) || !items.length) return;
    setImportedSources((current) => normalizeImportedSources([...current, ...items]));
    store.setView({ panel: "media", leftCollapsed: false });
  }

  function removeImportedSource(sourceNodeId) {
    setImportedSources((current) => current.filter((item) => item.sourceNodeId !== sourceNodeId));
    store.toast("已从剪辑台素材清单移除；已落轨的片段不受影响", "ok");
  }

  // 键盘域：capture 阶段吃掉全部按键，杜绝与画布撤销栈/删除快捷键串台
  useEffect(() => {
    const onKeyDown = (event) => {
      if (view.dialog) {
        if (event.key === "Escape") store.setView({ dialog: null });
        event.stopPropagation();
        return;
      }
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      // 输入框内直接放行：capture 阶段 stopPropagation 会吞掉 React 合成键盘事件，
      // 导致文字/参数框无法输入或无法用 Esc/Enter 收尾；且 Ctrl+Z 应交给浏览器逐字撤销。
      // 画布快捷键在剪辑台打开时本就冻结（WorkflowStudio keydown 早退），无需再拦。
      if (inInput) return;
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? store.redo() : store.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); store.redo(); return; }
      if (event.key === " ") { event.preventDefault(); store.setView({ playing: !view.playing }); return; }
      if (event.key.toLowerCase() === "s") { event.preventDefault(); timelineActionsRef.current?.split(); return; }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); timelineActionsRef.current?.removeSelected(); return; }
      if (event.key.toLowerCase() === "p") { event.preventDefault(); toggleSolo(); return; }
      if (event.key === "Escape") { requestClose(); return; }
      if (event.key === "?") store.toast("快捷键：Space 播放 / S 剪切 / Delete 删除 / P 单独播放 / Ctrl+Z 撤销 / Ctrl+Shift+Z 重做", "info");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  // P：切换「单独播放选中片段」；再次按 P 或点退出回到全片预览
  function toggleSolo() {
    const actions = timelineActionsRef.current;
    if (view.soloClipId) { actions?.exitSolo(); return; }
    const selectedId = state.doc.selection[0];
    const clip = selectedId
      ? state.doc.timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === selectedId)
      : null;
    if (!clip) { store.toast("请先在时间线选中一个视频或音频片段，再按 P 单独播放", "error"); return; }
    if (clip.type !== "video" && clip.type !== "audio") { store.toast("文字 / 图形片段双击即可编辑，单独播放仅支持视频与音频", "error"); return; }
    actions?.startSolo(clip);
  }

  function requestClose() {
    if (view.dirty) {
      store.setView({ dialog: { kind: "leave" } });
      return;
    }
    onClose?.();
  }

  function exportSubtitles() {
    const textClips = timeline.tracks.filter((track) => track.type === "text")
      .flatMap((track) => track.clips).filter((clip) => (clip.text || "").trim());
    if (!textClips.length) {
      store.toast("时间线暂无字幕片段", "error");
      store.setView({ panel: "text", leftCollapsed: false });
      return;
    }
    downloadSrt(`${title || "剪辑台"}.srt`, toSrt(textClips));
    store.toast(`已导出 ${textClips.length} 条字幕`, "ok");
  }

  async function confirmExport() {
    const flat = exportFlatClips(timeline);
    if (!flat.length) { store.toast("主视频轨暂无可导出片段", "error"); store.setView({ dialog: null }); return; }
    store.setView({ dialog: null, exporting: true, soloClipId: null, playing: false });
    try {
      await onExport?.({
        timeline,
        clips: flat,
        aspect: timeline.aspect,
        quality: timeline.quality,
        resolution: resolutionText(timeline.aspect, timeline.quality),
        durationSec: filmDuration(timeline),
      });
      store.markClean();
      store.toast("成片导出完成，节点时长与分辨率已更新", "ok");
      onRefresh?.();
    } catch (error) {
      store.toast(`导出失败：${error?.message || "请重试"}（原状态已保留）`, "error");
    } finally {
      store.setView({ exporting: false });
    }
  }

  const flat = exportFlatClips(timeline);
  const dialog = view.dialog;

  return createPortal(
    <>
      <div className="editing-suite-backdrop" />
      <div className="editing-suite" role="dialog" aria-modal="true" aria-label="独立剪辑台">
        <div className="ce-topbar">
          <button className="iconbtn" onClick={requestClose} title="返回画布"><Icon name="back" /></button>
          <span className="title">{title || "视频剪辑"} · 剪辑台 {view.dirty && <i className="ce-dot" title="有未导出的修改" />}</span>
          <span className="ce-spacer"></span>
          <div className="ce-aspect" role="group" aria-label="画幅">
            {ASPECTS.map((aspect) => (
              <button key={aspect.id} className={timeline.aspect === aspect.id ? "on" : ""}
                title={`画幅 ${aspect.id}`}
                onClick={() => store.commit("切换画幅", (doc) => ({ ...doc, timeline: { ...doc.timeline, aspect: aspect.id } }))}>
                <i className={ASPECT_SHAPE[aspect.id]}></i><span>{aspect.label}</span>
              </button>
            ))}
          </div>
          <select className="ce-quality" value={timeline.quality}
            onChange={(event) => store.commit("切换清晰度", (doc) => ({ ...doc, timeline: { ...doc.timeline, quality: event.target.value } }))}>
            {QUALITIES.map((quality) => <option key={quality} value={quality}>{quality}</option>)}
          </select>
          <span className="ce-spacer"></span>
          <button className="iconbtn" disabled={!store.canUndo()} onClick={() => store.undo()} title="撤销 (Ctrl+Z) · 仅剪辑台内有效"><Icon name="undo" /></button>
          <button className="iconbtn" disabled={!store.canRedo()} onClick={() => store.redo()} title="重做 (Ctrl+Shift+Z) · 仅剪辑台内有效"><Icon name="redo" /></button>
          <button className="btn2" disabled={refreshing || !onRefresh} onClick={refreshSources}
            title="重新拉取运行结果：上游重新生成过或产物地址过期时，用最新产物同步时间线（不改动已编排的裁剪 / 位置 / 参数）">
            <Icon name="refresh" size={13} /> {refreshing ? "刷新中…" : "刷新产物"}
          </button>
          <button className="btn2" onClick={exportSubtitles}><Icon name="download" size={14} /> 导出字幕</button>
          <button className="btn1" disabled={view.exporting}
            onClick={() => store.setView({ dialog: { kind: "export" } })}>
            <Icon name="upload" size={14} /> {view.exporting ? "导出中…" : "导出成片"}
          </button>
        </div>
        {driftNotes.length > 0 && (
          <div className="ce-source-banner" data-tone={drift.missing.length ? "warn" : "info"}>
            <Icon name="refresh" size={13} />
            <span>{driftNotes.join("；")}。上游重新生成后点「刷新产物」拉取最新结果；已存在的片段不会被重排。</span>
            <button className="btn2" disabled={refreshing || !onRefresh} onClick={refreshSources}>
              {refreshing ? "刷新中…" : "刷新产物"}
            </button>
          </div>
        )}
        <div className="ce-mid">
          <LeftPane store={store} sources={panelSources}
            onImportSources={addImportedSources} onRemoveImported={removeImportedSource} />
          <PlayerStage store={store} />
          {!view.rightCollapsed && <RightPane store={store} />}
        </div>
        <Timeline store={store} sources={panelSources} />
      </div>
      {dialog && createPortal(
        <div className="ce-portal ce-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) store.setView({ dialog: null }); }}>
          <div className="ce-dialog" role="dialog" aria-modal="true">
            {dialog.kind === "export" ? (
              <>
                <h3>导出成片</h3>
                <div className="ce-summary">
                  <div><small>时长</small><strong>{formatTime(filmDuration(timeline))}</strong></div>
                  <div><small>分辨率</small><strong>{resolutionText(timeline.aspect, timeline.quality)}</strong></div>
                  <div><small>片段数</small><strong>{flat.length}</strong></div>
                </div>
                <div className="note">按主视频轨顺序拼接（空隙压缩为 0），时长 = 各片段裁剪时长之和；音频轨片段按其在时间线上的位置混入成片，本地导入的素材同样参与合成。文字 / 图形 / 特效 / 转场在 MVP 期导出暂不包含（剪辑台内预览可见）；导出后节点时长与分辨率会写回画布。</div>
                <div className="actions">
                  <button className="btn2" onClick={() => store.setView({ dialog: null })}>取消</button>
                  <button className="btn1" onClick={confirmExport}>确认导出</button>
                </div>
              </>
            ) : (
              <>
                <h3>退出剪辑台？</h3>
                <div className="note">有未导出的修改。草稿已保留在节点上，画布上的成片仍是上一次导出的旧版；返回后不会丢失本次编辑。</div>
                <div className="actions">
                  <button className="btn2" onClick={() => store.setView({ dialog: null })}>继续编辑</button>
                  <button className="btn1" onClick={() => onClose?.()}>退出</button>
                </div>
              </>
            )}
          </div>
        </div>, document.body)}
    </>,
    document.body,
  );

  // 画布上游清单（视频 + 音频）：时间线初值、漂移检测、自动铺 A1 都只认它。
  // 本地导入素材走 panelSources，绝不混进来。与时间线初值分开也避免音频被塞进 migrateClips 的 V1。
  function clipSources() { return sources || clips || []; }
}
