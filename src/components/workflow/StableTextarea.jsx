import { useLayoutEffect, useRef } from "react";

/**
 * 工作台节点内的提示词输入框。
 *
 * React 19.2 的 updateTextarea 对受控 textarea 每次重渲染都会执行
 * `element.defaultValue = value`，Chrome 收到 defaultValue 赋值会把选区重置到末尾 ——
 * 于是用户在节点里改提示词时，每敲一个字光标都被顶到末尾（快速创作页是普通受控写法，
 * 不受影响；受影响的是画布节点内的输入框）。
 *
 * 这里改成「DOM 自己管文本、React 只在外部真正改值时才同步」的非受控写法：
 * React 不再持有 value/defaultValue，也就永远不会再写 defaultValue，光标不会被重置；
 * 外部改值（载入模板、变量替换、切换节点）时再把 DOM 文本同步过去，光标落在末尾。
 */
export default function StableTextarea({ value, onChange, ...rest }) {
  const ref = useRef(null);
  const lastProp = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = value ?? "";
    // 只在 DOM 与外部值确实不一致时同步（首次挂载 / 载入模板 / 变量替换）；
    // 用户输入过程中 DOM 已是最新文本，这里不动 DOM，避免打断光标。
    if (el.value !== next) {
      el.value = next;
      el.setSelectionRange(next.length, next.length);
    }
    lastProp.current = next;
  }, [value]);

  return (
    <textarea
      {...rest}
      ref={ref}
      onChange={(event) => onChange?.(event.target.value, event)}
    />
  );
}
