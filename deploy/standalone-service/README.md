# Standalone Service

[中文文档](README.zh-CN.md)

**Standalone Service** serves the WebUI and backend API proxy from one process and one origin.

It:

- serves the WebUI;
- proxies `/api/*` to qBittorrent and `/transmission/*` to Transmission;
- provides a server switcher and latency display;
- stores the server catalog in an encrypted SQLCipher database and supports in-browser edits.

## Installation

### Linux x64 bundle

Releases include a Linux x64 bundle with the WebUI. Rust is not required:

```bash
VERSION=0.1.0
curl -fL -o torrentmix-standalone-service.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-standalone-service-v${VERSION}-linux-amd64.tar.gz"
tar -xzf torrentmix-standalone-service.tar.gz
cd "torrentmix-standalone-service-v${VERSION}-linux-amd64"
mkdir -p data
STANDALONE_DB="$PWD/data/catalog.db" \
TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
STATIC_DIR="$PWD/dist" \
./standalone-service
```

This bundle currently targets Linux x64. Use Docker on other platforms, or build from source below.

### Docker image

Releases also include an importable Docker image archive:

```bash
VERSION=0.1.0
curl -fL -o torrentmix-standalone-image.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-standalone-service-v${VERSION}-docker-linux-amd64.tar.gz"
gzip -dc torrentmix-standalone-image.tar.gz | docker load

docker run -d --name torrentmix-standalone -p 8080:8080 \
  -e TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
  -v torrentmix-catalog:/config \
  "torrentmix-standalone-service:${VERSION}"
```

Open `http://localhost:8080`, then add the first backend under **Switch Server -> Manage Servers**. Keep the `/config` volume and `TORRENTMIX_DB_KEY` when upgrading.

## Configuration

The encrypted catalog is stored at `STANDALONE_DB` (container default: `/config/catalog.db`).

### Key resolution

- `TORRENTMIX_DB_KEY` is used directly when set.
- Without it, the service may use an OS key provider on non-containerized systems.
- With no usable key, startup fails; the service does not create an unmanaged key.

### Environment variables

| Variable | Description |
|----------|-------------|
| `LISTEN_ADDR` | Listen address, default `:8080` |
| `STATIC_DIR` | WebUI directory, default `/app/dist` |
| `STANDALONE_DB` | SQLCipher catalog path, default `/config/catalog.db` |
| `TORRENTMIX_DB_KEY` | Explicit SQLCipher master key |

`standalone.json` and `config.example.json` are reference files only; the runtime does not read them.

## Updates and rollback

For the binary bundle, replace the executable and `dist/` while keeping `data/catalog.db`. For Docker, load the target archive and recreate the container with the same volume. Download the desired tag to roll back.

In-browser configuration writes to `STANDALONE_DB`. Passwords are never echoed; leave a password field blank to keep its current value.

## Build from source (development)

```bash
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
```
