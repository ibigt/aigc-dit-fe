/** 积分明细行视图模型：结余、业务标题与收支类型的统一回退，供积分中心弹窗渲染。 */
export function toLedgerRows(items = [], { formatTime } = {}) {
  return (items || []).map((item) => ({
    id: item.id,
    title: item.title || item.remark,
    time: typeof formatTime === "function" ? formatTime(item.createdAt) : item.createdAt,
    value: item.changeAmt,
    balance: item.balanceAfter ?? null,
    type: item.type || (item.changeAmt > 0 ? "charge" : "deduct"),
  }));
}

/** 分页信息归一：补齐缺失的 pages/totalNum，保证弹窗翻页可用。 */
export function resolveLedgerPager(data = {}, fallbackPageSize = 50) {
  const totalNum = Math.max(0, Number(data.totalNum ?? 0));
  const pageSize = Math.max(1, Number(data.pageSize || fallbackPageSize));
  const pages = Math.max(1, Number(data.pages || Math.ceil(totalNum / pageSize) || 1));
  return { totalNum, pageSize, pages };
}
