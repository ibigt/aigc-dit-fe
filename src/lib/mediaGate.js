/** 同时拉取的封面数量。留出连接给创作列表、素材库等接口。 */
export const MEDIA_FETCH_LIMIT = 4;

/**
 * 限制同时进行的媒体请求。acquire 返回的函数在加载结束或组件卸载时调用一次。
 */
export function createMediaGate(limit = MEDIA_FETCH_LIMIT) {
  let active = 0;
  const waiters = [];

  function release() {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (!next) return;
    active += 1;
    next(once(release));
  }

  return {
    acquire() {
      if (active < limit) {
        active += 1;
        return Promise.resolve(once(release));
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}

function once(fn) {
  let used = false;
  return () => {
    if (used) return;
    used = true;
    fn();
  };
}

const sharedGate = createMediaGate(MEDIA_FETCH_LIMIT);

export function acquireMediaSlot() {
  return sharedGate.acquire();
}
