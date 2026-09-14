import { ArrowLeft, ChevronRight, CircleCheck, Download, Film, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchDramaFilm, fetchDramaSeriesDetail, createDramaEpisode, updateDramaSeries } from "../../api/drama.js";
import { DramaAssetBoard } from "./DramaAssetBoard.jsx";
import { DramaFilmPanel, downloadDramaFilm } from "./DramaFilmPanel.jsx";
import { DramaScriptPanel } from "./DramaScriptPanel.jsx";
import { DramaStoryboard } from "./DramaStoryboard.jsx";
import { dramaStyleOf } from "./dramaStyles.js";

const STEPS = [
  { id: "script", label: "剧本", action: "资产提取" },
  { id: "subjects", label: "资产", action: "智能分镜" },
  { id: "shots", label: "分镜", action: "剪辑成片" },
  { id: "film", label: "成片", action: "导出" },
];
const STEP_IDS = STEPS.map((item) => item.id);

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
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const goLibrary = () => navigate("/console", { state: { tab: "drama" } });
  const style = dramaStyleOf(series?.styleKey);
  const cover = series?.styleCover || style.cover;
  const activeIndex = STEPS.findIndex((item) => item.id === step);

  function showNotice(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
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

  function goNext() {
    if (step === "film") {
      setExportOpen(true);
      return;
    }
    const index = STEPS.findIndex((item) => item.id === step);
    setStep(STEPS[Math.min(STEPS.length - 1, index + 1)].id);
  }

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

  const actionLabel = STEPS[activeIndex]?.action;

  return (
    <section className="drama-workspace youxi-workspace youxi-creative-workspace">
      <h1 className="visually-hidden">{series.name}短剧创作空间</h1>
      <header className="drama-workspace-header">
        <div className="drama-workspace-start">
          <button className="drama-back" type="button" onClick={goLibrary}>
            <ArrowLeft size={18} /> 返回
          </button>
          <div className="drama-project-title">
            <img
              src={cover}
              alt=""
              onError={(event) => {
                if (event.currentTarget.dataset.fallback === "1") return;
                event.currentTarget.dataset.fallback = "1";
                event.currentTarget.src = style.fallback;
              }}
            />
            <strong>{series.name}</strong>
            <button
              className="drama-project-rename"
              type="button"
              aria-label="修改项目名称"
              onClick={() => { setRenameDraft(series.name); setRenameOpen(true); }}
            >
              <Pencil size={13} />
            </button>
          </div>
        </div>
        <nav aria-label="短剧创作流程">
          {STEPS.map((item, index) => (
            <div className="drama-flow-item" key={item.id}>
              <button
                type="button"
                className={`${step === item.id ? "active" : ""} ${activeIndex > index ? "done" : ""}`}
                onClick={() => setStep(item.id)}
              >
                <i>{activeIndex > index ? <CircleCheck size={15} /> : index + 1}</i>
                <span>{item.label}</span>
              </button>
              {index < STEPS.length - 1 && <ChevronRight className="drama-flow-arrow" size={18} aria-hidden="true" />}
            </div>
          ))}
        </nav>
        <div className="drama-workspace-actions">
          {step !== "film" && (
            <button className="button button--primary drama-next-button" type="button" onClick={goNext}>
              {actionLabel} <ChevronRight size={17} />
            </button>
          )}
          {step === "film" && (
            <button className="button button--primary" type="button" onClick={() => setExportOpen(true)}>
              <Download size={16} /> 导出
            </button>
          )}
        </div>
      </header>
      {notice && <div className="drama-toast"><CircleCheck size={16} />{notice}</div>}
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
          />
        </div>
      )}
      {step === "subjects" && (
        <div className="drama-step drama-step--slot">
          <DramaAssetBoard series={series} episode={episode} />
        </div>
      )}
      {step === "shots" && (
        <div className="drama-step drama-step--slot drama-step--shots">
          <DramaStoryboard series={series} episode={episode} />
        </div>
      )}
      {step === "film" && <DramaFilmPanel series={series} episode={episode} />}
      {renameOpen && (
        <DramaDialog title="修改项目名称" eyebrow="项目基础信息" onClose={() => { if (!renameMutation.isPending) setRenameOpen(false); }}>
          <form
            className="drama-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              const name = renameDraft.trim();
              if (!name) return;
              renameMutation.mutate(name);
            }}
          >
            <label>
              项目名称
              <input autoFocus required maxLength={128} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} />
            </label>
            {renameMutation.isError && <p className="drama-form-error">{renameMutation.error.message}</p>}
            <footer>
              <button type="button" onClick={() => setRenameOpen(false)}>取消</button>
              <button className="button button--primary" type="submit" disabled={renameMutation.isPending || !renameDraft.trim()}>
                {renameMutation.isPending ? "保存中…" : "保存"}
              </button>
            </footer>
          </form>
        </DramaDialog>
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
