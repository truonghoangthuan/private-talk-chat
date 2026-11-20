pub mod commands;
pub mod crypto;
pub mod platform;
pub mod state;
pub mod supabase;
pub mod updater;

use tauri::{
    http::{header, Response, StatusCode},
    Emitter, Manager,
};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use crate::commands::AppState;

/// Initializes zero-leakage tracing (logs metadata/events without secret or message payloads).
pub fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

/// Handles `privatetalk-media://localhost/<conversation_id>/<message_id>` strictly from Rust memory.
pub fn handle_media_protocol(
    state: &AppState,
    uri_path: &str,
) -> Response<Vec<u8>> {
    if state.active_session().is_err() {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Vec::new())
            .expect("valid response");
    }

    let trimmed = uri_path.trim_start_matches('/');
    let mut parts = trimmed.split('/');
    let conv_part = parts.next().unwrap_or("");
    let msg_part = parts.next().unwrap_or("");

    let (Ok(conv_id), Ok(msg_id)) = (Uuid::parse_str(conv_part), Uuid::parse_str(msg_part)) else {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Vec::new())
            .expect("valid response");
    };

    match state.media_cache.get(conv_id, msg_id) {
        Some(entry) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, entry.mime_type)
            .header(header::CACHE_CONTROL, "no-store")
            .body(entry.bytes.to_vec())
            .expect("valid response"),
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .expect("valid response"),
    }
}

pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::from_env())
        .setup(|app| {
            platform::taskbar::apply_main_window_icons(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                let _ = window.emit(
                    "window:focus_changed",
                    serde_json::json!({ "focused": focused }),
                );
            }
        })
        .register_uri_scheme_protocol("privatetalk-media", |ctx, request| {
            let state = ctx.app_handle().state::<AppState>();
            handle_media_protocol(&state, request.uri().path())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::auth_register,
            commands::auth::auth_login,
            commands::auth::auth_restore_session,
            commands::auth::auth_logout,
            commands::auth::profile_update,
            commands::contacts::contact_add_by_username,
            commands::contacts::contact_list,
            commands::conversations::conversation_list,
            commands::conversations::conversation_start_direct,
            commands::conversations::conversation_create_group,
            commands::conversations::conversation_rename_group,
            commands::conversations::conversation_add_group_member,
            commands::conversations::conversation_remove_group_member,
            commands::conversations::conversation_leave_group,
            commands::messages::message_list,
            commands::messages::message_send,
            commands::messages::message_edit,
            commands::messages::message_remove,
            commands::messages::message_pin,
            commands::messages::message_unpin,
            commands::messages::message_list_pinned,
            commands::messages::message_mark_seen,
            commands::messages::typing_set_status,
            commands::updater::update_get_status,
            commands::updater::update_check,
            commands::updater::update_install,
            commands::window_focus_conversation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bloop application");
}
