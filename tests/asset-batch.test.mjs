import { test } from "node:test";
import assert from "node:assert/strict";
import { runBatchDelete, formatMediaMeta } from "../src/lib/assetBatch.js";

test("runBatchDelete returns empty summary when no items", async () => {
  const result = await runBatchDelete([], async () => undefined);
  assert.deepEqual(result, { succeeded: [], failed: [], allSucceeded: true });
});

test("runBatchDelete collects failures with original name", async () => {
  const items = [
    { id: 1, name: "a" },
    { id: 2, name: "b" },
    { id: 3, name: "c" },
  ];
  const result = await runBatchDelete(items, async (id) => {
    if (id === 2) {
      throw new Error("boom");
    }
  });
  assert.equal(result.succeeded.length, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].id, 2);
  assert.equal(result.failed[0].name, "b");
  assert.equal(result.failed[0].error, "boom");
  assert.equal(result.allSucceeded, false);
});

test("runBatchDelete keeps succeeded order matching input", async () => {
  const items = [
    { id: "x", name: "x" },
    { id: "y", name: "y" },
    { id: "z", name: "z" },
  ];
  const result = await runBatchDelete(items, async (id) => {
    await new Promise((r) => setTimeout(r, id === "y" ? 5 : 1));
  });
  assert.deepEqual(result.succeeded.map((item) => item.id), ["x", "y", "z"]);
  assert.equal(result.allSucceeded, true);
});

test("formatMediaMeta combines size and duration", () => {
  assert.deepEqual(
    formatMediaMeta({ width: 1920, height: 1080, durationMs: 65000 }),
    { size: "1920 × 1080", duration: "1:05" },
  );
  assert.deepEqual(
    formatMediaMeta({ width: 800, height: 600 }),
    { size: "800 × 600", duration: null },
  );
  assert.deepEqual(
    formatMediaMeta({ durationMs: 5000 }),
    { size: null, duration: "5s" },
  );
  assert.deepEqual(formatMediaMeta(null), { size: null, duration: null });
});
