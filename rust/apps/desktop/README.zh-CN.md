# Desktop（Tauri）

[English](README.md)

桌面端捆绑了与 Standalone Service 相同的 `gateway` crate，启动时绑定到 `127.0.0.1:0`，然后将 WebView 指向该端口。无需独立服务进程，即可获得完整的同源代理能力。

**功能：**

- 通过 HTTP 托管 WebUI 静态资源（`dist/`）
- 代理 `/api/*` 和 `/transmission/*` 到配置的后端实例
- 支持 Standalone 的服务器切换面板与可视化配置编辑器

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

应用默认读写系统 App Config 目录中的 `standalone.json`，可通过环境变量覆盖：

| 变量 | 说明 |
|------|------|
| `STANDALONE_CONFIG` | 配置文件路径 |
| `STATIC_DIR` | 前端静态资源目录（默认尝试 `./dist`） |
