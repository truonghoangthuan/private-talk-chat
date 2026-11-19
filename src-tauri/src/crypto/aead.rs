use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Nonce,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::CryptoError;

const MSG_AEAD_INFO: &[u8] = b"privatetalk-msg-aead-v1";
const MEDIA_AEAD_INFO: &[u8] = b"privatetalk-media-aead-v1";
const MSG_SIG_PREFIX: &[u8] = b"privatetalk-msg-sig-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecryptionStatus {
    Verified,
    VerificationFailed,
    Removed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttachmentMetadata {
    pub mime_type: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub media_nonce: String,
    pub media_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EncryptedMessageEnvelope {
    pub text: Option<String>,
    pub attachment: Option<AttachmentMetadata>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to_message_id: Option<Uuid>,
}

#[derive(Debug, Clone)]
pub struct EncryptedMessagePayload {
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
    pub signature: [u8; 64],
}

#[derive(Debug, Clone)]
pub struct EncryptedMediaPayload {
    pub media_nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
    pub media_sha256: [u8; 32],
}

fn derive_subkey(epoch_key: &[u8; 32], message_id: Uuid, info: &[u8]) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let hk = Hkdf::<Sha256>::new(Some(message_id.as_bytes()), epoch_key);
    let mut key = Zeroizing::new([0u8; 32]);
    hk.expand(info, &mut *key)
        .map_err(|_| CryptoError::KeyDerivationFailed)?;
    Ok(key)
}

fn message_aad(conversation_id: Uuid, message_id: Uuid, epoch: i32) -> Vec<u8> {
    let mut aad = Vec::with_capacity(36);
    aad.extend_from_slice(conversation_id.as_bytes());
    aad.extend_from_slice(message_id.as_bytes());
    aad.extend_from_slice(&epoch.to_be_bytes());
    aad
}

fn message_signature_bytes(
    conversation_id: Uuid,
    message_id: Uuid,
    epoch: i32,
    nonce: &[u8; 12],
    ciphertext: &[u8],
) -> Vec<u8> {
    let ct_hash = Sha256::digest(ciphertext);
    let mut buf = Vec::with_capacity(MSG_SIG_PREFIX.len() + 16 + 16 + 4 + 12 + 32);
    buf.extend_from_slice(MSG_SIG_PREFIX);
    buf.extend_from_slice(conversation_id.as_bytes());
    buf.extend_from_slice(message_id.as_bytes());
    buf.extend_from_slice(&epoch.to_be_bytes());
    buf.extend_from_slice(nonce);
    buf.extend_from_slice(&ct_hash);
    buf
}

pub fn encrypt_and_sign_message(
    conversation_id: Uuid,
    message_id: Uuid,
    epoch: i32,
    epoch_key: &[u8; 32],
    sender_ed25519_priv: &[u8; 32],
    envelope: &EncryptedMessageEnvelope,
) -> Result<EncryptedMessagePayload, CryptoError> {
    let json_bytes = Zeroizing::new(
        serde_json::to_vec(envelope).map_err(|_| CryptoError::SerializationError)?,
    );

    let msg_key = derive_subkey(epoch_key, message_id, MSG_AEAD_INFO)?;
    let cipher = ChaCha20Poly1305::new_from_slice(&*msg_key)
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);

    let aad = message_aad(conversation_id, message_id, epoch);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &*json_bytes,
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::EncryptionFailed)?;

    let sig_input = message_signature_bytes(conversation_id, message_id, epoch, &nonce, &ciphertext);
    let signing_key = SigningKey::from_bytes(sender_ed25519_priv);
    let signature = signing_key.sign(&sig_input);

    Ok(EncryptedMessagePayload {
        nonce,
        ciphertext,
        signature: signature.to_bytes(),
    })
}

/// Fail-closed verification and decryption: checks Ed25519 signature BEFORE AEAD decrypt.
pub fn verify_and_decrypt_message(
    conversation_id: Uuid,
    message_id: Uuid,
    epoch: i32,
    epoch_key: &[u8; 32],
    sender_ed25519_pub: &[u8; 32],
    nonce: &[u8],
    ciphertext: &[u8],
    signature: &[u8],
) -> Result<EncryptedMessageEnvelope, DecryptionStatus> {
    if nonce.len() != 12 || signature.len() != 64 {
        return Err(DecryptionStatus::VerificationFailed);
    }

    let Ok(verifying_key) = VerifyingKey::from_bytes(sender_ed25519_pub) else {
        return Err(DecryptionStatus::VerificationFailed);
    };

    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(signature);
    let sig = Signature::from_bytes(&sig_arr);

    let mut nonce_arr = [0u8; 12];
    nonce_arr.copy_from_slice(nonce);

    let sig_input = message_signature_bytes(conversation_id, message_id, epoch, &nonce_arr, ciphertext);
    if verifying_key.verify(&sig_input, &sig).is_err() {
        return Err(DecryptionStatus::VerificationFailed);
    }

    let Ok(msg_key) = derive_subkey(epoch_key, message_id, MSG_AEAD_INFO) else {
        return Err(DecryptionStatus::VerificationFailed);
    };
    let Ok(cipher) = ChaCha20Poly1305::new_from_slice(&*msg_key) else {
        return Err(DecryptionStatus::VerificationFailed);
    };

    let aad = message_aad(conversation_id, message_id, epoch);
    let Ok(plain) = cipher
        .decrypt(
            Nonce::from_slice(&nonce_arr),
            Payload {
                msg: ciphertext,
                aad: &aad,
            },
        )
        .map(Zeroizing::new)
    else {
        return Err(DecryptionStatus::VerificationFailed);
    };

    serde_json::from_slice::<EncryptedMessageEnvelope>(&plain)
        .map_err(|_| DecryptionStatus::VerificationFailed)
}

pub fn encrypt_media_attachment(
    conversation_id: Uuid,
    message_id: Uuid,
    epoch: i32,
    epoch_key: &[u8; 32],
    plaintext_bytes: &[u8],
) -> Result<EncryptedMediaPayload, CryptoError> {
    let media_key = derive_subkey(epoch_key, message_id, MEDIA_AEAD_INFO)?;
    let cipher = ChaCha20Poly1305::new_from_slice(&*media_key)
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let mut media_nonce = [0u8; 12];
    OsRng.fill_bytes(&mut media_nonce);

    let aad = message_aad(conversation_id, message_id, epoch);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&media_nonce),
            Payload {
                msg: plaintext_bytes,
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::EncryptionFailed)?;

    let digest = Sha256::digest(&ciphertext);
    let mut media_sha256 = [0u8; 32];
    media_sha256.copy_from_slice(&digest);

    Ok(EncryptedMediaPayload {
        media_nonce,
        ciphertext,
        media_sha256,
    })
}

pub fn decrypt_media_attachment(
    conversation_id: Uuid,
    message_id: Uuid,
    epoch: i32,
    epoch_key: &[u8; 32],
    attachment_meta: &AttachmentMetadata,
    encrypted_bytes: &[u8],
) -> Result<Zeroizing<Vec<u8>>, DecryptionStatus> {
    let Ok(expected_sha) = B64.decode(&attachment_meta.media_sha256) else {
        return Err(DecryptionStatus::VerificationFailed);
    };
    let actual_sha = Sha256::digest(encrypted_bytes);
    if expected_sha.len() != 32 || actual_sha.as_slice() != expected_sha.as_slice() {
        return Err(DecryptionStatus::VerificationFailed);
    }

    let Ok(nonce_bytes) = B64.decode(&attachment_meta.media_nonce) else {
        return Err(DecryptionStatus::VerificationFailed);
    };
    if nonce_bytes.len() != 12 {
        return Err(DecryptionStatus::VerificationFailed);
    }

    let Ok(media_key) = derive_subkey(epoch_key, message_id, MEDIA_AEAD_INFO) else {
        return Err(DecryptionStatus::VerificationFailed);
    };
    let Ok(cipher) = ChaCha20Poly1305::new_from_slice(&*media_key) else {
        return Err(DecryptionStatus::VerificationFailed);
    };

    let aad = message_aad(conversation_id, message_id, epoch);
    cipher
        .decrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: encrypted_bytes,
                aad: &aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| DecryptionStatus::VerificationFailed)
}
