import { TRANSITION_PRESETS } from "./model.js";
import { applyAssistantBatch } from "./assistant.js";
import { useEditingStore } from "./store.js";
import Icon from "./Icons.jsx";

const ACTIONS = [
  { op: "addCaption", label: "播放头加 3 秒字幕", commit: "添加字幕", icon: "text", needsSelection: false },
  { op: "clearEffects", label: "清除选中特效", commit: "清除特效", icon: "effect", needsSelection: true },
  { op: "muteClips", label: "静音选中片段", commit: "静音片段", icon: "mute", needsSelection: true },
  { op: "packMainTrack", label: "主轨收成首尾相接", commit: "收紧主轨", icon: "magnet", needsSelection: false },
];

export default function AssistantPane({ store }) {
  const { selection } = useEditingStore(store).doc;

  function run(action, label) {
    const clipId = action.op === "addCaption" ? `clip-${Math.random().toString(36).slice(2, 9)}` : null;
    const time = store.getTime();
    let outcome = null;
    const changed = store.commit(label, (doc) => {
      outcome = applyAssistantBatch(doc.timeline, [action], { time, clipId });
      if (!outcome.ok || !outcome.changed) return doc;
      return {
        ...doc,
        timeline: outcome.timeline,
        selection: outcome.selection ?? doc.selection,
      };
    });
    if (!outcome?.ok) {
      store.toast(outcome?.error || "剪辑动作没有生效", "error");
      return;
    }
    if (!changed) {
      store.toast(outcome.message, "info");
      return;
    }
    if (outcome.editClipId) store.setView({ editClipId: outcome.editClipId, rightCollapsed: false });
    store.toast(outcome.message, "ok");
  }

  return (
    <div className="ce-assistant">
      <div className="ce-hint ce-assistant-lead">这些动作只改当前剪辑草稿，点一次记一步，Ctrl+Z 整步撤回。</div>
      <div className="ce-assistant-actions">
        {ACTIONS.map((item) => (
          <button key={item.op} className="btn2" type="button"
            onClick={() => run(
              { op: item.op, clipIds: item.needsSelection ? [...selection] : undefined },
              item.commit,
            )}>
            <Icon name={item.icon} size={14} /> {item.label}
          </button>
        ))}
      </div>
      <div className="ce-sep"></div>
      <div className="ce-grp">套用转场</div>
      <div className="ce-preset-list">
        {TRANSITION_PRESETS.map((preset) => (
          <button key={preset.id} className="ce-preset" type="button"
            onClick={() => run(
              { op: "applyTransition", presetId: preset.id, clipIds: [...selection] },
              "套用转场",
            )}>
            <span className="sw"><Icon name={preset.id === "none" ? "x" : "arrowLR"} size={14} /></span>
            <em>{preset.label}{preset.duration ? ` ${preset.duration}s` : ""}</em>
          </button>
        ))}
      </div>
    </div>
  );
}
