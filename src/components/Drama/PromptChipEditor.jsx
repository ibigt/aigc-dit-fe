import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { mediaUrl, MEDIA_THUMB_WIDTH } from "../../lib/media.js";
import {
  nextTokenId,
  parsePromptToTokens,
  plainTextLength,
  serializeTokensToPrompt,
} from "../../lib/promptChips.js";

/**
 * 分镜视频提示词富文本编辑器。
 *
 * 存储约定：chip 在 promptOverride 里以字面文本保存：
 *   - 已绑定资产: `[Image #1] 资产名`（N = pictureIndex）
 *   - 未绑定资产: `[未绑定] 资产名`
 *
 * 解析时按正则 `/\[(Image #\d+|未绑定)\] (.+?)(?=\s\[|$)/g` 全局匹配；
 * 资产按 name 严格匹配 lockedAssets 还原缩略图与 binding 状态。
 *
 * 纯函数（parse/serialize/nextTokenId/plainTextLength）抽到 lib/promptChips.js，
 * 这里只放组件与 DOM 操作。
 */

// ---------- 主组件 ----------

export const PromptChipEditor = forwardRef(function PromptChipEditor(
  { value, lockedAssets, refs, disabled, onChange },
  ref,
) {
  const safeLockedAssets = lockedAssets || [];
  const safeRefs = refs || [];
  const refsByAssetId = useMemo(() => {
    const m = new Map();
    for (const r of safeRefs) {
      if (r && r.assetId != null) m.set(r.assetId, r);
    }
    return m;
  }, [safeRefs]);

  const [tokens, setTokens] = useState(() =>
    parsePromptToTokens(value, { lockedAssets: safeLockedAssets, refsByAssetId }),
  );
  const editorRef = useRef(null);
  const pendingCaretRef = useRef(null);
  const lastIncomingValueRef = useRef(value);
  const lastSerializedRef = useRef("");

  const [mention, setMention] = useState({
    open: false,
    query: "",
    anchorTokenId: null,
    rect: null,
  });
  const [activeIndex, setActiveIndex] = useState(0);

  // ---------- 同步：外部 value 变化（重置 draft / 切镜）→ 重新解析 ----------
  useEffect(() => {
    if (value === lastIncomingValueRef.current) return;
    lastIncomingValueRef.current = value;
    // 如果我们刚把同样的字符串写回过 onChange，不要再解析（避免 ids 全部翻新）
    if (value === lastSerializedRef.current) return;
    setTokens(
      parsePromptToTokens(value, { lockedAssets: safeLockedAssets, refsByAssetId }),
    );
  }, [value, safeLockedAssets, refsByAssetId]);

  // ---------- 同步：tokens 变化 → 写回父组件 ----------
  useEffect(() => {
    if (disabled) return undefined;
    const next = serializeTokensToPrompt(tokens);
    lastSerializedRef.current = next;
    if (next !== value) onChange?.(next);
    return undefined;
  }, [tokens, disabled, onChange, value]);

  // ---------- DOM 渲染：把 tokens 同步到 contentEditable 子节点 ----------
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return undefined;

    const currentIds = Array.from(el.children).map((c) => c.dataset.tokenId);
    const nextIds = tokens.map((t) => t.id);
    const sameStructure =
      currentIds.length === nextIds.length && currentIds.every((id, i) => id === nextIds[i]);

    if (!sameStructure) {
      // 重建：用 firstChild 循环清空，保留 scrollTop
      while (el.firstChild) el.removeChild(el.firstChild);
      for (const t of tokens) {
        if (t.kind === "text") {
          const span = document.createElement("span");
          span.dataset.tokenId = t.id;
          span.dataset.kind = "text";
          span.textContent = t.value || "";
          el.appendChild(span);
        } else {
          el.appendChild(buildChipElement(t));
        }
      }
    } else {
      // 结构不变：仅更新内容 / 标签
      for (let i = 0; i < tokens.length; i += 1) {
        const t = tokens[i];
        const child = el.children[i];
        if (!child) continue;
        if (t.kind === "text") {
          if ((child.textContent || "") !== (t.value || "")) {
            child.textContent = t.value || "";
          }
        } else {
          // 增量更新 chip 的可视属性
          if (child.dataset.label !== t.label) child.dataset.label = t.label;
          if (child.dataset.name !== t.name) child.dataset.name = t.name;
          const newState = t.asset ? "ok" : "broken";
          if (child.dataset.state !== newState) {
            child.dataset.state = newState;
            child.setAttribute("data-token-state", newState);
          }
          const labelEl = child.querySelector(".drama-prompt-chip__label");
          if (labelEl && labelEl.textContent !== t.label) labelEl.textContent = t.label;
          const nameEl = child.querySelector(".drama-prompt-chip__name");
          if (nameEl && nameEl.textContent !== t.name) nameEl.textContent = t.name;
          const thumbEl = child.querySelector(".drama-prompt-chip__thumb");
          if (thumbEl) {
            const imgEl = thumbEl.querySelector("img");
            const wantSrc = t.asset
              ? mediaUrl(t.asset.imageStorageKey || t.asset.imageUrl, { w: MEDIA_THUMB_WIDTH })
              : "";
            if (t.asset) {
              if (!imgEl) {
                const img = document.createElement("img");
                img.src = wantSrc;
                img.alt = "";
                thumbEl.appendChild(img);
              } else if (imgEl.getAttribute("src") !== wantSrc) {
                imgEl.setAttribute("src", wantSrc);
              }
            } else if (imgEl) {
              imgEl.remove();
            }
          }
        }
      }
    }

    // 恢复 caret（如有）
    if (pendingCaretRef.current) {
      const { tokenId, offset, afterChip } = pendingCaretRef.current;
      pendingCaretRef.current = null;
      const target = el.querySelector(`[data-token-id="${tokenId}"]`);
      if (target) {
        const range = document.createRange();
        const sel = window.getSelection();
        sel.removeAllRanges();
        if (afterChip || target.dataset.kind === "asset") {
          range.setStartAfter(target);
        } else {
          const node = target.firstChild || target;
          const txt = node.textContent || "";
          range.setStart(node, Math.min(Math.max(0, offset), txt.length));
        }
        range.collapse(true);
        sel.addRange(range);
      }
    }

    return undefined;
  }, [tokens, safeLockedAssets]);

  // ---------- mention 下拉的滚动 / 缩放跟随 ----------
  useEffect(() => {
    if (!mention.open) return undefined;
    const update = () => {
      setMention((m) => {
        if (!m.open) return m;
        const rect = computeCaretRect();
        return rect ? { ...m, rect } : m;
      });
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [mention.open]);

  // ---------- 过滤后的下拉数据（已绑定拍前） ----------
  const filteredAssets = useMemo(() => {
    if (!mention.open) return [];
    const q = (mention.query || "").toLowerCase();
    const list = safeLockedAssets.filter((a) => {
      if (!q) return true;
      return (a.name || "").toLowerCase().includes(q);
    });
    list.sort((a, b) => {
      const aB = refsByAssetId.has(a.id) ? 0 : 1;
      const bB = refsByAssetId.has(b.id) ? 0 : 1;
      if (aB !== bB) return aB - bB;
      return (a.name || "").localeCompare(b.name || "", "zh-Hans-CN");
    });
    return list;
  }, [mention, safeLockedAssets, refsByAssetId]);

  // ---------- 暴露给父组件的 imperative API ----------
  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.focus(),
    }),
    [],
  );

  // ---------- 事件处理 ----------
  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    const el = editorRef.current;
    // 重建 tokens 列表；chip 部分保留原 token 以保住 asset 信息
    const oldTokens = tokens;
    const newTokens = [];
    for (const child of el.children) {
      const id = child.dataset.tokenId;
      if (!id) continue;
      if (child.dataset.kind === "text") {
        newTokens.push({ kind: "text", id, value: child.textContent || "" });
      } else if (child.dataset.kind === "asset") {
        const orig = oldTokens.find((t) => t.id === id);
        if (orig) newTokens.push(orig);
      }
    }
    setTokens(newTokens);

    // @ 触发检测
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const caretInfo = getCaretInTokens(el, range);
      if (caretInfo) {
        const token = newTokens.find((t) => t.id === caretInfo.tokenId);
        if (token && token.kind === "text") {
          const before = token.value.slice(0, caretInfo.offset);
          const match = /(?:^|\s)@([^\s@\[\]]*)$/.exec(before);
          if (match) {
            const rect = computeCaretRect();
            setMention({
              open: true,
              query: match[1] || "",
              anchorTokenId: caretInfo.tokenId,
              rect,
            });
            setActiveIndex(0);
            return;
          }
        }
      }
    }
    if (mention.open) setMention((m) => ({ ...m, open: false }));
  }, [tokens, mention.open]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (disabled) return;
      if (mention.open) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((i) =>
            Math.min(Math.max(0, filteredAssets.length - 1), i + 1),
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const asset = filteredAssets[activeIndex];
          if (asset) pickAsset(asset);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMention((m) => ({ ...m, open: false }));
          return;
        }
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        if (tryRemoveAdjacentChip(e)) return;
      }
    },
    [mention.open, filteredAssets, activeIndex, disabled],
  );

  const tryRemoveAdjacentChip = useCallback(
    (e) => {
      const el = editorRef.current;
      if (!el) return false;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return false;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return false;
      const caretInfo = getCaretInTokens(el, range);
      if (!caretInfo) return false;

      const idx = tokens.findIndex((t) => t.id === caretInfo.tokenId);
      if (idx === -1) return false;
      const cur = tokens[idx];
      if (!cur || cur.kind !== "text") return false;

      const isBack = e.key === "Backspace";
      const isDel = e.key === "Delete";

      if (isBack && caretInfo.offset === 0) {
        const prev = tokens[idx - 1];
        if (prev && prev.kind === "chip") {
          e.preventDefault();
          setTokens((all) => all.filter((t) => t.id !== prev.id));
          pendingCaretRef.current = { tokenId: cur.id, offset: 0 };
          return true;
        }
      }
      if (isDel && caretInfo.offset === (cur.value || "").length) {
        const next = tokens[idx + 1];
        if (next && next.kind === "chip") {
          e.preventDefault();
          setTokens((all) => all.filter((t) => t.id !== next.id));
          pendingCaretRef.current = { tokenId: cur.id, offset: (cur.value || "").length };
          return true;
        }
      }
      return false;
    },
    [tokens],
  );

  const pickAsset = useCallback(
    (asset) => {
      if (!asset) return;
      setTokens((prev) => {
        const idx = prev.findIndex((t) => t.id === mention.anchorTokenId);
        if (idx === -1) return prev;
        const cur = prev[idx];
        if (!cur || cur.kind !== "text") return prev;
        // @query 一定在 token 末尾（dropdown 只在末尾 @query 时打开）
        const query = mention.query || "";
        const expectedSuffix = `@${query}`;
        if (!cur.value.endsWith(expectedSuffix)) return prev;
        const atIdx = cur.value.length - expectedSuffix.length;
        const before = cur.value.slice(0, atIdx);
        const after = cur.value.slice(atIdx + expectedSuffix.length);
        const pictureIndex = refsByAssetId.has(asset.id)
          ? refsByAssetId.get(asset.id).pictureIndex
          : null;
        const chipId = nextTokenId();
        pendingCaretRef.current = { tokenId: chipId, offset: 0, afterChip: true };
        const newTokens = [];
        if (before) newTokens.push({ kind: "text", id: nextTokenId(), value: before });
        newTokens.push({
          kind: "chip",
          id: chipId,
          label: pictureIndex == null ? "未绑定" : `Image #${pictureIndex}`,
          name: asset.name,
          asset,
          pictureIndex,
        });
        if (after) newTokens.push({ kind: "text", id: nextTokenId(), value: after });
        return [...prev.slice(0, idx), ...newTokens, ...prev.slice(idx + 1)];
      });
      setMention({ open: false, query: "", anchorTokenId: null, rect: null });
    },
    [mention, refsByAssetId],
  );

  const handleClick = useCallback((e) => {
    const close = e.target.closest(".drama-prompt-chip__close");
    if (close) {
      const chip = close.closest("[data-token-id]");
      if (chip) {
        e.preventDefault();
        e.stopPropagation();
        setTokens((prev) => prev.filter((t) => t.id !== chip.dataset.tokenId));
        return;
      }
    }
    const thumb = e.target.closest(".drama-prompt-chip__thumb");
    if (thumb) {
      // 缩略图点击目前不弹大图（避免干扰编辑器焦点），仅 preventDefault
      e.preventDefault();
    }
  }, []);

  const handlePaste = useCallback((e) => {
    e.preventDefault();
    const cd = e.clipboardData || window.clipboardData;
    const text = (cd && cd.getData("text/plain")) || "";
    // 剥掉零宽空格等不可见字符
    const cleaned = text.split("").filter((ch) => ch.charCodeAt(0) !== 0x200B && ch.charCodeAt(0) !== 0xFEFF).join("");
    if (!cleaned) return;
    document.execCommand("insertText", false, cleaned);
  }, []);

  // ---------- 渲染 ----------
  const placeholder = "输入本镜完整视频提示词，输入 @ 引用资产";

  return (
    <>
      <div
        ref={editorRef}
        className="drama-prompt-editor__surface"
        contentEditable={disabled ? false : true}
        suppressContentEditableWarning
        spellCheck={false}
        data-disabled={disabled ? "true" : undefined}
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onPaste={handlePaste}
        onCompositionStart={() => {}}
        onCompositionEnd={handleInput}
        aria-label="视频提示词编辑器，输入 @ 引用资产"
      />
      {mention.open && mention.rect
        ? createPortal(
            <MentionDropdown
              items={filteredAssets}
              activeIndex={activeIndex}
              refsByAssetId={refsByAssetId}
              rect={mention.rect}
              onPick={pickAsset}
              onActiveChange={setActiveIndex}
            />,
            document.body,
          )
        : null}
    </>
  );
});

// ---------- 内部：下拉子组件 ----------

function MentionDropdown({ items, activeIndex, refsByAssetId, rect, onPick, onActiveChange }) {
  const listRef = useRef(null);
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(".drama-mention-dropdown__item.is-active");
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  if (typeof window === "undefined") return null;
  const left = Math.max(8, Math.min(window.innerWidth - 340, rect.left));
  const top = Math.max(8, Math.min(window.innerHeight - 320, rect.bottom + 6));
  const style = { left, top };

  return (
    <div
      ref={listRef}
      className="drama-mention-dropdown"
      style={style}
      role="listbox"
      aria-label="选择资产"
      onMouseDown={(e) => {
        // 阻止下拉被点击时编辑器失焦
        e.preventDefault();
      }}
    >
      {items.length === 0 ? (
        <div className="drama-mention-dropdown__empty">没有匹配资产</div>
      ) : (
        items.map((a, i) => {
          const ref = refsByAssetId.get(a.id);
          const bound = !!ref;
          const src = mediaUrl(a.imageStorageKey || a.imageUrl, { w: MEDIA_THUMB_WIDTH });
          return (
            <div
              key={a.id}
              className={`drama-mention-dropdown__item ${i === activeIndex ? "is-active" : ""}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => onActiveChange(i)}
              onClick={() => onPick(a)}
            >
              {src ? (
                <img src={src} alt="" />
              ) : (
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 5,
                    background: "#e8ebf0",
                    flex: "0 0 28px",
                  }}
                />
              )}
              <span className="drama-mention-dropdown__item-name">{a.name || "(未命名)"}</span>
              {bound ? (
                <span className="drama-mention-dropdown__item-bound">Image #{ref.pictureIndex}</span>
              ) : (
                <span className="drama-mention-dropdown__item-type">{a.type || "未绑定"}</span>
              )}
            </div>
          );
        })
      )}
      <div className="drama-mention-dropdown__hint">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> 选择
        </span>
        <span>
          <kbd>Enter</kbd> 插入
        </span>
        <span>
          <kbd>Esc</kbd> 关闭
        </span>
      </div>
    </div>
  );
}

// ---------- 内部：DOM 构造与 caret 工具 ----------

function buildChipElement(token) {
  const span = document.createElement("span");
  span.dataset.tokenId = token.id;
  span.dataset.kind = "asset";
  span.dataset.label = token.label;
  span.dataset.name = token.name;
  const state = token.asset ? "ok" : "broken";
  span.dataset.state = state;
  span.setAttribute("data-token-state", state);
  span.className = "drama-prompt-chip";
  span.contentEditable = "false";

  // 缩略图（contentEditable=false 的 button，浏览器不会把 caret 放进去）
  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "drama-prompt-chip__thumb";
  thumb.tabIndex = -1;
  thumb.setAttribute("aria-hidden", "true");
  if (token.asset) {
    const img = document.createElement("img");
    img.src = mediaUrl(token.asset.imageStorageKey || token.asset.imageUrl, {
      w: MEDIA_THUMB_WIDTH,
    });
    img.alt = "";
    thumb.appendChild(img);
  }
  // 阻止 thumb 上的 mousedown 让 caret 跳进 chip
  thumb.addEventListener("mousedown", (e) => e.preventDefault());
  span.appendChild(thumb);

  // label
  const label = document.createElement("span");
  label.className = "drama-prompt-chip__label";
  label.textContent = token.label;
  span.appendChild(label);

  // name
  const name = document.createElement("span");
  name.className = "drama-prompt-chip__name";
  name.textContent = token.name;
  span.appendChild(name);

  // close
  const close = document.createElement("button");
  close.type = "button";
  close.className = "drama-prompt-chip__close";
  close.setAttribute("aria-label", `移除 ${token.name}`);
  close.textContent = "×";
  close.addEventListener("mousedown", (e) => e.preventDefault());
  span.appendChild(close);

  // 阻止整个 chip 的 mousedown 让 caret 跳进去
  span.addEventListener("mousedown", (e) => {
    if (e.target === close || e.target === thumb) return; // close / thumb 自己处理
    e.preventDefault();
  });

  return span;
}

function getCaretInTokens(container, range) {
  // 找 caret 所在的最深 [data-token-id] 元素
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  const target = node && node.closest ? node.closest("[data-token-id]") : null;
  if (!target || !container.contains(target)) return null;
  const tokenId = target.dataset.tokenId;
  if (!tokenId) return null;
  if (target.dataset.kind !== "text") {
    // caret 在 chip 之后，offset 用文本末值表达「紧邻」
    return { tokenId, offset: 0 };
  }
  const textNode = target.firstChild;
  if (!textNode) return { tokenId, offset: 0 };
  // 计算 caret offset 在该 text token 内
  let offset = range.startOffset;
  if (range.startContainer === target) {
    // 整个 span 被选中的极端情况
    offset = 0;
  } else if (range.startContainer === textNode) {
    offset = range.startOffset;
  } else {
    // 在更深的子节点里（理论上不会发生，因为我们只放纯文本）
    offset = textNode.textContent ? textNode.textContent.length : 0;
  }
  return { tokenId, offset };
}

function computeCaretRect() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  // 折叠到末尾以拿到 caret 的实际坐标
  const r = range.cloneRange();
  r.collapse(true);
  const rect = r.getBoundingClientRect();
  if (rect && (rect.left || rect.top || rect.width || rect.height)) return rect;
  // 兜底：插入一个零宽 span 测坐标
  try {
    const span = document.createElement("span");
    span.textContent = "";
    r.insertNode(span);
    const out = span.getBoundingClientRect();
    span.parentNode && span.parentNode.removeChild(span);
    // 折叠 range 到原位置
    sel.removeAllRanges();
    sel.addRange(range);
    return out;
  } catch (e) {
    return null;
  }
}

