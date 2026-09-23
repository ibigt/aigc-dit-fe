const labels = { image: "图像生成", video: "视频生成", audio: "语音合成", text: "文本生成" };

export function observabilityCategoryLabel(category) {
  return labels[category] || category || "未知类型";
}

export function healthLevel(successRate, failed) {
  if (Number(failed || 0) === 0) return "success";
  if (Number(successRate || 0) >= 95) return "running";
  return "failed";
}
