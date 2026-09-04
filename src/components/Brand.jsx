import { Aperture } from "lucide-react";

export function Brand({ config, compact = false, showSubtitle = true, onClick }) {
  return (
    <button className={`brand ${compact ? "brand--compact" : ""}`} onClick={onClick} aria-label="返回首页">
      <span className="brand__mark"><Aperture size={compact ? 21 : 24} strokeWidth={2.3} /></span>
      <span className="brand__copy">
        <strong>{config.appName}</strong>
        {!compact && showSubtitle && <small>LIGHTFLOW STUDIO</small>}
      </span>
    </button>
  );
}
