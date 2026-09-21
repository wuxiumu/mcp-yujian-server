#!/usr/bin/env node
/**
 * 冒烟测试：不经 Claude/WorkBuddy，直接用 JSON-RPC over stdio 驱动 MCP server
 * 验证 initialize → tools/list → tools/call（search_post 应返回友好 401 提示而非崩溃）
 * 用法：node smoke-test.js
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const CHILD = path.join(__dirname, "index.js");

const child = spawn(NODE, [CHILD], { stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const pending = new Map();
let nextId = 1;

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("!! 非JSON行（若出现说明污染了stdout）:", line.slice(0, 200));
      process.exitCode = 1;
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
    }
  }
});

const timeout = setTimeout(() => {
  console.error("!! 超时：server 未响应");
  child.kill();
  process.exit(1);
}, 30000);

const init = await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke-test", version: "0.0.1" },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });
console.log("== initialize:", init.result?.serverInfo);

const tools = await request("tools/list", {});
console.log("== tools:", tools.result?.tools?.map((t) => t.name).join(", "));

const search = await request("tools/call", {
  name: "search_post",
  arguments: { keyword: "MLCC", limit: 3 },
});
const text = search.result?.content?.[0]?.text || "";
console.log("== search_post isError:", search.result?.isError === true);
console.log("== search_post 返回前200字:", text.slice(0, 200));

const detail = await request("tools/call", {
  name: "get_post_detail",
  arguments: { post_id: 2410 },
});
console.log("== get_post_detail isError:", detail.result?.isError === true);
console.log("== get_post_detail 返回前200字:", (detail.result?.content?.[0]?.text || "").slice(0, 200));

clearTimeout(timeout);
child.kill();
console.log("\n冒烟测试完成：进程正常收发 JSON-RPC，无 stdout 污染。");
