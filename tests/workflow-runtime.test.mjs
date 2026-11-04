import test from "node:test";
import assert from "node:assert/strict";
import * as runtime from "../src/components/workflow/runtime.js";
import { buildClipQueue } from "../src/components/workflow/timeline.js";
const { applyRunToNodes } = runtime;

test("aggregated reopen restores A then B outputs and builds the complete visible queue", async () => {
  let nodes = ["a", "b"].map((id) => ({ id, data: { kind: "VideoGenerator", media: { prompt: id } } }));
  const snapshot = { workflowId: 9, latestRunId: 12, activeRuns: [], steps: [
    { nodeId: "a", runId: 11, status: "SUCCEEDED", outputs: [{ type: "video", storageKey: "users/7/a.mp4", url: "/a.mp4" }] },
    { nodeId: "b", runId: 12, status: "SUCCEEDED", outputs: [{ type: "video", storageKey: "users/7/b.mp4", url: "/b.mp4" }] },
  ] };
  await runtime.restoreWorkflowSnapshot?.({ workflowId: 9, snapshot: async () => snapshot,
    onSnapshot: (value) => { nodes = runtime.applyWorkflowSnapshotToNodes(nodes, value); } });
  const queue = buildClipQueue(nodes, [{ source: "a", target: "edit" }, { source: "b", target: "edit" }], [], "edit");
  assert.deepEqual(queue.map((clip) => clip.storageKey), ["users/7/a.mp4", "users/7/b.mp4"]);
  assert.deepEqual(nodes.map((node) => node.data.runtime.runId), [11, 12]);
});

test("snapshot polling advances every active run and preserves completed siblings and current edits", async () => {
  let nodes = ["a", "b", "c"].map((id) => ({ id, data: { kind: "VideoGenerator", media: { prompt: id } } }));
  const complete = (id, runId) => ({ nodeId: id, runId, status: "SUCCEEDED", outputs: [{ storageKey: `users/7/${id}.mp4`, url: `/${id}.mp4` }] });
  const initial = { workflowId: 9, activeRuns: [{ id: 12, status: "RUNNING" }, { id: 13, status: "RUNNING" }],
    steps: [complete("a", 11), { nodeId: "b", runId: 12, status: "RUNNING", outputs: [] }, { nodeId: "c", runId: 13, status: "PENDING", outputs: [] }] };
  const done = { workflowId: 9, activeRuns: [], steps: [complete("a", 11), complete("b", 12), complete("c", 13)] };
  let reads = 0; const polled = []; const frames = [];
  await runtime.restoreWorkflowSnapshot?.({ workflowId: 9, snapshot: async () => reads++ ? done : initial,
    get: async (id) => { polled.push(id); }, wait: async () => { nodes[0].data.media.prompt = "edited during restore"; },
    onSnapshot: (value) => { nodes = runtime.applyWorkflowSnapshotToNodes(nodes, value); frames.push(nodes); } });
  assert.deepEqual(polled.sort(), [12, 13]);
  assert.equal(frames[0][0].data.runtime.outputs[0].storageKey, "users/7/a.mp4");
  assert.deepEqual(nodes.map((node) => node.data.runtime.status), ["SUCCEEDED", "SUCCEEDED", "SUCCEEDED"]);
  assert.equal(nodes[0].data.media.prompt, "edited during restore");
});

test("snapshot invalidation clears stale output and abort suppresses a late aggregate response", async () => {
  const nodes = [{ id: "a", data: { runtime: { outputs: [{ storageKey: "users/7/old.mp4" }] } } }];
  const snapshot = { workflowId: 9, activeRuns: [], steps: [{ nodeId: "a", status: "IDLE", outputs: [] }] };
  const restored = runtime.applyWorkflowSnapshotToNodes?.(nodes, snapshot);
  assert.deepEqual(restored?.[0].data.runtime.outputs, []);
  const controller = new AbortController(); let updates = 0;
  await runtime.restoreWorkflowSnapshot?.({ workflowId: 9, signal: controller.signal,
    snapshot: async (_id, { signal }) => { assert.equal(signal, controller.signal); controller.abort(); return snapshot; },
    onSnapshot: () => { updates++; } });
  assert.equal(updates, 0);
});

test("unsaved node retry sends only prior run identity, leaving reuse authority on the server", async () => {
  let received;
  await runtime.executeWorkflowRun({ graph: { nodes: [], edges: [] }, modelId: 2, nodeId: "v", previousRunId: 12,
    start: async (request) => { received = request; return { id: 13, status: "SUCCEEDED", steps: [] }; }, onRun: () => {} });
  assert.equal(received.previousRunId, 12);
});

test("reopen restores latest durable outputs into current nodes and resumes an active run", async () => {
  let nodes = [{ id: "v", data: { media: { prompt: "edited" } } }];
  const controller = new AbortController();
  const completed = { id: 80, status: "SUCCEEDED", steps: [{ nodeId: "v", status: "SUCCEEDED", creditCost: 18, outputs: [{ type: "video", storageKey: "users/7/v.mp4", url: "/v.mp4" }] }] };
  let polls = 0;
  const result = await runtime.restoreWorkflowRun?.({ workflowId: 9, signal: controller.signal,
    latest: async (id) => { assert.equal(id, 9); return { ...completed, status: "RUNNING" }; },
    get: async (id) => { assert.equal(id, 80); polls++; return completed; }, wait: async () => {},
    onRun: (run) => { nodes = applyRunToNodes(nodes, run); },
  });
  assert.equal(result?.status, "SUCCEEDED"); assert.equal(polls, 1);
  assert.equal(nodes[0].data.media.prompt, "edited");
  assert.equal(nodes[0].data.runtime.outputs[0].url, "/v.mp4");
  assert.equal(nodes[0].data.runtime.creditCost, 18);
});

test("reopen after completion restores playback without polling and abort suppresses late latest response", async () => {
  let updates = 0; let reads = 0;
  const complete = { id: 81, status: "SUCCEEDED", steps: [] };
  const result = await runtime.restoreWorkflowRun?.({ workflowId: 9, latest: async () => complete,
    get: async () => { reads++; }, onRun: () => { updates++; } });
  assert.equal(result?.id, 81); assert.equal(updates, 1); assert.equal(reads, 0);
  const controller = new AbortController();
  await runtime.restoreWorkflowRun?.({ workflowId: 9, signal: controller.signal,
    latest: async (_id, { signal }) => { assert.equal(signal, controller.signal); controller.abort(); return complete; },
    get: async () => { reads++; }, onRun: () => { updates++; } });
  assert.equal(updates, 1); assert.equal(reads, 0);
});

test("serialized graphs omit ephemeral runtime so a reopen cannot freeze at RUNNING", () => {
  const graph = runtime.persistableWorkflowGraph?.([{ id: "v", data: { media: { prompt: "hi", uploadedAudio: { storageKey: "users/7/a.wav", url: "blob:temporary" } }, runtime: { status: "RUNNING" } } }], []);
  assert.deepEqual(graph, { nodes: [{ id: "v", data: { media: { prompt: "hi", uploadedAudio: { storageKey: "users/7/a.wav" } } } }], edges: [] });
});

test("maps step outputs and errors into their nodes", () => {
  const result = applyRunToNodes([{ id: "v1", data: { kind: "VideoGenerator" } }], {
    id: 9,
    status: "RUNNING",
    steps: [{ nodeId: "v1", status: "RUNNING", progress: 37, outputs: [] }],
  });
  assert.equal(result[0].data.runtime.progress, 37);
  assert.equal(result[0].data.runtime.runId, 9);
});

test("maps all runtime fields without mutating nodes or unmatched nodes", () => {
  const matched = { id: "v1", data: { kind: "VideoGenerator", runtime: { old: true } } };
  const unmatched = { id: "v2", data: { kind: "VideoGenerator" } };
  const result = applyRunToNodes([matched, unmatched], {
    id: 10,
    steps: [{ nodeId: "v1", status: "FAILED", progress: 0, creditCost: 4, resolvedPrompt: "resolved", outputs: ["out"], errorMessage: "failed" }],
  });
  assert.deepEqual(result[0].data.runtime, {
    runId: 10,
    status: "FAILED",
    progress: 0,
    creditCost: 4,
    // 复用标记：命中指纹复用了历史产物时为 true（本次没真跑、没扣积分）
    reused: false,
    resolvedPrompt: "resolved",
    outputs: ["out"],
    error: "failed",
  });
  assert.notEqual(result[0], matched);
  assert.equal(result[1], unmatched);
  assert.deepEqual(matched.data.runtime, { old: true });
});

test("rejects outgoing edges from a terminal video editing node", () => {
  const nodes = [
    { id: "edit", data: { kind: "VideoEditing" } },
    { id: "video", data: { kind: "VideoGenerator" } },
  ];
  assert.equal(runtime.canConnectNodes?.(nodes, { source: "edit", target: "video" }), false);
  assert.equal(runtime.canConnectNodes?.(nodes, { source: "video", target: "edit" }), true);
});

test("polls a partial run and retains successful output beside failed and blocked steps", async () => {
  const nodes = ["good", "bad", "downstream"].map((id) => ({ id, data: { kind: "VideoGenerator" } }));
  const graph = { nodes, edges: [] };
  const saved = [];
  const started = [];
  const applied = [];
  const output = { storageKey: "users/1/good.mp4", url: "/api/media?key=users%2F1%2Fgood.mp4" };
  const initial = { id: 42, status: "RUNNING", steps: [
    { nodeId: "good", status: "SUCCEEDED", outputs: [output] },
    { nodeId: "bad", status: "RUNNING", outputs: [] },
    { nodeId: "downstream", status: "PENDING", outputs: [] },
  ] };
  const terminal = { ...initial, status: "PARTIAL_FAILED", steps: [
    initial.steps[0],
    { nodeId: "bad", status: "FAILED", errorMessage: "provider failed", outputs: [] },
    { nodeId: "downstream", status: "BLOCKED", errorMessage: "upstream failed", outputs: [] },
  ] };
  const result = await runtime.executeWorkflowRun?.({
    graph,
    workflowId: 7,
    modelId: 3,
    save: async (id, snapshot) => saved.push({ id, snapshot }),
    start: async (request) => { started.push(request); return initial; },
    get: async () => terminal,
    wait: async () => {},
    onRun: (run) => applied.push(applyRunToNodes(nodes, run)),
  });
  assert.equal(result.status, "PARTIAL_FAILED");
  assert.deepEqual(saved, [{ id: 7, snapshot: graph }]);
  assert.deepEqual(started, [{ workflowId: 7, modelId: 3, graph }]);
  assert.equal(applied.length, 2);
  assert.deepEqual(applied[1].map((node) => node.data.runtime.status), ["SUCCEEDED", "FAILED", "BLOCKED"]);
  assert.deepEqual(applied[1][0].data.runtime.outputs, [output]);
  assert.equal(applied[1][1].data.runtime.error, "provider failed");
});

test("an incomplete rerun does not discard an earlier durable output", () => {
  const previous = { storageKey: "users/1/earlier.mp4", url: "/earlier.mp4" };
  const [node] = applyRunToNodes([{ id: "video", data: { kind: "VideoGenerator", runtime: { status: "SUCCEEDED", outputs: [previous] } } }], {
    id: 43,
    status: "RUNNING",
    steps: [{ nodeId: "video", status: "SUBMITTING", outputs: [] }],
  });
  assert.equal(node.data.runtime.status, "SUBMITTING");
  assert.deepEqual(node.data.runtime.outputs, [previous]);
});

test("a prompt edit made after run start survives a later poll update", async () => {
  let currentNodes = [{ id: "video", data: { kind: "VideoGenerator", media: { prompt: "original" } } }];
  const setNodes = (update) => { currentNodes = update(currentNodes); };
  let polls = 0;
  await runtime.executeWorkflowRun({
    graph: { nodes: currentNodes, edges: [] },
    modelId: 3,
    start: async () => ({ id: 44, status: "RUNNING", steps: [{ nodeId: "video", status: "RUNNING", progress: 10, outputs: [] }] }),
    wait: async () => { currentNodes = currentNodes.map((node) => ({ ...node, data: { ...node.data, media: { prompt: "edited while running" } } })); },
    get: async () => { polls += 1; return { id: 44, status: "SUCCEEDED", steps: [{ nodeId: "video", status: "SUCCEEDED", outputs: [{ storageKey: "users/1/clip.mp4" }] }] }; },
    onRun: (run) => runtime.applyRunToCurrentNodes?.(setNodes, run),
  });
  assert.equal(polls, 1);
  assert.equal(currentNodes[0].data.media.prompt, "edited while running");
  assert.equal(currentNodes[0].data.runtime.status, "SUCCEEDED");
});

test("aborting during the poll delay prevents another read or node update", async () => {
  const controller = new AbortController();
  let reads = 0;
  let updates = 0;
  const result = await runtime.executeWorkflowRun({
    graph: { nodes: [{ id: "video", data: { kind: "VideoGenerator" } }], edges: [] },
    modelId: 3,
    signal: controller.signal,
    start: async () => ({ id: 45, status: "RUNNING", steps: [] }),
    wait: async () => { controller.abort(); },
    get: async () => { reads += 1; return { id: 45, status: "SUCCEEDED", steps: [] }; },
    onRun: () => { updates += 1; },
  });
  assert.equal(result, null);
  assert.equal(reads, 0);
  assert.equal(updates, 1);
});

test("aborting an in-flight poll cancels its request without another node update", async () => {
  const controller = new AbortController();
  let enteredGet;
  const getStarted = new Promise((resolve) => { enteredGet = resolve; });
  let cancellationObserved = false;
  let updates = 0;
  const pending = runtime.executeWorkflowRun({
    graph: { nodes: [{ id: "video", data: { kind: "VideoGenerator" } }], edges: [] },
    modelId: 3,
    signal: controller.signal,
    start: async () => ({ id: 46, status: "RUNNING", steps: [] }),
    wait: async () => {},
    get: (_id, options) => {
      enteredGet();
      const signal = options?.signal;
      assert.equal(signal, controller.signal);
      return new Promise((_, reject) => signal.addEventListener("abort", () => {
        cancellationObserved = true;
        reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
      }, { once: true }));
    },
    onRun: () => { updates += 1; },
  });
  await getStarted;
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(cancellationObserved, true);
  assert.equal(updates, 1);
});
