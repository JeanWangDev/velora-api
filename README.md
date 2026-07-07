# Velora-api

Velora 交易所后端 — 基于 `trading-api` 脚手架迁移。

## 环境

| 场景 | `NODE_ENV` | 配置文件 | 端口 |
|------|------------|----------|------|
| 本地开发 | `development` | `.env.development` | 4000 |
| 测试服 | `development` | `.env.development`（PORT=4001） | 4001 |
| 生产 | `production` | `.env.production` | 4000 |

## 本地启动

```bash
cp .env.example .env.development   # 首次
yarn install
yarn dev                           # http://localhost:4000
```

`DB_ENABLED=false` 时可无数据库启动（仅 health / 行情代理）。

**本地联调**：端口必须为 **4000**（与 Velora-web `.env.local` 中 `API_PROXY_TARGET` 一致）。

```bash
curl http://localhost:4000/health   # 应返回 velora-api-development
```

## 部署

```bash
yarn deploy:test   # PM2: velora-api-test → 4001
yarn deploy:prod   # PM2: velora-api → 4000
```

### 测试服（velora-api-test.aipassly.com）

```bash
cp .env.server-test.example .env.development   # 填 TiDB / JWT / Didit 等
yarn deploy:test

# 仅 API 需要 Nginx（前端走 Cloudflare Workers）
sudo ./scripts/setup-nginx-test.sh
sudo certbot --nginx -d velora-api-test.aipassly.com
```

前端（velora-test.aipassly.com）在 `Velora-web`，与 trading-client 相同：

```bash
yarn deploy:test   # OpenNext → Cloudflare Worker velora-web-test
# 在 Cloudflare 控制台把 velora-test.aipassly.com 绑到该 Worker
```

## 文档

产品与技术文档见 `../velora-prd/`。
