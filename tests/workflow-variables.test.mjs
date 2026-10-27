import test from "node:test";
import assert from "node:assert/strict";
import { extractVariableNames, resolveTemplate } from "../src/components/workflow/variables.js";
import * as variables from "../src/components/workflow/variables.js";
import { nodeViewModel } from "../src/components/workflow/nodeViewModel.js";

test("graph scopes resolve table -> text -> text -> generator with local precedence", () => {
  const nodes = [
    { id: "table", data: { kind: "DataTable", fields: [{ label: "place", value: "lane" }] } },
    { id: "a", data: { kind: "MarkdownNote", variables: { who: "Ada", nested: "{{who}}" }, fields: [{ label: "scene", value: "{{nested}} in {{place}}" }] } },
    { id: "b", data: { kind: "MarkdownNote", fields: [{ label: "shot", value: "Film {{scene}}" }] } },
    { id: "video", data: { kind: "VideoGenerator", media: { prompt: "{{shot}} / {{place}}", variables: { place: "beach" } } } },
  ];
  const edges = [{ source: "table", target: "a" }, { source: "a", target: "b" }, { source: "b", target: "video" }];
  const scopes = variables.graphVariableScopes?.(nodes, edges, "video") || [];
  assert.deepEqual(resolveTemplate("{{shot}} / {{place}}", scopes), { value: "Film Ada in lane / beach", missing: [], conflicts: [] });
  const view = nodeViewModel("VideoGenerator", { prompt: "{{missing}}", scopes });
  assert.deepEqual(view.missing, ["missing"]);
  assert.equal(nodeViewModel("Prompt").hasInputHandle, true);
});

test("graph-derived direct text conflicts remain visible on the receiving card", () => {
  const nodes = ["a", "b"].map((id) => ({ id, data: { kind: "MarkdownNote", fields: [{ label: "name", value: id }] } }));
  nodes.push({ id: "target", data: { kind: "MarkdownNote", fields: [{ label: "content", value: "{{name}}" }] } });
  const scopes = variables.graphVariableScopes?.(nodes, [{ source: "a", target: "target" }, { source: "b", target: "target" }], "target") || [];
  assert.deepEqual(resolveTemplate("{{name}}", scopes).conflicts, ["name"]);
});

test("variable priority uses shortest real edge distance through transparent bridges", () => {
  const nodes = ["a", "b"].map((id) => ({ id, data: { kind: "MarkdownNote", variables: { x: id.toUpperCase() }, fields: [{ label: "内容", value: id.toUpperCase() }] } }));
  nodes.push(...["bridge", "near", "far"].map((id) => ({ id, data: { kind: "Reroute" } })), { id: "video", data: { kind: "VideoGenerator", media: { prompt: "{{x}}" } } });
  const edge = (source, target) => ({ source, target });
  for (const edges of [
    [edge("b", "bridge"), edge("bridge", "video"), edge("a", "video")],
    [edge("b", "far"), edge("far", "bridge"), edge("bridge", "video"), edge("a", "near"), edge("near", "video")],
  ]) {
    assert.deepEqual(resolveTemplate("{{x}}", variables.graphVariableScopes(nodes, edges, "video")), { value: "A", missing: [], conflicts: [] });
  }
  const equallyDistant = [edge("a", "near"), edge("near", "video"), edge("b", "bridge"), edge("bridge", "video")];
  assert.deepEqual(resolveTemplate("{{x}}", variables.graphVariableScopes(nodes, equallyDistant, "video")).conflicts, ["x"]);
});

test("dangling edges cannot resolve variables through a deleted bridge", () => {
  const nodes = [
    { id: "a", data: { kind: "MarkdownNote", variables: { x: "A" }, fields: [{ label: "内容", value: "A" }] } },
    { id: "video", data: { kind: "VideoGenerator", media: { prompt: "{{x}}" } } },
  ];
  const edges = [{ source: "a", target: "deleted" }, { source: "deleted", target: "video" }];
  assert.deepEqual(resolveTemplate("{{x}}", variables.graphVariableScopes(nodes, edges, "video")), {
    value: "{{x}}", missing: ["x"], conflicts: [],
  });
});

test("extracts unique variable names in template order", () => {
  assert.deepEqual(extractVariableNames("{{角色}}在{{ 地点 }}，{{角色}}"), ["角色", "地点"]);
});

test("resolves local variables before upstream values", () => {
  assert.deepEqual(resolveTemplate("{{角色}}在{{地点}}", [
    { source: "local", values: { 角色: "阿青" } },
    { source: "upstream", values: { 角色: "路人", 地点: "雨巷" } },
  ]), { value: "阿青在雨巷", missing: [], conflicts: [] });
});

test("reports same-priority conflicts and missing names", () => {
  const result = resolveTemplate("{{角色}} / {{天气}}", [
    { source: "upstream:a", priority: 1, values: { 角色: "甲" } },
    { source: "upstream:b", priority: 1, values: { 角色: "乙" } },
  ]);
  assert.deepEqual(result.missing, ["天气"]);
  assert.deepEqual(result.conflicts, ["角色"]);
  assert.equal(result.value, "{{角色}} / {{天气}}");
});

test("uses the first scope as the default priority and ignores blank values", () => {
  assert.deepEqual(resolveTemplate("{{名字}}", [
    { values: { 名字: "  " } },
    { values: { 名字: "后备" } },
  ]), { value: "后备", missing: [], conflicts: [] });
});

test("assigns default priority from the original scope position", () => {
  assert.deepEqual(resolveTemplate("{{名字}}", [
    { values: { 名字: "  " } },
    { priority: 1, values: { 名字: "较早" } },
    { values: { 名字: "较晚" } },
  ]), { value: "较早", missing: [], conflicts: [] });
});
