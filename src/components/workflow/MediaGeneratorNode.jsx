import { Handle, Position } from "@xyflow/react";
import {
  ChevronDown,
  Film,
  Image,
  ImagePlus,
  Play,
  Plus,
  Settings2,
  Sparkles,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { DemoSelect } from "../DemoSelect.jsx";
import { normalizeWorkflowMedia, resolveWorkflowModel } from "../../lib/modelCapabilities.js";
import { mediaNodeCreditCost } from "../../lib/nodeCredits.js";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";
import { NodeCollapseButton, NodeLockButton, nodeCollapsedClass } from "./NodeCardParts.jsx";

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

export default function MediaGeneratorNode({ id, data, selected }) {
  const {
    updateMedia,
    generateMedia,
    notify,
    getReferences,
    removeReference,
    openReferencePicker,
    models,
  } = useWorkflowNode();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const media = data.media || {};
  const isVideo = data.kind === "VideoGenerator" || media.type === "video";
  const references = isVideo && getReferences ? getReferences(id) : [];
  const update = (patch) => updateMedia?.(id, patch);

  const modelNames = (media.models || [])
    .map((model) => (typeof model === "string" ? model : model?.name))
    .filter(Boolean);

  // 生成设置按所选模型能力收敛（与快速创作共用 modelCapabilities 的判定）
  const selectedModelName = media.model || modelNames[0] || "";
  const modelInfo = resolveWorkflowModel(models, media.models, selectedModelName);
  const { options, values, patch } = normalizeWorkflowMedia(media, modelInfo, isVideo);
  const patchKey = JSON.stringify(patch);
  useEffect(() => {
    // 切换模型后原取值可能不再被支持（如 2K → 仅 720P），回写为合法值
    if (patchKey !== "{}") update(JSON.parse(patchKey));
  }, [patchKey]);
  const effectiveMedia = { ...media, ...values };

  // 左下角积分：按所选模型的售价 × 分辨率/清晰度/时长 × 副本数实时估算；跑完显示实际扣费
  const estimateCost = mediaNodeCreditCost({ media: effectiveMedia, models, isVideo });
  const actualCost = data.runtime?.creditCost;
  const creditCost = actualCost != null ? actualCost : estimateCost;

  const duration = values.duration ?? 5;
  const summary = isVideo
    ? `${values.mode} · ${values.ratio} · ${values.resolution} · ${duration}s${media.audio !== false ? " · 音效" : ""}`
    : `${values.ratio} · ${values.resolution} · ${media.quality || "高"}`;

  const runtimeOutput =
    data.runtime?.outputs?.[media.selectedOutputIndex || 0] ||
    data.runtime?.outputs?.[0];
  const previewSrc =
    data.preview || runtimeOutput?.posterUrl || runtimeOutput?.url;
  const isBusy = generating || data.runtime?.status === "RUNNING";

  const runGeneration = () => {
    if (isBusy) return;
    setGenerating(true);
    window.setTimeout(() => {
      generateMedia?.(
        id,
        isVideo
          ? "/media/comfy-racer-poster.webp"
          : "/media/quick-create/image-product.jpg"
      );
      setGenerating(false);
    }, 760);
  };

  return (
    <div
      className={`comfy-node media-node comfy-node--${data.tone || (isVideo ? "green" : "amber")} ${selected ? "comfy-node--selected" : ""} ${nodeCollapsedClass(data)}`}
    >
      <UnifiedHandles
        hasInput={isVideo}
        hasOutput
      />
      <header>
        <NodeCollapseButton id={id} collapsed={data.collapsed} />
        <strong>{data.title}</strong>
        {isVideo ? <Film size={14} /> : <Image size={14} />}
        <NodeLockButton id={id} locked={data.locked} />
      </header>
      <div className={`media-node__preview ${previewSrc ? "has-preview" : ""}`}>
        {previewSrc ? (
          <img
            src={previewSrc}
            alt={isVideo ? "视频生成预览" : "图像生成预览"}
          />
        ) : isVideo ? (
          <Film size={30} />
        ) : (
          <ImagePlus size={30} />
        )}
        {isVideo && previewSrc && (
          <span className="media-node__play">
            <Play size={15} fill="currentColor" />
          </span>
        )}
        {!previewSrc && (
          <small>{isVideo ? "等待生成视频" : "等待生成图像"}</small>
        )}
      </div>
      {isVideo && (
        <div className="media-node__modes">
          {options.modes.map((mode) => (
            <button
              className={values.mode === mode ? "active" : ""}
              key={mode}
              onClick={() => update({ mode })}
            >
              {mode}
            </button>
          ))}
        </div>
      )}
      <div
        className={`media-node__composer nodrag nowheel ${isVideo ? "media-node__composer--video" : ""}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {isVideo && (
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
                title={reference.title}
              >
                <img src={reference.preview} alt={reference.title} />
                {reference.type === "VIDEO" && (
                  <span>
                    <Film size={9} />
                  </span>
                )}
                <button
                  aria-label={`移除引用：${reference.title}`}
                  onClick={() => removeReference?.(id, reference.sourceId)}
                >
                  <X size={10} />
                </button>
                <small>{reference.title}</small>
              </div>
            ))}
          </div>
        )}
        {!isVideo && (
          <button
            className="media-node__reference"
            aria-label="添加参考素材"
            onClick={() =>
              notify?.("可将画布中的图像节点连接到此节点作为参考素材")
            }
          >
            <Plus size={16} />
          </button>
        )}
        <textarea
          value={media.prompt || ""}
          onChange={(event) => update({ prompt: event.target.value })}
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
          className="media-node__cost"
          title={actualCost != null
            ? `实际扣费 ${actualCost} 积分`
            : "按所选模型的售价、分辨率、时长与副本数估算"}
        >
          <Zap size={11} /> {creditCost}
        </span>
        <button className="media-node__generate" onClick={runGeneration}>
          {isBusy ? (
            <>
              <Sparkles size={13} className="spin" />
              生成中
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
          {isVideo && (
            <section>
              <span>生成模式</span>
              <div>
                {options.modes.map((mode) => (
                  <button
                    className={values.mode === mode ? "active" : ""}
                    key={mode}
                    onClick={() => update({ mode })}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </section>
          )}
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
    </div>
  );
}
