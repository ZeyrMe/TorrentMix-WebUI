use std::{
  fmt,
  path::{Path, PathBuf},
  sync::Arc,
};

use anyhow::{anyhow, Context, Result};
use getrandom::fill as fill_random;
use keyring::{Entry, Error as KeyringError};

pub const ENV_MASTER_KEY: &str = "TORRENTMIX_DB_KEY";
const DEFAULT_KEYRING_SERVICE: &str = "io.github.ZeyrMe.torrentmix";
const DEFAULT_KEYRING_ACCOUNT: &str = "gateway-catalog-db";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeFlavor {
  Desktop,
  StandaloneService,
}

impl fmt::Display for RuntimeFlavor {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      Self::Desktop => f.write_str("desktop"),
      Self::StandaloneService => f.write_str("standalone-service"),
    }
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MasterKeySource {
  Environment,
  OsKey,
  GeneratedOsKey,
}

impl fmt::Display for MasterKeySource {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      Self::Environment => f.write_str("env"),
      Self::OsKey => f.write_str("os-key"),
      Self::GeneratedOsKey => f.write_str("generated-os-key"),
    }
  }
}

#[derive(Debug, Clone)]
pub struct ResolvedMasterKey {
  pub secret: String,
  pub source: MasterKeySource,
}

pub trait OsKeyProvider: Send + Sync {
  fn read(&self, db_path: &Path) -> Result<Option<String>>;
  fn write(&self, db_path: &Path, secret: &str) -> Result<()>;
}

#[derive(Debug, Clone)]
pub struct KeyringOsKeyProvider {
  service_name: String,
  account_name: String,
}

impl Default for KeyringOsKeyProvider {
  fn default() -> Self {
    Self {
      service_name: DEFAULT_KEYRING_SERVICE.to_string(),
      account_name: DEFAULT_KEYRING_ACCOUNT.to_string(),
    }
  }
}

impl KeyringOsKeyProvider {
  fn entry(&self, db_path: &Path) -> Result<Entry> {
    let target = normalize_db_path(db_path)?;
    Entry::new_with_target(&target, &self.service_name, &self.account_name)
      .context("create OS key entry")
  }
}

impl OsKeyProvider for KeyringOsKeyProvider {
  fn read(&self, db_path: &Path) -> Result<Option<String>> {
    let entry = self.entry(db_path)?;
    match entry.get_password() {
      Ok(secret) => Ok(Some(secret)),
      Err(KeyringError::NoEntry) => Ok(None),
      Err(err) => Err(anyhow!(err)).context("read OS key"),
    }
  }

  fn write(&self, db_path: &Path, secret: &str) -> Result<()> {
    let entry = self.entry(db_path)?;
    entry
      .set_password(secret)
      .map_err(|err| anyhow!(err))
      .context("write OS key")
  }
}

#[derive(Clone)]
pub struct MasterKeyResolver {
  runtime: RuntimeFlavor,
  env_var: String,
  provider: Arc<dyn OsKeyProvider>,
}

impl MasterKeyResolver {
  pub fn new(runtime: RuntimeFlavor, provider: Arc<dyn OsKeyProvider>) -> Self {
    Self {
      runtime,
      env_var: ENV_MASTER_KEY.to_string(),
      provider,
    }
  }

  pub fn resolve(&self, db_path: &Path) -> Result<ResolvedMasterKey> {
    let env_value = read_env_key(&self.env_var);
    self.resolve_with_env_value(db_path, env_value)
  }

  pub fn resolve_with_env_value(
    &self,
    db_path: &Path,
    env_value: Option<String>,
  ) -> Result<ResolvedMasterKey> {
    if let Some(secret) = env_value.filter(|value| !value.trim().is_empty()) {
      return Ok(ResolvedMasterKey {
        secret: secret.trim().to_string(),
        source: MasterKeySource::Environment,
      });
    }

    if let Some(secret) = self.provider.read(db_path)? {
      return Ok(ResolvedMasterKey {
        secret,
        source: MasterKeySource::OsKey,
      });
    }

    match self.runtime {
      RuntimeFlavor::Desktop => {
        let secret = generate_master_key().context("generate desktop catalog key")?;
        self
          .provider
          .write(db_path, &secret)
          .context("persist generated desktop catalog key")?;
        Ok(ResolvedMasterKey {
          secret,
          source: MasterKeySource::GeneratedOsKey,
        })
      }
      RuntimeFlavor::StandaloneService => Err(anyhow!(
        "no usable catalog database key found; set {} or provision an OS key for {}",
        self.env_var,
        normalize_db_path(db_path).unwrap_or_else(|_| db_path.display().to_string())
      )),
    }
  }
}

fn read_env_key(name: &str) -> Option<String> {
  let value = std::env::var(name).ok()?;
  let value = value.trim();
  if value.is_empty() {
    None
  } else {
    Some(value.to_string())
  }
}

fn normalize_db_path(db_path: &Path) -> Result<String> {
  let absolute = absolutize_path(db_path)?;
  Ok(absolute.to_string_lossy().into_owned())
}

fn absolutize_path(path: &Path) -> Result<PathBuf> {
  if path.is_absolute() {
    return Ok(path.to_path_buf());
  }

  Ok(std::env::current_dir().context("get current dir for catalog path")?.join(path))
}

fn generate_master_key() -> Result<String> {
  let mut bytes = [0u8; 32];
  fill_random(&mut bytes).map_err(|err| anyhow!("fill random bytes: {err}"))?;

  let mut out = String::with_capacity(bytes.len() * 2);
  for byte in bytes {
    use std::fmt::Write as _;
    write!(&mut out, "{byte:02x}").expect("write to string");
  }
  Ok(out)
}

#[cfg(test)]
mod tests {
  use std::{collections::HashMap, path::Path, sync::{Arc, Mutex}};

  use anyhow::Result;

  use super::{MasterKeyResolver, MasterKeySource, OsKeyProvider, RuntimeFlavor};

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

  #[test]
  fn env_key_overrides_os_key() -> Result<()> {
    let provider = MemoryOsKeyProvider::default();
    provider.write(Path::new("/tmp/catalog.db"), "os-secret")?;

    let resolver = MasterKeyResolver::new(RuntimeFlavor::StandaloneService, Arc::new(provider));
    let resolved = resolver.resolve_with_env_value(
      Path::new("/tmp/catalog.db"),
      Some("env-secret".to_string()),
    )?;

    assert_eq!(resolved.secret, "env-secret");
    assert_eq!(resolved.source, MasterKeySource::Environment);
    Ok(())
  }

  #[test]
  fn desktop_bootstraps_missing_os_key() -> Result<()> {
    let provider = MemoryOsKeyProvider::default();
    let resolver = MasterKeyResolver::new(RuntimeFlavor::Desktop, Arc::new(provider.clone()));
    let path = Path::new("/tmp/desktop-catalog.db");

    let first = resolver.resolve_with_env_value(path, None)?;
    assert_eq!(first.source, MasterKeySource::GeneratedOsKey);
    assert!(!first.secret.is_empty());

    let second = resolver.resolve_with_env_value(path, None)?;
    assert_eq!(second.source, MasterKeySource::OsKey);
    assert_eq!(second.secret, first.secret);
    Ok(())
  }

  #[test]
  fn standalone_service_requires_existing_key_source() {
    let resolver = MasterKeyResolver::new(
      RuntimeFlavor::StandaloneService,
      Arc::new(MemoryOsKeyProvider::default()),
    );

    let err = resolver
      .resolve_with_env_value(Path::new("/tmp/service-catalog.db"), None)
      .expect_err("service should fail without env or OS key");

    assert!(err.to_string().contains("TORRENTMIX_DB_KEY"));
  }
}
