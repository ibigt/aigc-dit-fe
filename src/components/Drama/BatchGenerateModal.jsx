import { useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * 分镜批量出片设置弹窗。
 * i2v 无上传首帧；场首 + 引用尾帧时可选「场内第一镜自动生成首帧」。
 */
export function BatchGenerateModal({
  open,
  onClose,
  onConfirm,
  supportsR2v = true,
  supportsI2v,
  selectionHasFirstInChapter,
  error = "",
  busy = false,
}) {
  const [mode, setMode] = useState("r2v");
  const [chainPrevTail, setChainPrevTail] = useState(false);
  const [i2vFirstFrameMode, setI2vFirstFrameMode] = useState("auto");
  const [firstShotAutoStill, setFirstShotAutoStill] = useState(true);
  const defaultMode = supportsR2v ? "r2v" : "i2v";

  useEffect(() => {
    if (!open) return;
    setMode(defaultMode);
    setChainPrevTail(false);
    setI2vFirstFrameMode("auto");
    setFirstShotAutoStill(true);
  }, [open, defaultMode]);

  if (!open) return null;

  const i2vPrevTail = mode === "i2v" && i2vFirstFrameMode === "prev-tail";

  function submit() {
    onConfirm?.({
      videoGenerateMode: mode,
      chainPrevTail: mode === "r2v" ? chainPrevTail : false,
      i2vFirstFrameMode: mode === "i2v" ? i2vFirstFrameMode : undefined,
      firstShotAutoStill: i2vPrevTail ? firstShotAutoStill : undefined,
    });
  }

  return (
    <div className="drama-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="drama-dialog drama-dialog--batch-generate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-generate-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>批量出片</span>
            <h2 id="batch-generate-title">批量生成镜头</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} disabled={busy}>
            <X size={16} />
          </button>
        </header>
        <div className="drama-dialog__body youxi-batch-generate-form">
          <label className="youxi-shot-model">
            <span className="youxi-shot-model-label">生成方式</span>
            <select
              aria-label="批量生成方式"
              value={mode === "i2v" && supportsI2v ? "i2v" : "r2v"}
              disabled={busy}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="r2v" disabled={!supportsR2v}>
                {supportsR2v ? "参考图" : "参考图（当前模型不支持）"}
              </option>
              <option value="i2v" disabled={!supportsI2v}>
                {supportsI2v ? "首尾帧" : "首尾帧（当前模型不支持）"}
              </option>
            </select>
          </label>

          {mode === "r2v" && (
            <label className="youxi-shot-chain">
              <input
                type="checkbox"
                checked={chainPrevTail}
                disabled={busy}
                onChange={(event) => setChainPrevTail(event.target.checked)}
              />
              应用上一镜尾帧
              {selectionHasFirstInChapter && (
                <em className="youxi-batch-generate-hint">选中含场首镜时，场首自动忽略此项</em>
              )}
            </label>
          )}

          {mode === "i2v" && supportsI2v && (
            <>
              <fieldset className="youxi-batch-generate-radios">
                <legend>首帧</legend>
                <label>
                  <input
                    type="radio"
                    name="batch-i2v-frame"
                    checked={i2vFirstFrameMode === "auto"}
                    disabled={busy}
                    onChange={() => setI2vFirstFrameMode("auto")}
                  />
                  自动生成
                </label>
                <label>
                  <input
                    type="radio"
                    name="batch-i2v-frame"
                    checked={i2vFirstFrameMode === "prev-tail"}
                    disabled={busy}
                    onChange={() => setI2vFirstFrameMode("prev-tail")}
                  />
                  引用上一镜尾帧
                </label>
              </fieldset>
              {i2vPrevTail && selectionHasFirstInChapter && (
                <label className="youxi-shot-chain">
                  <input
                    type="checkbox"
                    checked={firstShotAutoStill}
                    disabled={busy}
                    onChange={(event) => setFirstShotAutoStill(event.target.checked)}
                  />
                  场内第一镜自动生成首帧
                </label>
              )}
            </>
          )}
          {error && <p className="drama-form-error">{error}</p>}
        </div>
        <footer className="drama-dialog__actions">
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="button button--primary" disabled={busy} onClick={submit}>
            {busy ? "提交中…" : "开始批量生成"}
          </button>
        </footer>
      </div>
    </div>
  );
}
