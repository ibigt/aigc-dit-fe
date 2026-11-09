function outputsFor(node) {
  const outputs = node.data?.runtime?.outputs ?? node.data?.outputsMedia ?? node.outputs;
  if (Array.isArray(outputs)) return outputs;
  const output = node.data?.output ?? node.output ?? outputs;
  return output == null ? [] : [output];
}

function hasPlayableOutput(output) {
  return typeof output?.storageKey === "string" && output.storageKey.trim() !== "";
}

// 节点种类 → 剪辑台素材类型。剪辑节点只吃这两类上游产物。
const KIND_MEDIA_TYPE = { VideoGenerator: "video", AudioGenerator: "audio" };

export function mediaTypeOfNode(node) {
  return KIND_MEDIA_TYPE[node?.data?.kind] || "";
}

// 音频节点的可播放产物：上传音频（media.uploadedAudio）与生成音频（runtime.outputs）都要收录，
// 去重后返回；与 nodeViewModel 的 selectedAudioSource 选择无关，素材面板由用户自己挑。
export function audioOutputsFor(node) {
  const media = node.data?.media || {};
  const list = [];
  const uploaded = media.uploadedAudio;
  if (uploaded?.storageKey) list.push({ type: "audio", ...uploaded });
  for (const output of outputsFor(node)) {
    if (!hasPlayableOutput(output)) continue;
    if (list.some((item) => item.storageKey === output.storageKey)) continue;
    list.push({ type: "audio", ...output });
  }
  return list;
}

function outputsOf(node) {
  return node.data?.kind === "AudioGenerator" ? audioOutputsFor(node) : outputsFor(node);
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

function createClip(node, output, outputIndex, persisted, order) {
  const trimStart = Number(persisted?.trimStart ?? 0);
  const outputDuration = Number(output.durationSec ?? output.duration ?? output.metadata?.durationSec);
  const trimEnd = persisted?.trimEnd == null ? (outputDuration > 0 ? outputDuration : null) : Number(persisted.trimEnd);
  const validationError = !Number.isFinite(trimStart) || trimStart < 0 || (trimEnd != null && (!Number.isFinite(trimEnd) || trimEnd <= trimStart))
    ? "裁剪入点/出点范围无效" : outputDuration > 0 && (trimStart >= outputDuration || trimEnd > outputDuration)
      ? "裁剪范围超过源视频时长" : "";
  return {
    ...persisted,
    sourceNodeId: node.id,
    // 来源节点标题：视频剪辑节点的片段列表展示用
    sourceTitle: node.data?.title || node.id,
    // 素材类型：剪辑台据此决定落哪条轨道（视频轨 / 音频轨）与卡片形态
    mediaType: mediaTypeOfNode(node) || "video",
    outputIndex,
    output,
    storageKey: output.storageKey,
    order,
    // 片段启用状态（需求 4.2.5.3）：缺省视为启用，旧工作流 JSON 保持原行为
    enabled: persisted?.enabled !== false,
    trimStart,
    trimEnd,
    validationError,
    volume: clamp(persisted?.volume ?? 1, 0, 2),
  };
}

export function buildClipQueue(videoNodes = [], edges = [], persistedClips = [], editingNodeId, graphNodes = videoNodes, options = {}) {
  const disabledIds = new Set(graphNodes.filter((node) => node.data?.enabled === false).map((node) => node.id));
  // kinds 缺省 = 不按节点种类过滤（调用方已自行筛好，如 getClips 只传视频节点）；
  // 剪辑台素材面板显式传 kinds:["VideoGenerator","AudioGenerator"] 时再把音频节点纳入。
  const allowedKinds = options.kinds ? new Set(options.kinds) : null;
  const byId = new Map(videoNodes
    .filter((node) => !disabledIds.has(node.id) && (!allowedKinds || allowedKinds.has(node.data?.kind)))
    .map((node) => [node.id, node]));
  const candidateEdges = edges.filter((edge) => byId.has(edge.source) && edge.target != null);
  const targetIds = new Set(candidateEdges.map((edge) => edge.target));
  const targetId = editingNodeId ?? (targetIds.size === 1 ? candidateEdges[0]?.target : undefined);
  const incomingByTarget = new Map();
  for (const edge of edges) {
    if (edge.target == null || disabledIds.has(edge.source) || disabledIds.has(edge.target)) continue;
    const incoming = incomingByTarget.get(edge.target) || [];
    incoming.push(edge.source);
    incomingByTarget.set(edge.target, incoming);
  }
  const connectedIds = [];
  const visited = new Set();
  const visiting = new Set();
  function visitAncestors(nodeId) {
    if (visited.has(nodeId) || visiting.has(nodeId)) return;
    visiting.add(nodeId);
    for (const sourceId of incomingByTarget.get(nodeId) || []) visitAncestors(sourceId);
    visiting.delete(nodeId);
    visited.add(nodeId);
    if (byId.has(nodeId)) connectedIds.push(nodeId);
  }
  if (targetId != null) visitAncestors(targetId);
  const persisted = [...persistedClips].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const queue = [];
  const disabledClipNodeIds = new Set();

  for (const saved of persisted) {
    const node = byId.get(saved.sourceNodeId);
    if (!node || !connectedIds.includes(node.id)) continue;
    // 片段级启用开关（需求 4.2.5.3）：禁用的片段不进入剪辑队列
    if (options.includeDisabled !== true && saved.enabled === false) {
      disabledClipNodeIds.add(saved.sourceNodeId);
      continue;
    }
    const outputIndex = Math.max(0, Number(saved.outputIndex) || 0);
    const output = outputsOf(node)[outputIndex];
    if (!hasPlayableOutput(output)) continue;
    queue.push(createClip(node, output, outputIndex, saved, queue.length));
  }

  for (const nodeId of connectedIds) {
    const node = byId.get(nodeId);
    if (queue.some((clip) => clip.sourceNodeId === nodeId)) continue;
    // 显式禁用的片段不再被自动补回，保证"禁用"在成片中真正生效
    if (disabledClipNodeIds.has(nodeId)) continue;
    const outputs = outputsOf(node);
    const selected = Number(node.data?.media?.selectedOutputIndex ?? node.data?.media?.outputIndex ?? 0);
    const outputIndex = Number.isInteger(selected) && selected >= 0 && selected < outputs.length ? selected : 0;
    const output = outputs[outputIndex];
    if (hasPlayableOutput(output)) queue.push(createClip(node, output, outputIndex, null, queue.length));
  }

  return queue;
}

export function nextPlaybackPosition(clips = [], activeIndex) {
  const index = Number(activeIndex) + 1;
  if (!Number.isInteger(index) || index < 0 || index >= clips.length) return null;
  return { index, time: clamp(clips[index].trimStart, 0, Number.POSITIVE_INFINITY) };
}
