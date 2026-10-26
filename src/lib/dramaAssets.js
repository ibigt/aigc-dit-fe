/**
 * 资产页按类型和名称视为同一条，不按章节拆开。
 * 状态在名字里（「洛白·湿身」），所以名字相同就是同一条，不再单看状态标签。
 */
export function assetIdentityKey(asset) {
  const type = typeof asset?.type === "string" ? asset.type.trim() : "";
  const name = typeof asset?.name === "string" ? asset.name.trim() : "";
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
 * 把各章资产合成一份。同类型同名只保留一条，先出现的章节决定顺序。
 * groups 是按章节排列的资产数组。
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

/** 各章里与这条同类型同名的记录。没有其它章时返回自身。 */
export function siblingAssets(asset, all) {
  const key = assetIdentityKey(asset);
  if (!key) return asset ? [asset] : [];
  const matches = (all || []).filter((item) => assetIdentityKey(item) === key);
  return matches.length ? matches : [asset];
}
