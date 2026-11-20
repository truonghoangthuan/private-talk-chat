# Bug Fix: Refresh Expired Supabase JWT on Session Restore and Active Commands, Map 401/JWT Expired to AuthRejected

- **Slug**: contact-search-invalid-response
- **Fixed**: 2026-11-20T11:45:00+07:00
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Added `SupabaseClient::auth_refresh` (`POST /auth/v1/token?grant_type=refresh_token`) and JWT `exp` inspection (`jwt_is_expiring`), serialized token rotation via `AppState::refresh_lock` in `auth_restore_session_core` and `AppState::ensure_active_session`, and mapped PostgREST `401` / `PGRST303` / `JWT expired` / `NOT_AUTHENTICATED` responses in `get_profile` and `rpc_add_mutual_contact` to `SupabaseError::AuthRejected` (`AUTH_REJECTED`) instead of `SupabaseError::InvalidResponse` or `NotFound`. Rejected refreshes fail closed by clearing in-memory state and deleting `session.dpapi`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src-tauri/src/supabase/auth.rs` | modified | Added `jwt_is_expiring` and `SupabaseClient::auth_refresh` (remote + local loopback). |
| `src-tauri/src/supabase/postgrest.rs` | modified | Added `is_auth_error` and mapped `401`/`PGRST303`/`JWT expired`/`NOT_AUTHENTICATED` to `SupabaseError::AuthRejected` in `get_profile` and `rpc_add_mutual_contact`. |
| `src-tauri/src/commands/mod.rs` | modified | Added `AppState::refresh_lock`, `AppState::ensure_active_session`, and updated `refresh_taskbar_badge` to use it. |
| `src-tauri/src/commands/auth.rs` | modified | Updated `auth_restore_session_core` to refresh expired/expiring or `AuthRejected` sessions and fail closed (delete `session.dpapi`, return `Ok(None)`) when refresh is rejected; updated `profile_update_core` to use `ensure_active_session`. |
| `src-tauri/src/commands/contacts.rs` | modified | Updated `contact_add_by_username_core` and `contact_list_core` to use `ensure_active_session`. |
| `src-tauri/src/commands/conversations.rs` | modified | Updated async conversation commands to use `ensure_active_session`. |
| `src-tauri/src/commands/messages.rs` | modified | Updated async message/pin commands to use `ensure_active_session`. |
| `src-tauri/tests/auth_refresh_tests.rs` | added test | Integration and negative tests with a local mock HTTP server covering expired JWT restore, fail-closed DPAPI wipe on rejected refresh, `401` `PGRST303` mapping to `AUTH_REJECTED`, and active-session auto-refresh. |

## Diff Highlights

- `src-tauri/src/supabase/auth.rs`: `jwt_is_expiring` checks the JWT payload `exp` claim against `Utc::now().timestamp() + leeway_secs` (60s); `auth_refresh` calls `POST /auth/v1/token?grant_type=refresh_token`.
- `src-tauri/src/commands/mod.rs`: `AppState::ensure_active_session` serializes concurrent refreshes with `refresh_lock`, re-checks expiry inside the lock, persists rotated tokens to `session.dpapi`, and clears session + `session.dpapi` on `SupabaseError::AuthRejected`.

## Tests Added or Updated

- `src-tauri/tests/auth_refresh_tests.rs::restore_session_refreshes_expired_jwt_and_persists_new_tokens` — verifies expired DPAPI JWT triggers `auth_refresh`, updates `AppState`, and persists new tokens to `session.dpapi`.
- `src-tauri/tests/auth_refresh_tests.rs::restore_session_fails_closed_and_wipes_dpapi_when_refresh_rejected` — verifies rejected refresh returns `Ok(None)`, clears active session, and deletes `session.dpapi`.
- `src-tauri/tests/auth_refresh_tests.rs::rpc_add_mutual_contact_maps_401_jwt_expired_to_auth_rejected_and_active_session_refreshes` — verifies `401` `PGRST303` maps to `AUTH_REJECTED` and `contact_add_by_username_core` refreshes an expired active JWT before calling the RPC.

## Local Verification

- Commands run: `cargo test --manifest-path src-tauri/Cargo.toml` → passed (all 21 unit and integration tests across 8 test binaries, 0 failed).
- Manual checks: None (remote live Supabase not queried; verified against local mock HTTP server in `auth_refresh_tests.rs`).

## Deviations from Assessment

- Extended `ensure_active_session` usage across async handlers in `conversations.rs` and `messages.rs` (in addition to `auth.rs`, `contacts.rs`, and `mod.rs`) so all long-running remote Supabase calls benefit from automatic JWT refresh.
- Did not reconnect `RealtimeManager` after mid-session token refresh (`RealtimeManager` authenticates on initial WebSocket join).

## Follow-ups

- Run `/speckit-bug-test slug=contact-search-invalid-response` (and optionally test live login/restore with an expired local `session.dpapi`).
