import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { ASPECTS, QUALITIES, exportFlatClips, filmDuration, formatTime, migrateClips, resolutionText } from "./model.js";
import { downloadSrt, toSrt } from "./srt.js";
import { createEditingStore, useEditingStore } from "./store.js";
import Timeline, { timelineActionsRef } from "./Timeline.jsx";
import PlayerStage from "./PlayerStage.jsx";
import LeftPane from "./LeftPane.jsx";
import RightPane from "./RightPane.jsx";
import Icon from "./Icons.jsx";
import "./editing-suite.css";

const ASPECT_SHAPE = { "16:9": "r169", "9:16": "r916", "1:1": "r11", "4:3": "r43", "2.35:1": "r235" };

export default function EditingSuite({ nodeId, title, clips, sources, savedTimeline, onClose, onDraft, onExport, onRefresh }) {
  const initial = useMemo(() => savedTimeline?.version === 2
    ? savedTimeline
    : migrateClips(clips.filter((item) => item.enabled !== false)), [nodeId]);
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createEditingStore(initial);
  const store = storeRef.current;
  const state = useEditingStore(store);
  const { timeline } = state.doc;
  const view = state.view;

  // 双写：每次草稿变更同步回画布（timeline v2 + 扁平 clips[]），保证节点卡队列与后端 compose 零改动可用。
  // 跳过挂载首帧：只打开不编辑不应把画布标成「未保存」。
  const firstDraftRef = useRef(true);
  useEffect(() => {
    if (firstDraftRef.current) { firstDraftRef.current = false; return; }
    onDraft?.({ timeline, clips: exportFlatClips(timeline) });
  }, [timeline]);

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
          <button className="btn2" onClick={exportSubtitles}><Icon name="download" size={14} /> 导出字幕</button>
          <button className="btn1" disabled={view.exporting}
            onClick={() => store.setView({ dialog: { kind: "export" } })}>
            <Icon name="upload" size={14} /> {view.exporting ? "导出中…" : "导出成片"}
          </button>
        </div>
        <div className="ce-mid">
          <LeftPane store={store} sources={clipSources()} />
          <PlayerStage store={store} />
          {!view.rightCollapsed && <RightPane store={store} />}
        </div>
        <Timeline store={store} sources={clipSources()} />
      </div>
      {dialog && createPortal(
        <div className="ce-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) store.setView({ dialog: null }); }}>
          <div className="ce-dialog" role="dialog" aria-modal="true">
            {dialog.kind === "export" ? (
              <>
                <h3>导出成片</h3>
                <div className="ce-summary">
                  <div><small>时长</small><strong>{formatTime(filmDuration(timeline))}</strong></div>
                  <div><small>分辨率</small><strong>{resolutionText(timeline.aspect, timeline.quality)}</strong></div>
                  <div><small>片段数</small><strong>{flat.length}</strong></div>
                </div>
                <div className="note">按主视频轨顺序拼接（空隙压缩为 0），时长 = 各片段裁剪时长之和。文字 / 图形 / 特效 / 转场在 MVP 期导出暂不包含；导出后节点时长与分辨率会写回画布。</div>
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

  // 素材面板只接受可播放的上游视频产物（含禁用项，交给剪辑台内部决定是否添加）
  function clipSources() { return sources || clips || []; }
}
