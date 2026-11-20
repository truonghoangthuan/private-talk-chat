use std::collections::HashMap;
use std::fs;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::{DateTime, Utc};
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::aead::{
    decrypt_media_attachment, encrypt_and_sign_message, encrypt_media_attachment,
    verify_and_decrypt_message, AttachmentMetadata, DecryptionStatus, EncryptedMessageEnvelope,
};
use crate::supabase::{MessageReadRow, MessageRow, PinnedMessageRow};

use super::conversations::ensure_epoch_key;
use super::{
    refresh_taskbar_badge, resolve_avatar_data_url, AppError, AppState, MediaAttachmentDto,
    MessageDto, MessageReplyPreviewDto, PinnedMessageDto, SeenReceiptDto,
};

const MAX_CHAT_MEDIA_BYTES: usize = 50 * 1024 * 1024; // 50 MB (52,428,800 bytes)

fn detect_chat_media_mime(path: &Path) -> Result<&'static str, AppError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => Ok("image/png"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "webp" => Ok("image/webp"),
        "gif" => Ok("image/gif"),
        "mp4" => Ok("video/mp4"),
        "webm" => Ok("video/webm"),
        _ => Err(AppError::new(
            "UNSUPPORTED_MEDIA",
            "Allowed formats: PNG, JPG, WEBP, GIF, MP4, WEBM.",
        )),
    }
}

fn to_fixed_32(bytes: &[u8]) -> Result<[u8; 32], AppError> {
    bytes
        .try_into()
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Invalid 32-byte key"))
}

pub async fn get_seen_receipts_for_message(
    state: &AppState,
    conversation_id: Uuid,
    message_id: Uuid,
) -> Result<Vec<SeenReceiptDto>, AppError> {
    let sess = state.ensure_active_session().await?;
    let reads = state
        .supabase
        .list_message_reads(&sess.supabase_access_token, conversation_id)
        .await?;

    let mut out = Vec::new();
    for r in reads.into_iter().filter(|r| r.message_id == message_id) {
        if let Ok(prof) = state
            .supabase
            .get_profile(&sess.supabase_access_token, r.user_id)
            .await
        {
            let avatar_url =
                resolve_avatar_data_url(state, &sess.supabase_access_token, &prof.avatar_path)
                    .await;
            out.push(SeenReceiptDto {
                user_id: r.user_id.to_string(),
                username: prof.username,
                display_name: prof.display_name,
                avatar_url,
                seen_at: r.seen_at,
            });
        }
    }
    Ok(out)
}

async fn resolve_pinned_map(
    state: &AppState,
    conversation_id: Uuid,
) -> HashMap<Uuid, (PinnedMessageRow, String)> {
    let Ok(sess) = state.active_session() else {
        return HashMap::new();
    };
    let Ok(pins) = state
        .supabase
        .list_pinned_messages(&sess.supabase_access_token, sess.user_id, conversation_id)
        .await
    else {
        return HashMap::new();
    };
    let mut name_cache: HashMap<Uuid, String> = HashMap::new();
    let mut map = HashMap::with_capacity(pins.len());
    for pin in pins {
        let display_name = if let Some(cached) = name_cache.get(&pin.pinned_by) {
            cached.clone()
        } else {
            let name = state
                .supabase
                .get_profile(&sess.supabase_access_token, pin.pinned_by)
                .await
                .map(|p| p.display_name)
                .unwrap_or_else(|_| "Member".to_string());
            name_cache.insert(pin.pinned_by, name.clone());
            name
        };
        map.insert(pin.message_id, (pin, display_name));
    }
    map
}

async fn resolve_reply_preview(
    state: &AppState,
    row: &MessageRow,
    parent_id: Uuid,
) -> Result<MessageReplyPreviewDto, ()> {
    if parent_id == row.id {
        return Err(());
    }
    let sess = state.active_session().map_err(|_| ())?;
    let Ok(parent_row) = state
        .supabase
        .get_message(&sess.supabase_access_token, parent_id)
        .await
    else {
        return Ok(MessageReplyPreviewDto {
            message_id: parent_id.to_string(),
            sender_id: String::new(),
            sender_display_name: "Unknown".to_string(),
            status: DecryptionStatus::VerificationFailed,
            text: None,
            has_attachment: false,
            attachment_mime: None,
            is_edited: false,
        });
    };

    if parent_row.conversation_id != row.conversation_id {
        return Err(());
    }

    let sender_display_name = state
        .supabase
        .get_profile(&sess.supabase_access_token, parent_row.sender_id)
        .await
        .map(|p| p.display_name)
        .unwrap_or_else(|_| "Member".to_string());

    if parent_row.is_removed {
        return Ok(MessageReplyPreviewDto {
            message_id: parent_id.to_string(),
            sender_id: parent_row.sender_id.to_string(),
            sender_display_name,
            status: DecryptionStatus::Removed,
            text: None,
            has_attachment: false,
            attachment_mime: None,
            is_edited: parent_row.is_edited,
        });
    }

    let failed_preview = MessageReplyPreviewDto {
        message_id: parent_id.to_string(),
        sender_id: parent_row.sender_id.to_string(),
        sender_display_name: sender_display_name.clone(),
        status: DecryptionStatus::VerificationFailed,
        text: None,
        has_attachment: false,
        attachment_mime: None,
        is_edited: parent_row.is_edited,
    };

    let (Some(n), Some(c), Some(s)) =
        (&parent_row.nonce, &parent_row.ciphertext, &parent_row.signature)
    else {
        return Ok(failed_preview);
    };
    let Ok(epoch_key) = ensure_epoch_key(state, parent_row.conversation_id, parent_row.epoch).await
    else {
        return Ok(failed_preview);
    };
    let Ok(sender_prof) = state
        .supabase
        .get_profile(&sess.supabase_access_token, parent_row.sender_id)
        .await
    else {
        return Ok(failed_preview);
    };
    let Ok(sender_sign_pub) = to_fixed_32(&sender_prof.public_sign_key) else {
        return Ok(failed_preview);
    };

    match verify_and_decrypt_message(
        parent_row.conversation_id,
        parent_row.id,
        parent_row.epoch,
        &epoch_key,
        &sender_sign_pub,
        n,
        c,
        s,
    ) {
        Ok(env) => Ok(MessageReplyPreviewDto {
            message_id: parent_id.to_string(),
            sender_id: parent_row.sender_id.to_string(),
            sender_display_name,
            status: DecryptionStatus::Verified,
            text: env.text,
            has_attachment: env.attachment.is_some(),
            attachment_mime: env.attachment.map(|a| a.mime_type),
            is_edited: parent_row.is_edited,
        }),
        Err(_) => Ok(failed_preview),
    }
}

async fn decrypt_message_row(
    state: &AppState,
    row: MessageRow,
) -> Result<MessageDto, AppError> {
    let pinned_map = resolve_pinned_map(state, row.conversation_id).await;
    decrypt_message_row_with_pins(state, row, &pinned_map).await
}

async fn decrypt_message_row_with_pins(
    state: &AppState,
    row: MessageRow,
    pinned_map: &HashMap<Uuid, (PinnedMessageRow, String)>,
) -> Result<MessageDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let sender = state
        .supabase
        .get_profile(&sess.supabase_access_token, row.sender_id)
        .await?;
    let sender_avatar_url =
        resolve_avatar_data_url(state, &sess.supabase_access_token, &sender.avatar_path).await;
    let seen_by = get_seen_receipts_for_message(state, row.conversation_id, row.id).await?;

    if row.is_removed {
        state.media_cache.remove(row.conversation_id, row.id);
        return Ok(MessageDto {
            id: row.id.to_string(),
            conversation_id: row.conversation_id.to_string(),
            sender_id: row.sender_id.to_string(),
            sender_username: sender.username,
            sender_display_name: sender.display_name,
            sender_avatar_url,
            epoch: row.epoch,
            status: DecryptionStatus::Removed,
            text: None,
            attachment: None,
            reply_to: None,
            is_pinned: false,
            pinned_at: None,
            pinned_by_display_name: None,
            is_edited: row.is_edited,
            edited_at: row.edited_at,
            is_removed: true,
            removed_at: row.removed_at,
            created_at: row.created_at,
            seen_by,
        });
    }

    let (Some(nonce), Some(ciphertext), Some(signature)) =
        (&row.nonce, &row.ciphertext, &row.signature)
    else {
        return Ok(failed_message_dto(row, sender.username, sender.display_name, sender_avatar_url, seen_by));
    };

    let Ok(epoch_key) = ensure_epoch_key(state, row.conversation_id, row.epoch).await else {
        return Ok(failed_message_dto(row, sender.username, sender.display_name, sender_avatar_url, seen_by));
    };

    let Ok(sender_sign_pub) = to_fixed_32(&sender.public_sign_key) else {
        return Ok(failed_message_dto(row, sender.username, sender.display_name, sender_avatar_url, seen_by));
    };

    let envelope = match verify_and_decrypt_message(
        row.conversation_id,
        row.id,
        row.epoch,
        &epoch_key,
        &sender_sign_pub,
        nonce,
        ciphertext,
        signature,
    ) {
        Ok(env) => env,
        Err(_) => {
            return Ok(failed_message_dto(
                row,
                sender.username,
                sender.display_name,
                sender_avatar_url,
                seen_by,
            ));
        }
    };

    let reply_to = if let Some(parent_id) = envelope.reply_to_message_id {
        match resolve_reply_preview(state, &row, parent_id).await {
            Ok(preview) => Some(preview),
            Err(()) => {
                return Ok(failed_message_dto(
                    row,
                    sender.username,
                    sender.display_name,
                    sender_avatar_url,
                    seen_by,
                ));
            }
        }
    } else {
        None
    };

    let mut attachment_dto = None;
    if let (Some(att_meta), Some(obj_path)) = (&envelope.attachment, &row.media_object_path) {
        if state.media_cache.get(row.conversation_id, row.id).is_none() {
            let Ok(enc_blob) = state
                .supabase
                .download_storage_object(&sess.supabase_access_token, "chat-media", obj_path)
                .await
            else {
                return Ok(failed_message_dto(
                    row,
                    sender.username,
                    sender.display_name,
                    sender_avatar_url,
                    seen_by,
                ));
            };
            let Ok(plain_media) = decrypt_media_attachment(
                row.conversation_id,
                row.id,
                row.epoch,
                &epoch_key,
                att_meta,
                &enc_blob,
            ) else {
                return Ok(failed_message_dto(
                    row,
                    sender.username,
                    sender.display_name,
                    sender_avatar_url,
                    seen_by,
                ));
            };
            state.media_cache.insert(
                row.conversation_id,
                row.id,
                att_meta.mime_type.clone(),
                plain_media,
            );
        }

        attachment_dto = Some(MediaAttachmentDto {
            mime_type: att_meta.mime_type.clone(),
            file_name: att_meta.file_name.clone(),
            size_bytes: att_meta.size_bytes,
            media_url: format!("privatetalk-media://localhost/{}/{}", row.conversation_id, row.id),
        });
    }

    let (is_pinned, pinned_at, pinned_by_display_name) = match pinned_map.get(&row.id) {
        Some((pin, name)) => (true, Some(pin.pinned_at), Some(name.clone())),
        None => (false, None, None),
    };

    Ok(MessageDto {
        id: row.id.to_string(),
        conversation_id: row.conversation_id.to_string(),
        sender_id: row.sender_id.to_string(),
        sender_username: sender.username,
        sender_display_name: sender.display_name,
        sender_avatar_url,
        epoch: row.epoch,
        status: DecryptionStatus::Verified,
        text: envelope.text,
        attachment: attachment_dto,
        reply_to,
        is_pinned,
        pinned_at,
        pinned_by_display_name,
        is_edited: row.is_edited,
        edited_at: row.edited_at,
        is_removed: false,
        removed_at: None,
        created_at: row.created_at,
        seen_by,
    })
}

fn failed_message_dto(
    row: MessageRow,
    sender_username: String,
    sender_display_name: String,
    sender_avatar_url: Option<String>,
    seen_by: Vec<SeenReceiptDto>,
) -> MessageDto {
    MessageDto {
        id: row.id.to_string(),
        conversation_id: row.conversation_id.to_string(),
        sender_id: row.sender_id.to_string(),
        sender_username,
        sender_display_name,
        sender_avatar_url,
        epoch: row.epoch,
        status: DecryptionStatus::VerificationFailed,
        text: None,
        attachment: None,
        reply_to: None,
        is_pinned: false,
        pinned_at: None,
        pinned_by_display_name: None,
        is_edited: row.is_edited,
        edited_at: row.edited_at,
        is_removed: false,
        removed_at: None,
        created_at: row.created_at,
        seen_by,
    }
}

pub async fn fetch_and_decrypt_single_message(
    state: &AppState,
    _conversation_id: Uuid,
    message_id: Uuid,
) -> Result<MessageDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let row = state
        .supabase
        .get_message(&sess.supabase_access_token, message_id)
        .await?;
    decrypt_message_row(state, row).await
}

pub async fn message_list_core(
    state: &AppState,
    conversation_id: &str,
    limit: u32,
    before: Option<String>,
) -> Result<Vec<MessageDto>, AppError> {
    let sess = state.ensure_active_session().await?;
    let cid = Uuid::parse_str(conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;
    let before_dt = before
        .as_deref()
        .map(DateTime::parse_from_rfc3339)
        .transpose()
        .map_err(|_| AppError::new("INVALID_CURSOR", "Invalid pagination cursor"))?
        .map(|dt| dt.with_timezone(&Utc));

    let rows = state
        .supabase
        .list_messages(&sess.supabase_access_token, cid, limit, before_dt)
        .await?;
    let pinned_map = resolve_pinned_map(state, cid).await;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(decrypt_message_row_with_pins(state, r, &pinned_map).await?);
    }
    Ok(out)
}

pub async fn message_send_core(
    state: &AppState,
    conversation_id: &str,
    text: Option<String>,
    attachment_path: Option<String>,
    reply_to_message_id: Option<String>,
) -> Result<MessageDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let cid = Uuid::parse_str(conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;

    let reply_uuid = match reply_to_message_id.as_deref() {
        Some(raw) if !raw.trim().is_empty() => Some(
            Uuid::parse_str(raw.trim())
                .map_err(|_| AppError::new("INVALID_ID", "Invalid reply message ID"))?,
        ),
        _ => None,
    };

    let trimmed_text = text
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if trimmed_text.is_none() && attachment_path.is_none() {
        return Err(AppError::new(
            "EMPTY_MESSAGE",
            "Message cannot be empty without an attachment.",
        ));
    }

    let convs = state
        .supabase
        .list_conversations_for_user(&sess.supabase_access_token, sess.user_id)
        .await?;
    let conv = convs
        .into_iter()
        .find(|c| c.id == cid)
        .ok_or_else(|| AppError::new("NOT_FOUND", "Conversation not found"))?;

    if let Some(parent_id) = reply_uuid {
        let parent_row = state
            .supabase
            .get_message(&sess.supabase_access_token, parent_id)
            .await?;
        if parent_row.conversation_id != cid {
            return Err(AppError::new(
                "FORBIDDEN",
                "Cannot reply to a message from another conversation.",
            ));
        }
        if parent_row.is_removed {
            return Err(AppError::new(
                "MESSAGE_REMOVED",
                "Cannot reply to a removed message.",
            ));
        }
        let parent_dto = decrypt_message_row(state, parent_row).await?;
        if parent_dto.status != DecryptionStatus::Verified {
            return Err(AppError::new(
                "VERIFICATION_FAILED",
                "Cannot reply to an unverified message.",
            ));
        }
    }

    let epoch_key = ensure_epoch_key(state, cid, conv.current_epoch).await?;
    let msg_id = Uuid::new_v4();

    let mut attachment_meta: Option<AttachmentMetadata> = None;
    let mut media_object_path: Option<String> = None;

    if let Some(ref path_str) = attachment_path {
        let path = Path::new(path_str);
        let meta = fs::metadata(path)
            .map_err(|_| AppError::new("IO_ERROR", "Unable to read attachment file."))?;
        if meta.len() as usize > MAX_CHAT_MEDIA_BYTES {
            return Err(AppError::new(
                "FILE_TOO_LARGE",
                "Attachment exceeds the 50 MB limit.",
            ));
        }
        let mime_type = detect_chat_media_mime(path)?;
        let raw_bytes = Zeroizing::new(
            fs::read(path)
                .map_err(|_| AppError::new("IO_ERROR", "Unable to read attachment file."))?,
        );
        if raw_bytes.len() > MAX_CHAT_MEDIA_BYTES {
            return Err(AppError::new(
                "FILE_TOO_LARGE",
                "Attachment exceeds the 50 MB limit.",
            ));
        }

        let enc_media =
            encrypt_media_attachment(cid, msg_id, conv.current_epoch, &epoch_key, &raw_bytes)
                .map_err(|_| AppError::new("CRYPTO_ERROR", "Media encryption failed"))?;

        let obj_path = format!("{cid}/{msg_id}.enc");
        state
            .supabase
            .upload_storage_object(
                &sess.supabase_access_token,
                "chat-media",
                &obj_path,
                "application/octet-stream",
                enc_media.ciphertext,
            )
            .await?;

        state
            .media_cache
            .insert(cid, msg_id, mime_type.to_string(), raw_bytes.clone());

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("attachment")
            .to_string();

        attachment_meta = Some(AttachmentMetadata {
            mime_type: mime_type.to_string(),
            file_name,
            size_bytes: meta.len(),
            media_nonce: B64.encode(enc_media.media_nonce),
            media_sha256: B64.encode(enc_media.media_sha256),
        });
        media_object_path = Some(obj_path);
    }

    let envelope = EncryptedMessageEnvelope {
        text: trimmed_text,
        attachment: attachment_meta,
        reply_to_message_id: reply_uuid,
    };
    let enc_msg = encrypt_and_sign_message(
        cid,
        msg_id,
        conv.current_epoch,
        &epoch_key,
        &sess.ed25519_private_key,
        &envelope,
    )
    .map_err(|_| AppError::new("CRYPTO_ERROR", "Message encryption failed"))?;

    let row = MessageRow {
        id: msg_id,
        conversation_id: cid,
        sender_id: sess.user_id,
        epoch: conv.current_epoch,
        nonce: Some(enc_msg.nonce.to_vec()),
        ciphertext: Some(enc_msg.ciphertext),
        signature: Some(enc_msg.signature.to_vec()),
        media_object_path,
        is_edited: false,
        edited_at: None,
        is_removed: false,
        removed_at: None,
        created_at: Utc::now(),
    };

    let inserted = state
        .supabase
        .insert_message(&sess.supabase_access_token, &row)
        .await?;

    decrypt_message_row(state, inserted).await
}

pub async fn message_edit_core(
    state: &AppState,
    message_id: &str,
    new_text: &str,
) -> Result<MessageDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let mid = Uuid::parse_str(message_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid message ID"))?;
    let trimmed = new_text.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "EMPTY_MESSAGE",
            "Edited message text cannot be empty.",
        ));
    }

    let existing = state
        .supabase
        .get_message(&sess.supabase_access_token, mid)
        .await?;
    if existing.sender_id != sess.user_id {
        return Err(AppError::new(
            "FORBIDDEN",
            "You can only edit your own messages.",
        ));
    }
    if existing.is_removed {
        return Err(AppError::new(
            "MESSAGE_REMOVED",
            "Removed messages cannot be edited.",
        ));
    }

    let epoch_key = ensure_epoch_key(state, existing.conversation_id, existing.epoch).await?;
    let sender_prof = state
        .supabase
        .get_profile(&sess.supabase_access_token, existing.sender_id)
        .await?;
    let sender_pub = to_fixed_32(&sender_prof.public_sign_key)?;

    // Preserve existing attachment metadata and reply linkage when editing message text.
    let existing_envelope = match (&existing.nonce, &existing.ciphertext, &existing.signature) {
        (Some(n), Some(c), Some(s)) => verify_and_decrypt_message(
            existing.conversation_id,
            existing.id,
            existing.epoch,
            &epoch_key,
            &sender_pub,
            n,
            c,
            s,
        )
        .ok(),
        _ => None,
    };

    let updated_envelope = EncryptedMessageEnvelope {
        text: Some(trimmed),
        attachment: existing_envelope.as_ref().and_then(|env| env.attachment.clone()),
        reply_to_message_id: existing_envelope.and_then(|env| env.reply_to_message_id),
    };
    let enc = encrypt_and_sign_message(
        existing.conversation_id,
        existing.id,
        existing.epoch,
        &epoch_key,
        &sess.ed25519_private_key,
        &updated_envelope,
    )
    .map_err(|_| AppError::new("CRYPTO_ERROR", "Message re-encryption failed"))?;

    let updated_row = state
        .supabase
        .update_edited_message(
            &sess.supabase_access_token,
            sess.user_id,
            mid,
            &enc.nonce,
            &enc.ciphertext,
            &enc.signature,
        )
        .await?;

    decrypt_message_row(state, updated_row).await
}

pub async fn message_remove_core(
    state: &AppState,
    message_id: &str,
) -> Result<MessageDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let mid = Uuid::parse_str(message_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid message ID"))?;

    let existing = state
        .supabase
        .get_message(&sess.supabase_access_token, mid)
        .await?;
    if existing.sender_id != sess.user_id {
        return Err(AppError::new(
            "FORBIDDEN",
            "You can only remove your own messages.",
        ));
    }

    let old_media_path = state
        .supabase
        .rpc_remove_sent_message(&sess.supabase_access_token, sess.user_id, mid)
        .await?;

    if let Some(obj_path) = old_media_path {
        if let Err(err) = state
            .supabase
            .delete_storage_object(&sess.supabase_access_token, "chat-media", &obj_path)
            .await
        {
            tracing::warn!(message_id = %mid, error = %err, "Failed deleting chat-media blob; row wiped");
        }
    }

    state.media_cache.remove(existing.conversation_id, mid);
    let wiped = state
        .supabase
        .get_message(&sess.supabase_access_token, mid)
        .await?;
    decrypt_message_row(state, wiped).await
}

pub async fn message_mark_seen_core(
    state: &AppState,
    conversation_id: &str,
    up_to_message_id: &str,
) -> Result<(), AppError> {
    let sess = state.ensure_active_session().await?;
    let cid = Uuid::parse_str(conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;
    let target_mid = Uuid::parse_str(up_to_message_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid message ID"))?;

    let msgs = state
        .supabase
        .list_messages(&sess.supabase_access_token, cid, 100, None)
        .await?;
    let Some(target_msg) = msgs.iter().find(|m| m.id == target_mid) else {
        return Ok(());
    };
    let cutoff = target_msg.created_at;
    let now = Utc::now();

    let reads: Vec<MessageReadRow> = msgs
        .into_iter()
        .filter(|m| m.sender_id != sess.user_id && !m.is_removed && m.created_at <= cutoff)
        .map(|m| MessageReadRow {
            conversation_id: cid,
            message_id: m.id,
            user_id: sess.user_id,
            seen_at: now,
        })
        .collect();

    state
        .supabase
        .upsert_message_reads(&sess.supabase_access_token, &reads)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn message_list(
    state: State<'_, AppState>,
    conversation_id: String,
    limit: u32,
    before: Option<String>,
) -> Result<Vec<MessageDto>, AppError> {
    message_list_core(&state, &conversation_id, limit, before).await
}

#[tauri::command]
pub async fn message_send<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    conversation_id: String,
    text: Option<String>,
    attachment_path: Option<String>,
    reply_to_message_id: Option<String>,
) -> Result<MessageDto, AppError> {
    let dto = message_send_core(
        &state,
        &conversation_id,
        text,
        attachment_path,
        reply_to_message_id,
    )
    .await?;
    let _ = app.emit("realtime:message_upsert", &dto);
    Ok(dto)
}

#[tauri::command]
pub async fn message_edit<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    message_id: String,
    new_text: String,
) -> Result<MessageDto, AppError> {
    let dto = message_edit_core(&state, &message_id, &new_text).await?;
    let _ = app.emit("realtime:message_upsert", &dto);
    Ok(dto)
}

#[tauri::command]
pub async fn message_remove<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    message_id: String,
) -> Result<MessageDto, AppError> {
    let dto = message_remove_core(&state, &message_id).await?;
    let _ = app.emit("realtime:message_upsert", &dto);
    let _ = app.emit(
        "realtime:pins_changed",
        serde_json::json!({ "conversation_id": dto.conversation_id }),
    );
    Ok(dto)
}

pub async fn message_pin_core(
    state: &AppState,
    conversation_id: &str,
    message_id: &str,
) -> Result<PinnedMessageDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let cid = Uuid::parse_str(conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;
    let mid = Uuid::parse_str(message_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid message ID"))?;

    let members = state
        .supabase
        .list_conversation_members(&sess.supabase_access_token, cid)
        .await?;
    if !members.iter().any(|m| m.user_id == sess.user_id) {
        return Err(AppError::new("FORBIDDEN", "Not a conversation member."));
    }

    let row = state
        .supabase
        .get_message(&sess.supabase_access_token, mid)
        .await?;
    if row.conversation_id != cid {
        return Err(AppError::new(
            "FORBIDDEN",
            "Message does not belong to this conversation.",
        ));
    }
    if row.is_removed {
        return Err(AppError::new(
            "MESSAGE_REMOVED",
            "Removed messages cannot be pinned.",
        ));
    }

    let pre_dto = decrypt_message_row(state, row.clone()).await?;
    if pre_dto.status != DecryptionStatus::Verified {
        return Err(AppError::new(
            "VERIFICATION_FAILED",
            "Unverified messages cannot be pinned.",
        ));
    }

    let pin_row = state
        .supabase
        .pin_message(&sess.supabase_access_token, sess.user_id, cid, mid)
        .await?;
    let pinner_name = state
        .supabase
        .get_profile(&sess.supabase_access_token, pin_row.pinned_by)
        .await
        .map(|p| p.display_name)
        .unwrap_or_else(|_| "Member".to_string());

    let mut message_dto = pre_dto;
    message_dto.is_pinned = true;
    message_dto.pinned_at = Some(pin_row.pinned_at);
    message_dto.pinned_by_display_name = Some(pinner_name.clone());

    Ok(PinnedMessageDto {
        conversation_id: cid.to_string(),
        message_id: mid.to_string(),
        pinned_by_id: pin_row.pinned_by.to_string(),
        pinned_by_display_name: pinner_name,
        pinned_at: pin_row.pinned_at,
        message: message_dto,
    })
}

pub async fn message_unpin_core(
    state: &AppState,
    conversation_id: &str,
    message_id: &str,
) -> Result<(), AppError> {
    let sess = state.ensure_active_session().await?;
    let cid = Uuid::parse_str(conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;
    let mid = Uuid::parse_str(message_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid message ID"))?;

    let members = state
        .supabase
        .list_conversation_members(&sess.supabase_access_token, cid)
        .await?;
    if !members.iter().any(|m| m.user_id == sess.user_id) {
        return Err(AppError::new("FORBIDDEN", "Not a conversation member."));
    }

    state
        .supabase
        .unpin_message(&sess.supabase_access_token, sess.user_id, cid, mid)
        .await?;
    Ok(())
}

pub async fn message_list_pinned_core(
    state: &AppState,
    conversation_id: &str,
) -> Result<Vec<PinnedMessageDto>, AppError> {
    let sess = state.ensure_active_session().await?;
    let cid = Uuid::parse_str(conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;

    let members = state
        .supabase
        .list_conversation_members(&sess.supabase_access_token, cid)
        .await?;
    if !members.iter().any(|m| m.user_id == sess.user_id) {
        return Err(AppError::new("FORBIDDEN", "Not a conversation member."));
    }

    let pins = state
        .supabase
        .list_pinned_messages(&sess.supabase_access_token, sess.user_id, cid)
        .await?;
    let pinned_map = resolve_pinned_map(state, cid).await;

    let mut out = Vec::new();
    for pin in pins {
        let Ok(row) = state
            .supabase
            .get_message(&sess.supabase_access_token, pin.message_id)
            .await
        else {
            continue;
        };
        if row.conversation_id != cid || row.is_removed {
            continue;
        }
        let Ok(dto) = decrypt_message_row_with_pins(state, row, &pinned_map).await else {
            continue;
        };
        if dto.status != DecryptionStatus::Verified {
            continue;
        }
        let pinner_name = pinned_map
            .get(&pin.message_id)
            .map(|(_, name)| name.clone())
            .unwrap_or_else(|| "Member".to_string());
        out.push(PinnedMessageDto {
            conversation_id: cid.to_string(),
            message_id: pin.message_id.to_string(),
            pinned_by_id: pin.pinned_by.to_string(),
            pinned_by_display_name: pinner_name,
            pinned_at: pin.pinned_at,
            message: dto,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn message_pin<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    conversation_id: String,
    message_id: String,
) -> Result<PinnedMessageDto, AppError> {
    let pinned = message_pin_core(&state, &conversation_id, &message_id).await?;
    let _ = app.emit(
        "realtime:pins_changed",
        serde_json::json!({ "conversation_id": pinned.conversation_id }),
    );
    let _ = app.emit("realtime:message_upsert", &pinned.message);
    Ok(pinned)
}

#[tauri::command]
pub async fn message_unpin<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    conversation_id: String,
    message_id: String,
) -> Result<(), AppError> {
    message_unpin_core(&state, &conversation_id, &message_id).await?;
    let _ = app.emit(
        "realtime:pins_changed",
        serde_json::json!({ "conversation_id": conversation_id }),
    );
    if let (Ok(cid), Ok(mid)) = (
        Uuid::parse_str(&conversation_id),
        Uuid::parse_str(&message_id),
    ) {
        if let Ok(dto) = fetch_and_decrypt_single_message(&state, cid, mid).await {
            let _ = app.emit("realtime:message_upsert", &dto);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn message_list_pinned(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<PinnedMessageDto>, AppError> {
    message_list_pinned_core(&state, &conversation_id).await
}

#[tauri::command]
pub async fn message_mark_seen<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    conversation_id: String,
    up_to_message_id: String,
) -> Result<(), AppError> {
    message_mark_seen_core(&state, &conversation_id, &up_to_message_id).await?;
    refresh_taskbar_badge(&app, &state).await;
    Ok(())
}

#[tauri::command]
pub async fn typing_set_status<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    conversation_id: String,
    is_typing: bool,
) -> Result<(), AppError> {
    let sess = state.ensure_active_session().await?;
    let cid = Uuid::parse_str(&conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;
    state
        .realtime
        .broadcast_typing(cid, sess.user_id, &sess.display_name, is_typing);
    let _ = app.emit(
        "realtime:typing_changed",
        serde_json::json!({
            "conversation_id": cid.to_string(),
            "typing_users": state.realtime.prune_and_get_typing(cid),
        }),
    );
    Ok(())
}
