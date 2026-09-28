import { Music2 } from "lucide-react";

export function MediaCover({ item, alt }) {
  const label = alt || item.title || "";
  const thumb = item.thumb || item.poster || item.src;
  if (item.type === "video") {
    if (thumb) return <img src={thumb} alt={label} />;
    return <video src={item.src} muted playsInline preload="metadata" />;
  }
  if (item.type === "image") return <img src={thumb} alt={label} />;
  return (
    <div className="audio-preview">
      <Music2 size={28} />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
