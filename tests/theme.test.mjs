import test from "node:test";
import assert from "node:assert/strict";
import { resolveConsoleTheme } from "../src/lib/theme.js";

test("stored theme wins over system preference", () => {
  assert.equal(resolveConsoleTheme("light", true), "light");
  assert.equal(resolveConsoleTheme("dark", false), "dark");
});

test("theme follows system when user has no preference", () => {
  assert.equal(resolveConsoleTheme(null, true), "dark");
  assert.equal(resolveConsoleTheme(null, false), "light");
});
