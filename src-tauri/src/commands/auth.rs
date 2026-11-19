use std::collections::HashMap;
use std::fs;
use std::path::Path;

use chrono::Utc;
use serde::Deserialize;
use tauri::{AppHandle, Runtime, State};
use zeroize::Zeroizing;

use crate::crypto::kdf::{derive_key_wrapping_key, derive_supabase_auth_password};
use crate::crypto::keys::{
    generate_kdf_salt, unwrap_private_key_bundle, wrap_private_key_bundle, IdentityKeyPair,
};
use crate::platform::dpapi::{
    delete_session_at_path, load_session_from_path, save_session_to_path, DpapiProtectedSession,
};
use crate::platform::taskbar::update_taskbar_unread_badge;
use crate::supabase::ProfileRow;

use super::{
    connect_realtime_for_session, profile_to_dto, refresh_taskbar_badge, validate_display_name,
    validate_username, AppError, AppState, UserProfileDto,
};

const MAX_AVATAR_BYTES: usize = 5 * 1024 * 1024; // 5 MB (5,242,880 bytes)

#[derive(Deserialize)]
pub struct RegisterArgs {
    pub username: String,
    pub password: String,
    pub display_name: String,
}

#[derive(Deserialize)]
pub struct LoginArgs {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct ProfileUpdateArgs {
    pub display_name: Option<String>,
    pub avatar_file_path: Option<String>,
}

fn validate_password(password: &str) -> Result<(), AppError> {
    if password.len() < 8 {
        return Err(AppError::new(
            "WEAK_PASSWORD",
            "Password must be at least 8 characters long.",
        ));
    }
    Ok(())
}

fn detect_avatar_mime_and_ext(path: &Path, bytes: &[u8]) -> Result<(&'static str, &'static str), AppError> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Ok(("image/png", "png"));
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Ok(("image/jpeg", "jpg"));
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Ok(("image/webp", "webp"));
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => Ok(("image/png", "png")),
        "jpg" | "jpeg" => Ok(("image/jpeg", "jpg")),
        "webp" => Ok(("image/webp", "webp")),
        _ => Err(AppError::new(
            "UNSUPPORTED_MEDIA",
            "Avatar must be PNG, JPEG, or WEBP.",
        )),
    }
}

pub async fn auth_register_core(
    state: &AppState,
    args: RegisterArgs,
) -> Result<UserProfileDto, AppError> {
    let username = validate_username(&args.username)?;
    validate_password(&args.password)?;
    let display_name = validate_display_name(&args.display_name)?;

    let auth_pw = Zeroizing::new(
        derive_supabase_auth_password(&username, &args.password)
            .map_err(|_| AppError::new("CRYPTO_ERROR", "Credential derivation failed"))?,
    );

    let tokens = state.supabase.auth_signup(&username, &auth_pw).await?;
    let kdf_salt = generate_kdf_salt();
    let wrapping_key = derive_key_wrapping_key(&args.password, &kdf_salt)
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Key wrapping derivation failed"))?;

    let keys = IdentityKeyPair::generate();
    let wrapped_priv_keys = wrap_private_key_bundle(&keys, &wrapping_key)
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Private key wrapping failed"))?;

    let now = Utc::now();
    let profile = ProfileRow {
        id: tokens.user_id,
        username: username.clone(),
        display_name: display_name.clone(),
        avatar_path: None,
        public_enc_key: keys.x25519_public.to_vec(),
        public_sign_key: keys.ed25519_public.to_vec(),
        wrapped_priv_keys,
        kdf_salt: kdf_salt.to_vec(),
        created_at: now,
        updated_at: now,
    };

    state
        .supabase
        .insert_profile(&tokens.access_token, &profile)
        .await?;

    let dpapi_session = DpapiProtectedSession {
        user_id: tokens.user_id,
        username: profile.username.clone(),
        display_name: profile.display_name.clone(),
        avatar_path: None,
        supabase_access_token: tokens.access_token.clone(),
        supabase_refresh_token: tokens.refresh_token,
        x25519_private_key: keys.x25519_private,
        ed25519_private_key: keys.ed25519_private,
        cached_epoch_keys: HashMap::new(),
    };

    save_session_to_path(&state.session_path, &dpapi_session)
        .map_err(|_| AppError::new("DPAPI_ERROR", "Failed to persist Windows DPAPI session"))?;

    *state.session.lock().expect("session mutex") = Some(dpapi_session);
    tracing::info!(user_id = %profile.id, "Registered new account and sealed DPAPI session");

    Ok(profile_to_dto(state, &tokens.access_token, &profile).await)
}

pub async fn auth_login_core(
    state: &AppState,
    args: LoginArgs,
) -> Result<UserProfileDto, AppError> {
    let username = validate_username(&args.username)?;
    if args.password.is_empty() {
        return Err(AppError::new("INVALID_CREDENTIALS", "Password is required."));
    }

    let auth_pw = Zeroizing::new(
        derive_supabase_auth_password(&username, &args.password)
            .map_err(|_| AppError::new("CRYPTO_ERROR", "Credential derivation failed"))?,
    );

    let tokens = state.supabase.auth_signin(&username, &auth_pw).await?;
    let profile = state
        .supabase
        .get_profile(&tokens.access_token, tokens.user_id)
        .await?;

    let wrapping_key = derive_key_wrapping_key(&args.password, &profile.kdf_salt)
        .map_err(|_| AppError::new("CRYPTO_ERROR", "Key wrapping derivation failed"))?;
    let keys = unwrap_private_key_bundle(&profile.wrapped_priv_keys, &wrapping_key)
        .map_err(|_| AppError::new("VERIFICATION_FAILED", "Private key verification failed"))?;

    let dpapi_session = DpapiProtectedSession {
        user_id: profile.id,
        username: profile.username.clone(),
        display_name: profile.display_name.clone(),
        avatar_path: profile.avatar_path.clone(),
        supabase_access_token: tokens.access_token.clone(),
        supabase_refresh_token: tokens.refresh_token,
        x25519_private_key: keys.x25519_private,
        ed25519_private_key: keys.ed25519_private,
        cached_epoch_keys: HashMap::new(),
    };

    save_session_to_path(&state.session_path, &dpapi_session)
        .map_err(|_| AppError::new("DPAPI_ERROR", "Failed to persist Windows DPAPI session"))?;

    *state.session.lock().expect("session mutex") = Some(dpapi_session);
    tracing::info!(user_id = %profile.id, "Authenticated and sealed DPAPI session");

    Ok(profile_to_dto(state, &tokens.access_token, &profile).await)
}

pub async fn auth_restore_session_core(
    state: &AppState,
) -> Result<Option<UserProfileDto>, AppError> {
    let restored = match load_session_from_path(&state.session_path) {
        Ok(Some(s)) => s,
        Ok(None) => return Ok(None),
        Err(_) => {
            // Corrupted DPAPI file fails closed and falls back cleanly to login screen.
            let _ = delete_session_at_path(&state.session_path);
            return Ok(None);
        }
    };

    let profile = match state
        .supabase
        .get_profile(&restored.supabase_access_token, restored.user_id)
        .await
    {
        Ok(p) => p,
        Err(_) => {
            let dto = UserProfileDto {
                id: restored.user_id.to_string(),
                username: restored.username.clone(),
                display_name: restored.display_name.clone(),
                avatar_url: None,
            };
            *state.session.lock().expect("session mutex") = Some(restored);
            return Ok(Some(dto));
        }
    };

    let access_token = restored.supabase_access_token.clone();
    *state.session.lock().expect("session mutex") = Some(restored);
    Ok(Some(profile_to_dto(state, &access_token, &profile).await))
}

pub async fn auth_logout_core(state: &AppState) -> Result<(), AppError> {
    state.realtime.disconnect();
    state.media_cache.clear();
    *state.session.lock().expect("session mutex") = None;
    let _ = delete_session_at_path(&state.session_path);
    Ok(())
}

pub async fn profile_update_core(
    state: &AppState,
    args: ProfileUpdateArgs,
) -> Result<UserProfileDto, AppError> {
    let mut sess = state.active_session()?;

    let validated_name = match args.display_name {
        Some(ref name) => Some(validate_display_name(name)?),
        None => None,
    };

    let mut uploaded_avatar_path: Option<String> = None;
    if let Some(ref file_path_str) = args.avatar_file_path {
        let file_path = Path::new(file_path_str);
        let meta = fs::metadata(file_path)
            .map_err(|_| AppError::new("IO_ERROR", "Unable to read selected avatar file."))?;
        if meta.len() as usize > MAX_AVATAR_BYTES {
            return Err(AppError::new(
                "FILE_TOO_LARGE",
                "Avatar image exceeds the 5 MB limit.",
            ));
        }

        let bytes = fs::read(file_path)
            .map_err(|_| AppError::new("IO_ERROR", "Unable to read avatar file."))?;
        if bytes.len() > MAX_AVATAR_BYTES {
            return Err(AppError::new(
                "FILE_TOO_LARGE",
                "Avatar image exceeds the 5 MB limit.",
            ));
        }

        let (mime, ext) = detect_avatar_mime_and_ext(file_path, &bytes)?;
        let object_path = format!("{}/avatar.{ext}", sess.user_id);

        state
            .supabase
            .upload_storage_object(
                &sess.supabase_access_token,
                "avatars",
                &object_path,
                mime,
                bytes,
            )
            .await?;

        uploaded_avatar_path = Some(object_path);
    }

    let updated = state
        .supabase
        .update_profile(
            &sess.supabase_access_token,
            sess.user_id,
            validated_name.as_deref(),
            uploaded_avatar_path.as_deref(),
        )
        .await?;

    sess.display_name = updated.display_name.clone();
    sess.avatar_path = updated.avatar_path.clone();
    let _ = save_session_to_path(&state.session_path, &sess);
    *state.session.lock().expect("session mutex") = Some(sess.clone());

    Ok(profile_to_dto(state, &sess.supabase_access_token, &updated).await)
}

#[tauri::command]
pub async fn auth_register<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    username: String,
    password: String,
    display_name: String,
) -> Result<UserProfileDto, AppError> {
    let dto = auth_register_core(
        &state,
        RegisterArgs {
            username,
            password,
            display_name,
        },
    )
    .await?;
    if let Ok(sess) = state.active_session() {
        connect_realtime_for_session(&app, &state, &sess);
        refresh_taskbar_badge(&app, &state).await;
    }
    Ok(dto)
}

#[tauri::command]
pub async fn auth_login<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<UserProfileDto, AppError> {
    let dto = auth_login_core(&state, LoginArgs { username, password }).await?;
    if let Ok(sess) = state.active_session() {
        connect_realtime_for_session(&app, &state, &sess);
        refresh_taskbar_badge(&app, &state).await;
    }
    Ok(dto)
}

#[tauri::command]
pub async fn auth_restore_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<Option<UserProfileDto>, AppError> {
    let dto = auth_restore_session_core(&state).await?;
    if dto.is_some() {
        if let Ok(sess) = state.active_session() {
            connect_realtime_for_session(&app, &state, &sess);
            refresh_taskbar_badge(&app, &state).await;
        }
    }
    Ok(dto)
}

#[tauri::command]
pub async fn auth_logout<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    auth_logout_core(&state).await?;
    update_taskbar_unread_badge(&app, 0);
    Ok(())
}

#[tauri::command]
pub async fn profile_update(
    state: State<'_, AppState>,
    display_name: Option<String>,
    avatar_file_path: Option<String>,
) -> Result<UserProfileDto, AppError> {
    profile_update_core(
        &state,
        ProfileUpdateArgs {
            display_name,
            avatar_file_path,
        },
    )
    .await
}
