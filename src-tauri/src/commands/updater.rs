use tauri::{AppHandle, Emitter, Runtime, State};

use crate::updater::UpdateStatusDto;

use super::{AppError, AppState};

#[tauri::command]
pub async fn update_get_status(state: State<'_, AppState>) -> Result<UpdateStatusDto, AppError> {
    Ok(state.updater.current_status())
}

#[tauri::command]
pub async fn update_check<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    silent: Option<bool>,
) -> Result<UpdateStatusDto, AppError> {
    let silent = silent.unwrap_or(false);
    let app_handle = app.clone();
    state
        .updater
        .check_for_updates(silent, move |status| {
            let _ = app_handle.emit("updater:state_changed", status);
        })
        .await
}

#[tauri::command]
pub async fn update_install<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<UpdateStatusDto, AppError> {
    let app_handle = app.clone();
    let (status, launched) = state
        .updater
        .install_update(move |status| {
            let _ = app_handle.emit("updater:state_changed", status);
        })
        .await?;

    if launched {
        let exit_app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            exit_app.exit(0);
        });
    }

    Ok(status)
}
