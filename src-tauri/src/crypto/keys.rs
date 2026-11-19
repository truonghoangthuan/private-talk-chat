use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Nonce,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use uuid::Uuid;
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret as X25519StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::CryptoError;

const EPOCH_WRAP_INFO: &[u8] = b"privatetalk-epoch-wrap-v1";
const EPOCH_SIG_PREFIX: &[u8] = b"privatetalk-epoch-key-v1";
const KEY_BUNDLE_AAD: &[u8] = b"privatetalk-priv-keys-v1";

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct IdentityKeyPair {
    pub x25519_private: [u8; 32],
    #[zeroize(skip)]
    pub x25519_public: [u8; 32],
    pub ed25519_private: [u8; 32],
    #[zeroize(skip)]
    pub ed25519_public: [u8; 32],
}

impl IdentityKeyPair {
    pub fn generate() -> Self {
        let x_secret = X25519StaticSecret::random_from_rng(OsRng);
        let x_public = X25519PublicKey::from(&x_secret);

        let mut ed_bytes = Zeroizing::new([0u8; 32]);
        OsRng.fill_bytes(&mut *ed_bytes);
        let ed_signing = SigningKey::from_bytes(&ed_bytes);
        let ed_verifying = ed_signing.verifying_key();

        Self {
            x25519_private: x_secret.to_bytes(),
            x25519_public: x_public.to_bytes(),
            ed25519_private: ed_signing.to_bytes(),
            ed25519_public: ed_verifying.to_bytes(),
        }
    }

    pub fn from_private_bytes(
        x25519_private: [u8; 32],
        ed25519_private: [u8; 32],
    ) -> Self {
        let x_secret = X25519StaticSecret::from(x25519_private);
        let x_public = X25519PublicKey::from(&x_secret);
        let ed_signing = SigningKey::from_bytes(&ed25519_private);
        let ed_verifying = ed_signing.verifying_key();

        Self {
            x25519_private,
            x25519_public: x_public.to_bytes(),
            ed25519_private,
            ed25519_public: ed_verifying.to_bytes(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct WrappedEpochKeyBundle {
    pub ephemeral_pub_key: [u8; 32],
    pub nonce: [u8; 12],
    pub wrapped_key: [u8; 48],
    pub signature: [u8; 64],
}

/// Generates a random 16-byte KDF salt matching `CHECK (octet_length(kdf_salt) = 16)`.
pub fn generate_kdf_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Generates a fresh 256-bit ConversationEpochKey.
pub fn generate_epoch_key() -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(&mut *key);
    key
}

/// Wraps `(x25519_private || ed25519_private)` with `key_wrapping_key` via ChaCha20-Poly1305.
/// Output format: `12-byte nonce || 80-byte ciphertext+tag` (92 bytes total).
pub fn wrap_private_key_bundle(
    keys: &IdentityKeyPair,
    wrapping_key: &[u8; 32],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = ChaCha20Poly1305::new_from_slice(wrapping_key)
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);

    let mut plain = Zeroizing::new([0u8; 64]);
    plain[..32].copy_from_slice(&keys.x25519_private);
    plain[32..].copy_from_slice(&keys.ed25519_private);

    let ct = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: &*plain,
                aad: KEY_BUNDLE_AAD,
            },
        )
        .map_err(|_| CryptoError::EncryptionFailed)?;

    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Unwraps `profiles.wrapped_priv_keys` and verifies AEAD tag integrity (fail-closed).
pub fn unwrap_private_key_bundle(
    wrapped: &[u8],
    wrapping_key: &[u8; 32],
) -> Result<IdentityKeyPair, CryptoError> {
    if wrapped.len() != 12 + 64 + 16 {
        return Err(CryptoError::VerificationFailed);
    }

    let cipher = ChaCha20Poly1305::new_from_slice(wrapping_key)
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let nonce = Nonce::from_slice(&wrapped[..12]);
    let plain = Zeroizing::new(
        cipher
            .decrypt(
                nonce,
                Payload {
                    msg: &wrapped[12..],
                    aad: KEY_BUNDLE_AAD,
                },
            )
            .map_err(|_| CryptoError::VerificationFailed)?,
    );

    if plain.len() != 64 {
        return Err(CryptoError::VerificationFailed);
    }

    let mut x_priv = [0u8; 32];
    let mut ed_priv = [0u8; 32];
    x_priv.copy_from_slice(&plain[..32]);
    ed_priv.copy_from_slice(&plain[32..]);

    Ok(IdentityKeyPair::from_private_bytes(x_priv, ed_priv))
}

fn epoch_key_aad(conversation_id: Uuid, epoch: i32, recipient_id: Uuid) -> Vec<u8> {
    let mut aad = Vec::with_capacity(36);
    aad.extend_from_slice(conversation_id.as_bytes());
    aad.extend_from_slice(&epoch.to_be_bytes());
    aad.extend_from_slice(recipient_id.as_bytes());
    aad
}

fn epoch_signature_payload(
    conversation_id: Uuid,
    epoch: i32,
    recipient_id: Uuid,
    distributor_id: Uuid,
    ephemeral_pub_key: &[u8; 32],
    nonce: &[u8; 12],
    wrapped_key: &[u8; 48],
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(EPOCH_SIG_PREFIX.len() + 16 + 4 + 16 + 16 + 32 + 12 + 48);
    buf.extend_from_slice(EPOCH_SIG_PREFIX);
    buf.extend_from_slice(conversation_id.as_bytes());
    buf.extend_from_slice(&epoch.to_be_bytes());
    buf.extend_from_slice(recipient_id.as_bytes());
    buf.extend_from_slice(distributor_id.as_bytes());
    buf.extend_from_slice(ephemeral_pub_key);
    buf.extend_from_slice(nonce);
    buf.extend_from_slice(wrapped_key);
    buf
}

/// Wraps a 32-byte `ConversationEpochKey` for a recipient using ephemeral-static X25519 ECDH,
/// ChaCha20-Poly1305 AEAD, and signs with the distributor's Ed25519 private key.
pub fn wrap_epoch_key_for_recipient(
    conversation_id: Uuid,
    epoch: i32,
    epoch_key: &[u8; 32],
    recipient_id: Uuid,
    recipient_x25519_pub: &[u8; 32],
    distributor_id: Uuid,
    distributor_ed25519_priv: &[u8; 32],
) -> Result<WrappedEpochKeyBundle, CryptoError> {
    let eph_secret = X25519StaticSecret::random_from_rng(OsRng);
    let eph_pub = X25519PublicKey::from(&eph_secret).to_bytes();

    let recipient_pub = X25519PublicKey::from(*recipient_x25519_pub);
    let shared_secret = eph_secret.diffie_hellman(&recipient_pub);

    let hk = Hkdf::<Sha256>::new(Some(&eph_pub), shared_secret.as_bytes());
    let mut wrap_aead_key = Zeroizing::new([0u8; 32]);
    hk.expand(EPOCH_WRAP_INFO, &mut *wrap_aead_key)
        .map_err(|_| CryptoError::KeyDerivationFailed)?;

    let cipher = ChaCha20Poly1305::new_from_slice(&*wrap_aead_key)
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);

    let aad = epoch_key_aad(conversation_id, epoch, recipient_id);
    let ct = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: epoch_key,
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::EncryptionFailed)?;

    if ct.len() != 48 {
        return Err(CryptoError::EncryptionFailed);
    }
    let mut wrapped_key = [0u8; 48];
    wrapped_key.copy_from_slice(&ct);

    let sig_payload = epoch_signature_payload(
        conversation_id,
        epoch,
        recipient_id,
        distributor_id,
        &eph_pub,
        &nonce,
        &wrapped_key,
    );
    let signing_key = SigningKey::from_bytes(distributor_ed25519_priv);
    let signature: Signature = signing_key.sign(&sig_payload);

    Ok(WrappedEpochKeyBundle {
        ephemeral_pub_key: eph_pub,
        nonce,
        wrapped_key,
        signature: signature.to_bytes(),
    })
}

/// Verifies distributor's Ed25519 signature first, then unwraps the 32-byte `ConversationEpochKey`.
pub fn unwrap_epoch_key_for_recipient(
    conversation_id: Uuid,
    epoch: i32,
    recipient_id: Uuid,
    recipient_x25519_priv: &[u8; 32],
    distributor_id: Uuid,
    distributor_ed25519_pub: &[u8; 32],
    bundle: &WrappedEpochKeyBundle,
) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let verifying_key = VerifyingKey::from_bytes(distributor_ed25519_pub)
        .map_err(|_| CryptoError::VerificationFailed)?;
    let signature = Signature::from_bytes(&bundle.signature);
    let sig_payload = epoch_signature_payload(
        conversation_id,
        epoch,
        recipient_id,
        distributor_id,
        &bundle.ephemeral_pub_key,
        &bundle.nonce,
        &bundle.wrapped_key,
    );

    verifying_key
        .verify(&sig_payload, &signature)
        .map_err(|_| CryptoError::VerificationFailed)?;

    let recipient_secret = X25519StaticSecret::from(*recipient_x25519_priv);
    let eph_pub = X25519PublicKey::from(bundle.ephemeral_pub_key);
    let shared_secret = recipient_secret.diffie_hellman(&eph_pub);

    let hk = Hkdf::<Sha256>::new(Some(&bundle.ephemeral_pub_key), shared_secret.as_bytes());
    let mut wrap_aead_key = Zeroizing::new([0u8; 32]);
    hk.expand(EPOCH_WRAP_INFO, &mut *wrap_aead_key)
        .map_err(|_| CryptoError::KeyDerivationFailed)?;

    let cipher = ChaCha20Poly1305::new_from_slice(&*wrap_aead_key)
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let aad = epoch_key_aad(conversation_id, epoch, recipient_id);
    let plain = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&bundle.nonce),
                Payload {
                    msg: &bundle.wrapped_key,
                    aad: &aad,
                },
            )
            .map_err(|_| CryptoError::VerificationFailed)?,
    );

    if plain.len() != 32 {
        return Err(CryptoError::VerificationFailed);
    }

    let mut epoch_key = Zeroizing::new([0u8; 32]);
    epoch_key.copy_from_slice(&plain);
    Ok(epoch_key)
}
