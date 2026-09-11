import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Lock, RectangleHorizontal, RectangleVertical, RefreshCw, Square, Wand2 } from "lucide-react";
import { generateDramaScript, importDramaScript, lockDramaScript, updateDramaSeries } from "../../api/drama.js";
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

function sceneTitle(scene, index) {
  return scene.heading || `第${scene.index ?? index + 1}场`;
}

/**
 * 剧本步骤：导入原文 → 分场渲染 → 锁定；右侧可选风格与视频比例。
 * 分场结果由后端 DramaTextService 产出，这里只渲染与触发，不组装字段。
 */
export function DramaScriptPanel({ episode, series }) {
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState("");

  useEffect(() => {
    if (episode) setRaw(episode.sourceText || "");
  }, [episode?.id, episode?.sourceText]);

  function refreshSeries() {
    queryClient.invalidateQueries({ queryKey: ["drama-series"] });
    queryClient.invalidateQueries({ queryKey: ["drama-series", series?.id || episode?.seriesId] });
  }

  const run = useMutation({
    mutationFn: (mode) => {
      if (!episode) throw new Error("请先创建剧集");
      if (mode === "import") return importDramaScript(episode.id, raw);
      if (mode === "generate") return generateDramaScript(episode.id, raw);
      return lockDramaScript(episode.id);
    },
    onSuccess: refreshSeries,
    onError: refreshSeries,
  });

  const settings = useMutation({
    mutationFn: (payload) => {
      if (!series?.id) throw new Error("请先打开短剧项目");
      return updateDramaSeries(series.id, payload);
    },
    onSuccess: refreshSeries,
  });

  const scenes = episode?.script?.scenes || [];
  const locked = episode?.status === "已锁定";
  const styleKey = series?.styleKey || DEFAULT_DRAMA_STYLE_KEY;
  const aspectRatio = series?.aspectRatio || "16:9";

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
            placeholder={"第一场 幻梦侦探社 日 内\n人物：洛白、夏安、局长\n道具：古铜怀表\n洛白：开始了。"}
            onChange={(event) => setRaw(event.target.value)}
          />
        </label>

        {episode?.canGenerate === false && episode?.textServiceAvailable && !locked && (
          <p className="drama-script__hint">
            {series?.textModelId
              ? "已绑定文本模型，但通道不可用（请到管理端检查 Base URL / 适配协议）。未修好前导入只走规则分场。"
              : "该项目未绑定可用文本模型，只会走规则分场。"}
          </p>
        )}
        {run.isError && <p className="drama-form-error">{run.error.message}</p>}
        {locked && <p className="drama-script__hint">已锁定。再改原文会回到待确认，下游资产与分镜标为已过期。</p>}

        <div className="drama-script__actions">
          <button className="button" type="button" disabled={!raw.trim() || run.isPending || locked} onClick={() => run.mutate("import")}>
            <RefreshCw size={15} /> {run.isPending && run.variables === "import" ? "解析中…" : "导入并分场"}
          </button>
          <button
            className="button"
            type="button"
            disabled={!raw.trim() || run.isPending || !episode?.canGenerate || locked}
            title={episode?.canGenerate ? "" : "项目需绑定已启用的文本模型"}
            onClick={() => run.mutate("generate")}
          >
            <Wand2 size={15} /> {run.isPending && run.variables === "generate" ? "生成中…" : "文本模型生成"}
          </button>
          <button className="button" type="button" disabled={scenes.length === 0 || run.isPending || locked} onClick={() => run.mutate("lock")}>
            <Lock size={15} /> {locked ? "已锁定" : "锁定剧本"}
          </button>
        </div>

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
          <p className="drama-script__empty">还没有分场结果。粘贴原文后点「导入并分场」。</p>
        )}
      </section>

      <aside className="drama-script-settings">
        <section className="settings-block">
          <header>
            <strong>视频比例</strong>
            <span>用于全部分镜和成片</span>
          </header>
          <div className="ratio-card-grid drama-ratio-grid">
            {ASPECT_RATIOS.map((item) => {
              const Icon = item.Icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={aspectRatio === item.id ? "active" : ""}
                  disabled={settings.isPending || !series?.id}
                  onClick={() => { if (aspectRatio !== item.id) settings.mutate({ aspectRatio: item.id }); }}
                >
                  <Icon size={26} strokeWidth={1.6} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-block settings-style-block">
          <header>
            <strong>风格参考</strong>
            <span>统一全局画面视觉</span>
          </header>
          <DramaStylePicker
            value={styleKey}
            disabled={settings.isPending || !series?.id}
            onChange={(next) => { if (next !== styleKey) settings.mutate({ styleKey: next }); }}
          />
          <p className="drama-script__hint">当前仅开放二次元漫画风。改风格或比例后，已编译分镜会标为已过期。</p>
        </section>
        {settings.isError && <p className="drama-form-error">{settings.error.message}</p>}
      </aside>
    </div>
  );
}
