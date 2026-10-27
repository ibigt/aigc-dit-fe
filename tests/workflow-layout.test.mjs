import test from "node:test";
import assert from "node:assert/strict";
import { nodeLayoutSize, placeQuickNode } from "../src/components/workflow/layout.js";

const preferred = { x: 360, y: 280 };

function overlaps(a, b, padding = 32) {
  const aSize = a.visualSize || nodeLayoutSize(a);
  const bSize = b.visualSize || nodeLayoutSize(b);
  return a.position.x < b.position.x + bSize.width + padding
    && a.position.x + aSize.width + padding > b.position.x
    && a.position.y < b.position.y + bSize.height + padding
    && a.position.y + aSize.height + padding > b.position.y;
}

test("the first quick-add card stays at the requested canvas point", () => {
  const node = { position: { x: 0, y: 0 }, style: { width: 270 }, data: { kind: "MarkdownNote" } };
  assert.deepEqual(placeQuickNode(preferred, [], node), preferred);
});

test("repeated quick-add cards with mixed sizes never overlap", () => {
  const nodes = [];
  const cards = [
    { kind: "MarkdownNote", styleWidth: 270, visualSize: { width: 286, height: 260 } },
    { kind: "VideoGenerator", styleWidth: 356, visualSize: { width: 356, height: 600 } },
    { kind: "AudioGenerator", styleWidth: 382, visualSize: { width: 382, height: 560 } },
    { kind: "VideoEditing", styleWidth: 382, visualSize: { width: 382, height: 390 } },
  ];
  for (const { kind, styleWidth, visualSize } of [...cards, cards[0], cards[1]]) {
    const node = { position: preferred, style: { width: styleWidth }, data: { kind }, visualSize };
    node.position = placeQuickNode(preferred, nodes, node);
    for (const existing of nodes) assert.equal(overlaps(node, existing), false, `${kind} overlapped ${existing.data.kind}`);
    nodes.push(node);
  }
});

test("quick-add placement is deterministic and respects measured dimensions", () => {
  const existing = [{ position: preferred, style: { width: 100 }, measured: { width: 500, height: 550 }, data: { kind: "MarkdownNote" } }];
  const node = { style: { width: 382 }, data: { kind: "VideoEditing" } };
  assert.deepEqual(nodeLayoutSize(existing[0]), { width: 500, height: 550 });
  const first = placeQuickNode(preferred, existing, node);
  assert.deepEqual(placeQuickNode(preferred, existing, node), first);
  assert.equal(overlaps({ ...node, position: first }, existing[0]), false);
});
