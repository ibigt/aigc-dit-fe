export function sameAsset(a, b) {
  if (!a || !b) return false;
  if (a.storageKey && b.storageKey) return a.storageKey === b.storageKey;
  if (a.id != null && b.id != null) return String(a.id) === String(b.id);
  const left = a.url || a.src;
  const right = b.url || b.src;
  return Boolean(left && right && left === right);
}

export function assetSelectionAtLimit(selectedItems, asset, maxSelection) {
  const limit = Number(maxSelection);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  if ((selectedItems || []).some((item) => sameAsset(item, asset))) return false;
  return (selectedItems || []).length >= limit;
}
