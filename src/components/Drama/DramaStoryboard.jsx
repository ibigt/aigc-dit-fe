import { Film, Lock, RefreshCw, Sparkles, Video, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bindDramaVideoModel,
  compileDramaStoryboard,
  draftDramaStoryboard,
  fetchDramaStoryboard,
  fetchDramaVideoModels,
  generateDramaShot,
  pollDramaShotGenerate,
  updateDramaShot,
} from "../../api/drama.js";
import { mediaUrl } from "../../lib/media.js";

const DURATIONS = [5, 10, 15];

function statusLabel(status) {
  if (status === "已锁定") return "已确认";
  return status || "未开始";
}

function shotLine(shot) {
  return shot?.dialogue || shot?.narrativeGoal || shot?.scene || "";
}

function posterOf(shot) {
  const ref = (shot?.references || []).find((item) => item.imageUrl);
  return ref?.imageUrl || "";
}

function pictureRefs(shot) {
  return (shot?.references || []).filter((item) => item?.assetId);
}

export function dramaStoryboardStatus(board) {
  return board?.status || "未开始";
}

function ShotInspector({ selected, generating, onSave }) {
  if (!selected) {
    return (
      <aside className="youxi-inspector youxi-story-inspector">
        <div className="youxi-inspector-tabs">
          <button type="button" className="active">本镜</button>
        </div>
        <div className="youxi-inspector-scroll">
          <p className="youxi-story-side-empty">选中分镜后，台词与角色会显示在这里</p>
        </div>
      </aside>
    );
  }
  const refs = pictureRefs(selected);
  return (
    <aside className="youxi-inspector youxi-story-inspector">
      <div className="youxi-inspector-tabs">
        <button type="button" className="active">本镜</button>
      </div>
      <div className="youxi-inspector-scroll">
        <label className="youxi-field">
          <span>台词 / 剧本</span>
          <small>镜 {selected.shotIndex}</small>
          <textarea
            rows={5}
            disabled={generating}
            defaultValue={shotLine(selected)}
            key={`${selected.id}:${selected.dialogue || ""}:${selected.narrativeGoal || ""}`}
            onBlur={(event) => {
              const value = event.target.value;
              if (value === shotLine(selected)) return;
              onSave(selected, { dialogue: value }).catch(() => {});
            }}
            placeholder="当前镜头尚未填写台词或画面描述"
          />
        </label>
        {selected.narrativeGoal && selected.narrativeGoal !== selected.dialogue && (
          <p className="youxi-story-goal">{selected.narrativeGoal}</p>
        )}
        <section className="youxi-story-cast">
          <header>
            <strong>角色 / 场景 / 道具</strong>
          </header>
          <div className="youxi-story-meta">
            {(selected.characterNames || []).map((name) => (
              <em key={`c-${name}`}>角色 · {name}</em>
            ))}
            {selected.locationName && <em>场景 · {selected.locationName}</em>}
            {(selected.propNames || []).map((name) => (
              <em key={`p-${name}`}>道具 · {name}</em>
            ))}
            {!selected.characterNames?.length && !selected.locationName && !selected.propNames?.length && (
              <em>未提取角色/场景/道具</em>
            )}
          </div>
        </section>
        {selected.unboundNames?.length > 0 && (
          <p className="drama-form-error">未锁定：{selected.unboundNames.join("、")}</p>
        )}
        {selected.compiledStale && (
          <p className="drama-form-error">身份或风格已变，旧 prompt 已作废，请重新编译后再出片。</p>
        )}
        <div className="youxi-story-refs">
          <span>本镜参考图（出片按 Picture 序号自动绑定）</span>
          <div>
            {refs.map((ref) => (
              <figure key={ref.assetId} className="is-on">
                {ref.imageUrl ? <img src={mediaUrl(ref.imageUrl) || ref.imageUrl} alt="" /> : <i />}
                <b>Picture {ref.pictureIndex}</b>
                {ref.name}
                <small>{ref.type}{ref.locked === false ? " · 未锁定" : ""}</small>
              </figure>
            ))}
            {!refs.length && (
              <em>锁定本镜角色 / 场景 / 道具后，出片会自动带上对应参考图</em>
            )}
          </div>
        </div>
        <label className="youxi-field">
          <span>视频提示词</span>
          <small>由编译器生成，不可手写</small>
          <textarea readOnly rows={8} value={selected.compiledPrompt || "尚未编译"} />
        </label>
      </div>
    </aside>
  );
}

export function DramaStoryboard({ series, episode }) {
  const queryClient = useQueryClient();
  const seriesId = series?.id;
  const episodes = series?.episodes?.length ? series.episodes : (episode ? [episode] : []);
  const [episodeId, setEpisodeId] = useState(episode?.id || episodes[0]?.id || null);
  const [shotId, setShotId] = useState(null);
  const [videoModelId, setVideoModelId] = useState(series?.videoModelId || "");
  const [busy, setBusy] = useState({});
  const [actionError, setActionError] = useState("");

  const activeEpisode = episodes.find((item) => item.id === episodeId) || episodes[0] || episode;
  const activeEpisodeId = activeEpisode?.id;

  useEffect(() => {
    if (episode?.id && !episodes.some((item) => item.id === episodeId)) {
      setEpisodeId(episode.id);
    }
  }, [episode?.id, episodeId, episodes]);

  useEffect(() => {
    setVideoModelId(series?.videoModelId || "");
  }, [series?.videoModelId]);

  const videoModelsQuery = useQuery({
    queryKey: ["drama-video-models"],
    queryFn: fetchDramaVideoModels,
  });
  const boardQuery = useQuery({
    queryKey: ["drama-storyboard", activeEpisodeId],
    queryFn: () => fetchDramaStoryboard(activeEpisodeId),
    enabled: Boolean(activeEpisodeId),
  });

  const board = boardQuery.data;
  const chapters = board?.chapters || [];
  const shots = useMemo(() => chapters.flatMap((item) => item.shots || []), [chapters]);
  const lockedAssets = board?.lockedAssets || [];
  const selected = shots.find((item) => item.id === shotId) || shots[0];
  const scriptLocked = activeEpisode?.status === "已锁定";
  const videoModels = videoModelsQuery.data || [];
  const ratio = series?.aspectRatio || "16:9";

  useEffect(() => {
    if (!selected?.id) return;
    if (shotId !== selected.id) setShotId(selected.id);
  }, [selected?.id, shotId]);

  const draftMutation = useMutation({
    mutationFn: () => draftDramaStoryboard(activeEpisodeId),
    onSuccess: (data) => {
      queryClient.setQueryData(["drama-storyboard", activeEpisodeId], data);
      queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
      setShotId(data?.chapters?.[0]?.shots?.[0]?.id || null);
      setActionError("");
    },
    onError: (error) => setActionError(error.message || "拆镜失败"),
  });

  const compileAllMutation = useMutation({
    mutationFn: () => compileDramaStoryboard(activeEpisodeId),
    onSuccess: (data) => {
      queryClient.setQueryData(["drama-storyboard", activeEpisodeId], data);
      setActionError("");
    },
    onError: (error) => setActionError(error.message || "编译失败"),
  });

  const bindMutation = useMutation({
    mutationFn: (id) => bindDramaVideoModel(seriesId, Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
      setActionError("");
    },
    onError: (error) => setActionError(error.message || "绑定视频模型失败"),
  });

  function patchShot(next) {
    if (!next?.id) return;
    queryClient.setQueryData(["drama-storyboard", activeEpisodeId], (current) => {
      if (!current?.chapters) return current;
      return {
        ...current,
        chapters: current.chapters.map((chapter) => ({
          ...chapter,
          shots: (chapter.shots || []).map((shot) => (shot.id === next.id ? { ...shot, ...next } : shot)),
        })),
      };
    });
  }

  async function runShot(id, key, task) {
    setBusy((current) => ({ ...current, [id]: key }));
    setActionError("");
    try {
      const result = await task();
      patchShot(result?.shot || result);
      return result;
    } catch (error) {
      setActionError(error.message || "操作失败");
      throw error;
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }

  async function saveShot(shot, patch) {
    const payload = {
      durationSec: patch.durationSec ?? shot.durationSec ?? 5,
      dialogue: patch.dialogue ?? shot.dialogue ?? "",
      continuityIn: patch.continuityIn ?? shot.continuityIn ?? "",
      continuityOut: patch.continuityOut ?? shot.continuityOut ?? "",
    };
    return runShot(shot.id, "save", () => updateDramaShot(shot.id, payload));
  }

  async function generate(shot) {
    if (!shot?.id) return;
    setBusy((current) => ({ ...current, [shot.id]: "generate" }));
    setActionError("");
    try {
      const result = await generateDramaShot(shot.id);
      patchShot(result?.shot || result);
      if (result?.task?.id) {
        const done = await pollDramaShotGenerate(shot.id, result.task.id);
        patchShot(done?.shot || done);
        if (done?.task?.status === "FAILED") {
          setActionError(done.task.errorMessage || "出片失败");
        }
      }
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
    } catch (error) {
      setActionError(error.message || "出片失败");
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[shot.id];
        return next;
      });
    }
  }

  useEffect(() => {
    if (!selected?.generating || !selected?.genTaskId || busy[selected.id]) return undefined;
    let cancelled = false;
    setBusy((current) => ({ ...current, [selected.id]: "generate" }));
    pollDramaShotGenerate(selected.id, selected.genTaskId)
      .then((done) => {
        if (cancelled) return;
        patchShot(done?.shot || done);
        if (done?.task?.status === "FAILED") {
          setActionError(done.task.errorMessage || "出片失败");
        }
        queryClient.invalidateQueries({ queryKey: ["drama-storyboard", activeEpisodeId] });
      })
      .catch((error) => {
        if (!cancelled) setActionError(error.message || "出片失败");
      })
      .finally(() => {
        if (cancelled) return;
        setBusy((current) => {
          const next = { ...current };
          delete next[selected.id];
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.generating, selected?.genTaskId]);

  const generating = Boolean(selected && (busy[selected.id] === "generate" || selected.generating));
  const error = boardQuery.error || bindMutation.error || (actionError ? { message: actionError } : null);
  const videoSrc = mediaUrl(selected?.videoUrl || selected?.videoKey);

  return (
    <section className="youxi-storyboard-layout youxi-storyboard-layout--board">
      <aside className="youxi-chapters" aria-label="集数">
        <header>
          <strong>集数</strong>
        </header>
        <div>
          {episodes.map((item) => (
            <button
              type="button"
              key={item.id}
              className={activeEpisodeId === item.id ? "active" : ""}
              onClick={() => {
                setEpisodeId(item.id);
                setShotId(null);
                setActionError("");
              }}
            >
              <span>
                <strong>{item.name || `第 ${item.episodeNumber} 集`}</strong>
                <small>{statusLabel(item.status)}</small>
              </span>
            </button>
          ))}
          {!episodes.length && <p className="youxi-story-side-empty">暂无剧集</p>}
        </div>
      </aside>

      <div className="youxi-shots-center">
        <div className="youxi-shot-center-toolbar">
          <div>
            <label className="youxi-shot-model">
              视频模型
              <select
                aria-label="分镜视频模型"
                value={videoModelId}
                onChange={(event) => {
                  const value = event.target.value;
                  setVideoModelId(value);
                  if (value) bindMutation.mutate(value);
                }}
              >
                <option value="">{videoModels.length ? "请选择视频模型" : "暂无已启用 r2v 模型"}</option>
                {series?.videoModelId && !videoModels.some((item) => String(item.id) === String(series.videoModelId)) && (
                  <option value={series.videoModelId}>{series.videoModelName || "已绑定（当前已停用）"}</option>
                )}
                {videoModels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.provider ? ` · ${item.provider}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <label className="youxi-shot-model">
                时长
                <select
                  aria-label="本镜时长"
                  value={selected.durationSec || 5}
                  disabled={generating}
                  onChange={(event) => saveShot(selected, { durationSec: Number(event.target.value) }).catch(() => {})}
                >
                  {DURATIONS.map((item) => (
                    <option key={item} value={item}>{item} 秒</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div>
            <button
              type="button"
              disabled={compileAllMutation.isPending || !shots.length}
              onClick={() => compileAllMutation.mutate()}
            >
              <RefreshCw size={14} /> {compileAllMutation.isPending ? "编译中…" : "重新编译"}
            </button>
            <button
              type="button"
              disabled={draftMutation.isPending || !scriptLocked}
              onClick={() => draftMutation.mutate()}
            >
              <Wand2 size={14} /> {draftMutation.isPending ? "拆镜中…" : shots.length ? "重新拆镜" : "智能分镜"}
            </button>
            <button
              className="youxi-toolbar-primary"
              type="button"
              disabled={!selected || generating || !videoModelId}
              onClick={() => generate(selected)}
            >
              <Video size={14} /> {generating ? "出片中…" : "生成当前镜头"}
            </button>
          </div>
        </div>

        <div className="youxi-shots-center__body">
        <div className="youxi-story-banners">
        {!scriptLocked && (
          <div className="drama-asset-gate youxi-story-gate">
            <Lock size={16} />
            <div>
              <strong>先锁定分场剧本</strong>
              <p>剧本锁定后才能拆分镜。未锁定主体不能作为参考图。</p>
            </div>
          </div>
        )}

        {scriptLocked && lockedAssets.length === 0 && (
          <div className="drama-asset-gate youxi-story-gate">
            <Lock size={16} />
            <div>
              <strong>还没有已锁定参考图</strong>
              <p>可先拆镜预览结构；出片时会按本镜角色 / 场景 / 道具自动绑定已锁定参考图。</p>
            </div>
          </div>
        )}

        {(error || actionError) && <p className="drama-form-error youxi-story-error">{error?.message || actionError}</p>}
        </div>

        {boardQuery.isLoading ? (
          <p className="drama-asset-empty">正在读取分镜…</p>
        ) : !shots.length ? (
          <div className="youxi-storyboard-main">
            <div className="youxi-story-preview">
              <div className="youxi-story-empty-preview" data-ratio={ratio}>
                <div className="youxi-story-empty-state">
                  <Film size={24} />
                  <strong>还没有分镜</strong>
                  <span>锁定剧本后点「智能分镜」，按场排出本集镜头</span>
                  <button type="button" disabled={draftMutation.isPending || !scriptLocked} onClick={() => draftMutation.mutate()}>
                    <Wand2 size={14} /> {draftMutation.isPending ? "拆镜中…" : "智能分镜"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <section className="youxi-storyboard-main">
            <div className="youxi-story-preview">
              {videoSrc && !generating ? (
                <video
                  key={videoSrc}
                  controls
                  playsInline
                  preload="metadata"
                  data-ratio={ratio}
                  src={videoSrc}
                  poster={mediaUrl(posterOf(selected)) || undefined}
                >
                  <track kind="captions" />
                </video>
              ) : (
                <div className="youxi-story-empty-preview" data-ratio={ratio}>
                  <div className="youxi-story-empty-state">
                    <Video size={24} />
                    <strong>{generating ? "正在生成视频" : "尚未生成视频"}</strong>
                    <span>
                      {generating
                        ? "默认 r2v：锁定主体参考图 + 编译后的提示词"
                        : selected?.compiledStale
                          ? "身份或风格已变，请重新编译后再出片"
                          : "将按本镜角色 / 场景 / 道具自动绑定 Picture 参考图后出片"}
                    </span>
                    <button type="button" disabled={generating || !videoModelId} onClick={() => generate(selected)}>
                      <Sparkles size={14} /> {generating ? "出片中…" : "生成当前镜头"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="youxi-story-actions">
              <div>
                <strong>全部分镜</strong>
                <span>共{shots.length}个分镜 · {shots.filter((item) => item.videoKey).length} 已出片</span>
              </div>
              <div>
                <span>{selected.title || `镜 ${selected.shotIndex}`}</span>
              </div>
            </div>
            <div className="youxi-filmstrip" role="list">
              {shots.map((shot) => {
                const active = selected?.id === shot.id;
                const ready = Boolean(shot.videoKey);
                const thumb = mediaUrl(posterOf(shot));
                return (
                  <div className="youxi-filmstrip-unit" key={shot.id}>
                    <button
                      type="button"
                      className={`youxi-shot-thumb ${active ? "active" : ""}`}
                      onClick={() => setShotId(shot.id)}
                    >
                      <span className="youxi-shot-thumb__preview">
                        <span>镜 {shot.shotIndex}</span>
                        {thumb ? (
                          <img src={thumb} alt="" />
                        ) : (
                          <div className="youxi-shot-thumb__empty">
                            {ready ? <b>已出片</b> : <b>未生成</b>}
                          </div>
                        )}
                        <small className={ready ? "is-ready" : ""}>
                          {shot.generating || busy[shot.id] === "generate"
                            ? "生成中"
                            : ready
                              ? `${shot.durationSec || 5}s · 已生成`
                              : `${shot.durationSec || 5}s`}
                        </small>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        </div>
      </div>
      <ShotInspector
        selected={shots.length ? selected : null}
        generating={generating}
        onSave={saveShot}
      />
    </section>
  );
}
