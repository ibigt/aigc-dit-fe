import { Music2 } from "lucide-react";

export function MediaCover({ item, alt }) {
  const label = alt || item.title || "";
  if (item.type === "video") {
    if (item.poster) return <img src={item.poster} alt={label} />;
    return <video src={item.src} muted playsInline preload="metadata" />;
  }
  if (item.type === "image") return <img src={item.src} alt={label} />;
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
