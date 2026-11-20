use tauri::{AppHandle, Emitter, Runtime, State};

use super::{
    resolve_avatar_data_url, validate_username, AppError, AppState, ContactDto,
};

pub async fn contact_add_by_username_core(
    state: &AppState,
    username: &str,
) -> Result<ContactDto, AppError> {
    let sess = state.ensure_active_session().await?;
    let target_username = validate_username(username)?;

    let target = state
        .supabase
        .rpc_add_mutual_contact(&sess.supabase_access_token, sess.user_id, &target_username)
        .await?;

    let avatar_url =
        resolve_avatar_data_url(state, &sess.supabase_access_token, &target.avatar_path).await;
    let is_online = state.realtime.is_user_online(target.id);

    Ok(ContactDto {
        id: target.id.to_string(),
        username: target.username,
        display_name: target.display_name,
        avatar_url,
        is_online,
    })
}

pub async fn contact_list_core(state: &AppState) -> Result<Vec<ContactDto>, AppError> {
    let sess = state.ensure_active_session().await?;
    let rows = state
        .supabase
        .list_contacts(&sess.supabase_access_token, sess.user_id)
        .await?;

    let mut contacts = Vec::with_capacity(rows.len());
    for row in rows {
        let avatar_url =
            resolve_avatar_data_url(state, &sess.supabase_access_token, &row.avatar_path).await;
        let is_online = state.realtime.is_user_online(row.id);
        contacts.push(ContactDto {
            id: row.id.to_string(),
            username: row.username,
            display_name: row.display_name,
            avatar_url,
            is_online,
        });
    }
    contacts.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    Ok(contacts)
}

#[tauri::command]
pub async fn contact_add_by_username<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    username: String,
) -> Result<ContactDto, AppError> {
    let dto = contact_add_by_username_core(&state, &username).await?;
    let _ = app.emit("realtime:contact_added", &dto);
    Ok(dto)
}

#[tauri::command]
pub async fn contact_list(state: State<'_, AppState>) -> Result<Vec<ContactDto>, AppError> {
    contact_list_core(&state).await
}
