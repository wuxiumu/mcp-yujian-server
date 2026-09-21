#!/usr/bin/env node
/**
 * yujian-ai MCP Server — Streamable HTTP 入口
 * 端口：3333（nginx/宝塔已将 mcp-yujian-server.xyxbot.com 反代到此端口）
 * 端点：POST /mcp   （MCP Streamable HTTP）
 *       GET  /healthz（健康检查，返回 200 即活）
 *
 * 无状态模式（sessionIdGenerator: undefined）：每个 POST 请求新建 transport+server，
 * 兼容豆包/Cherry Studio/Cursor 等客户端的直连方式，水平扩展友好。
 */
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createYujianServer } from "./createServer.js";
import { log } from "./utils/logger.js";

const PORT = Number(process.env.PORT) || 3333;
const HOST = process.env.HOST || "0.0.0.0";

const app = createMcpExpressApp({
  host: HOST,
  // DNS 重绑定防护：只放行我们的域名和 localhost
  allowedHosts: [
    "mcp-yujian-server.xyxbot.com",
    "localhost",
    "127.0.0.1",
  ],
});

app.use(express.json());

// 健康检查
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "yujian-ai", ts: new Date().toISOString() });
});

// MCP 端点：无状态 Streamable HTTP
app.post("/mcp", async (req, res) => {
  log("HTTP /mcp", req.ip, JSON.stringify(req.body).slice(0, 200));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // 无状态：每次请求独立会话
    enableJsonResponse: true,      // 用 JSON 响应而非 SSE 流，兼容性最好
  });
  const server = createYujianServer();
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log("HTTP /mcp error:", err?.stack || err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
    }
  }
});

app.listen(PORT, HOST, () => {
  log(`=== yujian-ai MCP HTTP server listening on ${HOST}:${PORT}/mcp ===`);
});
