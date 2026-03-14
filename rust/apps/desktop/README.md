# Desktop (Tauri)

[中文文档](README.zh-CN.md)

The desktop app bundles the same `gateway` crate as the Standalone Service, binding it to `127.0.0.1:0` on startup and then pointing a WebView at that address. You get a native window with full same-origin proxying — no separate server process needed.

**Capabilities:**

- Serves WebUI static assets (`dist/`) over HTTP
- Proxies `/api/*` and `/transmission/*` to configured backends
- Supports the Standalone server-switcher and visual config editor
- Stores the runtime catalog in an encrypted SQLCipher database without exposing raw credentials to the frontend

**Runtime semantics:**

- Desktop shares the same `gateway` selection and proxy behavior as Standalone Service.
- Server choice is still driven by the `tm_server_id` cookie, with fallback to the default server when that cookie is invalid.
- qBittorrent proxy traffic forces one re-login retry after a 403 response.

## Development

**1. Build the frontend:**

```bash
pnpm build
```

**2. Run the desktop app:**

```bash
cargo run --manifest-path rust/Cargo.toml -p torrentmix-desktop
```

## Configuration

The app stores runtime configuration in `catalog.db` under the OS app-config directory by default.

### Default unlock behavior

- `TORRENTMIX_DB_KEY` set → use it directly as the authoritative SQLCipher key.
- `TORRENTMIX_DB_KEY` unset → try the OS key store.
- First startup without an existing database and without an explicit key → generate a new database key automatically and store it in the OS key store.

### Environment variables

| Variable | Description |
|----------|-------------|
| `STANDALONE_DB` | Override the encrypted catalog database path |
| `TORRENTMIX_DB_KEY` | Explicit SQLCipher master key override |
| `STATIC_DIR` | Path to frontend static assets (defaults to `./dist`) |
