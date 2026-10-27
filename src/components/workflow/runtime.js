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
      outputs: step.outputs?.length ? step.outputs : (node.data?.runtime?.outputs || []),
      error: step.errorMessage || "",
    } } };
  });
}

export function canConnectNodes(nodes, connection) {
  const source = nodes.find((node) => node.id === connection.source);
  return Boolean(source && source.data?.kind !== "VideoEditing");
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
  const drop = new Set(["selected", "dragging", "measured", "resizing", "runtime", "scopes"]);
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
