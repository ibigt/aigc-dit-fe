import { ArrowLeft, Check, ChevronDown, CircleCheck, Download, Film, Pencil, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  bindDramaVideoModel,
  createDramaEpisode,
  deleteDramaEpisode,
  exportDramaFilmBurned,
  fetchDramaFilm,
  fetchDramaSeriesDetail,
  fetchDramaVideoModels,
  updateDramaSeries,
} from "../../api/drama.js";
import { DramaAssetBoard } from "./DramaAssetBoard.jsx";
import { DramaFilmPanel, downloadAuthenticatedText, downloadDramaFilm } from "./DramaFilmPanel.jsx";
import { DramaScriptPanel } from "./DramaScriptPanel.jsx";
import { DramaStoryboard } from "./DramaStoryboard.jsx";
import { DramaStylePicker } from "./DramaStylePicker.jsx";
import { dramaStyleOf } from "./dramaStyles.js";
import { preferredResolution, resolutionOptionsFor } from "./dramaSpecs.js";
import { modelLogoSrc } from "../../lib/modelLogos.js";
import { authenticatedApiUrl, dramaFilmDownloadName, mediaUrl, safeDownloadBase } from "../../lib/media.js";
import { zipStore } from "../../lib/zipStore.js";

const EXPORT_SCOPES = [
  { id: "current", title: "导出当前集" },
  { id: "all", title: "导出全集" },
];
const EXPORT_CAPTIONS = [
  { id: "burned", title: "带字幕成片" },
  { id: "plain", title: "成片（无字幕）" },
];

function episodeExportLabel(ep) {
  return safeDownloadBase(ep?.name || `第${ep?.episodeNumber || 1}集`, `第${ep?.episodeNumber || 1}集`);
}

function uniqueZipName(usedNames, base, ext) {
  let name = `${base}.${ext}`;
  let n = 2;
  while (usedNames.has(name)) {
    name = `${base}-${n}.${ext}`;
    n += 1;
  }
  usedNames.add(name);
  return name;
}

async function fetchMediaBytes(urlOrKey) {
  const src = mediaUrl(urlOrKey) || urlOrKey;
  const response = await fetch(src);
  if (!response.ok) throw new Error("下载失败");
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchAuthTextBytes(path) {
  const src = authenticatedApiUrl(path);
  const response = await fetch(src, { credentials: "include" });
  if (!response.ok) throw new Error("下载字幕失败");
  return new Uint8Array(await response.arrayBuffer());
}

function triggerBlobDownload(blob, filename) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

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

function stepFromSearch(searchParams) {
  const raw = searchParams.get("step");
  return STEP_IDS.includes(raw) ? raw : "script";
}

function DramaDialog({ title, eyebrow, onClose, children }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="drama-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="drama-dialog drama-dialog--export" role="dialog" aria-modal="true" aria-labelledby="drama-workspace-dialog-title">
        <header>
          <div>
            {eyebrow && <span>{eyebrow}</span>}
            <h2 id="drama-workspace-dialog-title">{title}</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>

        {children}
      </section>
    </div>,
    document.body,
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
  const videoModelLogo = modelLogoSrc(videoModels.find((item) => String(item.id) === videoModelId) || { name: series?.videoModelName });
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
          <img className={`model-brand-logo${videoModelLogo.includes("agnes") ? " agnes-logo" : ""}`} src={videoModelLogo} alt="" />
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
                <img className="model-brand-logo" src={modelLogoSrc(item)} alt="" />
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
      queryClient.invalidateQueries({ queryKey: ["creations"] });
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
  const [exportScope, setExportScope] = useState("current");
  const [exportCaption, setExportCaption] = useState("burned");
  const [exportIncludeVtt, setExportIncludeVtt] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (!renameOpen) return;
    const input = renameInputRef.current;
    if (!input) return;
    // preventScroll：避免 autoFocus 带动整页滚动，露出浅色缝/白横条。
    input.focus({ preventScroll: true });
    input.select();
  }, [renameOpen]);

  const goLibrary = () => navigate("/console/drama");

  async function runExportDownload() {
    if (!series?.id) {
      showNotice("请先打开项目", true);
      return;
    }
    const targets = exportScope === "all"
      ? (episodes.length ? episodes : (episode ? [episode] : []))
      : (episode ? [episode] : []);
    if (!targets.length) {
      showNotice("请先打开剧集", true);
      return;
    }
    const wantVtt = exportCaption === "plain" && exportIncludeVtt;
    setExporting(true);
    setExportStatus(exportCaption === "burned" ? "准备烧录…" : "准备下载…");
    try {
      const usedNames = new Set();
      const zipFiles = [];
      let packed = 0;
      let skipped = 0;
      let vttPacked = 0;
      let vttMissing = 0;
      let staleHint = false;

      for (let index = 0; index < targets.length; index += 1) {
        const ep = targets[index];
        const epLabel = episodeExportLabel(ep);
        setExportStatus(`处理 ${epLabel}（${index + 1}/${targets.length}）…`);
        const film = await queryClient.fetchQuery({
          queryKey: ["drama-film", ep.id],
          queryFn: () => fetchDramaFilm(ep.id),
        });
        if (film?.stale) staleHint = true;

        if (!film?.filmUrl) {
          skipped += 1;
          continue;
        }

        let filmUrl = film.filmUrl;
        let suffix = "";
        if (exportCaption === "burned") {
          if (!film?.hasCaptions) {
            skipped += 1;
            continue;
          }
          setExportStatus(`烧录 ${epLabel}（${index + 1}/${targets.length}）…`);
          const burned = await exportDramaFilmBurned(ep.id);
          if (!burned?.filmUrl) {
            skipped += 1;
            continue;
          }
          filmUrl = burned.filmUrl;
          suffix = "带字幕";
        }

        if (exportScope === "current") {
          await downloadDramaFilm(
            filmUrl,
            dramaFilmDownloadName({ seriesName: series.name, episode: ep, suffix }),
          );
          packed += 1;
          if (wantVtt) {
            if (film?.hasCaptions) {
              // 稍候再触发第二个文件，降低浏览器拦截连续下载的概率
              await new Promise((resolve) => window.setTimeout(resolve, 350));
              await downloadAuthenticatedText(
                `/api/drama/episodes/${ep.id}/film/captions.vtt`,
                dramaFilmDownloadName({ seriesName: series.name, episode: ep, suffix: "字幕", ext: "vtt" }),
              );
              vttPacked += 1;
            } else {
              vttMissing += 1;
            }
          }
          break;
        }

        const bytes = await fetchMediaBytes(filmUrl);
        zipFiles.push({ name: uniqueZipName(usedNames, epLabel, "mp4"), data: bytes });
        packed += 1;
        if (wantVtt) {
          if (film?.hasCaptions) {
            const vttBytes = await fetchAuthTextBytes(`/api/drama/episodes/${ep.id}/film/captions.vtt`);
            zipFiles.push({ name: uniqueZipName(usedNames, `${epLabel}-字幕`, "vtt"), data: vttBytes });
            vttPacked += 1;
          } else {
            vttMissing += 1;
          }
        }
      }

      if (exportScope === "all") {
        if (!zipFiles.length) {
          showNotice(
            exportCaption === "burned"
              ? "没有可导出的字幕成片，请先拼接并生成字幕"
              : "没有已成片的剧集，请先拼接成片",
            true,
          );
          return;
        }
        setExportStatus("正在打包 ZIP…");
        const zipName = `${safeDownloadBase(series.name, "短剧")}.zip`;
        triggerBlobDownload(zipStore(zipFiles), zipName);
      }

      if (packed === 0) {
        showNotice(
          exportCaption === "burned"
            ? "当前集暂无可用字幕，请先生成字幕"
            : "请先拼接成片",
          true,
        );
        return;
      }

      setExportOpen(false);
      const parts = [`已开始下载${exportScope === "all" ? `（${packed} 集）` : ""}`];
      if (wantVtt && vttPacked > 0) parts.push(`含 ${vttPacked} 个字幕文件`);
      if (wantVtt && vttMissing > 0) parts.push(`${vttMissing} 集无字幕可附带`);
      if (skipped > 0) parts.push(`跳过 ${skipped} 集`);
      if (staleHint && exportCaption === "plain") parts.push("部分成片可能已过期");
      showNotice(parts.join(" · "));
    } catch (error) {
      showNotice(error.message || "导出失败", true);
    } finally {
      setExporting(false);
      setExportStatus("");
    }
  }

  function showNotice(message, isError = false) {
    setNoticeError(isError);
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  function commitRename() {
    const name = renameDraft.trim();
    if (!name) {
      setRenameDraft(series.name || "");
      setRenameOpen(false);
      showNotice("请输入项目名称", true);
      return;
    }
    // 未改动时直接收起，避免无意义请求和浅色 toast 白条。
    if (name === (series.name || "").trim()) {
      setRenameOpen(false);
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
                ref={renameInputRef}
                type="text"
                name="drama-series-title"
                autoComplete="off"
                spellCheck={false}
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
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                setExportScope("current");
                setExportCaption("burned");
                setExportIncludeVtt(false);
                setExportStatus("");
                setExportOpen(true);
              }}
            >
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
        <DramaDialog
          title="导出成片"
          eyebrow={series.name}
          onClose={() => !exporting && setExportOpen(false)}
        >
          <div className="export-options">
            <section className="export-section" aria-label="导出范围">
              <h3>导出范围</h3>
              {EXPORT_SCOPES.map((item) => {
                const selected = exportScope === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={selected ? "is-selected" : ""}
                    aria-pressed={selected}
                    disabled={exporting}
                    onClick={() => setExportScope(item.id)}
                  >
                    <Film size={20} />
                    <span>
                      <strong>{item.title}</strong>
                    </span>
                    <Check size={17} className="export-check" aria-hidden={!selected} />
                  </button>
                );
              })}
            </section>
            <section className="export-section" aria-label="字幕选项">
              <h3>字幕选项</h3>
              {EXPORT_CAPTIONS.map((item) => {
                const selected = exportCaption === item.id;
                return (
                  <div key={item.id} className={`export-caption-row${selected ? " is-selected" : ""}`}>
                    <button
                      type="button"
                      className={selected ? "is-selected" : ""}
                      aria-pressed={selected}
                      disabled={exporting}
                      onClick={() => {
                        setExportCaption(item.id);
                        if (item.id !== "plain") setExportIncludeVtt(false);
                      }}
                    >
                      <Film size={20} />
                      <span>
                        <strong>{item.title}</strong>
                      </span>
                      <Check size={17} className="export-check" aria-hidden={!selected} />
                    </button>
                    {item.id === "plain" && selected && (
                      <label className={`export-vtt-check${exportIncludeVtt ? " is-checked" : ""}`}>
                        <input
                          type="checkbox"
                          checked={exportIncludeVtt}
                          disabled={exporting}
                          onChange={(event) => setExportIncludeVtt(event.target.checked)}
                        />
                        <span>
                          <strong>同时下载字幕文件</strong>
                        </span>
                      </label>
                    )}
                  </div>
                );
              })}
            </section>
            {exportStatus && <p className="export-status" role="status">{exportStatus}</p>}
            <footer className="export-footer">
              <button type="button" className="button button--ghost" disabled={exporting} onClick={() => setExportOpen(false)}>
                取消
              </button>
              <button type="button" className="button button--primary" disabled={exporting} onClick={runExportDownload}>
                <Download size={15} />
                {exporting ? (exportStatus || "下载中…") : "下载"}
              </button>
            </footer>
          </div>
        </DramaDialog>
      )}
    </section>
  );
}
