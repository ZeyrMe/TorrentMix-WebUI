# Desktop（Tauri）

[English](README.md)

桌面端捆绑了与 Standalone Service 相同的 `gateway` crate，启动时绑定到 `127.0.0.1:0`，然后将 WebView 指向该端口。无需独立服务进程，即可获得完整的同源代理能力。

**功能：**

- 通过 HTTP 托管 WebUI 静态资源（`dist/`）
- 代理 `/api/*` 和 `/transmission/*` 到配置的后端实例
- 支持 Standalone 的服务器切换面板与可视化配置编辑器
- 将运行时目录保存到加密 SQLCipher 数据库，前端不会直接接触原始凭据

**运行时语义：**

- Desktop 与 Standalone Service 共享同一套 `gateway` 选服与代理语义。
- 服务器选择仍由 `tm_server_id` cookie 驱动；无效 cookie 会回退到默认服务器。
- qBittorrent 代理请求遇到 403 时，runtime 会强制重新登录并只重试一次。

## 开发运行

**1. 构建前端：**

```bash
pnpm build
```

**2. 运行桌面端：**

```bash
cargo run --manifest-path rust/Cargo.toml -p torrentmix-desktop
```

## 配置

应用默认将运行时配置保存在系统 App Config 目录下的 `catalog.db` 中。

### 默认解锁行为

- 已设置 `TORRENTMIX_DB_KEY` → 直接作为 authoritative SQLCipher 主密钥使用。
- 未设置 `TORRENTMIX_DB_KEY` → 尝试走 OS Key 存储。
- 首次启动、数据库尚不存在且没有显式主密钥 → 自动生成一个数据库密钥并保存到 OS Key 存储。

### 环境变量

| 变量 | 说明 |
|------|------|
| `STANDALONE_DB` | 覆盖加密配置库路径 |
| `TORRENTMIX_DB_KEY` | 显式 SQLCipher 主密钥覆盖 |
| `STATIC_DIR` | 前端静态资源目录（默认尝试 `./dist`） |
