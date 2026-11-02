import { ChevronRight, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  bindDramaImageModel,
  bindDramaVideoModel,
  createDramaSeries,
  deleteDramaSeries,
  fetchDramaImageModels,
  fetchDramaSeries,
  fetchDramaTextModels,
  fetchDramaVideoModels,
  updateDramaSeries,
} from "../../api/drama.js";
import { formatDateTime, mediaUrl } from "../../lib/media.js";
import { ConfirmDialog } from "../ConfirmDialog.jsx";
import { DemoSelect } from "../DemoSelect.jsx";
import { DramaStylePicker } from "./DramaStylePicker.jsx";
import { DEFAULT_DRAMA_STYLE_KEY } from "./dramaStyles.js";
import { DRAMA_ASPECT_RATIOS, preferredResolution, resolutionOptionsFor } from "./dramaSpecs.js";

const emptyForm = {
  name: "",
  synopsis: "",
  textModelId: "",
  imageModelId: "",
  videoModelId: "",
  aspectRatio: "16:9",
  defaultResolution: "720P",
  styleKey: DEFAULT_DRAMA_STYLE_KEY,
};

function DramaDialog({ title, eyebrow, wide, onClose, children }) {
  return (
    <div className={`drama-dialog-backdrop${wide ? " drama-dialog-backdrop--sheet" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`drama-dialog${wide ? " drama-dialog--create" : ""}`} role="dialog" aria-modal="true" aria-labelledby="drama-dialog-title">
        <header>
          <div>
            {eyebrow && <span>{eyebrow}</span>}
            <h2 id="drama-dialog-title">{title}</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function GradientDotField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return undefined;

    const draw = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const spacing = width < 760 ? 18 : 20;
      const radius = width < 760 ? 1.15 : 1.35;
      const centers = [
        { x: .42, y: .27, color: [217, 134, 50], spread: .105, strength: .48 },
        { x: .45, y: .34, color: [181, 166, 55], spread: .10, strength: .58 },
        { x: .48, y: .49, color: [67, 195, 200], spread: .17, strength: 1.1 },
        { x: .59, y: .50, color: [60, 168, 232], spread: .18, strength: 1.25 },
        { x: .65, y: .54, color: [57, 119, 232], spread: .16, strength: 1.05 },
        { x: .53, y: .68, color: [100, 93, 230], spread: .14, strength: .62 },
      ];

      for (let y = spacing / 2; y < height; y += spacing) {
        for (let x = spacing / 2; x < width; x += spacing) {
          const normalizedX = x / width;
          const normalizedY = y / height;
          const ellipseDistance = Math.sqrt(((normalizedX - .54) / .34) ** 2 + ((normalizedY - .50) / .42) ** 2);
          const edgeAlpha = Math.max(0, Math.min(1, (1 - ellipseDistance) / .32));
          let total = 0;
          let red = 0;
          let green = 0;
          let blue = 0;

          for (const center of centers) {
            const deltaX = normalizedX - center.x;
            const deltaY = normalizedY - center.y;
            const weight = center.strength * Math.exp(-(deltaX * deltaX + deltaY * deltaY) / (2 * center.spread * center.spread));
            total += weight;
            red += center.color[0] * weight;
            green += center.color[1] * weight;
            blue += center.color[2] * weight;
          }

          const alpha = .025 + (.08 + .78 * edgeAlpha) * Math.min(1, total * .82);
          const ambientMix = total < .02 ? [92, 98, 108] : [red / total, green / total, blue / total];
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fillStyle = `rgba(${Math.round(ambientMix[0])},${Math.round(ambientMix[1])},${Math.round(ambientMix[2])},${alpha.toFixed(3)})`;
          context.fill();
        }
      }
    };

    const observer = new ResizeObserver(draw);
    observer.observe(container);
    draw();
    return () => observer.disconnect();
  }, []);

  return <canvas ref={canvasRef} className="gradient-dot-field" aria-hidden="true" />;
}

export function DramaHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [nameError, setNameError] = useState("");
  const [menu, setMenu] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const listQuery = useQuery({
    queryKey: ["drama-series"],
    queryFn: fetchDramaSeries,
  });

  useEffect(() => {
    if (!renameTarget) return;
    const input = document.querySelector(".project-name-input");
    input?.focus();
    input?.select();
  }, [renameTarget]);

  const textModelsQuery = useQuery({
    queryKey: ["drama-text-models"],
    queryFn: fetchDramaTextModels,
    enabled: creating,
  });
  const imageModelsQuery = useQuery({
    queryKey: ["drama-image-models"],
    queryFn: fetchDramaImageModels,
    enabled: creating,
  });
  const videoModelsQuery = useQuery({
    queryKey: ["drama-video-models"],
    queryFn: fetchDramaVideoModels,
    enabled: creating,
  });
  const textModels = textModelsQuery.data || [];
  const imageModels = imageModelsQuery.data || [];
  const videoModels = videoModelsQuery.data || [];
  const series = listQuery.data || [];
  const resolutionOptions = resolutionOptionsFor(
    videoModels.find((item) => String(item.id) === String(form.videoModelId)),
  );

  useEffect(() => {
    if (!creating) return;
    setForm((current) => {
      const textModelId = current.textModelId || (textModels[0] ? String(textModels[0].id) : "");
      const imageModelId = current.imageModelId || (imageModels[0] ? String(imageModels[0].id) : "");
      const videoModelId = current.videoModelId || (videoModels[0] ? String(videoModels[0].id) : "");
      if (
        textModelId === current.textModelId
        && imageModelId === current.imageModelId
        && videoModelId === current.videoModelId
      ) return current;
      return { ...current, textModelId, imageModelId, videoModelId };
    });
  }, [creating, textModels, imageModels, videoModels]);

  useEffect(() => {
    if (!creating) return;
    setForm((current) => {
      if (!resolutionOptions.length || resolutionOptions.includes(current.defaultResolution)) return current;
      return { ...current, defaultResolution: preferredResolution(resolutionOptions, current.defaultResolution) };
    });
  }, [creating, form.videoModelId, resolutionOptions]);

  useEffect(() => {
    if (menu == null) return undefined;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const deleteMutation = useMutation({
    mutationFn: deleteDramaSeries,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drama-series"] });
      queryClient.invalidateQueries({ queryKey: ["creations"] });
    },
    onError: (error) => window.alert(error.message || "删除失败"),
  });
  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const created = await createDramaSeries({
        name: payload.name,
        synopsis: payload.synopsis,
        textModelId: payload.textModelId,
        styleKey: payload.styleKey,
        aspectRatio: payload.aspectRatio,
        defaultResolution: payload.defaultResolution,
      });
      const warnings = [];
      if (payload.imageModelId) {
        try {
          await bindDramaImageModel(created.id, Number(payload.imageModelId));
        } catch (error) {
          warnings.push(error.message || "图片模型绑定失败");
        }
      }
      if (payload.videoModelId) {
        try {
          await bindDramaVideoModel(created.id, Number(payload.videoModelId));
        } catch (error) {
          warnings.push(error.message || "视频模型绑定失败");
        }
      }
      return { created, warnings };
    },
    onSuccess: ({ created, warnings }) => {
      queryClient.invalidateQueries({ queryKey: ["drama-series"] });
      setCreating(false);
      setForm(emptyForm);
      if (warnings.length) window.alert(warnings.join("\n"));
      navigate(`/console/drama/${created.id}`);
    },
  });
  const renameMutation = useMutation({
    mutationFn: ({ id, name }) => updateDramaSeries(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drama-series"] });
      setRenameTarget(null);
      setRenameDraft("");
    },
  });

  function resetCreate() {
    setCreating(false);
    setForm(emptyForm);
    setNameError("");
  }

  function closeCreate() {
    if (createMutation.isPending) return;
    resetCreate();
  }

  function onSubmit(event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setNameError("项目名称必填");
      return;
    }
    setNameError("");
    createMutation.mutate({
      name,
      synopsis: form.synopsis.trim(),
      textModelId: Number(form.textModelId),
      imageModelId: form.imageModelId,
      videoModelId: form.videoModelId,
      styleKey: form.styleKey,
      aspectRatio: form.aspectRatio,
      defaultResolution: form.defaultResolution,
    });
  }

  function commitRename() {
    const name = renameDraft.trim();
    if (!name || !renameTarget) {
      return;
    }
    renameMutation.mutate({ id: renameTarget.id, name });
  }

  const emptyState = !listQuery.isLoading && !listQuery.isError && series.length === 0;

  return (
    <section className={`drama-library short-drama-page drama-project-list${emptyState ? " is-empty" : ""}`}>
      <header className="drama-library__header">
        <div className="page-header">
          <div>
            <h1>短剧创作</h1>
            <p>组织剧集、镜头和生成素材，完成连续内容创作</p>
          </div>
        </div>
        {!emptyState && (
          <button className="page-primary-action" type="button" onClick={() => setCreating(true)}>
            <Plus size={18} /> 创建项目
          </button>
        )}
      </header>
      {listQuery.isError && <p className="drama-form-error">{listQuery.error.message || "加载项目失败"}</p>}
      {emptyState ? (
        <div className="creation-canvas">
          <GradientDotField />
          <div className="create-action">
            <button className="create-project-button" type="button" onClick={() => setCreating(true)}>
              <Plus size={16} /> <span>创建项目</span>
            </button>
            <span className="cursor-guide" aria-hidden="true">
              <span className="cursor-ripple" />
              <span className="cursor-ripple secondary" />
              <svg viewBox="0 0 26 30" fill="none">
                <defs>
                  <linearGradient id="cursorGradient" x1="3" y1="2" x2="19" y2="25" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#A99BFF" /><stop offset=".52" stopColor="#7668FF" /><stop offset="1" stopColor="#4D72E8" />
                  </linearGradient>
                </defs>
                <path d="M2.5 2.2 22.7 16.5l-8.5 1.8-4.1 9-7.6-25.1Z" fill="url(#cursorGradient)" stroke="#E8E5FF" strokeWidth="2.8" strokeLinejoin="round" />
                <path d="M2.5 2.2 22.7 16.5l-8.5 1.8-4.1 9-7.6-25.1Z" stroke="#6558E8" strokeWidth="1.1" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="project-count">我的项目 · <span>{series.length}</span></div>
          <div className="drama-project-grid">
            {listQuery.isLoading && <div className="drama-empty">正在加载项目…</div>}
        {series.map((item) => {
          const cover = mediaUrl(item.coverUrl || item.coverKey);
          const episodeCount = item.episodeCount || item.episodes?.length || item.plannedEpisodeCount || 1;
          return (
            <article
              className="drama-project-card"
              key={item.id}
              tabIndex={0}
              role="link"
              aria-label={`打开项目 ${item.name}`}
              onClick={(event) => {
                if (event.target.closest("button,input,.drama-project-menu")) return;
                if (renameTarget || menu) return;
                navigate(`/console/drama/${item.id}`);
              }}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button,input,.drama-project-menu")) {
                  event.preventDefault();
                  if (!renameTarget && !menu) navigate(`/console/drama/${item.id}`);
                }
              }}
            >
              <div className={`drama-project-card__cover ${cover ? "" : "is-empty"}`}>
                {cover ? (
                  <img src={cover} alt="" />
                ) : (
                  <div className="drama-project-card__placeholder" />
                )}

              </div>
              <div className="drama-project-card__body">
                <div className="project-title-row">
                  {renameTarget?.id === item.id ? (
                    <input
                      autoFocus
                      className={`project-name-input${renameDraft.trim() ? "" : " is-invalid"}`}
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
                          setRenameTarget(null);
                          setRenameDraft("");
                        }
                      }}
                    />
                  ) : (
                    <strong>{item.name}</strong>
                  )}
                  <button
                    type="button"
                    aria-label={`打开${item.name}菜单`}
                    aria-expanded={menu === item.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenu(menu === item.id ? null : item.id);
                    }}
                  >
                    <MoreHorizontal size={19} />
                  </button>
                </div>
                {menu === item.id && (
                  <div className="drama-project-menu" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameTarget(item);
                        setRenameDraft(item.name);
                        setMenu(null);
                      }}
                    >
                      <Pencil size={15} /> 修改名称
                    </button>
                    <button
                      type="button"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        setMenu(null);
                        setDeleteTarget(item);
                      }}
                    >
                      <Trash2 size={15} /> 删除项目
                    </button>
                  </div>
                )}
                <p>{item.synopsis || (item.textModelName ? `文本模型 · ${item.textModelName}` : (item.latestEpisode?.name || "新的短剧项目"))}</p>
                <footer><span>{formatDateTime(item.createdAt)}</span></footer>
              </div>
            </article>
          );
        })}
          </div>
        </>
      )}
      {creating && (
        <DramaDialog title="创建短剧" eyebrow="从一个故事开始" wide onClose={closeCreate}>
          <form id="create-drama-form" className="drama-create-form" onSubmit={onSubmit}>
            <label>
              项目名称
              <input
                autoFocus
                maxLength={128}
                value={form.name}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "create-drama-name-error" : undefined}
                className={nameError ? "is-invalid" : undefined}
                onChange={(event) => {
                  const name = event.target.value;
                  setForm({ ...form, name });
                  if (name.trim()) setNameError("");
                }}
              />
              {nameError && <small id="create-drama-name-error" className="drama-field-error">{nameError}</small>}
            </label>
            <label>
              故事简介
              <small className="drama-field-count">{form.synopsis.length} / 200</small>
              <textarea
                maxLength={200}
                value={form.synopsis}
                onChange={(event) => setForm({ ...form, synopsis: event.target.value })}
                placeholder="用一两句话描述核心人物与冲突（可选，最多 200 字）"
              />
            </label>
            <div>
              <label>
                文本模型
                <DemoSelect
                  ariaLabel="文本模型"
                  value={form.textModelId}
                  onChange={(value) => setForm({ ...form, textModelId: value })}
                  disabled={textModelsQuery.isLoading || textModelsQuery.isError}
                  options={[
                    ...(textModelsQuery.isLoading ? [{ value: "", label: "正在加载文本模型…", disabled: true }] : []),
                    ...(textModelsQuery.isError ? [{ value: "", label: "文本模型加载失败", disabled: true }] : []),
                    ...(!textModelsQuery.isLoading && !textModelsQuery.isError && textModels.length === 0
                      ? [{ value: "", label: "暂无已启用文本模型", disabled: true }]
                      : []),
                    ...textModels.map((item) => ({
                      value: String(item.id),
                      label: `${item.name}${item.provider ? ` · ${item.provider}` : ""}`,
                    })),
                  ]}
                />
              </label>
              <label>
                图片模型
                <DemoSelect
                  aria-label="图片模型"
                  value={form.imageModelId}
                  onChange={(value) => setForm({ ...form, imageModelId: value })}
                  disabled={imageModelsQuery.isLoading || imageModelsQuery.isError}
                  options={[
                    ...(imageModelsQuery.isLoading ? [{ value: "", label: "正在加载图片模型…", disabled: true }] : []),
                    ...(imageModelsQuery.isError ? [{ value: "", label: "图片模型加载失败", disabled: true }] : []),
                    ...(!imageModelsQuery.isLoading && !imageModelsQuery.isError && imageModels.length === 0
                      ? [{ value: "", label: "暂无已启用图片模型", disabled: true }]
                      : []),
                    ...imageModels.map((item) => ({
                      value: String(item.id),
                      label: `${item.name}${item.provider ? ` · ${item.provider}` : ""}`,
                    })),
                  ]}
                />
              </label>
            </div>
            <div className="drama-create-form__full">
              <label>
                视频模型
                <DemoSelect
                  aria-label="视频模型"
                  value={form.videoModelId}
                  onChange={(value) => setForm({ ...form, videoModelId: value })}
                  disabled={videoModelsQuery.isLoading || videoModelsQuery.isError}
                  options={[
                    ...(videoModelsQuery.isLoading ? [{ value: "", label: "正在加载视频模型…", disabled: true }] : []),
                    ...(videoModelsQuery.isError ? [{ value: "", label: "视频模型加载失败", disabled: true }] : []),
                    ...(!videoModelsQuery.isLoading && !videoModelsQuery.isError && videoModels.length === 0
                      ? [{ value: "", label: "暂无已启用视频模型", disabled: true }]
                      : []),
                    ...videoModels.map((item) => ({
                      value: String(item.id),
                      label: `${item.name}${item.provider ? ` · ${item.provider}` : ""}`,
                    })),
                  ]}
                />
              </label>
            </div>
            <div>
              <label>
                视频比例
                <DemoSelect
                  aria-label="视频比例"
                  value={form.aspectRatio}
                  onChange={(value) => setForm({ ...form, aspectRatio: value })}
                  options={DRAMA_ASPECT_RATIOS.map((item) => ({ value: item.id, label: item.label }))}
                />
              </label>
              <label>
                视频清晰度
                <DemoSelect
                  aria-label="视频清晰度"
                  value={resolutionOptions.includes(form.defaultResolution) ? form.defaultResolution : resolutionOptions[resolutionOptions.length - 1]}
                  onChange={(value) => setForm({ ...form, defaultResolution: value })}
                  options={resolutionOptions.map((item) => ({ value: item, label: item }))}
                />
              </label>
            </div>
            <div className="drama-create-form__style">
              <span>风格参考</span>
              <DramaStylePicker
                value={form.styleKey}
                onChange={(next) => setForm((current) => ({ ...current, styleKey: next }))}
              />
            </div>
            {createMutation.isError && <p className="drama-form-error">{createMutation.error.message}</p>}
          </form>
          <footer className="drama-create-footer">
            <button type="button" onClick={resetCreate}>取消</button>
            <button
              className="button button--primary"
              type="submit"
              form="create-drama-form"
              disabled={
                createMutation.isPending
                || !form.textModelId
                || (imageModels.length > 0 && !form.imageModelId)
                || (videoModels.length > 0 && !form.videoModelId)
              }
            >
              {createMutation.isPending ? "创建中…" : "创建并进入"}
            </button>
          </footer>
        </DramaDialog>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        eyebrow="短剧"
        title="删除项目？"
        message={deleteTarget
          ? `确定删除「${deleteTarget.name}」？剧集、剧本、资产和分镜会一并删除，且不可恢复。`
          : ""}
        confirmLabel="删除"
        busy={deleteMutation.isPending}
        busyLabel="删除中…"
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.id, {
            onSuccess: () => setDeleteTarget(null),
          });
        }}
      />
    </section>
  );
}
