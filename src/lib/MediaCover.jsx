import { useEffect, useRef, useState } from "react";
import { WorkWaveform } from "../components/AudioPreview.jsx";
import { acquireMediaSlot } from "./mediaGate.js";

// 兜底：src 加载失败时整张 img 隐藏，让 .work-thumb 的紫色 radial-gradient 占位。
function hideOnError(event) {
  event.currentTarget.style.display = "none";
}

/** 进入可视区域后才请求，并且全站封面共用一个并发上限。 */
function useGatedMediaSrc(url) {
  const hostRef = useRef(null);
  const releaseRef = useRef(null);
  const [src, setSrc] = useState("");

  function settle() {
    const done = releaseRef.current;
    releaseRef.current = null;
    if (done) done();
  }

  useEffect(() => {
    const node = hostRef.current;
    if (!url || !node) return undefined;
    const target = node.parentElement || node;
    let cancelled = false;

    const start = () => {
      acquireMediaSlot().then((release) => {
        if (cancelled) {
          release();
          return;
        }
        releaseRef.current = release;
        setSrc(url);
      });
    };

    if (typeof IntersectionObserver !== "function") {
      start();
      return () => {
        cancelled = true;
        settle();
      };
    }

    const observer = new IntersectionObserver((entries) => {
      if (cancelled || !entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      start();
    }, { rootMargin: "200px" });
    observer.observe(target);
    return () => {
      cancelled = true;
      observer.disconnect();
      settle();
    };
  }, [url]);

  return { hostRef, src, settle };
}

export function MediaCover({ item, alt }) {
  const label = alt || item.title || "";
  const thumb = item.thumb || item.poster || item.src;
  const gatedUrl = item.type === "audio" ? "" : (thumb || (item.type === "video" ? item.src : ""));
  const { hostRef, src, settle } = useGatedMediaSrc(gatedUrl);
  const fail = (event) => {
    settle();
    hideOnError(event);
  };

  if (item.type === "video") {
    if (thumb) {
      return <img ref={hostRef} src={src || undefined} alt={label} onLoad={settle} onError={fail} />;
    }
    if (item.src) {
      return (
        <video
          ref={hostRef}
          src={src || undefined}
          muted
          playsInline
          preload={src ? "metadata" : "none"}
          onLoadedMetadata={settle}
          onError={fail}
        />
      );
    }
  }
  if (item.type === "image") {
    return <img ref={hostRef} src={src || undefined} alt={label} onLoad={settle} onError={fail} />;
  }
  return <WorkWaveform />;
}
