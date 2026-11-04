import { Handle, Position } from "@xyflow/react";
import {
  ChevronDown,
  Film,
  Mic2,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Type,
  Upload,
  Volume2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DemoSelect } from "../DemoSelect.jsx";
import { audioNodeCreditCost } from "../../lib/nodeCredits.js";
import { mediaUrl } from "../../lib/media.js";
import { normalizeAudioParams, resolveAudioOptions, voiceLabel } from "../../lib/voices.js";
import StableTextarea from "./StableTextarea.jsx";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";
import AudioWaveform from "./AudioWaveform.jsx";
import QuickAudioPopover from "../QuickAudioPopover.jsx";
import { NodeCollapseButton, NodeDeleteButton, NodeLockButton, nodeCollapsedClass } from "./NodeCardParts.jsx";

// 情感档位：value 是 MiniMax 的合法枚举，空值表示不指定（与快速创作一致，避免厂商 2013 invalid params）
const AUDIO_EMOTIONS = [
  { value: "", label: "默认" },
  { value: "neutral", label: "平静" },
  { value: "happy", label: "开心" },
  { value: "sad", label: "悲伤" },
  { value: "angry", label: "愤怒" },
  { value: "fearful", label: "恐惧" },
  { value: "surprised", label: "惊讶" },
];

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

export default function AudioGeneratorNode({ id, data, selected }) {
  const { updateMedia, generateMedia, notify, models, getReferences, getPromptSupplements, removeReference, uploadAudio } = useWorkflowNode();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const uploadRef = useRef(null);
  const primaryAudioRef = useRef(null);

  const media = data.media || {};
  const update = (patch) => updateMedia?.(id, patch);
  // 画面参考：上游图片/视频连到本节点的 visual 端口，作为配乐/旁白的画面语境（对齐快速创作的素材引用）
  const visualRefs = (getReferences ? getReferences(id) : []).filter((reference) => ["IMAGE", "VIDEO"].includes(reference.type));
  // 提示词补充：上游文本节点（脚本/台词）连到本节点时作为朗读文本补充
  const supplements = getPromptSupplements ? getPromptSupplements(id) : [];
  const uploadedAudio = media.uploadedAudio || null;

  const modelNames = (media.models || [])
    .map((model) => (typeof model === "string" ? model : model?.name))
    .filter(Boolean);
  const isBusy = generating || data.runtime?.status === "RUNNING";

  // 语音参数与快速创作同源：同一份模型目录 audioOptions（音色/格式/语速范围完全一致）
  const audioOptions = useMemo(
    () => resolveAudioOptions({ models, modelName: media.model }),
    [models, media.model],
  );
  const voiceId = media.voiceId || media.voice || audioOptions.defaultVoice;
  const audioFormat = media.format || audioOptions.defaultFormat;
  const speed = Number(media.speed) || 1;

  // 按钮展示与快速创作一致：音色名 · 语速 · 格式
  const voiceSummary = `${voiceLabel(voiceId)} · ${speed.toFixed(2)}x · ${String(audioFormat).toUpperCase()}`;

  // 模型切换后音色/格式/语速可能越界，自动校正回模型支持的范围（与快速创作同一口径）
  useEffect(() => {
    const patch = normalizeAudioParams({ voiceId: media.voiceId, format: media.format, speed: media.speed, options: audioOptions });
    if (patch) update(patch);
  }, [media.voiceId, media.format, media.speed, audioOptions]);

  // 生成结果（含多副本）：播放器 + 波形可视化（需求 4.2.4.5），失败时可重试
  const audioOutputs = (data.runtime?.outputs || [])
    .filter((output) => output?.url || output?.storageKey)
    .map((output) => ({ ...output, src: output.storageKey ? mediaUrl(output.storageKey) : output.url }));
  const runFailed = data.runtime?.status === "FAILED";
  // 主产物：放在卡片最上方的内容框展示（与图片/视频节点的顶部预览区一致）
  const primaryAudio = audioOutputs[0] || null;

  // 顶部播放按钮：驱动隐藏的 audio 元素播放/暂停主产物
  const togglePlay = () => {
    const audio = primaryAudioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };

  // 生成行左侧积分：按所选语音模型的千字符口径估算
  const creditCost = audioNodeCreditCost({ media, models });

  const runGeneration = () => {
    if (isBusy) return;
    setGenerating(true);
    window.setTimeout(() => {
      generateMedia?.(id);
      setGenerating(false);
    }, 760);
  };

  return (
    <div
      className={`comfy-node audio-generator-node comfy-node--violet ${selected ? "comfy-node--selected" : ""} ${nodeCollapsedClass(data)}`}
    >
      <UnifiedHandles
        hasInput={!!data.inputs?.length}
        hasOutput={!!data.outputs?.length}
      />
      <header>
        <NodeCollapseButton id={id} collapsed={data.collapsed} />
        <strong>{data.title}</strong>
        <Volume2 size={14} />
        <NodeLockButton id={id} locked={data.locked} />
        <NodeDeleteButton id={id} title={data.title} locked={data.locked} />
      </header>
      <div className={`audio-node__hero${primaryAudio ? " has-result" : ""}`}>
        {primaryAudio ? (
          <>
            <AudioWaveform src={primaryAudio.src} className="audio-node__hero-wave" />
            <button
              type="button"
              className="audio-node__hero-play nodrag"
              aria-label={playing ? "暂停语音" : "播放语音"}
              title={playing ? "暂停" : "播放"}
              onClick={togglePlay}
            >
              {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <span className="audio-node__hero-label">
              <Volume2 size={12} />
              已生成语音
            </span>
            <audio
              ref={primaryAudioRef}
              src={primaryAudio.src}
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
          </>
        ) : (
          <>
            <button
              className="audio-node__upload nodrag"
              disabled={uploading}
              onClick={() => uploadRef.current?.click()}
            >
              <Upload size={14} />
              {uploading ? "上传中…" : uploadedAudio?.name || media.uploadedName || "上传音频"}
            </button>
            {uploadedAudio?.storageKey && (
              <button
                className="audio-node__upload-clear nodrag"
                aria-label="移除已上传音频"
                title="移除已上传音频，改用文字生成配音"
                onClick={() => update({ uploadedAudio: null, uploadedName: "", selectedAudioSource: "tts" })}
              >
                <X size={12} />
              </button>
            )}
            <span>
              <Music2 size={34} />
            </span>
          </>
        )}
        <input
          ref={uploadRef}
          hidden
          type="file"
          accept="audio/*"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setUploading(true);
            try {
              const asset = await uploadAudio?.(file);
              if (!asset?.storageKey) throw new Error("音频上传未返回存储地址");
              update({ uploadedAudio: asset, uploadedName: asset.name, selectedAudioSource: "uploaded" });
              notify?.(`已载入音频：${asset.name}`);
            } catch (error) {
              notify?.(error?.message || "音频上传失败");
            } finally {
              setUploading(false);
            }
          }}
        />
      </div>
      {visualRefs.length > 0 && (
        <div
          className="audio-node__visuals nodrag nowheel"
          aria-label="画面参考"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {visualRefs.map((reference) => (
            <div className="audio-node__visual-chip" key={reference.edgeId} title={`画面参考：${reference.title}`}>
              {reference.preview ? <img src={reference.preview} alt={reference.title} /> : <Film size={12} />}
              <small>{reference.title}</small>
              <button aria-label={`移除画面参考：${reference.title}`} onClick={() => removeReference?.(id, reference.sourceId)}>
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className="audio-node__studio nodrag nowheel"
        onPointerDown={(event) => event.stopPropagation()}
      >
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
          placeholder="输入需要朗读的台词……"
          rows={4}
        />
        <small>{(media.prompt || "").length} / 10000</small>
      </div>
      {/* 模型 / 音色配置 / 份数 同一行（与视频节点 media-node__controls 同构），第二行为积分与生成 */}
      <div
        className="audio-node__controls nodrag nowheel"
        onPointerDown={(event) => event.stopPropagation()}
      >
          <DemoSelect
            className="nodrag nowheel workflow-node-select"
            ariaLabel="音频生成模型"
            value={media.model || modelNames[0] || ""}
            onChange={(val) => update({ model: val })}
            options={modelNames.map((name) => ({ value: name, label: name }))}
          />
          <div className="audio-node__voice-field">
            <button
              className={`audio-node__voice-trigger${voiceOpen ? " is-open" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={voiceOpen}
              title={voiceSummary}
              onClick={() => setVoiceOpen((value) => !value)}
            >
              <Mic2 size={12} />
              <span>{voiceSummary}</span>
              <ChevronDown size={11} className="select-chevron" />
            </button>
            {voiceOpen && (
              <QuickAudioPopover
                className="audio-node__voice-popover"
                voices={audioOptions.voices}
                formats={audioOptions.formats}
                voiceId={voiceId}
                setVoiceId={(next) => update({ voiceId: next })}
                audioFormat={audioFormat}
                setAudioFormat={(next) => update({ format: next })}
                speed={speed}
                setSpeed={(next) => update({ speed: next })}
                minSpeed={audioOptions.minSpeed}
                maxSpeed={audioOptions.maxSpeed}
                emotions={AUDIO_EMOTIONS}
                emotion={media.emotion}
                setEmotion={(next) => update({ emotion: next })}
              />
            )}
          </div>
          <DemoSelect
            className="nodrag nowheel workflow-node-select audio-node__copies"
            ariaLabel="音频副本数量"
            value={media.copies || 1}
            onChange={(val) => update({ copies: Number(val) })}
            options={[1, 2, 3, 4].map((copy) => ({ value: copy, label: `${copy} 份` }))}
          />
          <span className="audio-node__cost" title="按所选模型的售价与副本数估算">
            <Zap size={11} />
            {creditCost}
          </span>
          <button className="audio-node__generate" onClick={runGeneration}>
            {isBusy ? (
              <>
                <Sparkles className="spin" size={13} />
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
      {(audioOutputs.length > 1 || runFailed) && (
        <div
          className="audio-node__result nodrag nowheel"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {runFailed ? (
            <div className="audio-node__result-error" role="alert">
              <span>{data.runtime?.error || "生成失败，请重试"}</span>
              <button onClick={runGeneration}>
                <RotateCcw size={12} />
                重试
              </button>
            </div>
          ) : (
            <>
              {audioOutputs.length > 1 && <small className="audio-node__result-hint">共 {audioOutputs.length} 个副本</small>}
              {audioOutputs.map((output, index) => (
                <div className="audio-node__result-item" key={output.storageKey || output.src || index}>
                  {audioOutputs.length > 1 && <b>{index + 1}</b>}
                  <audio controls preload="metadata" src={output.src} />
                </div>
              ))}
            </>
          )}
        </div>
      )}
      <footer>
        <span>光驭画布节点</span>
        <small>配音</small>
      </footer>
    </div>
  );
}
