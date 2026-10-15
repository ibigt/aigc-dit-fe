import { ChevronRight, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createDramaSeries, deleteDramaSeries, fetchDramaSeries, fetchDramaTextModels, updateDramaSeries } from "../../api/drama.js";
import { formatDateTime, mediaUrl } from "../../lib/media.js";
import { ConfirmDialog } from "../ConfirmDialog.jsx";

const emptyForm = {
  name: "",
  summary: "",
  textModelId: "",
};

function DramaDialog({ title, eyebrow, onClose, children }) {
  return (
    <div className="drama-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="drama-dialog" role="dialog" aria-modal="true" aria-labelledby="drama-dialog-title">
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

export function DramaHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [menu, setMenu] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const listQuery = useQuery({
    queryKey: ["drama-series"],
    queryFn: fetchDramaSeries,
  });
  const textModelsQuery = useQuery({
    queryKey: ["drama-text-models"],
    queryFn: fetchDramaTextModels,
    enabled: creating,
  });
  const textModels = textModelsQuery.data || [];
  const series = listQuery.data || [];

  useEffect(() => {
    if (!creating || !textModels.length) return;
    setForm((current) => (current.textModelId ? current : { ...current, textModelId: String(textModels[0].id) }));
  }, [creating, textModels]);

  useEffect(() => {
    if (menu == null) return undefined;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const deleteMutation = useMutation({
    mutationFn: deleteDramaSeries,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drama-series"] }),
    onError: (error) => window.alert(error.message || "删除失败"),
  });
  const createMutation = useMutation({
    mutationFn: createDramaSeries,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["drama-series"] });
      setCreating(false);
      setForm(emptyForm);
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

  function onSubmit(event) {
    event.preventDefault();
    createMutation.mutate({
      name: form.name.trim(),
      textModelId: Number(form.textModelId),
    });
  }

  function commitRename() {
    const name = renameDraft.trim();
    if (!name || !renameTarget) {
      return;
    }
    renameMutation.mutate({ id: renameTarget.id, name });
  }

  return (
    <section className="drama-library short-drama-page drama-project-list">
      <header className="drama-library__header">
        <div className="page-header">
          <div>
            <h1>短剧创作</h1>
            <p>组织剧集、镜头和生成素材，完成连续内容创作</p>
          </div>
        </div>
        <button className="page-primary-action" type="button" onClick={() => setCreating(true)}>
          <Plus size={18} /> 创建项目
        </button>
      </header>
      <div className="project-count">我的项目 · <span>{series.length}</span></div>
      {listQuery.isError && <p className="drama-form-error">{listQuery.error.message || "加载项目失败"}</p>}
      <div className="drama-project-grid">
        {listQuery.isLoading && <div className="drama-empty">正在加载项目…</div>}
        {!listQuery.isLoading && series.length === 0 && <div className="drama-empty">还没有短剧项目，点击右上角创建</div>}
        {series.map((item) => {
          const cover = mediaUrl(item.coverUrl || item.coverKey);
          const episodeCount = item.episodeCount || item.episodes?.length || item.plannedEpisodeCount || 1;
          return (
            <article className="drama-project-card" key={item.id}>
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
                <p>{item.textModelName ? `文本模型 · ${item.textModelName}` : (item.latestEpisode?.name || "新的短剧项目")}</p>
                <footer><span>{formatDateTime(item.updatedAt)}</span></footer>
              </div>
              <button
                className="drama-project-card__open"
                type="button"
                aria-label={`打开短剧项目：${item.name}`}
                onClick={() => navigate(`/console/drama/${item.id}`)}
              />
            </article>
          );
        })}
      </div>
      {creating && (
        <DramaDialog title="创建短剧" eyebrow="从一个故事开始" onClose={() => { if (!createMutation.isPending) { setCreating(false); setForm(emptyForm); } }}>
          <form className="drama-create-form" onSubmit={onSubmit}>
            <label>
              项目名称
              <input
                autoFocus
                required
                maxLength={128}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="例如：侦探社"
              />
            </label>
            <label>
              故事简介
              <textarea
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
                placeholder="用一两句话描述核心人物与冲突（可选，风格与画幅稍后在剧本步设定）"
              />
            </label>
            <label>
              文本模型
              <select
                value={form.textModelId}
                onChange={(event) => setForm({ ...form, textModelId: event.target.value })}
                disabled={textModelsQuery.isLoading || textModelsQuery.isError}
                required
              >
                {textModelsQuery.isLoading && <option value="">正在加载文本模型…</option>}
                {textModelsQuery.isError && <option value="">文本模型加载失败</option>}
                {!textModelsQuery.isLoading && !textModelsQuery.isError && textModels.length === 0 && (
                  <option value="">暂无已启用文本模型</option>
                )}
                {textModels.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.provider ? ` · ${item.provider}` : ""}</option>
                ))}
              </select>
            </label>
            {createMutation.isError && <p className="drama-form-error">{createMutation.error.message}</p>}
            <footer>
              <button type="button" onClick={() => { setCreating(false); setForm(emptyForm); }}>取消</button>
              <button
                className="button button--primary"
                type="submit"
                disabled={createMutation.isPending || !form.name.trim() || !form.textModelId}
              >
                {createMutation.isPending ? "创建中…" : "创建并进入"} <ChevronRight size={16} />
              </button>
            </footer>
          </form>
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
