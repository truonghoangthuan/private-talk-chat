use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::CryptoError;

const AUTH_SALT_PREFIX: &[u8] = b"privatetalk-auth-v1:";
const AUTH_INFO: &[u8] = b"supabase-auth";
const KEY_WRAP_INFO: &[u8] = b"key-wrapping";

pub const ARGON2_MEMORY_KIB: u32 = 65_536; // 64 MiB
pub const ARGON2_ITERATIONS: u32 = 3;
pub const ARGON2_PARALLELISM: u32 = 4;
pub const KDF_SALT_LEN: usize = 16;

/// Derives the deterministic 256-bit hex credential sent to Supabase Auth pre-login.
/// Uses SHA-256("privatetalk-auth-v1:" || lower(username))[0..16] as the HKDF salt so
/// Supabase Auth never sees the raw user password or the post-auth wrapping key.
pub fn derive_supabase_auth_password(username: &str, password: &str) -> Result<String, CryptoError> {
    let normalized = username.trim().to_ascii_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(AUTH_SALT_PREFIX);
    hasher.update(normalized.as_bytes());
    let digest = hasher.finalize();

    let hk = Hkdf::<Sha256>::new(Some(&digest[..16]), password.as_bytes());
    let mut auth_bytes = Zeroizing::new([0u8; 32]);
    hk.expand(AUTH_INFO, &mut *auth_bytes)
        .map_err(|_| CryptoError::KeyDerivationFailed)?;

    Ok(hex::encode(&*auth_bytes))
}

/// Derives the 256-bit key wrapping key locally after authentication using
/// Argon2id (m=64 MiB, t=3, p=4) + HKDF-SHA256.
pub fn derive_key_wrapping_key(
    password: &str,
    kdf_salt: &[u8],
) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    if kdf_salt.len() != KDF_SALT_LEN {
        return Err(CryptoError::InvalidKeyLength);
    }

    let params = Params::new(
        ARGON2_MEMORY_KIB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
        Some(32),
    )
    .map_err(|_| CryptoError::KeyDerivationFailed)?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut master = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(password.as_bytes(), kdf_salt, &mut *master)
        .map_err(|_| CryptoError::KeyDerivationFailed)?;

    let hk = Hkdf::<Sha256>::new(Some(kdf_salt), &*master);
    let mut wrapping_key = Zeroizing::new([0u8; 32]);
    hk.expand(KEY_WRAP_INFO, &mut *wrapping_key)
        .map_err(|_| CryptoError::KeyDerivationFailed)?;

    Ok(wrapping_key)
}
