mod catalog;
mod key;
mod migrations;
mod store;

use std::{
  collections::HashMap,
  net::{IpAddr, Ipv4Addr, SocketAddr},
  path::PathBuf,
  sync::Arc,
  time::Duration,
};

use anyhow::{anyhow, Context, Result};
use axum::{
  body::Body,
  extract::State,
  http::{
    header::{self, HeaderName},
    HeaderMap, HeaderValue, Method, Request, StatusCode, Uri,
  },
  response::{IntoResponse, Response},
  routing::{any, get, post},
  Json, Router,
};
use axum_extra::extract::cookie::CookieJar;
use bytes::Bytes;
use futures_util::{StreamExt, TryStreamExt};
use reqwest::redirect::Policy;
use tokio::{
  net::TcpStream,
  sync::{Mutex, RwLock},
  time::{timeout_at, Instant},
};
use tower_http::services::{ServeDir, ServeFile};
use url::Url;

use crate::{
  catalog::{BackendType, Catalog, CatalogConfig, ServerConfig, ServerEntry, COOKIE_SELECTED_SERVER},
  key::{KeyringOsKeyProvider, MasterKeyResolver, RuntimeFlavor, ENV_MASTER_KEY},
  store::{CatalogStore, SqlCipherCatalogStore},
};

const ENV_CATALOG_DB: &str = "STANDALONE_DB";
const MAX_BODY_BYTES: usize = 64 << 20;

#[derive(Clone)]
struct AppState {
  catalog: Arc<RwLock<Catalog>>,
  store: Arc<dyn CatalogStore>,
  qbit: Arc<QbitSessions>,
  client: reqwest::Client,
}

struct QbitSession {
  cookie: Option<String>,
}

struct QbitSessions {
  sessions: Mutex<HashMap<String, Arc<Mutex<QbitSession>>>>,
  client: reqwest::Client,
}

impl QbitSessions {
  fn new() -> Result<Self> {
    let client = reqwest::Client::builder()
      .timeout(Duration::from_secs(12))
      .redirect(Policy::none())
      .build()
      .context("build qB http client")?;

    Ok(Self {
      sessions: Mutex::new(HashMap::new()),
      client,
    })
  }

  async fn session(&self, id: &str) -> Arc<Mutex<QbitSession>> {
    let mut map = self.sessions.lock().await;
    map
      .entry(id.to_string())
      .or_insert_with(|| Arc::new(Mutex::new(QbitSession { cookie: None })))
      .clone()
  }

  async fn clear(&self) {
    self.sessions.lock().await.clear();
  }

  async fn ensure_cookie(&self, entry: &ServerEntry, force: bool) -> Result<String> {
    if entry.cfg.username.is_empty() && entry.cfg.password.is_empty() {
      return Err(anyhow!(
        "qBittorrent server requires username/password in config"
      ));
    }

    let session = self.session(&entry.cfg.id).await;
    let mut guard = session.lock().await;

    if let Some(cookie) = guard.cookie.clone() {
      if !force {
        return Ok(cookie);
      }
    }

    let login_url = join_url(&entry.base, "/api/v2/auth/login")?;
    let origin = entry.origin.clone();
    let referer = format!("{}/", origin);

    let resp = self
      .client
      .post(login_url)
      .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
      .header("Origin", &origin)
      .header("Referer", &referer)
      .form(&[
        ("username", entry.cfg.username.clone()),
        ("password", entry.cfg.password.clone()),
      ])
      .send()
      .await
      .context("qB login request failed")?;

    let status = resp.status();
    let headers = resp.headers().clone();
    let body = resp
      .bytes()
      .await
      .unwrap_or_else(|_| Bytes::from_static(b""));

    if status != StatusCode::OK {
      let text = String::from_utf8_lossy(&body).trim().to_string();
      return Err(anyhow!("qB login failed: status={} body={:?}", status, text));
    }
    if !String::from_utf8_lossy(&body).contains("Ok") {
      let text = String::from_utf8_lossy(&body).trim().to_string();
      return Err(anyhow!("qB login failed: body={:?}", text));
    }

    let cookies = extract_set_cookie_pairs(&headers);
    if cookies.is_empty() {
      return Err(anyhow!("qB login did not set cookies"));
    }

    let cookie = cookies.join("; ");
    guard.cookie = Some(cookie.clone());
    Ok(cookie)
  }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerPublic {
  id: String,
  name: String,
  #[serde(rename = "type")]
  kind: BackendType,
  base_url: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  latency_ms: Option<u64>,
  reachable: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
  schema: u32,
  selected_id: String,
  servers: Vec<ServerPublic>,
}

#[derive(Debug, serde::Deserialize)]
struct SelectRequest {
  id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigServerPublic {
  id: String,
  name: String,
  #[serde(rename = "type")]
  kind: BackendType,
  base_url: String,
  username: String,
  has_password: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigResponse {
  schema: u32,
  default_server_id: String,
  servers: Vec<ConfigServerPublic>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigUpdateRequest {
  #[serde(default)]
  default_server_id: String,
  #[serde(default)]
  servers: Vec<ConfigUpdateServer>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigUpdateServer {
  id: String,
  #[serde(default)]
  name: String,
  #[serde(rename = "type")]
  kind: BackendType,
  base_url: String,
  #[serde(default)]
  username: String,
  password: Option<String>,
}

pub async fn serve_from_env() -> Result<()> {
  let listen = env_or_default("LISTEN_ADDR", ":8080");
  let static_dir = env_or_default("STATIC_DIR", "./dist");
  let catalog_db_path = env_or_default(ENV_CATALOG_DB, "/config/catalog.db");

  serve(&listen, PathBuf::from(static_dir), PathBuf::from(catalog_db_path)).await
}

fn env_or_default(key: &str, default: &str) -> String {
  let Ok(value) = std::env::var(key) else {
    return default.to_string();
  };
  let value = value.trim();
  if value.is_empty() {
    default.to_string()
  } else {
    value.to_string()
  }
}

pub async fn serve(listen: &str, static_dir: PathBuf, catalog_db_path: PathBuf) -> Result<()> {
  let addr = normalize_listen_addr(listen)?;
  let state = build_state(RuntimeFlavor::StandaloneService, catalog_db_path)?;
  let app = build_router(state, static_dir);

  tracing::info!(listen = %addr, "standalone-service listening");
  axum::serve(tokio::net::TcpListener::bind(addr).await?, app.into_make_service())
    .await
    .context("http server error")
}

pub async fn spawn_with_listener(
  listener: tokio::net::TcpListener,
  static_dir: PathBuf,
  catalog_db_path: PathBuf,
) -> Result<SocketAddr> {
  let addr = listener.local_addr().context("listener local_addr")?;
  let state = build_state(RuntimeFlavor::Desktop, catalog_db_path)?;
  let app = build_router(state, static_dir);

  tokio::spawn(async move {
    if let Err(err) = axum::serve(listener, app.into_make_service()).await {
      tracing::error!(error = %err, "http server error");
    }
  });

  Ok(addr)
}

fn build_state(runtime: RuntimeFlavor, catalog_db_path: PathBuf) -> Result<AppState> {
  let provider = Arc::new(KeyringOsKeyProvider::default());
  let resolver = MasterKeyResolver::new(runtime, provider);
  let resolved_key = resolver
    .resolve(&catalog_db_path)
    .with_context(|| format!("resolve catalog database key from {} or OS key", ENV_MASTER_KEY))?;
  build_state_from_resolved_key(runtime, catalog_db_path, resolved_key)
}

#[cfg(test)]
fn build_state_with_provider(
  runtime: RuntimeFlavor,
  catalog_db_path: PathBuf,
  provider: Arc<dyn key::OsKeyProvider>,
  env_key: Option<String>,
) -> Result<AppState> {
  let resolver = MasterKeyResolver::new(runtime, provider);
  let resolved_key = resolver
    .resolve_with_env_value(&catalog_db_path, env_key)
    .with_context(|| format!("resolve catalog database key from {} or OS key", ENV_MASTER_KEY))?;
  build_state_from_resolved_key(runtime, catalog_db_path, resolved_key)
}

fn build_state_from_resolved_key(
  runtime: RuntimeFlavor,
  catalog_db_path: PathBuf,
  resolved_key: key::ResolvedMasterKey,
) -> Result<AppState> {
  let store = Arc::new(SqlCipherCatalogStore::bootstrap(catalog_db_path, resolved_key).context("bootstrap encrypted catalog store")?)
    as Arc<dyn CatalogStore>;
  let catalog = store.load_catalog().context("load catalog from encrypted store")?;

  tracing::info!(
    runtime = %runtime,
    catalog_db = %store.database_path().display(),
    key_source = %store.key_source(),
    "catalog store ready"
  );

  let qbit = Arc::new(QbitSessions::new()?);
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(60))
    .redirect(Policy::none())
    .build()
    .context("build proxy http client")?;

  Ok(AppState {
    catalog: Arc::new(RwLock::new(catalog)),
    store,
    qbit,
    client,
  })
}

fn build_router(state: AppState, static_dir: PathBuf) -> Router {
  let index_path = static_dir.join("index.html");
  let static_service = ServeDir::new(static_dir).fallback(ServeFile::new(index_path));

  Router::new()
    .route("/__standalone__/status", get(handle_status))
    .route("/__standalone__/select", post(handle_select))
    .route("/__standalone__/config", get(handle_config_get).post(handle_config_update))
    .route("/api/*path", any(handle_proxy))
    .route("/transmission/*path", any(handle_proxy))
    .fallback_service(static_service)
    .with_state(state)
}

fn normalize_listen_addr(raw: &str) -> Result<SocketAddr> {
  let raw = raw.trim();
  if raw.is_empty() {
    return Err(anyhow!("LISTEN_ADDR is empty"));
  }

  if let Some(port) = raw.strip_prefix(':') {
    let port: u16 = port
      .parse()
      .with_context(|| format!("invalid port in LISTEN_ADDR {:?}", raw))?;
    return Ok(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port));
  }

  raw
    .parse::<SocketAddr>()
    .with_context(|| format!("invalid LISTEN_ADDR {:?}", raw))
}

async fn handle_status(State(state): State<AppState>, jar: CookieJar) -> impl IntoResponse {
  let (selected, items) = {
    let catalog = state.catalog.read().await;
    let selected = catalog.selected_id(&jar).unwrap_or("").to_string();
    let mut items = Vec::with_capacity(catalog.order.len());
    for id in &catalog.order {
      let entry = catalog.servers.get(id).expect("catalog validated");
      items.push((
        entry.cfg.id.clone(),
        entry.cfg.name.clone(),
        entry.cfg.kind,
        entry.cfg.base_url.clone(),
        entry.base.clone(),
      ));
    }
    (selected, items)
  };
  let deadline = Instant::now() + Duration::from_millis(1200);

  let mut tasks = Vec::with_capacity(items.len());
  for (id, _name, _kind, _base_url, base) in &items {
    let id = id.clone();
    let base = base.clone();
    tasks.push(async move {
      let (latency_ms, reachable) = measure_tcp_dial_latency(deadline, &base).await;
      (id, latency_ms, reachable)
    });
  }

  let results = futures_util::future::join_all(tasks).await;
  let mut lat_map: HashMap<String, (Option<u64>, bool)> = HashMap::with_capacity(results.len());
  for (id, latency_ms, reachable) in results {
    lat_map.insert(id, (latency_ms, reachable));
  }

  let mut servers = Vec::with_capacity(items.len());
  for (id, name, kind, base_url, _base) in items {
    let (latency_ms, reachable) = lat_map.get(&id).cloned().unwrap_or((None, false));
    servers.push(ServerPublic {
      id,
      name,
      kind,
      base_url,
      latency_ms,
      reachable,
    });
  }

  let out = StatusResponse {
    schema: 1,
    selected_id: selected,
    servers,
  };

  (
    [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
    Json(out),
  )
}

async fn handle_select(State(state): State<AppState>, req: Request<Body>) -> Response {
  if req.method() != Method::POST {
    return (StatusCode::METHOD_NOT_ALLOWED, "method not allowed").into_response();
  }

  let body = match read_body_bytes(req.into_body(), 1024).await {
    Ok(value) => value,
    Err(_) => return (StatusCode::BAD_REQUEST, "invalid json body").into_response(),
  };

  let parsed: SelectRequest = match serde_json::from_slice(&body) {
    Ok(value) => value,
    Err(_) => return (StatusCode::BAD_REQUEST, "invalid json body").into_response(),
  };

  let id = parsed.id.trim().to_string();
  if id.is_empty() {
    return (StatusCode::BAD_REQUEST, "id is required").into_response();
  }
  {
    let catalog = state.catalog.read().await;
    if !catalog.servers.contains_key(&id) {
      return (StatusCode::BAD_REQUEST, "unknown server id").into_response();
    }
  }

  let cookie = format!(
    "{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000",
    name = COOKIE_SELECTED_SERVER,
    value = id,
  );
  let mut headers = HeaderMap::new();
  if let Ok(value) = header::HeaderValue::from_str(&cookie) {
    headers.insert(header::SET_COOKIE, value);
  }

  let out = serde_json::json!({ "ok": true, "id": id });
  (headers, Json(out)).into_response()
}

async fn handle_proxy(
  State(state): State<AppState>,
  jar: CookieJar,
  req: Request<Body>,
) -> Response {
  let entry = {
    let catalog = state.catalog.read().await;
    match catalog.pick(&jar) {
      Some(entry) => entry.clone(),
      None => {
        return (StatusCode::SERVICE_UNAVAILABLE, "no server configured").into_response();
      }
    }
  };

  let method = req.method().clone();
  let uri = req.uri().clone();
  let headers = req.headers().clone();

  let body = match read_body_bytes(req.into_body(), MAX_BODY_BYTES).await {
    Ok(value) => value,
    Err(ReadBodyError::TooLarge) => {
      return (StatusCode::PAYLOAD_TOO_LARGE, "request entity too large").into_response();
    }
    Err(_) => return (StatusCode::BAD_REQUEST, "read body failed").into_response(),
  };

  let mut cookie: Option<String> = None;
  if entry.cfg.kind == BackendType::Qbit {
    if let Ok(value) = state.qbit.ensure_cookie(&entry, false).await {
      cookie = Some(value);
    }
  }

  let mut resp = match forward_once(
    &state,
    &entry,
    &method,
    &uri,
    &headers,
    body.clone(),
    cookie.as_deref(),
  )
  .await
  {
    Ok(value) => value,
    Err(err) => return (StatusCode::BAD_GATEWAY, err.to_string()).into_response(),
  };

  if entry.cfg.kind == BackendType::Qbit && resp.status() == StatusCode::FORBIDDEN {
    if let Ok(value) = state.qbit.ensure_cookie(&entry, true).await {
      cookie = Some(value);
    }
    resp = match forward_once(
      &state,
      &entry,
      &method,
      &uri,
      &headers,
      body,
      cookie.as_deref(),
    )
    .await
    {
      Ok(value) => value,
      Err(err) => return (StatusCode::BAD_GATEWAY, err.to_string()).into_response(),
    };
  }

  let status = resp.status();
  let mut out_headers = sanitize_response_headers(resp.headers().clone());
  let stream = resp
    .bytes_stream()
    .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err));
  let body = Body::from_stream(stream);

  let mut out = Response::new(body);
  *out.status_mut() = status;
  *out.headers_mut() = std::mem::take(&mut out_headers);
  out
}

async fn handle_config_get(State(state): State<AppState>) -> impl IntoResponse {
  let (default_server_id, servers) = {
    let catalog = state.catalog.read().await;
    let default_server_id = catalog.default_id.clone();
    let mut servers = Vec::with_capacity(catalog.order.len());
    for id in &catalog.order {
      let entry = catalog.servers.get(id).expect("catalog validated");
      servers.push(ConfigServerPublic {
        id: entry.cfg.id.clone(),
        name: entry.cfg.name.clone(),
        kind: entry.cfg.kind,
        base_url: entry.cfg.base_url.clone(),
        username: entry.cfg.username.clone(),
        has_password: !entry.cfg.password.is_empty(),
      });
    }
    (default_server_id, servers)
  };

  let out = ConfigResponse {
    schema: 1,
    default_server_id,
    servers,
  };

  (
    [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
    Json(out),
  )
}

async fn handle_config_update(
  State(state): State<AppState>,
  req: Request<Body>,
) -> Response {
  if req.method() != Method::POST {
    return (StatusCode::METHOD_NOT_ALLOWED, "method not allowed").into_response();
  }

  let body = match read_body_bytes(req.into_body(), 64 * 1024).await {
    Ok(value) => value,
    Err(ReadBodyError::TooLarge) => {
      return (StatusCode::PAYLOAD_TOO_LARGE, "request entity too large").into_response();
    }
    Err(_) => return (StatusCode::BAD_REQUEST, "read body failed").into_response(),
  };

  let parsed: ConfigUpdateRequest = match serde_json::from_slice(&body) {
    Ok(value) => value,
    Err(_) => return (StatusCode::BAD_REQUEST, "invalid json body").into_response(),
  };

  let existing_passwords = {
    let catalog = state.catalog.read().await;
    catalog
      .servers
      .iter()
      .map(|(id, entry)| (id.clone(), entry.cfg.password.clone()))
      .collect::<HashMap<String, String>>()
  };

  let mut servers = Vec::with_capacity(parsed.servers.len());
  let mut seen_ids = HashMap::<String, ()>::with_capacity(parsed.servers.len());

  for server in parsed.servers {
    let id = server.id.trim().to_string();
    if id.is_empty() {
      return (StatusCode::BAD_REQUEST, "server.id is required").into_response();
    }
    if seen_ids.insert(id.clone(), ()).is_some() {
      return (StatusCode::BAD_REQUEST, "duplicate server id").into_response();
    }

    let mut name = server.name.trim().to_string();
    if name.is_empty() {
      name = id.clone();
    }

    let base_url = server.base_url.trim().to_string();
    if base_url.is_empty() {
      return (StatusCode::BAD_REQUEST, "server.baseUrl is required").into_response();
    }
    match Url::parse(&base_url) {
      Ok(base) if !base.scheme().is_empty() && base.host_str().is_some() => {}
      _ => return (StatusCode::BAD_REQUEST, "server.baseUrl is invalid").into_response(),
    }

    let username = server.username.trim().to_string();
    let password = server
      .password
      .map(|value| value.trim().to_string())
      .unwrap_or_else(|| existing_passwords.get(&id).cloned().unwrap_or_default());

    if server.kind == BackendType::Qbit && username.is_empty() && password.is_empty() {
      return (StatusCode::BAD_REQUEST, "qBittorrent server requires username/password")
        .into_response();
    }

    servers.push(ServerConfig {
      id,
      name,
      kind: server.kind,
      base_url,
      username,
      password,
    });
  }

  let mut default_server_id = parsed.default_server_id.trim().to_string();
  if default_server_id.is_empty() {
    default_server_id = servers.first().map(|server| server.id.clone()).unwrap_or_default();
  } else if !servers.iter().any(|server| server.id == default_server_id) {
    return (StatusCode::BAD_REQUEST, "defaultServerId not found in servers").into_response();
  }

  let config = CatalogConfig {
    default_server_id,
    servers,
  };

  if let Err(err) = state.store.save_config(config) {
    tracing::error!(error = %err, "save catalog config failed");
    return (StatusCode::INTERNAL_SERVER_ERROR, "write config failed").into_response();
  }

  let new_catalog = match state.store.load_catalog() {
    Ok(value) => value,
    Err(err) => {
      tracing::error!(error = %err, "reload catalog failed");
      return (StatusCode::INTERNAL_SERVER_ERROR, "reload config failed").into_response();
    }
  };

  {
    let mut catalog = state.catalog.write().await;
    *catalog = new_catalog;
  }
  state.qbit.clear().await;

  Json(serde_json::json!({ "ok": true })).into_response()
}

async fn forward_once(
  state: &AppState,
  entry: &ServerEntry,
  method: &Method,
  uri: &Uri,
  headers: &HeaderMap,
  body: Vec<u8>,
  qbit_cookie: Option<&str>,
) -> Result<reqwest::Response> {
  let target = build_target_url(&entry.base, uri)?;
  let mut out_headers = sanitize_request_headers(headers.clone());

  if entry.cfg.kind == BackendType::Qbit {
    out_headers.insert("origin", HeaderValue::from_str(&entry.origin)?);
    out_headers.insert(
      "referer",
      HeaderValue::from_str(&format!("{}/", entry.origin))?,
    );
    if let Some(value) = qbit_cookie {
      out_headers.insert("cookie", HeaderValue::from_str(value)?);
    }
  }

  let mut builder = state
    .client
    .request(method.clone(), target)
    .headers(out_headers)
    .body(body);

  if entry.cfg.kind == BackendType::Trans
    && (!entry.cfg.username.is_empty() || !entry.cfg.password.is_empty())
  {
    builder = builder.basic_auth(entry.cfg.username.clone(), Some(entry.cfg.password.clone()));
  }

  builder.send().await.context("upstream request failed")
}

fn build_target_url(base: &Url, uri: &Uri) -> Result<Url> {
  let mut target = base.clone();
  let base_path = target.path();
  let base_path = if base_path == "/" { "" } else { base_path };
  let joined = join_path(base_path, uri.path());

  target.set_path(&joined);
  target.set_query(uri.query());
  Ok(target)
}

fn join_path(a: &str, b: &str) -> String {
  let a_slash = a.ends_with('/');
  let b_slash = b.starts_with('/');

  match (a_slash, b_slash) {
    (true, true) => format!("{}{}", a, b.trim_start_matches('/')),
    (false, false) => {
      if a.is_empty() {
        format!("/{b}")
      } else {
        format!("{a}/{b}")
      }
    }
    _ => format!("{a}{b}"),
  }
}

fn join_url(base: &Url, suffix: &str) -> Result<Url> {
  let mut out = base.clone();
  let base_path = out.path();
  let base_path = if base_path == "/" { "" } else { base_path };
  out.set_path(&join_path(base_path, suffix));
  Ok(out)
}

async fn measure_tcp_dial_latency(deadline: Instant, base: &Url) -> (Option<u64>, bool) {
  let Some(host) = base.host_str() else {
    return (None, false);
  };

  let port = base.port_or_known_default().unwrap_or(80);
  let addr = format_host_port(host, port);

  let start = Instant::now();
  let fut = TcpStream::connect(addr);
  match timeout_at(deadline, fut).await {
    Ok(Ok(stream)) => {
      drop(stream);
      let ms = start.elapsed().as_millis() as u64;
      (Some(ms), true)
    }
    _ => (None, false),
  }
}

fn format_host_port(host: &str, port: u16) -> String {
  if host.contains(':') && !host.starts_with('[') {
    format!("[{host}]:{port}")
  } else {
    format!("{host}:{port}")
  }
}

fn extract_set_cookie_pairs(headers: &HeaderMap) -> Vec<String> {
  let mut out = Vec::new();
  for value in headers.get_all(header::SET_COOKIE).iter() {
    let Ok(raw) = value.to_str() else {
      continue;
    };
    let Some(first) = raw.split(';').next() else {
      continue;
    };
    let pair = first.trim();
    if pair.is_empty() {
      continue;
    }
    let mut parts = pair.splitn(2, '=');
    let name = parts.next().unwrap_or("").trim();
    let value = parts.next().unwrap_or("").trim();
    if name.is_empty() {
      continue;
    }
    out.push(format!("{name}={value}"));
  }
  out
}

fn sanitize_request_headers(mut headers: HeaderMap) -> HeaderMap {
  remove_hop_headers(&mut headers);
  headers.remove(header::COOKIE);
  headers.remove(header::AUTHORIZATION);
  headers.remove(header::HOST);
  headers
}

fn sanitize_response_headers(mut headers: HeaderMap) -> HeaderMap {
  remove_hop_headers(&mut headers);
  headers.remove(header::SET_COOKIE);
  headers
}

fn remove_hop_headers(headers: &mut HeaderMap) {
  let connection = headers
    .get(header::CONNECTION)
    .and_then(|value| value.to_str().ok())
    .map(|value| value.to_string());
  if let Some(connection) = connection {
    for token in connection.split(',') {
      let name = token.trim().to_ascii_lowercase();
      if let Ok(name) = HeaderName::from_bytes(name.as_bytes()) {
        headers.remove(name);
      }
    }
  }

  for name in [
    "connection",
    "proxy-connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "trailers",
    "transfer-encoding",
    "upgrade",
  ] {
    headers.remove(name);
  }
}

#[derive(Debug)]
enum ReadBodyError {
  TooLarge,
  Other,
}

async fn read_body_bytes(body: Body, limit: usize) -> std::result::Result<Vec<u8>, ReadBodyError> {
  let mut out = Vec::new();
  let mut stream = body.into_data_stream();

  while let Some(next) = stream.next().await {
    let chunk = match next {
      Ok(value) => value,
      Err(_) => return Err(ReadBodyError::Other),
    };

    if out.len().saturating_add(chunk.len()) > limit {
      return Err(ReadBodyError::TooLarge);
    }

    out.extend_from_slice(&chunk);
  }

  Ok(out)
}

#[cfg(test)]
mod tests {
  use std::{
    collections::HashMap,
    net::SocketAddr,
    path::Path,
    sync::{
      atomic::{AtomicUsize, Ordering},
      Arc, Mutex,
    },
    time::Duration,
  };

  use anyhow::{Context, Result};
  use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
  };
  use tempfile::tempdir;
  use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
  };
  use tower::ServiceExt;
  use url::Url;

  use crate::{
    catalog::{BackendType, CatalogConfig, ServerConfig, COOKIE_SELECTED_SERVER},
    key::{OsKeyProvider, RuntimeFlavor},
  };

  use super::{build_router, build_state_with_provider, AppState};

  #[derive(Clone, Default)]
  struct MemoryOsKeyProvider {
    values: Arc<Mutex<HashMap<String, String>>>,
  }

  impl OsKeyProvider for MemoryOsKeyProvider {
    fn read(&self, db_path: &Path) -> Result<Option<String>> {
      Ok(self
        .values
        .lock()
        .expect("lock")
        .get(&db_path.display().to_string())
        .cloned())
    }

    fn write(&self, db_path: &Path, secret: &str) -> Result<()> {
      self
        .values
        .lock()
        .expect("lock")
        .insert(db_path.display().to_string(), secret.to_string());
      Ok(())
    }
  }

  #[derive(Clone, Default)]
  struct MockTransmissionState {
    requests: Arc<Mutex<Vec<Option<String>>>>,
  }

  #[derive(Clone, Default)]
  struct MockQbitState {
    login_count: Arc<AtomicUsize>,
    cookies: Arc<Mutex<Vec<Option<String>>>>,
  }

  async fn spawn_test_server<F, Fut>(handler: F) -> Result<Url>
  where
    F: Fn(String) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = String> + Send + 'static,
  {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let addr: SocketAddr = listener.local_addr()?;
    let handler = Arc::new(handler);
    tokio::spawn(async move {
      loop {
        let Ok((mut stream, _addr)) = listener.accept().await else {
          break;
        };
        let handler = handler.clone();
        tokio::spawn(async move {
          let mut buf = Vec::new();
          let mut chunk = [0u8; 2048];

          loop {
            match stream.read(&mut chunk).await {
              Ok(0) => break,
              Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|window| window == b"\r\n\r\n") {
                  break;
                }
              }
              Err(_) => return,
            }
          }

          let req = String::from_utf8_lossy(&buf).to_string();
          let resp = handler(req).await;
          let _ = stream.write_all(resp.as_bytes()).await;
          let _ = stream.shutdown().await;
        });
      }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    Ok(Url::parse(&format!("http://127.0.0.1:{}", addr.port()))?)
  }

  async fn spawn_transmission_upstream(name: &'static str) -> Result<(Url, MockTransmissionState)> {
    let state = MockTransmissionState::default();
    let shared = state.clone();
    let url = spawn_test_server(move |req| {
      let shared = shared.clone();
      async move {
        let auth = parse_header(&req, "authorization");
        shared.requests.lock().expect("lock").push(auth);
        http_response(StatusCode::OK, &[], name)
      }
    })
    .await?;
    Ok((url, state))
  }

  async fn spawn_qbit_upstream() -> Result<(Url, MockQbitState)> {
    let state = MockQbitState::default();
    let login_state = state.clone();
    let proxy_state = state.clone();
    let url = spawn_test_server(move |req| {
      let login_state = login_state.clone();
      let proxy_state = proxy_state.clone();
      async move {
        let path = parse_path(&req);
        if path == "/api/v2/auth/login" {
          login_state.login_count.fetch_add(1, Ordering::SeqCst);
          return http_response(
            StatusCode::OK,
            &[("Set-Cookie", "SID=fresh; HttpOnly")],
            "Ok.",
          );
        }

        let cookie = parse_header(&req, "cookie");
        proxy_state.cookies.lock().expect("lock").push(cookie.clone());
        if cookie.as_deref() == Some("SID=fresh") {
          http_response(StatusCode::OK, &[], "fresh")
        } else {
          http_response(StatusCode::FORBIDDEN, &[], "forbidden")
        }
      }
    })
    .await?;
    Ok((url, state))
  }

  fn parse_header(req: &str, name: &str) -> Option<String> {
    let prefix = format!("{}:", name.to_ascii_lowercase());
    req.lines().find_map(|line| {
      let trimmed = line.trim();
      let lower = trimmed.to_ascii_lowercase();
      if lower.starts_with(&prefix) {
        trimmed.split_once(':').map(|(_, value)| value.trim().to_string())
      } else {
        None
      }
    })
  }

  fn parse_path(req: &str) -> String {
    req.lines()
      .next()
      .and_then(|line| line.split_whitespace().nth(1))
      .unwrap_or("/")
      .to_string()
  }

  fn http_response(status: StatusCode, headers: &[(&str, &str)], body: &str) -> String {
    let status_line = format!(
      "HTTP/1.1 {} {}\r\n",
      status.as_u16(),
      status.canonical_reason().unwrap_or("OK")
    );
    let mut out = String::new();
    out.push_str(&status_line);
    out.push_str(&format!("Content-Length: {}\r\n", body.as_bytes().len()));
    out.push_str("Connection: close\r\n");
    for (name, value) in headers {
      out.push_str(name);
      out.push_str(": ");
      out.push_str(value);
      out.push_str("\r\n");
    }
    out.push_str("\r\n");
    out.push_str(body);
    out
  }

  async fn new_test_state() -> Result<(tempfile::TempDir, std::path::PathBuf, AppState)> {
    let runtime = tempdir()?;
    let static_dir = runtime.path().join("dist");
    std::fs::create_dir_all(&static_dir)?;
    std::fs::write(static_dir.join("index.html"), "ok")?;

    let db_path = runtime.path().join("catalog.db");
    let provider = Arc::new(MemoryOsKeyProvider::default());
    let state = build_state_with_provider(
      RuntimeFlavor::StandaloneService,
      db_path,
      provider,
      Some("integration-secret".to_string()),
    )?;

    Ok((runtime, static_dir, state))
  }

  async fn apply_catalog(state: &AppState, config: CatalogConfig) -> Result<()> {
    state.store.save_config(config)?;
    let catalog = state.store.load_catalog()?;
    *state.catalog.write().await = catalog;
    Ok(())
  }

  async fn send(app: &Router, req: Request<Body>) -> Result<axum::response::Response> {
    tokio::time::timeout(Duration::from_secs(5), app.clone().oneshot(req))
      .await
      .context("gateway test request timed out")?
      .map_err(Into::into)
  }

  #[tokio::test]
  async fn config_api_hides_and_preserves_passwords() -> Result<()> {
    let runtime = tempdir()?;
    let static_dir = runtime.path().join("dist");
    std::fs::create_dir_all(&static_dir)?;
    std::fs::write(static_dir.join("index.html"), "ok")?;

    let db_path = runtime.path().join("catalog.db");
    let provider = Arc::new(MemoryOsKeyProvider::default());
    let state = build_state_with_provider(
      RuntimeFlavor::StandaloneService,
      db_path.clone(),
      provider,
      Some("integration-secret".to_string()),
    )?;
    let store = state.store.clone();
    let app = build_router(state, static_dir);

    let create = Request::builder()
      .method("POST")
      .uri("/__standalone__/config")
      .header("content-type", "application/json")
      .body(Body::from(
        serde_json::json!({
          "defaultServerId": "home-qb",
          "servers": [
            {
              "id": "home-qb",
              "name": "Home qB",
              "type": "qbit",
              "baseUrl": "http://127.0.0.1:8080",
              "username": "admin",
              "password": "secret-1"
            }
          ]
        })
        .to_string(),
      ))?;
    let create_resp = app.clone().oneshot(create).await?;
    assert_eq!(create_resp.status(), StatusCode::OK);

    let read = Request::builder()
      .uri("/__standalone__/config")
      .body(Body::empty())?;
    let read_resp = app.clone().oneshot(read).await?;
    assert_eq!(read_resp.status(), StatusCode::OK);
    let read_json: serde_json::Value = serde_json::from_slice(&to_bytes(read_resp.into_body(), usize::MAX).await?)?;
    assert_eq!(read_json["servers"][0]["hasPassword"], serde_json::Value::Bool(true));
    assert!(read_json["servers"][0].get("password").is_none());

    let keep_existing = Request::builder()
      .method("POST")
      .uri("/__standalone__/config")
      .header("content-type", "application/json")
      .body(Body::from(
        serde_json::json!({
          "defaultServerId": "home-qb",
          "servers": [
            {
              "id": "home-qb",
              "name": "Home qB Updated",
              "type": "qbit",
              "baseUrl": "http://127.0.0.1:8080",
              "username": "admin"
            }
          ]
        })
        .to_string(),
      ))?;
    let keep_resp = app.clone().oneshot(keep_existing).await?;
    assert_eq!(keep_resp.status(), StatusCode::OK);
    let config_after_keep = store.load_config()?;
    assert_eq!(config_after_keep.servers[0].password, "secret-1");
    assert_eq!(config_after_keep.servers[0].name, "Home qB Updated");

    let clear_password = Request::builder()
      .method("POST")
      .uri("/__standalone__/config")
      .header("content-type", "application/json")
      .body(Body::from(
        serde_json::json!({
          "defaultServerId": "home-qb",
          "servers": [
            {
              "id": "home-qb",
              "name": "Home qB Updated",
              "type": "qbit",
              "baseUrl": "http://127.0.0.1:8080",
              "username": "admin",
              "password": ""
            }
          ]
        })
        .to_string(),
      ))?;
    let clear_resp = app.clone().oneshot(clear_password).await?;
    assert_eq!(clear_resp.status(), StatusCode::OK);
    let config_after_clear = store.load_config()?;
    assert_eq!(config_after_clear.servers[0].password, "");

    let read_after_clear = Request::builder()
      .uri("/__standalone__/config")
      .body(Body::empty())?;
    let read_after_clear_resp = app.oneshot(read_after_clear).await?;
    let read_after_clear_json: serde_json::Value = serde_json::from_slice(
      &to_bytes(read_after_clear_resp.into_body(), usize::MAX).await?,
    )?;
    assert_eq!(read_after_clear_json["servers"][0]["hasPassword"], serde_json::Value::Bool(false));
    Ok(())
  }

  #[tokio::test]
  async fn status_select_and_proxy_share_effective_server_selection() -> Result<()> {
    let (_runtime, static_dir, state) = new_test_state().await?;
    let (primary_url, primary_state) = spawn_transmission_upstream("primary").await?;
    let (secondary_url, secondary_state) = spawn_transmission_upstream("secondary").await?;

    apply_catalog(
      &state,
      CatalogConfig {
        default_server_id: "primary".to_string(),
        servers: vec![
          ServerConfig {
            id: "primary".to_string(),
            name: "Primary".to_string(),
            kind: BackendType::Trans,
            base_url: primary_url.to_string(),
            username: "a".to_string(),
            password: "a".to_string(),
          },
          ServerConfig {
            id: "secondary".to_string(),
            name: "Secondary".to_string(),
            kind: BackendType::Trans,
            base_url: secondary_url.to_string(),
            username: "b".to_string(),
            password: "b".to_string(),
          },
        ],
      },
    )
    .await?;

    let app = build_router(state.clone(), static_dir);

    let status_resp = send(&app, Request::builder().uri("/__standalone__/status").body(Body::empty())?).await?;
    assert_eq!(status_resp.status(), StatusCode::OK);
    let status_json: serde_json::Value = serde_json::from_slice(&to_bytes(status_resp.into_body(), usize::MAX).await?)?;
    assert_eq!(status_json["selectedId"], serde_json::Value::String("primary".to_string()));

    let invalid_cookie_resp = send(
      &app,
      Request::builder()
        .uri("/__standalone__/status")
        .header(header::COOKIE, format!("{COOKIE_SELECTED_SERVER}=missing"))
        .body(Body::empty())?,
    )
    .await?;
    let invalid_cookie_json: serde_json::Value = serde_json::from_slice(
      &to_bytes(invalid_cookie_resp.into_body(), usize::MAX).await?,
    )?;
    assert_eq!(invalid_cookie_json["selectedId"], serde_json::Value::String("primary".to_string()));

    let select_resp = send(
      &app,
      Request::builder()
        .method("POST")
        .uri("/__standalone__/select")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"id":"secondary"}"#))?,
    )
    .await?;
    assert_eq!(select_resp.status(), StatusCode::OK);
    let set_cookie = select_resp
      .headers()
      .get(header::SET_COOKIE)
      .and_then(|value| value.to_str().ok())
      .unwrap_or("");
    assert!(set_cookie.contains("tm_server_id=secondary"));

    let selected_status_resp = send(
      &app,
      Request::builder()
        .uri("/__standalone__/status")
        .header(header::COOKIE, format!("{COOKIE_SELECTED_SERVER}=secondary"))
        .body(Body::empty())?,
    )
    .await?;
    let selected_status_json: serde_json::Value = serde_json::from_slice(
      &to_bytes(selected_status_resp.into_body(), usize::MAX).await?,
    )?;
    assert_eq!(selected_status_json["selectedId"], serde_json::Value::String("secondary".to_string()));

    let proxy_resp = send(
      &app,
      Request::builder()
        .uri("/transmission/rpc")
        .header(header::COOKIE, format!("{COOKIE_SELECTED_SERVER}=secondary"))
        .body(Body::empty())?,
    )
    .await?;
    assert_eq!(proxy_resp.status(), StatusCode::OK);
    let proxy_body = to_bytes(proxy_resp.into_body(), usize::MAX).await?;
    assert_eq!(&proxy_body[..], b"secondary");
    assert!(primary_state.requests.lock().expect("lock").is_empty());
    assert_eq!(
      secondary_state.requests.lock().expect("lock").as_slice(),
      &[Some("Basic Yjpi".to_string())]
    );

    let unknown_select_resp = send(
      &app,
      Request::builder()
        .method("POST")
        .uri("/__standalone__/select")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"id":"unknown"}"#))?,
    )
    .await?;
    assert_eq!(unknown_select_resp.status(), StatusCode::BAD_REQUEST);

    Ok(())
  }

  #[tokio::test]
  async fn config_update_clears_qbit_sessions_and_removed_selection_falls_back() -> Result<()> {
    let (_runtime, static_dir, state) = new_test_state().await?;
    let (primary_url, primary_state) = spawn_transmission_upstream("primary").await?;
    let (secondary_url, _secondary_state) = spawn_transmission_upstream("secondary").await?;

    apply_catalog(
      &state,
      CatalogConfig {
        default_server_id: "primary".to_string(),
        servers: vec![
          ServerConfig {
            id: "primary".to_string(),
            name: "Primary".to_string(),
            kind: BackendType::Trans,
            base_url: primary_url.to_string(),
            username: "a".to_string(),
            password: "a".to_string(),
          },
          ServerConfig {
            id: "secondary".to_string(),
            name: "Secondary".to_string(),
            kind: BackendType::Trans,
            base_url: secondary_url.to_string(),
            username: "b".to_string(),
            password: "b".to_string(),
          },
        ],
      },
    )
    .await?;

    {
      let session = state.qbit.session("primary").await;
      session.lock().await.cookie = Some("SID=primary".to_string());
      let session = state.qbit.session("secondary").await;
      session.lock().await.cookie = Some("SID=secondary".to_string());
    }
    assert_eq!(state.qbit.sessions.lock().await.len(), 2);

    let app = build_router(state.clone(), static_dir);
    let update_resp = send(
      &app,
      Request::builder()
        .method("POST")
        .uri("/__standalone__/config")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
          serde_json::json!({
            "defaultServerId": "primary",
            "servers": [
              {
                "id": "primary",
                "name": "Primary",
                "type": "trans",
                "baseUrl": primary_url.to_string(),
                "username": "a",
                "password": "a"
              }
            ]
          })
          .to_string(),
        ))?,
    )
    .await?;
    assert_eq!(update_resp.status(), StatusCode::OK);
    assert!(state.qbit.sessions.lock().await.is_empty());

    let fallback_status_resp = send(
      &app,
      Request::builder()
        .uri("/__standalone__/status")
        .header(header::COOKIE, format!("{COOKIE_SELECTED_SERVER}=secondary"))
        .body(Body::empty())?,
    )
    .await?;
    let fallback_status_json: serde_json::Value = serde_json::from_slice(
      &to_bytes(fallback_status_resp.into_body(), usize::MAX).await?,
    )?;
    assert_eq!(fallback_status_json["selectedId"], serde_json::Value::String("primary".to_string()));

    let proxy_resp = send(
      &app,
      Request::builder()
        .uri("/transmission/rpc")
        .header(header::COOKIE, format!("{COOKIE_SELECTED_SERVER}=secondary"))
        .body(Body::empty())?,
    )
    .await?;
    assert_eq!(proxy_resp.status(), StatusCode::OK);
    let proxy_body = to_bytes(proxy_resp.into_body(), usize::MAX).await?;
    assert_eq!(&proxy_body[..], b"primary");
    assert_eq!(
      primary_state.requests.lock().expect("lock").last().cloned(),
      Some(Some("Basic YTph".to_string()))
    );

    Ok(())
  }

  #[tokio::test]
  async fn qbit_proxy_forces_reauth_once_after_forbidden() -> Result<()> {
    let (_runtime, static_dir, state) = new_test_state().await?;
    let (qbit_url, qbit_state) = spawn_qbit_upstream().await?;

    apply_catalog(
      &state,
      CatalogConfig {
        default_server_id: "home-qb".to_string(),
        servers: vec![ServerConfig {
          id: "home-qb".to_string(),
          name: "Home qB".to_string(),
          kind: BackendType::Qbit,
          base_url: qbit_url.to_string(),
          username: "admin".to_string(),
          password: "secret".to_string(),
        }],
      },
    )
    .await?;

    let session = state.qbit.session("home-qb").await;
    session.lock().await.cookie = Some("SID=stale".to_string());

    let app = build_router(state, static_dir);
    let resp = send(&app, Request::builder().uri("/api/v2/test").body(Body::empty())?).await?;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = to_bytes(resp.into_body(), usize::MAX).await?;
    assert_eq!(&body[..], b"fresh");
    assert_eq!(qbit_state.login_count.load(Ordering::SeqCst), 1);
    assert_eq!(
      qbit_state.cookies.lock().expect("lock").as_slice(),
      &[Some("SID=stale".to_string()), Some("SID=fresh".to_string())]
    );
    Ok(())
  }

  #[tokio::test]
  async fn desktop_bootstraps_empty_database_with_os_key() -> Result<()> {
    let dir = tempdir()?;
    let static_dir = dir.path().join("dist");
    std::fs::create_dir_all(&static_dir)?;
    std::fs::write(static_dir.join("index.html"), "ok")?;

    let db_path = dir.path().join("catalog.db");
    let provider = Arc::new(MemoryOsKeyProvider::default());
    let state = build_state_with_provider(RuntimeFlavor::Desktop, db_path.clone(), provider, None)?;

    assert!(db_path.exists());
    assert!(state.catalog.read().await.order.is_empty());
    Ok(())
  }

  #[tokio::test]
  async fn standalone_service_fails_with_wrong_env_key_for_existing_database() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("catalog.db");
    let provider = Arc::new(MemoryOsKeyProvider::default());

    let state = build_state_with_provider(
      RuntimeFlavor::StandaloneService,
      db_path.clone(),
      provider.clone(),
      Some("good-key".to_string()),
    )?;
    state.store.save_config(CatalogConfig {
      default_server_id: "home-qb".to_string(),
      servers: vec![ServerConfig {
        id: "home-qb".to_string(),
        name: "Home qB".to_string(),
        kind: BackendType::Qbit,
        base_url: "http://127.0.0.1:8080".to_string(),
        username: "admin".to_string(),
        password: "secret".to_string(),
      }],
    })?;

    let err = match build_state_with_provider(
      RuntimeFlavor::StandaloneService,
      db_path,
      provider,
      Some("wrong-key".to_string()),
    ) {
      Ok(_) => panic!("wrong env key should fail startup"),
      Err(err) => err,
    };
    assert!(!err.to_string().trim().is_empty());
    Ok(())
  }
}
