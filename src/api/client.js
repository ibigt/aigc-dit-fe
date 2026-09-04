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
      throw makeApiError(body.message, body.code);
    }
    return body && Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body;
  },
  (error) => {
    const body = error.response?.data;
    throw makeApiError(body?.message || error.message || "网络错误", body?.code || error.response?.status);
  },
);

function makeApiError(message, code) {
  const err = new Error(message || "请求失败");
  err.code = code;
  return err;
}
