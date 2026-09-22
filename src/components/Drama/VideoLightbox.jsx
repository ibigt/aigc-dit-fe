import { X } from "lucide-react";
import { useEffect } from "react";

export function VideoLightbox({ preview, onClose }) {
  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview, onClose]);

  if (!preview?.src) return null;

  return (
    <div
      className="drama-lightbox"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <figure className="drama-lightbox__frame" role="dialog" aria-modal="true" aria-label={preview.title}>
        <header>
          <strong>{preview.title}</strong>
          <button type="button" aria-label="关闭视频预览" onClick={onClose}><X size={18} /></button>
        </header>
        <video
          className="drama-lightbox__video"
          controls
          autoPlay
          playsInline
          poster={preview.poster || undefined}
          src={preview.src}
        />
      </figure>
    </div>
  );
}
