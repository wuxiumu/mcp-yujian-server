import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchPost } from "./tools/searchPost.js";
import { getPostDetail } from "./tools/getPostDetail.js";
import { log } from "./utils/logger.js";

/**
 * 共享工具注册：stdio（index.js）与 HTTP（http-server.js）共用同一套 server 实例
 */
export function createYujianServer() {
  const server = new McpServer({
    name: "yujian-ai",
    version: "1.0.0",
  });

  server.tool(
    "search_post",
    "检索 yujian.ai 研报文章。可按关键词搜索（如 MLCC、CPO、储能、美股、油价、PCB），或按栏目 category 浏览（数字栏目ID，如 7）。返回文章ID、标题、摘要、发布时间。",
    {
      keyword: z.string().optional().describe("搜索关键词，如 MLCC / CPO / 储能 / 美股"),
      category: z.number().optional().describe("栏目 ID（数字），如 7"),
      page: z.number().optional().describe("页码，默认 1"),
      limit: z.number().optional().describe("每页条数 1-20，默认 5"),
    },
    async (args) => {
      try {
        return await searchPost(args);
      } catch (err) {
        log("search_post fatal:", err?.stack || err);
        return { content: [{ type: "text", text: `工具内部错误：${err?.message || err}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_post_detail",
    "按 post_id（即 articleId）获取单篇研报完整正文。HTML 已清洗为纯文本，图片以 [图片: url] 保留，超长自动截断。",
    {
      post_id: z.number().describe("文章 ID（来自 search_post 结果中的 ID）"),
      max_length: z.number().optional().describe("正文最大字符数 500-50000，默认 20000"),
    },
    async (args) => {
      try {
        return await getPostDetail(args);
      } catch (err) {
        log("get_post_detail fatal:", err?.stack || err);
        return { content: [{ type: "text", text: `工具内部错误：${err?.message || err}` }], isError: true };
      }
    }
  );

  return server;
}
