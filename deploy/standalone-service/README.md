# Standalone Service

[中文文档](README.zh-CN.md)

The **Standalone Service** turns the WebUI into a self-contained same-origin gateway — static assets and backend API are served from a single process and port. No CORS, no cookie issues.

**What it does:**

- Serves WebUI static assets
- Reverse-proxies `/api/*` (qBittorrent) and `/transmission/*` (Transmission) to configured backend instances
- Provides a server-switcher panel with pre-configured credentials and latency display
- Stores the server catalog in an encrypted SQLCipher database and supports in-browser configuration edits

**Runtime semantics:**

- Server switching is tracked through the `tm_server_id` cookie; invalid or removed selections automatically fall back to the current default server.
- qBittorrent proxy traffic forces one re-login retry after a 403 response.
- Saving a new server catalog clears cached qB sessions so later proxy requests use the updated configuration.

## Configuration

The service stores runtime configuration in an encrypted SQLCipher database at `STANDALONE_DB` (default: `/config/catalog.db`). The database contains the default server selection, server metadata, usernames, and passwords.

### Key resolution

- `TORRENTMIX_DB_KEY` — authoritative master key. If provided, startup uses it directly and fails fast if the database cannot be opened with that key.
- OS key provider — used only when `TORRENTMIX_DB_KEY` is not set. This can work for non-containerized deployments, but in containers it is usually unavailable.
- No key source available — startup fails. The service does **not** auto-generate an unmanaged key.

### Environment variables

| Variable | Description |
|----------|-------------|
| `LISTEN_ADDR` | Listen address (default `:8080`) |
| `STATIC_DIR` | Path to frontend static assets (default `/app/dist`) |
| `STANDALONE_DB` | Path to the encrypted SQLCipher catalog database (default `/config/catalog.db`) |
| `TORRENTMIX_DB_KEY` | Explicit SQLCipher master key; recommended for Docker, systemd, and CI |

> Legacy `standalone.json` / `config.example.json` are kept only as reference material and are no longer read by the runtime.

## Docker

**Build:**

```bash
docker build -t torrentmix-standalone-service -f deploy/standalone-service/Dockerfile .
```

**Run** (recommended: mount `/config` and provide a master key):

```bash
docker run --rm -p 8080:8080 \
  -e TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
  -v torrentmix-catalog:/config \
  torrentmix-standalone-service
```

Open `http://localhost:8080`, then add the first backend via **Switch Server → Manage Servers**.

> **In-browser config:** changes are written back to `STANDALONE_DB`. Passwords are never echoed — leave blank to keep the existing value.

## Binary (Local Build)

```bash
# Option 1: native Rust toolchain (recommended)
cargo build --manifest-path rust/Cargo.toml --release -p standalone-service

# macOS / Linux
STANDALONE_DB=/tmp/torrentmix/catalog.db \
TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
LISTEN_ADDR=:8080 \
./rust/target/release/standalone-service

# Windows (PowerShell)
$env:STANDALONE_DB = 'C:\torrentmix\catalog.db'
$env:TORRENTMIX_DB_KEY = 'replace-with-a-long-random-string'
$env:LISTEN_ADDR = ':8080'
.\rust\target\release\standalone-service.exe

# Option 2: build inside Docker (no local Rust required)
docker run --rm -v "$PWD:/work" -w /work rust:1.88-alpine \
  sh -lc "apk add --no-cache build-base musl-dev perl pkgconf && cargo build --manifest-path rust/Cargo.toml --release -p standalone-service"
```
