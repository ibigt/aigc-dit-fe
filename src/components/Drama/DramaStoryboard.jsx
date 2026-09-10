import { Check, Lock, RefreshCw, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  compileDramaShot,
  compileDramaStoryboard,
  confirmDramaShot,
  draftDramaStoryboard,
  fetchDramaStoryboard,
  updateDramaShot,
} from "../../api/drama.js";
import { mediaUrl } from "../../lib/media.js";

const DURATIONS = [5, 10, 15];

function statusLabel(status) {
  if (status === "已锁定") return "已确认";
  return status || "未开始";
}

export function dramaStoryboardStatus(board) {
  return board?.status || "未开始";
}

export function DramaStoryboard({ series, episode }) {
  const queryClient = useQueryClient();
  const episodeId = episode?.id;
  const seriesId = series?.id;
  const [chapterId, setChapterId] = useState(null);
  const [busy, setBusy] = useState({});
  const [actionError, setActionError] = useState("");
  const [edits, setEdits] = useState({});

  const boardQuery = useQuery({
    queryKey: ["drama-storyboard", episodeId],
    queryFn: () => fetchDramaStoryboard(episodeId),
    enabled: Boolean(episodeId),
  });
  const board = boardQuery.data;
  const chapters = board?.chapters || [];
  const lockedAssets = board?.lockedAssets || [];
  const activeChapter = chapters.find((item) => item.id === chapterId) || chapters[0];
  const shots = activeChapter?.shots || [];
  const scriptLocked = episode?.status === "已锁定";

  const draftMutation = useMutation({
    mutationFn: () => draftDramaStoryboard(episodeId),
    onSuccess: (data) => {
      queryClient.setQueryData(["drama-storyboard", episodeId], data);
      queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
      setChapterId(data?.chapters?.[0]?.id || null);
      setActionError("");
    },
    onError: (error) => setActionError(error.message || "拆镜失败"),
  });

  const compileAllMutation = useMutation({
    mutationFn: () => compileDramaStoryboard(episodeId),
    onSuccess: (data) => {
      queryClient.setQueryData(["drama-storyboard", episodeId], data);
      setActionError("");
    },
    onError: (error) => setActionError(error.message || "编译失败"),
  });

  function patchShot(next) {
    queryClient.setQueryData(["drama-storyboard", episodeId], (current) => {
      if (!current?.chapters) return current;
      return {
        ...current,
        chapters: current.chapters.map((chapter) => ({
          ...chapter,
          shots: (chapter.shots || []).map((shot) => (shot.id === next.id ? next : shot)),
        })),
      };
    });
  }

  async function runShot(id, key, task) {
    setBusy((current) => ({ ...current, [id]: key }));
    setActionError("");
    try {
      patchShot(await task());
    } catch (error) {
      setActionError(error.message || "操作失败");
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }

  function editOf(shot) {
    return edits[shot.id] || {
      durationSec: shot.durationSec || 5,
      dialogue: shot.dialogue || "",
      continuityIn: shot.continuityIn || "",
      continuityOut: shot.continuityOut || "",
      referenceAssetIds: shot.referenceAssetIds || [],
    };
  }

  function setEdit(shotId, patch) {
    setEdits((current) => {
      const shot = shots.find((item) => item.id === shotId);
      const base = current[shotId] || {
        durationSec: shot?.durationSec || 5,
        dialogue: shot?.dialogue || "",
        continuityIn: shot?.continuityIn || "",
        continuityOut: shot?.continuityOut || "",
        referenceAssetIds: shot?.referenceAssetIds || [],
      };
      return { ...current, [shotId]: { ...base, ...patch } };
    });
  }

  const lockedCount = lockedAssets.length;
  const error = boardQuery.error || (actionError ? { message: actionError } : null);

  const summary = useMemo(() => {
    const all = chapters.flatMap((item) => item.shots || []);
    return {
      shots: all.length,
      confirmed: all.filter((item) => item.status === "已锁定").length,
      stale: board?.staleShotCount || 0,
    };
  }, [chapters, board?.staleShotCount]);

  return (
    <section className="drama-storyboard">
      <header className="drama-asset-board__bar">
        <div>
          <h2>章节与分镜</h2>
          <p>按场拆章后逐镜确认。视频提示词由编译器注入风格前缀、身份不变量和 Picture 序号，无需手写长 prompt。默认单镜 {series?.defaultDurationSec || 5} 秒。</p>
        </div>
        <div className="drama-asset-board__controls">
          <button
            className="button button--ghost"
            type="button"
            disabled={compileAllMutation.isPending || !chapters.length}
            onClick={() => compileAllMutation.mutate()}
          >
            <RefreshCw size={14} /> {compileAllMutation.isPending ? "编译中…" : "重新编译"}
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={draftMutation.isPending || !scriptLocked}
            onClick={() => draftMutation.mutate()}
          >
            <Wand2 size={14} /> {draftMutation.isPending ? "拆镜中…" : chapters.length ? "重新拆镜" : "按场拆章"}
          </button>
        </div>
      </header>

      {!scriptLocked && (
        <div className="drama-asset-gate">
          <Lock size={16} />
          <div>
            <strong>先锁定分场剧本</strong>
            <p>剧本锁定后才能拆章节。未锁定资产不会进入参考图。</p>
          </div>
        </div>
      )}

      {scriptLocked && lockedCount === 0 && (
        <div className="drama-asset-gate">
          <Lock size={16} />
          <div>
            <strong>还没有已锁定参考图</strong>
            <p>可先拆镜预览结构；确认分镜前请到资产页锁定角色/场景/道具。</p>
          </div>
        </div>
      )}

      {(error || actionError) && <p className="drama-form-error">{error?.message || actionError}</p>}

      {boardQuery.isLoading ? (
        <p className="drama-asset-empty">正在读取分镜…</p>
      ) : !chapters.length ? (
        <p className="drama-asset-empty">还没有章节。锁定剧本后点右上角「按场拆章」，第一场会排出 4–8 镜。</p>
      ) : (
        <>
          <nav className="drama-storyboard__chapters" aria-label="章节">
            {chapters.map((chapter) => (
              <button
                type="button"
                key={chapter.id}
                className={`drama-storyboard__chapter ${activeChapter?.id === chapter.id ? "is-active" : ""}`}
                onClick={() => setChapterId(chapter.id)}
              >
                <strong>{chapter.name}</strong>
                <small>{(chapter.shots || []).length} 镜 · {statusLabel(chapter.status)}</small>
              </button>
            ))}
          </nav>
          {activeChapter?.body && <p className="drama-storyboard__body">{activeChapter.body}</p>}
          <div className="drama-storyboard__shots">
            {shots.map((shot) => {
              const edit = editOf(shot);
              const working = busy[shot.id];
              const confirmed = shot.status === "已锁定";
              return (
                <article className="drama-shot-card" key={shot.id}>
                  <header>
                    <div>
                      <small>镜 {shot.shotIndex}</small>
                      <strong>{shot.title || "未命名分镜"}</strong>
                    </div>
                    <em className={`drama-status-chip drama-status-chip--${shot.status}`}>{statusLabel(shot.status)}</em>
                  </header>
                  <p className="drama-shot-card__goal">{shot.narrativeGoal}</p>
                  <div className="drama-shot-card__grid">
                    <label>时长
                      <select
                        value={edit.durationSec}
                        disabled={confirmed}
                        onChange={(e) => setEdit(shot.id, { durationSec: Number(e.target.value) })}
                      >
                        {DURATIONS.map((item) => <option key={item} value={item}>{item} 秒</option>)}
                      </select>
                    </label>
                    <label>进入衔接
                      <input value={edit.continuityIn} disabled={confirmed} onChange={(e) => setEdit(shot.id, { continuityIn: e.target.value })} />
                    </label>
                    <label>离开衔接
                      <input value={edit.continuityOut} disabled={confirmed} onChange={(e) => setEdit(shot.id, { continuityOut: e.target.value })} />
                    </label>
                  </div>
                  <label>台词
                    <textarea value={edit.dialogue} disabled={confirmed} onChange={(e) => setEdit(shot.id, { dialogue: e.target.value })} rows={2} />
                  </label>
                  <div className="drama-shot-card__refs">
                    <span>参考资产（顺序 = Picture 序号）</span>
                    <div>
                      {lockedAssets.map((asset) => {
                        const checked = (edit.referenceAssetIds || []).some((id) => Number(id) === Number(asset.id));
                        return (
                          <label key={asset.id} className={checked ? "is-on" : ""}>
                            <input
                              type="checkbox"
                              disabled={confirmed}
                              checked={checked}
                              onChange={() => {
                                const current = edit.referenceAssetIds || [];
                                setEdit(shot.id, {
                                  referenceAssetIds: checked
                                    ? current.filter((id) => Number(id) !== Number(asset.id))
                                    : [...current, asset.id],
                                });
                              }}
                            />
                            {asset.imageUrl ? <img src={mediaUrl(asset.imageUrl) || asset.imageUrl} alt="" /> : <i />}
                            {asset.name}
                            <small>{asset.type}</small>
                          </label>
                        );
                      })}
                      {!lockedAssets.length && <em>暂无已锁定资产</em>}
                    </div>
                  </div>
                  {shot.unboundNames?.length > 0 && (
                    <p className="drama-form-error">未锁定：{shot.unboundNames.join("、")}</p>
                  )}
                  {shot.compiledStale && <p className="drama-form-error">身份或风格已变，旧 prompt 已作废，请重新编译。</p>}
                  <label>编译预览
                    <textarea readOnly value={shot.compiledPrompt || "尚未编译"} rows={8} />
                  </label>
                  <footer>
                    <button
                      className="button button--ghost"
                      type="button"
                      disabled={Boolean(working) || confirmed}
                      onClick={() => runShot(shot.id, "save", () => updateDramaShot(shot.id, editOf(shot)))}
                    >
                      {working === "save" ? "保存中…" : "保存并编译"}
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      disabled={Boolean(working)}
                      onClick={() => runShot(shot.id, "compile", () => compileDramaShot(shot.id))}
                    >
                      {working === "compile" ? "编译中…" : "预览编译"}
                    </button>
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={Boolean(working) || confirmed}
                      onClick={() => runShot(shot.id, "confirm", () => confirmDramaShot(shot.id))}
                    >
                      <Check size={14} /> {working === "confirm" ? "确认中…" : confirmed ? "已确认" : "确认本镜"}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
          <p className="drama-asset-summary">
            {summary.shots} 镜 · 已确认 {summary.confirmed}
            {summary.stale ? ` · ${summary.stale} 镜 prompt 已作废` : ""}
            {lockedCount ? ` · ${lockedCount} 个已锁定资产可作参考` : ""}
          </p>
        </>
      )}
    </section>
  );
}
