import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, RectangleHorizontal, RectangleVertical, Save, Square, Sparkles } from "lucide-react";
import { analyzeDramaScript, bindDramaTextModel, fetchDramaTextModels, fetchDramaVideoModels, updateDramaSeries } from "../../api/drama.js";
import { DramaStylePicker } from "./DramaStylePicker.jsx";
import { DEFAULT_DRAMA_STYLE_KEY } from "./dramaStyles.js";

const ENGINE_LABELS = {
  pending: "未解析",
  rules: "规则分场",
  llm: "文本模型",
};

const ASPECT_RATIOS = [
  { id: "16:9", label: "16:9", Icon: RectangleHorizontal },
  { id: "9:16", label: "9:16", Icon: RectangleVertical },
  { id: "1:1", label: "1:1", Icon: Square },
];

const RESOLUTIONS = ["480P", "720P"];

function resolutionOptionsFor(model) {
  const listed = Array.isArray(model?.resolutions)
    ? model.resolutions.map((item) => String(item).toUpperCase()).filter((item) => RESOLUTIONS.includes(item))
    : [];
  return listed.length ? listed : RESOLUTIONS;
}

const ANALYSIS_STORE_PREFIX = "drama-analysis-config:";

function readAnalysisStore(seriesId) {
  if (!seriesId) return {};
  try {
    const raw = window.localStorage.getItem(ANALYSIS_STORE_PREFIX + seriesId);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAnalysisStore(seriesId, config) {
  if (!seriesId) return;
  window.localStorage.setItem(ANALYSIS_STORE_PREFIX + seriesId, JSON.stringify({
    episodeDurationSec: config.episodeDurationSec,
    shotsPerEpisode: config.shotsPerEpisode,
    requirements: config.requirements || "",
  }));
}

function settingsDraftFrom(series) {
  const stored = readAnalysisStore(series?.id);
  return {
    styleKey: series?.styleKey || DEFAULT_DRAMA_STYLE_KEY,
    aspectRatio: series?.aspectRatio || "16:9",
    defaultResolution: series?.defaultResolution || "720P",
    episodeCount: series?.plannedEpisodeCount || 1,
    episodeDurationSec: stored.episodeDurationSec ?? 15,
    shotsPerEpisode: stored.shotsPerEpisode ?? 8,
    requirements: stored.requirements || "",
  };
}

function seriesPayload(draft) {
  return {
    styleKey: draft.styleKey,
    aspectRatio: draft.aspectRatio,
    defaultResolution: draft.defaultResolution,
    plannedEpisodeCount: Math.min(99, Math.max(1, Number(draft.episodeCount) || 1)),
  };
}

function sameSettings(left, right) {
  return left.styleKey === right.styleKey
    && left.aspectRatio === right.aspectRatio
    && left.defaultResolution === right.defaultResolution
    && Number(left.episodeCount) === Number(right.episodeCount)
    && Number(left.episodeDurationSec) === Number(right.episodeDurationSec)
    && Number(left.shotsPerEpisode) === Number(right.shotsPerEpisode)
    && (left.requirements || "") === (right.requirements || "");
}

const ANALYSIS_STAGES = [
  { label: "读取剧本", detail: "正在识别人物、场景和剧情结构…", progress: 18 },
  { label: "生成分场", detail: "正在把原文整理为可编辑的分场剧本…", progress: 48 },
  { label: "抽取资产", detail: "正在整理角色、场景和道具…", progress: 78 },
  { label: "收尾", detail: "正在锁定分场并准备后台拆镜…", progress: 92 },
];

function analysisStage(elapsed) {
  if (elapsed < 8) return ANALYSIS_STAGES[0];
  if (elapsed < 22) return ANALYSIS_STAGES[1];
  if (elapsed < 55) return ANALYSIS_STAGES[2];
  return ANALYSIS_STAGES[3];
}

function sceneTitle(scene, index) {
  return scene.heading || `第${scene.index ?? index + 1}场`;
}

/**
 * 剧本步骤：导入原文 → 分场渲染 → 锁定；右侧可选风格、视频比例与清晰度。
 * 分场结果由后端 DramaTextService 产出，这里只渲染与触发，不组装字段。
 */
export function DramaScriptPanel({ episode, series }) {
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
    if (episode) setRaw(episode.sourceText || "");
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
    writeAnalysisStore(series.id, next);
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
        episodeCount: draft.episodeCount,
        episodeDurationSec: draft.episodeDurationSec,
        shotsPerEpisode: draft.shotsPerEpisode,
        requirements: draft.requirements,
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
      <section className="drama-script">
        <div className="drama-script__head">
          <h2><FileText size={16} /> 剧本</h2>
          <div className="drama-script__meta">
            <span className={`drama-engine drama-engine--${episode?.engine || "pending"}`}>
              {ENGINE_LABELS[episode?.engine] || "未解析"}
            </span>
            <em className={`drama-status-chip drama-status-chip--${episode?.status || "未开始"}`}>
              {episode?.status || "未开始"}
            </em>
          </div>
        </div>

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
              ? "已绑定文本模型，但通道不可用（请到管理端检查 Base URL / 适配协议）。"
              : "该项目未绑定可用文本模型。"}
          </p>
        )}
        <div className="drama-script__actions">
          <label className="drama-script__model-select">
            <span>文本模型</span>
            <select
              value={textModelId}
              disabled={!series?.id || analyzing || bindTextModel.isPending}
              onChange={(event) => bindTextModel.mutate(event.target.value)}
            >
              <option value="">{textModels.length ? "不绑定（走规则分场）" : "暂无已启用文本模型"}</option>
              {textModels.map((item) => (
                <option key={item.id} value={item.id}>{item.name}{item.provider ? ` · ${item.provider}` : ""}</option>
              ))}
            </select>
          </label>
          <button
            className="button button--primary"
            type="button"
            disabled={!raw.trim() || analyzing}
            onClick={() => { setAnalysis(null); setAnalysisStartedAt(Date.now()); setAnalysisNow(Date.now()); analyze.mutate(); }}
          >
            <Sparkles size={15} /> {analyzing ? "分析中…" : "一键分析剧本"}
          </button>
        </div>

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
        {analysis && (
          <section className="drama-analysis-summary">
            <header><strong>分析结果</strong><span>{analysis.engine === "llm" ? "文本模型" : "规则引擎"}</span></header>
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
          <p className="drama-script__empty">{analyzing ? "正在分析，分场结果出来后会显示在这里。" : "还没有分场结果。粘贴原文后点「一键分析剧本」。"}</p>
        )}
      </section>

      <aside className="drama-script-settings">
        <section className="settings-block drama-analysis-settings">
          <header>
            <strong>剧本分析配置</strong>
            <span>保存后用于后续分析</span>
          </header>
          <div className="drama-analysis-fields">
            <label>集数<input type="number" min="1" max="100" value={draft.episodeCount} onChange={(e) => setDraft((current) => ({ ...current, episodeCount: Number(e.target.value) }))} /></label>
            <label>单集时长（秒）<input type="number" min="5" max="60" value={draft.episodeDurationSec} onChange={(e) => setDraft((current) => ({ ...current, episodeDurationSec: Number(e.target.value) }))} /></label>
            <label>目标分镜数<input type="number" min="1" max="100" value={draft.shotsPerEpisode} onChange={(e) => setDraft((current) => ({ ...current, shotsPerEpisode: Number(e.target.value) }))} /></label>
          </div>
          <label className="drama-analysis-requirements">补充要求<textarea rows="3" value={draft.requirements} onChange={(e) => setDraft((current) => ({ ...current, requirements: e.target.value }))} placeholder="例如：节奏紧凑，结尾保留悬念" /></label>
        </section>
        <section className="settings-block">
          <header>
            <strong>视频比例与清晰度</strong>
            <span>用于全部分镜和成片</span>
          </header>
          <p className="drama-spec-label">视频比例</p>
          <div className="ratio-card-grid drama-ratio-grid">
            {ASPECT_RATIOS.map((item) => {
              const Icon = item.Icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={draft.aspectRatio === item.id ? "active" : ""}
                  disabled={!series?.id || analyzing}
                  onClick={() => setDraft((current) => ({ ...current, aspectRatio: item.id }))}
                >
                  <Icon size={26} strokeWidth={1.6} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
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
