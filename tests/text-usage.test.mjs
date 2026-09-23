import test from "node:test";
import assert from "node:assert/strict";
import { textUsageOperationLabel, textUsageOperations, textUsageReconciliationLabel } from "../src/lib/textUsage.js";

test("text usage operations expose the three billable drama stages", () => {
  assert.deepEqual(textUsageOperations.map((item) => item.id), ["SCRIPT_PARSE", "ASSET_ENRICH", "SHOT_DRAFT"]);
  assert.equal(textUsageOperationLabel("SCRIPT_PARSE"), "剧本分场");
  assert.equal(textUsageOperationLabel("UNKNOWN"), "UNKNOWN");
});

test("text usage reconciliation states have readable labels", () => {
  assert.equal(textUsageReconciliationLabel("MATCHED"), "已匹配");
  assert.equal(textUsageReconciliationLabel("MISSING_LEDGER"), "缺少流水");
  assert.equal(textUsageReconciliationLabel("AMOUNT_MISMATCH"), "积分不符");
});
