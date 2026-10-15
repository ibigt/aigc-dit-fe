import { createPortal } from "react-dom";

/**
 * 二次确认弹层（删除 / 取消）— 与 tongdao-ui-demo 的 .confirm-modal 对齐。
 * Props 兼容 ConfirmDialog 旧调用方（open / eyebrow / title / message 等）。
 */
export function ConfirmDialog({
  open,
  // eyebrow 保留以兼容旧调用方，但 demo 不展示该标签
  eyebrow: _eyebrow,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  busy = false,
  busyLabel,
  danger = true,
  onClose,
  onConfirm,
}) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <section
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={message ? "confirm-dialog-description" : undefined}
      >
        <header className="confirm-header">
          <div className="confirm-title">
            <span className="confirm-warning" aria-hidden="true">!</span>
            <h2 id="confirm-dialog-title">{title}</h2>
          </div>
          <button className="confirm-close" type="button" aria-label="关闭" disabled={busy} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        {message ? (
          <p id="confirm-dialog-description">{message}</p>
        ) : null}
        <footer className="confirm-footer">
          <div />
          <div className="confirm-actions">
            <button type="button" className="modal-secondary" disabled={busy} onClick={onClose}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={danger ? "danger-button" : "modal-primary"}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? (busyLabel || "处理中…") : confirmLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
