import { Film, Scissors } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assembleDramaFilm, fetchDramaFilm } from "../../api/drama.js";
import { mediaUrl } from "../../lib/media.js";

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

export function DramaFilmPanel({ series, episode }) {
  const queryClient = useQueryClient();
  const episodeId = episode?.id;
  const ratio = series?.aspectRatio || "16:9";
  const filmQuery = useQuery({
    queryKey: ["drama-film", episodeId],
    queryFn: () => fetchDramaFilm(episodeId),
    enabled: Boolean(episodeId),
  });
  const film = filmQuery.data;
  const shots = film?.shots || [];
  const readyCount = film?.readyShotCount ?? shots.filter((item) => item.ready).length;
  const filmSrc = mediaUrl(film?.filmUrl);
  const posterSrc = mediaUrl(film?.posterUrl);

  const assembleMutation = useMutation({
    mutationFn: () => assembleDramaFilm(episodeId),
    onSuccess: (data) => {
      queryClient.setQueryData(["drama-film", episodeId], data);
      queryClient.invalidateQueries({ queryKey: ["drama-series", series?.id] });
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", episodeId] });
    },
  });

  const canAssemble = readyCount > 0 && !assembleMutation.isPending;
  const incomplete = Boolean(film?.missingShotIndexes?.length);
  const error = filmQuery.error?.message || assembleMutation.error?.message;

  return (
    <div className="drama-step youxi-film-layout">
      <aside className="youxi-chapters" aria-label="本集镜头">
        <header>
          <strong>本集镜头</strong>
        </header>
        <div>
          {shots.map((shot) => (
            <button type="button" key={shot.id || shot.shotIndex}>
              <span>
                <strong>{shot.title || `镜 ${shot.shotIndex}`}</strong>
                <small>镜 {shot.shotIndex} · {shot.durationSec || 5}s</small>
              </span>
              <small className={shot.ready ? "is-ready" : ""}>{shot.ready ? "已出片" : "未出片"}</small>
            </button>
          ))}
          {!shots.length && !filmQuery.isLoading && (
            <p className="youxi-story-side-empty">还没有分镜</p>
          )}
        </div>
      </aside>
      <section className="youxi-film-main">
        {(film?.stale || (incomplete && readyCount > 0) || error) && (
          <div className="youxi-film-banners">
            {film?.stale && (
              <p className="youxi-film-banner youxi-film-banner--warn">分镜视频已更新，请重新拼接</p>
            )}
            {incomplete && readyCount > 0 && (
              <p className="youxi-film-banner">
                缺镜 {film.missingShotIndexes.join("、")}，仍可先拼接预览（成片不完整）
              </p>
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
              <track kind="captions" />
            </video>
          ) : (
            <div className="youxi-story-empty-preview" data-ratio={ratio}>
              <div className="youxi-story-empty-state">
                <Film size={24} />
                <strong>{filmQuery.isLoading ? "正在读取成片…" : "尚未生成成片"}</strong>
                <span>
                  {readyCount > 0
                    ? incomplete
                      ? "已有镜头可先拼接预览，缺镜会标在清单里"
                      : "按镜序硬切拼接本集已出片镜头"
                    : "本集分镜出片后可在此拼接并导出 MP4"}
                </span>
                <button type="button" disabled={!canAssemble} onClick={() => assembleMutation.mutate()}>
                  <Scissors size={14} /> {assembleMutation.isPending ? "拼接中…" : "拼接成片"}
                </button>
              </div>
            </div>
          )}
        </div>
        {filmSrc && (
          <div className="youxi-film-actions">
            <button
              className="button button--primary"
              type="button"
              disabled={!canAssemble}
              onClick={() => assembleMutation.mutate()}
            >
              <Scissors size={14} /> {assembleMutation.isPending ? "拼接中…" : film?.stale ? "重新拼接" : "重新拼接成片"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
