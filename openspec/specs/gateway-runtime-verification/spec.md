# gateway-runtime-verification Specification

## Purpose
约束网关运行时关键路径（选择、配置、代理稳定性）的自动化 Rust 测试覆盖，以及发布流水线在发版前必须执行的运行时校验。
## Requirements
### Requirement: Gateway runtime SHALL be covered by automated Rust verification for critical selection and proxy flows
Critical shared runtime behaviors for `Standalone Service` and `Desktop` SHALL be exercised by automated Rust tests so selection and proxy regressions are detected before release.

#### Scenario: Automated verification covers selection, config, and proxy stability paths
- **WHEN** the Rust gateway verification suite runs
- **THEN** it MUST include tests for effective server selection fallback, selection API behavior, config-update invalidation, and qB re-auth retry behavior

### Requirement: Release verification SHALL include Rust runtime checks before publish
The release pipeline SHALL execute Rust runtime verification before publishing release artifacts for the shared gateway-based deployment forms.

#### Scenario: Release workflow runs Rust runtime checks before publish
- **WHEN** the release workflow prepares a publishable build
- **THEN** it MUST execute the required Rust runtime tests or builds before creating the final release artifacts
- **AND** the publish step MUST NOT proceed if those runtime checks fail

