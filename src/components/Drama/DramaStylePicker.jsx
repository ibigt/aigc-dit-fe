import { CircleCheck } from "lucide-react";
import { DRAMA_STYLES } from "./dramaStyles.js";

export function DramaStylePicker({ value, onChange, disabled }) {
  return (
    <div className="style-card-grid" role="listbox" aria-label="视觉风格">
      {DRAMA_STYLES.map((style) => {
        const selected = value === style.key;
        return (
          <button
            key={style.key}
            type="button"
            role="option"
            aria-selected={selected}
            className={selected ? "active" : ""}
            disabled={disabled}
            onClick={() => onChange(style.key)}
          >
            <img
              src={style.cover}
              alt=""
              onError={(event) => {
                if (event.currentTarget.dataset.fallback === "1") return;
                event.currentTarget.dataset.fallback = "1";
                event.currentTarget.src = style.fallback;
              }}
            />
            <span>{style.name}</span>
            {selected && <CircleCheck size={16} />}
          </button>
        );
      })}
    </div>
  );
}
