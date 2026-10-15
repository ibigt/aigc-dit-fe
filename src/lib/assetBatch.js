// 批量删除素材的纯工具，便于在测试中独立验证。
// 调用方传入已选中的资产列表与一个真正执行删除的函数（通常是 deleteAsset(id)），
// 返回按顺序汇总的结果：成功集合、失败项（id + 错误信息）、整体完成状态。

export async function runBatchDelete(items, performDelete, { concurrency = 5 } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return { succeeded: [], failed: [], allSucceeded: true };
  }
  const queue = items.map((item, index) => ({ item, index }));
  const succeeded = [];
  const failed = [];
  const limit = Math.max(1, Math.min(concurrency, queue.length));
  const workers = Array.from({ length: limit }, () => (async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const { item } = next;
      try {
        await performDelete(item.id);
        succeeded.push(item);
      } catch (error) {
        failed.push({
          id: item.id,
          name: item.name || item.title,
          error: error?.message || "删除失败",
        });
      }
    }
  })());
  await Promise.all(workers);
  const order = new Map(items.map((item, index) => [item.id, index]));
  succeeded.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  failed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { succeeded, failed, allSucceeded: failed.length === 0 };
}

// 把素材元数据（宽高 / 时长）格式化为人类可读字符串。
// 探测失败的字段返回 null，由 UI 自行决定是否回退隐藏。
export function formatMediaMeta(asset) {
  if (!asset) return { size: null, duration: null, durationMs: null, format: null };
  const size = (Number.isFinite(asset.width) && Number.isFinite(asset.height))
      ? `${asset.width} × ${asset.height}`
      : null;
  const ms = Number.isFinite(asset.durationMs) ? asset.durationMs : null;
  const duration = ms == null ? null : formatDurationLabel(ms);
  const format = (typeof asset.format === "string" && asset.format.trim()) ? asset.format.trim().toUpperCase() : null;
  return { size, duration, durationMs: ms, format };
}

function formatDurationLabel(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0
      ? `${minutes}:${String(seconds).padStart(2, "0")}`
      : `${seconds}s`;
}
