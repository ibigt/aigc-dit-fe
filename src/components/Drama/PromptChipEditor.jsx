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
 * DOM ↔ token 模型约定：
 *   - text token 渲染成 `<span data-token-id data-kind="text">`
 *   - chip 渲染成 contentEditable=false 的 `<span data-kind="asset">`
 *   - 浏览器在空表面输入 / 回车时会塞进裸文本节点、`<br>`、`<div>` 段落，
 *     domToTokens 把这些「无主节点」收编成 text token，否则它们对状态不可见，
 *     下一次结构重建会被整段清掉（表现为输入内容凭空消失）。
 *   - @ 触发不要求前面是空格（中文提示词里没有空格），只要光标前的文本
 *     以 `@xxx` 结尾即可；选中后按光标位置切分，光标后的文字保留。
 *
 * 纯函数（parse/serialize/nextTokenId）在 lib/promptChips.js，这里只放组件与 DOM 操作。
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
  const composingRef = useRef(false);

  const [mention, setMention] = useState({
    open: false,
    query: "",
    anchorTokenId: null,
    atIdx: null,
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

    // 唯一的空文本 token 不渲染任何节点：让表面真正 :empty，占位符才能显示，
    // 也避免空 <span> 无法承载光标（浏览器转而把输入塞成裸文本节点）。
    const isEmpty = tokens.length === 1 && tokens[0].kind === "text" && !(tokens[0].value || "");
    const rendered = isEmpty ? [] : tokens;

    const currentIds = Array.from(el.children).map((c) => c.dataset.tokenId);
    const nextIds = rendered.map((t) => t.id);
    const sameStructure =
      currentIds.length === nextIds.length && currentIds.every((id, i) => id === nextIds[i]);

    if (!sameStructure) {
      // 重建：用 firstChild 循环清空，保留 scrollTop
      while (el.firstChild) el.removeChild(el.firstChild);
      for (const t of rendered) {
        if (t.kind === "text") {
          const span = document.createElement("span");
          span.dataset.tokenId = t.id;
          span.dataset.kind = "text";
          renderTextIntoSpan(span, t.value || "");
          el.appendChild(span);
        } else {
          el.appendChild(buildChipElement(t));
        }
      }
    } else {
      // 结构不变：仅更新内容 / 标签
      for (let i = 0; i < rendered.length; i += 1) {
        const t = rendered[i];
        const child = el.children[i];
        if (!child) continue;
        if (t.kind === "text") {
          // 文本节点里的裸 \n（execCommand 粘贴产生）也要归一化成 <br>
          const hasRawNl = Array.from(child.childNodes).some(
            (c) => c.nodeType === Node.TEXT_NODE && (c.textContent || "").indexOf("\n") !== -1,
          );
          if (hasRawNl || readSpanValue(child) !== (t.value || "")) {
            renderTextIntoSpan(child, t.value || "");
          } else {
            syncSpanDom(child, t.value || "");
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
          // br 感知的光标落点：换行后的位置要落在 <br> 边界/文本段里，
          // Chrome 才不会把输入规范化回上一行
          const pos = setCaretInSpan(target, offset);
          if (pos.childIndex != null) {
            const kids = target.childNodes;
            range.setStart(target, Math.min(Math.max(0, pos.childIndex), kids.length));
          } else {
            const len = pos.node.nodeType === Node.TEXT_NODE ? (pos.node.textContent || "").length : 0;
            range.setStart(pos.node, Math.min(Math.max(0, pos.offset), len));
          }
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
    if (composingRef.current) return;
    const el = editorRef.current;
    if (!el) return;
    // 重建 tokens 列表；chip 部分保留原 token 以保住 asset 信息；
    // 浏览器产生的裸文本节点 / <br> / <div> 一并收编成 text token。
    const domTokens = domToTokens(el, tokens);
    const adopted = domTokens.some(
      (t) => t.kind === "text" && !(t.node && t.node.nodeType === 1 && t.node.dataset.tokenId === t.id),
    );
    const caret = caretToToken(el, domTokens);
    // 收编无主节点 / 光标所在 span 里有裸 \n → 子节点会重建，锚定 caret 防止跳丢
    const caretNeedsRebuild =
      caret &&
      caret.token.kind === "text" &&
      caret.token.node &&
      Array.from(caret.token.node.childNodes).some(
        (c) => c.nodeType === Node.TEXT_NODE && (c.textContent || "").indexOf("\n") !== -1,
      );
    if ((adopted || caretNeedsRebuild) && caret) {
      pendingCaretRef.current = { tokenId: caret.token.id, offset: caret.offset };
    }
    setTokens(domTokens.map(({ node, ...t }) => t));

    // @ 触发检测：光标前文本以 @xxx 结尾即可（不要求 @ 前是空格，中文没有空格）
    if (caret && caret.token.kind === "text") {
      const before = (caret.token.value || "").slice(0, caret.offset);
      const match = /@([^\s@\[\]]*)$/.exec(before);
      if (match) {
        const rect = computeCaretRect();
        setMention({
          open: true,
          query: match[1] || "",
          anchorTokenId: caret.token.id,
          atIdx: match.index,
          rect,
        });
        setActiveIndex(0);
        return;
      }
    }
    if (mention.open) setMention((m) => ({ ...m, open: false }));
  }, [tokens, mention.open]);

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
        const query = mention.query || "";
        const text = cur.value || "";
        // @ 的位置以下拉打开时的 atIdx 为准（光标后可能还有文字，不能假设 @ 在 token 末尾）
        const atIdx = Number.isInteger(mention.atIdx) ? mention.atIdx : text.length - query.length - 1;
        if (atIdx < 0 || text.slice(atIdx, atIdx + 1 + query.length) !== `@${query}`) return prev;
        const before = text.slice(0, atIdx);
        const after = text.slice(atIdx + 1 + query.length);
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
      setMention({ open: false, query: "", anchorTokenId: null, atIdx: null, rect: null });
    },
    [mention, refsByAssetId],
  );

  // 在光标处插入换行（直接改 token 状态；execCommand 的 \n 行为各浏览器不一致，
  // 且浏览器自作主张插入 <div>/<br> 会脱离 token 管理）
  const insertNewline = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const domTokens = domToTokens(el, tokens);
    const caret = caretToToken(el, domTokens);
    if (!caret || caret.token.kind !== "text") return;
    const value = caret.token.value || "";
    const off = Math.max(0, Math.min(caret.offset, value.length));
    const id = caret.token.id;
    const next = value.slice(0, off) + "\n" + value.slice(off);
    pendingCaretRef.current = { tokenId: id, offset: off + 1 };
    setTokens(
      domTokens.map(({ node, ...t }) =>
        t.id === id && t.kind === "text" ? { ...t, value: next } : t,
      ),
    );
  }, [tokens]);

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
      if (e.key === "Enter") {
        e.preventDefault();
        insertNewline();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        if (tryRemoveAdjacentChip(e)) return;
      }
    },
    [mention.open, filteredAssets, activeIndex, disabled, pickAsset, tryRemoveAdjacentChip, insertNewline],
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
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          handleInput();
        }}
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

/**
 * 文本 token 的换行渲染约定：值里的 "\n" 渲染成 <br>（不是文本里的裸 \n）。
 * 纯文本 \n 配合 pre-wrap 虽能显示换行，但 Chrome 不认「紧跟 \n 之后」的光标位，
 * 输入会被规范化回换行前（字符跑到上一行行尾）；<br> 是真实节点边界，
 * 换行后的位置才能作为插入点。
 */

/** 读回 span 的 token 值：<br> 记为 "\n"，伪 br 跳过，其余取文本。 */
function readSpanValue(span) {
  let out = "";
  for (const child of span.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent || "";
    else if (child.tagName === "BR" && !(child.dataset && child.dataset.bogus)) out += "\n";
    else out += child.textContent || "";
  }
  return out;
}

/**
 * 尾随换行的双 br 约定：值以 "\n" 结尾时，真实 br 后面再补一个 data-bogus 的伪 br。
 * Chrome 把「单个尾随 br 之后」当作非法插入点（输入会被规范化回上一行），
 * 伪 br 给换行后的空行提供一个真实的光标落点；读写/折算偏移时一律跳过它。
 * 值不再以 "\n" 结尾（用户在空行输入了内容）时由 syncSpanDom 移除。
 */
function syncSpanDom(span, value) {
  const last = span.lastChild;
  const hasBogus = !!(last && last.tagName === "BR" && last.dataset && last.dataset.bogus);
  const wantBogus = String(value == null ? "" : value).endsWith("\n");
  if (hasBogus && !wantBogus) last.remove();
  else if (!hasBogus && wantBogus) {
    const b = document.createElement("br");
    b.dataset.bogus = "1";
    span.appendChild(b);
  }
}

/** 按 value 重建 span 的子节点（文本段 + <br>，尾随换行补伪 br）。 */
function renderTextIntoSpan(span, value) {
  while (span.firstChild) span.removeChild(span.firstChild);
  const segments = String(value == null ? "" : value).split("\n");
  for (let i = 0; i < segments.length; i += 1) {
    if (i > 0) span.appendChild(document.createElement("br"));
    if (segments[i]) span.appendChild(document.createTextNode(segments[i]));
  }
  syncSpanDom(span, value);
}

/** 把 span 内的光标位置（startContainer 可能是文本子节点或 span 自身）折算成 token 值内偏移。 */
function caretOffsetInSpan(span, startContainer, startOffset) {
  const weight = (c) => {
    if (c.nodeType === Node.TEXT_NODE) return (c.textContent || "").length;
    if (c.tagName === "BR") return c.dataset && c.dataset.bogus ? 0 : 1;
    return (c.textContent || "").length;
  };
  if (startContainer === span) {
    // offset 是子节点序号：折算成「第 offset 个子节点之前」的值偏移
    let v = 0;
    const kids = span.childNodes;
    for (let i = 0; i < startOffset && i < kids.length; i += 1) v += weight(kids[i]);
    return v;
  }
  let acc = 0;
  for (const child of span.childNodes) {
    if (child === startContainer) {
      return acc + startOffset;
    }
    acc += weight(child);
  }
  return null;
}

/** 按 token 值内偏移把光标放进 span：返回 {node,offset}（文本节点内）
 *  或 {node,childIndex}（span 上、第 childIndex 个子节点之前）。 */
function setCaretInSpan(span, offset) {
  let o = Math.max(0, offset);
  const kids = Array.from(span.childNodes);
  for (let i = 0; i < kids.length; i += 1) {
    const child = kids[i];
    if (child.nodeType === Node.TEXT_NODE) {
      const len = (child.textContent || "").length;
      if (o <= len) return { node: child, offset: o };
      o -= len;
    } else if (child.tagName === "BR") {
      if (child.dataset && child.dataset.bogus) continue; // 伪 br 不占值
      if (o === 0) return { node: span, childIndex: i };
      o -= 1;
    }
  }
  const last = kids[kids.length - 1];
  if (last && last.nodeType === Node.TEXT_NODE) {
    return { node: last, offset: (last.textContent || "").length };
  }
  return { node: span, childIndex: Math.max(0, kids.length - 1) };
}


/**
 * 把 contentEditable 的 DOM 子节点转成 token 列表。
 * - `<span data-token-id data-kind="text">` → 保留原 id 的 text token
 * - chip（data-kind="asset"）→ 保留原 token（含 asset 信息）
 * - 裸文本节点 / <br> / <div>（浏览器在空表面输入或回车时产生）→ 新 id 的 text token
 * 每个 token 附带 `node` 指向来源 DOM 节点，供 caret 映射使用（进 state 前剥离）。
 */
function domToTokens(el, oldTokens) {
  const out = [];
  const adopt = (v, node) => out.push({ kind: "text", id: nextTokenId(), value: v, node });
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const v = child.textContent || "";
      if (v) adopt(v, child);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const id = child.dataset ? child.dataset.tokenId : null;
      if (id && child.dataset.kind === "text") {
        out.push({ kind: "text", id, value: readSpanValue(child), node: child });
      } else if (id && child.dataset.kind === "asset") {
        const orig = oldTokens.find((t) => t.id === id);
        if (orig) out.push({ ...orig });
      } else if (child.tagName === "BR") {
        adopt("\n", child);
      } else {
        // 回车产生的 <div> 段落等：段落边界补换行，其余取文本
        const inner = child.textContent || "";
        adopt(out.length && inner ? "\n" + inner : inner, child);
      }
    }
  }
  if (!out.length) out.push({ kind: "text", id: nextTokenId(), value: "" });
  return out;
}

/** 把当前 selection 映射到 domToTokens 产出的 token（返回 token 引用 + token 内偏移）。 */
function caretToToken(el, domTokens) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;
  const node = range.startContainer;
  if (node === el) {
    // caret 落在容器上：offset 是子节点序号，近似映射到该位置 token 的端点
    const idx = Math.max(0, Math.min(domTokens.length - 1, range.startOffset));
    const t = domTokens[idx];
    return t ? { token: t, offset: range.startOffset === 0 ? 0 : (t.value || "").length } : null;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    // 光标通常在 span 内部的文本节点里，而 token 锚点是 span 元素本身
    const t =
      domTokens.find((x) => x.node === node) ||
      domTokens.find((x) => x.node && x.node.contains(node)) ||
      domTokens.find((x) => x.node && x.node.contains(node.parentNode));
    if (t) {
      if (t.node === node) return { token: t, offset: range.startOffset };
      return { token: t, offset: caretOffsetInSpan(t.node, node, range.startOffset) ?? 0 };
    }
    return null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const t = domTokens.find((x) => x.node === node);
    if (t) {
      // 光标落在 span 自身（br 边界等）：startOffset 是子节点序号
      const off = caretOffsetInSpan(node, node, range.startOffset);
      if (off != null) return { token: t, offset: off };
      return { token: t, offset: (t.value || "").length };
    }
  }
  return null;
}

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
  // 计算 caret offset 在该 text token 内（br 感知）
  let offset = caretOffsetInSpan(target, range.startContainer, range.startOffset);
  if (offset == null) {
    offset = range.startContainer === target ? 0 : readSpanValue(target).length;
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
