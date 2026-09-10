import { ArrowLeft, BookOpen, Clapperboard, Images, LayoutTemplate, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchDramaAssets, fetchDramaSeriesDetail, fetchDramaStoryboard, fetchDramaTextModels, updateDramaEpisode, updateDramaSeries } from "../../api/drama.js";
import { DramaAssetBoard, dramaAssetsStatus } from "./DramaAssetBoard.jsx";
import { DramaScriptPanel } from "./DramaScriptPanel.jsx";
import { DramaStoryboard, dramaStoryboardStatus } from "./DramaStoryboard.jsx";
import { DramaStylePicker } from "./DramaStylePicker.jsx";
import { DEFAULT_DRAMA_STYLE_KEY } from "./dramaStyles.js";

const ASPECT_RATIOS = ["16:9", "9:16", "1:1"];
const RESOLUTIONS = ["720P", "480P"];
const DURATIONS = [5, 10, 15];

const STEPS = [
  { id: "script", label: "剧本", hint: "导入或生成分场剧本", icon: BookOpen },
  { id: "assets", label: "角色场景道具", hint: "锁定描述符与参考图", icon: Images },
  { id: "board", label: "章节与分镜", hint: "编译自包含镜头合同", icon: LayoutTemplate },
  { id: "video", label: "成片", hint: "批量 r2v 后拼接", icon: Clapperboard },
];

export function DramaWorkbench({ seriesId }) {
  const id = seriesId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const seriesQuery = useQuery({
    queryKey: ["drama-series", id],
    queryFn: () => fetchDramaSeriesDetail(id),
    enabled: Boolean(id),
  });
  const textModelsQuery = useQuery({
    queryKey: ["drama-text-models"],
    queryFn: fetchDramaTextModels,
  });
  const textModels = textModelsQuery.data || [];
  const series = seriesQuery.data;
  const episode = series?.episodes?.[0];
  const [step, setStep] = useState("script");
  const [form, setForm] = useState(null);
  const [episodeName, setEpisodeName] = useState("");
  const [saved, setSaved] = useState(false);
  const assetsQuery = useQuery({
    queryKey: ["drama-assets", episode?.id],
    queryFn: () => fetchDramaAssets(episode.id),
    enabled: Boolean(episode?.id),
  });
  const storyboardQuery = useQuery({
    queryKey: ["drama-storyboard", episode?.id],
    queryFn: () => fetchDramaStoryboard(episode.id),
    enabled: Boolean(episode?.id),
  });
  const assetsStatus = dramaAssetsStatus(assetsQuery.data);
  const boardStatus = dramaStoryboardStatus(storyboardQuery.data);

  function stepStatus(stepId) {
    if (stepId === "script") return episode?.status || "未开始";
    if (stepId === "assets") return assetsStatus;
    if (stepId === "board") return boardStatus;
    return "未开始";
  }

  useEffect(() => {
    if (!series) return;
    setForm({
      name: series.name || "",
      styleKey: series.styleKey || DEFAULT_DRAMA_STYLE_KEY,
      aspectRatio: series.aspectRatio || "16:9",
      defaultResolution: series.defaultResolution || "720P",
      defaultDurationSec: series.defaultDurationSec || 5,
      plannedEpisodeCount: series.plannedEpisodeCount || 1,
      textModelId: series.textModelId || "",
    });
    setEpisodeName(episode?.name || "第 1 集");
  }, [series, episode?.name]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const next = await updateDramaSeries(id, {
        name: form.name.trim(),
        styleKey: form.styleKey,
        aspectRatio: form.aspectRatio,
        defaultResolution: form.defaultResolution,
        defaultDurationSec: form.defaultDurationSec,
        plannedEpisodeCount: Number(form.plannedEpisodeCount) || 1,
        ...(form.textModelId ? { textModelId: Number(form.textModelId) } : {}),
      });
      if (episode && episodeName.trim() && episodeName.trim() !== episode.name) {
        await updateDramaEpisode(episode.id, { name: episodeName.trim() });
      }
      return next;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drama-series"] });
      queryClient.invalidateQueries({ queryKey: ["drama-series", id] });
      setSaved(true);
    },
  });

  useEffect(() => {
    if (!saved) return undefined;
    const timer = window.setTimeout(() => setSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [saved]);

  if (seriesQuery.isError) {
    return (
      <div className="drama-workbench drama-workbench--empty">
        <p>{seriesQuery.error.message || "项目不存在"}</p>
        <button className="button button--ghost" type="button" onClick={() => navigate("/console", { state: { tab: "drama" } })}>返回列表</button>
      </div>
    );
  }

  if (!series || !form) {
    return <div className="drama-workbench drama-workbench--empty"><p>正在打开工作台…</p></div>;
  }

  return (
    <div className="drama-workbench">
      <header className="drama-workbench__bar">
        <button type="button" className="drama-back" onClick={() => navigate("/console", { state: { tab: "drama" } })}>
          <ArrowLeft size={16} /> 项目列表
        </button>
        <div className="drama-workbench__title">
          <strong>{series.name}</strong>
          <small>{episodeName || "第 1 集"} · {episode?.status || "未开始"} · {form.defaultResolution} · {form.defaultDurationSec}秒 · {form.aspectRatio}</small>
        </div>
        <span className="drama-status-chip">{episode?.status || "未开始"}</span>
      </header>
      <nav className="drama-steps" aria-label="四步工作台">
        {STEPS.map((item, index) => {
          const Icon = item.icon;
          const status = stepStatus(item.id);
          return (
            <button
              className={`drama-step ${step === item.id ? "is-active" : ""}`}
              type="button"
              key={item.id}
              onClick={() => setStep(item.id)}
            >
              <span><Icon size={14} /> {index + 1}. {item.label}</span>
              <small>{item.hint}</small>
              <em><Lock size={11} /> {status}</em>
            </button>
          );
        })}
      </nav>
      <div className={`drama-workbench__body ${step === "assets" || step === "board" ? "drama-workbench__body--stage" : ""}`}>
        {step === "assets" ? (
          <DramaAssetBoard series={series} episode={episode} />
        ) : step === "board" ? (
          <DramaStoryboard series={series} episode={episode} />
        ) : (
          <>
        {step === "script" && <DramaScriptPanel episode={episode} />}
        <section className="drama-info-card">
          <header>
            <h2>基础信息</h2>
            <p>系列级默认规格会在后续分镜编译时注入。风格只选图例，前缀不出现在表单里。</p>
          </header>
          <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}>
            <label>系列名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={128} /></label>
            <label>第 1 集名称<input value={episodeName} onChange={(e) => setEpisodeName(e.target.value)} maxLength={128} /></label>
            <div className="drama-info-grid">
              <label>画幅
                <select value={form.aspectRatio} onChange={(e) => setForm({ ...form, aspectRatio: e.target.value })}>
                  {ASPECT_RATIOS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>默认清晰度
                <select value={form.defaultResolution} onChange={(e) => setForm({ ...form, defaultResolution: e.target.value })}>
                  {RESOLUTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>默认时长
                <select value={form.defaultDurationSec} onChange={(e) => setForm({ ...form, defaultDurationSec: Number(e.target.value) })}>
                  {DURATIONS.map((item) => <option key={item} value={item}>{item} 秒</option>)}
                </select>
              </label>
              <label>规划集数
                <input type="number" min={1} max={99} value={form.plannedEpisodeCount} onChange={(e) => setForm({ ...form, plannedEpisodeCount: e.target.value })} />
              </label>
            </div>
            <label>文本模型
              <select
                value={form.textModelId}
                onChange={(e) => setForm({ ...form, textModelId: e.target.value })}
                required={textModels.length > 0 || Boolean(series.textModelId)}
              >
                {textModels.length === 0 && !series.textModelId && <option value="">未绑定（管理端启用文本模型后可更换）</option>}
                {series.textModelId && !textModels.some((item) => String(item.id) === String(series.textModelId)) && (
                  <option value={series.textModelId}>{series.textModelName || "已绑定（当前已停用）"}</option>
                )}
                {textModels.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.provider ? ` · ${item.provider}` : ""}</option>
                ))}
              </select>
            </label>
            <DramaStylePicker value={form.styleKey} onChange={(styleKey) => setForm({ ...form, styleKey })} />
            {saveMutation.isError && <p className="drama-form-error">{saveMutation.error.message}</p>}
            <footer>
              <small>状态机用词：未开始 / 待确认 / 已锁定 / 已过期</small>
              <button className="button button--primary" type="submit" disabled={saveMutation.isPending || !form.name.trim()}>
                {saveMutation.isPending ? "保存中…" : saved ? "已保存" : "保存基础信息"}
              </button>
            </footer>
          </form>
        </section>
        <section className="drama-empty-stages">
          {STEPS.filter((item) => item.id !== "assets" && item.id !== "board" && item.id !== step).map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.id}>
                <Icon size={18} />
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.id === "script" ? "导入或锁定分场剧本后，即可到资产页提取角色场景道具。" : `${item.hint}。本阶段只提供空壳，后续按阶段门解锁。`}</p>
                </div>
                <span>{stepStatus(item.id)}</span>
              </article>
            );
          })}
        </section>
          </>
        )}
      </div>
    </div>
  );
}
