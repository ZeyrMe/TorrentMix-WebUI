# Sidecar Updater

[English](README.md)

Sidecar 用于已有 qBittorrent 或 Transmission 部署。它定期读取 `latest.json`，下载并校验 `dist.zip`，然后把文件安装到后端正在使用的 WebUI 目录。它不监听 HTTP 端口，也不负责 API 代理。

完整的部署选择和安装流程见 [`docs/deployment.zh-CN.md`](../../docs/deployment.zh-CN.md)。

## Node 脚本

脚本需要 Node.js 20+ 和系统 `unzip` 命令。Release 直接提供 `updater.mjs`：

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

将 `CHECK_INTERVAL_SEC` 设为 `0` 可以只执行一次。长期运行时使用 systemd、supervisord 或其他进程管理器。

## Docker

Release 提供 Linux amd64 Docker 归档：

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

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `LATEST_URL` | 是 | 无 | `latest.json` 地址 |
| `TARGET_DIR` | 否 | `/target` | WebUI 安装目录 |
| `CHECK_INTERVAL_SEC` | 否 | `3600` | 轮询间隔；`0` 只执行一次 |
| `TMP_ROOT` | 否 | `/tmp/webui-sidecar` | 下载和解压临时目录 |

Sidecar 和后端必须共享同一个 WebUI 目录。qBittorrent 需要启用 **Alternative WebUI**；Transmission 使用 `--web-home` 或对应配置项。校验失败或压缩包结构不正确时，Sidecar 会保留当前目录内容。
