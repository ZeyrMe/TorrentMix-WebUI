# Sidecar Updater

[中文文档](README.zh-CN.md)

Sidecar keeps the WebUI directory used by a backend up to date. It reads `latest.json`, downloads `dist.zip`, verifies SHA-256, and updates the target directory.

Installation only proceeds when:

- `latest.json` contains `release.distZip`;
- `release.distZipSha256`, when present, matches;
- the extracted archive root contains `index.html`.

## Installation and usage

### Node script

Releases include `updater.mjs` directly; no checkout is needed. The script requires Node.js 20+ and the system `unzip` command:

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

Set `CHECK_INTERVAL_SEC=0` for a one-shot update. Use systemd, supervisord, or a container manager for a long-running process.

### Docker image

Releases include an importable amd64 Docker image archive:

```bash
VERSION=0.1.0
curl -fL -o torrentmix-sidecar-image.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-sidecar-v${VERSION}-docker-linux-amd64.tar.gz"
gzip -dc torrentmix-sidecar-image.tar.gz | docker load
docker run --rm \
  -e LATEST_URL=https://zeyrme.github.io/TorrentMix-WebUI/latest.json \
  -e CHECK_INTERVAL_SEC=3600 \
  -v /path/to/backend/webui:/target \
  "torrentmix-sidecar:${VERSION}"
```

`/target` must be the directory actually served by the backend. The Sidecar image does not include qBittorrent or Transmission.

### Build from source (development)

Build from source when changing the updater:

```bash
docker build -t torrentmix-sidecar -f deploy/sidecar/Dockerfile .
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LATEST_URL` | yes | — | URL of `latest.json` |
| `TARGET_DIR` | no | `/target` | WebUI extraction directory |
| `CHECK_INTERVAL_SEC` | no | `3600` | Poll interval; `0` runs once |
| `TMP_ROOT` | no | `/tmp/webui-sidecar` | Temporary download and extraction directory |

If verification or archive-layout checks fail, Sidecar leaves the current target directory unchanged.

## Connect the backend

Sidecar and the backend must share the same WebUI directory:

- **qBittorrent:** enable *Alternative WebUI* and point it at the shared directory.
- **Transmission:** use `--web-home` or the equivalent setting.

Sidecar only updates files. qBittorrent / Transmission still handle backend URLs, authentication, and API proxying.
