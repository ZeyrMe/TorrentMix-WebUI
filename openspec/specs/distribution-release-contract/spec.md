# distribution-release-contract Specification

## Purpose
约束 `pnpm build:publish` 生成的 latest.json、manifest.json、loader.html 与 dist.zip 的文件布局、相对路径语义与校验字段，防止发布回归同时打坏多种分发路径。
## Requirements
### Requirement: Build publish SHALL emit a canonical release artifact set
`pnpm build:publish` SHALL generate a self-consistent release artifact set that can be consumed by `Loader`, `Sidecar`, and manual `Dist` installs without relying on undocumented file names or absolute URLs.

#### Scenario: Publish output includes the required top-level and versioned files
- **WHEN** `pnpm build:publish` completes for application version `<version>`
- **THEN** `artifacts/publish/latest.json`, `artifacts/publish/manifest.json`, and `artifacts/publish/loader.html` MUST exist
- **AND** `artifacts/publish/releases/<version>/manifest.json`, `artifacts/publish/releases/<version>/loader.html`, and `artifacts/publish/releases/<version>/dist.zip` MUST exist
- **AND** `latest.json` MUST reference the versioned release through relative paths rooted under `releases/<version>/`

### Requirement: Release metadata SHALL describe entry assets with verifiable file records
The generated `manifest.json` SHALL describe the release entrypoints and SHALL include verifiable metadata for every emitted file that a consumer may load from the manifest.

#### Scenario: Manifest entry assets have matching file metadata
- **WHEN** a consumer reads the generated `manifest.json`
- **THEN** every path listed under `entry.js` and `entry.css` MUST also appear in `files`
- **AND** each matching file record MUST include `path`, `size`, `sha256`, and `integrity`
- **AND** all paths in `manifest.json` MUST remain relative to the release root rather than embedding environment-specific absolute URLs

### Requirement: Dist archive SHALL unpack into a backend-ready WebUI root
The generated `dist.zip` SHALL expand directly into a WebUI directory that can be installed into a backend WebUI root without requiring users or tools to strip an extra top-level folder.

#### Scenario: Dist archive root contains the expected WebUI entrypoint
- **WHEN** `artifacts/publish/releases/<version>/dist.zip` is extracted into an empty directory
- **THEN** `index.html` MUST exist at the extraction root
- **AND** the extracted directory MUST contain the asset tree referenced by the versioned `manifest.json`
- **AND** the archive MUST NOT require removing an extra wrapper directory before installation

