# Deploy TorrentMix WebUI

This guide is for users deploying TorrentMix. A normal deployment does not require Node.js, pnpm, or Rust; download the appropriate artifact from [GitHub Releases](https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest).

If qBittorrent or Transmission is already running and you only need its WebUI files, start with [static package deployment](#static-package). If TorrentMix should host the UI, manage multiple backends, and proxy API requests, use the Standalone Docker deployment below.

## Recommended: Standalone Docker

Standalone is a single service that hosts the WebUI, stores the backend catalog, and proxies requests to the selected qBittorrent or Transmission instance. It is the simplest option to upgrade and roll back.

### Requirements

- Docker Engine 24+ or Docker Desktop;
- `curl`, `gzip`, and `openssl` for the install commands below;
- the current Release archives are `linux/amd64`; ARM hosts need Docker emulation, or should use the static package / Node Sidecar;
- the host must be able to reach the qBittorrent or Transmission endpoints you configure.

### Install

The following commands keep the configuration volume and database key in explicit locations. Generate the key once; keep using the same file for upgrades and restores.

```bash
mkdir -p /opt/torrentmix
cd /opt/torrentmix

VERSION=0.1.0
curl -fL -o standalone-image.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-standalone-service-v${VERSION}-docker-linux-amd64.tar.gz"
gzip -dc standalone-image.tar.gz | docker load

if [ ! -f .env ]; then
  printf 'TORRENTMIX_DB_KEY=%s\n' "$(openssl rand -hex 32)" > .env
  chmod 600 .env
fi

docker volume create torrentmix-config
docker run -d \
  --name torrentmix-standalone \
  --restart unless-stopped \
  --env-file /opt/torrentmix/.env \
  -p 8080:8080 \
  -v torrentmix-config:/config \
  "torrentmix-standalone-service:${VERSION}"
```

Open `http://localhost:8080`, then use **Switch server → Manage servers** to add the first backend. The container must be able to reach that backend; if the backend runs outside Docker, configure an address reachable from the container.

### Upgrade and rollback

Replace the image without deleting the `torrentmix-config` volume or regenerating `.env`:

```bash
cd /opt/torrentmix
VERSION=0.1.1
curl -fL -o standalone-image.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-standalone-service-v${VERSION}-docker-linux-amd64.tar.gz"
gzip -dc standalone-image.tar.gz | docker load
docker stop torrentmix-standalone
docker rm torrentmix-standalone
docker run -d \
  --name torrentmix-standalone \
  --restart unless-stopped \
  --env-file /opt/torrentmix/.env \
  -p 8080:8080 \
  -v torrentmix-config:/config \
  "torrentmix-standalone-service:${VERSION}"
```

Roll back by repeating the same commands with the desired version. The database and key must remain paired.

### Back up the configuration

Back up both `/opt/torrentmix/.env` and the `torrentmix-config` volume. For example:

```bash
docker run --rm \
  -v torrentmix-config:/config \
  -v "$PWD":/backup \
  alpine:3.20 \
  tar czf /backup/torrentmix-config.tar.gz -C /config .
```

Stop Standalone before restoring the archive, restore it into the same volume, and keep the original `.env`.

## Other deployment methods

### Static package

Use the static package when qBittorrent or Transmission already serves the WebUI directory. It does not proxy requests or manage backend settings.

```bash
mkdir -p /path/to/backend/webui
curl -fL -o dist.zip \
  https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/dist.zip
unzip -o dist.zip -d /path/to/backend/webui
```

After extraction, `/path/to/backend/webui/index.html` must exist directly at the directory root. Do not open it with `file://`; serve it through the backend or another HTTP server.

- qBittorrent: enable **Alternative WebUI** and point it to this directory;
- Transmission: use `--web-home` or the equivalent setting.

To update, download the desired `dist.zip` and extract it over the same directory. Replace `latest` with a tag such as `v0.1.0` to roll back.

### Sidecar updater

Use Sidecar when an existing backend should update its WebUI automatically without adding a proxy service. Sidecar only installs `dist.zip`; qBittorrent / Transmission still manage the backend itself.

The Node script requires Node.js 20+ and the system `unzip` command:

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

Set `CHECK_INTERVAL_SEC=0` for a one-shot update. For a long-running process, use systemd, supervisord, or a container manager. Sidecar and the backend must share the same WebUI directory; updating the wrong directory has no effect on the page being served.

For example, run the Node script with systemd:

```ini
# /etc/systemd/system/torrentmix-sidecar.service
[Unit]
Description=TorrentMix WebUI Sidecar
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/torrentmix-sidecar
Environment=LATEST_URL=https://zeyrme.github.io/TorrentMix-WebUI/latest.json
Environment=TARGET_DIR=/path/to/backend/webui
Environment=CHECK_INTERVAL_SEC=3600
ExecStart=/usr/bin/node /opt/torrentmix-sidecar/updater.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl daemon-reload && sudo systemctl enable --now torrentmix-sidecar`.

The Release also includes an importable Docker archive:

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

### Loader

Use Loader when the backend can serve one WebUI file and the browser can reach the release source. Loader does not contain the full application; it loads the remote version described by `latest.json`.

```bash
curl -fL -o /path/to/backend/webui/index.html \
  https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/loader.html
```

Loader follows the latest release. Pin a version with `?ver=0.1.0` or `?tag=v0.1.0`. Because it loads remote scripts, use it only with a release source you trust; it is not suitable for fully offline deployments.

## Troubleshooting

### Blank page or 404 assets

Make sure the page is served over HTTP by qBittorrent, Transmission, Standalone, or another web server. For a static package, verify that `index.html` is at the WebUI directory root.

### Standalone cannot unlock its catalog

Check that the container still uses the `.env` generated during the first install. Changing `TORRENTMIX_DB_KEY` makes the existing database unreadable.

### Sidecar reports success but the backend page is unchanged

Check that `TARGET_DIR` is the directory actually served by the backend and that Sidecar and the backend mount the same directory or named volume.

### Docker archive will not load

Check that Docker is running, the download is complete, and the host architecture is supported. The current archives are `linux/amd64`; use a static package or Sidecar if amd64 emulation is unavailable.

## Build from source

Build from source only for development or platforms without a prebuilt artifact. For normal deployment, use the Release downloads above. Development commands are documented in `AGENTS.md` and the individual deployment directories.
