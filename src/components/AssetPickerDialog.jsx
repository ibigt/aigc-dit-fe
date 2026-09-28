import { AudioLines, Check, X } from "lucide-react";
import { assetSelectionAtLimit, sameAsset } from "../lib/assetPicker.js";
import { MEDIA_THUMB_WIDTH, mediaUrl } from "../lib/media.js";

export function AssetPickerDialog({ assets = [], selectedItems = [], onToggle, onClose, onConfirm, title = "选择引用素材", hint, emptyText = "暂无可用素材", loading = false, error = "", maxSelection }) {
  return (
    <div className="creation-asset-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="creation-asset-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title">
        <header>
          <div><small>素材库</small><h2 id="asset-picker-title">{title}</h2></div>
          <button type="button" aria-label="关闭素材选择" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="creation-asset-grid">
          {loading && <p className="creation-asset-empty">素材加载中…</p>}
          {!loading && error && <p className="creation-asset-empty">{error}</p>}
          {!loading && !error && !assets.length && <p className="creation-asset-empty">{emptyText}</p>}
          {!loading && !error && assets.map((asset) => {
            const label = asset.title || asset.name;
            const preview = mediaUrl(asset.poster || asset.posterUrl || asset.src || asset.url || asset.storageKey, { w: MEDIA_THUMB_WIDTH });
            const type = asset.type || asset.kind;
            const selected = selectedItems.some((item) => sameAsset(item, asset));
            const atLimit = assetSelectionAtLimit(selectedItems, asset, maxSelection);
            return (
              <button type="button" className={selected ? "selected" : ""} key={asset.id || asset.storageKey || preview} aria-pressed={selected} disabled={atLimit} title={atLimit ? `最多选择 ${maxSelection} 项` : undefined} onClick={() => onToggle(asset)}>
                {type === "audio" ? <AudioLines size={28} /> : <img src={preview} alt={label} />}
                <span><strong>{label}</strong><small>{type === "audio" ? "音频素材" : type === "video" ? "视频素材" : "图片素材"}</small></span>
                {selected && <span className="creation-asset-check" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>}
              </button>
            );
          })}
        </div>
        <footer>
          <span>{hint ? `${hint} · 已选择 ${selectedItems.length}${maxSelection ? `/${maxSelection}` : ""} 项` : `已选择 ${selectedItems.length}${maxSelection ? `/${maxSelection}` : ""} 项`}</span>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" className="primary" onClick={onConfirm}>确认</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
