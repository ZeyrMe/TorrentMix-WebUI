## Why

`Standalone Service` 与 `Desktop` 已经共享同一个 `gateway` runtime，但当前稳定性更多依赖实现约定而不是正式契约：服务器选择、代理目标切换、qB 会话刷新，以及 Rust 侧发布前验证都还缺少统一要求和足够的自动化覆盖。现在在继续扩展多后端管理能力之前，需要先把运行时语义固定下来，避免“配置能保存，但实际代理到了错误上游”这类高成本问题。

## What Changes

- 明确 `gateway` 在 `status`、`select`、`proxy` 三条链路上的选服语义，包括默认服务器回退、未知 cookie 回退和配置变更后的有效选择行为。
- 明确 `gateway` 在代理阶段的稳定性要求，包括 qB 403 后的强制重登重试，以及配置更新后的 runtime 缓存/会话失效语义。
- 为 `Standalone Service` 与 `Desktop` 共享的 runtime 增加 Rust 侧验证护栏，并把关键校验接到 CI / 发布前流程。
- 保持现有 SQLCipher 配置库存储方案不变，把它作为前置能力而非本次 change 的主目标。

## Capabilities

### New Capabilities
- `gateway-server-selection`: 约束 `gateway` 如何在默认服务器、选择 cookie 和配置变更之间确定有效上游。
- `gateway-proxy-session-stability`: 约束 `gateway` 在 qB 认证刷新、代理重试与配置更新后的会话失效行为。
- `gateway-runtime-verification`: 约束 `Standalone Service` / `Desktop` 共享 runtime 的自动化验证与发布前护栏。

### Modified Capabilities
- None.

## Impact

- Affected code: `rust/crates/gateway/src/lib.rs`, `rust/crates/gateway/src/catalog.rs`, `rust/crates/gateway/src/key.rs`, `rust/apps/desktop/src-tauri/src/main.rs`, `.github/workflows/release.yml`, `rust/**/tests`（或内联测试模块）。
- Affected APIs: `__standalone__/status`, `__standalone__/select`, `__standalone__/config`, `/api/*`, `/transmission/*`。
- Systems: `Standalone Service`, `Desktop`, shared `gateway` runtime, Rust-side CI / release verification.
- Dependencies: 继续复用现有 Rust 测试栈与 GitHub Actions；如需发布前校验，优先扩展现有 workflow 而不是引入新的运行时依赖。
