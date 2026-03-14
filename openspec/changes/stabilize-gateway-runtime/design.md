## Context

仓库现在已经具备 `Standalone Service` 与 `Desktop` 两种共享 runtime 形态，两者都依赖 `rust/crates/gateway` 提供统一的静态资源托管、选服配置 API 与上游代理能力。`gateway-config-store` 这一前置变更已经把服务器目录和凭据持久化收敛到 SQLCipher 中，但运行时层面的关键语义仍然主要存在于代码实现里：

- `status` / `select` / `proxy` 是否共享同一套服务器选择逻辑
- 已保存的选服 cookie 在服务器被移除或配置更新后如何回退
- qB 的 cookie session 在 403 后是否只重试一次、是否与配置变更联动失效
- Rust runtime 是否在发布前得到足够验证

当前 Rust 侧已有一部分测试覆盖配置 API 和启动解锁行为，但对真正的 runtime 路径，如“切服后代理是否打到正确上游”，覆盖还不够完整。

## Goals / Non-Goals

**Goals:**
- 固定 `gateway` 的有效服务器选择语义，使 `status`、`select`、`proxy` 保持一致。
- 固定 qB 代理重登重试与配置更新后的 session/cache 失效行为。
- 为 `Standalone Service` / `Desktop` 共享 runtime 补上 Rust 自动化验证和发布前护栏。
- 与现有 SQLCipher 存储能力对齐，但不重定义其存储契约。

**Non-Goals:**
- 不在本次 change 中重做 SQLCipher schema、主密钥策略或配置 API 字段。
- 不在本次 change 中引入“每个 tab 独立选择服务器”或“无刷新切服”语义。
- 不处理纯前端直连模式下 `transClient` 单例隔离的全部问题；本次聚焦 gateway runtime。
- 不做 Tauri 全流程 UI 端到端自动化。

## Decisions

### 1. 将“有效服务器选择”定义为 cookie 优先、默认服务器回退的浏览器级语义

本次 change 保持当前 cookie 驱动模型：若 `tm_server_id` 指向有效服务器，则使用该服务器；否则回退到默认服务器；若目录为空则视为无可用上游。

- 这样可以与现有 `ServerSwitchMenu` 的 `location.reload()` 模式保持一致。
- 也避免把 change 扩展到“每 tab 独立选择”这种需要新状态模型的方向。

备选方案：
- 改成每 tab 独立状态：需要新的前端/后端协作协议，超出本次稳定性范围。
- 完全取消 cookie，仅使用默认服务器：会削弱多实例管理能力。

### 2. 运行时稳定性聚焦在 gateway 进程内行为，而不是前端 adapter 单例

本次 change 的核心对象是 `gateway` runtime 本身：选服、代理和 qB session 处理。前端 `transClient` 的单例隔离问题被视为相邻问题，但不纳入第一版范围。

- `Standalone Service` / `Desktop` 都通过网关实现同源代理，很多问题应优先在 gateway 边界收口。
- 这让 change 可以直接覆盖 Rust crate、standalone 二进制和桌面端壳，而不被纯前端直连模式稀释。

备选方案：
- 把前端 `transClient` 单例隔离也一起纳入：会把 change 拉回到“全模式网络层整理”，范围明显扩大。

### 3. 为 qB cookie 生命周期定义“单次强制刷新重试”语义

对 qB upstream，第一次代理请求若返回 403，则 gateway 强制重新登录并仅重试一次；配置更新后清理已有 qB session 缓存，确保后续请求使用新目录和新凭据。

- 该语义与当前实现方向一致，但缺少正式约束与完整测试。
- “仅重试一次”能避免死循环和难以诊断的重放行为。

备选方案：
- 无限/多次重试：会掩盖配置错误并放大异常流量。
- 完全不重试：用户体验更差，且与已有设计意图不一致。

### 4. 自动化验证优先用 Rust 路由/状态测试，而不是 Desktop 端到端

实现上优先在 `gateway` crate 内补充路由与状态级测试，验证：

- `status` / `select` / `proxy` 的选服一致性
- 配置更新后的默认选择与 cache/session 失效
- qB 403 强制重登重试

桌面端只补最小必要的启动/静态目录分辨验证，不做全套 Tauri UI E2E。

备选方案：
- 直接做完整 Desktop E2E：反馈慢、成本高，且很多问题本质上是 gateway 行为。

### 5. 将 Rust runtime 校验纳入发布前护栏

当前 release workflow 更偏 Node 前端链路，因此本次 change 应增加 Rust 侧的构建/测试门槛，至少保证 gateway runtime 在发布前被验证。

备选方案：
- 只靠本地手工运行 `cargo test`：对共享 runtime 来说不够稳。

## Risks / Trade-offs

- [Risk] cookie 驱动的服务器选择天然是浏览器级共享语义，用户可能误以为每个 tab 可独立切服。
  -> Mitigation: 在 spec 与设计中明确这是当前约束，不把其混成隐式行为。

- [Risk] qB 强制重登重试逻辑若实现不当，可能把真正的配置错误伪装成瞬时恢复。
  -> Mitigation: 限制为单次刷新重试，并用测试覆盖 403 之后的路径。

- [Risk] Rust 校验接入 CI 后会增加发布流程时长。
  -> Mitigation: 优先增加 gateway crate 相关测试与必要构建，不把 UI 端到端一起塞进 release 门槛。

- [Risk] 活跃但未归档的 `add-sqlcipher-config-store` change 仍存在，语义边界若不清晰容易与本次 change 混淆。
  -> Mitigation: 在 proposal/design 中明确本次只消费配置库存储能力，不重写其契约。

## Migration Plan

- 先补 gateway 运行时语义测试，再根据测试结果收敛行为修正。
- 在行为稳定后，把 Rust 校验接入 CI / release 前流程。
- 对外 API 形状尽量保持不变，避免影响现有前端 UI 和已保存目录。
- 如果发布门槛调整导致 CI 负担过大，可先将完整构建与最小必要测试拆分，但不回退选服/代理语义测试。

## Open Questions

- 是否需要在本次 change 中顺手把 `Standalone Service` 的最小二进制构建也纳入 release workflow。
- `Desktop` 是否需要额外的静态资源目录解析测试，还是由 gateway/runtime 级测试已经足够。
- 后续是否要单独开一个 change 处理前端 `transClient` 单例隔离与无刷新切服体验。
