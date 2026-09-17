import test from "node:test";
import assert from "node:assert/strict";
import { textReasoningEnabled, withTextReasoning } from "../src/components/adminModelConfig.js";

test("text reasoning defaults to disabled", () => {
  assert.equal(textReasoningEnabled(undefined), false);
  assert.equal(textReasoningEnabled({}), false);
  assert.equal(withTextReasoning({}, undefined).enableThinking, false);
});

test("text reasoning preserves explicit setting", () => {
  assert.equal(textReasoningEnabled({ enableThinking: true }), true);
  assert.equal(withTextReasoning({ chatModel: "qwen" }, true).enableThinking, true);
});
