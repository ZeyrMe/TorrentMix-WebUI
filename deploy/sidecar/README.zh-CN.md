# Sidecar Updater

[English](README.md)

Sidecar 负责把后端正在使用的 WebUI 目录更新到最新发布版本。它会定期读取 `latest.json`，下载 `dist.zip`，校验 SHA-256，然后更新目标目录。

只有以下检查全部通过才会安装：

- `latest.json` 提供 `release.distZip`；
- 如果提供 `release.distZipSha256`，压缩包校验必须通过；
- 解压后的根目录直接包含 `index.html`。

## 安装和运行

### Node 脚本

Release 会直接提供 `updater.mjs`，不需要从源码仓库取文件。运行脚本需要 Node.js 20+ 和系统 `unzip` 命令：

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

单次更新可以把 `CHECK_INTERVAL_SEC` 设为 `0`。长期运行时建议交给 systemd、supervisord 或容器管理。

### Docker 镜像

Release 提供可以直接导入的 amd64 Docker 镜像归档：

```bash
VERSION=0.1.0
curl -fL -o torrentmix-sidecar-image.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-sidecar-v${VERSION}-docker-linux-amd64.tar.gz"
gzip -dc torrentmix-sidecar-image.tar.gz | docker load
docker run --rm \
  -e LATEST_URL='https://zeyrme.github.io/TorrentMix-WebUI/latest.json' \
  -e CHECK_INTERVAL_SEC=3600 \
  -v /path/to/backend/webui:/target \
  "torrentmix-sidecar:${VERSION}"
```

`/target` 必须是后端实际使用的 WebUI 目录。Sidecar 容器不包含 qBittorrent 或 Transmission。

### 从源码构建（开发用途）

如果修改了 updater，再从源码构建镜像：

```bash
docker build -t torrentmix-sidecar -f deploy/sidecar/Dockerfile .
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `LATEST_URL` | 是 | — | 指向 `latest.json` 的 URL |
| `TARGET_DIR` | 否 | `/target` | WebUI 解压目标目录 |
| `CHECK_INTERVAL_SEC` | 否 | `3600` | 轮询间隔；设为 `0` 只执行一次 |
| `TMP_ROOT` | 否 | `/tmp/webui-sidecar` | 下载和解压时使用的临时目录 |

如果校验失败或压缩包结构非法，Sidecar 会报错并保留当前目标目录内容。

## 接入后端

Sidecar 和后端必须共享同一个 WebUI 目录：

- **qBittorrent**：在设置中启用 *Alternative WebUI*，把目录指向共享目录。具体路径取决于后端的安装方式。
- **Transmission**：通过 `--web-home` 或对应配置项把 WebUI 目录指向共享目录。

Sidecar 只负责替换文件，后端地址、认证和 API 代理仍由 qBittorrent / Transmission 自己处理。
