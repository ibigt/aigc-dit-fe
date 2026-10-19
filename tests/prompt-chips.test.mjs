import test from "node:test";
import assert from "node:assert/strict";
import {
  caretInDialogue,
  narrativeMentionCount,
  parsePromptToTokens,
  plainTextLength,
  referenceIdsOf,
  serializeTokensToPrompt,
  stripMentionMarks,
} from "../src/lib/promptChips.js";

const lockedAssets = [
  { id: 1, name: "澹白", type: "角色", imageStorageKey: "users/1/a.png" },
  { id: 2, name: "幻梦侦探社", type: "场景", imageStorageKey: "users/2/b.png" },
  { id: 3, name: "夜灯", type: "道具", imageStorageKey: "users/3/c.png" },
  { id: 4, name: "澹白", type: "角色", imageStorageKey: "users/4/d.png" },
];

test("parses narrative mentions and leaves dialogue names plain", () => {
  const text = "场景：@幻梦侦探社\n镜头1：景别：中景。 动作：@澹白推门。 台词：@澹白：我来了。";
  const tokens = parsePromptToTokens(text, { lockedAssets, referenceAssetIds: [2, 1] });
  const chips = tokens.filter((token) => token.kind === "chip");
  assert.deepEqual(chips.map((token) => token.name), ["幻梦侦探社", "澹白"]);
  assert.deepEqual(chips.map((token) => token.assetId), [2, 1]);
  assert.equal(chips.filter((token) => token.name === "澹白").length, 1);
  assert.equal(serializeTokensToPrompt(tokens), "场景：@幻梦侦探社\n镜头1：景别：中景。 动作：@澹白推门。 台词：@澹白：我来了。");
});

test("duplicate narrative mentions share one reference id in first-seen order", () => {
  const tokens = parsePromptToTokens("动作：@澹白看见@夜灯，@澹白回头。", {
    lockedAssets,
    referenceAssetIds: [4, 3],
  });
  assert.deepEqual(referenceIdsOf(tokens), [4, 3]);
  assert.equal(narrativeMentionCount("动作：@澹白看见@夜灯，@澹白回头。", lockedAssets), 2);
  assert.equal(serializeTokensToPrompt(tokens), "动作：@澹白看见@夜灯，@澹白回头。");
});

test("unknown mention stays a chip without an asset", () => {
  const tokens = parsePromptToTokens("动作：@已删除角色回头。", { lockedAssets });
  const chip = tokens.find((token) => token.kind === "chip");
  assert.equal(chip.name, "已删除角色回头");
  assert.equal(chip.asset, null);
  assert.equal(chip.assetId, null);
});

test("weaves speech after 说 and still chips props in the action", () => {
  const text = "场景：@幻梦侦探社\n@澹白 拿起@夜灯，说：夜灯还亮着。";
  const tokens = parsePromptToTokens(text, { lockedAssets, referenceAssetIds: [2, 1, 3] });
  const chips = tokens.filter((token) => token.kind === "chip");
  assert.deepEqual(chips.map((token) => token.name), ["幻梦侦探社", "澹白", "夜灯"]);
  assert.equal(caretInDialogue(text, text.indexOf("夜灯还亮着")), true);
  assert.equal(caretInDialogue(text, text.indexOf("@夜灯")), false);
  assert.equal(serializeTokensToPrompt(tokens), text);
});

test("说：后的引号外侧可以引用资产，引号内保持台词", () => {
  const text = "@局长 推门走进，说：“张老弟，别睡了。”@澹白 坐下";
  const tokens = parsePromptToTokens(text, { lockedAssets, referenceAssetIds: [1, 4] });
  const chips = tokens.filter((token) => token.kind === "chip");
  assert.deepEqual(chips.map((token) => token.name), ["局长", "澹白"]);
  assert.equal(caretInDialogue(text, text.indexOf("张老弟")), true);
  assert.equal(caretInDialogue(text, text.indexOf("“")), false);
  assert.equal(caretInDialogue(text, text.indexOf("”")), true);
  assert.equal(caretInDialogue(text, text.indexOf("”") + 1), false);
  assert.equal(caretInDialogue(text, text.indexOf("@澹白")), false);
  assert.equal(serializeTokensToPrompt(tokens), text);
});

test("没有收尾引号时，说：仍收到换行，下一行可以引用", () => {
  const text = "说：“别睡了。\n@澹白 坐下";
  const tokens = parsePromptToTokens(text, { lockedAssets });
  assert.equal(tokens.some((token) => token.kind === "chip" && token.name === "澹白"), true);
  assert.equal(caretInDialogue(text, text.indexOf("别睡了")), true);
  assert.equal(caretInDialogue(text, text.indexOf("@澹白")), false);
});

test("旁白不加引号，整行都算台词", () => {
  const text = "旁白：夜色已深。@澹白";
  assert.equal(caretInDialogue(text, text.indexOf("@澹白")), true);
  const tokens = parsePromptToTokens(text, { lockedAssets });
  assert.equal(tokens.some((token) => token.kind === "chip"), false);
});

test("caret inside a dialogue clause does not count as narrative", () => {
  const text = "动作：@澹白回头。\n台词：澹白：我来了。";
  const dialogueAt = text.indexOf("我来了");
  assert.equal(caretInDialogue(text, dialogueAt), true);
  assert.equal(caretInDialogue(text, text.indexOf("@")), false);
});

test("empty input yields one empty text token", () => {
  for (const value of ["", null, undefined]) {
    const tokens = parsePromptToTokens(value, { lockedAssets });
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "text");
    assert.equal(tokens[0].value, "");
  }
});

test("plainTextLength ignores chips", () => {
  const tokens = parsePromptToTokens("动作：@澹白回头。", { lockedAssets });
  assert.equal(plainTextLength(tokens), "动作：回头。".length);
});

test("stripMentionMarks keeps the name", () => {
  assert.equal(stripMentionMarks("@澹白：我来了。"), "澹白：我来了。");
});
