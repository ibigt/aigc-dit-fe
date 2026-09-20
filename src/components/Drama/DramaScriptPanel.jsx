import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { analyzeDramaScript, bindDramaTextModel, fetchDramaTextModels, fetchDramaVideoModels, lockDramaScript, updateDramaSeries } from "../../api/drama.js";
import { DramaStylePicker } from "./DramaStylePicker.jsx";
import { DEFAULT_DRAMA_STYLE_KEY } from "./dramaStyles.js";

const ASPECT_RATIOS = [
  { id: "21:9", label: "21:9" },
  { id: "16:9", label: "16:9" },
  { id: "4:3", label: "4:3" },
  { id: "1:1", label: "1:1" },
  { id: "3:4", label: "3:4" },
  { id: "9:16", label: "9:16" },
];

const RESOLUTIONS = ["480P", "720P", "1080P", "2K"];

function resolutionOptionsFor(model) {
  const listed = Array.isArray(model?.resolutions)
    ? model.resolutions.map((item) => String(item).toUpperCase()).filter((item) => RESOLUTIONS.includes(item))
    : [];
  return listed.length ? listed : RESOLUTIONS;
}

function settingsDraftFrom(series) {
  return {
    styleKey: series?.styleKey || DEFAULT_DRAMA_STYLE_KEY,
    aspectRatio: series?.aspectRatio || "16:9",
    defaultResolution: series?.defaultResolution || "720P",
  };
}

function seriesPayload(draft) {
  return {
    styleKey: draft.styleKey,
    aspectRatio: draft.aspectRatio,
    defaultResolution: draft.defaultResolution,
  };
}

function sameSettings(left, right) {
  return left.styleKey === right.styleKey
    && left.aspectRatio === right.aspectRatio
    && left.defaultResolution === right.defaultResolution;
}

const ANALYSIS_STAGES = [
  { label: "读取剧本", detail: "正在识别人物、场景和剧情结构…", progress: 22 },
  { label: "生成分场", detail: "正在把原文整理为可编辑的分场剧本…", progress: 58 },
  { label: "落库资产", detail: "正在写入角色、场景和道具骨架…", progress: 82 },
  { label: "收尾", detail: "正在锁定分场，随后后台增强资产并拆镜…", progress: 94 },
];

function analysisStage(elapsed) {
  // 同步路径主要为整本分场 LLM；资产骨架本地很快，假进度对齐新阶段化节奏。
  if (elapsed < 6) return ANALYSIS_STAGES[0];
  if (elapsed < 28) return ANALYSIS_STAGES[1];
  if (elapsed < 40) return ANALYSIS_STAGES[2];
  return ANALYSIS_STAGES[3];
}

function sceneTitle(scene, index) {
  return scene.heading || `第${scene.index ?? index + 1}场`;
}

function chapterWordCount(episode) {
  return (episode?.sourceText || "").trim().length;
}

/**
 * 剧本步骤：左侧章节列表（可添加集数）、中间剧本原文 + 分析、右侧风格与比例设置。
 * 分场结果由后端 DramaTextService 产出，这里只渲染与触发，不组装字段。
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
}) {
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analysisStartedAt, setAnalysisStartedAt] = useState(null);
  const [analysisNow, setAnalysisNow] = useState(Date.now());
  const [draft, setDraft] = useState(() => settingsDraftFrom(series));
  const [savedDraft, setSavedDraft] = useState(() => settingsDraftFrom(series));
  const [justSaved, setJustSaved] = useState(false);
  const wasAnalyzing = useRef(false);

  useEffect(() => {
    if (episode) {
      setRaw(episode.sourceText || "");
      setAnalysis(null);
    }
  }, [episode?.id, episode?.sourceText]);

  useEffect(() => {
    const next = settingsDraftFrom(series);
    setDraft(next);
    setSavedDraft(next);
  }, [series?.id]);

  function refreshSeries() {
    queryClient.invalidateQueries({ queryKey: ["drama-series"] });
    queryClient.invalidateQueries({ queryKey: ["drama-series", series?.id || episode?.seriesId] });
    if (episode?.id) {
      queryClient.invalidateQueries({ queryKey: ["drama-assets", episode.id] });
      queryClient.invalidateQueries({ queryKey: ["drama-storyboard", episode.id] });
    }
  }

  function persistSettings(next = draft) {
    if (!series?.id) throw new Error("请先打开短剧项目");
    return updateDramaSeries(series.id, seriesPayload(next));
  }

  const analyze = useMutation({
    mutationFn: async () => {
      if (!episode) throw new Error("请先创建剧集");
      if (series?.id) {
        await persistSettings(draft);
        setSavedDraft(draft);
      }
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
      // 资产 LLM 增强与拆镜在后台：短时轮询，便于首屏后看到描述补全与分镜进度。
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

  const settings = useMutation({
    mutationFn: persistSettings,
    onSuccess: (_, next) => {
      setSavedDraft(next || draft);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2000);
      refreshSeries();
    },
  });

  const videoModelsQuery = useQuery({
    queryKey: ["drama-video-models"],
    queryFn: fetchDramaVideoModels,
  });

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

  const lockScript = useMutation({
    mutationFn: () => lockDramaScript(episode.id),
    onSuccess: refreshSeries,
  });

  const scenes = episode?.script?.scenes || [];
  const dirty = !sameSettings(draft, savedDraft);
  const resolutionOptions = useMemo(
    () => resolutionOptionsFor((videoModelsQuery.data || []).find((item) => String(item.id) === String(series?.videoModelId))),
    [videoModelsQuery.data, series?.videoModelId]
  );

  useEffect(() => {
    if (!series?.id || !resolutionOptions.length || resolutionOptions.includes(draft.defaultResolution)) return;
    setDraft((current) => ({
      ...current,
      defaultResolution: resolutionOptions[resolutionOptions.length - 1],
    }));
  }, [series?.id, draft.defaultResolution, resolutionOptions]);
  const elapsed = progressStartedAt ? Math.max(0, Math.floor((analysisNow - progressStartedAt) / 1000)) : 0;
  const currentStage = analysisStage(elapsed);
  const elapsedLabel = `${Math.floor(elapsed / 60)}分${String(elapsed % 60).padStart(2, "0")}秒`;

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
                  onClick={() => {
                    if (window.confirm(`删除${label}？该集的资产、分镜与成片会一并删除，且不可恢复。`)) {
                      onDeleteEpisode?.(item.id);
                    }
                  }}
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
          <div>
            <label className="youxi-shot-model">
              文本模型
              <select
                aria-label="剧本分析文本模型"
                value={textModelId}
                disabled={!series?.id || analyzing || bindTextModel.isPending}
                onChange={(event) => bindTextModel.mutate(event.target.value)}
              >
                <option value="">{textModels.length ? "请选择文本模型" : "暂无已启用文本模型"}</option>
                {textModels.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.provider ? ` · ${item.provider}` : ""}</option>
                ))}
              </select>
            </label>
            <button
              className={`drama-script__status${episode?.status === "已锁定" ? " is-locked" : ""}`}
              type="button"
              disabled={!episode?.id || analyzing || lockScript.isPending || episode?.status === "已锁定"}
              title={episode?.status === "已锁定" ? "分场剧本已锁定，资产页可提取" : "锁定本集分场剧本，资产页才能提取"}
              onClick={() => lockScript.mutate()}
            >
              <Lock size={14} /> {lockScript.isPending ? "锁定中…" : episode?.status || "未开始"}
            </button>
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
        <label className="drama-script__raw">
          <span>剧本原文 / 一句话梗概</span>
          <textarea
            value={raw}
            rows={10}
            disabled={analyzing}
            placeholder={"第一场 幻梦侦探社 日 内\n人物：洛白、夏安、局长\n道具：古铜怀表\n洛白：开始了。"}
            onChange={(event) => setRaw(event.target.value)}
          />
        </label>

        {episode?.canGenerate === false && episode?.textServiceAvailable && (
          <p className="drama-script__hint">
            {series?.textModelId
              ? "已绑定文本模型，但通道不可用（请到管理端检查 Base URL / 适配协议）。绑定可用后才能分析剧本。"
              : "该项目未绑定可用文本模型。请先选择文本模型，再点「一键分析剧本」。"}
          </p>
        )}

        {analyzing && (
          <section className="drama-analysis-progress" aria-live="polite">
            <div className="drama-analysis-progress__topline">
              <div>
                <strong>{currentStage.label}</strong>
                <span>{currentStage.detail}</span>
              </div>
              <b>{elapsedLabel}</b>
            </div>
            <div className="drama-progress-track"><i style={{ width: `${currentStage.progress}%` }} /></div>
            <div className="drama-analysis-progress__steps">
              {ANALYSIS_STAGES.map((stage) => (
                <span key={stage.label} className={currentStage.progress >= stage.progress ? "done" : ""}>{stage.label}</span>
              ))}
            </div>
            <p>
              {elapsed >= 90
                ? "模型响应较慢，请耐心等待。离开页面不会取消分析，回来后仍会显示进度。"
                : "离开页面不会取消分析。分场完成后会在后台自动拆镜，可到「分镜」页查看进度。"}
            </p>
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
                          <b>{line.speaker}</b><span>{line.line}</span>
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
      </section>

      <aside className="drama-script-settings">
        <section className="settings-block">
          <header>
            <strong>视频比例与清晰度</strong>
            <span>用于全部分镜和成片</span>
          </header>
          <p className="drama-spec-label">视频比例</p>
          <div className="ratio-card-grid drama-ratio-grid">
            {ASPECT_RATIOS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={draft.aspectRatio === item.id ? "active" : ""}
                disabled={!series?.id || analyzing}
                onClick={() => setDraft((current) => ({ ...current, aspectRatio: item.id }))}
              >
                <i data-ratio={item.id} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <p className="drama-spec-label">清晰度</p>
          <div className="ratio-card-grid drama-ratio-grid drama-resolution-grid">
            {resolutionOptions.map((item) => (
              <button
                key={item}
                type="button"
                className={draft.defaultResolution === item ? "active" : ""}
                disabled={!series?.id || analyzing}
                onClick={() => setDraft((current) => ({ ...current, defaultResolution: item }))}
              >
                <span>{item}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-block settings-style-block">
          <header>
            <strong>风格参考</strong>
            <span>统一全局画面视觉</span>
          </header>
          <DramaStylePicker
            value={draft.styleKey}
            disabled={!series?.id || analyzing}
            onChange={(next) => setDraft((current) => ({ ...current, styleKey: next }))}
          />
        </section>
        <footer className="drama-script-settings__save">
          <button
            className="button button--primary"
            type="button"
            disabled={!series?.id || settings.isPending || analyzing}
            onClick={() => settings.mutate(draft)}
          >
            <Save size={15} /> {settings.isPending ? "保存中…" : justSaved && !dirty ? "已保存" : "保存配置"}
          </button>
          <p className="drama-script__hint">
            {dirty
              ? "有未保存的分析配置、风格或比例，点保存后才会生效。"
              : "分析配置、风格和比例需点保存。改风格或比例后，已编译分镜会标为已过期。"}
          </p>
          {settings.isError && <p className="drama-form-error">{settings.error.message}</p>}
        </footer>
      </aside>
    </div>
  );
}
