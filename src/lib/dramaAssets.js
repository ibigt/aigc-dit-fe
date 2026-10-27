/**
 * 资产身份与角色族聚合。
 * 迁移后角色 name 为族名（洛白），版本靠 stateTag / versionLabel 区分；
 * 旧数据名里可能仍带「·后缀」，聚合时用 baseNameOf 归一。
 */

export function baseNameOf(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  const dot = trimmed.indexOf("·") >= 0 ? trimmed.indexOf("·") : trimmed.indexOf("・");
  if (dot <= 0) return trimmed;
  return trimmed.slice(0, dot).trim();
}

export function versionLabelOf(asset) {
  if (!asset) return "基础";
  const label = typeof asset.versionLabel === "string" ? asset.versionLabel.trim() : "";
  if (label) return label;
  const stateLabel = typeof asset.stateLabel === "string" ? asset.stateLabel.trim() : "";
  if (stateLabel) return stateLabel;
  const tag = typeof asset.stateTag === "string" && asset.stateTag.trim() ? asset.stateTag.trim() : "base";
  if (tag === "base") return "基础";
  const fallback = { dream: "入梦", costume: "换装", wet: "湿身", custom: "特殊" };
  return fallback[tag] || tag;
}

export function isBaseAsset(asset) {
  if (!asset) return true;
  const tag = typeof asset.stateTag === "string" ? asset.stateTag.trim() : "";
  // 非 base slug → 延伸版（分镜 lockedAssets 也曾缺 versionLabel，不能只靠展示名）。
  if (tag && tag !== "base") return false;
  const explicit = typeof asset.versionLabel === "string" ? asset.versionLabel.trim() : "";
  const legacy = typeof asset.stateLabel === "string" ? asset.stateLabel.trim() : "";
  if (explicit && explicit !== "基础") return false;
  if (legacy && legacy !== "基础") return false;
  return true;
}

export function isStateAsset(asset) {
  return !isBaseAsset(asset);
}

/** 分镜 @ 引用名：优先后端 mentionName；否则按族名 + 版本标签拼。 */
export function mentionNameOf(asset) {
  if (!asset) return "";
  const mention = typeof asset.mentionName === "string" ? asset.mentionName.trim() : "";
  if (mention) return mention;
  const family = baseNameOf(asset.name);
  if (!family) return "";
  if (isBaseAsset(asset)) return family;
  const label = versionLabelOf(asset);
  if (!label || label === "基础") return family;
  return `${family}·${label}`;
}

/** 跨章节合并时的唯一键：类型 + 族名 + 版本 slug。 */
export function assetIdentityKey(asset) {
  const type = typeof asset?.type === "string" ? asset.type.trim() : "";
  const name = baseNameOf(asset?.name);
  const tag = typeof asset?.stateTag === "string" && asset.stateTag.trim()
    ? asset.stateTag.trim()
    : "base";
  if (!type || !name) return "";
  return `${type}\0${name}\0${tag}`;
}

/** 角色族聚合键：类型 + 族名。 */
export function familyKey(asset) {
  const type = typeof asset?.type === "string" ? asset.type.trim() : "";
  const name = baseNameOf(asset?.name);
  if (!type || !name) return "";
  return `${type}\0${name}`;
}

function assetRank(asset) {
  let rank = 0;
  if (asset?.imageStorageKey || asset?.imageUrl || asset?.imageAssetId) rank += 100;
  if (asset?.generating || asset?.genTaskId) rank += 80;
  if (typeof asset?.identityInvariants === "string" && asset.identityInvariants.trim()) rank += 10;
  if (asset?.status === "已锁定") rank += 5;
  return rank;
}

/** 分数更高的留下；同分留更早创建的那条，避免卡片来回跳。 */
function preferAsset(candidate, current) {
  const diff = assetRank(candidate) - assetRank(current);
  if (diff !== 0) return diff > 0;
  return Number(candidate?.id) < Number(current?.id);
}

/**
 * 把各章资产合成一份。同类型同名同版本只保留一条，先出现的章节决定顺序。
 */
export function mergeEpisodeAssets(groups) {
  const best = new Map();
  for (const group of groups || []) {
    for (const asset of group || []) {
      const key = assetIdentityKey(asset);
      if (!key) continue;
      const current = best.get(key);
      if (!current || preferAsset(asset, current)) best.set(key, asset);
    }
  }
  return [...best.values()];
}

/** 各章里与这条同身份键的记录。没有其它章时返回自身。 */
export function siblingAssets(asset, all) {
  const key = assetIdentityKey(asset);
  if (!key) return asset ? [asset] : [];
  const matches = (all || []).filter((item) => assetIdentityKey(item) === key);
  return matches.length ? matches : [asset];
}

/** 同族全部版本（含基础），基础版置顶。 */
export function familyVersions(asset, all) {
  const key = familyKey(asset);
  if (!key) return asset ? [asset] : [];
  const list = (all || []).filter((item) => familyKey(item) === key);
  list.sort((left, right) => {
    const leftBase = isBaseAsset(left) ? 0 : 1;
    const rightBase = isBaseAsset(right) ? 0 : 1;
    if (leftBase !== rightBase) return leftBase - rightBase;
    return Number(left?.id) - Number(right?.id);
  });
  return list.length ? list : [asset];
}

/**
 * 按角色族聚合成卡。场景/道具一人一卡不变。
 * @returns {{ asset: object, versions: object[] }[]}
 */
export function groupAssetCards(assets, type) {
  const items = (assets || []).filter((item) => item?.type === type);
  if (type !== "角色") {
    return items.map((asset) => ({ asset, versions: [asset] }));
  }
  const order = [];
  const map = new Map();
  for (const item of items) {
    const key = familyKey(item);
    if (!key) continue;
    let card = map.get(key);
    if (!card) {
      card = { asset: null, versions: [] };
      map.set(key, card);
      order.push(card);
    }
    card.versions.push(item);
  }
  for (const card of order) {
    card.versions.sort((left, right) => {
      const leftBase = isBaseAsset(left) ? 0 : 1;
      const rightBase = isBaseAsset(right) ? 0 : 1;
      if (leftBase !== rightBase) return leftBase - rightBase;
      return Number(left?.id) - Number(right?.id);
    });
    card.asset = card.versions.find((item) => isBaseAsset(item)) || card.versions[0];
  }
  return order;
}

/** 角色族列表（@ 第一窗）：每族一项，展示基础版或代表图。 */
export function characterFamilies(assets) {
  const cards = groupAssetCards(assets, "角色");
  return cards.map((card) => {
    const base = card.versions.find((item) => isBaseAsset(item)) || card.versions[0];
    const withImage = card.versions.find((item) => item?.imageStorageKey || item?.imageUrl) || base;
    return {
      ...base,
      imageStorageKey: withImage?.imageStorageKey || base?.imageStorageKey,
      imageUrl: withImage?.imageUrl || base?.imageUrl,
      versionCount: card.versions.length,
      versions: card.versions,
      familyName: baseNameOf(base?.name),
    };
  });
}
