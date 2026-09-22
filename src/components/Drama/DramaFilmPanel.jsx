import { Film, Scissors } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assembleDramaFilm, fetchDramaFilm } from "../../api/drama.js";
import { authenticatedApiUrl, mediaUrl } from "../../lib/media.js";

export async function downloadDramaFilm(filmUrl, filename = "成片.mp4") {
  const src = mediaUrl(filmUrl);
  if (!src) return;
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error("下载成片失败");
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function readyShotIds(shots) {
  return (shots || []).filter((item) => item.ready && item.id != null).map((item) => item.id);
}

export function DramaFilmPanel({ series, episode, episodes = [], onSelectEpisode }) {
  const queryClient = useQueryClient();
  const episodeId = episode?.id;
  const ratio = series?.aspectRatio || "16:9";
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const filmQuery = useQuery({
    queryKey: ["drama-film", episodeId],
    queryFn: () => fetchDramaFilm(episodeId),
    enabled: Boolean(episodeId),
  });
  const film = filmQuery.data;
  const shots = film?.shots || [];
  const readyIds = useMemo(() => readyShotIds(shots), [shots]);
  const readyKey = readyIds.join(",");
  const includedKey = (film?.includedShotIds || []).join(",");
  const readyCount = film?.readyShotCount ?? readyIds.length;
  const filmSrc = mediaUrl(film?.filmUrl);
  const posterSrc = mediaUrl(film?.posterUrl);
  const captionSrc = filmSrc && film?.hasCaptions && !film?.stale
    ? authenticatedApiUrl(`/api/drama/episodes/${episodeId}/film/captions.vtt?v=${encodeURIComponent(film?.assembledAt || "")}`)
    : "";

  useEffect(() => {
    if (!film) {
      setSelectedIds(new Set());
      return;
    }
    const included = Array.isArray(film.includedShotIds) ? film.includedShotIds : [];
    const ready = new Set(readyShotIds(film.shots));
    if (film.filmUrl && included.length > 0) {
      setSelectedIds(new Set(included.filter((id) => ready.has(id))));
    } else {
      setSelectedIds(new Set(ready));
    }
  }, [episodeId, film?.assembledAt, film?.filmUrl, includedKey, readyKey]);

  const assembleMutation = useMutation({
    mutationFn: (shotIds) => assembleDramaFilm(episodeId, { shotIds }),
    onSuccess: (data) => {
      queryClient.setQueryData(["drama-film", episodeId], data);
      queryClient.invalidateQueries({ queryKey: ["drama-series", series?.id] });
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", episodeId] });
    },
  });

  const selectedReadyCount = readyIds.filter((id) => selectedIds.has(id)).length;
  const allReadySelected = readyIds.length > 0 && readyIds.every((id) => selectedIds.has(id));
  const canAssemble = selectedReadyCount > 0 && !assembleMutation.isPending;
  const showAssemble = readyCount > 0;
  const incomplete = Boolean(film?.missingShotIndexes?.length);
  const error = filmQuery.error?.message || assembleMutation.error?.message;
  const episodeList = episodes.length ? episodes : (episode ? [episode] : []);

  function toggleShot(shotId, ready) {
    if (!ready || shotId == null) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  }

  function toggleSelectAllReady() {
    if (allReadySelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(readyIds));
  }

  return (
    <div className="drama-step youxi-film-layout">
      <aside className="youxi-chapters youxi-film-side" aria-label="成片选集">
        <div className="youxi-film-episode-picker">
          <label className="youxi-shot-model">
            <span className="youxi-shot-model-label">章节</span>
            <select
              aria-label="选择章节"
              value={episodeId ?? ""}
              disabled={!episodeList.length}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) onSelectEpisode?.(next);
              }}
            >
              {!episodeList.length && <option value="">暂无剧集</option>}
              {episodeList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || `第 ${item.episodeNumber} 集`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <header className="youxi-film-side-shots-header">
          <strong>本集镜头</strong>
          {readyIds.length > 0 && (
            <button type="button" className="youxi-film-select-all" onClick={toggleSelectAllReady}>
              {allReadySelected ? "取消全选" : "全选"}
            </button>
          )}
        </header>
        <div className="youxi-film-side-shots" aria-label="本集镜头">
          {shots.map((shot) => {
            const checked = selectedIds.has(shot.id);
            return (
              <label
                key={shot.id || shot.shotIndex}
                className={`youxi-film-shot-row ${shot.ready ? "" : "is-disabled"}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!shot.ready}
                  onChange={() => toggleShot(shot.id, shot.ready)}
                />
                <span>
                  <strong>{shot.title || `镜 ${shot.shotIndex}`}</strong>
                  <small>镜 {shot.shotIndex} · {shot.durationSec || 5}s</small>
                </span>
                <small className={shot.ready ? "is-ready" : ""}>
                  {shot.ready ? (shot.hasCaptions ? "已出片 · 字幕" : "已出片") : "未出片"}
                </small>
              </label>
            );
          })}
          {!shots.length && !filmQuery.isLoading && (
            <p className="youxi-story-side-empty">还没有分镜</p>
          )}
        </div>
      </aside>
      <section className="youxi-film-main">
        {(film?.stale || (incomplete && readyCount > 0) || error || (showAssemble && selectedReadyCount === 0)) && (
          <div className="youxi-film-banners">
            {film?.stale && (
              <p className="youxi-film-banner youxi-film-banner--warn">分镜视频已更新，请重新拼接</p>
            )}
            {incomplete && readyCount > 0 && (
              <p className="youxi-film-banner">
                缺镜 {film.missingShotIndexes.join("、")}，未出片镜头不可入片
              </p>
            )}
            {showAssemble && selectedReadyCount === 0 && (
              <p className="youxi-film-banner">请至少勾选 1 个已出片镜头再拼接</p>
            )}
            {error && <p className="drama-form-error youxi-story-error">{error}</p>}
          </div>
        )}
        <div className="youxi-final-player">
          {filmSrc ? (
            <video
              key={filmSrc}
              controls
              playsInline
              preload="metadata"
              data-ratio={ratio}
              src={filmSrc}
              poster={posterSrc || undefined}
            >
              {captionSrc && (
                <track
                  key={captionSrc}
                  kind="captions"
                  src={captionSrc}
                  srcLang="zh-CN"
                  label="中文"
                  default
                />
              )}
            </video>
          ) : (
            <div className="youxi-story-empty-preview" data-ratio={ratio}>
              <div className="youxi-story-empty-state">
                <Film size={24} />
                <strong>{filmQuery.isLoading ? "正在读取成片…" : "尚未生成成片"}</strong>
                <span>
                  {readyCount > 0
                    ? "勾选本集已出片镜头后按镜序硬切拼接"
                    : "本集分镜出片后可在此拼接并导出 MP4"}
                </span>
              </div>
            </div>
          )}
        </div>
        {showAssemble && (
          <div className="youxi-film-actions">
            <button
              className="button button--primary"
              type="button"
              disabled={!canAssemble}
              onClick={() => assembleMutation.mutate(readyIds.filter((id) => selectedIds.has(id)))}
            >
              <Scissors size={14} /> {assembleMutation.isPending ? "拼接中…" : filmSrc ? (film?.stale ? "重新拼接" : "重新拼接成片") : "拼接成片"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
