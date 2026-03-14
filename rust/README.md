# Rust Workspace

[中文文档](README.zh-CN.md)

All Rust code lives here, keeping things from scattering across the repo.

## Crates

| Crate | Description |
|-------|-------------|
| `crates/gateway` | Same-origin gateway — proxies `/api/*` and `/transmission/*`, plus the Standalone server-management API |
| `apps/standalone-service` | Headless binary for the **Standalone Service** deployment mode |
| `apps/desktop` | Tauri desktop app — spins up `gateway` on `127.0.0.1:0` and opens a WebView pointing at it |

## Runtime Guarantees

- Server selection is browser-scoped: a valid `tm_server_id` cookie wins, otherwise runtime falls back to the current default server.
- qBittorrent proxy traffic forces one re-login retry after a 403 before returning the upstream result.
- Release verification runs Rust checks for the shared `gateway` runtime so publish is not guarded by frontend artifacts alone.

## Building

From the repo root:

```bash
# Build the standalone service binary
cargo build --manifest-path rust/Cargo.toml --release -p standalone-service

# Build the desktop app
cargo build --manifest-path rust/Cargo.toml -p torrentmix-desktop
```
