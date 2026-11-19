use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    ConversationMemberKeyRow, ConversationMemberRow, ConversationRow, MessageReadRow, MessageRow,
    PinnedMessageRow, ProfileRow, SupabaseClient, SupabaseError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedKeyRpcItem {
    pub recipient_id: Uuid,
    pub ephemeral_pub_key_b64: String,
    pub nonce_b64: String,
    pub wrapped_key_b64: String,
    pub signature_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteProfileDto {
    id: Uuid,
    username: String,
    display_name: String,
    avatar_path: Option<String>,
    public_enc_key: String,
    public_sign_key: String,
    wrapped_priv_keys: String,
    kdf_salt: String,
    created_at: chrono::DateTime<Utc>,
    updated_at: chrono::DateTime<Utc>,
}

fn pg_bytea_to_vec(hex_or_b64: &str) -> Result<Vec<u8>, SupabaseError> {
    if let Some(stripped) = hex_or_b64.strip_prefix("\\x") {
        hex::decode(stripped).map_err(|_| SupabaseError::InvalidResponse)
    } else {
        B64.decode(hex_or_b64).map_err(|_| SupabaseError::InvalidResponse)
    }
}

fn vec_to_pg_bytea(bytes: &[u8]) -> String {
    format!("\\x{}", hex::encode(bytes))
}

impl TryFrom<RemoteProfileDto> for ProfileRow {
    type Error = SupabaseError;

    fn try_from(value: RemoteProfileDto) -> Result<Self, Self::Error> {
        Ok(Self {
            id: value.id,
            username: value.username,
            display_name: value.display_name,
            avatar_path: value.avatar_path,
            public_enc_key: pg_bytea_to_vec(&value.public_enc_key)?,
            public_sign_key: pg_bytea_to_vec(&value.public_sign_key)?,
            wrapped_priv_keys: pg_bytea_to_vec(&value.wrapped_priv_keys)?,
            kdf_salt: pg_bytea_to_vec(&value.kdf_salt)?,
            created_at: value.created_at,
            updated_at: value.updated_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteMessageDto {
    id: Uuid,
    conversation_id: Uuid,
    sender_id: Uuid,
    epoch: i32,
    nonce: Option<String>,
    ciphertext: Option<String>,
    signature: Option<String>,
    media_object_path: Option<String>,
    is_edited: bool,
    edited_at: Option<chrono::DateTime<Utc>>,
    is_removed: bool,
    removed_at: Option<chrono::DateTime<Utc>>,
    created_at: chrono::DateTime<Utc>,
}

impl TryFrom<RemoteMessageDto> for MessageRow {
    type Error = SupabaseError;

    fn try_from(v: RemoteMessageDto) -> Result<Self, Self::Error> {
        Ok(Self {
            id: v.id,
            conversation_id: v.conversation_id,
            sender_id: v.sender_id,
            epoch: v.epoch,
            nonce: v.nonce.as_deref().map(pg_bytea_to_vec).transpose()?,
            ciphertext: v.ciphertext.as_deref().map(pg_bytea_to_vec).transpose()?,
            signature: v.signature.as_deref().map(pg_bytea_to_vec).transpose()?,
            media_object_path: v.media_object_path,
            is_edited: v.is_edited,
            edited_at: v.edited_at,
            is_removed: v.is_removed,
            removed_at: v.removed_at,
            created_at: v.created_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteKeyDto {
    conversation_id: Uuid,
    epoch: i32,
    recipient_id: Uuid,
    distributor_id: Uuid,
    ephemeral_pub_key: String,
    nonce: String,
    wrapped_key: String,
    signature: String,
    created_at: chrono::DateTime<Utc>,
}

impl TryFrom<RemoteKeyDto> for ConversationMemberKeyRow {
    type Error = SupabaseError;

    fn try_from(v: RemoteKeyDto) -> Result<Self, Self::Error> {
        Ok(Self {
            conversation_id: v.conversation_id,
            epoch: v.epoch,
            recipient_id: v.recipient_id,
            distributor_id: v.distributor_id,
            ephemeral_pub_key: pg_bytea_to_vec(&v.ephemeral_pub_key)?,
            nonce: pg_bytea_to_vec(&v.nonce)?,
            wrapped_key: pg_bytea_to_vec(&v.wrapped_key)?,
            signature: pg_bytea_to_vec(&v.signature)?,
            created_at: v.created_at,
        })
    }
}

impl SupabaseClient {
    pub async fn insert_profile(
        &self,
        access_token: &str,
        profile: &ProfileRow,
    ) -> Result<(), SupabaseError> {
        if let Some(cfg) = &self.config {
            let body = serde_json::json!({
                "id": profile.id,
                "username": profile.username,
                "display_name": profile.display_name,
                "avatar_path": profile.avatar_path,
                "public_enc_key": vec_to_pg_bytea(&profile.public_enc_key),
                "public_sign_key": vec_to_pg_bytea(&profile.public_sign_key),
                "wrapped_priv_keys": vec_to_pg_bytea(&profile.wrapped_priv_keys),
                "kdf_salt": vec_to_pg_bytea(&profile.kdf_salt),
            });
            let resp = self
                .http
                .post(format!("{}/rest/v1/profiles", cfg.url))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .json(&body)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::Conflict("profile creation failed"));
            }
            return Ok(());
        }

        let mut store = self.local_store.lock().expect("local store lock");
        store.profiles.insert(profile.id, profile.clone());
        Ok(())
    }

    pub async fn get_profile(
        &self,
        access_token: &str,
        user_id: Uuid,
    ) -> Result<ProfileRow, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .get(format!("{}/rest/v1/profiles?id=eq.{}", cfg.url, user_id))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::NotFound("profile"));
            }
            let mut rows: Vec<RemoteProfileDto> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            let row = rows.pop().ok_or(SupabaseError::NotFound("profile"))?;
            return row.try_into();
        }

        let store = self.local_store.lock().expect("local store lock");
        store
            .profiles
            .get(&user_id)
            .cloned()
            .ok_or(SupabaseError::NotFound("profile"))
    }

    pub async fn update_profile(
        &self,
        access_token: &str,
        user_id: Uuid,
        display_name: Option<&str>,
        avatar_path: Option<&str>,
    ) -> Result<ProfileRow, SupabaseError> {
        if let Some(cfg) = &self.config {
            let mut patch = serde_json::Map::new();
            if let Some(dn) = display_name {
                patch.insert("display_name".into(), serde_json::json!(dn));
            }
            if let Some(ap) = avatar_path {
                patch.insert("avatar_path".into(), serde_json::json!(ap));
            }
            patch.insert("updated_at".into(), serde_json::json!(Utc::now()));

            let resp = self
                .http
                .patch(format!("{}/rest/v1/profiles?id=eq.{}", cfg.url, user_id))
                .header("apikey", &cfg.anon_key)
                .header("Prefer", "return=representation")
                .bearer_auth(access_token)
                .json(&patch)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            let mut rows: Vec<RemoteProfileDto> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            let row = rows.pop().ok_or(SupabaseError::NotFound("profile"))?;
            return row.try_into();
        }

        let mut store = self.local_store.lock().expect("local store lock");
        let prof = store
            .profiles
            .get_mut(&user_id)
            .ok_or(SupabaseError::NotFound("profile"))?;
        if let Some(dn) = display_name {
            prof.display_name = dn.to_string();
        }
        if let Some(ap) = avatar_path {
            prof.avatar_path = Some(ap.to_string());
        }
        prof.updated_at = Utc::now();
        Ok(prof.clone())
    }

    pub async fn rpc_add_mutual_contact(
        &self,
        access_token: &str,
        caller_id: Uuid,
        target_username: &str,
    ) -> Result<ProfileRow, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .post(format!("{}/rest/v1/rpc/add_mutual_contact", cfg.url))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .json(&serde_json::json!({ "target_username": target_username }))
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if resp.status().as_u16() == 404 {
                return Err(SupabaseError::NotFound("No user found"));
            }
            if !resp.status().is_success() {
                let text = resp.text().await.unwrap_or_default();
                if text.contains("USER_NOT_FOUND") {
                    return Err(SupabaseError::NotFound("No user found"));
                }
                if text.contains("CANNOT_ADD_SELF") {
                    return Err(SupabaseError::Conflict("cannot add yourself as a contact"));
                }
                return Err(SupabaseError::InvalidResponse);
            }
            let dto: RemoteProfileDto = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            return dto.try_into();
        }

        let mut store = self.local_store.lock().expect("local store lock");
        let normalized = target_username.trim().to_ascii_lowercase();
        let target = store
            .profiles
            .values()
            .find(|p| p.username.to_ascii_lowercase() == normalized)
            .cloned()
            .ok_or(SupabaseError::NotFound("No user found"))?;

        if target.id == caller_id {
            return Err(SupabaseError::Conflict("cannot add yourself as a contact"));
        }

        let entry_a = store.contacts.entry(caller_id).or_default();
        if !entry_a.contains(&target.id) {
            entry_a.push(target.id);
        }
        let entry_b = store.contacts.entry(target.id).or_default();
        if !entry_b.contains(&caller_id) {
            entry_b.push(caller_id);
        }
        Ok(target)
    }

    pub async fn list_contacts(
        &self,
        access_token: &str,
        caller_id: Uuid,
    ) -> Result<Vec<ProfileRow>, SupabaseError> {
        if let Some(cfg) = &self.config {
            #[derive(Deserialize)]
            struct ContactJoin {
                contact_id: Uuid,
            }
            let resp = self
                .http
                .get(format!(
                    "{}/rest/v1/contacts?user_id=eq.{}&select=contact_id",
                    cfg.url, caller_id
                ))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            let joins: Vec<ContactJoin> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            if joins.is_empty() {
                return Ok(vec![]);
            }
            let ids: Vec<String> = joins.iter().map(|j| j.contact_id.to_string()).collect();
            let resp2 = self
                .http
                .get(format!(
                    "{}/rest/v1/profiles?id=in.({})",
                    cfg.url,
                    ids.join(",")
                ))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            let rows: Vec<RemoteProfileDto> = resp2
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            return rows.into_iter().map(TryInto::try_into).collect();
        }

        let store = self.local_store.lock().expect("local store lock");
        let ids = store.contacts.get(&caller_id).cloned().unwrap_or_default();
        Ok(ids
            .into_iter()
            .filter_map(|id| store.profiles.get(&id).cloned())
            .collect())
    }

    pub async fn create_conversation(
        &self,
        access_token: &str,
        conv: &ConversationRow,
        members: &[ConversationMemberRow],
        keys: &[ConversationMemberKeyRow],
    ) -> Result<ConversationRow, SupabaseError> {
        if let Some(cfg) = &self.config {
            let conv_body = serde_json::json!({
                "id": conv.id,
                "is_group": conv.is_group,
                "name": conv.name,
                "direct_pair_key": conv.direct_pair_key,
                "host_id": conv.host_id,
                "current_epoch": conv.current_epoch,
            });
            let resp = self
                .http
                .post(format!("{}/rest/v1/conversations", cfg.url))
                .header("apikey", &cfg.anon_key)
                .header("Prefer", "return=representation")
                .bearer_auth(access_token)
                .json(&conv_body)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::Conflict("conversation creation failed"));
            }
            let mut created: Vec<ConversationRow> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            let saved_conv = created.pop().ok_or(SupabaseError::InvalidResponse)?;

            let member_bodies: Vec<_> = members
                .iter()
                .map(|m| {
                    serde_json::json!({
                        "conversation_id": saved_conv.id,
                        "user_id": m.user_id,
                        "added_by": m.added_by,
                    })
                })
                .collect();
            let resp_m = self
                .http
                .post(format!("{}/rest/v1/conversation_members", cfg.url))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .json(&member_bodies)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp_m.status().is_success() {
                return Err(SupabaseError::Forbidden("cannot add member"));
            }

            let key_bodies: Vec<_> = keys
                .iter()
                .map(|k| {
                    serde_json::json!({
                        "conversation_id": saved_conv.id,
                        "epoch": k.epoch,
                        "recipient_id": k.recipient_id,
                        "distributor_id": k.distributor_id,
                        "ephemeral_pub_key": vec_to_pg_bytea(&k.ephemeral_pub_key),
                        "nonce": vec_to_pg_bytea(&k.nonce),
                        "wrapped_key": vec_to_pg_bytea(&k.wrapped_key),
                        "signature": vec_to_pg_bytea(&k.signature),
                    })
                })
                .collect();
            let resp_k = self
                .http
                .post(format!("{}/rest/v1/conversation_member_keys", cfg.url))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .json(&key_bodies)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp_k.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            return Ok(saved_conv);
        }

        let mut store = self.local_store.lock().expect("local store lock");
        if let Some(dpk) = &conv.direct_pair_key {
            if let Some(existing) = store
                .conversations
                .values()
                .find(|c| c.direct_pair_key.as_deref() == Some(dpk.as_str()))
                .cloned()
            {
                return Ok(existing);
            }
        }
        store.conversations.insert(conv.id, conv.clone());
        store.members.extend(members.iter().cloned());
        store.member_keys.extend(keys.iter().cloned());
        Ok(conv.clone())
    }

    pub async fn find_direct_conversation(
        &self,
        access_token: &str,
        direct_pair_key: &str,
    ) -> Result<Option<ConversationRow>, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .get(format!(
                    "{}/rest/v1/conversations?direct_pair_key=eq.{}",
                    cfg.url, direct_pair_key
                ))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            let mut rows: Vec<ConversationRow> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            return Ok(rows.pop());
        }

        let store = self.local_store.lock().expect("local store lock");
        Ok(store
            .conversations
            .values()
            .find(|c| c.direct_pair_key.as_deref() == Some(direct_pair_key))
            .cloned())
    }

    pub async fn list_conversations_for_user(
        &self,
        access_token: &str,
        user_id: Uuid,
    ) -> Result<Vec<ConversationRow>, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .get(format!("{}/rest/v1/conversations?order=updated_at.desc", cfg.url))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            return resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse);
        }

        let store = self.local_store.lock().expect("local store lock");
        let my_conv_ids: Vec<Uuid> = store
            .members
            .iter()
            .filter(|m| m.user_id == user_id)
            .map(|m| m.conversation_id)
            .collect();
        let mut convs: Vec<ConversationRow> = store
            .conversations
            .values()
            .filter(|c| my_conv_ids.contains(&c.id))
            .cloned()
            .collect();
        convs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(convs)
    }

    pub async fn list_conversation_members(
        &self,
        access_token: &str,
        conversation_id: Uuid,
    ) -> Result<Vec<ConversationMemberRow>, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .get(format!(
                    "{}/rest/v1/conversation_members?conversation_id=eq.{}&order=joined_at.asc,user_id.asc",
                    cfg.url, conversation_id
                ))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            return resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse);
        }

        let store = self.local_store.lock().expect("local store lock");
        let mut rows: Vec<_> = store
            .members
            .iter()
            .filter(|m| m.conversation_id == conversation_id)
            .cloned()
            .collect();
        rows.sort_by(|a, b| a.joined_at.cmp(&b.joined_at).then(a.user_id.cmp(&b.user_id)));
        Ok(rows)
    }

    pub async fn list_member_keys_for_recipient(
        &self,
        access_token: &str,
        conversation_id: Uuid,
        recipient_id: Uuid,
    ) -> Result<Vec<ConversationMemberKeyRow>, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .get(format!(
                    "{}/rest/v1/conversation_member_keys?conversation_id=eq.{}&recipient_id=eq.{}&order=epoch.asc",
                    cfg.url, conversation_id, recipient_id
                ))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            let dtos: Vec<RemoteKeyDto> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            return dtos.into_iter().map(TryInto::try_into).collect();
        }

        let store = self.local_store.lock().expect("local store lock");
        let mut rows: Vec<_> = store
            .member_keys
            .iter()
            .filter(|k| k.conversation_id == conversation_id && k.recipient_id == recipient_id)
            .cloned()
            .collect();
        rows.sort_by_key(|k| k.epoch);
        Ok(rows)
    }

    pub async fn rename_group(
        &self,
        access_token: &str,
        conversation_id: Uuid,
        new_name: &str,
    ) -> Result<ConversationRow, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .patch(format!("{}/rest/v1/conversations?id=eq.{}", cfg.url, conversation_id))
                .header("apikey", &cfg.anon_key)
                .header("Prefer", "return=representation")
                .bearer_auth(access_token)
                .json(&serde_json::json!({ "name": new_name, "updated_at": Utc::now() }))
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::Forbidden("cannot rename group"));
            }
            let mut rows: Vec<ConversationRow> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            return rows.pop().ok_or(SupabaseError::NotFound("conversation"));
        }

        let mut store = self.local_store.lock().expect("local store lock");
        let conv = store
            .conversations
            .get_mut(&conversation_id)
            .ok_or(SupabaseError::NotFound("conversation"))?;
        conv.name = Some(new_name.to_string());
        conv.updated_at = Utc::now();
        Ok(conv.clone())
    }

    pub async fn add_group_member_with_keys(
        &self,
        access_token: &str,
        member: ConversationMemberRow,
        historical_keys: Vec<ConversationMemberKeyRow>,
    ) -> Result<(), SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp_m = self
                .http
                .post(format!("{}/rest/v1/conversation_members", cfg.url))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .json(&serde_json::json!({
                    "conversation_id": member.conversation_id,
                    "user_id": member.user_id,
                    "added_by": member.added_by,
                }))
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp_m.status().is_success() {
                return Err(SupabaseError::Forbidden("cannot add member"));
            }

            let key_bodies: Vec<_> = historical_keys
                .iter()
                .map(|k| {
                    serde_json::json!({
                        "conversation_id": k.conversation_id,
                        "epoch": k.epoch,
                        "recipient_id": k.recipient_id,
                        "distributor_id": k.distributor_id,
                        "ephemeral_pub_key": vec_to_pg_bytea(&k.ephemeral_pub_key),
                        "nonce": vec_to_pg_bytea(&k.nonce),
                        "wrapped_key": vec_to_pg_bytea(&k.wrapped_key),
                        "signature": vec_to_pg_bytea(&k.signature),
                    })
                })
                .collect();
            let resp_k = self
                .http
                .post(format!("{}/rest/v1/conversation_member_keys", cfg.url))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .json(&key_bodies)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp_k.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            return Ok(());
        }

        let mut store = self.local_store.lock().expect("local store lock");
        if store
            .members
            .iter()
            .any(|m| m.conversation_id == member.conversation_id && m.user_id == member.user_id)
        {
            return Err(SupabaseError::Conflict("member already in group"));
        }
        store.members.push(member);
        store.member_keys.extend(historical_keys);
        Ok(())
    }

    pub async fn rpc_remove_or_leave_group_member(
        &self,
        access_token: &str,
        caller_id: Uuid,
        conversation_id: Uuid,
        target_user_id: Uuid,
        new_epoch: i32,
        new_wrapped_keys: &[WrappedKeyRpcItem],
    ) -> Result<(), SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .post(format!("{}/rest/v1/rpc/remove_or_leave_group_member", cfg.url))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .json(&serde_json::json!({
                    "conv_id": conversation_id,
                    "target_user_id": target_user_id,
                    "new_epoch": new_epoch,
                    "new_wrapped_keys": new_wrapped_keys,
                }))
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::Forbidden("cannot remove or leave member"));
            }
            return Ok(());
        }

        let mut store = self.local_store.lock().expect("local store lock");
        let conv = store
            .conversations
            .get(&conversation_id)
            .cloned()
            .ok_or(SupabaseError::NotFound("conversation"))?;
        if !conv.is_group {
            return Err(SupabaseError::Forbidden("not a group conversation"));
        }
        if caller_id != target_user_id && Some(caller_id) != conv.host_id {
            return Err(SupabaseError::Forbidden("only host can remove members"));
        }

        store
            .members
            .retain(|m| !(m.conversation_id == conversation_id && m.user_id == target_user_id));

        let mut remaining: Vec<_> = store
            .members
            .iter()
            .filter(|m| m.conversation_id == conversation_id)
            .cloned()
            .collect();

        if remaining.is_empty() {
            store.conversations.remove(&conversation_id);
            store.member_keys.retain(|k| k.conversation_id != conversation_id);
            store.messages.retain(|m| m.conversation_id != conversation_id);
            store.reads.retain(|r| r.conversation_id != conversation_id);
            store.pinned_messages.retain(|p| p.conversation_id != conversation_id);
            return Ok(());
        }

        remaining.sort_by(|a, b| a.joined_at.cmp(&b.joined_at).then(a.user_id.cmp(&b.user_id)));
        let next_host_id = if Some(target_user_id) == conv.host_id {
            Some(remaining[0].user_id)
        } else {
            conv.host_id
        };

        if new_epoch != conv.current_epoch + 1 {
            return Err(SupabaseError::Conflict("invalid epoch increment"));
        }

        if let Some(c) = store.conversations.get_mut(&conversation_id) {
            c.host_id = next_host_id;
            c.current_epoch = new_epoch;
            c.updated_at = Utc::now();
        }

        for item in new_wrapped_keys {
            store.member_keys.push(ConversationMemberKeyRow {
                conversation_id,
                epoch: new_epoch,
                recipient_id: item.recipient_id,
                distributor_id: caller_id,
                ephemeral_pub_key: B64
                    .decode(&item.ephemeral_pub_key_b64)
                    .map_err(|_| SupabaseError::InvalidResponse)?,
                nonce: B64
                    .decode(&item.nonce_b64)
                    .map_err(|_| SupabaseError::InvalidResponse)?,
                wrapped_key: B64
                    .decode(&item.wrapped_key_b64)
                    .map_err(|_| SupabaseError::InvalidResponse)?,
                signature: B64
                    .decode(&item.signature_b64)
                    .map_err(|_| SupabaseError::InvalidResponse)?,
                created_at: Utc::now(),
            });
        }
        Ok(())
    }

    pub async fn insert_message(
        &self,
        access_token: &str,
        msg: &MessageRow,
    ) -> Result<MessageRow, SupabaseError> {
        if let Some(cfg) = &self.config {
            let body = serde_json::json!({
                "id": msg.id,
                "conversation_id": msg.conversation_id,
                "sender_id": msg.sender_id,
                "epoch": msg.epoch,
                "nonce": msg.nonce.as_deref().map(vec_to_pg_bytea),
                "ciphertext": msg.ciphertext.as_deref().map(vec_to_pg_bytea),
                "signature": msg.signature.as_deref().map(vec_to_pg_bytea),
                "media_object_path": msg.media_object_path,
            });
            let resp = self
                .http
                .post(format!("{}/rest/v1/messages", cfg.url))
                .header("apikey", &cfg.anon_key)
                .header("Prefer", "return=representation")
                .bearer_auth(access_token)
                .json(&body)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::Forbidden("message send rejected"));
            }
            let mut rows: Vec<RemoteMessageDto> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            let row = rows.pop().ok_or(SupabaseError::InvalidResponse)?;
            return row.try_into();
        }

        let mut store = self.local_store.lock().expect("local store lock");
        store.messages.push(msg.clone());
        if let Some(conv) = store.conversations.get_mut(&msg.conversation_id) {
            conv.updated_at = msg.created_at;
        }
        Ok(msg.clone())
    }

    pub async fn list_messages(
        &self,
        access_token: &str,
        conversation_id: Uuid,
        limit: u32,
        before: Option<chrono::DateTime<Utc>>,
    ) -> Result<Vec<MessageRow>, SupabaseError> {
        let clamped_limit = limit.clamp(1, 100);
        if let Some(cfg) = &self.config {
            let mut url = format!(
                "{}/rest/v1/messages?conversation_id=eq.{}&order=created_at.desc&limit={}",
                cfg.url, conversation_id, clamped_limit
            );
            if let Some(b) = before {
                url.push_str(&format!("&created_at=lt.{}", b.to_rfc3339()));
            }
            let resp = self
                .http
                .get(&url)
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            let rows: Vec<RemoteMessageDto> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            let mut out: Vec<MessageRow> = rows
                .into_iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?;
            out.reverse();
            return Ok(out);
        }

        let store = self.local_store.lock().expect("local store lock");
        let mut msgs: Vec<MessageRow> = store
            .messages
            .iter()
            .filter(|m| m.conversation_id == conversation_id)
            .filter(|m| before.map(|b| m.created_at < b).unwrap_or(true))
            .cloned()
            .collect();
        msgs.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        if msgs.len() > clamped_limit as usize {
            msgs = msgs.split_off(msgs.len() - clamped_limit as usize);
        }
        Ok(msgs)
    }

    pub async fn get_message(
        &self,
        access_token: &str,
        message_id: Uuid,
    ) -> Result<MessageRow, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .get(format!("{}/rest/v1/messages?id=eq.{}", cfg.url, message_id))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::NotFound("message"));
            }
            let mut rows: Vec<RemoteMessageDto> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            let row = rows.pop().ok_or(SupabaseError::NotFound("message"))?;
            return row.try_into();
        }

        let store = self.local_store.lock().expect("local store lock");
        store
            .messages
            .iter()
            .find(|m| m.id == message_id)
            .cloned()
            .ok_or(SupabaseError::NotFound("message"))
    }

    pub async fn update_edited_message(
        &self,
        access_token: &str,
        caller_id: Uuid,
        message_id: Uuid,
        nonce: &[u8; 12],
        ciphertext: &[u8],
        signature: &[u8; 64],
    ) -> Result<MessageRow, SupabaseError> {
        if let Some(cfg) = &self.config {
            let patch = serde_json::json!({
                "nonce": vec_to_pg_bytea(nonce),
                "ciphertext": vec_to_pg_bytea(ciphertext),
                "signature": vec_to_pg_bytea(signature),
                "is_edited": true,
                "edited_at": Utc::now(),
            });
            let resp = self
                .http
                .patch(format!(
                    "{}/rest/v1/messages?id=eq.{}&sender_id=eq.{}&is_removed=eq.false",
                    cfg.url, message_id, caller_id
                ))
                .header("apikey", &cfg.anon_key)
                .header("Prefer", "return=representation")
                .bearer_auth(access_token)
                .json(&patch)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::Forbidden("cannot edit message"));
            }
            let mut rows: Vec<RemoteMessageDto> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            let row = rows.pop().ok_or(SupabaseError::Forbidden("cannot edit message"))?;
            return row.try_into();
        }

        let mut store = self.local_store.lock().expect("local store lock");
        let msg = store
            .messages
            .iter_mut()
            .find(|m| m.id == message_id)
            .ok_or(SupabaseError::NotFound("message"))?;
        if msg.sender_id != caller_id {
            return Err(SupabaseError::Forbidden("cannot edit another user's message"));
        }
        if msg.is_removed {
            return Err(SupabaseError::Conflict("cannot edit removed message"));
        }
        msg.nonce = Some(nonce.to_vec());
        msg.ciphertext = Some(ciphertext.to_vec());
        msg.signature = Some(signature.to_vec());
        msg.is_edited = true;
        msg.edited_at = Some(Utc::now());
        Ok(msg.clone())
    }

    pub async fn rpc_remove_sent_message(
        &self,
        access_token: &str,
        caller_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<String>, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .post(format!("{}/rest/v1/rpc/remove_sent_message", cfg.url))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .json(&serde_json::json!({ "msg_id": message_id }))
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::Forbidden("cannot remove message"));
            }
            let old_path: Option<String> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            return Ok(old_path);
        }

        let mut store = self.local_store.lock().expect("local store lock");
        let msg = store
            .messages
            .iter_mut()
            .find(|m| m.id == message_id)
            .ok_or(SupabaseError::NotFound("message"))?;
        if msg.sender_id != caller_id {
            return Err(SupabaseError::Forbidden("cannot remove another user's message"));
        }
        let old_path = msg.media_object_path.take();
        msg.ciphertext = None;
        msg.nonce = None;
        msg.signature = None;
        msg.media_object_path = None;
        msg.is_removed = true;
        msg.removed_at = Some(Utc::now());
        store.pinned_messages.retain(|p| p.message_id != message_id);
        Ok(old_path)
    }

    pub async fn upsert_message_reads(
        &self,
        access_token: &str,
        reads: &[MessageReadRow],
    ) -> Result<(), SupabaseError> {
        if reads.is_empty() {
            return Ok(());
        }
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .post(format!("{}/rest/v1/message_reads", cfg.url))
                .header("apikey", &cfg.anon_key)
                .header("Prefer", "resolution=merge-duplicates")
                .bearer_auth(access_token)
                .json(reads)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            return Ok(());
        }

        let mut store = self.local_store.lock().expect("local store lock");
        for row in reads {
            if !store.reads.iter().any(|r| {
                r.conversation_id == row.conversation_id
                    && r.message_id == row.message_id
                    && r.user_id == row.user_id
            }) {
                store.reads.push(row.clone());
            }
        }
        Ok(())
    }

    pub async fn list_message_reads(
        &self,
        access_token: &str,
        conversation_id: Uuid,
    ) -> Result<Vec<MessageReadRow>, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .get(format!(
                    "{}/rest/v1/message_reads?conversation_id=eq.{}",
                    cfg.url, conversation_id
                ))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            return resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse);
        }

        let store = self.local_store.lock().expect("local store lock");
        Ok(store
            .reads
            .iter()
            .filter(|r| r.conversation_id == conversation_id)
            .cloned()
            .collect())
    }

    pub async fn pin_message(
        &self,
        access_token: &str,
        caller_id: Uuid,
        conversation_id: Uuid,
        message_id: Uuid,
    ) -> Result<PinnedMessageRow, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .post(format!(
                    "{}/rest/v1/pinned_messages?on_conflict=conversation_id,message_id",
                    cfg.url
                ))
                .header("apikey", &cfg.anon_key)
                .header("Prefer", "resolution=merge-duplicates,return=representation")
                .bearer_auth(access_token)
                .json(&serde_json::json!({
                    "conversation_id": conversation_id,
                    "message_id": message_id,
                    "pinned_by": caller_id,
                }))
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::Forbidden("cannot pin message"));
            }
            let mut rows: Vec<PinnedMessageRow> = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            return rows.pop().ok_or(SupabaseError::InvalidResponse);
        }

        let mut store = self.local_store.lock().expect("local store lock");
        if !store
            .members
            .iter()
            .any(|m| m.conversation_id == conversation_id && m.user_id == caller_id)
        {
            return Err(SupabaseError::Forbidden("not a conversation member"));
        }
        let msg = store
            .messages
            .iter()
            .find(|m| m.id == message_id)
            .ok_or(SupabaseError::NotFound("message"))?;
        if msg.conversation_id != conversation_id {
            return Err(SupabaseError::Forbidden("message belongs to another conversation"));
        }
        if msg.is_removed {
            return Err(SupabaseError::Conflict("cannot pin removed message"));
        }
        let now = Utc::now();
        if let Some(existing) = store
            .pinned_messages
            .iter_mut()
            .find(|p| p.conversation_id == conversation_id && p.message_id == message_id)
        {
            existing.pinned_by = caller_id;
            existing.pinned_at = now;
            return Ok(existing.clone());
        }
        let row = PinnedMessageRow {
            conversation_id,
            message_id,
            pinned_by: caller_id,
            pinned_at: now,
        };
        store.pinned_messages.push(row.clone());
        Ok(row)
    }

    pub async fn unpin_message(
        &self,
        access_token: &str,
        caller_id: Uuid,
        conversation_id: Uuid,
        message_id: Uuid,
    ) -> Result<(), SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .delete(format!(
                    "{}/rest/v1/pinned_messages?conversation_id=eq.{}&message_id=eq.{}",
                    cfg.url, conversation_id, message_id
                ))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::Forbidden("cannot unpin message"));
            }
            return Ok(());
        }

        let mut store = self.local_store.lock().expect("local store lock");
        if !store
            .members
            .iter()
            .any(|m| m.conversation_id == conversation_id && m.user_id == caller_id)
        {
            return Err(SupabaseError::Forbidden("not a conversation member"));
        }
        store
            .pinned_messages
            .retain(|p| !(p.conversation_id == conversation_id && p.message_id == message_id));
        Ok(())
    }

    pub async fn list_pinned_messages(
        &self,
        access_token: &str,
        caller_id: Uuid,
        conversation_id: Uuid,
    ) -> Result<Vec<PinnedMessageRow>, SupabaseError> {
        if let Some(cfg) = &self.config {
            let resp = self
                .http
                .get(format!(
                    "{}/rest/v1/pinned_messages?conversation_id=eq.{}&order=pinned_at.desc",
                    cfg.url, conversation_id
                ))
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::Forbidden("cannot list pinned messages"));
            }
            return resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse);
        }

        let store = self.local_store.lock().expect("local store lock");
        if !store
            .members
            .iter()
            .any(|m| m.conversation_id == conversation_id && m.user_id == caller_id)
        {
            return Err(SupabaseError::Forbidden("not a conversation member"));
        }
        let mut rows: Vec<PinnedMessageRow> = store
            .pinned_messages
            .iter()
            .filter(|p| p.conversation_id == conversation_id)
            .cloned()
            .collect();
        rows.sort_by(|a, b| b.pinned_at.cmp(&a.pinned_at));
        Ok(rows)
    }
}
