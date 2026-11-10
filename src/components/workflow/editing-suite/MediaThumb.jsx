import { useEffect, useRef, useState } from "react";

// 取址逻辑拆到纯 JS 模块（node --test 可直接 import），这里只负责渲染
export { resolveThumbUrls } from "./thumbUrls.js";

/** 铺满父容器的静帧层；父容器需已铺好渐变兜底，媒体加载失败时自然露出兜底。 */
export default function MediaThumb({ poster = "", video = "" }) {
  const [posterFailed, setPosterFailed] = useState(false);
  const videoRef = useRef(null);
  useEffect(() => { setPosterFailed(false); }, [poster]);
  const showPoster = Boolean(poster) && !posterFailed;
  const showVideo = Boolean(video) && !showPoster;

  // 部分浏览器 preload=metadata 后仍停在首帧之前，主动 seek 一下让画面真正出来
  useEffect(() => {
    const node = videoRef.current;
    if (!node || !showVideo) return undefined;
    const seekFirstFrame = () => {
      try {
        if (Number.isFinite(node.duration) && node.duration > 0.15) node.currentTime = 0.1;
      } catch { /* 元数据未就绪，忽略 */ }
    };
    node.addEventListener("loadedmetadata", seekFirstFrame);
    return () => node.removeEventListener("loadedmetadata", seekFirstFrame);
  }, [showVideo, video]);

  if (showPoster) {
    return <img className="ce-media-thumb" src={poster} alt="" draggable={false} onError={() => setPosterFailed(true)} />;
  }
  if (showVideo) {
    return <video ref={videoRef} className="ce-media-thumb" src={`${video}#t=0.1`} muted playsInline preload="metadata" />;
  }
  return null;
}
