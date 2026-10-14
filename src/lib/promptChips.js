/**
 * 分镜视频提示词 chip 解析与序列化（纯函数）。
 *
 * 存储约定：chip 以字面文本形式保存在 promptOverride 中。
 *   - 已绑定资产: `[Image #1] 资产名`（N = pictureIndex）
 *   - 未绑定资产: `[未绑定] 资产名`
 *
 * 解析正则 `/\[(Image #\d+|未绑定)\] (.+?)(?=\s\[|$)/g` 全局匹配；
 * 资产按 name 严格匹配 lockedAssets 还原缩略图与 binding 状态。
 */

// chip 名不允许含 `[`；look-ahead 要求下一字符是「文本词」（空格+非`[`）、
// 下一 chip（可选空格+`[`）或字符串末尾，从而把 `[Image #1] 澹白 中的淡化 [未绑定] 夜灯`
// 正确切成两个独立 chip。
export const CHIP_RE = /\[(Image #\d+|未绑定)\] ([^\[]+?)(?=\s+\S|\s*\[|$)/g;

let _tokenId = 0;
export function nextTokenId() {
  _tokenId += 1;
  return `t${_tokenId}`;
}

export function parsePromptToTokens(value, { lockedAssets = [], refsByAssetId = new Map() } = {}) {
  const text = value == null ? "" : String(value);
  if (!text) {
    return [{ kind: "text", id: nextTokenId(), value: "" }];
  }
  const assetByName = new Map(
    (lockedAssets || [])
      .map((a) => [a && a.name, a])
      .filter(([n, a]) => n && a),
  );
  const tokens = [];
  let lastIndex = 0;
  // 必须用局部副本避免 RegExp 共享 lastIndex 的坑
  const re = new RegExp(CHIP_RE.source, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ kind: "text", id: nextTokenId(), value: text.slice(lastIndex, m.index) });
    }
    const label = m[1];
    const name = m[2];
    const asset = assetByName.get(name) || null;
    let pictureIndex = null;
    if (asset && refsByAssetId.has(asset.id)) {
      pictureIndex = refsByAssetId.get(asset.id).pictureIndex;
    } else if (label.startsWith("Image #")) {
      const n = Number(label.slice(7));
      if (Number.isFinite(n) && n > 0) pictureIndex = n;
    }
    tokens.push({
      kind: "chip",
      id: nextTokenId(),
      label,
      name,
      asset,
      pictureIndex,
    });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: "text", id: nextTokenId(), value: text.slice(lastIndex) });
  }
  if (!tokens.length) {
    tokens.push({ kind: "text", id: nextTokenId(), value: "" });
  }
  return tokens;
}

export function serializeTokensToPrompt(tokens) {
  if (!tokens) return "";
  return tokens
    .map((t) => {
      if (t.kind === "text") return t.value || "";
      return `[${t.label}] ${t.name}`;
    })
    .join("");
}

export function plainTextLength(tokens) {
  if (!tokens) return 0;
  return tokens.reduce(
    (sum, t) => sum + (t.kind === "text" ? (t.value || "").length : 0),
    0,
  );
}
