use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;

use crate::crypto::aead::{verify_and_decrypt_message, DecryptionStatus};
use crate::crypto::keys::{
    generate_epoch_key, unwrap_epoch_key_for_recipient, wrap_epoch_key_for_recipient,
    WrappedEpochKeyBundle,
};
use crate::platform::dpapi::{epoch_cache_key, save_session_to_path};
use crate::supabase::postgrest::WrappedKeyRpcItem;
use crate::supabase::{
    ConversationMemberKeyRow, ConversationMemberRow, ConversationRow,
};

use super::{
    resolve_avatar_data_url, validate_group_name, AppError, AppState, ConversationDto,
    ConversationMemberDto,
};

const MAX_GROUP_MEMBERS: usize = 100;

fn direct_pair_key(a: Uuid, b: Uuid) -> String {
    if a < b {
        format!("{a}:{b}")
    } else {
        format!("{b}:{a}")
    }
}

fn to_fixed_32(bytes: &[u8]) -> Result<[u8; 32], AppError> {
    bytes
        .try_into()
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Invalid 32-byte key"))
}

fn to_fixed_12(bytes: &[u8]) -> Result<[u8; 12], AppError> {
    bytes
        .try_into()
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Invalid 12-byte nonce"))
}

fn to_fixed_48(bytes: &[u8]) -> Result<[u8; 48], AppError> {
    bytes
        .try_into()
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Invalid 48-byte wrapped key"))
}

fn to_fixed_64(bytes: &[u8]) -> Result<[u8; 64], AppError> {
    bytes
        .try_into()
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Invalid 64-byte signature"))
}

/// Ensures cached epoch keys exist in active DPAPI session by unwrapping any missing keys from Supabase.
pub async fn ensure_epoch_key(
    state: &AppState,
    conversation_id: Uuid,
    epoch: i32,
) -> Result<[u8; 32], AppError> {
    let mut sess = state.ensure_active_session().await?;
    let ck = epoch_cache_key(conversation_id, epoch);
    if let Some(key) = sess.cached_epoch_keys.get(&ck) {
        return Ok(*key);
    }

    let key_rows = state
        .supabase
        .list_member_keys_for_recipient(&sess.supabase_access_token, conversation_id, sess.user_id)
        .await?;

    let mut target_key: Option<[u8; 32]> = None;
    for row in key_rows {
        let distributor = state
            .supabase
            .get_profile(&sess.supabase_access_token, row.distributor_id)
            .await?;
        let dist_sign_pub = to_fixed_32(&distributor.public_sign_key)?;
        let bundle = WrappedEpochKeyBundle {
            ephemeral_pub_key: to_fixed_32(&row.ephemeral_pub_key)?,
            nonce: to_fixed_12(&row.nonce)?,
            wrapped_key: to_fixed_48(&row.wrapped_key)?,
            signature: to_fixed_64(&row.signature)?,
        };
        if let Ok(unwrapped) = unwrap_epoch_key_for_recipient(
            conversation_id,
            row.epoch,
            sess.user_id,
            &sess.x25519_private_key,
            row.distributor_id,
            &dist_sign_pub,
            &bundle,
        ) {
            sess.cached_epoch_keys
                .insert(epoch_cache_key(conversation_id, row.epoch), *unwrapped);
            if row.epoch == epoch {
                target_key = Some(*unwrapped);
            }
        }
    }

    let _ = save_session_to_path(&state.session_path, &sess);
    *state.session.lock().expect("session mutex") = Some(sess);

    target_key.ok_or_else(|| {
        AppError::new(
            "EPOCH_KEY_UNAVAILABLE",
            "Encryption key for this conversation epoch is unavailable.",
        )
    })
}

pub async fn load_conversation_dto(
    state: &AppState,
    conversation_id: Uuid,
) -> Result<ConversationDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let convs = state
        .supabase
        .list_conversations_for_user(&sess.supabase_access_token, sess.user_id)
        .await?;
    let conv = convs
        .into_iter()
        .find(|c| c.id == conversation_id)
        .ok_or_else(|| AppError::new("NOT_FOUND", "Conversation not found"))?;
    build_conversation_dto(state, conv).await
}

async fn build_conversation_dto(
    state: &AppState,
    conv: ConversationRow,
) -> Result<ConversationDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let member_rows = state
        .supabase
        .list_conversation_members(&sess.supabase_access_token, conv.id)
        .await?;

    let mut members = Vec::with_capacity(member_rows.len());
    for mr in member_rows {
        let profile = state
            .supabase
            .get_profile(&sess.supabase_access_token, mr.user_id)
            .await?;
        let avatar_url =
            resolve_avatar_data_url(state, &sess.supabase_access_token, &profile.avatar_path).await;
        members.push(ConversationMemberDto {
            user_id: mr.user_id.to_string(),
            username: profile.username,
            display_name: profile.display_name,
            avatar_url,
            is_online: state.realtime.is_user_online(mr.user_id),
            is_host: conv.host_id == Some(mr.user_id),
            joined_at: mr.joined_at,
        });
    }

    let latest_msgs = state
        .supabase
        .list_messages(&sess.supabase_access_token, conv.id, 100, None)
        .await?;
    let reads = state
        .supabase
        .list_message_reads(&sess.supabase_access_token, conv.id)
        .await?;

    let unread_count = latest_msgs
        .iter()
        .filter(|m| {
            m.sender_id != sess.user_id
                && !m.is_removed
                && !reads
                    .iter()
                    .any(|r| r.message_id == m.id && r.user_id == sess.user_id)
        })
        .count() as u32;

    let mut latest_preview: Option<String> = None;
    let mut latest_timestamp = None;
    if let Some(last) = latest_msgs.last() {
        latest_timestamp = Some(last.created_at);
        if last.is_removed {
            latest_preview = Some("Message removed".to_string());
        } else if let (Some(nonce), Some(ct), Some(sig)) =
            (&last.nonce, &last.ciphertext, &last.signature)
        {
            if let (Ok(ep_key), Ok(sender_prof)) = (
                ensure_epoch_key(state, conv.id, last.epoch).await,
                state
                    .supabase
                    .get_profile(&sess.supabase_access_token, last.sender_id)
                    .await,
            ) {
                if let Ok(sender_sign) = to_fixed_32(&sender_prof.public_sign_key) {
                    match verify_and_decrypt_message(
                        conv.id,
                        last.id,
                        last.epoch,
                        &ep_key,
                        &sender_sign,
                        nonce,
                        ct,
                        sig,
                    ) {
                        Ok(env) => {
                            latest_preview = env.text.or_else(|| {
                                env.attachment
                                    .as_ref()
                                    .map(|a| format!("[{}]", a.file_name))
                            });
                        }
                        Err(DecryptionStatus::VerificationFailed) => {
                            latest_preview = Some("Verification failed — content blocked".to_string());
                        }
                        Err(_) => {}
                    }
                }
            }
        }
    }

    Ok(ConversationDto {
        id: conv.id.to_string(),
        is_group: conv.is_group,
        name: conv.name,
        host_id: conv.host_id.map(|id| id.to_string()),
        current_epoch: conv.current_epoch,
        members,
        latest_preview,
        latest_timestamp,
        unread_count,
        updated_at: conv.updated_at,
    })
}

pub async fn conversation_list_core(state: &AppState) -> Result<Vec<ConversationDto>, AppError> {
    let sess = state.ensure_active_session().await?;
    let convs = state
        .supabase
        .list_conversations_for_user(&sess.supabase_access_token, sess.user_id)
        .await?;
    let mut out = Vec::with_capacity(convs.len());
    for c in convs {
        out.push(build_conversation_dto(state, c).await?);
    }
    Ok(out)
}

pub async fn conversation_start_direct_core(
    state: &AppState,
    contact_user_id: &str,
) -> Result<ConversationDto, AppError> {
    let mut sess = state.ensure_active_session().await?;
    let target_id = Uuid::parse_str(contact_user_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid contact user ID"))?;

    let contacts = state
        .supabase
        .list_contacts(&sess.supabase_access_token, sess.user_id)
        .await?;
    let target_profile = contacts
        .into_iter()
        .find(|c| c.id == target_id)
        .ok_or_else(|| {
            AppError::new(
                "CONTACT_REQUIRED",
                "Add this user as a contact by username first.",
            )
        })?;

    let dpk = direct_pair_key(sess.user_id, target_id);
    if let Some(existing) = state
        .supabase
        .find_direct_conversation(&sess.supabase_access_token, &dpk)
        .await?
    {
        return build_conversation_dto(state, existing).await;
    }

    let now = Utc::now();
    let conv_id = Uuid::new_v4();
    let conv = ConversationRow {
        id: conv_id,
        is_group: false,
        name: None,
        direct_pair_key: Some(dpk),
        host_id: None,
        current_epoch: 1,
        created_at: now,
        updated_at: now,
    };

    let members = vec![
        ConversationMemberRow {
            conversation_id: conv_id,
            user_id: sess.user_id,
            joined_at: now,
            added_by: sess.user_id,
        },
        ConversationMemberRow {
            conversation_id: conv_id,
            user_id: target_id,
            joined_at: now,
            added_by: sess.user_id,
        },
    ];

    let self_profile = state
        .supabase
        .get_profile(&sess.supabase_access_token, sess.user_id)
        .await?;
    let epoch_key = generate_epoch_key();

    let mut wrapped_rows = Vec::with_capacity(2);
    for recipient in [&self_profile, &target_profile] {
        let rec_pub = to_fixed_32(&recipient.public_enc_key)?;
        let bundle = wrap_epoch_key_for_recipient(
            conv_id,
            1,
            &epoch_key,
            recipient.id,
            &rec_pub,
            sess.user_id,
            &sess.ed25519_private_key,
        )
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Epoch key wrapping failed"))?;

        wrapped_rows.push(ConversationMemberKeyRow {
            conversation_id: conv_id,
            epoch: 1,
            recipient_id: recipient.id,
            distributor_id: sess.user_id,
            ephemeral_pub_key: bundle.ephemeral_pub_key.to_vec(),
            nonce: bundle.nonce.to_vec(),
            wrapped_key: bundle.wrapped_key.to_vec(),
            signature: bundle.signature.to_vec(),
            created_at: now,
        });
    }

    let saved = state
        .supabase
        .create_conversation(&sess.supabase_access_token, &conv, &members, &wrapped_rows)
        .await?;

    sess.cached_epoch_keys
        .insert(epoch_cache_key(saved.id, 1), *epoch_key);
    let _ = save_session_to_path(&state.session_path, &sess);
    *state.session.lock().expect("session mutex") = Some(sess);

    build_conversation_dto(state, saved).await
}

pub async fn conversation_create_group_core(
    state: &AppState,
    name: &str,
    member_user_ids: Vec<String>,
) -> Result<ConversationDto, AppError> {
    let mut sess = state.ensure_active_session().await?;
    let group_name = validate_group_name(name)?;

    let contacts = state
        .supabase
        .list_contacts(&sess.supabase_access_token, sess.user_id)
        .await?;

    let mut unique_ids = vec![sess.user_id];
    for id_str in member_user_ids {
        let uid = Uuid::parse_str(&id_str)
            .map_err(|_| AppError::new("INVALID_ID", "Invalid member user ID"))?;
        if uid != sess.user_id && !unique_ids.contains(&uid) {
            if !contacts.iter().any(|c| c.id == uid) {
                return Err(AppError::new(
                    "CONTACT_REQUIRED",
                    "All group members must be in your contacts.",
                ));
            }
            unique_ids.push(uid);
        }
    }

    if unique_ids.len() > MAX_GROUP_MEMBERS {
        return Err(AppError::new(
            "GROUP_LIMIT_EXCEEDED",
            "Group chats support up to 100 members.",
        ));
    }

    let now = Utc::now();
    let conv_id = Uuid::new_v4();
    let conv = ConversationRow {
        id: conv_id,
        is_group: true,
        name: Some(group_name),
        direct_pair_key: None,
        host_id: Some(sess.user_id),
        current_epoch: 1,
        created_at: now,
        updated_at: now,
    };

    let members: Vec<ConversationMemberRow> = unique_ids
        .iter()
        .map(|uid| ConversationMemberRow {
            conversation_id: conv_id,
            user_id: *uid,
            joined_at: now,
            added_by: sess.user_id,
        })
        .collect();

    let epoch_key = generate_epoch_key();
    let mut wrapped_rows = Vec::with_capacity(unique_ids.len());
    for uid in unique_ids {
        let prof = state
            .supabase
            .get_profile(&sess.supabase_access_token, uid)
            .await?;
        let rec_pub = to_fixed_32(&prof.public_enc_key)?;
        let bundle = wrap_epoch_key_for_recipient(
            conv_id,
            1,
            &epoch_key,
            uid,
            &rec_pub,
            sess.user_id,
            &sess.ed25519_private_key,
        )
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Epoch key wrapping failed"))?;

        wrapped_rows.push(ConversationMemberKeyRow {
            conversation_id: conv_id,
            epoch: 1,
            recipient_id: uid,
            distributor_id: sess.user_id,
            ephemeral_pub_key: bundle.ephemeral_pub_key.to_vec(),
            nonce: bundle.nonce.to_vec(),
            wrapped_key: bundle.wrapped_key.to_vec(),
            signature: bundle.signature.to_vec(),
            created_at: now,
        });
    }

    let saved = state
        .supabase
        .create_conversation(&sess.supabase_access_token, &conv, &members, &wrapped_rows)
        .await?;

    sess.cached_epoch_keys
        .insert(epoch_cache_key(saved.id, 1), *epoch_key);
    let _ = save_session_to_path(&state.session_path, &sess);
    *state.session.lock().expect("session mutex") = Some(sess);

    build_conversation_dto(state, saved).await
}

pub async fn conversation_rename_group_core(
    state: &AppState,
    conversation_id: &str,
    name: &str,
) -> Result<ConversationDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let cid = Uuid::parse_str(conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;
    let valid_name = validate_group_name(name)?;

    let updated = state
        .supabase
        .rename_group(&sess.supabase_access_token, cid, &valid_name)
        .await?;
    build_conversation_dto(state, updated).await
}

pub async fn conversation_add_group_member_core(
    state: &AppState,
    conversation_id: &str,
    contact_user_id: &str,
) -> Result<ConversationDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let cid = Uuid::parse_str(conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;
    let target_id = Uuid::parse_str(contact_user_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid contact user ID"))?;

    let convs = state
        .supabase
        .list_conversations_for_user(&sess.supabase_access_token, sess.user_id)
        .await?;
    let conv = convs
        .into_iter()
        .find(|c| c.id == cid && c.is_group)
        .ok_or_else(|| AppError::new("NOT_FOUND", "Group conversation not found"))?;

    let existing_members = state
        .supabase
        .list_conversation_members(&sess.supabase_access_token, cid)
        .await?;
    if existing_members.len() >= MAX_GROUP_MEMBERS {
        return Err(AppError::new(
            "GROUP_LIMIT_EXCEEDED",
            "Group chats support up to 100 members.",
        ));
    }

    let contacts = state
        .supabase
        .list_contacts(&sess.supabase_access_token, sess.user_id)
        .await?;
    let target_profile = contacts
        .into_iter()
        .find(|c| c.id == target_id)
        .ok_or_else(|| {
            AppError::new(
                "CONTACT_REQUIRED",
                "Only contacts can be added to a group.",
            )
        })?;

    let target_pub = to_fixed_32(&target_profile.public_enc_key)?;
    let now = Utc::now();

    // Grant all historical epoch keys 1..=current_epoch so the new member decrypts full history (FR-008).
    let mut historical_keys = Vec::with_capacity(conv.current_epoch as usize);
    for epoch in 1..=conv.current_epoch {
        if let Ok(ep_key) = ensure_epoch_key(state, cid, epoch).await {
            let bundle = wrap_epoch_key_for_recipient(
                cid,
                epoch,
                &ep_key,
                target_id,
                &target_pub,
                sess.user_id,
                &sess.ed25519_private_key,
            )
            .map_err(|_| AppError::new("CRYPTO_ERROR", "Historical key wrapping failed"))?;

            historical_keys.push(ConversationMemberKeyRow {
                conversation_id: cid,
                epoch,
                recipient_id: target_id,
                distributor_id: sess.user_id,
                ephemeral_pub_key: bundle.ephemeral_pub_key.to_vec(),
                nonce: bundle.nonce.to_vec(),
                wrapped_key: bundle.wrapped_key.to_vec(),
                signature: bundle.signature.to_vec(),
                created_at: now,
            });
        }
    }

    let member_row = ConversationMemberRow {
        conversation_id: cid,
        user_id: target_id,
        joined_at: now,
        added_by: sess.user_id,
    };

    state
        .supabase
        .add_group_member_with_keys(&sess.supabase_access_token, member_row, historical_keys)
        .await?;

    load_conversation_dto(state, cid).await
}

async fn rotate_epoch_and_remove(
    state: &AppState,
    cid: Uuid,
    target_user_id: Uuid,
) -> Result<Option<ConversationDto>, AppError> {
    let mut sess = state.ensure_active_session().await?;
    let convs = state
        .supabase
        .list_conversations_for_user(&sess.supabase_access_token, sess.user_id)
        .await?;
    let conv = convs
        .into_iter()
        .find(|c| c.id == cid && c.is_group)
        .ok_or_else(|| AppError::new("NOT_FOUND", "Group conversation not found"))?;

    if target_user_id != sess.user_id && conv.host_id != Some(sess.user_id) {
        return Err(AppError::new(
            "FORBIDDEN",
            "Only the group host can remove other members.",
        ));
    }

    let members = state
        .supabase
        .list_conversation_members(&sess.supabase_access_token, cid)
        .await?;
    let remaining: Vec<_> = members
        .into_iter()
        .filter(|m| m.user_id != target_user_id)
        .collect();

    let new_epoch = conv.current_epoch + 1;
    let new_epoch_key = generate_epoch_key();
    let mut wrapped_items = Vec::with_capacity(remaining.len());

    for rem in &remaining {
        let prof = state
            .supabase
            .get_profile(&sess.supabase_access_token, rem.user_id)
            .await?;
        let pub_key = to_fixed_32(&prof.public_enc_key)?;
        let bundle = wrap_epoch_key_for_recipient(
            cid,
            new_epoch,
            &new_epoch_key,
            rem.user_id,
            &pub_key,
            sess.user_id,
            &sess.ed25519_private_key,
        )
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Epoch rotation key wrapping failed"))?;

        wrapped_items.push(WrappedKeyRpcItem {
            recipient_id: rem.user_id,
            ephemeral_pub_key_b64: B64.encode(bundle.ephemeral_pub_key),
            nonce_b64: B64.encode(bundle.nonce),
            wrapped_key_b64: B64.encode(bundle.wrapped_key),
            signature_b64: B64.encode(bundle.signature),
        });
    }

    state
        .supabase
        .rpc_remove_or_leave_group_member(
            &sess.supabase_access_token,
            sess.user_id,
            cid,
            target_user_id,
            new_epoch,
            &wrapped_items,
        )
        .await?;

    if target_user_id == sess.user_id || remaining.is_empty() {
        return Ok(None);
    }

    sess.cached_epoch_keys
        .insert(epoch_cache_key(cid, new_epoch), *new_epoch_key);
    let _ = save_session_to_path(&state.session_path, &sess);
    *state.session.lock().expect("session mutex") = Some(sess);

    Ok(Some(load_conversation_dto(state, cid).await?))
}

pub async fn conversation_remove_group_member_core(
    state: &AppState,
    conversation_id: &str,
    target_user_id: &str,
) -> Result<ConversationDto, AppError> {
    let cid = Uuid::parse_str(conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;
    let tid = Uuid::parse_str(target_user_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid target user ID"))?;

    rotate_epoch_and_remove(state, cid, tid)
        .await?
        .ok_or_else(|| AppError::new("GROUP_CLOSED", "Group closed"))
}

pub async fn conversation_leave_group_core(
    state: &AppState,
    conversation_id: &str,
) -> Result<(), AppError> {
    let sess = state.ensure_active_session().await?;
    let cid = Uuid::parse_str(conversation_id)
        .map_err(|_| AppError::new("INVALID_ID", "Invalid conversation ID"))?;
    let _ = rotate_epoch_and_remove(state, cid, sess.user_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn conversation_list(
    state: State<'_, AppState>,
) -> Result<Vec<ConversationDto>, AppError> {
    conversation_list_core(&state).await
}

#[tauri::command]
pub async fn conversation_start_direct<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    contact_user_id: String,
) -> Result<ConversationDto, AppError> {
    let dto = conversation_start_direct_core(&state, &contact_user_id).await?;
    let _ = app.emit("realtime:conversation_updated", &dto);
    Ok(dto)
}

#[tauri::command]
pub async fn conversation_create_group<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    name: String,
    member_user_ids: Vec<String>,
) -> Result<ConversationDto, AppError> {
    let dto = conversation_create_group_core(&state, &name, member_user_ids).await?;
    let _ = app.emit("realtime:conversation_updated", &dto);
    Ok(dto)
}

#[tauri::command]
pub async fn conversation_rename_group<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    conversation_id: String,
    name: String,
) -> Result<ConversationDto, AppError> {
    let dto = conversation_rename_group_core(&state, &conversation_id, &name).await?;
    let _ = app.emit("realtime:conversation_updated", &dto);
    Ok(dto)
}

#[tauri::command]
pub async fn conversation_add_group_member<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    conversation_id: String,
    contact_user_id: String,
) -> Result<ConversationDto, AppError> {
    let dto =
        conversation_add_group_member_core(&state, &conversation_id, &contact_user_id).await?;
    let _ = app.emit("realtime:conversation_updated", &dto);
    Ok(dto)
}

#[tauri::command]
pub async fn conversation_remove_group_member<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    conversation_id: String,
    target_user_id: String,
) -> Result<ConversationDto, AppError> {
    let dto =
        conversation_remove_group_member_core(&state, &conversation_id, &target_user_id).await?;
    let _ = app.emit("realtime:conversation_updated", &dto);
    Ok(dto)
}

#[tauri::command]
pub async fn conversation_leave_group(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), AppError> {
    conversation_leave_group_core(&state, &conversation_id).await
}
