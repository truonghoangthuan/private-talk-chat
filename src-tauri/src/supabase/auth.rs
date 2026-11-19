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
}
