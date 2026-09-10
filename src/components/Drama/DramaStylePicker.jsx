import { Check } from "lucide-react";
import { DRAMA_STYLES } from "./dramaStyles.js";

export function DramaStylePicker({ value, onChange, disabled }) {
  return (
    <div className="drama-style-field">
      <span>视觉风格</span>
      <div className="drama-style-grid" role="listbox" aria-label="视觉风格">
        {DRAMA_STYLES.map((style) => {
          const selected = value === style.key;
          return (
            <button
              key={style.key}
              type="button"
              role="option"
              aria-selected={selected}
              className={`drama-style-card ${selected ? "is-selected" : ""}`}
              disabled={disabled}
              onClick={() => onChange(style.key)}
            >
              <span className="drama-style-card__cover">
                <img
                  src={style.cover}
                  alt=""
                  onError={(event) => {
                    if (event.currentTarget.dataset.fallback === "1") return;
                    event.currentTarget.dataset.fallback = "1";
                    event.currentTarget.src = style.fallback;
                  }}
                />
                {selected && <em><Check size={14} /> 已选</em>}
              </span>
              <strong>{style.name}</strong>
              <small>编译前缀由系统注入</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
