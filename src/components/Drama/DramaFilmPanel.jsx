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

function asShotId(value) {
  if (value == null || value === "") return null;
  const id = typeof value === "number" ? value : Number(value);
  return Number.isFinite(id) ? id : null;
}

function readyShotIds(shots) {
  return (shots || [])
    .filter((item) => item.ready && item.id != null)
    .map((item) => asShotId(item.id))
    .filter((id) => id != null);
}

/** 成片对象 key 固定，需带 assembledAt 破浏览器/代理缓存，否则重拼后仍播旧片。 */
function withCacheBust(url, version) {
  if (!url) return "";
  if (!version) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(version)}`;
}

function selectedShotIds(readyIds, selectedIds) {
  return readyIds.filter((id) => selectedIds.has(id));
}

function durationOf(shots, ids) {
  const want = new Set(ids);
  return (shots || []).reduce((sum, shot) => {
    const id = asShotId(shot?.id);
    if (id == null || !want.has(id)) return sum;
    const sec = Number(shot.durationSec);
    return sum + (Number.isFinite(sec) ? sec : 0);
  }, 0);
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
  const includedIds = useMemo(
    () => (Array.isArray(film?.includedShotIds) ? film.includedShotIds.map(asShotId).filter((id) => id != null) : []),
    [film?.includedShotIds],
  );
  const includedKey = includedIds.join(",");
  const readyCount = film?.readyShotCount ?? readyIds.length;
  const filmVersion = film?.assembledAt || "";
  const filmSrc = withCacheBust(mediaUrl(film?.filmUrl), filmVersion);
  const posterSrc = withCacheBust(mediaUrl(film?.posterUrl), filmVersion);
  const captionSrc = filmSrc && film?.hasCaptions && !film?.stale
    ? authenticatedApiUrl(`/api/drama/episodes/${episodeId}/film/captions.vtt?v=${encodeURIComponent(filmVersion)}`)
    : "";

  useEffect(() => {
    if (!film) {
      setSelectedIds(new Set());
      return;
    }
    const ready = new Set(readyShotIds(film.shots));
    if (film.filmUrl && includedIds.length > 0) {
      setSelectedIds(new Set(includedIds.filter((id) => ready.has(id))));
    } else {
      setSelectedIds(new Set(ready));
    }
  }, [episodeId, film?.assembledAt, film?.filmUrl, includedKey, readyKey]);

  const assembleMutation = useMutation({
    mutationFn: (shotIds) => {
      const ids = (Array.isArray(shotIds) ? shotIds : [])
        .map(asShotId)
        .filter((id) => id != null);
      if (!ids.length) {
        return Promise.reject(new Error("请至少勾选 1 个已出片镜头再拼接"));
      }
      return assembleDramaFilm(episodeId, { shotIds: ids });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["drama-film", episodeId], data);
      queryClient.invalidateQueries({ queryKey: ["drama-series", series?.id] });
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", episodeId] });
    },
  });

  const pickedIds = selectedShotIds(readyIds, selectedIds);
  const selectedReadyCount = pickedIds.length;
  const selectedDurationSec = durationOf(shots, pickedIds);
  const includedDurationSec = durationOf(shots, includedIds);
  const selectionDiffersFromFilm = Boolean(
    filmSrc
    && includedIds.length > 0
    && (
      pickedIds.length !== includedIds.length
      || pickedIds.some((id) => !includedIds.includes(id))
      || includedIds.some((id) => !pickedIds.includes(id))
    ),
  );
  const allReadySelected = readyIds.length > 0 && readyIds.every((id) => selectedIds.has(id));
  const canAssemble = selectedReadyCount > 0 && !assembleMutation.isPending;
  const showAssemble = readyCount > 0;
  const incomplete = Boolean(film?.missingShotIndexes?.length);
  const error = filmQuery.error?.message || assembleMutation.error?.message;
  const episodeList = episodes.length ? episodes : (episode ? [episode] : []);

  function toggleShot(shotId, ready) {
    const id = asShotId(shotId);
    if (!ready || id == null) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
            const shotId = asShotId(shot.id);
            const checked = shotId != null && selectedIds.has(shotId);
            return (
              <label
                key={shot.id || shot.shotIndex}
                className={`youxi-film-shot-row ${shot.ready ? "" : "is-disabled"}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!shot.ready}
                  onChange={() => toggleShot(shotId, shot.ready)}
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
        {(film?.stale || (incomplete && readyCount > 0) || error || (showAssemble && selectedReadyCount === 0) || selectionDiffersFromFilm) && (
          <div className="youxi-film-banners">
            {film?.stale && (
              <p className="youxi-film-banner youxi-film-banner--warn">分镜视频已更新，请重新拼接</p>
            )}
            {incomplete && readyCount > 0 && (
              <p className="youxi-film-banner">
                缺镜 {film.missingShotIndexes.join("、")}，未出片镜头不可入片
              </p>
            )}
            {selectionDiffersFromFilm && (
              <p className="youxi-film-banner youxi-film-banner--warn">
                当前预览是上次成片（{includedIds.length} 镜 / {includedDurationSec}s）；已勾选 {selectedReadyCount} 镜 / {selectedDurationSec}s，点下方按钮才会按勾选重拼
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
              key={`${filmSrc}|${filmVersion}`}
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
              onClick={() => assembleMutation.mutate(pickedIds)}
            >
              <Scissors size={14} />
              {" "}
              {assembleMutation.isPending
                ? "拼接中…"
                : filmSrc
                  ? (film?.stale || selectionDiffersFromFilm ? "按勾选重新拼接" : "重新拼接成片")
                  : `拼接成片（${selectedReadyCount} 镜）`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
