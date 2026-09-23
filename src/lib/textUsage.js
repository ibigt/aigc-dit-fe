export const textUsageOperations = [
  { id: "SCRIPT_PARSE", label: "剧本分场" },
  { id: "ASSET_ENRICH", label: "素材增强" },
  { id: "SHOT_DRAFT", label: "分镜草稿" },
];

export function textUsageOperationLabel(value) {
  return textUsageOperations.find((item) => item.id === value)?.label || value || "--";
}

export function textUsageReconciliationLabel(value) {
  if (value === "MATCHED") return "已匹配";
  if (value === "MISSING_LEDGER") return "缺少流水";
  if (value === "AMOUNT_MISMATCH") return "积分不符";
  return value || "--";
}
