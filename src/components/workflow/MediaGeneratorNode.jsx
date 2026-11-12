import { Handle, Position } from "@xyflow/react";
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  Film,
  Image,
  Image as ImageIcon,
  ImagePlus,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Type,
  Volume2,
  WandSparkles,
  X,
  Zap,
  ZoomIn,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DemoSelect } from "../DemoSelect.jsx";
import { normalizeWorkflowMedia, resolveWorkflowModel, workflowModeLabel } from "../../lib/modelCapabilities.js";
import { mediaNodeCreditBreakdown, mediaNodeCreditCost } from "../../lib/nodeCredits.js";
import { highestVideoTier, videoTierOf } from "../../lib/pricing.js";
import { mediaUrl } from "../../lib/media.js";
import StableTextarea from "./StableTextarea.jsx";
import { VideoLightbox } from "../Drama/VideoLightbox.jsx";
import { previewFromData } from "./runtime.js";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";
import { NodeCollapseButton, NodeDeleteButton, MediaFallback, NodeLockButton, OutputGrid, GenerationSkeleton, NodeTagBadges, nodeCollapsedClass } from "./NodeCardParts.jsx";
import { nodeRuntimeState } from "./nodeViewModel.js";

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

function NodeStateBar({ tone, icon: Icon, title, message, onRetry }) {
  return (
    <div className={`media-node__state is-${tone}`} role={tone === "failed" ? "alert" : "status"}>
      <span className="media-node__state-icon"><Icon size={12} /></span>
      <div className="media-node__state-content">
        <strong>{title}</strong>
        <small title={message}>{message}</small>
      </div>
      {onRetry && (
        <button
          className="media-node__state-retry nodrag"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onRetry}
        >
          <RotateCcw size={10} />
          重试
        </button>
      )}
    </div>
  );
}

// 参考帧模式的首/尾帧显式图框（B2）：两个框直接就是「+」框——
// 空时点「+」打开素材弹框选图（与参考素材入口一致），已设置则显示图片并可清除
function FrameSlot({ label, slot, storageKey, title, onRequest, onClear }) {
  return (
    <div className="media-node__frame-slot nodrag nowheel" title={storageKey ? `${label}：${title || ""}` : `${label}（点击从素材库选择图片）`}>
      {storageKey ? (
        <>
          <img src={mediaUrl(storageKey, { w: 160 })} alt={`${label} ${title || ""}`} />
          <button
            aria-label={`清除${label}`}
            className="media-node__frame-clear"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClear}
          >
            <X size={11} />
          </button>
          <em>{label}</em>
        </>
      ) : (
        // 空框即「+」：竖排「+ / 角色名」，不再叠底部标签，避免文字重叠
        <button
          className="media-node__frame-upload"
          aria-label={`选择${label}图片`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onRequest(slot)}
        >
          <Plus size={15} />
          <small>{label}</small>
        </button>
      )}
    </div>
  );
}

export default function MediaGeneratorNode({ id, data, selected }) {
  const {
    updateMedia,
    generateMedia,
    notify,
    getReferences,
    getPromptSupplements,
    removeReference,
    openReferencePicker,
    selectOutput,
    models,
    running,
    runMode,
  } = useWorkflowNode();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [, setPlaying] = useState(false);
  const [videoZoom, setVideoZoom] = useState(null);
  const videoRef = useRef(null);
  // 主预览加载失败兜底（需求 4.2.1.5）：媒体地址过期/网络失败时给出重新加载入口，而不是空白框
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const reloadPreview = () => { setPreviewFailed(false); setPreviewAttempt((value) => value + 1); };

  const media = data.media || {};
  const isVideo = data.kind === "VideoGenerator" || media.type === "video";
  // 参考素材：视频节点的「参考生成/首尾帧」与图像节点的「图生图」都靠连线聚合，口径一致；
  // 图像节点只接受图片参考（与快速创作一致，后端 acceptRef 也只收 image）
  const references = (getReferences ? getReferences(id) : [])
    .filter((reference) => isVideo || reference.type === "IMAGE");
  // 提示词补充：文本/表格节点连到本节点时，后端会把它拼在提示词后面（planner textSupplements）
  const supplements = getPromptSupplements ? getPromptSupplements(id) : [];
  const update = (patch, opts) => updateMedia?.(id, patch, opts);

  const modelNames = (media.models || [])
    .map((model) => (typeof model === "string" ? model : model?.name))
    .filter(Boolean);

  // 生成设置按所选模型能力收敛（与快速创作共用 modelCapabilities 的判定）
  const selectedModelName = media.model || modelNames[0] || "";
  const modelInfo = resolveWorkflowModel(models, media.models, selectedModelName);
  const { options, values, patch } = normalizeWorkflowMedia(media, modelInfo, isVideo);
  const patchKey = JSON.stringify(patch);
  useEffect(() => {
    // 切换模型后原取值可能不再被支持（如 2K → 仅 720P），回写为合法值；
    // 这是打开画布时的自动收敛而非用户编辑，走 silent 不把画布标成“有未保存更改”
    if (patchKey !== "{}") update(JSON.parse(patchKey), { silent: true });
  }, [patchKey]);

  // 生成设置弹框：点外部或按 Esc 收起（与音频节点、快速创作的参数弹框同一口径）。
  // 触发器 .media-node__summary 一并放过，否则 mousedown 先关、onClick 又开，等于点不动。
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onPointerDownOutside = (event) => {
      if (event.target?.closest?.(".media-node__settings, .media-node__summary")) return;
      setSettingsOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDownOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDownOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);
  const effectiveMedia = { ...media, ...values };

  // 参考视频模式：上游视频整段透传给模型（保留动作/运镜），不抽尾帧；后端按 videoRefMode 分流
  // （须先于 referenceVideoSeconds 声明——那里直接用到它）
  const isVideoRefMode = isVideo && values.mode === "参考视频";
  // 左下角积分：按所选模型的售价 × 分辨率/清晰度/时长 × 副本数实时估算；跑完显示实际扣费
  // 「参考视频」模式另计参考视频秒数（按参考视频自己的分辨率档价，与后端 CreditCalculator 同口径）
  const videoReferences = isVideoRefMode
    ? references.filter((reference) => reference.type === "VIDEO")
    : [];
  const referenceVideoSeconds = videoReferences
    .reduce((sum, reference) => sum + (Number(reference.durationSec) || 0), 0);
  // 多段参考视频取最贵的一档；有一段认不出档位就整体留空，由后端按最高档兜底（前端同样退回最高档）
  const referenceVideoResolution = videoReferences.reduce(
    (best, reference) => highestVideoTier(best, videoTierOf(reference)),
    null,
  );
  const estimateCost = mediaNodeCreditCost({ media: effectiveMedia, models, isVideo, referenceVideoSeconds, referenceVideoResolution });
  const actualCost = data.runtime?.creditCost;
  // 复用了历史产物的步骤本次没扣积分（creditCost=0），照搬成「0 积分」会被误读成「这个视频免费」——
  // 这种情况下显示这个节点生成一次的价格，并打「复用」标；真跑过才显示实际扣费。
  const reused = Boolean(data.runtime?.reused);
  const creditCost = actualCost != null && !(actualCost === 0 && reused) ? actualCost : estimateCost;
  // 有参考视频时把两部分拆开显示：参考视频是额外计费的一项，别混在总价里看不出来
  const referenceBreakdown = referenceVideoSeconds > 0
    ? mediaNodeCreditBreakdown({ media: effectiveMedia, models, isVideo, referenceVideoSeconds, referenceVideoResolution })
    : null;
  const referencePart = referenceBreakdown ? referenceBreakdown.reference : 0;
  const outputPart = referenceBreakdown ? referenceBreakdown.output : estimateCost;
  const referenceLabel = referenceVideoResolution ? `${referenceVideoResolution} 档` : "最高档";
  const costTitle = reused
    ? `复用已有结果，本次未扣积分（生成一次约 ${estimateCost} 积分）`
    : actualCost != null
      ? referenceBreakdown
        ? `实际扣费 ${actualCost} 积分（输出 ${outputPart} + 参考视频 ${referencePart}）`
        : `实际扣费 ${actualCost} 积分`
      : referenceBreakdown
        ? `估算 ${estimateCost} 积分（输出 ${outputPart} + 参考视频 ${referencePart}，按${referenceLabel}价计）`
        : "按所选模型的售价、分辨率、时长与副本数估算";

  const duration = values.duration ?? 5;
  const summary = isVideo
    ? `${values.ratio} · ${values.resolution} · ${duration}s${media.audio !== false ? " · 音效" : ""}`
    : `${values.ratio} · ${values.resolution} · ${media.quality || "中"}`;

  // 参考帧模式（i2v）：显式首帧/尾帧图框（B2），数据存 media.frames = { firstKey, lastKey }。
  // 后端 planner 直读 frames 组 FrameInput，不再从连线引用里按顺序推断。
  const isFramesMode = isVideo && values.mode === "参考帧";
  const frameFlags = new Map();
  if (isFramesMode) {
    if (media.frames?.firstKey) frameFlags.set("frame-first", "首帧");
    if (media.frames?.lastKey) frameFlags.set("frame-last", "尾帧");
    // 兼容旧图：无显式图框时沿用连线推断（上游视频尾帧/第 1 张图作首帧，第 2 张作尾帧）
    if (!media.frames?.firstKey && !media.frames?.lastKey) {
      const frameRank = (reference) => (reference.chainFrame ? 0 : reference.staticRef ? 1 : 2);
      [...references]
        .filter((reference) => reference.chainFrame || reference.type === "IMAGE")
        .sort((a, b) => frameRank(a) - frameRank(b))
        .slice(0, 2)
        .forEach((reference, index) => {
          frameFlags.set(reference.edgeId, index === 0 ? (reference.chainFrame ? "尾帧→首帧" : "首帧") : "尾帧");
        });
    }
  } else if (isVideoRefMode) {
    // 参考视频模式：上游视频整段作参考（不抽尾帧），上游图片仍作图片参考
    references
      .filter((reference) => reference.type === "VIDEO")
      .forEach((reference) => frameFlags.set(reference.edgeId, "整段参考"));
  } else if (isVideo) {
    // 兜底档（历史数据）：上游视频取其尾帧作衔接参考图
    references
      .filter((reference) => reference.chainFrame)
      .forEach((reference) => frameFlags.set(reference.edgeId, "尾帧参考"));
  }
  const frameSourceCount = frameFlags.size;

  const previewSrc = previewFromData(data);
  // 视频产物：取 runtime.outputs 的选中项（displayOutputs 已把 url/posterUrl 重建为带 token 的 /api/media 地址）
  const outputs = data.runtime?.outputs || [];
  const activeOutput = outputs[media.selectedOutputIndex ?? data.runtime?.selectedOutputIndex ?? 0] || outputs[0];
  const videoSrc = isVideo ? activeOutput?.url || "" : "";
  const videoPoster = activeOutput?.posterUrl || data.preview || "";
  // 产物地址变了（新一轮生成/换了主结果）就清掉失败态，否则会一直卡在兜底界面
  // 注意：依赖的 previewSrc / videoSrc 必须先声明，否则渲染期求值会踩 TDZ 报
  // "Cannot access 'previewSrc' before initialization"
  useEffect(() => { setPreviewFailed(false); }, [previewSrc, videoSrc]);
  const runtimeStatus = data.runtime?.status;
  // 状态条文案统一走 nodeRuntimeState：用户主动停止（CANCELLED）不是「生成失败」
  const runtimeState = nodeRuntimeState(data.runtime);
  const queuedReason = runtimeStatus === "QUEUED"
    ? data.runtime?.error || "上游队列繁忙，任务排队等待执行"
    : "";
  const isBusy = runtimeStatus
    ? ["PENDING", "QUEUED", "SUBMITTING", "RUNNING"].includes(runtimeStatus)
    : generating;
  // 顶栏选「全部重新生成」时，单节点生成也会带 forceRegenerate（本节点 + 上游都不复用），
  // 按钮文案与图标同步，避免用户以为这次仍是复用口径。
  const forceRun = runMode === "regenerate";

  // 生成：真实跑该节点（后端按节点自己的提示词与模型执行），不再贴静态占位图
  const runGeneration = () => {
    if (isBusy) return;
    // 需求 1.4 异常流 3a：未填写提示词时提示补充，不提交（上游文本节点的补充也不算——本节点至少要有自己的提示词）
    if (!String(media.prompt || "").trim()) {
      notify?.("请补充提示词后再生成");
      return;
    }
    if (isFramesMode && !media.frames?.firstKey && frameSourceCount < 1) {
      notify?.("参考帧模式请设置首帧图（图框选图或连接图片/上游视频取其尾帧），尾帧可选");
      return;
    }
    setGenerating(true);
    setSettingsOpen(false);
    generateMedia?.(id);
  };

  // 运行状态由 studio 的 running 驱动；运行结束（或失败）后解除本地忙碌态
  useEffect(() => {
    if (!running) setGenerating(false);
  }, [running]);

  return (
    <div
      className={`comfy-node media-node comfy-node--${data.tone || (isVideo ? "green" : "amber")} ${selected ? "comfy-node--selected" : ""} ${nodeCollapsedClass(data)}`}
    >
      <UnifiedHandles
        hasInput
        hasOutput
      />
      <header>
        <NodeCollapseButton id={id} collapsed={data.collapsed} />
        <strong>{data.title}</strong>
        {isVideo ? <Film size={14} /> : <Image size={14} />}
        <NodeLockButton id={id} locked={data.locked} />
        <NodeDeleteButton id={id} title={data.title} locked={data.locked} />
      </header>
      <NodeTagBadges tags={data.tags} />
      <div className={`media-node__preview ${previewSrc || videoSrc ? "has-preview" : ""}`}>
        {isBusy && !activeOutput ? (
          // 生成中：进度骨架（需求 4.2.1.3 前端原位展示进度）
          <GenerationSkeleton progress={Number(data.runtime?.progress) || 0} />
        ) : previewFailed ? (
          <MediaFallback label="媒体加载失败" onRetry={reloadPreview} />
        ) : videoSrc ? (
          <>
            <video
              key={`video-${previewAttempt}`}
              ref={videoRef}
              className="nodrag nowheel"
              controls
              playsInline
              preload="metadata"
              src={videoSrc}
              poster={videoPoster || undefined}
              onError={() => setPreviewFailed(true)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
            <button
              type="button"
              className="media-node__zoom nodrag"
              aria-label="放大播放视频"
              title="放大播放"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setVideoZoom({ src: videoSrc, poster: videoPoster || undefined });
              }}
            >
              <ZoomIn size={13} />
            </button>
          </>
        ) : previewSrc ? (
          <img
            key={`img-${previewAttempt}`}
            src={previewSrc}
            alt={isVideo ? "视频生成预览" : "图像生成预览"}
            onError={() => setPreviewFailed(true)}
          />
        ) : isVideo ? (
          <Film size={30} />
        ) : (
          <ImagePlus size={30} />
        )}
        {!previewSrc && !videoSrc && !isBusy && (
          <small>{isVideo ? "等待生成视频" : "等待生成图像"}</small>
        )}
      </div>
      {/* 多结果网格：副本数 >1 时列出全部产物，可选主结果、可下载（需求 4.2.3.5） */}
      {outputs.length > 1 && (
        <div className="media-node__output-grid nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
          <OutputGrid
            outputs={outputs}
            kind={isVideo ? "video" : "image"}
            selectedOutput={activeOutput}
            onSelect={(index) => selectOutput?.(id, index)}
          />
        </div>
      )}
      {runtimeStatus === "QUEUED" && (
        <NodeStateBar
          tone="queued"
          icon={Clock3}
          title="排队中"
          message={queuedReason}
        />
      )}
      {runtimeState && (
        <NodeStateBar
          tone={runtimeState.tone}
          icon={runtimeState.tone === "cancelled" ? X : AlertTriangle}
          title={runtimeState.title}
          message={runtimeState.message}
          onRetry={runGeneration}
        />
      )}
      {isVideo && (
        <div className="media-node__modes">
          {options.modes.map((mode) => (
            <button
              className={values.mode === mode ? "active" : ""}
              key={mode}
              onClick={() => update({ mode })}
            >
              {workflowModeLabel(mode)}
            </button>
          ))}
        </div>
      )}
      <div
        className={`media-node__composer nodrag nowheel ${isVideo ? "media-node__composer--video" : ""}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {isFramesMode ? (
          // 参考帧（B2）：首尾两个「+」框直接摆在那——空即打开素材弹框选图，已设即显图可清除
          <div className="media-node__frames" aria-label="首尾帧设置">
            <FrameSlot
              label="首帧"
              slot="first"
              storageKey={media.frames?.firstKey || ""}
              title={media.frames?.firstTitle || ""}
              onRequest={(slot) => openReferencePicker?.(id, { slot })}
              onClear={() => update({ frames: { ...media.frames, firstKey: "", firstTitle: "" } })}
            />
            <FrameSlot
              label="尾帧"
              slot="last"
              storageKey={media.frames?.lastKey || ""}
              title={media.frames?.lastTitle || ""}
              onRequest={(slot) => openReferencePicker?.(id, { slot })}
              onClear={() => update({ frames: { ...media.frames, lastKey: "", lastTitle: "" } })}
            />
          </div>
        ) : (
          <div className="media-node__references" aria-label="已引用素材">
            <button
              className="media-node__reference"
              aria-label="添加参考素材"
              onClick={() => openReferencePicker?.(id)}
            >
              <Plus size={16} />
            </button>
            {references.map((reference) => (
              <div
                className="media-node__reference-chip"
                key={reference.edgeId}
                title={frameFlags.has(reference.edgeId)
                  ? `${reference.title}（${frameFlags.get(reference.edgeId)}）`
                  : reference.title}
              >
                {reference.preview ? (
                  <img src={reference.preview} alt={reference.title} />
                ) : reference.type === "VIDEO" && reference.src ? (
                  // 视频参考常没有海报图（连线或素材库直接附加都算），用 <video> 取首帧当缩略图
                  <video src={`${reference.src}#t=0.1`} muted playsInline preload="metadata" aria-label={reference.title} />
                ) : reference.type === "AUDIO" ? (
                  // 音频参考没有画面（需求 1.5 AC-009）：用波形图标占位，不再显示误导性的「待生成」
                  <span className="media-node__reference-placeholder is-audio" aria-label={`音频参考：${reference.title}`}>
                    <Volume2 size={13} />
                    <small>音频</small>
                  </span>
                ) : (
                  <span className="media-node__reference-placeholder">
                    <ImageIcon size={13} />
                    <small>待生成</small>
                  </span>
                )}
                {reference.type === "VIDEO" && (
                  <span>
                    <Film size={9} />
                  </span>
                )}
                {reference.type === "AUDIO" && (
                  <span>
                    <Volume2 size={9} />
                  </span>
                )}
                <button
                  aria-label={`移除引用：${reference.title}`}
                  onClick={() => removeReference?.(id, reference.sourceId)}
                >
                  <X size={10} />
                </button>
                <small>
                  {frameFlags.has(reference.edgeId) && <em>{frameFlags.get(reference.edgeId)}</em>}
                  {reference.title}
                </small>
              </div>
            ))}
          </div>
        )}
        {supplements.length > 0 && (
          <div className="media-node__supplements" aria-label="提示词补充">
            {supplements.map((item) => (
              <span className="media-node__supplement" key={item.edgeId} title={item.text || item.title}>
                <Type size={10} />
                <em>{item.title}</em>
                <button
                  aria-label={`移除提示词补充：${item.title}`}
                  onClick={() => removeReference?.(id, item.sourceId)}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        )}
        <StableTextarea
          value={media.prompt || ""}
          onChange={(value) => update({ prompt: value })}
          placeholder={
            isVideo ? "描述希望生成的视频内容" : "描述希望生成的图像"
          }
          rows={4}
        />
        <small>
          {(media.prompt || "").length} / {isVideo ? 7000 : 7500}
        </small>
      </div>
      <div
        className="media-node__controls nodrag nowheel"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <DemoSelect
          className="nodrag nowheel workflow-node-select"
          ariaLabel={`${data.title}模型`}
          value={media.model || modelNames[0] || ""}
          onChange={(val) => update({ model: val })}
          options={modelNames.map((model) => ({ value: model, label: model }))}
        />
        <button
          className={`media-node__summary${settingsOpen ? " is-open" : ""}`}
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <Settings2 size={12} />
          <span>{summary}</span>
          <ChevronDown size={12} className="select-chevron" />
        </button>
        <DemoSelect
          className="nodrag nowheel workflow-node-select media-node__copies"
          ariaLabel="生成副本数量"
          value={values.copies}
          onChange={(val) => update({ copies: Number(val) })}
          options={options.copies.map((copy) => ({ value: copy, label: `${copy} 份` }))}
        />
        <span
          className={`media-node__cost${reused ? " is-reused" : ""}`}
          title={costTitle}
        >
          <Zap size={11} /> {creditCost}
          {reused && <em className="media-node__cost-tag">复用</em>}
        </span>
        <button
          className={`media-node__generate${forceRun ? " is-force" : ""}`}
          onClick={runGeneration}
          title={forceRun
            ? "全部重新生成：本节点及其上游都不复用历史产物，会重新扣积分"
            : "复用已有结果：参数与上游未变的节点直接用上次产物"}
        >
          {isBusy ? (
            <>
              <Sparkles size={13} className="spin" />
              {runtimeStatus === "QUEUED" ? "排队中" : "生成中"}
            </>
          ) : forceRun ? (
            <>
              <RotateCcw size={13} />
              重新生成
            </>
          ) : (
            <>
              <WandSparkles size={13} />
              生成
            </>
          )}
        </button>
      </div>
      {settingsOpen && (
        <div
          className="media-node__settings nodrag nowheel"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header>
            <strong>生成设置</strong>
            <button
              aria-label="关闭生成设置"
              onClick={() => setSettingsOpen(false)}
            >
              <X size={14} />
            </button>
          </header>
          <section>
            <span>画面比例</span>
            <div>
              {options.ratios.map((ratio) => (
                <button
                  className={values.ratio === ratio ? "active" : ""}
                  key={ratio}
                  onClick={() => update({ ratio })}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>{isVideo ? "分辨率" : "清晰度"}</span>
            <div>
              {options.resolutions.map((resolution) => (
                <button
                  className={values.resolution === resolution ? "active" : ""}
                  key={resolution}
                  onClick={() => update({ resolution })}
                >
                  {resolution}
                </button>
              ))}
            </div>
          </section>
          {isVideo ? (
            <>
              <section>
                <span>时长</span>
                <div className="media-node__duration">
                  {options.durations.map((itemDuration) => (
                    <button
                      className={duration === itemDuration ? "active" : ""}
                      key={itemDuration}
                      onClick={() =>
                        update({
                          duration: itemDuration,
                          durationSec: itemDuration,
                        })
                      }
                    >
                      {itemDuration}s
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <span>生成音效</span>
                <div>
                  <button
                    className={media.audio !== false ? "active" : ""}
                    onClick={() => update({ audio: true })}
                  >
                    开启
                  </button>
                  <button
                    className={media.audio === false ? "active" : ""}
                    onClick={() => update({ audio: false })}
                  >
                    静音
                  </button>
                </div>
              </section>
            </>
          ) : (
            <section>
              <span>图像质量</span>
              <div>
                {["低", "中", "高"].map((quality) => (
                  <button
                    className={media.quality === quality ? "active" : ""}
                    key={quality}
                    onClick={() => update({ quality })}
                  >
                    {quality}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <footer>
        <span>光驭画布节点</span>
        <small>{isVideo ? "视频" : "图像"}</small>
      </footer>
      {videoZoom && (
        <VideoLightbox
          preview={{ ...videoZoom, title: data.title || "视频预览" }}
          onClose={() => setVideoZoom(null)}
        />
      )}
    </div>
  );
}
