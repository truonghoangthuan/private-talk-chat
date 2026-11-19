use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::commands::AppError;

pub const DEFAULT_UPDATE_FEED_URL: &str =
    "https://github.com/private-talk/private-talk-chat/releases/latest/download/latest.json";

/// Compile-time embedded 32-byte Ed25519 public key (hex or base64 via `PRIVATE_TALK_UPDATER_PUBKEY`).
const COMPILE_TIME_PUBKEY: Option<&str> = option_env!("PRIVATE_TALK_UPDATER_PUBKEY");
const COMPILE_TIME_UPDATE_URL: Option<&str> = option_env!("PRIVATE_TALK_UPDATE_URL");

/// Deterministic fallback 32-byte Ed25519 public key used when `PRIVATE_TALK_UPDATER_PUBKEY` is unset.
const DEFAULT_UPDATER_PUBKEY_HEX: &str =
    "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";

pub const MAX_INSTALLER_BYTES: u64 = 104_857_600;
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SemanticVersion {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

impl SemanticVersion {
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        let trimmed = raw.trim();
        let normalized = trimmed.strip_prefix('v').unwrap_or(trimmed);
        if normalized.is_empty() || normalized.contains('-') || normalized.contains('+') {
            return Err(AppError::new(
                "UPDATE_MANIFEST_INVALID",
                "Release version must be a stable MAJOR.MINOR.PATCH value.",
            ));
        }

        let parts: Vec<&str> = normalized.split('.').collect();
        if parts.len() != 3 {
            return Err(AppError::new(
                "UPDATE_MANIFEST_INVALID",
                "Release version must have exactly three numeric segments.",
            ));
        }

        let parse_part = |part: &str| -> Result<u64, AppError> {
            if part.is_empty()
                || !part.bytes().all(|b| b.is_ascii_digit())
                || (part.len() > 1 && part.starts_with('0'))
            {
                return Err(AppError::new(
                    "UPDATE_MANIFEST_INVALID",
                    "Release version contains invalid numeric segment.",
                ));
            }
            part.parse::<u64>().map_err(|_| {
                AppError::new("UPDATE_MANIFEST_INVALID", "Release version segment out of range.")
            })
        };

        Ok(Self {
            major: parse_part(parts[0])?,
            minor: parse_part(parts[1])?,
            patch: parse_part(parts[2])?,
        })
    }
}

impl std::fmt::Display for SemanticVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleaseManifest {
    pub version: String,
    pub published_at: DateTime<Utc>,
    pub notes: String,
    pub draft: bool,
    pub prerelease: bool,
    pub installer_url: String,
    pub installer_file_name: String,
    pub installer_size_bytes: u64,
    pub installer_sha256: String,
    pub signature: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdatePhase {
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Installing,
    VerificationFailed,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateStatusDto {
    pub phase: UpdatePhase,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_notes: Option<String>,
    pub published_at: Option<DateTime<Utc>>,
    pub progress_percent: Option<u8>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl UpdateStatusDto {
    pub fn idle(current_version: &str) -> Self {
        Self {
            phase: UpdatePhase::Idle,
            current_version: current_version.to_string(),
            latest_version: None,
            release_notes: None,
            published_at: None,
            progress_percent: None,
            downloaded_bytes: None,
            total_bytes: None,
            error_code: None,
            error_message: None,
        }
    }
}

pub fn decode_key_32(raw: &str, code: &'static str) -> Result<[u8; 32], AppError> {
    let trimmed = raw.trim();
    if trimmed.len() == 64 && trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
        let bytes = hex::decode(trimmed)
            .map_err(|_| AppError::new(code, "Invalid 32-byte hex key."))?;
        if bytes.len() == 32 {
            let mut out = [0u8; 32];
            out.copy_from_slice(&bytes);
            return Ok(out);
        }
    }
    if let Ok(bytes) = B64.decode(trimmed) {
        if bytes.len() == 32 {
            let mut out = [0u8; 32];
            out.copy_from_slice(&bytes);
            return Ok(out);
        }
    }
    Err(AppError::new(code, "Key must be 32-byte hex or base64."))
}

pub fn embedded_public_key_bytes() -> Result<[u8; 32], AppError> {
    let runtime_env = std::env::var("PRIVATE_TALK_UPDATER_PUBKEY").ok();
    let raw = runtime_env
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(COMPILE_TIME_PUBKEY)
        .unwrap_or(DEFAULT_UPDATER_PUBKEY_HEX);
    decode_key_32(raw, "UPDATE_SIGNATURE_INVALID")
}

pub fn canonical_signing_payload(
    version: &SemanticVersion,
    installer_sha256: &str,
    installer_size_bytes: u64,
) -> String {
    format!("privatetalk-update-v1\n{version}\n{installer_sha256}\n{installer_size_bytes}")
}

pub fn sign_release_payload(
    signing_seed: &[u8; 32],
    version: &SemanticVersion,
    installer_sha256: &str,
    installer_size_bytes: u64,
) -> String {
    let signing_key = SigningKey::from_bytes(signing_seed);
    let payload = canonical_signing_payload(version, installer_sha256, installer_size_bytes);
    let signature: Signature = signing_key.sign(payload.as_bytes());
    B64.encode(signature.to_bytes())
}

pub fn build_signed_manifest(
    signing_seed: &[u8; 32],
    version: &str,
    published_at: DateTime<Utc>,
    notes: &str,
    installer_url: &str,
    installer_file_name: &str,
    installer_bytes: &[u8],
) -> Result<ReleaseManifest, AppError> {
    let parsed_version = SemanticVersion::parse(version)?;
    let sha256_hex = hex::encode(Sha256::digest(installer_bytes));
    let size_bytes = u64::try_from(installer_bytes.len())
        .map_err(|_| AppError::new("UPDATE_MANIFEST_INVALID", "Installer size overflow."))?;
    let signature = sign_release_payload(signing_seed, &parsed_version, &sha256_hex, size_bytes);

    let manifest = ReleaseManifest {
        version: parsed_version.to_string(),
        published_at,
        notes: notes.trim().to_string(),
        draft: false,
        prerelease: false,
        installer_url: installer_url.to_string(),
        installer_file_name: installer_file_name.to_string(),
        installer_size_bytes: size_bytes,
        installer_sha256: sha256_hex,
        signature,
    };

    let verifying_key = SigningKey::from_bytes(signing_seed).verifying_key().to_bytes();
    let allow_loopback = is_loopback_http_url(&manifest.installer_url);
    validate_and_verify_manifest(&manifest, &verifying_key, allow_loopback)?;
    Ok(manifest)
}

fn is_loopback_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://127.0.0.1:")
        || lower.starts_with("http://127.0.0.1/")
        || lower.starts_with("http://localhost:")
        || lower.starts_with("http://localhost/")
}

fn validate_installer_url(url: &str, allow_loopback_http: bool) -> Result<(), AppError> {
    if url.starts_with("https://") && url.len() > "https://".len() {
        return Ok(());
    }
    if allow_loopback_http && is_loopback_http_url(url) {
        return Ok(());
    }
    Err(AppError::new(
        "UPDATE_MANIFEST_INVALID",
        "Update installer URL must use HTTPS.",
    ))
}

fn validate_installer_file_name(name: &str) -> Result<(), AppError> {
    let valid_chars = !name.is_empty()
        && name.ends_with(".exe")
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-');
    if !valid_chars {
        return Err(AppError::new(
            "UPDATE_MANIFEST_INVALID",
            "Installer filename contains unsafe or invalid characters.",
        ));
    }
    Ok(())
}

pub fn validate_and_verify_manifest(
    manifest: &ReleaseManifest,
    trusted_pubkey: &[u8; 32],
    allow_loopback_http: bool,
) -> Result<SemanticVersion, AppError> {
    if manifest.draft || manifest.prerelease {
        return Err(AppError::new(
            "UPDATE_MANIFEST_INVALID",
            "Draft or prerelease updates are rejected.",
        ));
    }

    let version = SemanticVersion::parse(&manifest.version)?;

    let trimmed_notes_len = manifest.notes.trim().chars().count();
    if !(1..=4000).contains(&trimmed_notes_len) {
        return Err(AppError::new(
            "UPDATE_MANIFEST_INVALID",
            "Release notes summary length is out of bounds.",
        ));
    }

    validate_installer_url(&manifest.installer_url, allow_loopback_http)?;
    validate_installer_file_name(&manifest.installer_file_name)?;

    if manifest.installer_size_bytes == 0 || manifest.installer_size_bytes > MAX_INSTALLER_BYTES {
        return Err(AppError::new(
            "UPDATE_MANIFEST_INVALID",
            "Installer size is outside allowed bounds.",
        ));
    }

    if manifest.installer_sha256.len() != 64
        || !manifest
            .installer_sha256
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(AppError::new(
            "UPDATE_MANIFEST_INVALID",
            "Installer SHA-256 must be 64 lowercase hexadecimal characters.",
        ));
    }

    let sig_bytes = B64
        .decode(manifest.signature.trim())
        .map_err(|_| AppError::new("UPDATE_SIGNATURE_INVALID", "Malformed release signature."))?;
    let sig_arr: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| AppError::new("UPDATE_SIGNATURE_INVALID", "Invalid signature byte length."))?;
    let signature = Signature::from_bytes(&sig_arr);
    let verifying_key = VerifyingKey::from_bytes(trusted_pubkey)
        .map_err(|_| AppError::new("UPDATE_SIGNATURE_INVALID", "Invalid embedded verifying key."))?;

    let payload = canonical_signing_payload(
        &version,
        &manifest.installer_sha256,
        manifest.installer_size_bytes,
    );
    verifying_key
        .verify(payload.as_bytes(), &signature)
        .map_err(|_| {
            AppError::new(
                "UPDATE_SIGNATURE_INVALID",
                "Release cryptographic signature verification failed.",
            )
        })?;

    Ok(version)
}

pub fn verify_installer_bytes(
    manifest: &ReleaseManifest,
    bytes: &[u8],
    trusted_pubkey: &[u8; 32],
    allow_loopback_http: bool,
) -> Result<SemanticVersion, AppError> {
    let version = validate_and_verify_manifest(manifest, trusted_pubkey, allow_loopback_http)?;
    let actual_size = u64::try_from(bytes.len())
        .map_err(|_| AppError::new("UPDATE_HASH_MISMATCH", "Installer byte length overflow."))?;
    if actual_size != manifest.installer_size_bytes {
        return Err(AppError::new(
            "UPDATE_HASH_MISMATCH",
            "Downloaded installer size does not match signed manifest.",
        ));
    }

    let actual_sha256 = hex::encode(Sha256::digest(bytes));
    if actual_sha256 != manifest.installer_sha256 {
        return Err(AppError::new(
            "UPDATE_HASH_MISMATCH",
            "Downloaded installer SHA-256 verification failed.",
        ));
    }

    Ok(version)
}

pub fn default_updates_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("PrivateTalk")
        .join("updates")
}

pub fn cleanup_stale_installers(updates_dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(updates_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("exe") {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub type ProgressCallback<'a> = &'a mut (dyn FnMut(u64, Option<u64>) + Send);

pub trait UpdateFeedTransport: Send + Sync {
    fn fetch_manifest<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<Vec<u8>, AppError>>;
    fn download_installer<'a>(
        &'a self,
        url: &'a str,
        on_progress: ProgressCallback<'a>,
    ) -> BoxFuture<'a, Result<Vec<u8>, AppError>>;
}

pub struct HttpUpdateFeedTransport {
    client: Client,
}

impl HttpUpdateFeedTransport {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent(concat!("PrivateTalk/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(30))
            .build()
            .expect("reqwest client");
        Self { client }
    }
}

impl Default for HttpUpdateFeedTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl UpdateFeedTransport for HttpUpdateFeedTransport {
    fn fetch_manifest<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<Vec<u8>, AppError>> {
        Box::pin(async move {
            let resp = self
                .client
                .get(url)
                .send()
                .await
                .map_err(|_| AppError::new("UPDATE_NETWORK_ERROR", "Unable to reach GitHub Releases."))?;
            if !resp.status().is_success() {
                return Err(AppError::new(
                    "UPDATE_NETWORK_ERROR",
                    "Release feed returned an unexpected HTTP status.",
                ));
            }
            let bytes = resp
                .bytes()
                .await
                .map_err(|_| AppError::new("UPDATE_NETWORK_ERROR", "Failed reading release manifest."))?;
            if bytes.len() > 256 * 1024 {
                return Err(AppError::new(
                    "UPDATE_MANIFEST_INVALID",
                    "Release manifest exceeds maximum size limit.",
                ));
            }
            Ok(bytes.to_vec())
        })
    }

    fn download_installer<'a>(
        &'a self,
        url: &'a str,
        on_progress: ProgressCallback<'a>,
    ) -> BoxFuture<'a, Result<Vec<u8>, AppError>> {
        Box::pin(async move {
            let mut resp = self
                .client
                .get(url)
                .send()
                .await
                .map_err(|_| AppError::new("UPDATE_NETWORK_ERROR", "Unable to download update package."))?;
            if !resp.status().is_success() {
                return Err(AppError::new(
                    "UPDATE_NETWORK_ERROR",
                    "Update download returned an unexpected HTTP status.",
                ));
            }

            let total_hint = resp.content_length();
            if let Some(len) = total_hint {
                if len > MAX_INSTALLER_BYTES {
                    return Err(AppError::new(
                        "UPDATE_MANIFEST_INVALID",
                        "Remote installer exceeds maximum size limit.",
                    ));
                }
            }

            let mut buf = Vec::with_capacity(
                total_hint
                    .map(|l| usize::try_from(l).unwrap_or(0))
                    .unwrap_or(0),
            );
            while let Some(chunk) = resp.chunk().await.map_err(|_| {
                AppError::new("UPDATE_NETWORK_ERROR", "Download interrupted before completion.")
            })? {
                if buf.len().saturating_add(chunk.len()) as u64 > MAX_INSTALLER_BYTES {
                    return Err(AppError::new(
                        "UPDATE_HASH_MISMATCH",
                        "Downloaded bytes exceeded maximum installer size.",
                    ));
                }
                buf.extend_from_slice(&chunk);
                on_progress(buf.len() as u64, total_hint);
            }
            Ok(buf)
        })
    }
}

pub type InstallerLauncher = Arc<dyn Fn(&Path) -> Result<(), AppError> + Send + Sync>;

pub fn default_windows_installer_launcher() -> InstallerLauncher {
    Arc::new(|installer_path: &Path| {
        #[cfg(windows)]
        {
            std::process::Command::new(installer_path)
                .spawn()
                .map_err(|_| {
                    AppError::new("UPDATE_INSTALL_FAILED", "Failed to launch update installer.")
                })?;
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = installer_path;
            Err(AppError::new(
                "UPDATE_INSTALL_FAILED",
                "In-app installer execution is supported only on Windows.",
            ))
        }
    })
}

#[derive(Clone)]
pub struct UpdaterConfig {
    pub current_version: SemanticVersion,
    pub feed_url: String,
    pub trusted_pubkey: [u8; 32],
    pub updates_dir: PathBuf,
    pub allow_loopback_http: bool,
}

impl UpdaterConfig {
    pub fn from_env() -> Self {
        let feed_url = std::env::var("PRIVATE_TALK_UPDATE_URL")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                COMPILE_TIME_UPDATE_URL
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| DEFAULT_UPDATE_FEED_URL.to_string());
        let allow_loopback_http = is_loopback_http_url(&feed_url);
        let current_version =
            SemanticVersion::parse(env!("CARGO_PKG_VERSION")).expect("valid Cargo package version");
        let trusted_pubkey = embedded_public_key_bytes().unwrap_or([0u8; 32]);
        let updates_dir = default_updates_dir();
        cleanup_stale_installers(&updates_dir);

        Self {
            current_version,
            feed_url,
            trusted_pubkey,
            updates_dir,
            allow_loopback_http,
        }
    }
}

struct InFlightGuard<'a> {
    flag: &'a AtomicBool,
}

impl Drop for InFlightGuard<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

struct UpdaterInner {
    status: UpdateStatusDto,
    available_manifest: Option<ReleaseManifest>,
}

pub struct UpdaterManager {
    config: UpdaterConfig,
    transport: Arc<dyn UpdateFeedTransport>,
    launcher: InstallerLauncher,
    in_flight: AtomicBool,
    inner: Mutex<UpdaterInner>,
}

impl UpdaterManager {
    pub fn from_env() -> Self {
        Self::new(
            UpdaterConfig::from_env(),
            Arc::new(HttpUpdateFeedTransport::new()),
            default_windows_installer_launcher(),
        )
    }

    pub fn new(
        config: UpdaterConfig,
        transport: Arc<dyn UpdateFeedTransport>,
        launcher: InstallerLauncher,
    ) -> Self {
        let initial = UpdateStatusDto::idle(&config.current_version.to_string());
        Self {
            config,
            transport,
            launcher,
            in_flight: AtomicBool::new(false),
            inner: Mutex::new(UpdaterInner {
                status: initial,
                available_manifest: None,
            }),
        }
    }

    pub fn current_status(&self) -> UpdateStatusDto {
        self.inner.lock().expect("updater mutex").status.clone()
    }

    fn acquire_in_flight(&self) -> Result<InFlightGuard<'_>, AppError> {
        if self
            .in_flight
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(AppError::new(
                "UPDATE_IN_PROGRESS",
                "An update check or installation is already running.",
            ));
        }
        Ok(InFlightGuard {
            flag: &self.in_flight,
        })
    }

    fn set_status_and_emit<F>(&self, status: UpdateStatusDto, emit: &F) -> UpdateStatusDto
    where
        F: Fn(&UpdateStatusDto) + Send + Sync,
    {
        {
            let mut inner = self.inner.lock().expect("updater mutex");
            inner.status = status.clone();
        }
        emit(&status);
        status
    }

    pub async fn check_for_updates<F>(
        &self,
        silent: bool,
        emit: F,
    ) -> Result<UpdateStatusDto, AppError>
    where
        F: Fn(&UpdateStatusDto) + Send + Sync,
    {
        let _guard = self.acquire_in_flight()?;
        let current_ver_str = self.config.current_version.to_string();

        if !self.config.feed_url.starts_with("https://")
            && !(self.config.allow_loopback_http && is_loopback_http_url(&self.config.feed_url))
        {
            self.inner.lock().expect("updater mutex").available_manifest = None;
            let failed = UpdateStatusDto {
                phase: UpdatePhase::VerificationFailed,
                current_version: current_ver_str,
                latest_version: None,
                release_notes: None,
                published_at: None,
                progress_percent: None,
                downloaded_bytes: None,
                total_bytes: None,
                error_code: Some("UPDATE_MANIFEST_INVALID".to_string()),
                error_message: Some("Update feed URL must use HTTPS.".to_string()),
            };
            return Ok(self.set_status_and_emit(failed, &emit));
        }

        let checking = UpdateStatusDto {
            phase: UpdatePhase::Checking,
            ..UpdateStatusDto::idle(&current_ver_str)
        };
        self.set_status_and_emit(checking, &emit);

        let raw_manifest = match self.transport.fetch_manifest(&self.config.feed_url).await {
            Ok(bytes) => bytes,
            Err(err) => {
                if silent && err.code == "UPDATE_NETWORK_ERROR" {
                    tracing::info!(
                        version = %current_ver_str,
                        "Silent background update check skipped due to transient network error"
                    );
                    return Ok(
                        self.set_status_and_emit(UpdateStatusDto::idle(&current_ver_str), &emit)
                    );
                }
                let phase = if err.code == "UPDATE_MANIFEST_INVALID" {
                    UpdatePhase::VerificationFailed
                } else {
                    UpdatePhase::Error
                };
                let failed = UpdateStatusDto {
                    phase,
                    current_version: current_ver_str,
                    latest_version: None,
                    release_notes: None,
                    published_at: None,
                    progress_percent: None,
                    downloaded_bytes: None,
                    total_bytes: None,
                    error_code: Some(err.code),
                    error_message: Some(err.message),
                };
                return Ok(self.set_status_and_emit(failed, &emit));
            }
        };

        let manifest: ReleaseManifest = match serde_json::from_slice(&raw_manifest) {
            Ok(m) => m,
            Err(_) => {
                self.inner.lock().expect("updater mutex").available_manifest = None;
                let failed = UpdateStatusDto {
                    phase: UpdatePhase::VerificationFailed,
                    current_version: current_ver_str,
                    latest_version: None,
                    release_notes: None,
                    published_at: None,
                    progress_percent: None,
                    downloaded_bytes: None,
                    total_bytes: None,
                    error_code: Some("UPDATE_MANIFEST_INVALID".to_string()),
                    error_message: Some("Malformed update manifest JSON.".to_string()),
                };
                return Ok(self.set_status_and_emit(failed, &emit));
            }
        };

        let remote_version = match validate_and_verify_manifest(
            &manifest,
            &self.config.trusted_pubkey,
            self.config.allow_loopback_http,
        ) {
            Ok(v) => v,
            Err(err) => {
                tracing::warn!(
                    code = %err.code,
                    current_version = %current_ver_str,
                    "Update manifest rejected fail-closed"
                );
                self.inner.lock().expect("updater mutex").available_manifest = None;
                let failed = UpdateStatusDto {
                    phase: UpdatePhase::VerificationFailed,
                    current_version: current_ver_str,
                    latest_version: None,
                    release_notes: None,
                    published_at: None,
                    progress_percent: None,
                    downloaded_bytes: None,
                    total_bytes: None,
                    error_code: Some(err.code),
                    error_message: Some(err.message),
                };
                return Ok(self.set_status_and_emit(failed, &emit));
            }
        };

        if remote_version <= self.config.current_version {
            self.inner.lock().expect("updater mutex").available_manifest = None;
            let up_to_date = UpdateStatusDto {
                phase: UpdatePhase::UpToDate,
                current_version: current_ver_str,
                latest_version: Some(remote_version.to_string()),
                release_notes: None,
                published_at: Some(manifest.published_at),
                progress_percent: None,
                downloaded_bytes: None,
                total_bytes: None,
                error_code: None,
                error_message: None,
            };
            return Ok(self.set_status_and_emit(up_to_date, &emit));
        }

        let notes_summary = manifest.notes.trim().to_string();
        let published_at = manifest.published_at;
        let total_bytes = manifest.installer_size_bytes;
        self.inner.lock().expect("updater mutex").available_manifest = Some(manifest);

        tracing::info!(
            current_version = %current_ver_str,
            latest_version = %remote_version,
            "Verified update available"
        );

        let available = UpdateStatusDto {
            phase: UpdatePhase::Available,
            current_version: current_ver_str,
            latest_version: Some(remote_version.to_string()),
            release_notes: Some(notes_summary),
            published_at: Some(published_at),
            progress_percent: None,
            downloaded_bytes: None,
            total_bytes: Some(total_bytes),
            error_code: None,
            error_message: None,
        };
        Ok(self.set_status_and_emit(available, &emit))
    }

    pub async fn install_update<F>(&self, emit: F) -> Result<(UpdateStatusDto, bool), AppError>
    where
        F: Fn(&UpdateStatusDto) + Send + Sync,
    {
        let _guard = self.acquire_in_flight()?;
        let current_ver_str = self.config.current_version.to_string();

        let manifest = {
            let inner = self.inner.lock().expect("updater mutex");
            inner.available_manifest.clone()
        }
        .ok_or_else(|| {
            AppError::new(
                "UPDATE_NOT_AVAILABLE",
                "No verified update is currently available.",
            )
        })?;

        let remote_version = match validate_and_verify_manifest(
            &manifest,
            &self.config.trusted_pubkey,
            self.config.allow_loopback_http,
        ) {
            Ok(v) if v > self.config.current_version => v,
            Ok(_) => {
                return Err(AppError::new(
                    "UPDATE_NOT_AVAILABLE",
                    "Remote version is not newer than the running version.",
                ));
            }
            Err(err) => {
                let failed = UpdateStatusDto {
                    phase: UpdatePhase::VerificationFailed,
                    current_version: current_ver_str,
                    latest_version: None,
                    release_notes: None,
                    published_at: None,
                    progress_percent: None,
                    downloaded_bytes: None,
                    total_bytes: None,
                    error_code: Some(err.code),
                    error_message: Some(err.message),
                };
                return Ok((self.set_status_and_emit(failed, &emit), false));
            }
        };

        let expected_size = manifest.installer_size_bytes;
        let downloading_start = UpdateStatusDto {
            phase: UpdatePhase::Downloading,
            current_version: current_ver_str.clone(),
            latest_version: Some(remote_version.to_string()),
            release_notes: Some(manifest.notes.trim().to_string()),
            published_at: Some(manifest.published_at),
            progress_percent: Some(0),
            downloaded_bytes: Some(0),
            total_bytes: Some(expected_size),
            error_code: None,
            error_message: None,
        };
        self.set_status_and_emit(downloading_start.clone(), &emit);

        let mut last_emit = Instant::now();
        let mut last_pct: u8 = 0;
        let mut progress_cb = |downloaded: u64, _hint: Option<u64>| {
            let pct = ((downloaded.saturating_mul(100)) / expected_size.max(1)).min(100) as u8;
            if pct != last_pct && (pct == 100 || last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL) {
                last_emit = Instant::now();
                last_pct = pct;
                let tick = UpdateStatusDto {
                    progress_percent: Some(pct),
                    downloaded_bytes: Some(downloaded),
                    ..downloading_start.clone()
                };
                self.set_status_and_emit(tick, &emit);
            }
        };

        let installer_bytes = match self
            .transport
            .download_installer(&manifest.installer_url, &mut progress_cb)
            .await
        {
            Ok(bytes) => bytes,
            Err(err) => {
                let phase = if err.code == "UPDATE_HASH_MISMATCH"
                    || err.code == "UPDATE_MANIFEST_INVALID"
                {
                    UpdatePhase::VerificationFailed
                } else {
                    UpdatePhase::Error
                };
                let failed = UpdateStatusDto {
                    phase,
                    current_version: current_ver_str,
                    latest_version: Some(remote_version.to_string()),
                    release_notes: Some(manifest.notes.trim().to_string()),
                    published_at: Some(manifest.published_at),
                    progress_percent: None,
                    downloaded_bytes: None,
                    total_bytes: Some(expected_size),
                    error_code: Some(err.code),
                    error_message: Some(err.message),
                };
                return Ok((self.set_status_and_emit(failed, &emit), false));
            }
        };

        // Fail-closed: verify size, SHA-256, and Ed25519 signature strictly in RAM before touching disk.
        if let Err(err) = verify_installer_bytes(
            &manifest,
            &installer_bytes,
            &self.config.trusted_pubkey,
            self.config.allow_loopback_http,
        ) {
            tracing::warn!(
                code = %err.code,
                target_version = %remote_version,
                "Downloaded update failed in-memory verification"
            );
            drop(installer_bytes);
            let target_path = self.config.updates_dir.join(&manifest.installer_file_name);
            let _ = std::fs::remove_file(target_path);
            let failed = UpdateStatusDto {
                phase: UpdatePhase::VerificationFailed,
                current_version: current_ver_str,
                latest_version: Some(remote_version.to_string()),
                release_notes: Some(manifest.notes.trim().to_string()),
                published_at: Some(manifest.published_at),
                progress_percent: None,
                downloaded_bytes: None,
                total_bytes: Some(expected_size),
                error_code: Some(err.code),
                error_message: Some(err.message),
            };
            return Ok((self.set_status_and_emit(failed, &emit), false));
        }

        if let Err(_) = std::fs::create_dir_all(&self.config.updates_dir) {
            let failed = UpdateStatusDto {
                phase: UpdatePhase::Error,
                current_version: current_ver_str,
                latest_version: Some(remote_version.to_string()),
                release_notes: Some(manifest.notes.trim().to_string()),
                published_at: Some(manifest.published_at),
                progress_percent: None,
                downloaded_bytes: None,
                total_bytes: Some(expected_size),
                error_code: Some("UPDATE_INSTALL_FAILED".to_string()),
                error_message: Some("Failed to prepare local updates staging directory.".to_string()),
            };
            return Ok((self.set_status_and_emit(failed, &emit), false));
        }

        let staged_path = self.config.updates_dir.join(&manifest.installer_file_name);
        if std::fs::write(&staged_path, &installer_bytes).is_err() {
            let _ = std::fs::remove_file(&staged_path);
            let failed = UpdateStatusDto {
                phase: UpdatePhase::Error,
                current_version: current_ver_str,
                latest_version: Some(remote_version.to_string()),
                release_notes: Some(manifest.notes.trim().to_string()),
                published_at: Some(manifest.published_at),
                progress_percent: None,
                downloaded_bytes: None,
                total_bytes: Some(expected_size),
                error_code: Some("UPDATE_INSTALL_FAILED".to_string()),
                error_message: Some("Failed to write verified installer to staging directory.".to_string()),
            };
            return Ok((self.set_status_and_emit(failed, &emit), false));
        }

        let installing = UpdateStatusDto {
            phase: UpdatePhase::Installing,
            current_version: current_ver_str.clone(),
            latest_version: Some(remote_version.to_string()),
            release_notes: Some(manifest.notes.trim().to_string()),
            published_at: Some(manifest.published_at),
            progress_percent: Some(100),
            downloaded_bytes: Some(expected_size),
            total_bytes: Some(expected_size),
            error_code: None,
            error_message: None,
        };
        self.set_status_and_emit(installing.clone(), &emit);

        tracing::info!(
            target_version = %remote_version,
            bytes = expected_size,
            "Launching verified update installer"
        );

        if let Err(err) = (self.launcher)(&staged_path) {
            let failed = UpdateStatusDto {
                phase: UpdatePhase::Error,
                current_version: current_ver_str,
                latest_version: Some(remote_version.to_string()),
                release_notes: Some(manifest.notes.trim().to_string()),
                published_at: Some(manifest.published_at),
                progress_percent: None,
                downloaded_bytes: None,
                total_bytes: Some(expected_size),
                error_code: Some(err.code),
                error_message: Some(err.message),
            };
            return Ok((self.set_status_and_emit(failed, &emit), false));
        }

        Ok((installing, true))
    }
}
