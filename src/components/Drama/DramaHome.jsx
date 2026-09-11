import { Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createDramaSeries, deleteDramaSeries, fetchDramaSeries, fetchDramaTextModels } from "../../api/drama.js";
import { formatDateTime } from "../../lib/media.js";
import { DramaStylePicker } from "./DramaStylePicker.jsx";
import { DEFAULT_DRAMA_STYLE_KEY, dramaStyleOf } from "./dramaStyles.js";

const ASPECT_RATIOS = ["16:9", "9:16", "1:1"];
const RESOLUTIONS = ["720P", "480P"];
const DURATIONS = [5, 10, 15];

const emptyForm = {
  name: "",
  styleKey: DEFAULT_DRAMA_STYLE_KEY,
  aspectRatio: "16:9",
  defaultResolution: "720P",
  defaultDurationSec: 5,
  plannedEpisodeCount: 1,
  firstEpisodeName: "第 1 集",
  textModelId: "",
};

export function DramaHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const listQuery = useQuery({
    queryKey: ["drama-series"],
    queryFn: fetchDramaSeries,
  });
  const textModelsQuery = useQuery({
    queryKey: ["drama-text-models"],
    queryFn: fetchDramaTextModels,
  });
  const textModels = textModelsQuery.data || [];
  const deleteMutation = useMutation({
    mutationFn: deleteDramaSeries,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drama-series"] }),
    onError: (error) => window.alert(error.message || "删除失败"),
  });
  const createMutation = useMutation({
    mutationFn: createDramaSeries,
    onSuccess: (series) => {
      queryClient.invalidateQueries({ queryKey: ["drama-series"] });
      setCreating(false);
      setForm(emptyForm);
      navigate(`/console/drama/${series.id}`);
    },
  });
  const series = useMemo(() => {
    const items = listQuery.data || [];
    const keyword = query.trim();
    if (!keyword) return items;
    return items.filter((item) => {
      const style = dramaStyleOf(item.styleKey);
      return `${item.name || ""} ${item.styleName || style.name}`.includes(keyword);
    });
  }, [listQuery.data, query]);

  useEffect(() => {
    if (!creating || !textModels.length) return undefined;
    setForm((current) => (current.textModelId ? current : { ...current, textModelId: textModels[0].id }));
    return undefined;
  }, [creating, textModels]);

  function onSubmit(event) {
    event.preventDefault();
    createMutation.mutate({
      name: form.name.trim(),
      styleKey: form.styleKey,
      aspectRatio: form.aspectRatio,
      defaultResolution: form.defaultResolution,
      defaultDurationSec: form.defaultDurationSec,
      plannedEpisodeCount: Number(form.plannedEpisodeCount) || 1,
      firstEpisodeName: form.firstEpisodeName,
      textModelId: form.textModelId ? Number(form.textModelId) : undefined,
    });
  }

  return (
    <div className="drama-page">
      <header className="page-heading">
        <div>
          <h1>漫剧</h1>
          <p>独立项目容器：系列、剧集与四步工作台。本阶段只建项目，不接生成。</p>
        </div>
        <button className="button button--primary" type="button" onClick={() => setCreating(true)}>
          <Plus size={16} /> 新建项目
        </button>
      </header>
      <section className="drama-toolbar">
        <label>
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索系列名称或风格" />
        </label>
        <span>{series.length} 个项目</span>
      </section>
      <section className="drama-grid">
        <button className="drama-new-card" type="button" onClick={() => setCreating(true)}>
          <span><Plus size={22} /></span>
          <strong>新建漫剧项目</strong>
          <small>默认 720P · 5 秒 · 16:9</small>
        </button>
        {series.map((item) => {
          const episode = item.latestEpisode;
          const style = dramaStyleOf(item.styleKey);
          const cover = item.styleCover || style.cover;
          return (
            <article className="drama-card" key={item.id}>
              <button className="drama-card__cover" type="button" onClick={() => navigate(`/console/drama/${item.id}`)}>
                <img
                  src={cover}
                  alt=""
                  onError={(event) => {
                    if (event.currentTarget.dataset.fallback === "1") return;
                    event.currentTarget.dataset.fallback = "1";
                    event.currentTarget.src = style.fallback;
                  }}
                />
                <span className="drama-card__spec">{item.defaultResolution} · {item.defaultDurationSec}秒 · {item.aspectRatio}</span>
                <span className="drama-card__open">打开工作台</span>
              </button>
              <div className="drama-card__body">
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.styleName || style.name}{item.textModelName ? ` · ${item.textModelName}` : ""}</p>
                </div>
                <footer>
                  <span>{episode ? `${episode.name} · ${episode.status}` : "未开始"}</span>
                  <div className="drama-card__footer-actions">
                    <b>{formatDateTime(item.updatedAt)}</b>
                    <button
                      type="button"
                      className="button button--danger drama-card__delete"
                      disabled={deleteMutation.isPending}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (window.confirm(`确定删除「${item.name}」？剧集、剧本、资产和分镜会一并删除，且不可恢复。`)) {
                          deleteMutation.mutate(item.id);
                        }
                      }}
                    >
                      <Trash2 size={13} /> 删除
                    </button>
                  </div>
                </footer>
              </div>
            </article>
          );
        })}
      </section>
      {creating && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !createMutation.isPending) setCreating(false); }}>
          <section className="model-dialog drama-dialog" role="dialog" aria-modal="true" aria-labelledby="drama-create-title">
            <header>
              <div>
                <span className="modal-kicker">DRAMA PROJECT</span>
                <h2 id="drama-create-title">新建漫剧项目</h2>
                <p>选一张风格图例即可。编译用的风格前缀由系统写入，表单里不会出现。</p>
              </div>
              <button className="modal-close" type="button" aria-label="关闭" onClick={() => setCreating(false)}>×</button>
            </header>
            <form onSubmit={onSubmit}>
              <div className="model-form-grid">
                <label className="model-form-wide">
                  系列名称
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：侦探社" required maxLength={128} />
                </label>
                <label>
                  第 1 集名称
                  <input value={form.firstEpisodeName} onChange={(e) => setForm({ ...form, firstEpisodeName: e.target.value })} maxLength={128} />
                </label>
                <label>
                  规划集数
                  <input type="number" min={1} max={99} value={form.plannedEpisodeCount} onChange={(e) => setForm({ ...form, plannedEpisodeCount: e.target.value })} />
                </label>
                <label>
                  画幅
                  <select value={form.aspectRatio} onChange={(e) => setForm({ ...form, aspectRatio: e.target.value })}>
                    {ASPECT_RATIOS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  默认清晰度
                  <select value={form.defaultResolution} onChange={(e) => setForm({ ...form, defaultResolution: e.target.value })}>
                    {RESOLUTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  默认单镜时长
                  <select value={form.defaultDurationSec} onChange={(e) => setForm({ ...form, defaultDurationSec: Number(e.target.value) })}>
                    {DURATIONS.map((item) => <option key={item} value={item}>{item} 秒</option>)}
                  </select>
                </label>
                <label className="model-form-wide">
                  文本模型
                  <select
                    value={form.textModelId}
                    onChange={(e) => setForm({ ...form, textModelId: e.target.value })}
                    required={textModels.length > 0}
                  >
                    {textModels.length === 0 && <option value="">暂无已启用文本模型（可先创建项目）</option>}
                    {textModels.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}{item.provider ? ` · ${item.provider}` : ""}</option>
                    ))}
                  </select>
                </label>
                <div className="model-form-wide">
                  <DramaStylePicker value={form.styleKey} onChange={(styleKey) => setForm({ ...form, styleKey })} />
                </div>
              </div>
              {createMutation.isError && <p className="drama-form-error">{createMutation.error.message}</p>}
              <footer>
                <span><Sparkles size={12} /> 验收默认 720P × 5 秒 × 16:9</span>
                <div>
                  <button type="button" onClick={() => setCreating(false)}>取消</button>
                  <button className="button--primary" type="submit" disabled={createMutation.isPending || !form.name.trim() || (textModels.length > 0 && !form.textModelId)}>
                    {createMutation.isPending ? "创建中…" : "创建并打开"}
                  </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
