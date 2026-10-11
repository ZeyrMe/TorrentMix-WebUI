# Deployment

This document is for people deploying TorrentMix WebUI. In normal use, download a built artifact from GitHub Releases; Node, pnpm, and Rust are not required.

The repository provides four forms:

| Form | Best for | Direct artifact |
| --- | --- | --- |
| **A. Loader** | A single entry file that follows remote releases | `loader.html` |
| **B. Standalone** | The UI, proxy, and server catalog in one service | Linux x64 bundle / Docker image archive |
| **C. Sidecar** | An existing backend that needs automatic WebUI updates | `updater.mjs` / Docker image archive |
| **D. Dist** | Offline, private-network, or manual installs | `dist.zip` |

Use **D** for a manual install into an existing backend, **C** when that install should update automatically, **B** when the UI and proxy should run together, and **A** when a small remote-following entrypoint is enough.

## Release downloads

These URLs point to the latest release. Replace `latest` with a tag such as `v0.1.0` when you need a fixed version.

```text
Release page:
https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest

Loader:
https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/loader.html

Dist:
https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/dist.zip

Sidecar script:
https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/updater.mjs
```

## A. Loader

Loader is useful when the backend can serve one writable WebUI file and the browser can reach a release source.

```bash
curl -fL -o loader.html \
  https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/loader.html
mv loader.html index.html
```

Put `index.html` in the qBittorrent or Transmission WebUI directory and open it through the backend. Loader reads `latest.json`, then loads the matching JS, CSS, and fonts.

Pin a version with `?ver=0.1.0` or `?tag=v0.1.0`. A `config.json` beside `index.html` can override the update source:

```json
{
  "latestUrl": "https://YOUR-DOMAIN/latest.json",
  "pinnedVersion": "0.1.0"
}
```

Loader is not suitable for a fully offline setup and should only point to a release source you trust.

## B. Standalone

Standalone Service serves the WebUI and proxies backend APIs from one port:

- `/api/*` proxies qBittorrent;
- `/transmission/*` proxies Transmission;
- `/__standalone__/status` shows the server catalog;
- `/__standalone__/config` edits the server catalog.

The catalog is stored in an encrypted SQLCipher database. On first start, open the UI and add qBittorrent or Transmission under **Switch Server -> Manage Servers**.

### B1. Linux x64 bundle

The Release asset `torrentmix-standalone-service-v<VERSION>-linux-amd64.tar.gz` contains both the binary and WebUI:

```bash
VERSION=0.1.0
curl -fL -o standalone.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-standalone-service-v${VERSION}-linux-amd64.tar.gz"
tar -xzf standalone.tar.gz
cd "torrentmix-standalone-service-v${VERSION}-linux-amd64"
mkdir -p data

STANDALONE_DB="$PWD/data/catalog.db" \
TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
STATIC_DIR="$PWD/dist" \
./standalone-service
```

This bundle currently targets Linux x64. Use the Docker archive on other platforms, or build from source for an unsupported target.

### B2. Docker image archive

The Release includes an importable Docker image archive:

```bash
VERSION=0.1.0
curl -fL -o standalone-image.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-standalone-service-v${VERSION}-docker-linux-amd64.tar.gz"
gzip -dc standalone-image.tar.gz | docker load

docker run -d --name torrentmix-standalone -p 8080:8080 \
  -e TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
  -v torrentmix-catalog:/config \
  "torrentmix-standalone-service:${VERSION}"
```

The archive currently targets Linux amd64. `/config` is persistent storage for the catalog. Keep both the volume and `TORRENTMIX_DB_KEY` when upgrading.

### B3. Configuration and updates

| Variable | Default | Purpose |
| --- | --- | --- |
| `LISTEN_ADDR` | `:8080` | Listen address |
| `STATIC_DIR` | `/app/dist` | Static WebUI directory |
| `STANDALONE_DB` | `/config/catalog.db` | SQLCipher catalog path |
| `TORRENTMIX_DB_KEY` | none | SQLCipher master key; required for containers |

For a binary update, replace the executable and `dist/` while keeping `data/catalog.db`. For Docker, load the target archive and recreate the container with the same volume. Roll back by downloading the desired tag.

## C. Sidecar

Sidecar does not listen on an HTTP port or proxy requests. It updates the WebUI directory used by the backend, so both containers or processes must mount the same directory.

### C1. Node script

The Release provides `updater.mjs` directly. The script requires Node.js 20+ and the system `unzip` command; pnpm and Rust are not required:

```bash
mkdir -p /opt/torrentmix-sidecar
cd /opt/torrentmix-sidecar
curl -fL -o updater.mjs \
  https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/updater.mjs

LATEST_URL=https://zeyrme.github.io/TorrentMix-WebUI/latest.json \
TARGET_DIR=/path/to/backend/webui \
CHECK_INTERVAL_SEC=3600 \
node updater.mjs
```

Set `CHECK_INTERVAL_SEC=0` for a one-shot update. Use systemd, supervisord, or a container manager for a long-running process. Temporary files go to `/tmp/webui-sidecar` by default; set `TMP_ROOT` to a writable directory with enough space if needed.

### C2. Docker image archive

```bash
VERSION=0.1.0
curl -fL -o sidecar-image.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-sidecar-v${VERSION}-docker-linux-amd64.tar.gz"
gzip -dc sidecar-image.tar.gz | docker load

docker run --rm \
  -e LATEST_URL=https://zeyrme.github.io/TorrentMix-WebUI/latest.json \
  -e CHECK_INTERVAL_SEC=3600 \
  -v /path/to/backend/webui:/target \
  "torrentmix-sidecar:${VERSION}"
```

`/target` must be the directory actually served by the backend. The Sidecar image does not include qBittorrent or Transmission.

### C3. Connect the backend

- **qBittorrent:** enable *Alternative WebUI* and point it at the shared directory. With Docker, mount the same named volume into qBittorrent and Sidecar.
- **Transmission:** use `--web-home` or the equivalent setting to point at the shared directory.

The install sequence is download, SHA-256 verification, extraction into a temporary directory, root `index.html` validation, and target update. Failed verification or an invalid archive leaves the current page in place.

## D. Dist

Dist is the simplest manual install:

```bash
mkdir -p /path/to/backend/webui
curl -fL -o dist.zip \
  https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/dist.zip
unzip -o dist.zip -d /path/to/backend/webui
```

The archive root already contains `index.html`. Repeat the download and extraction to update; use a fixed tag to roll back. Serve the directory through qBittorrent, Transmission, or another HTTP server instead of opening it with `file://`.

## Docker archives

The current Release provides Linux amd64 Docker archives. Import them with:

```bash
gzip -dc image.tar.gz | docker load
```

They do not depend on Docker Hub or a registry login. If a source build reports `TLS handshake timeout`, Docker usually could not reach a base image; importing a Release archive avoids that build step.

## Build from source

Source builds are for development and unsupported platforms, not a normal deployment prerequisite:

```bash
pnpm install
pnpm build
cargo build --manifest-path rust/Cargo.toml --release -p standalone-service
```

## Artifact map

| Form | Entry |
| --- | --- |
| A. Loader | Release `loader.html` or Pages `/loader.html` |
| B. Standalone | `*-linux-amd64.tar.gz` or `*-docker-linux-amd64.tar.gz` |
| C. Sidecar | Release `updater.mjs` or `*-docker-linux-amd64.tar.gz` |
| D. Dist | Release `dist.zip` or the versioned Pages directory |
