use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{SupabaseClient, SupabaseError};

#[derive(Debug, Clone)]
pub struct AuthSessionTokens {
    pub user_id: Uuid,
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Serialize)]
struct AuthRequestBody<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
struct RefreshRequestBody<'a> {
    refresh_token: &'a str,
}

#[derive(Deserialize)]
struct JwtExpPayload {
    exp: Option<i64>,
}

/// Returns true if `token` is a JWT whose `exp` claim is within `leeway_secs` of now (or past).
/// Non-JWT tokens (e.g. local loopback tokens) return false.
pub fn jwt_is_expiring(token: &str, leeway_secs: i64) -> bool {
    let mut parts = token.split('.');
    let (Some(_), Some(payload_b64), Some(_), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(payload_b64) else {
        return false;
    };
    let Ok(payload) = serde_json::from_slice::<JwtExpPayload>(&bytes) else {
        return false;
    };
    let Some(exp) = payload.exp else {
        return false;
    };
    exp <= Utc::now().timestamp() + leeway_secs
}

#[derive(Deserialize)]
struct AuthResponseBody {
    access_token: Option<String>,
    refresh_token: Option<String>,
    user: Option<AuthUserObj>,
}

#[derive(Deserialize)]
struct AuthUserObj {
    id: Uuid,
}

fn synthetic_email(username: &str) -> String {
    format!("{}@privatetalk.internal", username.trim().to_ascii_lowercase())
}

impl SupabaseClient {
    pub async fn auth_signup(
        &self,
        username: &str,
        derived_auth_password: &str,
    ) -> Result<AuthSessionTokens, SupabaseError> {
        let email = synthetic_email(username);

        if let Some(cfg) = &self.config {
            let url = format!("{}/auth/v1/signup", cfg.url);
            let resp = self
                .http
                .post(&url)
                .header("apikey", &cfg.anon_key)
                .json(&AuthRequestBody {
                    email: &email,
                    password: derived_auth_password,
                })
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;

            if resp.status().as_u16() == 400 || resp.status().as_u16() == 422 {
                return Err(SupabaseError::Conflict("username already exists"));
            }
            if !resp.status().is_success() {
                return Err(SupabaseError::AuthRejected("signup failed"));
            }

            let body: AuthResponseBody = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            let user_id = body
                .user
                .map(|u| u.id)
                .ok_or(SupabaseError::InvalidResponse)?;
            let access_token = body
                .access_token
                .ok_or(SupabaseError::AuthRejected("missing access token"))?;
            let refresh_token = body
                .refresh_token
                .unwrap_or_default();

            return Ok(AuthSessionTokens {
                user_id,
                access_token,
                refresh_token,
            });
        }

        // Local loopback mode
        let mut store = self.local_store.lock().expect("local store lock");
        let lower_user = username.trim().to_ascii_lowercase();
        if store.auth_passwords.contains_key(&lower_user) {
            return Err(SupabaseError::Conflict("username already exists"));
        }
        let user_id = Uuid::new_v4();
        store
            .auth_passwords
            .insert(lower_user, (user_id, derived_auth_password.to_string()));
        Ok(AuthSessionTokens {
            user_id,
            access_token: format!("local-access-{user_id}"),
            refresh_token: format!("local-refresh-{user_id}"),
        })
    }

    pub async fn auth_signin(
        &self,
        username: &str,
        derived_auth_password: &str,
    ) -> Result<AuthSessionTokens, SupabaseError> {
        let email = synthetic_email(username);

        if let Some(cfg) = &self.config {
            let url = format!("{}/auth/v1/token?grant_type=password", cfg.url);
            let resp = self
                .http
                .post(&url)
                .header("apikey", &cfg.anon_key)
                .json(&AuthRequestBody {
                    email: &email,
                    password: derived_auth_password,
                })
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;

            if !resp.status().is_success() {
                return Err(SupabaseError::AuthRejected("invalid username or password"));
            }

            let body: AuthResponseBody = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            let user_id = body
                .user
                .map(|u| u.id)
                .ok_or(SupabaseError::InvalidResponse)?;
            let access_token = body
                .access_token
                .ok_or(SupabaseError::AuthRejected("missing access token"))?;
            let refresh_token = body.refresh_token.unwrap_or_default();

            return Ok(AuthSessionTokens {
                user_id,
                access_token,
                refresh_token,
            });
        }

        let store = self.local_store.lock().expect("local store lock");
        let lower_user = username.trim().to_ascii_lowercase();
        let Some((user_id, stored_pw)) = store.auth_passwords.get(&lower_user) else {
            return Err(SupabaseError::AuthRejected("invalid username or password"));
        };
        if stored_pw != derived_auth_password {
            return Err(SupabaseError::AuthRejected("invalid username or password"));
        }
        Ok(AuthSessionTokens {
            user_id: *user_id,
            access_token: format!("local-access-{user_id}"),
            refresh_token: format!("local-refresh-{user_id}"),
        })
    }

    pub async fn auth_refresh(
        &self,
        refresh_token: &str,
    ) -> Result<AuthSessionTokens, SupabaseError> {
        if refresh_token.trim().is_empty() {
            return Err(SupabaseError::AuthRejected("missing refresh token"));
        }

        if let Some(cfg) = &self.config {
            let url = format!("{}/auth/v1/token?grant_type=refresh_token", cfg.url);
            let resp = self
                .http
                .post(&url)
                .header("apikey", &cfg.anon_key)
                .json(&RefreshRequestBody { refresh_token })
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;

            if !resp.status().is_success() {
                return Err(SupabaseError::AuthRejected("session expired"));
            }

            let body: AuthResponseBody = resp
                .json()
                .await
                .map_err(|_| SupabaseError::InvalidResponse)?;
            let user_id = body
                .user
                .map(|u| u.id)
                .ok_or(SupabaseError::InvalidResponse)?;
            let access_token = body
                .access_token
                .ok_or(SupabaseError::AuthRejected("missing access token"))?;
            let new_refresh_token = body
                .refresh_token
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| refresh_token.to_string());

            return Ok(AuthSessionTokens {
                user_id,
                access_token,
                refresh_token: new_refresh_token,
            });
        }

        // Local loopback mode
        let Some(id_str) = refresh_token.strip_prefix("local-refresh-") else {
            return Err(SupabaseError::AuthRejected("session expired"));
        };
        let Ok(user_id) = Uuid::parse_str(id_str) else {
            return Err(SupabaseError::AuthRejected("session expired"));
        };
        let store = self.local_store.lock().expect("local store lock");
        if !store.profiles.contains_key(&user_id) {
            return Err(SupabaseError::AuthRejected("session expired"));
        }
        Ok(AuthSessionTokens {
            user_id,
            access_token: format!("local-access-{user_id}"),
            refresh_token: format!("local-refresh-{user_id}"),
        })
    }
}
