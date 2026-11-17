import { Handle, Position } from "@xyflow/react";
import {
  Check,
  Clapperboard,
  Clock3,
  Film,
  Loader,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { mediaUrl } from "../../lib/media.js";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";
import { MediaFallback, NodeCollapseButton, NodeDeleteButton, NodeLockButton, NodeTagBadges, nodeCollapsedClass } from "./NodeCardParts.jsx";
import { enabledClips } from "./nodeInteractions.js";

// 片段有效时长（trimEnd 缺失时无法得知，返回 null）
function trimLength(clip) {
  const start = Number(clip?.trimStart) || 0;
  const end = Number(clip?.trimEnd);
  return Number.isFinite(end) && end > start ? end - start : null;
}

function formatSeconds(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const totalDuration = (clips) => clips.reduce((sum, clip) => sum + (trimLength(clip) || 0), 0);

// 上游视频源尚未进入剪辑素材的原因（需求 4.2.5.6：可理解错误提示）
function sourceReason(source) {
  if (source.enabled === false) return "节点已停用";
  if (source.status === "FAILED") return "生成失败，请重跑该节点";
  if (source.status === "RUNNING") return "生成中…";
  if (source.status === "SUCCEEDED") return "无可合成的视频输出";
  return "等待生成";
}

const PREVIEW_HINT = "按当前剪辑台草稿在服务端出一版成片；完整剪辑请打开剪辑台后导出";

export default function VideoEditingNode({ id, data, selected }) {
  const { getClips, getEditingSources, execute, refreshRuntime, openEditingSuite } = useWorkflowNode();
  // 成片播放失败（产物地址过期 / 文件被清）：给兜底 + 重新加载，需求 4.2.1.5、4.2.5.9
  const [filmFailed, setFilmFailed] = useState(false);
  const [filmAttempt, setFilmAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // 上游视频经 buildClipQueue 收成剪辑台素材。卡片只展示数量，排序和裁剪在剪辑台里改。
  const clips = getClips?.(id) || [];
  const playable = enabledClips(clips);

  // 成片（需求 4.2.5.5）：运行工作流后由后端 FfmpegWorkflowFilmComposer 合成，随 step 输出返回
  const runStatus = data.runtime?.status || "";
  const film = (data.runtime?.outputs || []).find((output) => output?.url || output?.storageKey);
  const filmSrc = film ? (film.storageKey ? mediaUrl(film.storageKey) : film.url) : "";

  // 换了成片地址（重新出片 / 刷新产物）就复位失败态，否则兜底会一直挂在新的可用产物上
  useEffect(() => { setFilmFailed(false); }, [filmSrc]);

  // 刷新产物（需求 4.2.5.9）：上游失败 / 产物缺失 / 地址过期时重拉运行时快照，换最新地址
  const refreshProduct = async () => {
    if (refreshing || !refreshRuntime) return;
    setRefreshing(true);
    try {
      await refreshRuntime();
    } finally {
      setRefreshing(false);
    }
  };

  // 上游视频源（需求 4.2.5.6）：区分未连线 / 等待生成 / 上游失败
  const sources = getEditingSources?.(id) || [];
  const missingSources = sources.filter((source) => !clips.some((clip) => clip.sourceNodeId === source.id));

  // 快捷预览成片：走单节点运行（后端只执行该 EDIT 步骤，上游视频按指纹复用历史产物，不重生成）。
  // 有启用中的片段即可出片；合成中（runStatus=RUNNING/EDITING）禁用防重复提交
  const composing = runStatus === "RUNNING" || runStatus === "EDITING";
  const previewFilm = () => {
    if (composing || !playable.length) return;
    execute?.(id);
  };

  const statusText = runStatus === "RUNNING" || runStatus === "EDITING"
    ? "成片合成中…"
    : runStatus === "FAILED"
      ? "成片生成失败，请重试"
      : (film ? "剪辑成功" : "")
        || (clips.length ? `已收录 ${playable.length}/${clips.length} 个片段` : "");
  const durationLabel = film?.durationSec
    ? formatSeconds(film.durationSec)
    : totalDuration(playable) > 0
      ? formatSeconds(totalDuration(playable))
      : "--:--";
  const clipCountLabel = clips.length ? `${playable.length} 个片段` : "暂无片段";
  const emptyHint = film
    ? ""
    : clips.length
      ? "点击「快捷预览成片」按剪辑台草稿出一版成片"
      : sources.length
        ? "上游视频尚未就绪"
        : "等待上游视频连线";

  return (
    <div
      className={`comfy-node video-editing-node comfy-node--blue ${selected ? "comfy-node--selected" : ""} ${nodeCollapsedClass(data)}`}
    >
      <UnifiedHandles hasInput={!!data.inputs?.length} hasOutput={false} />
      <header>
        <NodeCollapseButton id={id} collapsed={data.collapsed} />
        <strong>视频剪辑</strong>
        <Clapperboard size={14} />
        <NodeLockButton id={id} locked={data.locked} />
        <NodeDeleteButton id={id} title="视频剪辑" locked={data.locked} />
      </header>
      <NodeTagBadges tags={data.tags} />
      <div
        className="video-editing-node__player nodrag nowheel"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {film && filmFailed ? (
          <div className="video-editing-node__fallback nodrag">
            <MediaFallback
              label="成片加载失败，产物地址可能已过期"
              onRetry={() => { setFilmFailed(false); setFilmAttempt((value) => value + 1); }}
            />
            <button type="button" className="video-editing-node__fallback-refresh" onClick={refreshProduct} disabled={refreshing}>
              {refreshing ? <Loader size={11} className="spin" /> : <RefreshCw size={11} />}
              刷新产物
            </button>
          </div>
        ) : film ? (
          <>
            <video
              key={`${filmSrc}-${filmAttempt}`}
              controls
              playsInline
              preload="metadata"
              poster={film.posterUrl ? mediaUrl(film.posterUrl) : undefined}
              onError={() => setFilmFailed(true)}
            >
              <source src={filmSrc} />
            </video>
            <span>
              {runStatus === "FAILED" ? <TriangleAlert size={11} /> : <Check size={11} />}
              {statusText}
            </span>
          </>
        ) : (
          <div className="video-editing-node__empty">
            {runStatus === "RUNNING" || runStatus === "EDITING" ? <Loader size={28} className="spin" /> : <Film size={28} />}
            {emptyHint && <small>{emptyHint}</small>}
            {!sources.length && (
              <small className="video-editing-node__empty-hint">
                将视频生成节点的输出连到本节点左侧端口
              </small>
            )}
          </div>
        )}
      </div>
      {missingSources.length > 0 && (
        <>
          <ul className="video-editing-node__sources nodrag" aria-label="上游视频状态">
            {missingSources.map((source) => (
              <li key={source.id} data-severity={source.status === "FAILED" || source.enabled === false ? "error" : "pending"}>
                {source.status === "FAILED" || source.enabled === false ? <TriangleAlert size={11} /> : <Loader size={11} className="spin" />}
                <span title={`${source.title}：${sourceReason(source)}`}>{source.title}</span>
                <em>{sourceReason(source)}</em>
              </li>
            ))}
          </ul>
          <small className="video-editing-node__sources-hint">上游失败或产物地址过期时，点下方「刷新产物」重新拉取</small>
        </>
      )}
      <div className="video-editing-node__meta">
        <span>
          <Clapperboard size={11} />
          {clipCountLabel}
        </span>
        <span>
          <Clock3 size={11} />
          {durationLabel}
        </span>
      </div>
      <div className="video-editing-node__actions">
        <button
          type="button"
          className="video-editing-node__open-suite nodrag"
          onClick={() => openEditingSuite?.(id)}
          onPointerDown={(event) => event.stopPropagation()}
          title="打开独立剪辑台：多轨时间线、剪切、拖拽、导出成片"
        >
          <Clapperboard size={12} />
          打开剪辑台
        </button>
        <button
          type="button"
          className="video-editing-node__compose nodrag"
          onClick={previewFilm}
          disabled={composing || !playable.length}
          title={playable.length ? PREVIEW_HINT : "暂无可用片段，请先生成上游视频"}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {composing ? (
            <>
              <Loader size={12} className="spin" />
              合成中…
            </>
          ) : (
            <>
              <Film size={12} />
              快捷预览成片
            </>
          )}
        </button>
        <button
          type="button"
          className="video-editing-node__refresh nodrag"
          onClick={refreshProduct}
          disabled={refreshing || composing}
          title="重新拉取运行结果：上游失败后重跑过、或产物地址过期时用它换成最新地址"
        >
          {refreshing ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />}
          刷新产物
        </button>
      </div>
      <footer>
        <span>工作流末端节点</span>
        <small>{clips.length ? `${playable.length} 个片段` : "成片"}</small>
      </footer>
    </div>
  );
}

function UnifiedHandles({ hasInput, hasOutput }) {
  return (
    <>
      {hasInput && (
        <Handle
          id="input"
          type="target"
          position={Position.Left}
          className="comfy-node__unified-handle comfy-node__unified-handle--input"
        />
      )}
      {hasOutput && (
        <Handle
          id="output"
          type="source"
          position={Position.Right}
          className="comfy-node__unified-handle comfy-node__unified-handle--output"
        />
      )}
    </>
  );
}
