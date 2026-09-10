import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Lock, RefreshCw, Wand2 } from "lucide-react";
import { generateDramaScript, importDramaScript, lockDramaScript } from "../../api/drama.js";

const ENGINE_LABELS = {
  pending: "未解析",
  rules: "规则分场",
  llm: "文本模型",
};

function sceneTitle(scene, index) {
  return scene.heading || `第${scene.index ?? index + 1}场`;
}

/**
 * 剧本步骤：导入原文 → 分场渲染 → 锁定。
 * 分场结果由后端 DramaTextService 产出，这里只渲染与触发，不组装字段。
 */
export function DramaScriptPanel({ episode }) {
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState("");

  useEffect(() => {
    if (episode) setRaw(episode.sourceText || "");
  }, [episode?.id, episode?.sourceText]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["drama-series"] });
    queryClient.invalidateQueries({ queryKey: ["drama-series", episode?.seriesId] });
  }

  const run = useMutation({
    mutationFn: (mode) => {
      if (!episode) throw new Error("请先创建剧集");
      if (mode === "import") return importDramaScript(episode.id, raw);
      if (mode === "generate") return generateDramaScript(episode.id, raw);
      return lockDramaScript(episode.id);
    },
    onSuccess: refresh,
  });

  const scenes = episode?.script?.scenes || [];
  const locked = episode?.status === "已锁定";

  return (
    <section className="drama-script">
      <header className="drama-script__head">
        <h2><BookOpen size={16} /> 分场剧本</h2>
        <div className="drama-script__meta">
          <span className={`drama-engine drama-engine--${episode?.engine || "pending"}`}>
            {ENGINE_LABELS[episode?.engine] || "未知"}
          </span>
          <span className="drama-status-chip">{episode?.status || "未开始"}</span>
        </div>
      </header>

      <label className="drama-script__raw">
        <span>剧本原文 / 一句话梗概</span>
        <textarea
          value={raw}
          rows={10}
          placeholder={"第一场 幻梦侦探社 日 内\n人物：洛白、夏安、局长\n道具：古铜怀表\n洛白：开始了。"}
          onChange={(e) => setRaw(e.target.value)}
        />
      </label>

      <div className="drama-script__actions">
        <button className="button button--primary" type="button" disabled={!raw.trim() || run.isPending || locked}
          onClick={() => run.mutate("import")}>
          <RefreshCw size={14} /> {run.isPending && run.variables === "import" ? "解析中…" : "导入并分场"}
        </button>
        <button className="button button--ghost" type="button" disabled={!raw.trim() || run.isPending || !episode?.canGenerate || locked}
          title={episode?.canGenerate ? "" : "项目需绑定已启用的文本模型"}
          onClick={() => run.mutate("generate")}>
          <Wand2 size={14} /> 用文本模型生成
        </button>
        <button className="button button--ghost" type="button" disabled={scenes.length === 0 || run.isPending || locked}
          onClick={() => run.mutate("lock")}>
          <Lock size={14} /> 锁定分场剧本
        </button>
      </div>

      {episode?.canGenerate === false && episode?.textServiceAvailable && !locked && (
        <p className="drama-script__hint">该项目未绑定可用文本模型，只会走规则分场；绑定后可用模型生成。</p>
      )}
      {run.isError && <p className="drama-form-error">{run.error.message}</p>}
      {locked && <p className="drama-script__hint">已锁定。再改原文会回到待确认，下游资产与分镜标为已过期。</p>}

      {scenes.length > 0 ? (
        <ol className="drama-scenes">
          {scenes.map((scene, index) => (
            <li className="drama-scene" key={scene.index ?? index}>
              <header>
                <strong>{scene.index ?? index + 1}. {sceneTitle(scene, index)}</strong>
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
                    <li key={`${scene.index}-d-${i}`}>
                      <b>{line.speaker}</b><span>{line.line}</span>
                    </li>
                  ))}
                </ul>
              )}
              {scene.sound && <p className="drama-scene__sound">声音：{scene.sound}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="drama-script__empty">还没有分场结果。粘贴原文后点「导入并分场」。</p>
      )}
    </section>
  );
}
