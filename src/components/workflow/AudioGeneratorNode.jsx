import { useEffect, useRef, useState } from "react";
import { Download, Music2, Upload, Volume2, WandSparkles, Zap } from "lucide-react";
import { calculateCreditEstimate } from "../../lib/pricing.js";
import { nodeViewModel } from "./nodeViewModel.js";
import { audioPreviewSources } from "./nodeInteractions.js";
import { GenerationSkeleton, NodeCard, NodeError, OutputGrid, controlClass, stopNodePointer } from "./NodeCardParts.jsx";
import { useWorkflowNode } from "./WorkflowNodeContext.jsx";

const fallbackBars = Array.from({ length: 48 }, (_, index) => 8 + ((index * 17 + index * index * 7) % 31));

function AudioWaveform({ url }) {
  const [bars, setBars] = useState(fallbackBars);
  useEffect(() => {
    if (!url || typeof window === "undefined" || !window.AudioContext) return;
    let cancelled = false;
    const context = new window.AudioContext();
    async function decode() {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Audio unavailable");
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        const samples = buffer.getChannelData(0);
        const binSize = Math.max(1, Math.floor(samples.length / 48));
        const next = Array.from({ length: 48 }, (_, index) => {
          let peak = 0;
          const start = index * binSize;
          for (let cursor = start; cursor < Math.min(samples.length, start + binSize); cursor += Math.max(1, Math.floor(binSize / 64))) peak = Math.max(peak, Math.abs(samples[cursor]));
          return Math.max(5, Math.round(peak * 48));
        });
        if (!cancelled) setBars(next);
      } catch {
        if (!cancelled) setBars(fallbackBars);
      } finally {
        await context.close();
      }
    }
    decode();
    return () => { cancelled = true; };
  }, [url]);
  return <svg className="workflow-card__waveform" viewBox="0 0 480 56" preserveAspectRatio="none" role="img" aria-label="音频波形">
    {bars.map((height, index) => <rect key={index} x={index * 10 + 2} y={(56 - height) / 2} width="5" height={height} rx="2" />)}
  </svg>;
}

export default function AudioGeneratorNode({ id, data, selected }) {
  const { updateMedia, selectOutput, getVariableScopes, execute, uploadAudio, models = [] } = useWorkflowNode();
  const fileRef = useRef(null);
  const [uploadError, setUploadError] = useState("");
  const media = data.media || {};
  const runtime = data.runtime || {};
  const view = nodeViewModel("AudioGenerator", { ...media, scopes: getVariableScopes(id) }, runtime);
  const isMusic = ["music", "音乐", "AI 音乐"].includes(media.tab);
  const uploaded = media.uploadedAudio;
  const sources = audioPreviewSources(view.generatedOutput, uploaded);
  const playable = (sources.find((source) => source.kind === media.selectedAudioSource) || sources[0])?.output;
  const patch = (change) => updateMedia(id, change);
  const chosenName = isMusic ? (media.musicModel || media.model) : media.model;
  const model = models.find((item) => item.name === chosenName || String(item.id) === String(media.modelId));
  const estimate = calculateCreditEstimate({ pricing: model?.pricing, category: "audio", characterCount: (media.prompt || "").length, copies: media.copies });
  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setUploadError("");
      const result = await uploadAudio(file);
      if (!result?.storageKey || !result.url || String(result.url).startsWith("blob:")) throw new Error("上传未返回可保存的音频地址");
      patch({ selectedAudioSource: "uploaded", uploadedAudio: { type: "audio", storageKey: result.storageKey, url: result.url, name: result.name || file.name, duration: result.duration } });
    } catch (error) {
      setUploadError(error.message || "音频上传失败");
    }
  }
  const audioModels = (media.models || []).map((item) => typeof item === "string" ? item : item.name);
  return <NodeCard data={data} selected={selected} kind="audio" view={view} icon={Volume2} footer={isMusic ? "音乐" : "配音"}>
    <div className="workflow-card__body" onPointerDown={stopNodePointer}>
      <div className="workflow-card__audio-preview">
        <AudioWaveform url={playable?.url} />
        {playable?.url ? <><audio className={controlClass} controls preload="metadata" src={playable.url} /><a className={controlClass} href={playable.url} download={playable.name || "audio.mp3"}><Download size={12} />下载音频</a></>
          : <span><Music2 size={25} />等待音频</span>}
      </div>
      {sources.length > 0 && <div className="workflow-card__output-tabs" role="group" aria-label="音频来源">{sources.map((source) => <button key={source.kind} className={`${controlClass} ${playable === source.output ? "active" : ""}`} onClick={() => patch({ selectedAudioSource: source.kind })}>{source.label}</button>)}{!view.generatedOutput && uploaded && <button className={controlClass} onClick={() => patch({ selectedAudioSource: "generated" })}>使用生成模式</button>}</div>}
      <button className={`${controlClass} workflow-card__upload`} onClick={() => fileRef.current?.click()}><Upload size={13} />{uploaded?.name || "上传参考音频"}</button>
      <input ref={fileRef} hidden type="file" accept="audio/*" onChange={handleFile} />
      {uploadError && <p className="workflow-card__notice workflow-card__notice--error" role="alert">{uploadError}</p>}
      <nav className="workflow-card__segmented" aria-label="音频模式">{view.tabs.map((label, index) => <button key={label} className={`${controlClass} ${isMusic === Boolean(index) ? "active" : ""}`} onClick={() => patch({ tab: index ? "music" : "speech" })}>{label}</button>)}</nav>
      <textarea className={controlClass} aria-label={isMusic ? "音乐描述" : "朗读文本"} value={media.prompt || ""} onChange={(event) => patch({ prompt: event.target.value })} placeholder={isMusic ? "描述音乐风格、节奏与氛围" : "输入需要朗读的台词"} rows={isMusic ? 3 : 5} />
      {view.missing.length > 0 && <p className="workflow-card__notice">缺少变量：{view.missing.join("、")}</p>}
      {view.conflicts.length > 0 && <p className="workflow-card__notice workflow-card__notice--error">变量冲突：{view.conflicts.join("、")}</p>}
      {isMusic ? <><textarea className={controlClass} aria-label="歌词" value={media.lyrics || ""} onChange={(event) => patch({ lyrics: event.target.value })} placeholder="歌词（可选）" rows={2} /><label className="workflow-card__check"><input type="checkbox" checked={media.instrumental !== false} onChange={(event) => patch({ instrumental: event.target.checked })} />纯音乐</label></>
        : <div className="workflow-card__control-row"><label>音色<input className={controlClass} value={media.voice || ""} onChange={(event) => patch({ voice: event.target.value })} /></label><label>语速<input className={controlClass} type="number" min="0.5" max="2" step="0.1" value={media.speed ?? 1} onChange={(event) => patch({ speed: Number(event.target.value) })} /></label><label>情绪<input className={controlClass} value={media.emotion || ""} onChange={(event) => patch({ emotion: event.target.value })} /></label></div>}
      <div className="workflow-card__control-row"><select className={controlClass} aria-label="音频生成模型" value={chosenName || ""} onChange={(event) => patch(isMusic ? { musicModel: event.target.value } : { model: event.target.value })}>{audioModels.map((name) => <option key={name}>{name}</option>)}</select><select className={controlClass} aria-label="音频副本数量" value={media.copies || 1} onChange={(event) => patch({ copies: Number(event.target.value) })}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 份</option>)}</select></div>
      {view.isBusy && <GenerationSkeleton progress={view.progress} />}
      {view.hasError && <NodeError message={runtime.error || (view.status === "BLOCKED" ? "上游节点失败，当前节点未运行" : "")} onRetry={() => execute(id)} />}
      {view.status === "SUCCEEDED" && view.outputs.length > 1 && <OutputGrid outputs={view.outputs} kind="audio" selectedOutput={view.generatedOutput} onSelect={(index) => { selectOutput(id, index); patch({ selectedAudioSource: "generated" }); }} />}
      <div className="workflow-card__action-row"><span><Zap size={13} />{runtime.creditCost != null ? `实际 ${runtime.creditCost}` : `预计 ${estimate}`} 积分</span><button className={`${controlClass} workflow-card__primary`} disabled={view.actionDisabled} onClick={() => execute(id)}><WandSparkles size={13} />{view.actionLabel}</button></div>
    </div>
  </NodeCard>;
}
