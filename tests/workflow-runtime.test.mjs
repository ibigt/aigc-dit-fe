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

test("IDLE 快照不再抹掉节点已有的持久产物（导入/模板视频丢失回归）", () => {
  const carried = { storageKey: "users/1/outputs/2452/1.mp4", url: "/api/media?key=2452" };
  const nodes = [{ id: "a", data: { runtime: { status: "SUCCEEDED", reused: true, outputs: [carried] } } }];
  const restored = runtime.applyWorkflowSnapshotToNodes(nodes, {
    workflowId: 9, activeRuns: [], steps: [{ nodeId: "a", status: "IDLE", outputs: [] }],
  });
  // 快照没有带来任何新信息，水合出来的 SUCCEEDED 状态与产物必须原样保住
  assert.deepEqual(restored[0].data.runtime.outputs, [carried]);
  assert.equal(restored[0].data.runtime.status, "SUCCEEDED");
  assert.equal(restored[0].data.runtime.reused, true);
  assert.deepEqual(nodes[0].data.runtime.outputs, [carried], "不改原节点");
});

test("清空产物只发生在节点本来就没有产物时", () => {
  const nodes = [{ id: "a", data: { runtime: { status: "RUNNING", progress: 40 } } }];
  const restored = runtime.applyWorkflowSnapshotToNodes(nodes, {
    workflowId: 9, activeRuns: [], steps: [{ nodeId: "a", status: "IDLE", outputs: [] }],
  });
  assert.equal(restored[0].data.runtime.status, "IDLE");
  assert.deepEqual(restored[0].data.runtime.outputs, []);
});

test("导入工作流只跑过配音：其它节点的视频/图片产物不被 IDLE 步骤抹掉", () => {
  const video = { storageKey: "users/1/outputs/2452/1.mp4" };
  const image = { storageKey: "users/1/outputs/2449/1.png" };
  const nodes = [
    { id: "image", data: { kind: "ImageGenerator", runtime: { status: "SUCCEEDED", outputs: [image] } } },
    { id: "video", data: { kind: "VideoGenerator", runtime: { status: "SUCCEEDED", outputs: [video] } } },
    { id: "audio", data: { kind: "AudioGenerator" } },
    { id: "edit", data: { kind: "VideoEditing" } },
  ];
  // 后端 snapshotMine：只要有任何运行历史，就给全图节点发 IDLE；只有配音有历史产物
  const snapshot = { workflowId: 81, activeRuns: [], steps: [
    { nodeId: "image", status: "IDLE", outputs: [] },
    { nodeId: "video", status: "IDLE", outputs: [] },
    { nodeId: "audio", runId: 128, status: "SUCCEEDED", outputs: [{ type: "audio", storageKey: "users/1/outputs/2559/1.mp3" }] },
    { nodeId: "edit", status: "IDLE", outputs: [] },
  ] };
  const restored = runtime.applyWorkflowSnapshotToNodes(nodes, snapshot);
  assert.deepEqual(restored[0].data.runtime.outputs, [image]);
  assert.deepEqual(restored[1].data.runtime.outputs, [video]);
  assert.equal(restored[1].data.runtime.status, "SUCCEEDED");
  assert.equal(restored[2].data.runtime.outputs[0].storageKey, "users/1/outputs/2559/1.mp3");
  assert.equal(restored[2].data.runtime.runId, 128);
  assert.equal(restored[3].data.runtime.status, "IDLE");
});

test("新一轮产物刷新会覆盖节点携带的旧产物", () => {
  const old = { storageKey: "users/1/outputs/2452/1.mp4" };
  const fresh = { storageKey: "users/1/outputs/2600/1.mp4" };
  const nodes = [{ id: "v", data: { runtime: { status: "SUCCEEDED", outputs: [old] } } }];
  const restored = runtime.applyWorkflowSnapshotToNodes(nodes, {
    workflowId: 9, activeRuns: [], steps: [{ nodeId: "v", status: "SUCCEEDED", outputs: [fresh] }],
  });
  assert.deepEqual(restored[0].data.runtime.outputs, [fresh]);
});

test("运行中的空产物步骤刷新状态但保住持久产物", () => {
  const carried = { storageKey: "users/1/outputs/2453/1.mp4" };
  const nodes = [{ id: "v", data: { runtime: { status: "SUCCEEDED", outputs: [carried] } } }];
  const restored = runtime.applyWorkflowSnapshotToNodes(nodes, {
    workflowId: 9, activeRuns: [{ id: 12, status: "RUNNING" }],
    steps: [{ nodeId: "v", status: "RUNNING", progress: 42, outputs: [] }],
  });
  assert.equal(restored[0].data.runtime.status, "RUNNING");
  assert.equal(restored[0].data.runtime.progress, 42);
  assert.deepEqual(restored[0].data.runtime.outputs, [carried]);
});

test("abort suppresses a late aggregate response", async () => {
  const snapshot = { workflowId: 9, activeRuns: [], steps: [{ nodeId: "a", status: "IDLE", outputs: [] }] };
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

test("run mode forwards forceRegenerate for whole-graph and single-node runs, omits it in reuse mode", async () => {
  const seen = [];
  const run = (extra) => runtime.executeWorkflowRun({
    graph: { nodes: [], edges: [] }, modelId: 2, ...extra,
    start: async (request) => { seen.push(request); return { id: 1, status: "SUCCEEDED", steps: [] }; },
    onRun: () => {},
  });
  await run({});
  await run({ forceRegenerate: true });
  await run({ nodeId: "v", forceRegenerate: true }); // 节点卡片「生成」按钮（4.6.2）
  assert.equal(seen[0].forceRegenerate, undefined, "reuse 模式不带字段，后端按缺省 false 处理");
  assert.equal(seen[1].forceRegenerate, true);
  assert.equal(seen[2].nodeId, "v");
  assert.equal(seen[2].forceRegenerate, true, "单节点运行同样要能强制重跑上游");
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

test("persistableWorkflowGraph 把产物迁到节点级 outputs（storageKey-only，供导入工作流回显）", () => {
  const graph = runtime.persistableWorkflowGraph?.([
    { id: "a", data: { kind: "VideoGenerator", runtime: { status: "SUCCEEDED", runId: 7, outputs: [
      { storageKey: "users/1/outputs/7/1.mp4", url: "https://expiring/x.mp4", posterUrl: "https://expiring/p.jpg" },
    ] } } },
    { id: "b", data: { kind: "Prompt" } },
  ], []);
  // runtime 仍被剥离，产物以 storageKey 形式落到节点顶层 outputs
  assert.equal(graph.nodes[0].data.runtime, undefined);
  assert.equal(graph.nodes[0].outputs.length, 1);
  assert.equal(graph.nodes[0].outputs[0].storageKey, "users/1/outputs/7/1.mp4");
  assert.equal(graph.nodes[0].outputs[0].url, undefined, "不带会过期的 token URL");
  assert.ok(!JSON.stringify(graph).includes("expiring"));
  assert.equal(graph.nodes[1].outputs, undefined, "无产物节点不写 outputs");
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

test("isWorkStep 与后端 workSteps 同口径：排除 TEXT/ASSET/禁用节点", () => {
  const node = (kind, data = {}) => ({ id: kind, data: { kind, ...data } });

  assert.equal(runtime.isWorkStep(node("ImageGenerator")), true);
  assert.equal(runtime.isWorkStep(node("VideoGenerator")), true);
  assert.equal(runtime.isWorkStep(node("VideoEditing")), true);
  assert.equal(runtime.isWorkStep(node("AudioGenerator")), true, "配音朗读是 GENERATE，计入分母");
  assert.equal(runtime.isWorkStep(node("MarkdownNote")), false, "文本节点是 TEXT，零成本直通");
  assert.equal(runtime.isWorkStep(node("AudioGenerator", { media: { selectedAudioSource: "uploaded" } })), false, "本地上传音频是 ASSET，零成本直通");
  assert.equal(runtime.isWorkStep(node("AudioGenerator", { media: { selectedAudioSource: "tts" } })), true);
  assert.equal(runtime.isWorkStep(node("VideoEditing", { enabled: false })), false);
  assert.equal(runtime.isWorkStep({ data: {} }), false);
  assert.equal(runtime.isWorkStep(null), false);
});

test("画布视口：有效值规范化、越界缩放夹紧、脏数据回退 fitView", () => {
  assert.deepEqual(runtime.normalizeViewport({ x: -120, y: 48.5, zoom: 0.8 }), { x: -120, y: 48.5, zoom: 0.8 });
  assert.deepEqual(runtime.normalizeViewport({ x: "30", y: "0", zoom: "1.25" }), { x: 30, y: 0, zoom: 1.25 });
  assert.deepEqual(runtime.normalizeViewport({ x: 0, y: 0, zoom: 0.01 }), { x: 0, y: 0, zoom: runtime.VIEWPORT_ZOOM_MIN });
  assert.deepEqual(runtime.normalizeViewport({ x: 0, y: 0, zoom: 9 }), { x: 0, y: 0, zoom: runtime.VIEWPORT_ZOOM_MAX });
  [null, undefined, {}, { x: 1, y: 2 }, { x: NaN, y: 0, zoom: 1 },
    { x: 0, y: 0, zoom: 0 }, { x: 0, y: 0, zoom: -1 }, "bad"].forEach((value) => {
    assert.equal(runtime.normalizeViewport(value), null);
  });
});

test("落库 graph 带视口，运行 graph 保持纯净", () => {
  const graph = { nodes: [{ id: "a" }], edges: [] };
  const saved = runtime.graphWithViewport(graph, { x: -240, y: 96, zoom: 1.4 });
  assert.deepEqual(saved.viewport, { x: -240, y: 96, zoom: 1.4 });
  assert.deepEqual(graph, { nodes: [{ id: "a" }], edges: [] }, "不改原图，运行请求仍是纯 {nodes,edges}");
  assert.equal(runtime.graphWithViewport(graph, null), graph, "无有效视口时不加字段");
  assert.deepEqual(runtime.normalizeViewport(saved.viewport), saved.viewport, "保存值可原样读回");
});

// ---- 「停止」按钮：按后端 workflow_run.id 取消，而不是拿本地登记的 key 当 run id ----
// 回归：节点显示「生成中」，点「停止」却提示「没有正在运行的任务」。
// 根因：localRunRef 的 key 是运行标识（节点 id / "all"），旧实现取 Number(key) 恒为 NaN，
//      被 filter 掉后数组恒空；且 return 写在 try/finally 之前，本地轮询也没停。

test("停止目标按后端 run id 收集，不把节点 id / all 当 run id", () => {
  const local = new Map([
    ["node-a", { controller: {}, runId: 101 }],
    ["node-b", { controller: {}, runId: 202 }],
    ["all", { controller: {}, runId: 303 }],
  ]);
  const { runIds, pending } = runtime.collectCancelTargets(local, []);
  assert.deepEqual(runIds.sort((a, b) => a - b), [101, 202, 303]);
  assert.deepEqual(pending, [], "都拿到 run id 了，没有待定项");
});

test("节点 id 不能被当成 run id（旧实现的 NaN 过滤就是这个坑）", () => {
  const local = new Map([["node-1750000000000", { controller: {}, runId: null }]]);
  const { runIds, pending } = runtime.collectCancelTargets(local, []);
  assert.deepEqual(runIds, [], "节点 id 不是 run id，不该进取消列表");
  assert.equal(pending.length, 1, "runId 未知 → 归入待定，等 onStart 拿到 id 再补取消");
  assert.equal(pending[0][0], "node-1750000000000");
});

test("runId 未知的运行进待定列表，拿到 id 后不再重复", () => {
  const local = new Map([["all", { controller: {}, runId: null }]]);
  const first = runtime.collectCancelTargets(local, []);
  assert.deepEqual(first.runIds, []);
  assert.equal(first.pending.length, 1);
  local.set("all", { controller: {}, runId: 55 });
  const second = runtime.collectCancelTargets(local, []);
  assert.deepEqual(second.runIds, [55]);
  assert.deepEqual(second.pending, []);
});

test("打开画布时服务端已在跑的运行也能被停止（本地没有控制器）", () => {
  const { runIds, observed } = runtime.collectCancelTargets(new Map(), [77, "88", null, "bad"]);
  assert.deepEqual(runIds.sort((a, b) => a - b), [77, 88]);
  assert.deepEqual(observed.sort((a, b) => a - b), [77, 88]);
});

test("同一 run id 不重复取消", () => {
  const local = new Map([["node-a", { controller: {}, runId: 101 }]]);
  const { runIds } = runtime.collectCancelTargets(local, [101, 101]);
  assert.deepEqual(runIds, [101]);
});

test("onStart 在 run 建好后立刻交出 run id，即使此时已被 abort", async () => {
  const controller = new AbortController();
  const seen = [];
  const result = await runtime.executeWorkflowRun({
    graph: { nodes: [], edges: [] }, modelId: 2, signal: controller.signal,
    start: async () => {
      controller.abort(); // 模拟「POST /runs 在飞时用户点了停止」
      return { id: 909, status: "RUNNING", steps: [] };
    },
    onStart: (run) => seen.push(run?.id),
    onRun: () => {},
  });
  assert.deepEqual(seen, [909], "run id 必须交出去，否则没法补 cancel");
  assert.equal(result, null, "已 abort 不再轮询");
});
