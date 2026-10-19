import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function ImageLightbox({ preview, onClose }) {
  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview, onClose]);

  if (!preview?.src || typeof document === "undefined") return null;

  const captioned = Boolean(preview.time || preview.detail);

  return createPortal(
    <div
      className={`drama-lightbox${captioned ? " drama-lightbox--caption" : ""}`}
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <figure
        className={`drama-lightbox__frame${captioned ? " drama-lightbox__frame--caption" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={preview.title || "图片预览"}
      >
        {captioned ? (
          <button type="button" className="drama-lightbox__close" aria-label="关闭放大预览" onClick={onClose}><X size={18} /></button>
        ) : (
          <header>
            <strong>{preview.title}</strong>
            <button type="button" aria-label="关闭放大预览" onClick={onClose}><X size={18} /></button>
          </header>
        )}
        <img src={preview.src} alt={preview.title || "图片预览"} onClick={captioned ? undefined : onClose} />
        {captioned && (
          <footer>
            <span>{preview.time}</span>
            <span>{preview.detail}</span>
          </footer>
        )}
      </figure>
    </div>,
    document.body,
  );
}
