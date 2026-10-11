# Sidecar Updater

Sidecar is for an existing qBittorrent or Transmission deployment. It reads `latest.json`, downloads and verifies `dist.zip`, and installs it into the WebUI directory served by the backend. It does not listen on an HTTP port or proxy API requests.

See [`docs/deployment.md`](../../docs/deployment.md) for the complete deployment guide.

## Node script

The script requires Node.js 20+ and the system `unzip` command. Releases include `updater.mjs` directly:

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

Set `CHECK_INTERVAL_SEC=0` for a one-shot update. Use systemd, supervisord, or another process manager for a long-running process.

## Docker

Releases include a Linux amd64 Docker archive:

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

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `LATEST_URL` | yes | none | URL of `latest.json` |
| `TARGET_DIR` | no | `/target` | WebUI installation directory |
| `CHECK_INTERVAL_SEC` | no | `3600` | Poll interval; `0` runs once |
| `TMP_ROOT` | no | `/tmp/webui-sidecar` | Temporary download and extraction directory |

Sidecar and the backend must share the same WebUI directory. qBittorrent must have **Alternative WebUI** enabled; Transmission uses `--web-home` or the equivalent setting. Failed verification or an invalid archive leaves the current directory unchanged.
