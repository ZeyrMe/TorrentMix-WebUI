# Desktop (Tauri)

[中文文档](README.zh-CN.md)

The desktop app bundles the same `gateway` crate as the Standalone Service, binding it to `127.0.0.1:0` on startup and then pointing a WebView at that address. You get a native window with full same-origin proxying — no separate server process needed.

**Capabilities:**

- Serves WebUI static assets (`dist/`) over HTTP
- Proxies `/api/*` and `/transmission/*` to configured backends
- Supports the Standalone server-switcher and visual config editor

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

The app reads and writes `standalone.json` in the OS app-config directory. Override with environment variables if needed:

| Variable | Description |
|----------|-------------|
| `STANDALONE_CONFIG` | Path to the config file |
| `STATIC_DIR` | Path to frontend static assets (defaults to `./dist`) |
