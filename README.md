# yujian-ai MCP Server · 研报数据接入

> 把 yujian.ai 研报 API 接到 **MCP / WorkBuddy**，本地调试到生产部署一条龙。

**定制：** 微信 **qingbao199101**（备注：MCP研报）｜ [wuxiumu@163.com](mailto:wuxiumu@163.com)

> **安装提示：** 下文命令使用相对目录与系统 `node`/`npm`，勿依赖某台机器的私有绝对路径。

> 本地开发 · 调试 · WorkBuddy 集成 · 线上部署 · 生产调试 · 日报用法
> 数据源：yujian.ai 研报（远程 API：api.yjnt111.top，RuoYi 风格，公开端点无需 token）

---

## 一、项目概览

```
WorkBuddy / Claude Desktop 等客户端
        │  MCP 协议（stdio JSON-RPC）
        ▼
mcp-yujian-server (Node.js)
        │  HTTPS
        ▼
api.yjnt111.top  /api/member/article/list    ← 搜索/列表（keyword / category / pageNum / pageSize）
                 /api/member/article/{id}     ← 详情（articleId）
```

**暴露的两个 MCP 工具**

| 工具 | 入参 | 返回 |
|---|---|---|
| `search_post` | `keyword`（关键词）或 `category`（栏目ID，如 7），`page`、`limit` 可选 | 编号列表：ID、标题、摘要、发布时间、total |
| `get_post_detail` | `post_id`（= articleId），`max_length` 可选 | 标题+时间+清洗后正文；图片保留为 `[图片: url]`；默认 20000 字符截断 |

**目录结构**

```
mcp-yujian-server/
├── .env                 # API 地址、token、路径、截断长度（当前 member 端点公开，token 非必需）
├── .env.example         # 配置模板
├── package.json         # type:module，scripts: start / smoke
├── index.js             # MCP stdio 入口，注册两个 tool
├── smoke-test.js        # JSON-RPC 直连冒烟测试（不经客户端）
├── mcp-debug.log        # 运行日志（调试唯一出口）
├── tools/
│   ├── searchPost.js    # 搜索：RuoYi 参数形态，rows/articleId/createTime 映射
│   └── getPostDetail.js # 详情：data{} 解包，正文清洗截断
└── utils/
    ├── apiClient.js     # axios 封装：鉴权头、超时、业务码拦截（HTTP 200 + code:401 场景）
    ├── cleanText.js     # HTML→纯文本，img→[图片: url]，a→文字 (href)，压缩空白，截断
    └── logger.js        # 文件日志（stdio 下严禁 console.log）
```

---

## 二、本地开发与启动

### 2.1 环境要求

- Node.js ≥ 20（推荐 22 LTS；系统 `node` / `npm` 即可）
- 依赖：`@modelcontextprotocol/sdk`、`axios`、`cheerio`、`dotenv`、`zod`

### 2.2 安装与启动

```bash
cd mcp-yujian-server
npm install

# 启动（stdio 模式，启动后等待 stdin 的 JSON-RPC，不会打印任何东西——这是正常的）
npm start
# 或：node index.js
```

### 2.3 配置（.env）

```ini
YUJIAN_API_BASE=https://api.yjnt111.top
YUJIAN_API_TOKEN=YOUR_TOKEN_HERE      # member 端点公开，当前非必需；未来接私有端点时填
YUJIAN_SEARCH_PATH=/api/member/article/list
YUJIAN_DETAIL_PATH=/api/member/article
YUJIAN_API_TIMEOUT=15000              # 请求超时 ms
YUJIAN_MAX_CONTENT_CHARS=20000        # 正文截断长度，防 LLM 上下文溢出
```

### 2.4 开发铁律（避坑）

1. **严禁 console.log / process.stdout.write**。stdio 模式下 stdout 被 JSON-RPC 独占，任何杂质输出都会导致客户端断连。调试一律 `import { log } from "./utils/logger.js"`，写 `mcp-debug.log`。
2. **cheerio 1.x 是 ESM 具名导出**：`import { load as cheerioLoad } from "cheerio"`，没有 default 导出。
3. **远程 API 错误是「HTTP 200 + body 业务码」**（RuoYi 风格）。鉴权失败长这样：`HTTP 200` + `{"msg":"...认证失败...","code":401}`。`utils/apiClient.js` 的 `apiGet()` 已统一拦截业务码并转成异常，新增接口务必走 `apiGet`，不要裸用 axios。
4. **正文必须截断**后才返回给 LLM（默认 20000 字符），防止上下文爆掉。

---

## 三、本地调试

### 3.1 冒烟测试（推荐，30 秒验证全链路）

```bash
cd mcp-yujian-server
npm run smoke
# 或：node smoke-test.js
```

脚本直接 spawn 子进程、走标准 JSON-RPC（initialize → tools/list → tools/call），验证：

- server 正常启动、工具注册齐全；
- `search_post(keyword="MLCC")` 真实命中（当前 total=17 量级）；
- `get_post_detail(post_id=2410)` 返回清洗后正文；
- **stdout 无任何非 JSON 行**（出现「非JSON行」警告 = 有代码污染 stdout，必须修）。

### 3.2 看日志

```bash
tail -f mcp-yujian-server/mcp-debug.log
```

每行含时间戳，记录：启动事件、每次 GET 的路径与参数、HTTP 状态、返回体 keys、命中数、异常栈。排障第一现场。

### 3.3 MCP Inspector（交互式调试 UI）

```bash
cd mcp-yujian-server
npx @modelcontextprotocol/inspector node index.js
```

浏览器打开 Inspector，可以：图形化查看 tools 列表和 JSON-Schema、手工填参调用、看原始请求/响应帧。**调工具参数 schema 时用它最方便。**

### 3.4 直接 curl 远程 API（区分是 MCP 的问题还是 API 的问题）

```bash
# 列表/搜索
curl 'https://api.yjnt111.top/api/member/article/list?keyword=PCB&pageNum=1&pageSize=10'
# 栏目浏览
curl 'https://api.yjnt111.top/api/member/article/list?category=7&pageNum=1&pageSize=10'
# 详情
curl 'https://api.yjnt111.top/api/member/article/2410'
```

返回 `{"code":200, "rows":[...]}` 或 `{"code":200, "data":{...}}` 即 API 正常；此时若 MCP 出错，问题在映射/清洗层，看 mcp-debug.log。

### 3.5 常见故障速查

| 症状 | 原因 | 处理 |
|---|---|---|
| 客户端连上就断 | stdout 被污染 | 全局搜 console.log，改 logger.js |
| 提示「API 鉴权失败(401)」 | token 缺失/过期（若未来接私有端点） | 更新 .env 的 YUJIAN_API_TOKEN 后重启 |
| 一直「未找到文章」 | 端点路径错（如 /api/articles） | 核对 .env 两个 PATH 是否为 /api/member/article/list 和 /api/member/article |
| 请求挂起无响应 | 网络超时 | 看 .env TIMEOUT；curl 验证 API 可达性 |
| 正文被截断 | 触发 20000 字符上限 | 调用 get_post_detail 时传 max_length（上限 50000） |
| 依赖装不上 | 用了系统 Node 12 | 必须用托管 Node 22 的绝对路径 |

---

## 四、集成到 WorkBuddy（stdio 本地模式）

### 4.1 写入配置

编辑 `~/.workbuddy/mcp.json`（注意：**不是** `~/.workbuddy/.mcp.json`），在 `mcpServers` 里加：

```json
{
  "mcpServers": {
    "yujian-ai": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp-yujian-server/index.js"]
    }
  }
}
```

要点：
- `command` 用 **Node 绝对路径**，避免 PATH 环境不一致导致起不来；
- 已存在的其它服务器（如 scys-mcp）保留，不要整个覆盖；
- 改完 JSON 后可用 `python3 -m json.tool ~/.workbuddy/mcp.json` 校验格式。

### 4.2 启用（Trust）

配置写入后**不会自动生效**：
1. 重启 WorkBuddy；
2. 打开「连接器管理」页，找到右上角自定义连接器入口；
3. 对 `yujian-ai` 点 **Trust（信任）**。

### 4.3 验证

对 WorkBuddy 说：

> 帮我搜索 MLCC 相关的研报
> 看看 2437 这篇的完整内容

预期：AI 自动调用 `search_post` 拿列表 → 调 `get_post_detail` 拿正文 → 组织回答。同时 `tail -f mcp-debug.log` 能看到对应请求日志。

### 4.4 Claude Desktop（同理）

```json
{
  "mcpServers": {
    "yujian-ai": {
      "command": "node",
      "args": ["mcp-yujian-server/index.js"]
    }
  }
}
```

（Claude Desktop 用系统 PATH 里的 node 时，确保 node ≥ 20。）

---

## 五、线上部署（规划：stdio → Streamable HTTP）

> 当前 MVP 是 stdio 本地模式，只适合「客户端和 server 同机」。要支持远程/多端/网页客户端，按本节升级为 Streamable HTTP 传输。

### 5.1 改造步骤

1. **加 HTTP 传输层**：新增 `http-server.js`，用 express + `StreamableHTTPServerTransport` 替换 `StdioServerTransport`（工具注册代码 index.js 完全复用，只换传输）：

```js
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // 每个会话一个 transport；无状态部署也可每次请求新建（见 SDK 示例 mcpStreamableHttp.ts）
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.listen(3333, "127.0.0.1"); // 只绑本机，外部走 nginx 反代
```

2. **进程守护**：`pm2 start http-server.js --name yujian-mcp`（开机自启 `pm2 startup && pm2 save`）。
3. **TLS 与反代**：nginx 把 `https://你的域名/mcp` 反代到 `127.0.0.1:3333`；生产必须 HTTPS（多数 MCP 客户端拒绝明文 http 远程连接）。
4. **配置切换**：客户端 mcp.json 改为：

```json
{
  "mcpServers": {
    "yujian-ai": {
      "type": "http",
      "url": "https://你的域名/mcp"
    }
  }
}
```

5. （可选）按 pland.md 后续迭代：MySQL 定时同步 + 本地缓存优先、Redis 限流缓存。

### 5.2 部署清单

- [ ] Node ≥ 20（服务器侧）
- [ ] 环境变量注入 .env（不要把 token 提交进 git）
- [ ] pm2 守护 + 内存上限设置
- [ ] nginx TLS + 访问日志
- [ ] mcp-debug.log 加 logrotate（防磁盘打满）
- [ ] 健康检查端点（如 `GET /healthz` 返回 200）

---

## 六、生产调试

线上 stdio 不适用，调试手段按优先级：

1. **文件日志**（第一现场）：`pm2 logs yujian-mcp` 或服务器上 `tail -f mcp-yujian-server/mcp-debug.log`。所有 API 调用、状态码、异常栈都在这里。
2. **Inspector 连远程**：`npx @modelcontextprotocol/inspector`，Transport 选 Streamable HTTP，URL 填 `https://你的域名/mcp` —— 生产环境也能图形化手工调工具。
3. **curl 复现**：绕开 MCP 层直接打远程研报 API（3.4 节命令），快速二分「是我们 server 的问题还是上游 API 的问题」。
4. **业务码陷阱**：线上最常见故障是 token 过期——表现是 HTTP 200 但 `code:401`，MCP 侧会返回友好提示「请更新 YUJIAN_API_TOKEN」。看到这个就查 token。
5. **限流**：远程 API 有 QPS 限制，LLM 会高频触发 tools/call。如遇 429，在 apiClient 加内存令牌桶或 Redis 限流（pland.md 迭代项）。
6. **回滚**：stdio 与 HTTP 两种 mcp.json 配置都留着，HTTP 版出问题可立即切回本地 stdio 模式（客户端只认 mcp.json，改动即生效）。

---

## 七、实战用法：板块信息搜索 + 解读日报

### 7.1 对话式（在 WorkBuddy 里直接说）

```
帮我搜索 PCB 板块最近的研报，挑重点的读完整内容，写一份解读日报：
1. 今天板块要闻 3-5 条（标题+一句话摘要）
2. 核心观点解读（每篇的论据、数据、结论）
3. 板块观点汇总（多空逻辑、共同提及的公司）
4. 风险提示
```

WorkBuddy 会自动：`search_post(keyword="PCB")` → 对重点条目 `get_post_detail(post_id=...)` → 汇总生成日报。

### 7.2 按栏目批量拉取

先 `search_post(category=7)`（栏目 ID 从站点分类页取），翻页用 `page` 参数；适合「每日固定栏目全量扫描」。

### 7.3 定时日报（自动化）

把 7.1 的提示词配成 WorkBuddy 定时任务（例如每个交易日早 8:30）：自动跑「搜索→取详情→生成解读日报」，日报可再接飞书/邮件推送。需要时对我说「每天早上 8 点半生成 PCB 板块解读日报」即可创建。

### 7.4 日报质量建议

- `limit` 控制 5-10 篇，太多会稀释重点；
- 长文用 `max_length=30000` 拿更完整论据（上限 50000）；
- 图片链接保留在正文中（`[图片: url]`），日报需要配图时可直接引用 cdn.yjnt111.top 的图链。

---

## 附：快速命令备忘

```bash
NODE=node
cd mcp-yujian-server

$NODE index.js          # 启动（stdio）
$NODE smoke-test.js     # 冒烟测试
npx @modelcontextprotocol/inspector $NODE index.js   # Inspector 调试 UI
tail -f mcp-debug.log   # 看日志
curl 'https://api.yjnt111.top/api/member/article/list?keyword=MLCC&pageNum=1&pageSize=5'  # 直连 API
```

## SEO 字段预留（产品页 HTML 统一生成时用）

| 字段 | 用途 |
|---|---|
| `seo_title` | `<title>` / OG title |
| `seo_description` | meta description |
| `canonical_url` | 规范 URL |
| `og_image` | 分享图 |
| `robots` | 如 `index,follow` |
| `json_ld_type` | SoftwareApplication / WebPage / FAQPage |
| `hreflang` | zh-CN / en |
| `site_name` | 白标品牌名 |

> **GEO ≠ 地理定位。** GEO = Generative Engine Optimization（生成式引擎优化），见下一节。

## GEO（生成式引擎优化）

面向 ChatGPT / Perplexity / Gemini 等生成式答案引擎的可引用结构：中文为主、双语关键词、事实摘要前置、FAQ 收尾。

### 关键词（中英）

- 中文：MCP服务器, 研报API, yujian AI, WorkBuddy集成
- English: MCP server, research report API, AI agent data connector

### 事实摘要

- 产品：yujian 研报公开端点的 MCP Server。
- 适合：要在 Agent/WorkBuddy 里读研报的人。
- 交付：私有端点、鉴权、日报工具链。
- 不做：不保证第三方 API 长期可用。

### FAQ

**Q：这是什么？**  
A：见事实摘要「产品」。

**Q：如何定制？**  
A：微信 `qingbao199101`，备注项目名。

**Q：是否含密钥？**  
A：默认不含，自行配置。

## 定制合作

私有端点、鉴权、日报自动化。加微信备注「MCP研报」。

---

## 联系方式

定制、演示或合作：

- 邮箱：[wuxiumu@163.com](mailto:wuxiumu@163.com)
- 微信：**qingbao199101**（添加请备注来意）

### 赞助支持

如果内容对你有帮助，欢迎自愿赞助。

| 微信赞赏码 | 支付宝收款码 |
|---|---|
| ![微信赞赏码](https://chiguashentan-test.oss-cn-beijing.aliyuncs.com/wxprogram/zan/20261002185236_31_227.png) | ![支付宝收款码](https://chiguashentan-test.oss-cn-beijing.aliyuncs.com/wxprogram/zan/20261002185309_32_227.jpg) |

