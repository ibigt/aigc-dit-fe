export function estimatedNodeHeight(node) {
  const kind = node.data?.kind;
  // 折叠节点（需求 4.1.2.6）：仅保留标题栏高度
  if (node.data?.collapsed) return 44;
  if (kind === "AudioGenerator") return 560;
  // 视频剪辑节点：基础高度 + 片段列表行高（自动排版防重叠用，估算值）
  if (kind === "VideoEditing") return 390 + Math.max(0, node.data?.editing?.clips?.length || 0) * 30;
  const fields = node.data?.fields || [];
  const ports = Math.max(node.data?.inputs?.length || 0, node.data?.outputs?.length || 0);
  return 76 + ports * 22 + (node.data?.preview ? 228 : 0) + fields.reduce((sum, field) => sum + (field.multiline ? 104 : 35), 0);
}

export function nodeLayoutSize(node) {
  const kind = node.data?.kind;
  const minimumWidth = ["MarkdownNote", "Prompt"].includes(kind) ? 286 : 0;
  const height = node.data?.collapsed ? 44
    : kind === "VideoGenerator" ? 600
    : kind === "ImageGenerator" ? 520
    : ["MarkdownNote", "Prompt"].includes(kind) ? 260
    : estimatedNodeHeight(node);
  return {
    width: Math.max(minimumWidth, Number(node.measured?.width) || Number(node.style?.width) || 320),
    height: Number(node.measured?.height) || Number(node.style?.height) || height,
  };
}

export function placeQuickNode(preferred, existingNodes, newNode) {
  const padding = 32;
  const step = 64;
  const size = nodeLayoutSize(newNode);
  const obstacles = existingNodes.filter((node) => !node.parentId).map((node) => ({ position: node.position, ...nodeLayoutSize(node) }));
  const isFree = (point) => obstacles.every((node) =>
    point.x + size.width + padding <= node.position.x
    || node.position.x + node.width + padding <= point.x
    || point.y + size.height + padding <= node.position.y
    || node.position.y + node.height + padding <= point.y);
  if (isFree(preferred)) return preferred;

  let nearest;
  for (let ring = 1; !nearest || ring * ring * step * step <= nearest.distance; ring += 1) {
    for (let x = -ring; x <= ring; x += 1) {
      for (let y = -ring; y <= ring; y += 1) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
        const distance = (x * x + y * y) * step * step;
        if (nearest && distance >= nearest.distance) continue;
        const point = { x: preferred.x + x * step, y: preferred.y + y * step };
        if (isFree(point)) nearest = { point, distance };
      }
    }
  }
  return nearest.point;
}
