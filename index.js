#!/usr/bin/env node
/**
 * yujian-ai MCP Server — stdio 入口（WorkBuddy / Claude Desktop 本地模式）
 * 工具注册逻辑在 createServer.js，与 http-server.js 共享。
 *
 * ⚠️ stdout 被 JSON-RPC 独占，严禁 console.log，调试走 utils/logger.js
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createYujianServer } from "./createServer.js";
import { log } from "./utils/logger.js";

const server = createYujianServer();
const transport = new StdioServerTransport();
await server.connect(transport);
log("=== mcp-yujian-server started (stdio) ===");
