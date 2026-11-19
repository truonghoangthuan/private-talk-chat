use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};
use uuid::Uuid;

use super::SupabaseConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypingUserDto {
    pub user_id: Uuid,
    pub display_name: String,
}

#[derive(Debug, Clone)]
pub struct TypingEntry {
    pub display_name: String,
    pub expires_at: Instant,
}

/// Manages online presence (`presence:global`), ephemeral typing state (`room:<conversation_id>`),
/// and Phoenix WebSocket connection to Supabase Realtime when configured.
pub struct RealtimeManager {
    online_users: Arc<Mutex<HashSet<Uuid>>>,
    typing_by_conv: Arc<Mutex<HashMap<Uuid, HashMap<Uuid, TypingEntry>>>>,
    outbound_tx: Mutex<Option<mpsc::UnboundedSender<String>>>,
    shutdown_tx: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
}

impl Default for RealtimeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl RealtimeManager {
    pub fn new() -> Self {
        Self {
            online_users: Arc::new(Mutex::new(HashSet::new())),
            typing_by_conv: Arc::new(Mutex::new(HashMap::new())),
            outbound_tx: Mutex::new(None),
            shutdown_tx: Mutex::new(None),
        }
    }

    pub fn set_user_online(&self, user_id: Uuid, online: bool) {
        let mut guard = self.online_users.lock().expect("online_users lock");
        if online {
            guard.insert(user_id);
        } else {
            guard.remove(&user_id);
        }
    }

    pub fn is_user_online(&self, user_id: Uuid) -> bool {
        let guard = self.online_users.lock().expect("online_users lock");
        guard.contains(&user_id)
    }

    pub fn online_user_ids(&self) -> Vec<String> {
        let guard = self.online_users.lock().expect("online_users lock");
        guard.iter().map(|id| id.to_string()).collect()
    }

    /// Updates ephemeral typing indicator with 3.5s auto-expiry.
    pub fn record_typing(
        &self,
        conversation_id: Uuid,
        user_id: Uuid,
        display_name: String,
        is_typing: bool,
    ) -> Vec<TypingUserDto> {
        let now = Instant::now();
        let mut guard = self.typing_by_conv.lock().expect("typing_by_conv lock");
        let conv_map = guard.entry(conversation_id).or_default();

        if is_typing {
            conv_map.insert(
                user_id,
                TypingEntry {
                    display_name,
                    expires_at: now + Duration::from_millis(3500),
                },
            );
        } else {
            conv_map.remove(&user_id);
        }

        conv_map.retain(|_, entry| entry.expires_at > now);
        conv_map
            .iter()
            .map(|(uid, entry)| TypingUserDto {
                user_id: *uid,
                display_name: entry.display_name.clone(),
            })
            .collect()
    }

    pub fn prune_and_get_typing(&self, conversation_id: Uuid) -> Vec<TypingUserDto> {
        let now = Instant::now();
        let mut guard = self.typing_by_conv.lock().expect("typing_by_conv lock");
        let Some(conv_map) = guard.get_mut(&conversation_id) else {
            return vec![];
        };
        conv_map.retain(|_, entry| entry.expires_at > now);
        conv_map
            .iter()
            .map(|(uid, entry)| TypingUserDto {
                user_id: *uid,
                display_name: entry.display_name.clone(),
            })
            .collect()
    }

    pub fn broadcast_typing(&self, conversation_id: Uuid, user_id: Uuid, display_name: &str, is_typing: bool) {
        let frame = serde_json::json!({
            "topic": format!("realtime:room:{conversation_id}"),
            "event": "broadcast",
            "payload": {
                "type": "broadcast",
                "event": "typing",
                "payload": {
                    "conversation_id": conversation_id,
                    "user_id": user_id,
                    "display_name": display_name,
                    "is_typing": is_typing
                }
            },
            "ref": "typing"
        })
        .to_string();

        if let Some(tx) = self.outbound_tx.lock().expect("outbound_tx lock").as_ref() {
            let _ = tx.send(frame);
        }
    }

    pub fn connect_remote<F>(
        &self,
        cfg: SupabaseConfig,
        user_id: Uuid,
        access_token: String,
        on_event: F,
    ) where
        F: Fn(serde_json::Value) + Send + Sync + 'static,
    {
        self.disconnect();
        self.set_user_online(user_id, true);

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let (stop_tx, mut stop_rx) = tokio::sync::watch::channel(false);

        *self.outbound_tx.lock().expect("outbound_tx lock") = Some(out_tx.clone());
        *self.shutdown_tx.lock().expect("shutdown_tx lock") = Some(stop_tx);

        let ws_base = cfg
            .url
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        let ws_url = format!(
            "{ws_base}/realtime/v1/websocket?apikey={}&vsn=1.0.0",
            cfg.anon_key
        );

        let online_users = Arc::clone(&self.online_users);
        let typing_by_conv = Arc::clone(&self.typing_by_conv);
        let on_event = Arc::new(on_event);

        tauri::async_runtime::spawn(async move {
            let Ok((ws_stream, _)) = connect_async(&ws_url).await else {
                tracing::warn!("Supabase Realtime WebSocket connection failed; continuing in local state mode");
                return;
            };
            let (mut write, mut read) = ws_stream.split();

            // Join postgres_changes + presence:global channel
            let join_db = serde_json::json!({
                "topic": "realtime:public",
                "event": "phx_join",
                "payload": {
                    "config": {
                        "postgres_changes": [
                            { "event": "*", "schema": "public", "table": "messages" },
                            { "event": "*", "schema": "public", "table": "message_reads" },
                            { "event": "*", "schema": "public", "table": "pinned_messages" },
                            { "event": "*", "schema": "public", "table": "conversations" },
                            { "event": "*", "schema": "public", "table": "conversation_members" },
                            { "event": "INSERT", "schema": "public", "table": "contacts" }
                        ]
                    },
                    "access_token": access_token
                },
                "ref": "1"
            })
            .to_string();
            let _ = write.send(WsMessage::Text(join_db.into())).await;

            let join_presence = serde_json::json!({
                "topic": "realtime:presence:global",
                "event": "phx_join",
                "payload": {
                    "config": { "presence": { "key": user_id.to_string() } },
                    "access_token": access_token
                },
                "ref": "2"
            })
            .to_string();
            let _ = write.send(WsMessage::Text(join_presence.into())).await;

            let track_presence = serde_json::json!({
                "topic": "realtime:presence:global",
                "event": "presence",
                "payload": {
                    "type": "presence",
                    "event": "track",
                    "payload": {
                        "user_id": user_id.to_string(),
                        "status": "online",
                        "online_at": Utc::now().to_rfc3339()
                    }
                },
                "ref": "3"
            })
            .to_string();
            let _ = write.send(WsMessage::Text(track_presence.into())).await;

            let mut heartbeat = tokio::time::interval(Duration::from_secs(25));
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    _ = heartbeat.tick() => {
                        let hb = serde_json::json!({
                            "topic": "phoenix",
                            "event": "heartbeat",
                            "payload": {},
                            "ref": "hb"
                        }).to_string();
                        if write.send(WsMessage::Text(hb.into())).await.is_err() {
                            break;
                        }
                    }
                    Some(msg) = out_rx.recv() => {
                        if write.send(WsMessage::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                    incoming = read.next() => {
                        match incoming {
                            Some(Ok(WsMessage::Text(text))) => {
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                                    let event = val.get("event").and_then(|e| e.as_str()).unwrap_or("");
                                    if event == "presence_diff" {
                                        if let Some(joins) = val.pointer("/payload/joins").and_then(|v| v.as_object()) {
                                            let mut guard = online_users.lock().expect("online_users");
                                            for k in joins.keys() {
                                                if let Ok(uid) = Uuid::parse_str(k) {
                                                    guard.insert(uid);
                                                }
                                            }
                                        }
                                        if let Some(leaves) = val.pointer("/payload/leaves").and_then(|v| v.as_object()) {
                                            let mut guard = online_users.lock().expect("online_users");
                                            for k in leaves.keys() {
                                                if let Ok(uid) = Uuid::parse_str(k) {
                                                    guard.remove(&uid);
                                                }
                                            }
                                        }
                                    } else if event == "broadcast" {
                                        if let Some(payload) = val.pointer("/payload/payload") {
                                            if let (Some(cid_s), Some(uid_s), Some(dn), Some(is_t)) = (
                                                payload.get("conversation_id").and_then(|v| v.as_str()),
                                                payload.get("user_id").and_then(|v| v.as_str()),
                                                payload.get("display_name").and_then(|v| v.as_str()),
                                                payload.get("is_typing").and_then(|v| v.as_bool()),
                                            ) {
                                                if let (Ok(cid), Ok(uid)) = (Uuid::parse_str(cid_s), Uuid::parse_str(uid_s)) {
                                                    let mut guard = typing_by_conv.lock().expect("typing_by_conv");
                                                    let m = guard.entry(cid).or_default();
                                                    if is_t {
                                                        m.insert(uid, TypingEntry {
                                                            display_name: dn.to_string(),
                                                            expires_at: Instant::now() + Duration::from_millis(3500),
                                                        });
                                                    } else {
                                                        m.remove(&uid);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    on_event(val);
                                }
                            }
                            Some(Ok(_)) => {}
                            _ => break,
                        }
                    }
                }
            }
        });
    }

    pub fn disconnect(&self) {
        if let Some(tx) = self.shutdown_tx.lock().expect("shutdown lock").take() {
            let _ = tx.send(true);
        }
        *self.outbound_tx.lock().expect("outbound lock") = None;
        self.online_users.lock().expect("online lock").clear();
        self.typing_by_conv.lock().expect("typing lock").clear();
    }
}
