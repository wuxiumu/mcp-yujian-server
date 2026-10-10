#!/usr/bin/env node
/**
 * 冒烟测试：不经 Claude/WorkBuddy，直接用 JSON-RPC over stdio 驱动 MCP server
 * 验证 initialize → tools/list → tools/call。
 * 公开 member 端点应返回文章列表与正文；协议错误或工具 isError 时退出码为 1。
 * 用法：npm run smoke
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

function fail(msg) {
  console.error("!!", msg);
  clearTimeout(timeout);
  child.kill();
  process.exit(1);
}

const init = await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke-test", version: "0.0.1" },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });
console.log("== initialize:", init.result?.serverInfo);
if (!init.result?.serverInfo?.name) fail("initialize 未返回 serverInfo");

const tools = await request("tools/list", {});
const names = tools.result?.tools?.map((t) => t.name) || [];
console.log("== tools:", names.join(", "));
for (const need of ["search_post", "get_post_detail"]) {
  if (!names.includes(need)) fail(`tools/list 缺少 ${need}`);
}

const search = await request("tools/call", {
  name: "search_post",
  arguments: { keyword: "MLCC", limit: 3 },
});
const text = search.result?.content?.[0]?.text || "";
console.log("== search_post isError:", search.result?.isError === true);
console.log("== search_post 返回前200字:", text.slice(0, 200));
if (search.result?.isError === true || !/\[\d+\]/.test(text)) {
  fail("search_post 未返回带文章 ID 的列表");
}

const detail = await request("tools/call", {
  name: "get_post_detail",
  arguments: { post_id: 2410 },
});
const detailText = detail.result?.content?.[0]?.text || "";
console.log("== get_post_detail isError:", detail.result?.isError === true);
console.log("== get_post_detail 返回前200字:", detailText.slice(0, 200));
if (detail.result?.isError === true || !detailText.trim()) {
  fail("get_post_detail 未返回正文");
}

clearTimeout(timeout);
child.kill();
if (process.exitCode) process.exit(process.exitCode);
console.log("\n冒烟测试完成：进程正常收发 JSON-RPC，无 stdout 污染。");
