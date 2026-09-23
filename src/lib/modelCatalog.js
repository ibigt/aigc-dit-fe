export function managedModelCatalog(data) {
  return Array.isArray(data) ? data : [];
}

export function modelCatalogMessage({ loading, error, category }) {
  if (loading) return "正在加载模型目录…";
  if (error) return "模型目录加载失败，请稍后重试";
  const label = category === "video" ? "视频" : category === "image" ? "图像" : category === "audio" ? "语音" : "当前类型";
  return `暂无已启用的${label}模型，请先在管理后台启用模型`;
}
