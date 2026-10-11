# Standalone Service

[English](README.md)

**Standalone Service** 将 WebUI 包装成一个同源网关服务：静态资源托管和后端 API 代理使用同一进程、同一端口。

**功能：**

- 托管 WebUI 静态资源
- 将 `/api/*`（qBittorrent）和 `/transmission/*`（Transmission）代理到服务器目录中的后端
- 提供服务器切换面板和延迟显示
- 使用加密 SQLCipher 数据库保存服务器目录，并支持在浏览器内编辑

## 安装方式

### Linux x64 二进制

Release 会提供带 WebUI 的 Linux x64 压缩包，不需要安装 Rust：

```bash
VERSION=0.1.0
curl -fL -o torrentmix-standalone-service.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-standalone-service-v${VERSION}-linux-amd64.tar.gz"
tar -xzf torrentmix-standalone-service.tar.gz
cd "torrentmix-standalone-service-v${VERSION}-linux-amd64"
mkdir -p data
STANDALONE_DB="$PWD/data/catalog.db" \
TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
STATIC_DIR="$PWD/dist" \
./standalone-service
```

这个压缩包目前面向 Linux x64。其他平台可以使用 Docker，或者按下面的源码方式构建。

### Docker 镜像

Release 同时提供可以直接导入的 Docker 镜像归档：

```bash
VERSION=0.1.0
curl -fL -o torrentmix-standalone-image.tar.gz \
  "https://github.com/ZeyrMe/TorrentMix-WebUI/releases/download/v${VERSION}/torrentmix-standalone-service-v${VERSION}-docker-linux-amd64.tar.gz"
gzip -dc torrentmix-standalone-image.tar.gz | docker load

docker run -d --name torrentmix-standalone -p 8080:8080 \
  -e TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
  -v torrentmix-catalog:/config \
  "torrentmix-standalone-service:${VERSION}"
```

打开 `http://localhost:8080`，通过“切换服务器 → 管理服务器”添加第一个后端。`/config` 保存数据库，升级容器时不要删除这个 volume。`TORRENTMIX_DB_KEY` 也必须保持不变，否则数据库无法解锁。

## 配置

服务将运行时配置保存在 `STANDALONE_DB` 指向的加密 SQLCipher 数据库中（容器默认是 `/config/catalog.db`）。数据库包含默认服务器选择、服务器元数据、用户名和密码。

### 主密钥

- `TORRENTMIX_DB_KEY`：显式提供的主密钥。只要设置，就会直接使用它。
- OS Key provider：没有设置环境变量时尝试使用，适合非容器环境。
- 没有可用密钥：服务启动失败，不会自动生成无人管理的密钥。

### 环境变量

| 变量 | 说明 |
|------|------|
| `LISTEN_ADDR` | 监听地址，默认 `:8080` |
| `STATIC_DIR` | WebUI 静态资源目录，默认 `/app/dist` |
| `STANDALONE_DB` | SQLCipher 配置库路径，默认 `/config/catalog.db` |
| `TORRENTMIX_DB_KEY` | 显式 SQLCipher 主密钥，Docker 建议设置 |

`standalone.json` / `config.example.json` 只作为参考材料保留，runtime 不会读取它们。

## 更新和回滚

二进制部署只需要替换程序和 `dist/`，保留 `data/catalog.db`。Docker 部署则重新导入目标版本的镜像，并使用原来的 `torrentmix-catalog` volume。需要回滚时，把下载地址中的版本号改成目标 tag，例如 `v0.1.0`。

在浏览器内编辑配置时，变更会写回 `STANDALONE_DB`。密码不会回显，留空表示保持原值不变。

## 从源码构建（开发用途）

```bash
cargo build --manifest-path rust/Cargo.toml --release -p standalone-service

# macOS / Linux
STANDALONE_DB=/tmp/torrentmix/catalog.db \
TORRENTMIX_DB_KEY='replace-with-a-long-random-string' \
LISTEN_ADDR=:8080 \
./rust/target/release/standalone-service

# Windows（PowerShell）
$env:STANDALONE_DB = 'C:\torrentmix\catalog.db'
$env:TORRENTMIX_DB_KEY = 'replace-with-a-long-random-string'
$env:LISTEN_ADDR = ':8080'
.\rust\target\release\standalone-service.exe
```
