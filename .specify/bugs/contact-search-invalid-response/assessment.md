# Bug Assessment: Contact Search Fails With "invalid response from backend" Due to Unrefreshed Expired Supabase JWT

- **Slug**: contact-search-invalid-response
- **Created**: 2026-11-20T11:37:00+07:00
- **Source**: pasted text (with user screenshot)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> "bug cannot find other contact"

Screenshot (`media_1795149161835_798e48fc.png`) shows the sidebar contact search bar with input `cubu69` and the red error message below it:
- Input: `cubu69`
- Error text: `invalid response from backend`

## Symptom

Searching for a contact username (e.g. `cubu69`) and clicking the Add Contact button fails with `invalid response from backend` instead of adding the contact or reporting `not found: No user found`. Expected behavior: valid usernames are added as mutual contacts (or report `not found: No user found` if absent), and restored or long-running DPAPI sessions automatically refresh expired Supabase JWTs using `supabase_refresh_token` (or fail closed back to the login screen if the refresh token is invalid).

## Reproduction

1. Log in to Private Talk against remote Supabase (`https://bhsansqjmllapeuypjrf.supabase.co`), which seals `DpapiProtectedSession` (`supabase_access_token` with 1-hour TTL and `supabase_refresh_token`) to `%LOCALAPPDATA%\PrivateTalk\session.dpapi`.
2. Wait until the 1-hour Supabase access token expires (verified in local `session.dpapi`: `exp = 1795109717 < now = 1795149358`) and relaunch Private Talk (or keep the app open past the 1-hour JWT expiration).
3. On startup, `App.tsx:130` calls `auth_restore_session` (`src-tauri/src/commands/auth.rs:190-224`), which calls `state.supabase.get_profile(&restored.supabase_access_token, restored.user_id)`.
4. Supabase PostgREST returns `HTTP 401 Unauthorized` with `{"code":"PGRST303","details":null,"hint":null,"message":"JWT expired"}`, which `get_profile` (`src-tauri/src/supabase/postgrest.rs:186-188`) maps to `Err(SupabaseError::NotFound("profile"))`.
5. `auth_restore_session_core` (`src-tauri/src/commands/auth.rs:209-218`) swallows the `Err(_)`, does not attempt to refresh the session via `restored.supabase_refresh_token`, stores the expired session into `state.session`, and returns `Ok(Some(dto))` so the main chat UI loads in an unauthenticated state.
6. Enter `cubu69` in the sidebar search input and click Add Contact (`src/components/layout/Sidebar.tsx:44-62` -> `contact_add_by_username` -> `rpc_add_mutual_contact` in `src-tauri/src/supabase/postgrest.rs:258-292`).
7. `POST /rest/v1/rpc/add_mutual_contact` returns `HTTP 401` (`{"code":"PGRST303","details":null,"hint":null,"message":"JWT expired"}`), which fails `resp.status().is_success()`, matches neither `"USER_NOT_FOUND"` nor `"CANNOT_ADD_SELF"`, and falls through to `Err(SupabaseError::InvalidResponse)` (`"invalid response from backend"`).

## Suspected Code Paths

- `src-tauri/src/commands/auth.rs:190-224` (`auth_restore_session_core`) — swallows `get_profile` errors on line `209` (`Err(_) => { ... return Ok(Some(dto)); }`) and never refreshes `restored.supabase_access_token` using `restored.supabase_refresh_token`.
- `src-tauri/src/supabase/auth.rs:35-162` (`SupabaseClient`) — implements `auth_signup` and `auth_signin`, but has no `auth_refresh` method (`POST /auth/v1/token?grant_type=refresh_token`) even though `DpapiProtectedSession` stores `supabase_refresh_token`.
- `src-tauri/src/commands/mod.rs:190-196` (`AppState::active_session`) — returns the cached in-memory `DpapiProtectedSession` without checking JWT expiration or refreshing expired tokens during active sessions.
- `src-tauri/src/supabase/postgrest.rs:258-292` (`SupabaseClient::rpc_add_mutual_contact`) — maps all non-2xx responses other than `404`, `"USER_NOT_FOUND"`, and `"CANNOT_ADD_SELF"` (including `401` `PGRST303 JWT expired` and `403` `NOT_AUTHENTICATED`) to `SupabaseError::InvalidResponse` (`"invalid response from backend"`).

## Root Cause Hypothesis

Confidence: **high**.

Supabase access tokens (`supabase_access_token`) expire after 1 hour (`exp = 1795109717` in `%LOCALAPPDATA%\PrivateTalk\session.dpapi`). `SupabaseClient` lacks a token-refresh endpoint (`POST /auth/v1/token?grant_type=refresh_token`), and `auth_restore_session_core` (`src-tauri/src/commands/auth.rs:209-218`) ignores `get_profile` failures when restoring `session.dpapi`, placing the expired JWT into `state.session`. Every subsequent PostgREST/RPC call — including `rpc_add_mutual_contact` when searching for `cubu69` — fails with `HTTP 401` (`{"code":"PGRST303","message":"JWT expired"}`), which `rpc_add_mutual_contact` misclassifies as `SupabaseError::InvalidResponse` (`"invalid response from backend"`).

## Proposed Remediation

**Preferred**:
1. **Add `SupabaseClient::auth_refresh` in `src-tauri/src/supabase/auth.rs`**:
   - Call `POST {cfg.url}/auth/v1/token?grant_type=refresh_token` with header `apikey: cfg.anon_key` and JSON body `{"refresh_token": refresh_token}`.
   - Return updated `AuthSessionTokens` (`user_id`, `access_token`, `refresh_token`) or `SupabaseError::AuthRejected("session expired")` on non-2xx.
   - In local loopback mode, return a fresh local token pair if the user exists in `local_store.profiles`.
2. **Refresh expired/expiring tokens in `auth_restore_session_core` and active sessions**:
   - In `auth_restore_session_core` (`src-tauri/src/commands/auth.rs:190-224`), if `get_profile` fails or the JWT `exp` claim is expired/within 60s of expiry, call `state.supabase.auth_refresh(&restored.supabase_refresh_token)`, update `restored.supabase_access_token` and `restored.supabase_refresh_token`, and persist the refreshed session via `save_session_to_path(&state.session_path, &restored)`.
   - If `auth_refresh` fails with `SupabaseError::AuthRejected`, fail closed: delete the stale DPAPI session file (`delete_session_at_path(&state.session_path)`), clear `state.session`, and return `Ok(None)` so the user is returned to the login screen instead of entering a broken session.
   - Add an async token-refresh check on `AppState` (or refresh when JWT `exp` is expired/near-expiry before remote Supabase calls) so long-running sessions (>1 hour) also rotate tokens seamlessly and update `RealtimeManager`.
3. **Map `401` / `JWT expired` / `NOT_AUTHENTICATED` to `SupabaseError::AuthRejected` in `src-tauri/src/supabase/postgrest.rs`**:
   - In `rpc_add_mutual_contact` (and PostgREST helpers), map `401` or bodies containing `"PGRST303"` / `"JWT expired"` / `"NOT_AUTHENTICATED"` to `SupabaseError::AuthRejected("session expired, please log in again")` rather than `SupabaseError::InvalidResponse`.

**Files likely to change**:
- `src-tauri/src/supabase/auth.rs`
- `src-tauri/src/supabase/postgrest.rs`
- `src-tauri/src/commands/auth.rs`
- `src-tauri/src/commands/mod.rs` (and callers if `active_session` refreshes expiring JWTs)
- `src-tauri/tests/` (adversarial/negative tests for expired JWT restore and refresh failure fail-closed behavior)

**Tests to add or update**:
- Integration test in `src-tauri/tests/` verifying that restoring a session with an expired access token refreshes tokens via `auth_refresh` (or fails closed to `Ok(None)` and wipes `session.dpapi` when refresh is rejected).
- Negative test verifying `rpc_add_mutual_contact` maps HTTP `401` / `JWT expired` to `AUTH_REJECTED` instead of `INVALID_RESPONSE`.

## Risks & Considerations

- **Single-use refresh tokens**: Supabase rotates refresh tokens on every `grant_type=refresh_token` request. Concurrent refresh calls must be serialized (e.g., via a mutex/lock around token refresh) and immediately persisted to `session.dpapi` so a race cannot reuse an already-consumed refresh token.
- **Zero-leakage logging**: Never log `access_token` or `refresh_token` in `tracing` events or `AppError`/`SupabaseError` messages (Constitution Principle I).

## Open Questions

- None — root cause is directly reproduced against `%LOCALAPPDATA%\PrivateTalk\session.dpapi` (`exp = 1795109717`, PostgREST `HTTP 401 PGRST303: JWT expired`).
