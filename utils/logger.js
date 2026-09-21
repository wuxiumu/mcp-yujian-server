import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, "..", "mcp-debug.log");

/**
 * MCP stdio 模式下 stdout 被 JSON-RPC 协议独占，
 * 任何 console.log 都会破坏协议流导致客户端断连。
 * 所有调试日志必须写本地文件。
 */
export function log(...args) {
  const line = `[${new Date().toISOString()}] ${args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ")}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch {
    /* 日志失败静默，绝不能抛到 stdio */
  }
}
