import axios from "axios";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

export const CONF = {
  base: process.env.YUJIAN_API_BASE || "https://api.yjnt111.top",
  token: process.env.YUJIAN_API_TOKEN || "",
  searchPath: process.env.YUJIAN_SEARCH_PATH || "/api/member/article/list",
  detailPath: process.env.YUJIAN_DETAIL_PATH || "/api/member/article",
  timeout: Number(process.env.YUJIAN_API_TIMEOUT || 15000),
  maxChars: Number(process.env.YUJIAN_MAX_CONTENT_CHARS || 20000),
};

const client = axios.create({
  baseURL: CONF.base,
  timeout: CONF.timeout,
  headers: {
    ...(CONF.token ? { Authorization: `Bearer ${CONF.token}` } : {}),
    "User-Agent": "mcp-yujian-server/1.0",
  },
});

/** 把 axios 各种异常翻译成给 LLM 看的友好文本 */
export function friendlyError(err, url) {
  const status = err.response?.status;
  const body = err.response?.data;
  if (status === 401 || (body && (body.code === 401 || String(body.msg || "").includes("认证")))) {
    return "API 鉴权失败(401)：Bearer Token 缺失或已过期，请更新 .env 中的 YUJIAN_API_TOKEN 后重启 MCP 服务。";
  }
  if (status === 429) return "API 限流(429)：请求过于频繁，请稍后重试。";
  if (status && status >= 500) return `API 服务端错误(HTTP ${status})，请稍后重试。`;
  if (status) return `API 返回 HTTP ${status}（${url}）。可先用 curl 区分是上游拒绝还是 MCP 映射问题。`;
  if (err.code === "ECONNABORTED") return `请求超时(${CONF.timeout}ms)：远程 API 无响应。`;
  if (err.code) return `网络错误(${err.code})：无法连接 ${CONF.base}`;
  return `请求 ${url} 失败：${err.message || "未知错误"}`;
}

export async function apiGet(url, params) {
  log("GET", url, params || {});
  const resp = await client.get(url, { params });
  const data = resp.data;
  log("RESP", url, `HTTP ${resp.status}`, typeof data === "object" ? `keys=${Object.keys(data).join(",")}` : "");

  // RuoYi 风格：HTTP 200 但 body 携带业务错误码（如 code:401 认证失败）
  if (
    data && typeof data === "object" && !Array.isArray(data) &&
    data.code !== undefined && data.code !== 200 && data.code !== 0 &&
    data.rows === undefined && data.data === undefined && data.list === undefined
  ) {
    const err = new Error(data.msg || `业务错误 code=${data.code}`);
    // 伪装成 axios 错误形态，让 friendlyError 和重试逻辑统一处理
    err.response = { status: data.code, data };
    throw err;
  }
  return data;
}
