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

export function createRechargeOrder(payload) {
  return api.post("/credits/recharge/orders", payload);
}

export function fetchRechargeOrder(orderNo) {
  return api.get(`/credits/recharge/orders/${orderNo}`);
}

export function mockPayRechargeOrder(orderNo) {
  return api.post(`/credits/recharge/orders/${orderNo}/mock-pay`);
}
