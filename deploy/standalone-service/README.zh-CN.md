# Standalone Service

[English](README.md)

Standalone Service 是 TorrentMix 的独立部署方式。它在一个端口上托管 WebUI、保存后端目录，并把 `/api/*` 和 `/transmission/*` 请求代理到当前选中的后端。

完整的用户部署流程见 [`docs/deployment.zh-CN.md`](../../docs/deployment.zh-CN.md)。这里保留服务本身的安装和配置参考。

## 安装

### Docker

Release 提供 Linux amd64 Docker 归档。下载后直接导入，不需要在目标机器上执行 Dockerfile：

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

`TORRENTMIX_DB_KEY` 必须在后续重启、升级和恢复时保持不变。`/config` 保存 SQLCipher 配置库，删除 volume 会同时删除服务器目录。

### Linux x64 二进制

Release 的二进制压缩包已经包含 WebUI，不需要 Rust：

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

长期运行时，请把程序交给 systemd 或其他进程管理器。升级只替换程序和 `dist/`，保留数据库和主密钥。

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LISTEN_ADDR` | `:8080` | HTTP 监听地址 |
| `STATIC_DIR` | `/app/dist` | WebUI 静态文件目录 |
| `STANDALONE_DB` | `/config/catalog.db` | SQLCipher 配置库路径 |
| `TORRENTMIX_DB_KEY` | 无 | SQLCipher 主密钥；Docker 部署必须设置 |

第一次打开页面后，使用“切换服务器 → 管理服务器”添加 qBittorrent 或 Transmission。服务器用户名和密码保存在加密配置库中，密码不会在页面中回显。

## 更新和回滚

Docker 部署：导入目标版本的 Docker 归档，用原来的 `torrentmix-config` volume 和 `TORRENTMIX_DB_KEY` 重建容器。二进制部署：替换程序和 `dist/`，保留 `STANDALONE_DB` 指向的数据库。回滚时下载目标版本的 Release 归档即可。

源码构建只用于开发或未覆盖的平台；普通部署请使用 Release 产物。
