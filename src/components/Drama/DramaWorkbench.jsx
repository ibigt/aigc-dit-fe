import { ArrowLeft, ChevronRight, CircleCheck, Download, Film, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchDramaSeriesDetail, updateDramaSeries } from "../../api/drama.js";
import { DramaAssetBoard } from "./DramaAssetBoard.jsx";
import { DramaScriptPanel } from "./DramaScriptPanel.jsx";
import { DramaStoryboard } from "./DramaStoryboard.jsx";
import { dramaStyleOf } from "./dramaStyles.js";

const STEPS = [
  { id: "script", label: "剧本", action: "主体提取" },
  { id: "subjects", label: "主体", action: "智能分镜" },
  { id: "shots", label: "分镜", action: "剪辑成片" },
  { id: "film", label: "成片", action: "导出" },
];

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

function FilmSlot() {
  return (
    <div className="drama-step youxi-film-layout">
      <section className="youxi-film-main">
        <div className="youxi-final-player">
          <div className="youxi-story-empty-preview">
            <div className="youxi-story-empty-state">
              <Film size={24} />
              <strong>尚未生成成片</strong>
              <span>本集分镜出片后可在此拼接并导出 MP4</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function DramaWorkbench({ seriesId }) {
  const id = seriesId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const seriesQuery = useQuery({
    queryKey: ["drama-series", id],
    queryFn: () => fetchDramaSeriesDetail(id),
    enabled: Boolean(id),
  });
  const series = seriesQuery.data;
  const episode = series?.episodes?.[0];
  const [step, setStep] = useState("script");
  const [notice, setNotice] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

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
          <button className="drama-project-title" type="button" onClick={() => { setRenameDraft(series.name); setRenameOpen(true); }} aria-label="修改项目名称">
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
            <Pencil size={13} />
          </button>
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
      {step === "script" && (
        <div className="drama-step drama-step--slot">
          <DramaScriptPanel episode={episode} series={series} />
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
      {step === "film" && <FilmSlot />}
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
              onClick={() => {
                setExportOpen(false);
                showNotice("成片拼接将在后续波次接入，本步仅保留导出入口");
              }}
            >
              <Film size={20} />
              <span>
                <strong>导出成片</strong>
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
