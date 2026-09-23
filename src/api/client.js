import axios from "axios";

export const TOKEN_KEY = "lightflow-token";

export const api = axios.create({
  baseURL: "/api",
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = window.localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.data instanceof FormData) {
    delete config.headers["Content-Type"];
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body.code === "number" && body.code !== 200) {
      if (body.code === 401) {
        clearLocalAuth();
      }
      throw makeApiError(body.message, body.code);
    }
    return body && Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body;
  },
  (error) => {
    const body = error.response?.data;
    const status = error.response?.status;
    const code = body?.code || status;
    if (code === 401 || status === 401) {
      clearLocalAuth();
    }
    const timedOut = error.code === "ECONNABORTED" || /timeout/i.test(error.message || "");
    throw makeApiError(
        body?.message || (timedOut ? "请求超时。文本模型较慢时请稍候刷新，失败后仍可重新分析。" : (error.message || "网络错误")),
      code,
    );
  },
);

function clearLocalAuth() {
  const hadToken = Boolean(window.localStorage.getItem(TOKEN_KEY));
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem("lightflow-user");
  if (hadToken) {
    window.dispatchEvent(new CustomEvent("dit:unauthorized"));
  }
}

function makeApiError(message, code) {
  const err = new Error(message || "请求失败");
  err.code = code;
  return err;
}

/** 网关重启、超时等瞬时失败，轮询应继续而不是当成出片失败。 */
export function isRetryableRequestError(error) {
  const code = Number(error?.code);
  if ([408, 425, 502, 503, 504].includes(code)) {
    return true;
  }
  const msg = String(error?.message || "");
  return /status code 50[234]|Network Error|ECONNABORTED|timeout|请求超时/i.test(msg);
}
