#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
  fs,
  net::{IpAddr, Ipv4Addr, SocketAddr},
  path::PathBuf,
  time::Duration,
};

use anyhow::{anyhow, Context, Result};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tracing_subscriber::{fmt, EnvFilter};

const DEFAULT_CONFIG_JSON: &str = r#"{
  "defaultServerId": "local-qb",
  "servers": [
    {
      "id": "local-qb",
      "name": "Local qBittorrent",
      "type": "qbit",
      "baseUrl": "http://127.0.0.1:8080",
      "username": "admin",
      "password": "adminadmin"
    }
  ]
}
"#;

fn main() {
  let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
  fmt().with_env_filter(filter).init();

  tauri::Builder::default()
    .setup(|app| {
      let static_dir = resolve_static_dir()?;
      let config_path = resolve_config_path(app)?;
      ensure_config_file(&config_path)?;

      let addr = tauri::async_runtime::block_on(async move {
        let listen = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0);
        let listener = tokio::net::TcpListener::bind(listen)
          .await
          .context("bind gateway listener")?;
        let addr = gateway::spawn_with_listener(listener, static_dir, config_path)
          .await
          .context("start gateway")?;
        tokio::time::sleep(Duration::from_millis(50)).await;
        Ok::<SocketAddr, anyhow::Error>(addr)
      })?;

      let url = format!("http://127.0.0.1:{}/", addr.port());
      let url = url.parse().context("parse gateway url")?;

      WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("TorrentMix")
        .build()
        .context("create main window")?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("tauri run failed");
}

fn resolve_static_dir() -> Result<PathBuf> {
  if let Ok(v) = std::env::var("STATIC_DIR") {
    let v = v.trim();
    if !v.is_empty() {
      return Ok(PathBuf::from(v));
    }
  }

  let cwd = std::env::current_dir().context("get current dir")?;
  let by_cwd = cwd.join("dist");
  if by_cwd.join("index.html").exists() {
    return Ok(by_cwd);
  }

  let exe = std::env::current_exe().context("get current exe")?;
  if let Some(dir) = exe.parent() {
    let by_exe = dir.join("dist");
    if by_exe.join("index.html").exists() {
      return Ok(by_exe);
    }
  }

  Err(anyhow!(
    "找不到前端静态资源目录：请先运行 `pnpm build` 生成 dist/，或设置 STATIC_DIR"
  ))
}

fn resolve_config_path(app: &tauri::App) -> Result<PathBuf> {
  if let Ok(v) = std::env::var("STANDALONE_CONFIG") {
    let v = v.trim();
    if !v.is_empty() {
      return Ok(PathBuf::from(v));
    }
  }

  let dir = app
    .path()
    .app_config_dir()
    .context("resolve app config dir")?;
  Ok(dir.join("standalone.json"))
}

fn ensure_config_file(path: &PathBuf) -> Result<()> {
  if path.exists() {
    return Ok(());
  }
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).with_context(|| format!("create dir: {}", parent.display()))?;
  }
  fs::write(path, DEFAULT_CONFIG_JSON.as_bytes())
    .with_context(|| format!("write config: {}", path.display()))?;
  Ok(())
}
