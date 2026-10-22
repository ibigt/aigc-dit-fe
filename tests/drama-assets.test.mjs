import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeEpisodeAssets, siblingAssets } from "../src/lib/dramaAssets.js";

test("mergeEpisodeAssets unions chapters and keeps one card per type and name", () => {
  const merged = mergeEpisodeAssets([
    [
      { id: 1, type: "角色", name: "阿沅" },
      { id: 2, type: "角色", name: "谢珩" },
    ],
    [
      { id: 3, type: "角色", name: "谢珩" },
    ],
    [
      { id: 4, type: "角色", name: "老渡翁" },
      { id: 5, type: "角色", name: "谢珩" },
      { id: 6, type: "道具", name: "谢珩" },
    ],
  ]);
  assert.deepEqual(merged.map((item) => item.id), [1, 2, 4, 6]);
});

test("mergeEpisodeAssets prefers the copy that already has an image", () => {
  const merged = mergeEpisodeAssets([
    [{ id: 1, type: "角色", name: "谢珩" }],
    [{ id: 8, type: "角色", name: "谢珩", imageUrl: "/api/media?key=a.png" }],
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 8);
});

test("mergeEpisodeAssets keeps the earlier id when nothing else differs", () => {
  const merged = mergeEpisodeAssets([
    [{ id: 9, type: "场景", name: "渡亭" }],
    [{ id: 4, type: "场景", name: "渡亭" }],
  ]);
  assert.equal(merged[0].id, 4);
});

test("siblingAssets finds the same name across chapters", () => {
  const all = [
    { id: 1, type: "角色", name: "谢珩" },
    { id: 2, type: "角色", name: "阿沅" },
    { id: 3, type: "角色", name: " 谢珩 " },
  ];
  assert.deepEqual(siblingAssets(all[0], all).map((item) => item.id), [1, 3]);
});
