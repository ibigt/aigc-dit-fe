import test from "node:test";
import assert from "node:assert/strict";
import { toLedgerRows, resolveLedgerPager } from "../src/lib/creditLedger.js";

test("ledger rows expose balance after each change", () => {
  const rows = toLedgerRows([
    { id: 1, changeAmt: 500, balanceAfter: 1500, title: "充值到账" },
    { id: 2, changeAmt: -30, balanceAfter: 1470, remark: "生成扣费" },
    { id: 3, changeAmt: 30, remark: "生成失败退还" },
  ]);
  assert.equal(rows[0].balance, 1500);
  assert.equal(rows[0].title, "充值到账");
  assert.equal(rows[1].title, "生成扣费");
  assert.equal(rows[2].balance, null);
  assert.equal(rows[2].type, "charge");
});

test("ledger rows fall back to remark title and deduct type", () => {
  const rows = toLedgerRows([{ id: 9, changeAmt: -50, balanceAfter: 950, reason: "GENERATE" }]);
  assert.equal(rows[0].title, undefined);
  assert.equal(rows[0].type, "deduct");
  assert.equal(rows[0].value, -50);
});

test("ledger pager falls back to page size when pages missing", () => {
  assert.deepEqual(resolveLedgerPager({ totalNum: 120, pageSize: 50, pages: 3 }), { totalNum: 120, pageSize: 50, pages: 3 });
  assert.deepEqual(resolveLedgerPager({ totalNum: 120, pageSize: 50 }), { totalNum: 120, pageSize: 50, pages: 3 });
  assert.deepEqual(resolveLedgerPager({}), { totalNum: 0, pageSize: 50, pages: 1 });
});
