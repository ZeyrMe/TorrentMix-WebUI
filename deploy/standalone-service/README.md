# Standalone Service

Standalone Service is TorrentMix's self-contained deployment. It hosts the WebUI, stores the backend catalog, and proxies `/api/*` and `/transmission/*` to the selected backend on one port.

For the complete user-facing deployment flow, see [`docs/deployment.md`](../../docs/deployment.md). This file is the service-level installation and configuration reference.

## Install

### Docker

Releases include a Linux amd64 Docker archive. Import it directly; the target host does not need to run the Dockerfile:

```bash
VERSION=0.1.0
curl -fL -o standalone-image.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-standalone-service-v${VERSION}-docker-linux-amd64.tar.gz"
gzip -dc standalone-image.tar.gz | docker load

docker volume create torrentmix-config
docker run -d \
  --name torrentmix-standalone \
  --restart unless-stopped \
  -e TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
  -p 8080:8080 \
  -v torrentmix-config:/config \
  "torrentmix-standalone-service:${VERSION}"
```

Keep `TORRENTMIX_DB_KEY` unchanged across restarts, upgrades, and restores. `/config` contains the SQLCipher catalog; deleting the volume deletes the server directory as well.

### Linux x64 binary

The Release binary archive already includes the WebUI and does not require Rust:

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

Use systemd or another process manager for a long-running service. On upgrade, replace the executable and `dist/` while keeping the database and key.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `LISTEN_ADDR` | `:8080` | HTTP listen address |
| `STATIC_DIR` | `/app/dist` | WebUI static files |
| `STANDALONE_DB` | `/config/catalog.db` | SQLCipher catalog path |
| `TORRENTMIX_DB_KEY` | none | SQLCipher key; required for Docker |

After the first start, use **Switch server → Manage servers** to add qBittorrent or Transmission. Credentials are stored in the encrypted catalog and passwords are not displayed back in the UI.

## Upgrade and rollback

For Docker, import the target archive and recreate the container with the original `torrentmix-config` volume and `TORRENTMIX_DB_KEY`. For the binary archive, replace the executable and `dist/` while keeping the database. Roll back by downloading the desired Release archive.

Build from source only for development or unsupported targets; normal deployments should use Release artifacts.
