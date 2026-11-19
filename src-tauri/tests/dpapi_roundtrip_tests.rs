use std::collections::HashMap;
use std::fs;

use private_talk_lib::crypto::kdf::{
    derive_key_wrapping_key, derive_supabase_auth_password, KDF_SALT_LEN,
};
use private_talk_lib::crypto::keys::{
    generate_kdf_salt, unwrap_private_key_bundle, wrap_private_key_bundle, IdentityKeyPair,
};
use private_talk_lib::platform::dpapi::{
    delete_session_at_path, dpapi_protect, dpapi_unprotect, epoch_cache_key,
    load_session_from_path, save_session_to_path, DpapiProtectedSession,
};
use tempfile::tempdir;
use uuid::Uuid;

#[test]
fn split_credential_kdf_separates_auth_password_from_wrapping_key() {
    let pw = "correct-horse-battery-staple";
    let auth_lower = derive_supabase_auth_password("alice", pw).expect("auth pw");
    let auth_upper = derive_supabase_auth_password("ALICE", pw).expect("auth pw upper");
    assert_eq!(auth_lower, auth_upper);
    assert_eq!(auth_lower.len(), 64);
    assert_ne!(auth_lower, pw);

    let salt = generate_kdf_salt();
    assert_eq!(salt.len(), KDF_SALT_LEN);
    let wrap_key = derive_key_wrapping_key(pw, &salt).expect("wrap key");
    assert_ne!(hex::encode(&*wrap_key), auth_lower);

    // Reject wrong salt length
    assert!(derive_key_wrapping_key(pw, &[1u8; 8]).is_err());
}

#[test]
fn private_key_bundle_wrap_unwrap_and_tamper_rejection() {
    let keys = IdentityKeyPair::generate();
    let salt = generate_kdf_salt();
    let wrap_key = derive_key_wrapping_key("strong-secret-pass", &salt).expect("wrap key");

    let mut wrapped = wrap_private_key_bundle(&keys, &wrap_key).expect("wrap bundle");
    let recovered = unwrap_private_key_bundle(&wrapped, &wrap_key).expect("unwrap bundle");

    assert_eq!(recovered.x25519_public, keys.x25519_public);
    assert_eq!(recovered.ed25519_public, keys.ed25519_public);
    assert_eq!(recovered.x25519_private, keys.x25519_private);
    assert_eq!(recovered.ed25519_private, keys.ed25519_private);

    // Flip 1 bit in wrapped ciphertext -> must fail closed
    wrapped[20] ^= 0x01;
    assert!(unwrap_private_key_bundle(&wrapped, &wrap_key).is_err());

    // Wrong wrapping key -> must fail closed
    let wrong_key = derive_key_wrapping_key("wrong-pass", &salt).expect("wrong key");
    assert!(unwrap_private_key_bundle(&wrapped, &wrong_key).is_err());
}

#[cfg(windows)]
#[test]
fn windows_dpapi_session_roundtrip_and_tamper_rejection() {
    let dir = tempdir().expect("temp dir");
    let session_path = dir.path().join("alice").join("session.dpapi");

    let conv_id = Uuid::new_v4();
    let mut cached = HashMap::new();
    cached.insert(epoch_cache_key(conv_id, 1), [0xAAu8; 32]);

    let original = DpapiProtectedSession {
        user_id: Uuid::new_v4(),
        username: "alice".to_string(),
        display_name: "Alice Vance".to_string(),
        avatar_path: Some("avatars/alice.png".to_string()),
        supabase_access_token: "jwt-access-token".to_string(),
        supabase_refresh_token: "jwt-refresh-token".to_string(),
        x25519_private_key: [0x11u8; 32],
        ed25519_private_key: [0x22u8; 32],
        cached_epoch_keys: cached,
    };

    save_session_to_path(&session_path, &original).expect("dpapi save");
    let raw_disk = fs::read(&session_path).expect("read dpapi file");
    assert!(!String::from_utf8_lossy(&raw_disk).contains("jwt-access-token"));

    let restored = load_session_from_path(&session_path)
        .expect("dpapi load")
        .expect("session present");
    assert_eq!(restored.user_id, original.user_id);
    assert_eq!(restored.username, "alice");
    assert_eq!(restored.x25519_private_key, original.x25519_private_key);
    assert_eq!(restored.ed25519_private_key, original.ed25519_private_key);
    assert_eq!(
        restored.cached_epoch_keys.get(&epoch_cache_key(conv_id, 1)),
        Some(&[0xAAu8; 32])
    );

    // Corrupt DPAPI file -> must fail closed
    let mut corrupted = raw_disk.clone();
    let last_idx = corrupted.len() - 1;
    corrupted[last_idx] ^= 0xFF;
    fs::write(&session_path, corrupted).expect("write corrupt");
    assert!(load_session_from_path(&session_path).is_err());

    // Direct CryptProtectData / CryptUnprotectData sanity check
    let protected = dpapi_protect(b"sensitive-key-material").expect("protect");
    let unprotected = dpapi_unprotect(&protected).expect("unprotect");
    assert_eq!(&*unprotected, b"sensitive-key-material");

    delete_session_at_path(&session_path).expect("delete session");
    assert!(load_session_from_path(&session_path).expect("missing").is_none());
}
