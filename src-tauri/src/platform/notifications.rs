use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize)]
pub struct NavigateConversationPayload {
    pub conversation_id: String,
}

/// Dispatches a native Windows desktop notification without writing plaintext contents to logs.
pub fn dispatch_message_notification<R: Runtime>(
    app: &AppHandle<R>,
    conversation_id: Uuid,
    sender_display: &str,
    preview: &str,
) {
    let body = if preview.trim().is_empty() {
        "Sent an encrypted message".to_string()
    } else {
        let truncated: String = preview.chars().take(120).collect();
        truncated
    };

    let _ = app
        .notification()
        .builder()
        .title(sender_display)
        .body(body)
        .show();

    tracing::info!(
        conversation_id = %conversation_id,
        "Dispatched desktop notification"
    );
}

/// Restores/focuses the main window and directs the frontend to open `conversation_id`.
pub fn activate_conversation_window<R: Runtime>(app: &AppHandle<R>, conversation_id: Uuid) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    let _ = app.emit(
        "window:navigate_conversation",
        NavigateConversationPayload {
            conversation_id: conversation_id.to_string(),
        },
    );
}
