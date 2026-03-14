# Standalone Service

[English](README.md)

**Standalone Service** 将 WebUI 包装成一个同源网关服务 —— 静态资源托管与后端 API 代理从同一进程、同一端口提供，彻底规避 CORS 与 Cookie 问题。

**功能：**

- 托管 WebUI 静态资源
- 将 `/api/*`（qBittorrent）和 `/transmission/*`（Transmission）反向代理到配置的后端实例
- 提供服务器切换面板（支持预置凭证、延迟显示）
- 将服务器目录持久化到加密 SQLCipher 数据库，并支持在浏览器内直接编辑配置

**运行时语义：**

- 服务器切换通过 `tm_server_id` cookie 记录；cookie 无效或所选服务器被移除时，会自动回退到当前默认服务器。
- qBittorrent 代理请求遇到 403 时，网关会强制重新登录并只重试一次。
- 保存新的服务器目录后，runtime 会清理已有 qB 会话缓存，确保后续请求使用新配置。

## 配置

服务将运行时配置保存在 `STANDALONE_DB` 指向的加密 SQLCipher 数据库中（默认：`/config/catalog.db`）。数据库包含默认服务器选择、服务器元数据、用户名和密码等信息。

### 主密钥解析

- `TORRENTMIX_DB_KEY` —— authoritative 主密钥。只要显式提供，就直接使用；若无法解锁数据库，启动立即失败。
- OS Key provider —— 仅在未设置 `TORRENTMIX_DB_KEY` 时尝试使用。适合非容器环境；在容器里通常不可用。
- 没有可用 key source —— 启动失败。服务端**不会**自动生成无人管理的密钥。

### 环境变量

| 变量 | 说明 |
|------|------|
| `LISTEN_ADDR` | 监听地址（默认 `:8080`） |
| `STATIC_DIR` | 前端静态资源目录（默认 `/app/dist`） |
| `STANDALONE_DB` | 加密 SQLCipher 配置库路径（默认 `/config/catalog.db`） |
| `TORRENTMIX_DB_KEY` | 显式 SQLCipher 主密钥；Docker、systemd、CI 推荐设置 |

> 旧的 `standalone.json` / `config.example.json` 现在只作为参考材料保留，runtime 不再读取它们。

## Docker

**构建：**

```bash
docker build -t torrentmix-standalone-service -f deploy/standalone-service/Dockerfile .
```

**运行**（推荐挂载 `/config` 并显式提供主密钥）：

```bash
docker run --rm -p 8080:8080 \
  -e TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
  -v torrentmix-catalog:/config \
  torrentmix-standalone-service
```

访问 `http://localhost:8080` 后，通过 **切换服务器 → 管理服务器** 创建第一个后端。

> **在浏览器内编辑配置：** 变更会写回 `STANDALONE_DB`。密码不会回显，留空表示保持原值不变。

## 二进制（本地构建）

```bash
# 方式 1：本机 Rust 工具链（推荐）
cargo build --manifest-path rust/Cargo.toml --release -p standalone-service

# macOS / Linux
STANDALONE_DB=/tmp/torrentmix/catalog.db \
TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
LISTEN_ADDR=:8080 \
./rust/target/release/standalone-service

# Windows（PowerShell）
$env:STANDALONE_DB = 'C:\torrentmix\catalog.db'
$env:TORRENTMIX_DB_KEY = 'replace-with-a-long-random-string'
$env:LISTEN_ADDR = ':8080'
.\rust\target\release\standalone-service.exe

# 方式 2：在 Docker 内构建（无需本地 Rust 环境）
docker run --rm -v "$PWD:/work" -w /work rust:1.88-alpine \
  sh -lc "apk add --no-cache build-base musl-dev perl pkgconf && cargo build --manifest-path rust/Cargo.toml --release -p standalone-service"
```
