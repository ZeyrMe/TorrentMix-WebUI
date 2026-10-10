## Context

当前 `Standalone Service` 与 `Desktop` 共享 `gateway` crate，负责托管静态资源、代理 `/api/*` 与 `/transmission/*`、提供服务器切换和配置编辑接口。现状中，服务器目录与凭据直接保存在 `standalone.json`，`gateway` 启动时通过 JSON 读取并构建内存中的 `Catalog`，保存时再整体回写文件。

这个实现满足了当前功能，但存在三个结构性问题：
- 磁盘落地为明文，无法满足最基本的静态数据保护要求。
- `gateway` 的“配置模型”与“存储介质”完全耦合，初始化、保存、迁移都围绕 JSON 文件展开，难以扩展。
- `Desktop` 与 `Standalone Service` 明明都属于 gateway runtime，却没有统一的密钥解析和安全配置基座。

本次变更明确采用 `SQLite + SQLCipher` 作为新的配置中心，并在 `gateway` 内引入主密钥解析、数据库初始化和迁移骨架。因为目前没有线上用户与历史兼容负担，所以不设计老配置自动兼容；数据库将直接成为唯一真源。

## Goals / Non-Goals

**Goals:**
- 用 `SQLite + SQLCipher` 替代 `standalone.json`，让 `Standalone Service` 与 `Desktop` 共享同一套加密配置存储。
- 在 `gateway` 内引入统一的 `CatalogStore` 抽象，使 HTTP 层不再直接感知 JSON 或 SQL 细节。
- 引入统一的 `MasterKeyResolver`，同时支持环境变量和 OS Key 两种主密钥来源，并为不同运行壳定义默认策略。
- 在启动阶段完成数据库打开、密钥验证、schema 初始化和迁移执行。
- 保持前端现有 `__standalone__/config` 与 `__standalone__/status` 交互语义不变，使 UI 无感知底层变更。
- 提供最小但长期可扩展的迁移骨架，而不是一次性写死 schema 初始化逻辑。

**Non-Goals:**
- 不提供 `standalone.json` 到数据库的自动迁移或双写兼容。
- 不在本次变更中实现密钥轮换 UI、数据库导入导出、备份恢复等增强功能。
- 不改变 `Dist`、`Loader`、`Sidecar` 的运行模型，它们不引入本地配置数据库。
- 不解决运行时内存中的明文存在问题；本次只关注静态数据透明加密（TDE）。

## Decisions

### 1. 使用 `SQLite + SQLCipher` 作为唯一配置存储
- 选择理由：当前持久化对象天然是小型配置目录（默认服务器、服务器列表、用户名、密码），非常适合单文件数据库；SQLCipher 提供整库透明加密，满足“只需要 TDE”的阶段目标。
- 为什么不继续使用 JSON + 单字段加密：会把 schema、更新、保留旧密码、文件重写逻辑继续绑定在文件格式上，长期只会让存储层更脆弱。
- 为什么不拆分 metadata / secret 双存储：当前还没有复杂 secret 生命周期需求，整库加密比双存储更简单，且更利于尽快替换明文 JSON。

### 2. 引入 `CatalogStore` 抽象，HTTP 与代理逻辑只依赖仓库接口
- 选择理由：当前 `gateway` 中的 `Catalog::load(path)`、配置读取和配置保存都把“模型构建”和“文件存储”耦合在一个模块里。
- 目标形态：`CatalogStore` 负责列出服务器、读取默认服务器、保存配置、刷新内存快照；`gateway` 路由层不再直接读写路径或 JSON。
- 为什么不直接在 `lib.rs` 内嵌 SQLite 代码：会把 HTTP、代理、存储、密钥解析再次绑死在单文件里，不符合后续扩展需求。

### 3. 引入统一的 `MasterKeyResolver`，同时支持 `Env` 与 `OS Key`
- 选择理由：`Standalone Service` 与 `Desktop` 都需要“无感知”打开加密数据库，但默认密钥来源不同：服务更适合由部署环境显式提供，桌面更适合由操作系统密钥存储托管。
- 默认策略：
  - 显式环境变量一旦提供，就视为 authoritative key；如果解锁失败，直接报错，不再静默回退。
  - `Desktop` 在未显式提供环境变量时，优先尝试 OS Key；首次启动若不存在密钥，则自动生成随机 key 并写入 OS Key，再初始化数据库。
  - `Standalone Service` 在未显式提供环境变量时，可以尝试 OS Key provider，但默认不自动生成新密钥；若无法拿到密钥，则启动失败。
- 为什么不直接要求用户输入主密码：这会把 TDE 升级成显式解锁流程，不符合“无感知”的产品目标。

### 4. 数据库初始化与迁移骨架一开始就搭好
- 选择理由：即使当前 schema 很小，也应从第一天开始使用可扩展的迁移机制，而不是把建表 SQL 硬编码在启动流程里。
- 实现方向：使用 `rusqlite_migration` 管理 schema 版本，至少提供 `01_init` 初始迁移；启动时在 key 验证成功后统一执行迁移。
- 为什么不先手写 `CREATE TABLE IF NOT EXISTS`：短期简单，但一旦 schema 增长，版本管理、回滚与测试都会变差。

### 5. 数据库允许空库启动，由前端配置面板创建首个服务器
- 选择理由：当前没有兼容负担，也不需要保留“默认写一个本地 qB 示例配置”的历史习惯。空库更符合“数据库是唯一真源”的新模型。
- 用户体验：前端读取配置时若返回空列表，继续沿用现有管理面板的创建流程；保存后页面重新探测与刷新状态。
- 为什么不自动 seed 默认服务器：会引入与真实部署环境无关的占位数据，反而污染初始状态。

## Risks / Trade-offs

- [Risk] 新增数据库与 SQLCipher 依赖后，Rust 构建链更复杂，特别是不同平台的链接行为可能不同。 → Mitigation：优先采用 `rusqlite` 的 SQLCipher bundling feature，并在 `gateway` crate 统一封装连接创建逻辑。
- [Risk] `OS Key` 在 Linux 上的后端差异比 macOS / Windows 更复杂，可能导致 `Desktop` 的跨平台体验不完全一致。 → Mitigation：抽象 `MasterKeyResolver`，保留环境变量 override；在 `Desktop` 中将 OS Key 作为默认但非唯一入口。
- [Risk] 采用“环境变量 authoritative”后，若用户误配 key，服务会直接启动失败。 → Mitigation：将错误视为显式配置错误并快速失败，避免静默回退造成难以排查的状态混乱。
- [Risk] 整库加密只能保护静态数据，运行时内存与网关发起代理请求时仍会短暂持有明文凭据。 → Mitigation：明确本次目标仅为 at-rest protection，不把运行时内存机密化作为验收条件。
- [Risk] 空库启动会让首次体验比“自带示例 JSON”更少一步预置。 → Mitigation：沿用现有可视化配置面板，保证首次保存流程简短直接。

## Migration Plan

1. 在 `gateway` crate 内新增数据库、主密钥解析和迁移模块，但暂不动前端 API 路径与响应结构。
2. 用 `CatalogStore` 抽象替换 JSON 读写逻辑，使 `__standalone__/status`、`__standalone__/config` 和代理选择逻辑统一从 store 读取。
3. 引入 `01_init` schema 并在启动阶段执行数据库打开、key 验证和迁移。
4. 移除 `Desktop` 中自动生成明文 `standalone.json` 的默认逻辑，改为初始化数据库与主密钥。
5. 更新 `Standalone Service` / `Desktop` 文档，说明 DB key 来源、默认策略与部署方式。
6. 因当前无兼容负担，不提供旧 JSON 自动迁移；若需要样例配置，仅保留文档级示例或未来的显式导入工具。

回滚策略：开发期若需要回滚，可直接恢复到 JSON 版本实现；由于不承诺兼容与迁移，回滚不处理数据库到 JSON 的自动导出。

## Open Questions

- `Standalone Service` 是否需要在文档中明确区分“推荐使用环境变量 / Docker Secret”与“实验性 OS Key provider”两种部署方式。
- `Desktop` 的 OS Key 后端在 Linux 上选用哪个实现最合适，需要在真正实现时根据目标平台和构建环境再定。
- 是否在第一阶段就引入数据库健康检查/信息端点（例如 schema version、key source），还是保持内部实现不可见。
