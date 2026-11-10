/**
 * 本地导入素材的时长兜底。
 * 后端 AssetService.applyMetadata 用 ffprobe 读时长，探测失败会静默留空；此时前端若按
 * 默认 5s 落轨，ffmpeg 合成会报「视频裁剪范围超过源视频时长」。上传完成后用浏览器
 * 直接读本地文件的 metadata 补上真实时长，避免只能用默认值的场景。
 * 浏览器环境外（node 单测 / SSR）直接返回 null，由调用方回落到默认时长。
 */
export function probeLocalDuration(file, kind = "video") {
  if (kind === "image" || typeof document === "undefined" || !file) return Promise.resolve(null);
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const element = document.createElement(kind === "audio" ? "audio" : "video");
    let settled = false;
    const finish = (seconds) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      element.removeAttribute("src");
      element.load?.();
      URL.revokeObjectURL(objectUrl);
      resolve(seconds);
    };
    const timer = window.setTimeout(() => finish(null), 5000);
    element.preload = "metadata";
    element.muted = true;
    element.onloadedmetadata = () => {
      const seconds = Number(element.duration);
      finish(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    };
    element.onerror = () => finish(null);
    element.src = objectUrl;
  });
}
