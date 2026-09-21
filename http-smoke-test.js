#!/usr/bin/env node
/**
 * HTTP 冒烟测试：验证 Streamable HTTP 链路
 * 用法：node http-smoke-test.js [baseUrl]
 * 默认 baseUrl: http://127.0.0.1:3333
 */
const BASE = process.argv[2] || "http://127.0.0.1:3333";

async function rpc(method, params) {
  const resp = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const ct = resp.headers.get("content-type") || "";
  const text = await resp.text();
  let data = null;
  if (ct.includes("application/json")) {
    data = JSON.parse(text);
  } else if (ct.includes("text/event-stream")) {
    // SSE 格式：取 data: 行
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        try { data = JSON.parse(line.slice(5).trim()); } catch {}
      }
    }
  }
  return { status: resp.status, ct, data, raw: text };
}

// 1. 健康检查
try {
  const h = await fetch(`${BASE}/healthz`);
  console.log("== /healthz:", h.status, h.status === 200 ? "OK" : "FAIL");
  if (h.status !== 200) process.exit(1);
} catch (e) {
  console.error("!! 服务未启动或不可达：", e.message);
  process.exit(1);
}

// 2. initialize
const init = await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "http-smoke", version: "0.0.1" },
});
console.log("== initialize:", init.status, JSON.stringify(init.data?.result?.serverInfo || init.data?.error || init.raw.slice(0, 120)));
if (!init.data?.result) process.exit(1);

// 3. tools/list（无状态模式：需要带 initialize 里返回的 mcp-session-id 头时这里省略，
//    部分客户端要求同会话；无状态 server 每次请求重建，可直接调用）
const tools = await rpc("tools/list", {});
const names = tools.data?.result?.tools?.map((t) => t.name).join(", ");
console.log("== tools/list:", tools.status, names || tools.raw.slice(0, 160));
if (!names) process.exit(1);

// 4. tools/call: search_post
const search = await rpc("tools/call", {
  name: "search_post",
  arguments: { keyword: "储能", limit: 3 },
});
const sText = search.data?.result?.content?.[0]?.text || "";
console.log("== search_post(储能):", search.status, `isError=${search.data?.result?.isError === true}`);
console.log(sText.slice(0, 220));

// 5. tools/call: get_post_detail
const detail = await rpc("tools/call", {
  name: "get_post_detail",
  arguments: { post_id: 2410, max_length: 500 },
});
const dText = detail.data?.result?.content?.[0]?.text || "";
console.log("== get_post_detail(2410):", detail.status, `isError=${detail.data?.result?.isError === true}`);
console.log(dText.slice(0, 220));

console.log("\nHTTP 冒烟测试完成。");
