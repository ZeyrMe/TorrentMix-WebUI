# 部署 TorrentMix WebUI

这是一份面向使用者的部署说明。正常部署不需要安装 Node.js、pnpm 或 Rust；从 [GitHub Releases](https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest) 下载对应产物即可。

如果你只是想把 WebUI 接到已经运行的 qBittorrent 或 Transmission，先看[静态包部署](#静态包部署)。如果希望由 TorrentMix 同时托管页面、管理多个后端并代理 API，使用下面的 Standalone Docker 部署。

## 推荐：Standalone Docker

Standalone 是一个独立服务：它提供 WebUI、保存后端目录，并把浏览器请求代理到选中的 qBittorrent 或 Transmission。它适合新部署，也最容易升级和回滚。

### 环境要求

- Docker Engine 24+，或 Docker Desktop；
- 安装命令需要 `curl`、`gzip` 和 `openssl`；
- 当前 Release 提供 `linux/amd64` 镜像归档；ARM 主机需要 Docker 仿真，或者改用静态包 / Node Sidecar；
- 主机能够访问你配置的 qBittorrent / Transmission 地址。

### 安装

下面的命令把配置卷、主密钥和容器都放在明确的位置。主密钥只生成一次，之后升级和恢复备份都必须继续使用同一个文件。

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

打开 `http://localhost:8080`，进入“切换服务器 → 管理服务器”，添加第一个后端。Standalone 容器需要能够访问后端；如果后端也运行在 Docker 外部，按你的 Docker 环境把后端地址配置为容器可访问的地址。

### 升级和回滚

升级时只替换镜像，不要删除 `torrentmix-config` 卷，也不要重新生成 `.env`：

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

回滚就是用目标版本的归档重复这组命令。数据库和主密钥必须配对，否则服务无法解锁配置库。

### 备份

至少备份下面两个东西：

- `/opt/torrentmix/.env`；
- `torrentmix-config` Docker volume。

例如把配置卷导出到当前目录：

```bash
docker run --rm \
  -v torrentmix-config:/config \
  -v "$PWD":/backup \
  alpine:3.20 \
  tar czf /backup/torrentmix-config.tar.gz -C /config .
```

恢复时，先停止 Standalone，再把备份内容解压回同一个卷，并继续使用原来的 `.env`。

## 其他部署方式

### 静态包部署

静态包适合已经运行 qBittorrent 或 Transmission、只需要替换 WebUI 文件的场景。它不提供代理，也不管理后端配置。

```bash
mkdir -p /path/to/backend/webui
curl -fL -o dist.zip \
  https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/dist.zip
unzip -o dist.zip -d /path/to/backend/webui
```

解压后，`/path/to/backend/webui/index.html` 应该直接存在。不要用 `file://` 打开目录，页面必须由后端或其他 HTTP 服务托管。

- qBittorrent：启用 **Alternative WebUI**，把路径指向这个目录；
- Transmission：使用 `--web-home` 或对应配置项指向这个目录。

更新时下载目标版本的 `dist.zip`，解压覆盖同一个目录。需要回滚时，把 `latest` 换成固定 tag，例如 `v0.1.0`。

### Sidecar 自动更新

Sidecar 适合不想增加代理服务、但希望已有后端自动更新 WebUI 的场景。它只负责把 `dist.zip` 安装到后端正在使用的目录，后端本身仍由 qBittorrent / Transmission 管理。

Node 版本需要 20+，系统还需要 `unzip` 命令：

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

`CHECK_INTERVAL_SEC=0` 只执行一次。长期运行时，把命令交给 systemd、supervisord 或容器管理器。Sidecar 和后端必须共享同一个 WebUI 目录；目录不对时，更新成功也不会影响实际页面。

例如使用 systemd 长期运行 Node 脚本：

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

保存后执行 `sudo systemctl daemon-reload && sudo systemctl enable --now torrentmix-sidecar`。

也可以直接导入 Release 提供的 Docker 归档：

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

Loader 只适合“后端能提供一个 WebUI 目录，并且浏览器可以访问发布源”的场景。它本身不包含完整页面，而是从 `latest.json` 加载远端资源。

```bash
curl -fL -o /path/to/backend/webui/index.html \
  https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/loader.html
```

Loader 会跟随最新版；需要固定版本时，在 URL 上使用 `?ver=0.1.0` 或 `?tag=v0.1.0`。由于它会加载远端脚本，只应连接自己信任的发布源，也不适合完全离线环境。

## 常见问题

### 页面空白或资源 404

确认页面是通过 qBittorrent、Transmission、Standalone 或其他 HTTP 服务访问的，而不是双击 `index.html`。静态包解压后还应确认 `index.html` 位于 WebUI 目录根部。

### Standalone 启动后无法解锁配置

检查容器使用的 `.env` 是否还是第一次启动时生成的文件。更换 `TORRENTMIX_DB_KEY` 会让原来的数据库无法解密。

### Sidecar 显示更新成功，但后端页面没变化

检查 `TARGET_DIR` 是否就是后端实际提供页面的目录，并确认 Sidecar 与后端挂载的是同一个目录或 named volume。

### Docker 归档导入失败

确认 Docker 正在运行、下载文件完整，并检查主机架构。当前归档是 `linux/amd64`；如果主机没有启用 amd64 仿真，应改用静态包或 Sidecar。

## 从源码构建

源码构建只用于开发或未提供预构建产物的平台。普通部署请优先使用上面的 Release 下载方式。开发命令见仓库根目录的 `AGENTS.md` 和各部署目录说明。
