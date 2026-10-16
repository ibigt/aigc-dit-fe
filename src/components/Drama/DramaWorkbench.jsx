import { ArrowLeft, ChevronDown, ChevronRight, CircleCheck, Download, Film, Pencil, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  bindDramaVideoModel,
  createDramaEpisode,
  deleteDramaEpisode,
  fetchDramaFilm,
  fetchDramaSeriesDetail,
  fetchDramaVideoModels,
  updateDramaSeries,
} from "../../api/drama.js";
import { DramaAssetBoard } from "./DramaAssetBoard.jsx";
import { DramaFilmPanel, downloadDramaFilm } from "./DramaFilmPanel.jsx";
import { DramaScriptPanel } from "./DramaScriptPanel.jsx";
import { DramaStoryboard } from "./DramaStoryboard.jsx";
import { DramaStylePicker } from "./DramaStylePicker.jsx";
import { dramaStyleOf } from "./dramaStyles.js";
import { preferredResolution, resolutionOptionsFor } from "./dramaSpecs.js";

const STEPS = [
  { id: "script", label: "剧本" },
  { id: "subjects", label: "资产" },
  { id: "shots", label: "分镜" },
  { id: "film", label: "成片" },
];
const STEP_IDS = STEPS.map((item) => item.id);
const STAGE_ICONS = {
  script: "/assets/workflow-icons/script.png",
  subjects: "/assets/workflow-icons/assets.png",
  shots: "/assets/workflow-icons/storyboard.png",
  film: "/assets/workflow-icons/film.png",
};
const STAGE_DETAILS = {
  script: { step: "STEP 1", description: "编写故事、场景与台词" },
  subjects: { step: "STEP 2", description: "管理角色、场景与素材" },
  shots: { step: "STEP 3", description: "设计镜头、画面与节奏" },
  film: { step: "STEP 4", description: "合成预览并导出作品" },
};
const RATIO_ORDER = ["9:16", "16:9", "21:9", "3:4", "4:3", "1:1"];
const RATIO_NOTES = { "9:16": "竖屏", "16:9": "横屏", "21:9": "电影" };

function RatioIcon({ ratio }) {
  const vertical = ratio === "9:16" || ratio === "3:4";
  const square = ratio === "1:1";
  const width = vertical ? 8 : square ? 12 : 18;
  const height = vertical ? 18 : square ? 12 : 10;
  return (
    <svg className="workspace-setting-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x={(24 - width) / 2} y={(24 - height) / 2} width={width} height={height} rx="1.8" />
    </svg>
  );
}

function modelLogo(name = "") {
  const text = name.toLowerCase();
  if (text.includes("doubao") || text.includes("seedance") || text.includes("bytedance")) return "/assets/model-logos/bytedance-seed.ico";
  if (text.includes("minimax")) return "/assets/model-logos/minimax.ico";
  return "/assets/model-logos/agnes.png";
}

function stepFromSearch(searchParams) {
  const raw = searchParams.get("step");
  return STEP_IDS.includes(raw) ? raw : "script";
}

function DramaDialog({ title, eyebrow, onClose, children }) {
  return (
    <div className="drama-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="drama-dialog" role="dialog" aria-modal="true" aria-labelledby="drama-workspace-dialog-title">
        <header>
          <div>
            {eyebrow && <span>{eyebrow}</span>}
            <h2 id="drama-workspace-dialog-title">{title}</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>

        {children}
      </section>
    </div>
  );
}

function DramaSeriesSpecs({ seriesId, series, onError, styleOnly = false }) {
  const queryClient = useQueryClient();
  const barRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const videoModelsQuery = useQuery({
    queryKey: ["drama-video-models"],
    queryFn: fetchDramaVideoModels,
  });
  const videoModels = videoModelsQuery.data || [];
  const style = dramaStyleOf(series?.styleKey);
  const videoModelId = series?.videoModelId ? String(series.videoModelId) : "";
  const videoModelName = series?.videoModelName
    || videoModels.find((item) => String(item.id) === videoModelId)?.name
    || "请选择视频模型";
  const aspectRatio = series?.aspectRatio || "16:9";

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (barRef.current && !barRef.current.contains(event.target)) setMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["drama-series"] });
    queryClient.invalidateQueries({ queryKey: ["drama-series", seriesId] });
  }

  const saveSeries = useMutation({
    mutationFn: (payload) => updateDramaSeries(seriesId, payload),
    onSuccess: refresh,
    onError: (error) => onError?.(error.message || "保存失败"),
  });

  const bindVideo = useMutation({
    mutationFn: async (nextId) => {
      await bindDramaVideoModel(seriesId, Number(nextId));
      const options = resolutionOptionsFor(videoModels.find((item) => String(item.id) === String(nextId)));
      if (series?.defaultResolution && !options.includes(series.defaultResolution)) {
        await updateDramaSeries(seriesId, { defaultResolution: preferredResolution(options, series.defaultResolution) });
      }
    },
    onSuccess: refresh,
    onError: (error) => onError?.(error.message || "视频模型保存失败"),
  });

  const pending = saveSeries.isPending || bindVideo.isPending;

  function toggleMenu(next) {
    setMenu((current) => (current === next ? null : next));
  }

  return (
    <div className="workspace-settings" ref={barRef}>
      <div className="workspace-setting-wrap style-setting-wrap">
        <button
          className="workspace-setting-trigger style-trigger"
          type="button"
          aria-label="视觉风格"
          aria-expanded={menu === "style"}
          disabled={pending}
          onClick={() => toggleMenu("style")}
        >
          <span className="workspace-style-thumb" style={{ backgroundImage: `url("${style.cover}")` }} />
          <span>{style.name}</span>
          <ChevronDown className="workspace-setting-chevron" size={15} />
        </button>
        {menu === "style" && (
          <div className="drama-style-menu__panel">
            <DramaStylePicker
              value={series?.styleKey}
              disabled={pending}
              onChange={(next) => {
                setMenu(null);
                if (next && next !== series?.styleKey) saveSeries.mutate({ styleKey: next });
              }}
            />
          </div>
        )}
      </div>
      {!styleOnly && (
      <>
      <span className="workspace-setting-divider" aria-hidden="true" />
      <div className="workspace-setting-wrap">
        <button
          className="workspace-setting-trigger"
          type="button"
          aria-label="视频比例"
          aria-expanded={menu === "ratio"}
          disabled={pending}
          onClick={() => toggleMenu("ratio")}
        >
          <RatioIcon ratio={aspectRatio} />
          <span>{aspectRatio}</span>
          <ChevronDown className="workspace-setting-chevron" size={15} />
        </button>
        {menu === "ratio" && (
          <div className="workspace-setting-menu" role="listbox">
            {RATIO_ORDER.map((value) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={value === aspectRatio}
                onClick={() => {
                  setMenu(null);
                  if (value !== aspectRatio) saveSeries.mutate({ aspectRatio: value });
                }}
              >
                <RatioIcon ratio={value} />
                <span>{value}{RATIO_NOTES[value] ? `（${RATIO_NOTES[value]}）` : ""}</span>
                {value === aspectRatio && <span className="workspace-option-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="workspace-setting-divider" aria-hidden="true" />
      <div className="workspace-setting-wrap model-setting-wrap">
        <button
          className="workspace-setting-trigger model-trigger"
          type="button"
          aria-label="视频模型"
          aria-expanded={menu === "model"}
          disabled={pending || videoModelsQuery.isLoading}
          onClick={() => toggleMenu("model")}
        >
          <img className={`model-brand-logo${modelLogo(videoModelName).endsWith("agnes.png") ? " agnes-logo" : ""}`} src={modelLogo(videoModelName)} alt="" />
          <span>{videoModelName}</span>
          <ChevronDown className="workspace-setting-chevron" size={15} />
        </button>
        {menu === "model" && (
          <div className="workspace-setting-menu model-menu" role="listbox">
            {videoModels.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={String(item.id) === videoModelId}
                onClick={() => {
                  setMenu(null);
                  if (String(item.id) !== videoModelId) bindVideo.mutate(String(item.id));
                }}
              >
                <img className="model-brand-logo" src={modelLogo(item.name)} alt="" />
                <span>{item.name}</span>
                {String(item.id) === videoModelId && <span className="workspace-option-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

export function DramaWorkbench({ seriesId }) {
  const id = seriesId;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const seriesQuery = useQuery({
    queryKey: ["drama-series", id],
    queryFn: () => fetchDramaSeriesDetail(id),
    enabled: Boolean(id),
    placeholderData: (previousData) => previousData,
    refetchInterval: (query) => {
      const episodes = query.state.data?.episodes || [];
      return episodes.some((item) => item.analyzing) ? 3000 : false;
    },
  });
  const series = seriesQuery.data;
  const episodes = series?.episodes || [];
  const [episodeId, setEpisodeId] = useState(null);
  const episode = episodes.find((item) => item.id === episodeId) || episodes[0];
  const step = stepFromSearch(searchParams);

  const addEpisodeMutation = useMutation({
    mutationFn: () => createDramaEpisode(id),
    onSuccess: (resp) => {
      queryClient.setQueryData(["drama-series", id], resp);
      queryClient.invalidateQueries({ queryKey: ["drama-series"] });
      const latest = resp?.latestEpisode || resp?.episodes?.[resp.episodes.length - 1];
      if (latest?.id) setEpisodeId(latest.id);
    },
  });

  const deleteEpisodeMutation = useMutation({
    mutationFn: (targetId) => deleteDramaEpisode(targetId),
    onSuccess: (resp, deletedId) => {
      queryClient.setQueryData(["drama-series", id], resp);
      queryClient.invalidateQueries({ queryKey: ["drama-series"] });
      const list = resp?.episodes || [];
      setEpisodeId((current) => {
        if (current && list.some((item) => item.id === current)) return current;
        const fallback = list.find((item) => item.id !== deletedId) || list[0];
        return fallback?.id || null;
      });
      showNotice("章节已删除");
    },
    onError: (error) => showNotice(error.message || "删除章节失败"),
  });

  function setStep(next) {
    const nextStep = STEP_IDS.includes(next) ? next : "script";
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextStep === "script") {
        params.delete("step");
      } else {
        params.set("step", nextStep);
      }
      return params;
    }, { replace: true });
  }
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const goLibrary = () => navigate("/console/drama");

  function showNotice(message, isError = false) {
    setNoticeError(isError);
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  function commitRename() {
    const name = renameDraft.trim();
    if (!name) {
      showNotice("请输入项目名称");
      return;
    }
    renameMutation.mutate(name);
  }

  const renameMutation = useMutation({
    mutationFn: (name) => updateDramaSeries(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drama-series"] });
      queryClient.invalidateQueries({ queryKey: ["drama-series", id] });
      setRenameOpen(false);
      showNotice("项目名称已修改");
    },
  });

  useEffect(() => {
    if (series?.name) setRenameDraft(series.name);
  }, [series?.name]);

  if (seriesQuery.isError) {
    return (
      <section className="drama-workspace youxi-workspace">
        <div className="drama-empty">
          <p>{seriesQuery.error.message || "项目不存在"}</p>
          <button className="button button--ghost" type="button" onClick={goLibrary}>返回列表</button>
        </div>
      </section>
    );
  }

  if (!series) {
    return (
      <section className="drama-workspace youxi-workspace">
        <div className="drama-empty"><p>正在打开工作台…</p></div>
      </section>
    );
  }

  return (
    <section className="drama-workspace youxi-workspace youxi-creative-workspace">
      <h1 className="visually-hidden">{series.name}短剧创作空间</h1>
      <header className="drama-workspace-header">
        <div className="drama-workspace-start">
          <button className="drama-back" type="button" onClick={goLibrary}>
            <ArrowLeft size={18} /> 返回
          </button>
          <div className="drama-project-title">
            {renameOpen ? (
              <input
                autoFocus
                className={`workspace-name-input${renameDraft.trim() ? "" : " is-invalid"}`}
                aria-invalid={!renameDraft.trim()}
                aria-label="修改项目名称"
                maxLength={128}
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  } else if (event.key === "Escape") {
                    setRenameDraft(series.name);
                    setRenameOpen(false);
                  }
                }}
              />
            ) : (
              <>
                <strong>{series.name}</strong>
                <button
                  className="drama-project-rename"
                  type="button"
                  aria-label="修改项目名称"
                  onClick={() => { setRenameDraft(series.name); setRenameOpen(true); }}
                >
                  <Pencil size={13} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="drama-workspace-actions">
          <DramaSeriesSpecs
            seriesId={id}
            series={series}
            styleOnly={step === "shots"}
            onError={(message) => showNotice(message, true)}
          />
          {step === "film" && (
            <button className="button button--primary" type="button" onClick={() => setExportOpen(true)}>
              <Download size={16} /> 导出
            </button>
          )}
        </div>
      </header>
      <nav className="workspace-stage-nav" aria-label="短剧创作步骤">
        <div className="workspace-stage-list">
          {STEPS.map((item, index) => (
            <Fragment key={item.id}>
              {index > 0 && <span className="stage-arrow" aria-hidden="true"><span /></span>}
              <button
                type="button"
                className={`workspace-stage ${step === item.id ? "is-active" : ""}`}
                aria-current={step === item.id ? "step" : undefined}
                onClick={() => setStep(item.id)}
              >
                <span className="stage-orbit" aria-hidden="true">
                  <img className="stage-icon" src={STAGE_ICONS[item.id]} alt="" width={50} height={50} />
                </span>
                <span className="stage-meta">
                  <small>{STAGE_DETAILS[item.id].step}</small>
                  <strong>{item.label}</strong>
                </span>
                <span className="stage-description">{STAGE_DETAILS[item.id].description}</span>
              </button>
            </Fragment>
          ))}
        </div>
      </nav>
      {notice && <div className={`drama-toast${noticeError ? " drama-toast--error" : ""}`}><CircleCheck size={16} />{notice}</div>}
      {episode?.analyzing && step !== "script" && (
        <p className="drama-script__hint">剧本正在分析，可回到「剧本」查看进度。</p>
      )}
      {step === "script" && (
        <div className="drama-step drama-step--slot">
          <DramaScriptPanel
            episode={episode}
            series={series}
            episodes={episodes}
            activeEpisodeId={episode?.id}
            onSelectEpisode={setEpisodeId}
            onAddEpisode={() => addEpisodeMutation.mutate()}
            addingEpisode={addEpisodeMutation.isPending}
            onDeleteEpisode={(targetId) => deleteEpisodeMutation.mutate(targetId)}
            deletingEpisodeId={deleteEpisodeMutation.isPending ? deleteEpisodeMutation.variables : null}
            onContinue={() => setStep("subjects")}
          />
        </div>
      )}
      {step === "subjects" && (
        <div className="drama-step drama-step--slot">
          <DramaAssetBoard
            series={series}
            episode={episode}
            onPrev={() => setStep("script")}
            onNext={() => setStep("shots")}
          />
        </div>
      )}
      {step === "shots" && (
        <div className="drama-step drama-step--slot drama-step--shots">
          <DramaStoryboard series={series} episode={episode} />
        </div>
      )}
      {step === "film" && (
        <DramaFilmPanel
          series={series}
          episode={episode}
          episodes={episodes}
          onSelectEpisode={setEpisodeId}
        />
      )}
      {exportOpen && (
        <DramaDialog title="导出成片" eyebrow={episode?.name || series.name} onClose={() => setExportOpen(false)}>
          <div className="export-options">
            <button
              type="button"
              disabled={exporting}
              onClick={async () => {
                if (!episode?.id) {
                  showNotice("请先打开剧集");
                  return;
                }
                setExporting(true);
                try {
                  const film = await queryClient.fetchQuery({
                    queryKey: ["drama-film", episode.id],
                    queryFn: () => fetchDramaFilm(episode.id),
                  });
                  if (!film?.filmUrl) {
                    setExportOpen(false);
                    showNotice("请先拼接成片");
                    return;
                  }
                  await downloadDramaFilm(film.filmUrl, `${series.name || "成片"}.mp4`);
                  setExportOpen(false);
                  showNotice(film.stale ? "已下载当前成片，分镜已更新请重新拼接" : "成片已开始下载");
                } catch (error) {
                  showNotice(error.message || "导出失败");
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Film size={20} />
              <span>
                <strong>{exporting ? "导出中…" : "导出成片"}</strong>
                <small>MP4 · 不导出剪映草稿</small>
              </span>
              <ChevronRight size={17} />
            </button>
          </div>
        </DramaDialog>
      )}
    </section>
  );
}
