/**
 * 高级工作台：工作流名称行内重命名的纯逻辑。
 *
 * 约束与后端 WorkflowSaveReq 对齐：标题非空、最长 128 字符。
 */

export const WORKFLOW_TITLE_MAX = 128;
export const DEFAULT_WORKFLOW_TITLE = "未命名工作流";

/** 归一化用户输入：压缩空白、去首尾、长度截断，空值回落默认名。 */
export function normalizeWorkflowTitle(value, fallback = DEFAULT_WORKFLOW_TITLE) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.slice(0, WORKFLOW_TITLE_MAX);
}

/** 名称是否发生变化（用于决定是否落库 / 是否提示）。 */
export function isWorkflowTitleChanged(current, next) {
  return normalizeWorkflowTitle(current) !== normalizeWorkflowTitle(next);
}

/**
 * 仅改标题时的 PUT 请求体。
 * 必须带上服务端已存的 graph，否则后端 apply() 会把画布覆盖成空。
 */
export function buildTitleUpdateBody(detail, title, fallback = {}) {
  return {
    title: normalizeWorkflowTitle(title),
    description: detail?.description || fallback.description || "",
    type: detail?.type || fallback.type || "image",
    modelId: detail?.modelId ?? null,
    origin: detail?.origin || fallback.origin || "高级工作台",
    demoKey: detail?.demoKey,
    sourcePath: detail?.sourcePath,
    graph: detail?.graph || { nodes: [], edges: [] },
  };
}
