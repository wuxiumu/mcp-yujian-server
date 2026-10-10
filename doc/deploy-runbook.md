# yujian-ai MCP Server 线上部署执行文档

> 目标：把 mcp-yujian-server 以 Streamable HTTP 模式部署到服务器，
> 通过 `https://mcp-yujian-server.xyxbot.com` 对外提供服务（服务器已配置端口转发 3333）。
> 部署完成后可被豆包、Cherry Studio、Cursor、WorkBuddy 等任意 MCP 客户端直连。

---

## 一、部署总览

```
豆包桌面端 / 其他 MCP 客户端
        │  HTTPS (Streamable HTTP + JSON-RPC)
        ▼
https://mcp-yujian-server.xyxbot.com/mcp
        │  服务器端口转发（已配好）→ 127.0.0.1:3333
        ▼
http-server.js（express + StreamableHTTPServerTransport，无状态模式）
        │  HTTPS
        ▼
api.yjnt111.top 研报 API（公开，无需 token）
```

| 项 | 值 |
|---|---|
| 服务目录 | `mcp-yujian-server/`（本仓库） |
| 入口 | `http-server.js` |
| 监听 | `0.0.0.0:3333` |
| MCP 端点 | `POST /mcp` |
| 健康检查 | `GET /healthz` → `{"ok":true,...}` |
| 进程守护 | pm2（命名 `yujian-mcp`） |
| 日志 | `mcp-debug.log`（业务日志）+ pm2 日志 |

**代码文件说明（本迭代新增）**

| 文件 | 作用 |
|---|---|
| `createServer.js` | 共享工具注册（stdio 与 HTTP 共用，避免两份代码漂移） |
| `http-server.js` | HTTP 入口：express + SDK 自带 createMcpExpressApp（含 DNS 重绑定防护，allowedHosts 已配域名） |
| `http-smoke-test.js` | HTTP 全链路冒烟测试（healthz → initialize → tools/list → search → detail） |
| `index.js` | stdio 入口（已重构为调用 createServer.js，行为不变） |

---

## 二、服务器部署步骤

### 步骤 1：上传代码到服务器

只上传源码文件，不传 node_modules：

```bash
# 在本仓库根目录执行。不打包依赖、日志和本机 .env（含 token）。
tar --exclude='node_modules' \
    --exclude='mcp-debug.log' \
    --exclude='.env' \
    -czf /tmp/mcp-yujian-server.tar.gz .

scp /tmp/mcp-yujian-server.tar.gz root@你的服务器IP:/opt/
ssh root@你的服务器IP
mkdir -p /opt/mcp-yujian-server
tar -xzf /opt/mcp-yujian-server.tar.gz -C /opt/mcp-yujian-server
cd /opt/mcp-yujian-server
```

### 步骤 2：服务器安装 Node ≥ 20 与依赖

```bash
# Node 22（如已装可跳过）
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && yum install -y nodejs   # CentOS
# 或 Debian/Ubuntu：
# curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
node -v   # 确认 ≥ 20

npm install --omit=dev --no-fund --no-audit
cp .env.example .env   # member 端点公开无需 token，默认即可
```

### 步骤 3：前台试跑 + 冒烟

```bash
node http-server.js &
curl http://127.0.0.1:3333/healthz
# 期待 {"ok":true,"service":"yujian-ai",...}
node http-smoke-test.js http://127.0.0.1:3333
# 期待 5 项全过：healthz OK / initialize / tools / search / detail
kill %1
```

### 步骤 4：pm2 守护

```bash
npm install -g pm2
pm2 start http-server.js --name yujian-mcp --cwd /opt/mcp-yujian-server
pm2 save
pm2 startup   # 按提示复制执行输出的命令，实现开机自启
pm2 logs yujian-mcp --lines 20   # 确认 listening on 0.0.0.0:3333
```

### 步骤 5：域名链路验收

```bash
curl https://mcp-yujian-server.xyxbot.com/healthz
# 期待 {"ok":true,"service":"yujian-ai",...}

node http-smoke-test.js https://mcp-yujian-server.xyxbot.com
# 期待全过
```

⚠️ **当前状态（2026-09-21）**：域名已转发但 3333 上跑的是别的 Express 应用（返回 HTML 404 `Cannot GET /healthz`）。
部署后用上面第一条命令验收——**返回 JSON 才是我们的服务**；如果还是 HTML，说明端口转发指错了进程/容器，去面板检查 3333 的转发目标。

### 部署检查清单

- [ ] Node ≥ 20，npm install 完成
- [ ] pm2 status 里 yujian-mcp online，restart 计数不再增长
- [ ] `curl https://mcp-yujian-server.xyxbot.com/healthz` 返回 JSON
- [ ] `node http-smoke-test.js https://mcp-yujian-server.xyxbot.com` 全过
- [ ] pm2 startup 已执行（重启自愈）
- [ ] `mcp-debug.log` 配 logrotate（见运维小节）
- [ ] 如 nginx 层可配：`proxy_read_timeout 300s`（防长文工具调用超时）；如无权改 nginx，跳过
- [ ] 可选：域名接入 CDN/防火墙时放行 POST /mcp
- 验收通过后，用 doc/doubao-test.md 走豆包实测；WorkBuddy 本地 stdio 见 doc/workbuddy-mcp.md。

---

## 三、生产调试速查

| 症状 | 排查 | 处理 |
|---|---|---|
| 域名 /healthz 返回 HTML | 3333 被其他进程占用 | `lsof -i:3333`；pm2 restart 前先停旧进程 |
| 域名 502/504 | 转发配置指向错或服务挂了 | 服务器内 curl 127.0.0.1:3333/healthz 分层定位 |
| 豆包连上但调用超时 | 正文太长/网络慢 | .env 调 YUJIAN_MAX_CONTENT_CHARS；调小 max_length 重试 |
| 调用返回 HTTP 403 | DNS 重绑定防护拦截 | 确认客户端 Host 头是域名；http-server.js allowedHosts 加对应域名 |
| 调用返回 406/415 | Accept 头不含 json | 客户端正常发 application/json 即可；curl 测试加 `-H 'Accept: application/json'` |
| 想看谁在调 | `tail -f mcp-debug.log` | 每次请求有 ip + 请求体前 200 字 |
| 想临时下线 | `pm2 stop yujian-mcp` | 恢复 `pm2 start yujian-mcp` |

**日志轮转（防磁盘打满）**：

```bash
sudo tee /etc/logrotate.d/yujian-mcp <<'EOF'
/opt/mcp-yujian-server/mcp-debug.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    copytruncate
}
EOF
```

---

## 四、回滚方案

- 代码回滚：保留上一版 tar 包，解压覆盖后 `pm2 restart yujian-mcp`
- 完全下线：`pm2 delete yujian-mcp && pm2 save`，域名转发保留（返回 502）
- WorkBuddy 本地 stdio 模式不受任何影响（index.js 独立运行），线上出问题本地照用

---

## 五、下一步（可选迭代，pland.md 遗留）

1. MySQL 定时同步 + 本地缓存优先、回源 API 兜底
2. Redis/内存限流（防 LLM 高频触发上游 QPS 限制）
3. Bearer Token 鉴权层（如需对外开放给第三方）
