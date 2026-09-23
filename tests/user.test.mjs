import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUser } from "../src/lib/user.js";

test("normalizes server admin flag and credit balance", () => {
  const user = normalizeUser({ name: "Admin", admin: true, creditBalance: 123 });
  assert.equal(user.isAdmin, true);
  assert.equal(user.credits, 123);
});

test("does not infer admin permission from display text", () => {
  const user = normalizeUser({ name: "admin", roleLabel: "平台管理员", creditBalance: 0 });
  assert.equal(user.isAdmin, false);
});
