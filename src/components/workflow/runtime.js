import { mediaUrl } from "../../lib/media.js";
import { cleanPersistedValue } from "./serializer.js";

// 进度分母口径与后端 WorkflowRunService.workSteps 对齐：只算 GENERATE / EDIT 步骤。
// 文本节点是 TEXT、本地上传音频是 ASSET，两者零成本直通，不计入分母，
// 否则工具条会显示「3/5」而后端只跑了 2 步。
export const WORK_KINDS = ["ImageGenerator", "VideoGenerator", "AudioGenerator", "VideoEditing"];
export function isWorkStep(node) {
  const data = node?.data || {};
  if (!WORK_KINDS.includes(data.kind) || data.enabled === false) return false;
  return !(data.kind === "AudioGenerator" && data.media?.selectedAudioSource === "uploaded");
}

// 运行结果只带 storageKey（如 users/1/outputs/2084/1.png），展示前归一化出可直接访问的 url。
// 后端 run 响应虽附带 url，但缺 token（/api/media 鉴权 401），因此凡有 storageKey 一律用
// 本地 mediaUrl 重建带 token 的 url/posterUrl，否则输出网格和视频/音频播放都会加载失败
function displayOutputs(stepOutputs, fallback) {
  const outputs = stepOutputs?.length ? stepOutputs : (fallback || []);
  if (typeof window === "undefined") return outputs; // Node 测试环境无 window，mediaUrl 不可用，保持原样
  return outputs.map((output) => {
    if (!output?.storageKey) return output;
    return { ...output, url: mediaUrl(output.storageKey), posterUrl: output.posterKey ? mediaUrl(output.posterKey) : output.posterUrl ? mediaUrl(output.posterUrl) : undefined };
  });
}

export function applyRunToNodes(nodes, run) {
  const byId = new Map((run.steps || []).map((step) => [step.nodeId, step]));
  return nodes.map((node) => {
    const step = byId.get(node.id);
    if (!step) return node;
    return { ...node, data: { ...node.data, runtime: {
      runId: step.runId ?? run.id,
      status: step.status,
      progress: step.progress || 0,
      creditCost: step.creditCost ?? null,
      // 复用标记：命中指纹复用了历史产物，本次没真跑、没扣积分（creditCost 为 0）
      reused: Boolean(step.reused),
      resolvedPrompt: step.resolvedPrompt || "",
      outputs: displayOutputs(step.outputs, node.data?.runtime?.outputs),
      error: step.errorMessage || "",
    } } };
  });
}

// 端口类型兼容分组：组内的不同类型也允许互连（如 IMAGE 与 MASK）
const PORT_TYPE_GROUPS = [["IMAGE", "MASK"]];

// 节点适配器显式声明的可转换协议（需求 4.1.2.4）：
// MEDIA 是生成节点"参考素材"端口的聚合类型，接受图像与视频；DATA 为通用数据类型，放行任意端口
const PORT_ADAPTER_PAIRS = new Set([
  "IMAGE|MEDIA", "MEDIA|IMAGE",
  "VIDEO|MEDIA", "MEDIA|VIDEO",
  "AUDIO|MEDIA", "MEDIA|AUDIO",
]);

export function portTypesCompatible(left, right) {
  if (!left || !right) return true;
  if (left === right || left === "any" || right === "any") return true;
  if (left === "DATA" || right === "DATA") return true;
  if (PORT_ADAPTER_PAIRS.has(`${left}|${right}`)) return true;
  const groupOf = (type) => PORT_TYPE_GROUPS.find((group) => group.includes(type));
  const leftGroup = groupOf(left);
  const rightGroup = groupOf(right);
  return Boolean(leftGroup && leftGroup === rightGroup);
}

// 连线预检（需求 4.1.2.4）：禁止不兼容类型直接连线；视频剪辑为终点不可连下游。
// 端口缺类型声明时放行，以兼容旧节点；显式可转换协议应由节点适配器声明（当前未声明则按同类型处理）。
export function canConnectNodes(nodes, connection) {
  const { source, target } = connection;
  if (!source || !target || source === target) return false;
  const sourceNode = nodes.find((node) => node.id === source);
  const targetNode = nodes.find((node) => node.id === target);
  if (!sourceNode || !targetNode) return false;
  if (sourceNode.data?.kind === "VideoEditing") return false;
  const sourceTypes = (sourceNode.data?.outputs || []).map((port) => port.type).filter(Boolean);
  const targetTypes = (targetNode.data?.inputs || []).map((port) => port.type).filter(Boolean);
  if (!sourceTypes.length || !targetTypes.length) return true;
  return sourceTypes.some((left) => targetTypes.some((right) => portTypesCompatible(left, right)));
}

export function applyRunToCurrentNodes(setNodes, run) {
  setNodes((current) => applyRunToNodes(current, run));
}

export function waitForWorkflowPoll(signal, delay = 1500) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, delay);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * 收集「停止」按钮要取消的目标。
 *
 * 关键口径：localRuns 的 key 是**运行标识**（节点 id 或 "all"），不是后端 run id。
 * 只有 entry.runId（workflow_run.id）能拿去调 /runs/{id}/cancel；
 * 早前的实现拿 key 去取 Number()，节点 id 恒为 NaN → 被 filter 掉 → 永远提示
 * 「没有正在运行的任务」，而节点一直卡在「生成中」。
 *
 * @param {Map<string, {controller?: any, runId?: any}>} localRuns 本地登记的运行
 * @param {Iterable<any>} observedIds 打开画布时服务端已在跑的 run id（只有快照轮询观察到，本地没有控制器）
 * @returns {{ runIds: number[], pending: Array<[string, any]>, observed: number[] }} runIds=本地发起、可直接取消的后端 run id；pending=POST /runs 还在飞、还不知道 id 的运行；observed=服务端已在跑的 run id
 */
export function collectCancelTargets(localRuns, observedIds) {
  const runIds = new Set();
  const pending = [];
  localRuns?.forEach?.((entry, key) => {
    const runId = Number(entry?.runId);
    if (Number.isFinite(runId) && runId > 0) { runIds.add(runId); return; }
    pending.push([key, entry]);
  });
  const observed = [];
  for (const id of observedIds || []) {
    const numeric = Number(id);
    if (!Number.isFinite(numeric) || numeric <= 0 || runIds.has(numeric)) continue;
    runIds.add(numeric);
    observed.push(numeric);
  }
  return { runIds: [...runIds], pending, observed };
}

export async function executeWorkflowRun({ graph, requestGraph, workflowId, previousRunId, modelId, nodeId, forceRegenerate, save, start, get, wait, onRun, onStart, signal }) {
  try {
    if (signal?.aborted) return null;
    if (workflowId != null) await save(workflowId, graph);
    if (signal?.aborted) return null;
    // requestGraph：只影响本次提交的图（如整图运行时跳过缺首帧的节点），落库仍用 graph 原图
    const request = { ...(workflowId != null ? { workflowId } : {}), ...(previousRunId != null ? { previousRunId } : {}), modelId, ...(nodeId ? { nodeId } : {}), ...(forceRegenerate ? { forceRegenerate: true } : {}), graph: requestGraph || graph };
    const run = await start(request);
    // run 一旦在后端建好就必须把 id 交出去：用户在 POST 返回前点了「停止」时，
    // 只有拿到 id 才能补一次 cancel，否则后端会留一条没人管的运行（节点永远「生成中」）。
    // 这个回调不受 signal 影响，必须早于下面的 aborted 判定。
    onStart?.(run);
    if (signal?.aborted) return null;
    return await resumeWorkflowRun({ run, get, wait, onRun, signal });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError" || error?.code === "ERR_CANCELED") return null;
    throw error;
  }
}

async function resumeWorkflowRun({ run, get, wait = waitForWorkflowPoll, onRun, signal }) {
  if (!run || signal?.aborted) return null;
  onRun(run);
  while (run.status === "RUNNING") {
    await wait(signal);
    if (signal?.aborted) return null;
    run = await get(run.id, { signal });
    if (signal?.aborted) return null;
    onRun(run);
  }
  return run;
}

export async function restoreWorkflowRun({ workflowId, latest, ...options }) {
  try {
    if (workflowId == null || options.signal?.aborted) return null;
    const run = await latest(workflowId, { signal: options.signal });
    return await resumeWorkflowRun({ ...options, run });
  } catch (error) {
    if (options.signal?.aborted || error?.name === "AbortError" || error?.code === "ERR_CANCELED") return null;
    throw error;
  }
}

/**
 * 节点的预览图：优先用画布上摆好的图（data.preview），否则用最近一次运行的产物
 * （runtime.outputs，url 已由 displayOutputs 重建为带 token 的 /api/media 地址）。
 * 生成出来的节点只有 runtime 产物、没有 data.preview，引用缩略图与参考素材选择器
 * 都必须走这里，否则会显示成占位图。
 */
export function previewFromData(data) {
  const outputs = data?.runtime?.outputs || [];
  const index = data?.media?.selectedOutputIndex ?? data?.runtime?.selectedOutputIndex ?? 0;
  const output = outputs[index] || outputs[0];
  return data?.preview || output?.posterUrl || output?.url || "";
}

export function nodePreviewUrl(node) {
  return previewFromData(node?.data);
}

// /api/media?key=xxx%2F1.mp4&token=… 这类地址里扩展名后面跟的是 & 而不是 ?，必须一并覆盖
const VIDEO_URL_PATTERN = /\.(mp4|webm|mov|m4v|mkv)(&|#|\?|$)/i;

/**
 * 只返回能塞进 <img> 的地址：视频产物没有封面时 previewFromData 会兜底成 mp4 的 url，
 * 交给 <img> 必然破图（只显示 alt 文本）。视频请改用 nodePlaybackUrl + <video> 取首帧。
 */
export function nodePosterUrl(node) {
  const url = nodePreviewUrl(node);
  return VIDEO_URL_PATTERN.test(url) ? "" : url;
}

/** 视频/音频的播放地址（<video>/<audio> 用），优先运行时产物 url。 */
export function nodePlaybackUrl(node) {
  const outputs = node?.data?.runtime?.outputs || [];
  const index = node?.data?.media?.selectedOutputIndex ?? node?.data?.runtime?.selectedOutputIndex ?? 0;
  const output = outputs[index] || outputs[0];
  return output?.url || node?.data?.preview || "";
}

// 导入工程文件带回的产物只有 storageKey（url 含会过期的 token，导出时被剥离）。
// 水合时按 storageKey 重建可访问的 url/posterUrl，媒体/剪辑/音频节点才能显示与播放。
export function hydrateImportedOutputs(outputs) {
  return (outputs || []).map((output) => {
    if (!output?.storageKey) return output;
    return {
      ...output,
      url: mediaUrl(output.storageKey),
      posterUrl: output.posterKey ? mediaUrl(output.posterKey) : output.posterUrl ? mediaUrl(output.posterUrl) : undefined,
    };
  });
}

/**
 * 把运行时快照合回画布节点。
 *
 * 快照里「IDLE + 空 outputs」的步骤只说明「本工作流没有该节点的本地运行历史」，
 * 并不代表产物作废。导入工程 / 模板实例化的产物是随 graph 走的（节点顶层 outputs，
 * 由 hydrateStoredNode 水合进 data.runtime.outputs），而这些工作流往往只跑过一两个
 * 新加的节点（比如配音）。后端 snapshotMine 只要发现任意运行历史，就会给图上每个
 * 节点都发一条 IDLE 步骤；旧实现无条件清掉 covered 节点的 runtime，产物当场被抹，
 * 下一次保存写回 DB 后「另存为模板 / 模板实例化」继承空图 —— 视频永久消失（#79~#83）。
 *
 * 因此：节点已有产物时，无产物的 IDLE 步骤没有信息量，直接忽略，保留水合出来的
 * SUCCEEDED 状态与产物；其它步骤照常刷新（状态 / 进度 / 错误 / 新产物）。
 * applyRunToNodes 本身带 outputs 回退（displayOutputs），不清 runtime 也能在
 * 运行中的空产物步骤上保住上一次的持久产物。
 */
export function applyWorkflowSnapshotToNodes(nodes, snapshot) {
  const steps = snapshot.steps || [];
  const carried = new Set(nodes
    .filter((node) => (node.data?.runtime?.outputs || []).length)
    .map((node) => node.id));
  const effective = steps.filter((step) => {
    if ((step.outputs?.length || 0) > 0 || (step.status && step.status !== "IDLE")) return true;
    return !carried.has(step.nodeId);
  });
  return applyRunToNodes(nodes, { steps: effective });
}

export async function restoreWorkflowSnapshot({ workflowId, snapshot, get, wait = waitForWorkflowPoll, onSnapshot, signal }) {
  try {
    if (workflowId == null || signal?.aborted) return null;
    let current = await snapshot(workflowId, { signal });
    while (current && !signal?.aborted) {
      onSnapshot(current);
      const active = (current.activeRuns || []).filter((run) => run.status === "RUNNING");
      if (!active.length) return current;
      await wait(signal);
      if (signal?.aborted) return null;
      await Promise.all(active.map((run) => get(run.id, { signal })));
      if (signal?.aborted) return null;
      // Re-read the authoritative aggregate; raw run responses must not restore obsolete versions.
      current = await snapshot(workflowId, { signal });
    }
    return null;
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError" || error?.code === "ERR_CANCELED") return null;
    throw error;
  }
}

export function persistableWorkflowGraph(nodes, edges) {
  // 与标准 JSON 导出共用同一份清洗口径（serializer.js），避免保存与导出结果不一致。
  // 产物（runtime.outputs）在清洗时被剥离后，以 storageKey 形式补写到节点级 outputs：
  // 导入的工作流没有本地运行历史，快照恢复回填不了产物，落库带上 outputs 才能在
  // 重新打开 / 刷新后水合回来（hydrateStoredNode）。与本机生成的工作流不冲突——
  // 它们的产物由运行历史快照恢复，节点级 outputs 只作双保险。
  const persisted = (node) => {
    const clean = cleanPersistedValue(node);
    const outputs = (node?.data?.runtime?.outputs || [])
      .map(({ url, posterUrl, ...rest }) => rest)
      .filter((output) => output && (output.storageKey || output.url));
    return outputs.length ? { ...clean, outputs } : clean;
  };
  return { nodes: nodes.map(persisted), edges: edges.map(cleanPersistedValue) };
}

// 画布视口（需求 4.1.1.6）：保存、打开、导入共用同一份校验口径。
// 缩放范围与 ReactFlow 的 minZoom/maxZoom 一致；非法值一律视为「没有视口」，
// 由调用方回退 fitView，避免脏数据把画布甩到看不见的地方。
export const VIEWPORT_ZOOM_MIN = 0.2;
export const VIEWPORT_ZOOM_MAX = 3;

export function normalizeViewport(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const zoom = Number(value?.zoom);
  if (![x, y, zoom].every(Number.isFinite) || zoom <= 0) return null;
  return { x, y, zoom: Math.min(VIEWPORT_ZOOM_MAX, Math.max(VIEWPORT_ZOOM_MIN, zoom)) };
}

// 只给落库的 graph 加视口；运行请求的 graph 保持 {nodes,edges}，别让后端 planner 见到多余字段。
export function graphWithViewport(graph, viewport) {
  const clean = normalizeViewport(viewport);
  return clean ? { ...graph, viewport: clean } : graph;
}
