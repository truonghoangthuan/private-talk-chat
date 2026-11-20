pub mod auth;
pub mod contacts;
pub mod conversations;
pub mod messages;
pub mod updater;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use uuid::Uuid;

use crate::crypto::aead::DecryptionStatus;
use crate::platform::dpapi::{
    default_session_path, delete_session_at_path, save_session_to_path, DpapiProtectedSession,
};
use crate::platform::notifications::{activate_conversation_window, dispatch_message_notification};
use crate::platform::taskbar::update_taskbar_unread_badge;
use crate::state::media_cache::DecryptedMediaCache;
use crate::supabase::auth::jwt_is_expiring;
use crate::supabase::realtime::RealtimeManager;
use crate::supabase::{ProfileRow, SupabaseClient, SupabaseConfig, SupabaseError};
use crate::updater::UpdaterManager;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<SupabaseError> for AppError {
    fn from(err: SupabaseError) -> Self {
        let code = match &err {
            SupabaseError::NetworkError => "NETWORK_ERROR",
            SupabaseError::AuthRejected(_) => "AUTH_REJECTED",
            SupabaseError::NotFound(_) => "NOT_FOUND",
            SupabaseError::Conflict(_) => "CONFLICT",
            SupabaseError::Forbidden(_) => "FORBIDDEN",
            SupabaseError::InvalidResponse => "INVALID_RESPONSE",
        };
        Self::new(code, err.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfileDto {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactDto {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub is_online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMemberDto {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub is_online: bool,
    pub is_host: bool,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationDto {
    pub id: String,
    pub is_group: bool,
    pub name: Option<String>,
    pub host_id: Option<String>,
    pub current_epoch: i32,
    pub members: Vec<ConversationMemberDto>,
    pub latest_preview: Option<String>,
    pub latest_timestamp: Option<DateTime<Utc>>,
    pub unread_count: u32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaAttachmentDto {
    pub mime_type: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub media_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeenReceiptDto {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub seen_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageReplyPreviewDto {
    pub message_id: String,
    pub sender_id: String,
    pub sender_display_name: String,
    pub status: DecryptionStatus,
    pub text: Option<String>,
    pub has_attachment: bool,
    pub attachment_mime: Option<String>,
    pub is_edited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageDto {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub sender_username: String,
    pub sender_display_name: String,
    pub sender_avatar_url: Option<String>,
    pub epoch: i32,
    pub status: DecryptionStatus,
    pub text: Option<String>,
    pub attachment: Option<MediaAttachmentDto>,
    pub reply_to: Option<MessageReplyPreviewDto>,
    pub is_pinned: bool,
    pub pinned_at: Option<DateTime<Utc>>,
    pub pinned_by_display_name: Option<String>,
    pub is_edited: bool,
    pub edited_at: Option<DateTime<Utc>>,
    pub is_removed: bool,
    pub removed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub seen_by: Vec<SeenReceiptDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinnedMessageDto {
    pub conversation_id: String,
    pub message_id: String,
    pub pinned_by_id: String,
    pub pinned_by_display_name: String,
    pub pinned_at: DateTime<Utc>,
    pub message: MessageDto,
}

pub struct AppState {
    pub session: Mutex<Option<DpapiProtectedSession>>,
    pub refresh_lock: tokio::sync::Mutex<()>,
    pub session_path: PathBuf,
    pub supabase: SupabaseClient,
    pub media_cache: DecryptedMediaCache,
    pub realtime: RealtimeManager,
    pub updater: Arc<UpdaterManager>,
}

impl AppState {
    pub fn from_env() -> Self {
        Self {
            session: Mutex::new(None),
            refresh_lock: tokio::sync::Mutex::new(()),
            session_path: default_session_path(None),
            supabase: SupabaseClient::new(SupabaseConfig::from_env()),
            media_cache: DecryptedMediaCache::new(),
            realtime: RealtimeManager::new(),
            updater: Arc::new(UpdaterManager::from_env()),
        }
    }

    pub fn new_for_test(session_path: PathBuf, supabase: SupabaseClient) -> Self {
        Self {
            session: Mutex::new(None),
            refresh_lock: tokio::sync::Mutex::new(()),
            session_path,
            supabase,
            media_cache: DecryptedMediaCache::new(),
            realtime: RealtimeManager::new(),
            updater: Arc::new(UpdaterManager::from_env()),
        }
    }

    pub fn active_session(&self) -> Result<DpapiProtectedSession, AppError> {
        self.session
            .lock()
            .expect("session mutex")
            .clone()
            .ok_or_else(|| AppError::new("NOT_AUTHENTICATED", "No active session"))
    }

    /// Returns the active session, refreshing an expired or near-expiry Supabase JWT
    /// under `refresh_lock` so single-use refresh tokens are never raced.
    pub async fn ensure_active_session(&self) -> Result<DpapiProtectedSession, AppError> {
        let sess = self.active_session()?;
        if !jwt_is_expiring(&sess.supabase_access_token, 60) {
            return Ok(sess);
        }

        let _guard = self.refresh_lock.lock().await;
        let mut current = self.active_session()?;
        if !jwt_is_expiring(&current.supabase_access_token, 60) {
            return Ok(current);
        }

        match self
            .supabase
            .auth_refresh(&current.supabase_refresh_token)
            .await
        {
            Ok(tokens) => {
                current.supabase_access_token = tokens.access_token;
                current.supabase_refresh_token = tokens.refresh_token;
                save_session_to_path(&self.session_path, &current).map_err(|_| {
                    AppError::new("DPAPI_ERROR", "Failed to persist Windows DPAPI session")
                })?;
                *self.session.lock().expect("session mutex") = Some(current.clone());
                Ok(current)
            }
            Err(SupabaseError::AuthRejected(_)) => {
                self.realtime.disconnect();
                self.media_cache.clear();
                *self.session.lock().expect("session mutex") = None;
                let _ = delete_session_at_path(&self.session_path);
                Err(AppError::from(SupabaseError::AuthRejected(
                    "session expired, please log in again",
                )))
            }
            Err(err) => Err(AppError::from(err)),
        }
    }
}

pub fn validate_username(username: &str) -> Result<String, AppError> {
    let trimmed = username.trim();
    let valid = (3..=32).contains(&trimmed.len())
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err(AppError::new(
            "INVALID_USERNAME",
            "Username must be 3-32 ASCII letters, numbers, or underscores.",
        ));
    }
    Ok(trimmed.to_string())
}

pub fn validate_display_name(display_name: &str) -> Result<String, AppError> {
    let trimmed = display_name.trim();
    let len = trimmed.chars().count();
    if !(1..=64).contains(&len) {
        return Err(AppError::new(
            "INVALID_DISPLAY_NAME",
            "Display name must be between 1 and 64 characters.",
        ));
    }
    Ok(trimmed.to_string())
}

pub fn validate_group_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if !(1..=80).contains(&len) {
        return Err(AppError::new(
            "INVALID_GROUP_NAME",
            "Group name must be between 1 and 80 characters.",
        ));
    }
    Ok(trimmed.to_string())
}

pub async fn resolve_avatar_data_url(
    state: &AppState,
    access_token: &str,
    avatar_path: &Option<String>,
) -> Option<String> {
    let path = avatar_path.as_deref()?;
    let bytes = state
        .supabase
        .download_storage_object(access_token, "avatars", path)
        .await
        .ok()?;
    let mime = if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else {
        "image/png"
    };
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    Some(format!("data:{mime};base64,{}", B64.encode(bytes)))
}

pub async fn profile_to_dto(
    state: &AppState,
    access_token: &str,
    profile: &ProfileRow,
) -> UserProfileDto {
    let avatar_url = resolve_avatar_data_url(state, access_token, &profile.avatar_path).await;
    UserProfileDto {
        id: profile.id.to_string(),
        username: profile.username.clone(),
        display_name: profile.display_name.clone(),
        avatar_url,
    }
}

pub async fn compute_total_unread(
    state: &AppState,
    sess: &DpapiProtectedSession,
) -> Result<u32, AppError> {
    let convs = state
        .supabase
        .list_conversations_for_user(&sess.supabase_access_token, sess.user_id)
        .await?;
    let mut total: u32 = 0;
    for conv in convs {
        let msgs = state
            .supabase
            .list_messages(&sess.supabase_access_token, conv.id, 100, None)
            .await?;
        let reads = state
            .supabase
            .list_message_reads(&sess.supabase_access_token, conv.id)
            .await?;
        let count = msgs
            .iter()
            .filter(|m| {
                m.sender_id != sess.user_id
                    && !m.is_removed
                    && !reads
                        .iter()
                        .any(|r| r.message_id == m.id && r.user_id == sess.user_id)
            })
            .count() as u32;
        total = total.saturating_add(count);
    }
    Ok(total)
}

pub async fn refresh_taskbar_badge<R: Runtime>(app: &AppHandle<R>, state: &AppState) {
    if let Ok(sess) = state.ensure_active_session().await {
        if let Ok(total) = compute_total_unread(state, &sess).await {
            update_taskbar_unread_badge(app, total);
        }
    } else {
        update_taskbar_unread_badge(app, 0);
    }
}

pub fn connect_realtime_for_session<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    sess: &DpapiProtectedSession,
) {
    state.realtime.set_user_online(sess.user_id, true);
    if let Some(cfg) = state.supabase.config.clone() {
        let app_handle = app.clone();
        let current_user = sess.user_id;
        state.realtime.connect_remote(
            cfg,
            sess.user_id,
            sess.supabase_access_token.clone(),
            move |val| {
                let event = val.get("event").and_then(|e| e.as_str()).unwrap_or("");
                if event == "presence_diff" {
                    let ids = app_handle
                        .state::<AppState>()
                        .realtime
                        .online_user_ids();
                    let _ = app_handle.emit(
                        "realtime:presence_changed",
                        serde_json::json!({ "online_user_ids": ids }),
                    );
                } else if event == "broadcast" {
                    if let Some(cid_s) = val
                        .pointer("/payload/payload/conversation_id")
                        .and_then(|v| v.as_str())
                    {
                        if let Ok(cid) = Uuid::parse_str(cid_s) {
                            let typing_users = app_handle
                                .state::<AppState>()
                                .realtime
                                .prune_and_get_typing(cid);
                            let _ = app_handle.emit(
                                "realtime:typing_changed",
                                serde_json::json!({
                                    "conversation_id": cid.to_string(),
                                    "typing_users": typing_users,
                                }),
                            );
                        }
                    }
                } else if event == "postgres_changes" {
                    let table = val
                        .pointer("/payload/data/table")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let app_clone = app_handle.clone();
                    match table {
                        "messages" => {
                            let conv_id_opt = val
                                .pointer("/payload/data/record/conversation_id")
                                .and_then(|v| v.as_str())
                                .and_then(|s| Uuid::parse_str(s).ok());
                            let sender_opt = val
                                .pointer("/payload/data/record/sender_id")
                                .and_then(|v| v.as_str())
                                .and_then(|s| Uuid::parse_str(s).ok());
                            let msg_id_opt = val
                                .pointer("/payload/data/record/id")
                                .and_then(|v| v.as_str())
                                .and_then(|s| Uuid::parse_str(s).ok());

                            tauri::async_runtime::spawn(async move {
                                let st = app_clone.state::<AppState>();
                                refresh_taskbar_badge(&app_clone, &st).await;

                                if let (Some(cid), Some(mid), Some(sid)) =
                                    (conv_id_opt, msg_id_opt, sender_opt)
                                {
                                    if let Ok(dto) = messages::fetch_and_decrypt_single_message(
                                        &st, cid, mid,
                                    )
                                    .await
                                    {
                                        let _ = app_clone.emit("realtime:message_upsert", &dto);
                                        if sid != current_user && !dto.is_removed {
                                            let is_focused = app_clone
                                                .get_webview_window("main")
                                                .and_then(|w| w.is_focused().ok())
                                                .unwrap_or(false);
                                            if !is_focused {
                                                let preview = dto
                                                    .text
                                                    .as_deref()
                                                    .unwrap_or("Sent an encrypted attachment");
                                                dispatch_message_notification(
                                                    &app_clone,
                                                    cid,
                                                    &dto.sender_display_name,
                                                    preview,
                                                );
                                            }
                                        }
                                    }
                                }
                            });
                        }
                        "message_reads" => {
                            let conv_id_opt = val
                                .pointer("/payload/data/record/conversation_id")
                                .and_then(|v| v.as_str())
                                .and_then(|s| Uuid::parse_str(s).ok());
                            let msg_id_opt = val
                                .pointer("/payload/data/record/message_id")
                                .and_then(|v| v.as_str())
                                .and_then(|s| Uuid::parse_str(s).ok());
                            tauri::async_runtime::spawn(async move {
                                let st = app_clone.state::<AppState>();
                                refresh_taskbar_badge(&app_clone, &st).await;
                                if let (Some(cid), Some(mid)) = (conv_id_opt, msg_id_opt) {
                                    if let Ok(seen_by) =
                                        messages::get_seen_receipts_for_message(&st, cid, mid).await
                                    {
                                        let _ = app_clone.emit(
                                            "realtime:message_seen",
                                            serde_json::json!({
                                                "conversation_id": cid.to_string(),
                                                "message_id": mid.to_string(),
                                                "seen_by": seen_by,
                                            }),
                                        );
                                    }
                                }
                            });
                        }
                        "pinned_messages" => {
                            let conv_id_opt = val
                                .pointer("/payload/data/record/conversation_id")
                                .or_else(|| val.pointer("/payload/data/old_record/conversation_id"))
                                .and_then(|v| v.as_str())
                                .and_then(|s| Uuid::parse_str(s).ok());
                            let msg_id_opt = val
                                .pointer("/payload/data/record/message_id")
                                .or_else(|| val.pointer("/payload/data/old_record/message_id"))
                                .and_then(|v| v.as_str())
                                .and_then(|s| Uuid::parse_str(s).ok());
                            if let Some(cid) = conv_id_opt {
                                let _ = app_clone.emit(
                                    "realtime:pins_changed",
                                    serde_json::json!({ "conversation_id": cid.to_string() }),
                                );
                                if let Some(mid) = msg_id_opt {
                                    tauri::async_runtime::spawn(async move {
                                        let st = app_clone.state::<AppState>();
                                        if let Ok(dto) = messages::fetch_and_decrypt_single_message(
                                            &st, cid, mid,
                                        )
                                        .await
                                        {
                                            let _ = app_clone.emit("realtime:message_upsert", &dto);
                                        }
                                    });
                                }
                            }
                        }
                        "conversations" | "conversation_members" => {
                            let conv_id_opt = val
                                .pointer("/payload/data/record/conversation_id")
                                .or_else(|| val.pointer("/payload/data/record/id"))
                                .and_then(|v| v.as_str())
                                .and_then(|s| Uuid::parse_str(s).ok());
                            tauri::async_runtime::spawn(async move {
                                let st = app_clone.state::<AppState>();
                                if let Some(cid) = conv_id_opt {
                                    if let Ok(conv) =
                                        conversations::load_conversation_dto(&st, cid).await
                                    {
                                        let _ =
                                            app_clone.emit("realtime:conversation_updated", &conv);
                                    }
                                }
                            });
                        }
                        "contacts" => {
                            let _ = app_clone.emit("realtime:contact_added", serde_json::json!({}));
                        }
                        _ => {}
                    }
                }
            },
        );
    }
}

#[tauri::command]
pub async fn window_focus_conversation<R: Runtime>(
    app: AppHandle<R>,
    conversation_id: String,
) -> Result<(), AppError> {
    let cid = Uuid::parse_str(&conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;
    activate_conversation_window(&app, cid);
    Ok(())
}

use tauri::Manager;
