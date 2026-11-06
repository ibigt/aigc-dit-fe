import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * 二次确认弹层（删除 / 取消）— 与 tongdao-ui-demo 的 .confirm-modal 对齐。
 * Props 兼容 ConfirmDialog 旧调用方（open / eyebrow / title / message 等）。
 *
 * 通用无障碍能力（对所有调用方生效，不绑定具体业务）：
 * - 打开时自动聚焦「取消」按钮（破坏性操作的安全默认）
 * - Tab / Shift+Tab 在「关闭× → 取消 → 删除」之间循环
 * - Esc = 取消并 stopPropagation，避免穿透到画布全局快捷键
 * - busy 时跳过被禁用的按钮，焦点退到弹层容器
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
  const sectionRef = useRef(null);
  const closeRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const target = cancelRef.current && !cancelRef.current.disabled ? cancelRef.current : sectionRef.current;
    target?.focus?.({ preventScroll: true });
    return undefined;
  }, [open, busy]);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      if (!busy) onClose?.();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = [closeRef.current, cancelRef.current, confirmRef.current]
      .filter((element) => element && !element.disabled);
    if (!focusables.length) { event.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !focusables.includes(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !focusables.includes(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          // 阻止 mousedown 默认行为把焦点挪到 body，交由调用方在关闭后恢复焦点
          event.preventDefault();
          onClose?.();
        }
      }}
      onKeyDown={handleKeyDown}
    >
      <section
        ref={sectionRef}
        tabIndex={-1}
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
          <button ref={closeRef} className="confirm-close" type="button" aria-label="关闭" disabled={busy} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        {message ? (
          <p id="confirm-dialog-description">{message}</p>
        ) : null}
        <footer className="confirm-footer">
          <div />
          <div className="confirm-actions">
            <button ref={cancelRef} type="button" className="modal-secondary" disabled={busy} onClick={onClose}>
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
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
