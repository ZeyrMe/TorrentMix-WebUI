# Changelog

## Unreleased

### Breaking changes

- Transmission RPC 默认地址调整：生产环境未设置 `VITE_TR_URL` 时，WebUI 将默认请求同源的 `/transmission/rpc`，不再默认指向 `http://localhost:9091/transmission/rpc`。

  Migration（任选其一）:

  1) 推荐：在同域反向代理 `/transmission/rpc` 到 Transmission。

  Nginx 示例：

  ```nginx
  location = /transmission/rpc {
    proxy_pass http://127.0.0.1:9091;
  }
  ```

  Caddy 示例：

  ```caddy
  handle /transmission/rpc* {
    reverse_proxy 127.0.0.1:9091
  }
  ```

  2) 兼容旧行为：构建时显式设置 `VITE_TR_URL`（例如 `http://localhost:9091/transmission/rpc`）。

- CSP 默认收紧：生产构建的 `index.html` 将 `connect-src` 限制为 `'self'`，跨域直连后端（例如 `ui.example.com` → `qb.example.com`）会被浏览器直接拦截。

  Migration（任选其一）:

  1) 推荐：同源反向代理（例如通过 Nginx/Caddy 把 `/api/*` 与 `/transmission/*` 反代到后端），让 WebUI 与后端 API 走同一个 Origin。

  2) 如必须跨域：自行修改 `index.html` 的 CSP `connect-src` 放通目标 Origin（并同时确保后端 CORS/凭证策略安全）。

- 分发产物调整：不再发布 `portable.html`（离线单文件），D 模式核心产物收敛为 `dist.zip`。

  Migration：

  1) 从 Releases 下载 `dist.zip`。

  2) 解压到后端 WebUI 目录（目录根应包含 `index.html`），刷新即可生效。

### Security

- Transmission Basic Auth 凭证不再以明文写入 sessionStorage：改为 AES-GCM 加密存储，密钥保存在 IndexedDB 中的不可导出 CryptoKey；无 IndexedDB 的环境降级为密钥与密文同存，加密失败时放弃持久化而非回退明文。

### Fixed

- Transmission 409 CSRF 重试增加次数上限（2 次），并在重试时显式覆盖请求配置中过期的 `X-Transmission-Session-Id`。
- 修复轮询在页面可见性恢复时可能并发出两条轮询链的竞态。
- 种子列表排序增加稳定次级键（id），避免轮询更新时同值行来回抖动。

### Changed

- 删除确认统一为应用内 `overlay.confirm`（原部分对话框使用原生 `confirm()`）。
- ETA 格式化收敛为 `utils/format.ts` 的 `formatEta`，列表行与卡片共用。

### Removed

- 删除脚手架残留 `HelloWorld.vue`、`vue.svg` 与已废弃的 `QbitV4Adapter`/`QbitV5Adapter` 兼容别名。
