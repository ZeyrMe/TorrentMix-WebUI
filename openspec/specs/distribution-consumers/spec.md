# distribution-consumers Specification

## Purpose
约束 Loader 与 Sidecar 如何解析、校验并消费发布产物（latest.json / manifest.json / dist.zip），保证多分发形态共用同一条可信更新链。
## Requirements
### Requirement: Loader SHALL resolve release sources and pinned versions deterministically
`Loader` SHALL apply a deterministic precedence order when selecting both the release source URL and the pinned version so that users, administrators, and query parameters can predictably override one another.

#### Scenario: Query pin overrides browser and config pins
- **WHEN** the loader is opened with `?ver`, `?version`, or `?tag`
- **THEN** that query value MUST be used as the effective pinned version
- **AND** any pinned version from browser storage or `config.json` MUST NOT override it

#### Scenario: Explicit source URL is tried before saved and configured candidates
- **WHEN** the loader is opened with an explicit `latest` or `manifest` query parameter
- **THEN** that source MUST be attempted before persisted browser choices, `config.json` candidates, or built-in defaults

### Requirement: Loader SHALL load entry assets from the resolved manifest
After resolving a manifest, `Loader` SHALL load the entry JS and CSS assets relative to the resolved manifest location and SHALL propagate integrity metadata when the manifest provides it.

#### Scenario: Loader injects manifest-relative assets with integrity
- **WHEN** the resolved `manifest.json` contains entry assets and matching file integrity metadata
- **THEN** the loader MUST request those assets relative to the resolved manifest URL
- **AND** injected `<script>` and `<link>` elements MUST include integrity metadata when available

### Requirement: Loader SHALL provide safe unpinned fallback via cached manifest
For unpinned startup flows, `Loader` SHALL be able to reuse a previously cached manifest so that transient release-source failures do not prevent booting the existing UI.

#### Scenario: Cached manifest boots while background refresh checks for updates
- **WHEN** no effective pinned version is active and a cached manifest is present
- **THEN** the loader MUST be able to boot from the cached manifest
- **AND** it MUST be able to probe candidate release sources in the background for a newer manifest

### Requirement: Sidecar SHALL verify releases before replacing the target directory
`Sidecar` SHALL treat `latest.json` as the authoritative version pointer, SHALL verify the referenced archive before installation, and SHALL fail without clobbering the target directory when validation does not pass.

#### Scenario: Successful install writes the selected version marker
- **WHEN** `latest.json` exposes a `release.distZip` and an optional matching `release.distZipSha256`
- **THEN** sidecar MUST download the referenced archive, validate the checksum when present, extract it, replace the target directory contents, and write an installed version marker

#### Scenario: Invalid archive or checksum mismatch aborts installation
- **WHEN** the downloaded archive checksum does not match `release.distZipSha256` or the extracted archive does not contain a valid WebUI root
- **THEN** sidecar MUST abort the install
- **AND** it MUST NOT delete or replace the existing target directory contents for that failed update attempt

