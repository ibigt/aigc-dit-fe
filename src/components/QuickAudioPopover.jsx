import { Check } from "lucide-react";
import { useState } from "react";
import { voiceIdOf, voiceLabel, voiceLanguage } from "../lib/voices.js";

/**
 * 语音参数弹框（音色 / 格式 / 语速）。
 * 快速创作与高级工作台音频节点共用同一个组件，保证两端参数口径与交互完全一致。
 * 高级工作台额外传 emotions 时追加「情感」段落（工作台独有能力，快速创作不显示）。
 */
export default function QuickAudioPopover({
  voices = [],
  formats = [],
  voiceId,
  setVoiceId,
  audioFormat,
  setAudioFormat,
  speed = 1,
  setSpeed,
  minSpeed = 0.25,
  maxSpeed = 4,
  showFormats = true,
  showSpeed = true,
  emotions = [],
  emotion,
  setEmotion,
  className = "",
}) {
  const [voiceKeyword, setVoiceKeyword] = useState("");
  const [voiceLanguageFilter, setVoiceLanguageFilter] = useState("全部");
  const languages = [...new Set(voices.map(voiceLanguage))];
  const normalizedKeyword = voiceKeyword.trim().toLowerCase();
  const visibleVoices = voices.filter((voice) => {
    const matchesLanguage = voiceLanguageFilter === "全部" || voiceLanguage(voice) === voiceLanguageFilter;
    const matchesKeyword = !normalizedKeyword || `${voiceLabel(voice)} ${voiceIdOf(voice)}`.toLowerCase().includes(normalizedKeyword);
    return matchesLanguage && matchesKeyword;
  });
  const speedProgress = Math.min(100, Math.max(0, ((speed - minSpeed) / (maxSpeed - minSpeed || 1)) * 100));
  return (
    <div className={`select-menu quick-audio-popover ${className}`.trim()} role="dialog" aria-label="语音参数设置">
      <section className="quick-audio-section">
        <label><span>音色</span><small>共 {voices.length} 个</small></label>
        <div className="quick-voice-tools">
          <input value={voiceKeyword} onChange={(event) => setVoiceKeyword(event.target.value)} placeholder="搜索音色名称或 Voice ID" />
          <select value={voiceLanguageFilter} onChange={(event) => setVoiceLanguageFilter(event.target.value)}>
            <option value="全部">全部语言</option>
            {languages.map((language) => <option key={language} value={language}>{language}</option>)}
          </select>
        </div>
        <div className="quick-voice-grid">
          {visibleVoices.map((voice) => {
            const id = voiceIdOf(voice);
            const selected = voiceId === id;
            return (
              <button type="button" className={selected ? "selected" : ""} key={id} onClick={() => setVoiceId(id)}>
                <span>{voiceLabel(voice)}</span>
                <small>{voiceLanguage(voice)} · {id}</small>
                {selected && <Check size={12} className="quick-option-check" />}
              </button>
            );
          })}
        </div>
        {!visibleVoices.length && <div className="quick-voice-empty">没有匹配的音色</div>}
      </section>

      {showFormats && (
        <section className="quick-audio-section">
          <label>格式</label>
          <div className="quick-format-grid">
            {formats.map((fmt) => {
              const selected = audioFormat === fmt;
              return (
                <button type="button" role="option" aria-selected={selected} className={`quick-param-option ${selected ? "selected" : ""}`} key={fmt} onClick={() => setAudioFormat(fmt)}>
                  <span>{fmt.toUpperCase()}</span>
                  {selected && <Check size={13} className="quick-option-check" />}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {showSpeed && (
        <section className="quick-audio-section quick-audio-speed">
          <label><span>语速</span><b>{Number(speed || 0).toFixed(2)}x</b></label>
          <input type="range" style={{ "--range-progress": `${speedProgress}%` }} min={minSpeed} max={maxSpeed} step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
          <div><small>{minSpeed}x</small><small>{maxSpeed}x</small></div>
        </section>
      )}

      {emotions.length > 0 && (
        <section className="quick-audio-section">
          <label>情感</label>
          <div className="quick-emotion-grid">
            {emotions.map((item) => {
              // 情感档位支持字符串或 { value, label }（工作台用后者映射厂商枚举）
              const value = typeof item === "string" ? item : item?.value ?? "";
              const label = typeof item === "string" ? item : item?.label ?? value;
              const selected = (emotion ?? "") === value;
              return (
                <button type="button" role="option" aria-selected={selected} className={`quick-param-option ${selected ? "selected" : ""}`} key={value || "default"} onClick={() => setEmotion?.(value)}>
                  <span>{label}</span>
                  {selected && <Check size={13} className="quick-option-check" />}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
