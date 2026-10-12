import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";
import { MEDIA_THUMB_WIDTH, mediaUrl } from "../../lib/media.js";

function sourceMeta(source, record) {
  if (source === "library" || record?.libraryAssetId) return "引用";
  if (source === "upload") return "上传";
  return "生成";
}

/**
 * 资产 / 分镜侧栏生成记录区。
 * 缩略图点击仅预览；选用走 SwitchFinalModal。
 */
export function GenerationHistoryPanel({
  title = "生成记录",
  countLabel,
  switchLabel = "切换最终",
  records = [],
  locked = false,
  mediaKind = "image",
  showImport = false,
  busy = false,
  compactActions = false,
  onSwitchClick,
  onPreview,
  onDelete,
  onImport,
}) {
  const countText = countLabel
    || (mediaKind === "video"
      ? `${records.length} 次生成`
      : `${records.length} 张图片`);

  return (
    <section className={`youxi-history-block asset-generation-records${compactActions ? " asset-generation-records--compact" : ""}`}>
      <header>
        <div>
          <strong>{title}</strong>
          <span>{countText}</span>
        </div>
        <div className="youxi-history-block__actions">
          <button
            type="button"
            className="button button--primary youxi-history-switch"
            disabled={locked || busy || records.length === 0}
            title={locked ? "已锁定，无法切换最终" : switchLabel}
            onClick={onSwitchClick}
          >
            {switchLabel}
          </button>
        </div>
      </header>
      {records.length ? (
        <div className={mediaKind === "video" ? "youxi-history-grid" : "asset-generation-grid"}>
          {records.map((record) => {
            const selected = Boolean(record.selected);
            const imported = Boolean(record.imported || record.libraryAssetId);
            const canDelete = !(locked && selected);
            const thumb = mediaKind === "video"
              ? mediaUrl(record.videoPosterUrl || record.videoPosterKey || record.videoUrl || record.videoKey, { w: MEDIA_THUMB_WIDTH })
              : mediaUrl(record.url || record.storageKey, { w: MEDIA_THUMB_WIDTH });
            const videoSrc = mediaKind === "video"
              ? mediaUrl(record.videoUrl || record.videoKey)
              : null;
            const meta = mediaKind === "video"
              ? sourceMeta(record.source, record)
              : [record.resolution, sourceMeta(record.source, record)].filter(Boolean).join(" · ");
            return (
              <article className={selected ? "active" : ""} key={record.id}>
                {selected && <em className="generation-selected-badge">当前选用</em>}
                {canDelete && (
                  <button
                    type="button"
                    className="generation-delete-btn"
                    aria-label={`删除${record.label}`}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete?.(record);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
                <button
                  type="button"
                  className="generation-thumb-hit"
                  aria-label={`预览${record.label}`}
                  onClick={() => onPreview?.(record)}
                >
                  {mediaKind === "video" ? (
                    <video muted preload="metadata" poster={thumb || undefined} src={videoSrc || undefined} />
                  ) : (
                    <img src={thumb || ""} alt={record.label} />
                  )}
                </button>
                <div>
                  <strong>{record.label}</strong>
                  <span>{meta}</span>
                </div>
                {showImport && (
                  <div className="asset-record-actions">
                    <button
                      type="button"
                      className={imported ? "is-saved" : ""}
                      disabled={busy || imported}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!imported) onImport?.(record);
                      }}
                    >
                      {imported ? "已入库" : "导入素材库"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="youxi-history-empty">
          <strong>暂无生成记录</strong>
          <span>{mediaKind === "video" ? "出片成功后会出现在这里" : "生图或上传后会出现在这里"}</span>
        </div>
      )}
    </section>
  );
}

export function SwitchFinalModal({
  open,
  title = "切换最终",
  records = [],
  locked = false,
  mediaKind = "image",
  busy = false,
  onClose,
  onConfirm,
}) {
  if (!open) return null;

  const body = (
    <div
      className="drama-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <section className="drama-dialog drama-dialog--switch-final" role="dialog" aria-modal="true" aria-labelledby="switch-final-title">
        <header>
          <div>
            <span>生成记录</span>
            <h2 id="switch-final-title">{title}</h2>
          </div>
          <button type="button" aria-label="关闭" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {locked ? (
          <p className="drama-dialog__copy">已锁定，无法切换最终选用。</p>
        ) : (
          <div className={`switch-final-grid ${mediaKind === "video" ? "switch-final-grid--video" : ""}`}>
            {records.map((record) => {
              const selected = Boolean(record.selected);
              const thumb = mediaKind === "video"
                ? mediaUrl(record.videoPosterUrl || record.videoPosterKey || record.videoUrl || record.videoKey, { w: MEDIA_THUMB_WIDTH })
                : mediaUrl(record.url || record.storageKey, { w: MEDIA_THUMB_WIDTH });
              const videoSrc = mediaKind === "video"
                ? mediaUrl(record.videoUrl || record.videoKey)
                : null;
              return (
                <article className={selected ? "active" : ""} key={record.id}>
                  {mediaKind === "video" ? (
                    <video muted preload="metadata" poster={thumb || undefined} src={videoSrc || undefined} />
                  ) : (
                    <img src={thumb || ""} alt={record.label} />
                  )}
                  <div>
                    <strong>{record.label}</strong>
                    <span>{selected ? "当前选用" : "可选"}</span>
                  </div>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={busy || selected}
                    onClick={() => onConfirm?.(record)}
                  >
                    {selected ? "已是最终" : "设为最终"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
        <footer className="drama-dialog__actions">
          <button type="button" disabled={busy} onClick={onClose}>关闭</button>
        </footer>
      </section>
    </div>
  );

  return createPortal(body, document.body);
}
