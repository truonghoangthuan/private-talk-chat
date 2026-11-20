use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use tempfile::tempdir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use uuid::Uuid;

use private_talk_lib::commands::auth::auth_restore_session_core;
use private_talk_lib::commands::contacts::contact_add_by_username_core;
use private_talk_lib::commands::{AppError, AppState};
use private_talk_lib::platform::dpapi::{
    load_session_from_path, save_session_to_path, DpapiProtectedSession,
};
use private_talk_lib::supabase::{SupabaseClient, SupabaseConfig, SupabaseError};

fn make_test_jwt(exp: i64) -> String {
    let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256","typ":"JWT"}"#);
    let payload = URL_SAFE_NO_PAD.encode(format!(r#"{{"sub":"test","exp":{exp}}}"#));
    format!("{header}.{payload}.sig")
}

async fn spawn_mock_supabase<F>(handler: F) -> String
where
    F: Fn(&str, &str) -> (u16, String) + Send + Sync + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("local_addr");
    let handler = Arc::new(handler);

    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            let handler = Arc::clone(&handler);
            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                if n == 0 {
                    return;
                }
                let req = String::from_utf8_lossy(&buf[..n]);
                let first_line = req.lines().next().unwrap_or("");
                let (status, body) = handler(first_line, &req);
                let status_text = match status {
                    200 => "200 OK",
                    400 => "400 Bad Request",
                    401 => "401 Unauthorized",
                    _ => "500 Internal Server Error",
                };
                let resp = format!(
                    "HTTP/1.1 {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            });
        }
    });

    format!("http://{addr}")
}

fn sample_session(user_id: Uuid, access_token: String, refresh_token: String) -> DpapiProtectedSession {
    DpapiProtectedSession {
        user_id,
        username: "alice".to_string(),
        display_name: "Alice".to_string(),
        avatar_path: None,
        supabase_access_token: access_token,
        supabase_refresh_token: refresh_token,
        x25519_private_key: [7u8; 32],
        ed25519_private_key: [9u8; 32],
        cached_epoch_keys: HashMap::new(),
    }
}

#[tokio::test]
async fn restore_session_refreshes_expired_jwt_and_persists_new_tokens() {
    let dir = tempdir().expect("tempdir");
    let session_path = dir.path().join("session.dpapi");
    let user_id = Uuid::new_v4();
    let expired_jwt = make_test_jwt(1_000);
    let fresh_jwt = make_test_jwt(Utc::now().timestamp() + 3600);
    let fresh_jwt_srv = fresh_jwt.clone();
    let refresh_calls = Arc::new(AtomicUsize::new(0));
    let refresh_calls_srv = Arc::clone(&refresh_calls);

    let url = spawn_mock_supabase(move |line, req| {
        if line.starts_with("POST /auth/v1/token?grant_type=refresh_token") {
            refresh_calls_srv.fetch_add(1, Ordering::SeqCst);
            assert!(req.contains("refresh-1"));
            return (
                200,
                serde_json::json!({
                    "access_token": fresh_jwt_srv,
                    "refresh_token": "refresh-2",
                    "user": { "id": user_id }
                })
                .to_string(),
            );
        }
        if line.starts_with("GET /rest/v1/profiles") {
            assert!(req.contains(&fresh_jwt_srv));
            return (
                200,
                serde_json::json!([{
                    "id": user_id,
                    "username": "alice",
                    "display_name": "Alice",
                    "avatar_path": null,
                    "public_enc_key": "\\x0102",
                    "public_sign_key": "\\x0304",
                    "wrapped_priv_keys": "\\x0506",
                    "kdf_salt": "\\x0708",
                    "created_at": "2026-01-01T00:00:00Z",
                    "updated_at": "2026-01-01T00:00:00Z"
                }])
                .to_string(),
            );
        }
        (404, "{}".to_string())
    })
    .await;

    let initial = sample_session(user_id, expired_jwt, "refresh-1".to_string());
    save_session_to_path(&session_path, &initial).expect("save dpapi");

    let client = SupabaseClient::new(Some(SupabaseConfig {
        url,
        anon_key: "anon".to_string(),
    }));
    let state = AppState::new_for_test(session_path.clone(), client);

    let restored = auth_restore_session_core(&state)
        .await
        .expect("restore ok")
        .expect("session restored");
    assert_eq!(restored.username, "alice");
    assert_eq!(refresh_calls.load(Ordering::SeqCst), 1);

    let active = state.active_session().expect("active session");
    assert_eq!(active.supabase_access_token, fresh_jwt);
    assert_eq!(active.supabase_refresh_token, "refresh-2");

    let persisted = load_session_from_path(&session_path)
        .expect("load dpapi")
        .expect("dpapi exists");
    assert_eq!(persisted.supabase_access_token, fresh_jwt);
    assert_eq!(persisted.supabase_refresh_token, "refresh-2");
}

#[tokio::test]
async fn restore_session_fails_closed_and_wipes_dpapi_when_refresh_rejected() {
    let dir = tempdir().expect("tempdir");
    let session_path = dir.path().join("session.dpapi");
    let user_id = Uuid::new_v4();
    let expired_jwt = make_test_jwt(1_000);

    let url = spawn_mock_supabase(move |line, _| {
        if line.starts_with("POST /auth/v1/token?grant_type=refresh_token") {
            return (400, r#"{"error":"invalid_grant"}"#.to_string());
        }
        (401, r#"{"code":"PGRST303","message":"JWT expired"}"#.to_string())
    })
    .await;

    let initial = sample_session(user_id, expired_jwt, "revoked-refresh".to_string());
    save_session_to_path(&session_path, &initial).expect("save dpapi");
    assert!(session_path.exists());

    let client = SupabaseClient::new(Some(SupabaseConfig {
        url,
        anon_key: "anon".to_string(),
    }));
    let state = AppState::new_for_test(session_path.clone(), client);

    let restored = auth_restore_session_core(&state)
        .await
        .expect("fails closed cleanly");
    assert!(restored.is_none());
    assert!(state.active_session().is_err());
    assert!(!session_path.exists());
}

#[tokio::test]
async fn rpc_add_mutual_contact_maps_401_jwt_expired_to_auth_rejected_and_active_session_refreshes() {
    let dir = tempdir().expect("tempdir");
    let session_path = dir.path().join("session.dpapi");
    let user_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let expired_jwt = make_test_jwt(1_000);
    let fresh_jwt = make_test_jwt(Utc::now().timestamp() + 3600);
    let fresh_jwt_srv = fresh_jwt.clone();

    let url = spawn_mock_supabase(move |line, req| {
        if line.starts_with("POST /auth/v1/token?grant_type=refresh_token") {
            return (
                200,
                serde_json::json!({
                    "access_token": fresh_jwt_srv,
                    "refresh_token": "refresh-new",
                    "user": { "id": user_id }
                })
                .to_string(),
            );
        }
        if line.starts_with("POST /rest/v1/rpc/add_mutual_contact") {
            if !req.contains(&fresh_jwt_srv) {
                return (
                    401,
                    r#"{"code":"PGRST303","details":null,"hint":null,"message":"JWT expired"}"#
                        .to_string(),
                );
            }
            return (
                200,
                serde_json::json!({
                    "id": contact_id,
                    "username": "cubu69",
                    "display_name": "Cubu",
                    "avatar_path": null,
                    "public_enc_key": "\\x0102",
                    "public_sign_key": "\\x0304",
                    "wrapped_priv_keys": "\\x0506",
                    "kdf_salt": "\\x0708",
                    "created_at": "2026-01-01T00:00:00Z",
                    "updated_at": "2026-01-01T00:00:00Z"
                })
                .to_string(),
            );
        }
        (404, "{}".to_string())
    })
    .await;

    let client = SupabaseClient::new(Some(SupabaseConfig {
        url,
        anon_key: "anon".to_string(),
    }));

    // Direct RPC call with expired JWT must return AuthRejected (AUTH_REJECTED), not InvalidResponse.
    let err = client
        .rpc_add_mutual_contact(&expired_jwt, user_id, "cubu69")
        .await
        .expect_err("401 must fail");
    assert!(matches!(err, SupabaseError::AuthRejected(_)));
    let app_err = AppError::from(err);
    assert_eq!(app_err.code, "AUTH_REJECTED");

    // Active session command with expired JWT must refresh transparently and succeed.
    let state = AppState::new_for_test(session_path.clone(), client);
    *state.session.lock().expect("session mutex") =
        Some(sample_session(user_id, expired_jwt, "refresh-old".to_string()));

    let contact = contact_add_by_username_core(&state, "cubu69")
        .await
        .expect("contact added after auto-refresh");
    assert_eq!(contact.username, "cubu69");
    assert_eq!(
        state.active_session().expect("session").supabase_access_token,
        fresh_jwt
    );
}
