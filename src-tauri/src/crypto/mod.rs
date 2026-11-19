pub mod aead;
pub mod kdf;
pub mod keys;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("invalid key length")]
    InvalidKeyLength,
    #[error("key derivation failed")]
    KeyDerivationFailed,
    #[error("encryption failed")]
    EncryptionFailed,
    #[error("verification failed")]
    VerificationFailed,
    #[error("serialization error")]
    SerializationError,
}
