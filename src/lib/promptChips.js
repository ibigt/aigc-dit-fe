/**
 * 分镜核心正文的 @ 引用解析。
 *
 * 存储约定：叙述里的资产写成 `@名字` 或 `@名字·版本标签`（语法 A）。
 * 裸 `@洛白` → 基础版；`@洛白·湿身` → 精确版本。台词段不解析成芯片。
 * 缩略图只在编辑器里显示，不写回正文。
 */

import { characterFamilies, mentionNameOf, versionLabelOf } from "./dramaAssets.js";

const LABEL_RE = /(站位|镜头\d+|景别|动作|接续|台词|场景|运镜|环境声)\s*[:：]/g;
const LEGACY_SPEECH_RE = /说\s*[:：]|旁白\s*[:：]|（画外音）\s*[:：]/g;

let _tokenId = 0;
export function nextTokenId() {
  _tokenId += 1;
  return `t${_tokenId}`;
}

function isDelimiter(char) {
  return /[\s，。；、：:（）()@<>！？,.!?;\n\r]/.test(char);
}

function knownNames(lockedAssets) {
  const names = [];
  const seen = new Set();
  for (const asset of lockedAssets || []) {
    const name = mentionNameOf(asset) || String(asset?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  names.sort((left, right) => right.length - left.length);
  return names;
}

/** @ 第一窗：角色按族去重；场景/道具仍逐条。 */
export function mentionPickerItems(lockedAssets, category, query) {
  const q = (query || "").toLowerCase();
  if (category === "角色") {
    return characterFamilies(lockedAssets).filter((item) => {
      if (!q) return true;
      return (item.familyName || item.name || "").toLowerCase().includes(q);
    });
  }
  return (lockedAssets || [])
    .filter((asset) => (asset.type || "角色") === category)
    .filter((asset) => {
      if (!q) return true;
      return (mentionNameOf(asset) || asset.name || "").toLowerCase().includes(q);
    })
    .sort((left, right) => (left.name || "").localeCompare(right.name || "", "zh-Hans-CN"));
}

export function versionPickerItems(familyAsset) {
  const versions = familyAsset?.versions || [familyAsset].filter(Boolean);
  return versions.map((asset) => {
    const mention = mentionNameOf(asset);
    const label = versionLabelOf(asset);
    return {
      asset,
      label: label || "基础",
      mentionName: mention || asset?.name || "",
    };
  });
}

function labelSpans(source) {
  const labels = [];
  const re = new RegExp(LABEL_RE.source, "g");
  let match;
  while ((match = re.exec(source)) !== null) {
    labels.push({ start: match.index, end: match.index + match[0].length, name: match[1] });
  }
  if (!labels.length) return [{ dialogue: false, start: 0, end: source.length }];
  const spans = [];
  let cursor = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (label.start > cursor) spans.push({ dialogue: false, start: cursor, end: label.start });
    const contentEnd = i + 1 < labels.length ? labels[i + 1].start : source.length;
    spans.push({ dialogue: label.name === "台词", start: label.start, end: contentEnd });
    cursor = contentEnd;
  }
  if (cursor < source.length) spans.push({ dialogue: false, start: cursor, end: source.length });
  return spans;
}

function lineLimit(body, from) {
  const lineEnd = body.indexOf("\n", from);
  return lineEnd < 0 ? body.length : lineEnd;
}

function colonBeforeQuote(body, from) {
  for (let i = from; i < body.length; i += 1) {
    const value = body.charAt(i);
    if (value !== "：" && value !== ":") continue;
    let openAt = i + 1;
    while (openAt < body.length && (body.charAt(openAt) === " " || body.charAt(openAt) === "\t")) openAt += 1;
    const open = body.charAt(openAt);
    if (open === "“" || open === "\"") return { colon: i, openAt, open };
  }
  return null;
}

function nextSpeechHit(body, from) {
  const legacyRe = new RegExp(LEGACY_SPEECH_RE.source, "g");
  legacyRe.lastIndex = from;
  const legacy = legacyRe.exec(body);
  const colon = colonBeforeQuote(body, from);
  if (legacy && (!colon || legacy.index <= colon.colon)) {
    const marker = legacy[0];
    const offScreen = marker.startsWith("旁白") || marker.includes("画外音");
    const speechStart = legacy.index + marker.length;
    const limit = lineLimit(body, speechStart);
    if (offScreen) {
      return {
        markerStart: legacy.index,
        quoteOpen: -1,
        contentStart: speechStart,
        contentEnd: limit,
        resume: limit,
      };
    }
    let openAt = speechStart;
    while (openAt < limit && (body.charAt(openAt) === " " || body.charAt(openAt) === "\t")) openAt += 1;
    const open = body.charAt(openAt);
    if (open === "“" || open === "\"") {
      return quoteSpeechHit(body, legacy.index, openAt, limit);
    }
    return {
      markerStart: legacy.index,
      quoteOpen: -1,
      contentStart: speechStart,
      contentEnd: limit,
      resume: limit,
    };
  }
  if (!colon) return null;
  const limit = lineLimit(body, colon.colon);
  return quoteSpeechHit(body, colon.colon, colon.openAt, limit);
}

function quoteSpeechHit(body, markerStart, openAt, limit) {
  const open = body.charAt(openAt);
  const closeChar = open === "“" ? "”" : "\"";
  const close = body.indexOf(closeChar, openAt + 1);
  if (close < 0 || close > limit) {
    return {
      markerStart,
      quoteOpen: openAt,
      contentStart: openAt + 1,
      contentEnd: limit,
      resume: limit,
    };
  }
  return {
    markerStart,
    quoteOpen: openAt,
    contentStart: openAt + 1,
    contentEnd: close,
    resume: close + 1,
  };
}

function speechHits(body) {
  const hits = [];
  let from = 0;
  while (from < body.length) {
    const hit = nextSpeechHit(body, from);
    if (!hit) break;
    hits.push(hit);
    const next = Math.max(hit.resume, hit.markerStart + 1);
    if (next <= from) break;
    from = next;
  }
  return hits;
}

function splitSay(source, start, end) {
  const body = source.slice(start, end);
  const hits = speechHits(body);
  if (!hits.length) return [{ dialogue: false, start, end }];
  const spans = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.contentStart > cursor) {
      spans.push({ dialogue: false, start: start + cursor, end: start + hit.contentStart });
    }
    if (hit.contentEnd > hit.contentStart) {
      spans.push({ dialogue: true, start: start + hit.contentStart, end: start + hit.contentEnd });
    }
    cursor = hit.contentEnd;
  }
  if (cursor < body.length) spans.push({ dialogue: false, start: start + cursor, end });
  return spans;
}

/** 编辑器暖色底的区间。引号和引号里的字一起上色；旧的无引号口播从冒号后涂到行尾。 */
export function speechHighlightRanges(text) {
  const source = text == null ? "" : String(text);
  const ranges = [];
  for (const span of labelSpans(source)) {
    if (span.dialogue) continue;
    const body = source.slice(span.start, span.end);
    for (const hit of speechHits(body)) {
      const paintStart = hit.quoteOpen >= 0 ? hit.quoteOpen : hit.contentStart;
      const paintEnd = hit.quoteOpen >= 0 ? hit.resume : hit.contentEnd;
      if (paintEnd > paintStart) {
        ranges.push({ start: span.start + paintStart, end: span.start + paintEnd });
      }
    }
  }
  return ranges;
}

function spansOf(text) {
  const source = text == null ? "" : String(text);
  const spans = [];
  for (const span of labelSpans(source)) {
    if (span.dialogue) spans.push(span);
    else spans.push(...splitSay(source, span.start, span.end));
  }
  return spans.length ? spans : [{ dialogue: false, start: 0, end: source.length }];
}

export function caretInDialogue(text, offset) {
  const at = Math.max(0, offset || 0);
  return spansOf(text).some((span) => span.dialogue && at >= span.start && at <= span.end);
}

function readMention(text, index, names) {
  if (text.charAt(index) !== "@") return null;
  const rest = text.slice(index + 1);
  for (const name of names) {
    if (rest.startsWith(name)) return { name, length: name.length + 1 };
  }
  let end = 0;
  while (end < rest.length && !isDelimiter(rest.charAt(end))) end += 1;
  if (!end) return null;
  return { name: rest.slice(0, end), length: end + 1 };
}

function takeAsset(name, assets, idQueue, assigned) {
  const matches = (assets || []).filter((asset) => {
    if (!asset) return false;
    const mention = mentionNameOf(asset);
    if (mention === name) return true;
    // 兼容旧数据：库内 name 仍是「洛白·湿身」
    return asset.name === name;
  });
  if (!matches.length) return null;
  while (idQueue.length) {
    const id = idQueue[0];
    const hit = matches.find((asset) => asset.id === id);
    if (hit) {
      idQueue.shift();
      assigned.set(name, hit);
      return hit;
    }
    const other = (assets || []).find((asset) => asset && asset.id === id);
    if (other && mentionNameOf(other) !== name && other.name !== name) break;
    idQueue.shift();
  }
  if (assigned.has(name)) return assigned.get(name);
  const first = matches[0];
  assigned.set(name, first);
  return first;
}

export function parsePromptToTokens(value, { lockedAssets = [], referenceAssetIds = [] } = {}) {
  const text = value == null ? "" : String(value);
  if (!text) return [{ kind: "text", id: nextTokenId(), value: "" }];
  const names = knownNames(lockedAssets);
  const idQueue = [...(referenceAssetIds || [])];
  const assigned = new Map();
  const tokens = [];
  const pushText = (chunk) => {
    if (!chunk) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === "text") last.value += chunk;
    else tokens.push({ kind: "text", id: nextTokenId(), value: chunk });
  };
  for (const span of spansOf(text)) {
    const body = text.slice(span.start, span.end);
    if (span.dialogue) {
      pushText(body);
      continue;
    }
    let index = 0;
    while (index < body.length) {
      if (body.charAt(index) !== "@") {
        const nextAt = body.indexOf("@", index);
        const end = nextAt < 0 ? body.length : nextAt;
        pushText(body.slice(index, end));
        index = end;
        continue;
      }
      const mention = readMention(body, index, names);
      if (!mention) {
        pushText("@");
        index += 1;
        continue;
      }
      const asset = takeAsset(mention.name, lockedAssets, idQueue, assigned);
      tokens.push({
        kind: "chip",
        id: nextTokenId(),
        name: mention.name,
        assetId: asset?.id ?? null,
        asset: asset || null,
      });
      // name 即 mention 串（@ 后正文），序列化仍写 @name
      index += mention.length;
    }
  }
  if (!tokens.length) tokens.push({ kind: "text", id: nextTokenId(), value: "" });
  return tokens;
}

export function serializeTokensToPrompt(tokens) {
  if (!tokens) return "";
  return tokens
    .map((token) => (token.kind === "text" ? token.value || "" : `@${token.name || ""}`))
    .join("");
}

export function referenceIdsOf(tokens) {
  const ids = [];
  const seen = new Set();
  for (const token of tokens || []) {
    if (token.kind !== "chip" || token.assetId == null || seen.has(token.assetId)) continue;
    seen.add(token.assetId);
    ids.push(token.assetId);
  }
  return ids;
}

export function narrativeMentionCount(text, lockedAssets = []) {
  const tokens = parsePromptToTokens(text, { lockedAssets });
  const seen = new Set();
  let count = 0;
  for (const token of tokens) {
    if (token.kind !== "chip") continue;
    const key = token.assetId != null ? `id:${token.assetId}` : `name:${token.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

export function plainTextLength(tokens) {
  if (!tokens) return 0;
  return tokens.reduce((sum, token) => sum + (token.kind === "text" ? (token.value || "").length : 0), 0);
}

export function stripMentionMarks(text) {
  return String(text == null ? "" : text).replace(/@(?=\S)/g, "");
}
