pub mod auth;
pub mod postgrest;
pub mod realtime;
pub mod storage;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// Secret-redacting error type: Display/Debug never output access tokens, passwords, or keys.
#[derive(Debug, Error)]
pub enum SupabaseError {
    #[error("network request failed")]
    NetworkError,
    #[error("authentication rejected: {0}")]
    AuthRejected(&'static str),
    #[error("not found: {0}")]
    NotFound(&'static str),
    #[error("conflict: {0}")]
    Conflict(&'static str),
    #[error("forbidden: {0}")]
    Forbidden(&'static str),
    #[error("invalid response from backend")]
    InvalidResponse,
}

#[derive(Debug, Clone)]
pub struct SupabaseConfig {
    pub url: String,
    pub anon_key: String,
}

impl SupabaseConfig {
    pub fn from_env() -> Option<Self> {
        let url = std::env::var("PRIVATE_TALK_SUPABASE_URL")
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty());
        let anon_key = std::env::var("PRIVATE_TALK_SUPABASE_ANON_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s != "your-anon-key-here");

        match (url, anon_key) {
            (Some(u), Some(k)) => Some(Self { url: u, anon_key: k }),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileRow {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_path: Option<String>,
    pub public_enc_key: Vec<u8>,
    pub public_sign_key: Vec<u8>,
    pub wrapped_priv_keys: Vec<u8>,
    pub kdf_salt: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationRow {
    pub id: Uuid,
    pub is_group: bool,
    pub name: Option<String>,
    pub direct_pair_key: Option<String>,
    pub host_id: Option<Uuid>,
    pub current_epoch: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMemberRow {
    pub conversation_id: Uuid,
    pub user_id: Uuid,
    pub joined_at: DateTime<Utc>,
    pub added_by: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMemberKeyRow {
    pub conversation_id: Uuid,
    pub epoch: i32,
    pub recipient_id: Uuid,
    pub distributor_id: Uuid,
    pub ephemeral_pub_key: Vec<u8>,
    pub nonce: Vec<u8>,
    pub wrapped_key: Vec<u8>,
    pub signature: Vec<u8>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageRow {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub sender_id: Uuid,
    pub epoch: i32,
    pub nonce: Option<Vec<u8>>,
    pub ciphertext: Option<Vec<u8>>,
    pub signature: Option<Vec<u8>>,
    pub media_object_path: Option<String>,
    pub is_edited: bool,
    pub edited_at: Option<DateTime<Utc>>,
    pub is_removed: bool,
    pub removed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageReadRow {
    pub conversation_id: Uuid,
    pub message_id: Uuid,
    pub user_id: Uuid,
    pub seen_at: DateTime<Utc>,
}

/// In-memory store backing local/offline mode and integration tests when no live Supabase URL is configured.
#[derive(Default)]
pub struct LocalLoopbackStore {
    pub auth_passwords: HashMap<String, (Uuid, String)>,
    pub profiles: HashMap<Uuid, ProfileRow>,
    pub contacts: HashMap<Uuid, Vec<Uuid>>,
    pub conversations: HashMap<Uuid, ConversationRow>,
    pub members: Vec<ConversationMemberRow>,
    pub member_keys: Vec<ConversationMemberKeyRow>,
    pub messages: Vec<MessageRow>,
    pub reads: Vec<MessageReadRow>,
    pub avatars: HashMap<String, Vec<u8>>,
    pub chat_media: HashMap<String, Vec<u8>>,
}

#[derive(Clone)]
pub struct SupabaseClient {
    pub config: Option<SupabaseConfig>,
    pub http: reqwest::Client,
    pub local_store: Arc<Mutex<LocalLoopbackStore>>,
}

impl SupabaseClient {
    pub fn new(config: Option<SupabaseConfig>) -> Self {
        Self {
            config,
            http: reqwest::Client::new(),
            local_store: Arc::new(Mutex::new(LocalLoopbackStore::default())),
        }
    }

    pub fn new_local() -> Self {
        Self::new(None)
    }

    pub fn is_remote(&self) -> bool {
        self.config.is_some()
    }
}
