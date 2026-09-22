import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * 与短剧「重新拆镜 / 删除分镜」一致的确认弹层，替代 window.confirm。
 */
export function ConfirmDialog({
  open,
  eyebrow = "确认",
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
      className="drama-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <section className="drama-dialog drama-dialog--confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <header>
          <div>
            <span>{eyebrow}</span>
            <h2 id="confirm-dialog-title">{title}</h2>
          </div>
          <button type="button" aria-label="关闭" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {message ? <p className="drama-dialog__copy">{message}</p> : null}
        <footer className="drama-dialog__actions">
          <button type="button" disabled={busy} onClick={onClose}>{cancelLabel}</button>
          <button
            type="button"
            className={danger ? "button button--danger" : "button button--primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? (busyLabel || "处理中…") : confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
