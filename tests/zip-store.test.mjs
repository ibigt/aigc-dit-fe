import assert from "node:assert/strict";
import test from "node:test";
import { crc32, zipStore } from "../src/lib/zipStore.js";

test("crc32 matches the ZIP polynomial for a short payload", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("zipStore writes a stored entry that still contains the original bytes", async () => {
  const payload = new TextEncoder().encode("作品");
  const blob = zipStore([{ name: "封面.png", data: payload }], new Date("2026-09-23T08:00:00Z"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /封面\.png/);
  assert.match(text, /作品/);
});
