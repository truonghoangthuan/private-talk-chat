use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::PlatformError;

#[derive(Clone, Serialize, Deserialize)]
pub struct DpapiProtectedSession {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_path: Option<String>,
    pub supabase_access_token: String,
    pub supabase_refresh_token: String,
    pub x25519_private_key: [u8; 32],
    pub ed25519_private_key: [u8; 32],
    pub cached_epoch_keys: HashMap<String, [u8; 32]>,
}

impl Drop for DpapiProtectedSession {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.supabase_access_token.zeroize();
        self.supabase_refresh_token.zeroize();
        self.x25519_private_key.zeroize();
        self.ed25519_private_key.zeroize();
        for key in self.cached_epoch_keys.values_mut() {
            key.zeroize();
        }
        self.cached_epoch_keys.clear();
    }
}

pub fn epoch_cache_key(conversation_id: Uuid, epoch: i32) -> String {
    format!("{conversation_id}:{epoch}")
}

/// Resolves `%LOCALAPPDATA%\PrivateTalk\<profile_or_default>\session.dpapi`.
pub fn default_session_path(profile_override: Option<&str>) -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("PrivateTalk");

    let env_profile = std::env::var("PRIVATE_TALK_PROFILE").ok();
    let profile = profile_override
        .or(env_profile.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    match profile {
        Some(p) => {
            let safe: String = p
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            base.join(if safe.is_empty() { "default" } else { &safe })
                .join("session.dpapi")
        }
        None => base.join("session.dpapi"),
    }
}

#[cfg(windows)]
pub fn dpapi_protect(plaintext: &[u8]) -> Result<Vec<u8>, PlatformError> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(plaintext.len()).map_err(|_| PlatformError::DpapiProtectFailed)?,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| PlatformError::DpapiProtectFailed)?;

        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let result = slice.to_vec();
        LocalFree(HLOCAL(output.pbData as *mut core::ffi::c_void));
        Ok(result)
    }
}

#[cfg(windows)]
pub fn dpapi_unprotect(ciphertext: &[u8]) -> Result<Zeroizing<Vec<u8>>, PlatformError> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(ciphertext.len()).map_err(|_| PlatformError::DpapiUnprotectFailed)?,
        pbData: ciphertext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| PlatformError::DpapiUnprotectFailed)?;

        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let mut result = Zeroizing::new(slice.to_vec());
        // Zero Windows-allocated plaintext buffer before freeing.
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(HLOCAL(output.pbData as *mut core::ffi::c_void));
        let _ = &mut result;
        Ok(result)
    }
}

#[cfg(not(windows))]
pub fn dpapi_protect(_plaintext: &[u8]) -> Result<Vec<u8>, PlatformError> {
    Err(PlatformError::DpapiProtectFailed)
}

#[cfg(not(windows))]
pub fn dpapi_unprotect(_ciphertext: &[u8]) -> Result<Zeroizing<Vec<u8>>, PlatformError> {
    Err(PlatformError::DpapiUnprotectFailed)
}

pub fn save_session_to_path(
    path: &Path,
    session: &DpapiProtectedSession,
) -> Result<(), PlatformError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| PlatformError::IoError)?;
    }
    let json = Zeroizing::new(serde_json::to_vec(session).map_err(|_| PlatformError::IoError)?);
    let protected = dpapi_protect(&json)?;
    fs::write(path, protected).map_err(|_| PlatformError::IoError)
}

pub fn load_session_from_path(
    path: &Path,
) -> Result<Option<DpapiProtectedSession>, PlatformError> {
    if !path.exists() {
        return Ok(None);
    }
    let encrypted = fs::read(path).map_err(|_| PlatformError::IoError)?;
    if encrypted.is_empty() {
        return Err(PlatformError::DpapiUnprotectFailed);
    }
    let plain = dpapi_unprotect(&encrypted)?;
    let session = serde_json::from_slice::<DpapiProtectedSession>(&plain)
        .map_err(|_| PlatformError::DpapiUnprotectFailed)?;
    Ok(Some(session))
}

pub fn delete_session_at_path(path: &Path) -> Result<(), PlatformError> {
    if path.exists() {
        fs::remove_file(path).map_err(|_| PlatformError::IoError)?;
    }
    Ok(())
}
