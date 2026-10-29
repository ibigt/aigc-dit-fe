import { mediaUrl } from "../../lib/media.js";

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

export async function executeWorkflowRun({ graph, workflowId, previousRunId, modelId, nodeId, save, start, get, wait, onRun, signal }) {
  try {
    if (signal?.aborted) return null;
    if (workflowId != null) await save(workflowId, graph);
    if (signal?.aborted) return null;
    const request = { ...(workflowId != null ? { workflowId } : {}), ...(previousRunId != null ? { previousRunId } : {}), modelId, ...(nodeId ? { nodeId } : {}), graph };
    const run = await start(request);
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

export function applyWorkflowSnapshotToNodes(nodes, snapshot) {
  const cleared = nodes.map((node) => ({ ...node, data: { ...node.data, runtime: undefined } }));
  return applyRunToNodes(cleared, { steps: snapshot.steps || [] });
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
  const drop = new Set(["selected", "dragging", "measured", "resizing", "runtime", "scopes", "icon"]);
  const clean = (value) => {
    if (typeof value === "function" || (typeof value === "string" && value.startsWith("blob:"))) return undefined;
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).filter(([key]) => !drop.has(key))
        .map(([key, item]) => [key, clean(item)]).filter(([, item]) => item !== undefined));
    }
    return value;
  };
  return { nodes: nodes.map(clean), edges: edges.map(clean) };
}
