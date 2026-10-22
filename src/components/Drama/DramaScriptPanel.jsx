import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, CircleCheck, Plus, Sparkles, Trash2 } from "lucide-react";
import { analyzeDramaScript, bindDramaTextModel, fetchDramaTextModels } from "../../api/drama.js";
import { ConfirmDialog } from "../ConfirmDialog.jsx";
import { DemoSelect } from "../DemoSelect.jsx";

const ANALYSIS_STAGES = [
  { label: "读取剧本", detail: "正在读取和理解剧本原文…" },
  { label: "生成分场", detail: "正在识别人物、场景和剧情结构…" },
  { label: "落库资产", detail: "正在整理人物、场景和道具信息…" },
  { label: "收尾", detail: "正在校验并保存分场结果…" },
];

function analysisProgress(elapsed) {
  // 接口只返回 analyzing / analyzingAt，百分比按已等待时长估算，并在完成前停在 95%。
  const seconds = Math.max(0, elapsed);
  let progress;
  if (seconds < 8) progress = Math.floor((seconds / 8) * 23);
  else if (seconds < 35) progress = 24 + Math.floor(((seconds - 8) / 27) * 33);
  else if (seconds < 90) progress = 58 + Math.floor(((seconds - 35) / 55) * 27);
  else progress = Math.min(95, 86 + Math.floor((seconds - 90) / 12));
  const index = progress < 24 ? 0 : progress < 58 ? 1 : progress < 86 ? 2 : 3;
  return { progress, index, stage: ANALYSIS_STAGES[index] };
}

function formatElapsed(elapsed) {
  const seconds = Math.max(0, elapsed);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function sceneTitle(scene, index) {
  return scene.heading || `第${scene.index ?? index + 1}场`;
}

function chapterWordCount(episode) {
  return (episode?.sourceText || "").trim().length;
}

/**
 * 剧本步骤：左侧章节列表、中间原文与分场。风格、比例、清晰度和视频模型在工作台顶栏修改。
 * 原文只在点击「一键分析剧本」时随分析请求提交，页面不调用剧本保存接口。
 */
export function DramaScriptPanel({
                                   episode,
                                   series,
                                   episodes = [],
                                   activeEpisodeId,
                                   onSelectEpisode,
                                   onAddEpisode,
                                   addingEpisode,
                                   onDeleteEpisode,
                                   deletingEpisodeId,
                                   onContinue,
                                 }) {
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analysisStartedAt, setAnalysisStartedAt] = useState(null);
  const [analysisNow, setAnalysisNow] = useState(Date.now());
  const [deleteEpisodeTarget, setDeleteEpisodeTarget] = useState(null);
  const wasAnalyzing = useRef(false);

  useEffect(() => {
    if (episode) {
      setRaw(episode.sourceText || "");
      setAnalysis(null);
    }
  }, [episode?.id, episode?.sourceText]);

  function refreshSeries() {
    queryClient.invalidateQueries({ queryKey: ["drama-series"] });
    queryClient.invalidateQueries({ queryKey: ["drama-series", series?.id || episode?.seriesId] });
    if (episode?.id) {
      queryClient.invalidateQueries({ queryKey: ["drama-assets", episode.id] });
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", episode.id] });
    }
  }

  const analyze = useMutation({
    mutationFn: async () => {
      if (!episode) throw new Error("请先创建剧集");
      return analyzeDramaScript(episode.id, {
        sourceText: raw,
      });
    },
    onMutate: () => {
      window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["drama-series"] });
        queryClient.invalidateQueries({ queryKey: ["drama-series", series?.id || episode?.seriesId] });
      }, 400);
    },
    onSuccess: (result) => {
      setAnalysis(result);
      setAnalysisStartedAt(null);
      refreshSeries();
      // 拆镜在后台：短时轮询分镜进度；资产设定已在分析同步阶段生成。
      const epId = episode?.id;
      if (!epId) return;
      let ticks = 0;
      const timer = window.setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ["drama-assets", epId] });
        queryClient.invalidateQueries({ queryKey: ["drama-storyboard", epId] });
        queryClient.invalidateQueries({ queryKey: ["drama-series", series?.id || episode?.seriesId] });
        if (++ticks >= 40) window.clearInterval(timer);
      }, 3000);
    },
    onError: () => {
      setAnalysisStartedAt(null);
      refreshSeries();
    },
  });

  const serverStartedAt = episode?.analyzingAt ? Date.parse(episode.analyzingAt) : NaN;
  const analyzing = Boolean(episode?.analyzing) || analyze.isPending;
  const progressStartedAt = Number.isFinite(serverStartedAt) ? serverStartedAt : analysisStartedAt;

  useEffect(() => {
    if (episode?.analyzing) wasAnalyzing.current = true;
  }, [episode?.analyzing]);

  useEffect(() => {
    if (!episode?.id || episode.analyzing || !wasAnalyzing.current) return;
    wasAnalyzing.current = false;
    queryClient.invalidateQueries({ queryKey: ["drama-assets", episode.id] });
    queryClient.invalidateQueries({ queryKey: ["drama-storyboard", episode.id] });
  }, [episode?.analyzing, episode?.id, queryClient]);

  useEffect(() => {
    if (!analyzing) return undefined;
    setAnalysisNow(Date.now());
    const timer = window.setInterval(() => setAnalysisNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [analyzing]);

  const textModelsQuery = useQuery({
    queryKey: ["drama-text-models"],
    queryFn: fetchDramaTextModels,
  });
  const textModels = textModelsQuery.data || [];
  const textModelId = series?.textModelId ? String(series.textModelId) : "";

  const bindTextModel = useMutation({
    mutationFn: (value) => bindDramaTextModel(series.id, value ? Number(value) : null),
    onSuccess: refreshSeries,
  });

  const scenes = episode?.script?.scenes || [];
  const elapsed = progressStartedAt ? Math.max(0, Math.floor((analysisNow - progressStartedAt) / 1000)) : 0;
  const currentStage = analysisProgress(elapsed);

  return (
      <div className="drama-script-layout">
        <aside className="drama-chapters">
          <header className="drama-chapters__head">
            <strong>章节列表</strong>
            <button
                type="button"
                className="drama-chapters__add"
                aria-label="添加集数"
                title="添加集数"
                disabled={!series?.id || addingEpisode}
                onClick={() => onAddEpisode?.()}
            >
              <Plus size={15} />
            </button>
          </header>
          <div className="drama-chapters__list" role="list">
            {episodes.map((item) => {
              const active = item.id === activeEpisodeId;
              const label = `第${item.episodeNumber ?? 1}章`;
              return (
                  <div key={item.id} className={`drama-chapter${active ? " active" : ""}`} role="listitem">
                    <button type="button" className="drama-chapter__main" onClick={() => onSelectEpisode?.(item.id)}>
                      <span className="drama-chapter__no">{label}</span>
                      <span className="drama-chapter__count">{chapterWordCount(item)} 字</span>
                    </button>
                    <button
                        type="button"
                        className="drama-chapter__del"
                        aria-label={`删除${label}`}
                        title={episodes.length <= 1 ? "至少保留一集，无法删除" : "删除章节"}
                        disabled={episodes.length <= 1 || deletingEpisodeId === item.id}
                        onClick={() => setDeleteEpisodeTarget(item)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
              );
            })}
            {!episodes.length && <p className="drama-chapters__empty">还没有章节</p>}
          </div>
        </aside>

        <section className="drama-script">
          <div className="drama-script__toolbar">
            <div className="script-model-control" title={analyzing ? "正在分析剧本，暂时不能更换文本模型" : undefined}>
              <label>文本模型</label>
              <DemoSelect
                  className="chapter-model-select"
                  ariaLabel="剧本分析文本模型"
                  placeholder={textModels.length ? "请选择文本模型" : "暂无已启用文本模型"}
                  value={textModelId}
                  disabled={!series?.id || analyzing || bindTextModel.isPending}
                  options={textModels.length
                      ? textModels.map((item) => ({
                        value: String(item.id),
                        label: `${item.name}${item.provider ? ` · ${item.provider}` : ""}`,
                      }))
                      : [{ value: "", label: "暂无已启用文本模型", disabled: true }]}
                  onChange={(value) => {
                    if (value) bindTextModel.mutate(value);
                  }}
              />
            </div>
            <div>
              <button
                  className="button button--primary drama-analyze-btn"
                  type="button"
                  disabled={!raw.trim() || analyzing || episode?.canGenerate === false}
                  title={episode?.canGenerate === false ? "请先绑定可用文本模型" : undefined}
                  onClick={() => { setAnalysis(null); setAnalysisStartedAt(Date.now()); setAnalysisNow(Date.now()); analyze.mutate(); }}
              >
                <Sparkles size={15} /> {analyzing ? "分析中…" : "一键分析剧本"}
              </button>
            </div>
          </div>

          <div className="drama-script__body">
            <div className="drama-script__raw">
              <span>剧本原文 / 一句话梗概</span>
              <div className="drama-script__editor">
                <em className="drama-script__count">{raw.length}</em>
                <textarea
                    value={raw}
                    rows={8}
                    disabled={analyzing}
                    placeholder="请输入剧本内容"
                    onChange={(event) => setRaw(event.target.value)}
                />
              </div>
              {raw.length > 5000 && (
                  <p className="drama-script__hint">剧本文本较长，解析文本可能会被拆分，导致耗时较长</p>
              )}
            </div>

            {episode?.canGenerate === false && episode?.textServiceAvailable && (
                <p className="drama-script__hint">
                  {series?.textModelId
                      ? "已绑定文本模型，但通道不可用（请到管理端检查 Base URL / 适配协议）。绑定可用后才能分析剧本。"
                      : "该项目未绑定可用文本模型。请先选择文本模型，再点「一键分析剧本」。"}
                </p>
            )}

            {analyzing && (
                <section className="analysis-progress-panel" aria-live="polite">
                  <div className="analysis-progress-heading">
                    <div>
                      <span>当前阶段</span>
                      <h3>{currentStage.stage.label}</h3>
                      <p>{currentStage.stage.detail}</p>
                    </div>
                    <strong>{formatElapsed(elapsed)}</strong>
                  </div>
                  <div className="analysis-progress-track"><span style={{ width: `${currentStage.progress}%` }} /></div>
                  <div className="analysis-progress-meta"><span>{currentStage.progress}%</span></div>
                  <div className="analysis-stage-list">
                    {ANALYSIS_STAGES.map((stage, index) => (
                        <span key={stage.label} className={index < currentStage.index ? "done" : index === currentStage.index ? "active" : ""}>{stage.label}</span>
                    ))}
                  </div>
                  <p className="analysis-background-note">离开页面不会取消分析。分场完成后会在后台自动拆镜，可到「分镜」页查看进度。</p>
                </section>
            )}

            {analyze.isError && !analyzing && <p className="drama-form-error">{analyze.error.message || "剧本分析失败"}</p>}
            {!analyzing && !analyze.isError && episode?.scriptAnalyzeError && (
                <p className="drama-form-error">{episode.scriptAnalyzeError}</p>
            )}
            {analysis && (
                <section className="drama-analysis-summary">
                  <header><strong>分析结果</strong><span>文本模型</span></header>
                  <div className="drama-analysis-stats">
                    <span><b>{analysis.actualSceneCount ?? 0}</b> 场景</span>
                    <span><b>{analysis.storyboard?.drafting ? "…" : (analysis.actualShotCount ?? 0)}</b>{analysis.storyboard?.drafting ? "拆镜中" : "分镜"}</span>
                    <span><b>{analysis.assets?.length ?? 0}</b> 个资产</span>
                  </div>
                  {(analysis.warnings || []).map((warning) => <p key={warning} className="drama-script__hint">提示：{warning}</p>)}
                </section>
            )}

            {scenes.length > 0 ? (
                <ol className="drama-scenes">
                  {scenes.map((scene, index) => {
                    const id = scene.index ?? index;
                    return (
                        <li className="drama-scene" key={id}>
                          <header>
                            <strong>{id}. {sceneTitle(scene, index)}</strong>
                            <small>
                              {[scene.location, scene.time, scene.interior == null ? null : scene.interior ? "内" : "外"]
                                  .filter(Boolean).join(" · ")}
                            </small>
                          </header>
                          {scene.action && <p className="drama-scene__action">{scene.action}</p>}
                          <div className="drama-scene__tags">
                            {(scene.characters || []).map((name) => <span key={`c-${name}`} className="drama-tag drama-tag--person">{name}</span>)}
                            {(scene.props || []).map((name) => <span key={`p-${name}`} className="drama-tag">{name}</span>)}
                          </div>
                          {(scene.dialogue || []).length > 0 && (
                              <ul className="drama-scene__dialogue">
                                {scene.dialogue.map((line, i) => (
                                    <li key={`${id}-d-${i}`}>
                                      <b>{line.speaker}</b>
                                      {line.emotion ? <span className="drama-tag drama-tag--emotion">{line.emotion}</span> : null}
                                      <span>{line.line}</span>
                                    </li>
                                ))}
                              </ul>
                          )}
                          {scene.sound && <p className="drama-scene__sound">声音：{scene.sound}</p>}
                        </li>
                    );
                  })}
                </ol>
            ) : (
                <p className="drama-script__empty">
                  {analyzing
                      ? "正在分析，分场结果出来后会显示在这里。"
                      : (analyze.isError || episode?.scriptAnalyzeError)
                          ? "分场未完成，请检查文本模型后重试。"
                          : "还没有分场结果。粘贴原文后点「一键分析剧本」。"}
                </p>
            )}
          </div>
          {(scenes.length > 0 || analysis) && !analyzing && !analyze.isError && (
              <section className="drama-script-done">
                <strong><CircleCheck size={16} /> 你的剧本已拆分完成</strong>
                <button type="button" onClick={() => onContinue?.()}>
                  继续 <ChevronRight size={16} />
                </button>
              </section>
          )}
        </section>
        <ConfirmDialog
            open={Boolean(deleteEpisodeTarget)}
            eyebrow="剧本"
            title="删除章节？"
            message={deleteEpisodeTarget
                ? `删除第${deleteEpisodeTarget.episodeNumber ?? 1}章？该集的资产、分镜与成片会一并删除，我的创作里对应的图片和视频也会删除，且不可恢复。`
                : ""}
            confirmLabel="删除"
            busy={Boolean(deleteEpisodeTarget && deletingEpisodeId === deleteEpisodeTarget.id)}
            busyLabel="删除中…"
            onClose={() => setDeleteEpisodeTarget(null)}
            onConfirm={() => {
              if (!deleteEpisodeTarget) return;
              const id = deleteEpisodeTarget.id;
              setDeleteEpisodeTarget(null);
              onDeleteEpisode?.(id);
            }}
        />
      </div>
  );
}
