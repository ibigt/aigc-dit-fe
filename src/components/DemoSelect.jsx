import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function DemoSelect({
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  menuClassName = "",
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((item) => String(item.value) === String(value));

  useEffect(() => {
    if (!open) return undefined;

    const onMouseDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`demo-select custom-select${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="select-value">{selected?.label || "请选择"}</span>
        <ChevronDown size={18} />
      </button>
      {open && (
        <div className={`select-menu${menuClassName ? ` ${menuClassName}` : ""}`} role="listbox" aria-label={ariaLabel}>
          {options.map((item) => {
            const isSelected = String(item.value) === String(value);
            return (
              <button
                type="button"
                key={String(item.value)}
                role="option"
                aria-selected={isSelected}
                className={`select-option${isSelected ? " selected" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  if (!isSelected) onChange?.(item.value);
                }}
              >
                <span>{item.label}</span>
                {isSelected && <Check size={17} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
