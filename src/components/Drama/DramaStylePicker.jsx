import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import { DRAMA_STYLES } from "./dramaStyles.js";

const TABS = [
  { key: "realistic", label: "写实" },
  { key: "anime", label: "动漫" },
];

function categoryOf(key) {
  const match = DRAMA_STYLES.find((item) => item.key === key);
  return match ? match.category : "realistic";
}

export function DramaStylePicker({ value, onChange, disabled }) {
  const [tab, setTab] = useState(() => categoryOf(value));

  // 外部值变化时（如切换剧集、回填草稿）同步到对应 tab，让选中卡片始终可见。
  useEffect(() => {
    setTab(categoryOf(value));
  }, [value]);

  const visible = DRAMA_STYLES.filter((style) => style.category === tab);

  return (
    <div className="style-card-tabs">
      <div className="style-category-tabs style-card-tabbar" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`style-category-tab ${tab === item.key ? "selected active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="style-card-grid" role="listbox" aria-label="视觉风格">
        {visible.map((style) => {
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
    </div>
  );
}
