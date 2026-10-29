import { Handle, Position } from "@xyflow/react";
import {
  ChevronDown,
  Mic2,
  Minus,
  Music2,
  Play,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Volume2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import { DemoSelect } from "../DemoSelect.jsx";
import { audioNodeCreditCost } from "../../lib/nodeCredits.js";
import { mediaUrl } from "../../lib/media.js";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";
import AudioWaveform from "./AudioWaveform.jsx";
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

const demoVoices = [
  { name: "深情叙事者", tags: "磁性 · 沉稳 · 细腻" },
  { name: "清晰解说", tags: "清脆 · 共鸣 · 有层次" },
  { name: "元气少女", tags: "明亮 · 活力 · 亲切" },
  { name: "成熟男声", tags: "深沉 · 克制 · 可靠" },
  { name: "温柔主持", tags: "柔和 · 自然 · 舒缓" },
  { name: "都市青年", tags: "轻快 · 利落 · 现代" },
];

export default function AudioGeneratorNode({ id, data, selected }) {
  const { updateMedia, generateMedia, notify, models } = useWorkflowNode();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceQuery, setVoiceQuery] = useState("");
  const [generating, setGenerating] = useState(false);
  const uploadRef = useRef(null);

  const media = data.media || {};
  const update = (patch) => updateMedia?.(id, patch);
  const isMusic = ["music", "音乐", "AI 音乐"].includes(media.tab);
  const visibleVoices = demoVoices.filter((voice) =>
    `${voice.name}${voice.tags}`
      .toLowerCase()
      .includes(voiceQuery.toLowerCase())
  );

  const modelNames = (media.models || [])
    .map((model) => (typeof model === "string" ? model : model?.name))
    .filter(Boolean);
  const musicModels = [...new Set([...modelNames, "Music-3.0"])];
  const isBusy = generating || data.runtime?.status === "RUNNING";

  // 生成结果（含多副本）：播放器 + 波形可视化（需求 4.2.4.5），失败时可重试
  const audioOutputs = (data.runtime?.outputs || [])
    .filter((output) => output?.url || output?.storageKey)
    .map((output) => ({ ...output, src: output.storageKey ? mediaUrl(output.storageKey) : output.url }));
  const runFailed = data.runtime?.status === "FAILED";

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
      </header>
      <div className="audio-node__hero">
        <button
          className="audio-node__upload nodrag"
          onClick={() => uploadRef.current?.click()}
        >
          <Upload size={14} />
          {media.uploadedName || media.uploadedAudio?.name || "上传音频"}
        </button>
        <span>
          <Music2 size={34} />
        </span>
        <input
          ref={uploadRef}
          hidden
          type="file"
          accept="audio/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              update({ uploadedName: file.name });
              notify?.(`已载入音频：${file.name}`);
            }
          }}
        />
      </div>
      <div
        className="audio-node__studio nodrag nowheel"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <nav>
          <button
            className={!isMusic ? "active" : ""}
            onClick={() => update({ tab: "配音" })}
          >
            配音
          </button>
          <button
            className={isMusic ? "active" : ""}
            onClick={() => update({ tab: "音乐" })}
          >
            音乐
          </button>
        </nav>
        <button
          className="audio-node__add-reference"
          aria-label="添加参考音频"
          onClick={() => uploadRef.current?.click()}
        >
          <Plus size={15} />
        </button>
        {!isMusic ? (
          <>
            <textarea
              value={media.prompt || ""}
              onChange={(event) => update({ prompt: event.target.value })}
              placeholder="输入需要朗读的台词……"
              rows={5}
            />
            <small>{(media.prompt || "").length} / 10000</small>
            <div className="audio-node__controls">
              <DemoSelect
                className="nodrag nowheel workflow-node-select"
                ariaLabel="音频生成模型"
                value={media.model || modelNames[0] || ""}
                onChange={(val) => update({ model: val })}
                options={modelNames.map((name) => ({ value: name, label: name }))}
              />
              <button
                className={`audio-node__voice-trigger${voiceOpen ? " is-open" : ""}`}
                onClick={() => {
                  setVoiceOpen((value) => !value);
                  setSettingsOpen(false);
                }}
              >
                <Mic2 size={12} />
                <span>{media.voice || "深情叙事者"}</span>
                <ChevronDown size={11} className="select-chevron" />
              </button>
              <button
                aria-label="声音设置"
                className={settingsOpen ? "active" : ""}
                onClick={() => {
                  setSettingsOpen((value) => !value);
                  setVoiceOpen(false);
                }}
              >
                <SlidersHorizontal size={13} />
              </button>
            </div>
          </>
        ) : (
          <>
            <textarea
              value={media.prompt || ""}
              onChange={(event) => update({ prompt: event.target.value })}
              placeholder="描述音乐风格、节奏与氛围……"
              rows={3}
            />
            <textarea
              className="audio-node__lyrics"
              value={media.lyrics || ""}
              onChange={(event) => update({ lyrics: event.target.value })}
              placeholder="添加歌词；留空时将根据风格自动生成。"
              rows={3}
            />
            <small>{(media.prompt || "").length} / 2000</small>
            <div className="audio-node__controls audio-node__controls--music">
              <DemoSelect
                className="nodrag nowheel workflow-node-select"
                ariaLabel="音乐生成模型"
                value={media.musicModel || "Music-3.0"}
                onChange={(val) => update({ musicModel: val })}
                options={musicModels.map((name) => ({ value: name, label: name }))}
              />
              <label>
                <input
                  type="checkbox"
                  checked={media.instrumental !== false}
                  onChange={(event) =>
                    update({ instrumental: event.target.checked })
                  }
                />
                <span>纯音乐</span>
              </label>
            </div>
          </>
        )}
        <div className="audio-node__generate-row">
          <DemoSelect
            className="nodrag nowheel workflow-node-select"
            ariaLabel="音频副本数量"
            value={media.copies || 1}
            onChange={(val) => update({ copies: Number(val) })}
            options={[1, 2, 3, 4].map((copy) => ({ value: copy, label: `${copy} 份` }))}
          />
          <span title="按所选模型的售价与副本数估算">
            <Zap size={11} />
            {creditCost}
          </span>
          <button onClick={runGeneration}>
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
      </div>
      {(audioOutputs.length > 0 || runFailed) && (
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
            audioOutputs.map((output, index) => (
              <div className="audio-node__result-item" key={output.storageKey || output.src || index}>
                {audioOutputs.length > 1 && <b>{index + 1}</b>}
                <audio controls preload="metadata" src={output.src} />
                <AudioWaveform src={output.src} />
              </div>
            ))
          )}
        </div>
      )}
      {settingsOpen && (
        <div
          className="audio-node__popover audio-node__settings nodrag nowheel"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header>
            <strong>声音设置</strong>
            <button onClick={() => setSettingsOpen(false)}>
              <X size={13} />
            </button>
          </header>
          <section>
            <span>语速</span>
            <div>
              <button
                onClick={() =>
                  update({ speed: Math.max(0.5, Number(media.speed || 1) - 0.25) })
                }
              >
                <Minus size={12} />
              </button>
              <b>
                {Number(media.speed || 1)
                  .toFixed(2)
                  .replace(/0$/, "")}
              </b>
              <button
                onClick={() =>
                  update({ speed: Math.min(2, Number(media.speed || 1) + 0.25) })
                }
              >
                <Plus size={12} />
              </button>
            </div>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.25"
              value={media.speed || 1}
              onChange={(event) =>
                update({ speed: Number(event.target.value) })
              }
            />
          </section>
          <section>
            <span>情感</span>
            <div className="audio-node__emotion">
              {["平静", "开心", "悲伤", "愤怒", "恐惧", "惊讶", "流畅"].map(
                (emotion) => (
                  <button
                    className={media.emotion === emotion ? "active" : ""}
                    key={emotion}
                    onClick={() => update({ emotion })}
                  >
                    {emotion}
                  </button>
                )
              )}
            </div>
          </section>
        </div>
      )}
      {voiceOpen && (
        <div
          className="audio-node__popover audio-node__voices nodrag nowheel"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header>
            <strong>选择音色</strong>
            <button onClick={() => setVoiceOpen(false)}>
              <X size={13} />
            </button>
          </header>
          <label>
            <Search size={13} />
            <input
              value={voiceQuery}
              onChange={(event) => setVoiceQuery(event.target.value)}
              placeholder="搜索音色"
            />
          </label>
          <div>
            {visibleVoices.map((voice) => (
              <button
                className={media.voice === voice.name ? "active" : ""}
                key={voice.name}
                onClick={() => {
                  update({ voice: voice.name });
                  setVoiceOpen(false);
                }}
              >
                <Play size={11} fill="currentColor" />
                <span>
                  <strong>{voice.name}</strong>
                  <small>{voice.tags}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <footer>
        <span>光驭画布节点</span>
        <small>{isMusic ? "音乐" : "配音"}</small>
      </footer>
    </div>
  );
}
