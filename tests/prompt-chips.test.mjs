import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePromptToTokens,
  serializeTokensToPrompt,
  plainTextLength,
} from "../src/lib/promptChips.js";

const lockedAssets = [
  { id: 1, name: "澹白", type: "角色", imageStorageKey: "users/1/a.png" },
  { id: 2, name: "幻梦侦探社·主干全貌_白天", type: "场景", imageStorageKey: "users/2/b.png" },
  { id: 3, name: "夜灯", type: "道具", imageStorageKey: "users/3/c.png" },
];
const refsByAssetId = new Map([
  [1, { assetId: 1, pictureIndex: 1 }],
  [3, { assetId: 3, pictureIndex: 2 }],
]);

test("parses bound and unbound chips with text in between", () => {
  const tokens = parsePromptToTokens(
    "按 [Image #1] 澹白 中的淡化作背景，参考 [未绑定] 幻梦侦探社·主干全貌_白天 的场景。",
    { lockedAssets, refsByAssetId },
  );
  // text / chip / text / chip / text
  assert.equal(tokens.length, 5);
  assert.equal(tokens[0].kind, "text");
  assert.equal(tokens[0].value, "按 ");
  assert.equal(tokens[1].kind, "chip");
  assert.equal(tokens[1].label, "Image #1");
  assert.equal(tokens[1].name, "澹白");
  assert.equal(tokens[1].pictureIndex, 1);
  assert.equal(tokens[1].asset && tokens[1].asset.id, 1);
  assert.equal(tokens[2].kind, "text");
  assert.equal(tokens[2].value, " 中的淡化作背景，参考 ");
  assert.equal(tokens[3].kind, "chip");
  assert.equal(tokens[3].label, "未绑定");
  assert.equal(tokens[3].name, "幻梦侦探社·主干全貌_白天");
  assert.equal(tokens[3].pictureIndex, null);
  assert.equal(tokens[3].asset && tokens[3].asset.id, 2);
  assert.equal(tokens[4].kind, "text");
  assert.equal(tokens[4].value, " 的场景。");
});

test("mark missing asset as broken chip with preserved label", () => {
  const tokens = parsePromptToTokens("前 [Image #1] 已删除角色 后", {
    lockedAssets: [],
    refsByAssetId: new Map(),
  });
  assert.equal(tokens.length, 3);
  assert.equal(tokens[1].kind, "chip");
  assert.equal(tokens[1].asset, null);
  assert.equal(tokens[1].pictureIndex, 1); // 保留字面 N
  assert.equal(tokens[1].name, "已删除角色");
});

test("serialize is inverse of parse for well-formed input", () => {
  const input = "[Image #1] 澹白 中的淡化 [Image #2] 夜灯 结尾";
  const tokens = parsePromptToTokens(input, { lockedAssets, refsByAssetId });
  const out = serializeTokensToPrompt(tokens);
  assert.equal(out, input);
});

test("empty / null / undefined input yields a single empty text token", () => {
  for (const v of ["", null, undefined]) {
    const tokens = parsePromptToTokens(v, { lockedAssets, refsByAssetId });
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].kind, "text");
    assert.equal(tokens[0].value, "");
  }
});

test("plainTextLength counts only text tokens", () => {
  const tokens = parsePromptToTokens("abc [Image #1] 澹白 def", { lockedAssets, refsByAssetId });
  // "abc " = 4, " def" = 4, total 8
  assert.equal(plainTextLength(tokens), 8);
});

test("asset names with [ are truncated at the first [ (documented limitation)", () => {
  // 名称中含 [ 的资产无法作为完整 chip 名称：正则 `[^\[]+?` 在遇到 [ 时停止。
  // 资产名不应包含 [。这里只确认解析不会抛错且剩余文本被正确接住。
  const tokens = parsePromptToTokens("[Image #1] 名字[带]方括号 [Image #2] 夜灯", {
    lockedAssets: [...lockedAssets, { id: 99, name: "名字[带]方括号", type: "道具" }],
    refsByAssetId: new Map(),
  });
  // 第一个 chip 名字被截到 "名字"；后续 "[带]方括号 " 作为 text；最后是完整 chip
  assert.equal(tokens.length, 3);
  assert.equal(tokens[0].name, "名字");
  assert.equal(tokens[0].asset, null); // "名字" 不在 lockedAssets（资产名带 [] 的被截断）
  assert.equal(tokens[1].kind, "text");
  assert.equal(tokens[1].value, "[带]方括号 ");
  assert.equal(tokens[2].kind, "chip");
  assert.equal(tokens[2].name, "夜灯");
});
