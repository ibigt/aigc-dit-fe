import { ChevronRight, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createDramaSeries, deleteDramaSeries, fetchDramaSeries, fetchDramaTextModels, updateDramaSeries } from "../../api/drama.js";
import { formatDateTime, mediaUrl } from "../../lib/media.js";

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
  const listQuery = useQuery({
    queryKey: ["drama-series"],
    queryFn: fetchDramaSeries,
  });
  const textModelsQuery = useQuery({
    queryKey: ["drama-text-models"],
    queryFn: fetchDramaTextModels,
  });
  const textModels = textModelsQuery.data || [];
  const series = listQuery.data || [];

  useEffect(() => {
    if (!creating || !textModels.length) return undefined;
    setForm((current) => (current.textModelId ? current : { ...current, textModelId: String(textModels[0].id) }));
    return undefined;
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
      textModelId: form.textModelId ? Number(form.textModelId) : undefined,
    });
  }

  function onRename(event) {
    event.preventDefault();
    const name = renameDraft.trim();
    if (!name || !renameTarget) return;
    renameMutation.mutate({ id: renameTarget.id, name });
  }

  return (
    <section className="drama-library">
      <h1 className="visually-hidden">短剧创作</h1>
      <header className="drama-library__header">
        <div className="drama-library__tabs">
          <button type="button" className="active">我的项目 <span>({series.length})</span></button>
        </div>
        <button className="button button--primary drama-create-button" type="button" onClick={() => setCreating(true)}>
          <Plus size={18} /> 创建项目
        </button>
      </header>
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
                <span>共{episodeCount}集</span>
                <button
                  type="button"
                  aria-label={`打开${item.name}菜单`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenu(menu === item.id ? null : item.id);
                  }}
                >
                  <MoreHorizontal size={19} />
                </button>
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
                        if (window.confirm(`确定删除「${item.name}」？剧集、剧本、资产和分镜会一并删除，且不可恢复。`)) {
                          deleteMutation.mutate(item.id);
                        }
                      }}
                    >
                      <Trash2 size={15} /> 删除项目
                    </button>
                  </div>
                )}
              </div>
              <div className="drama-project-card__body">
                <strong>{item.name}</strong>
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
                required={textModels.length > 0}
              >
                {textModels.length === 0 && <option value="">暂无已启用文本模型（可先创建项目）</option>}
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
                disabled={createMutation.isPending || !form.name.trim() || (textModels.length > 0 && !form.textModelId)}
              >
                {createMutation.isPending ? "创建中…" : "创建并进入"} <ChevronRight size={16} />
              </button>
            </footer>
          </form>
        </DramaDialog>
      )}
      {renameTarget && (
        <DramaDialog title="修改项目名称" eyebrow="项目基础信息" onClose={() => { if (!renameMutation.isPending) setRenameTarget(null); }}>
          <form className="drama-create-form" onSubmit={onRename}>
            <label>
              项目名称
              <input autoFocus required maxLength={128} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} />
            </label>
            {renameMutation.isError && <p className="drama-form-error">{renameMutation.error.message}</p>}
            <footer>
              <button type="button" onClick={() => setRenameTarget(null)}>取消</button>
              <button className="button button--primary" type="submit" disabled={renameMutation.isPending || !renameDraft.trim()}>
                {renameMutation.isPending ? "保存中…" : "保存"}
              </button>
            </footer>
          </form>
        </DramaDialog>
      )}
    </section>
  );
}
