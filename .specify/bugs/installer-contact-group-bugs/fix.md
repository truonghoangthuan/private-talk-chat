# Bug Fix: NSIS Upgrade Uninstall Failure and Direct/Group Conversation Creation RLS Failure

- **Slug**: installer-contact-group-bugs
- **Fixed**: 2026-11-20T15:39:30+07:00
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Fixed the Windows NSIS in-place upgrade flags and process-termination hooks, eliminated the circular Supabase RLS deadlock during conversation creation via an atomic `SECURITY DEFINER` RPC and updated RLS policies, and surfaced direct-chat creation errors in the sidebar UI.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src-tauri/src/updater/mod.rs` | modified | Added `windows_installer_args()` returning `["/P", "/UPDATE", "/R"]` and passed them in `default_windows_installer_launcher()`. |
| `src-tauri/windows/nsis-hooks.nsh` | modified | Added `NSIS_HOOK_PREINSTALL` and `NSIS_HOOK_PREUNINSTALL` to stop lingering `${MAINBINARYNAME}.exe` processes before install/uninstall. |
| `supabase/migrations/0003_fix_conversation_creation_rls.sql` | added | Added `can_bootstrap_conversation_member`, updated `conversations_select_member` / `conversation_members_insert_contact_or_self`, and added atomic `create_conversation_with_keys` RPC. |
| `src-tauri/src/supabase/postgrest.rs` | modified | Updated `SupabaseClient::create_conversation` to call `rpc/create_conversation_with_keys` with 404 fallback to REST table inserts. |
| `src/components/layout/Sidebar.tsx` | modified | Caught and displayed errors from `onStartDirectChat` and prevented duplicate clicks while starting a direct chat. |
| `specs/001-private-talk-chat/contracts/supabase-schema-and-realtime.md` | modified | Documented `can_bootstrap_conversation_member`, `create_conversation_with_keys`, and updated `conversations` SELECT policy. |
| `src-tauri/tests/updater_security_tests.rs` | added test | Added `windows_installer_launcher_uses_in_place_update_flags`. |
| `src-tauri/tests/conversation_creation_tests.rs` | added test | Added `direct_and_group_conversation_creation_and_fail_closed_non_contact`. |

## Diff Highlights (optional)

```rust
pub fn windows_installer_args() -> &'static [&'static str] {
    // /P passive, /UPDATE skips uninstall-before-install prompt, /R auto-relaunches after update.
    &["/P", "/UPDATE", "/R"]
}
```

## Tests Added or Updated

- `src-tauri/tests/updater_security_tests.rs::windows_installer_launcher_uses_in_place_update_flags` — verifies `windows_installer_args()` returns `["/P", "/UPDATE", "/R"]`.
- `src-tauri/tests/conversation_creation_tests.rs::direct_and_group_conversation_creation_and_fail_closed_non_contact` — verifies direct chat creation, idempotent re-opening, group creation, and fail-closed `CONTACT_REQUIRED` rejection for non-contacts.

## Local Verification

- Commands run: `npm run build` → exit 0 (`tsc && vite build` succeeded).
- Commands run: `cargo test --manifest-path src-tauri/Cargo.toml` → exit 0 (23 passed, 0 failed across unit and integration suites).

## Deviations from Assessment

- None.

## Follow-ups

- Apply `supabase/migrations/0003_fix_conversation_creation_rls.sql` to the remote Supabase project (`supabase db push` or SQL Editor).
- Build a Windows NSIS release (`npm run tauri build`) to verify the NSIS upgrade and manual uninstall-before-install flow on Windows.
