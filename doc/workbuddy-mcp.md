# WorkBuddy 接入 yujian-ai MCP

> 本地用 stdio。远程用已部署的 Streamable HTTP（`doc/deploy-runbook.md`）。
> 配置里的 Node 与仓库路径只放在本机 `mcp.json`，不要写进仓库或 `.env`。

---

## 一、接入前冒烟（不经 WorkBuddy）

要求 Node.js ≥ 20。在仓库根目录：

```bash
cp .env.example .env
npm install
npm run smoke
```

`npm run smoke` 用当前 `node` 拉起 `index.js`，走 JSON-RPC：`initialize` → `tools/list` → `search_post(keyword=MLCC)` → `get_post_detail(post_id=2410)`。

通过标准（否则退出码为 1）：

- `serverInfo` 正常返回；
- 工具列表包含 `search_post`、`get_post_detail`；
- 搜索结果里有 `[文章ID]`；
- 详情返回清洗后正文；
- stdout 没有非 JSON 行。

公开 member 端点不需要 token。`.env` 里 `YUJIAN_API_TOKEN` 留空。

HTTP 入口另测：先 `npm run start:http`，再 `npm run smoke:http`。

---

## 二、写入 WorkBuddy 配置

编辑 `~/.workbuddy/mcp.json`（不是 `~/.workbuddy/.mcp.json`），在已有 `mcpServers` 里追加，不要整文件覆盖：

```json
{
  "mcpServers": {
    "yujian-ai": {
      "type": "stdio",
      "command": "node",
      "args": ["<本仓库绝对路径>/index.js"]
    }
  }
}
```

- `command` 必须是 Node ≥ 20。若 WorkBuddy 的 PATH 里没有 `node`，改成 `command -v node` 的输出。
- `args` 换成这台机器上的 `index.js` 绝对路径。
- 校验：`python3 -m json.tool ~/.workbuddy/mcp.json`。

服务按 `doc/deploy-runbook.md` 上线后，可改为远程（先确认 `/healthz` 返回 JSON）：

```json
{
  "mcpServers": {
    "yujian-ai": {
      "type": "http",
      "url": "https://mcp-yujian-server.xyxbot.com/mcp"
    }
  }
}
```

远程冒烟：`node http-smoke-test.js https://mcp-yujian-server.xyxbot.com`。

---

## 三、启用与对话验收

配置写入后不会自动生效：

1. 重启 WorkBuddy；
2. 打开「连接器管理」，进入自定义连接器；
3. 对 `yujian-ai` 点 **Trust（信任）**。

新开对话：

```
帮我搜索 MLCC 相关的研报
看看列表里第一篇的完整内容
```

预期：先 `search_post`，再 `get_post_detail`。同时 `tail -f mcp-debug.log` 能看到对应 GET。

板块解读日报的话术仍用 README 第七节，这里不另写一套。

---

## 四、失败时先看哪

| 症状 | 处理 |
|---|---|
| 客户端连上就断 | 跑 `npm run smoke`，若出现「非JSON行」就是 stdout 被污染 |
| smoke 报未返回文章 ID | 用 README 3.4 的 curl 打列表接口，区分上游 API 和 MCP |
| 一直「未找到文章」 | `.env` 的两个 PATH 应为 `/api/member/article/list` 与 `/api/member/article` |
| 提示鉴权失败(401) | 公开端点把 `YUJIAN_API_TOKEN` 留空后重启；私有端点再更新 token |
