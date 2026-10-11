# 部署方式

这是一份面向部署者的说明。正常使用时，应优先从 GitHub Release 下载已经构建好的产物，不需要安装 Node、pnpm 或 Rust。

仓库目前提供四种分发方式：

| 方式 | 适合场景 | 直接可取得的产物 |
| --- | --- | --- |
| **A. Loader** | 放一个入口文件，自动跟随远端发布 | `loader.html` |
| **B. Standalone** | 页面、代理和服务器列表由一个服务管理 | Linux x64 压缩包 / Docker 镜像归档 |
| **C. Sidecar** | 已经有后端，只自动更新 WebUI 文件 | `updater.mjs` / Docker 镜像归档 |
| **D. Dist** | 离线、内网或手动更新 | `dist.zip` |

简单选择：已有后端、手动部署用 **D**；已有后端、希望自动更新用 **C**；想让页面和代理一起运行用 **B**；只想放一个入口文件并跟随线上版本用 **A**。

## Release 下载地址

下面的地址指向最新版。需要固定版本时，把 `latest` 换成 tag，例如 `v0.1.0`。

```text
Release 页面：
https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest

Loader：
https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/loader.html

Dist：
https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/dist.zip

Sidecar 脚本：
https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/updater.mjs
```

## A. Loader

Loader 适合“后端只提供一个可写的 WebUI 目录，但希望以后自动跟随发布”的情况。

```bash
curl -fL -o loader.html \
  https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/loader.html
mv loader.html index.html
```

把 `index.html` 放入 qBittorrent 或 Transmission 的 WebUI 目录后，通过后端访问页面。Loader 会读取发布源的 `latest.json`，再加载对应的 JS、CSS 和字体文件。

需要固定版本时，可以使用：

```text
?ver=0.1.0
或
?tag=v0.1.0
```

也可以在 `index.html` 同目录放置 `config.json`：

```json
{
  "latestUrl": "https://YOUR-DOMAIN/latest.json",
  "pinnedVersion": "0.1.0"
}
```

Loader 需要浏览器能够访问发布源，不适合完全离线环境。它会加载远端脚本，只应指向自己信任的发布源。

## B. Standalone

Standalone Service 会在同一个端口上托管 WebUI，并代理后端 API：

- `/api/*` 代理 qBittorrent；
- `/transmission/*` 代理 Transmission；
- `/__standalone__/status` 查看当前服务器目录；
- `/__standalone__/config` 编辑服务器目录。

服务器目录保存在加密的 SQLCipher 数据库中。第一次启动时，打开页面后进入“切换服务器 → 管理服务器”添加 qBittorrent 或 Transmission。

### B1. Linux x64 压缩包

Release 中的 `torrentmix-standalone-service-v<VERSION>-linux-amd64.tar.gz` 已经包含二进制和 WebUI，Linux x64 主机不需要 Rust：

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

保持 `TORRENTMIX_DB_KEY` 不变。升级时替换程序和 `dist/`，保留 `data/catalog.db`；回滚时下载目标版本的压缩包即可。

### B2. Docker 镜像归档

Release 中的 Docker 归档可以直接导入，不需要重新执行 Dockerfile：

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

镜像归档目前是 Linux amd64 版本。`/config` 是数据库所在的持久化卷，删除它会连同服务器目录一起删除。修改服务器配置时不需要进入容器，直接在 WebUI 的管理面板操作即可。

### B3. 配置和更新

常用环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `LISTEN_ADDR` | `:8080` | Standalone 监听地址 |
| `STATIC_DIR` | `/app/dist` | WebUI 目录；二进制部署时指向压缩包内的 `dist/` |
| `STANDALONE_DB` | `/config/catalog.db` | SQLCipher 数据库路径 |
| `TORRENTMIX_DB_KEY` | 无 | SQLCipher 主密钥，容器部署必须设置 |

数据库和主密钥是一对。保留数据库时必须保留原主密钥，不能用新值覆盖。

## C. Sidecar

Sidecar 不监听 HTTP 端口，也不负责代理。它只把发布的 `dist.zip` 更新到后端正在使用的 WebUI 目录。Sidecar 与后端必须挂载同一个目录。

### C1. Node 脚本

Release 直接提供 `updater.mjs`。脚本运行需要 Node.js 20+ 和系统 `unzip` 命令；不需要 pnpm 或 Rust：

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

`CHECK_INTERVAL_SEC=0` 表示只更新一次。长期运行时，把这条命令交给 systemd、supervisord 或其他进程管理器。临时文件默认放在 `/tmp/webui-sidecar`，可以通过 `TMP_ROOT` 改到有足够空间且可写的目录。

### C2. Docker 镜像归档

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

容器归档目前是 Linux amd64 版本。`/target` 必须是后端实际提供页面的目录，Sidecar 容器本身不包含 qBittorrent 或 Transmission。

### C3. 接入后端

- **qBittorrent**：启用 *Alternative WebUI*，并把 WebUI 路径指向共享目录。Docker 部署时，让 qBittorrent 容器和 Sidecar 容器挂载同一个 named volume。
- **Transmission**：使用 `--web-home` 或对应配置项，把 WebUI 路径指向共享目录。

Sidecar 的安装顺序是“下载 → 校验 SHA-256 → 解压到临时目录 → 检查根目录 `index.html` → 更新目标目录”。校验失败或压缩包结构不对时，会保留当前页面。

## D. Dist

Dist 是最直接的手动安装方式：

```bash
mkdir -p /path/to/backend/webui
curl -fL -o dist.zip \
  https://github.com/ZeyrMe/TorrentMix-WebUI/releases/latest/download/dist.zip
unzip -o dist.zip -d /path/to/backend/webui
```

压缩包根目录直接包含 `index.html`，不需要再移动一层目录。更新时重复下载并解压即可；需要回滚时下载固定 tag 的 `dist.zip`。

不要直接用 `file://` 打开解压后的目录，页面需要由 qBittorrent、Transmission 或其他 HTTP 服务托管。

## Docker 归档说明

当前 Release 提供的是 Linux amd64 Docker 归档，使用方式是：

```bash
gzip -dc image.tar.gz | docker load
```

它不是 Docker Hub 镜像，因此不会因为 registry 登录或镜像源配置而无法使用。之后如果发布多架构镜像，会在文件名中明确标出平台。

如果下载或导入失败，先检查：磁盘空间、Docker 是否正在运行、下载文件是否完整，以及 `docker load` 的错误信息。`TLS handshake timeout` 出现在源码构建时，通常表示 Docker 拉取基础镜像的网络问题；直接导入 Release 归档不需要重新拉取这些基础镜像。

## 从源码构建

源码构建主要面向开发和未覆盖平台，不是普通部署的前置步骤：

```bash
pnpm install
pnpm build
cargo build --manifest-path rust/Cargo.toml --release -p standalone-service
```

Release、Pages 和上述稳定下载地址才是正常部署入口。

## 产物对应关系

| 形态 | 入口 |
| --- | --- |
| A. Loader | Release 的 `loader.html`，或 Pages 的 `/loader.html` |
| B. Standalone | `*-linux-amd64.tar.gz` 或 `*-docker-linux-amd64.tar.gz` |
| C. Sidecar | Release 的 `updater.mjs` 或 `*-docker-linux-amd64.tar.gz` |
| D. Dist | Release 的 `dist.zip`，或 Pages 版本目录中的 `dist.zip` |
