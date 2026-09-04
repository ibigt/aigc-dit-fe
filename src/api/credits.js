import { api } from "./client.js";

export function fetchCreditSummary() {
  return api.get("/credits/summary");
}

export function fetchCreditLedger(params = {}) {
  return api.get("/credits/ledger", { params: { pageNum: 1, pageSize: 50, ...params } });
}

export function rechargeCredits(payload) {
  return api.post("/credits/recharge", payload);
}
