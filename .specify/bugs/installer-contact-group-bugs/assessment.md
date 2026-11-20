# Bug Assessment: NSIS Upgrade Uninstall Failure and Direct/Group Conversation Creation RLS Failure

- **Slug**: installer-contact-group-bugs
- **Created**: 2026-11-20
- **Source**: pasted text
- **Verdict**: valid
- **Severity**: critical

## Report (verbatim or summarized)

User reported three issues with three attached screenshots:

1. **Bug 1 (Installer upgrade failure)**: "Bug when update the app, the installer cannot uninstall the old version" — Screenshot 1 shows the NSIS `Private Talk Setup` window on the **Already Installed** page with *"Uninstall before installing"* selected and a modal alert: `"Unable to uninstall!"`.
2. **Bug 2 (Clicking a contact does not open a chat)**: "Click on a contact, it does not open a chat?" — Screenshot 2 shows two contacts (`Cam 10 Tú` and `Cubu69`) in the sidebar `CONTACTS (2)` row while `CONVERSATIONS` remains empty (`"No conversations yet. Select a contact or create a group."`) and the main stage remains on the empty workspace view.
3. **Bug 3 (Creating a group chat fails with conflict error)**: "Create a group chat it show the error message like the attached image." — Screenshot 3 shows the **New Group Chat** drawer with group name `"Dead"`, two contacts checked (`Cam 10 Tú (@lhtu)`, `Cubu69 (@cubu69)`), and a red error banner: `"conflict: conversation creation failed"`.

## Symptom

1. **Bug 1 (NSIS Updater / Installer)**: When upgrading Private Talk (either via the in-app updater or by running a new NSIS setup executable over an existing installation), the installer presents the interactive **Already Installed** page instead of performing an in-place update. Selecting the default *"Uninstall before installing"* option fails with `"Unable to uninstall!"`, and subsequent clicks on **Next** continue to fail because the uninstaller already deleted the `UninstallString` registry key before failing the executable removal check.
2. **Bug 2 & Bug 3 (Direct & Group Conversation Creation)**: Creating a new 1-to-1 direct chat (by clicking a contact pill in the sidebar) or creating a new group chat fails in Supabase PostgreSQL with an RLS policy rejection on `public.conversations` / `public.conversation_members`, which `SupabaseClient::create_conversation` maps to `conflict: conversation creation failed`. In `GroupManageDrawer`, this error is caught and displayed in a red banner; in `Sidebar`, `onStartDirectChat` has no `try/catch` or error display, so clicking a contact silently fails with an unhandled promise rejection.

## Reproduction

### Bug 1: NSIS Upgrade "Unable to uninstall!"
1. Install an older version of Private Talk (e.g., `v0.2.1`) via the Windows NSIS installer.
2. Trigger an update to `v0.2.2` in-app (or launch `PrivateTalk_0.2.2_x64-setup.exe` while the older version is installed/closing).
3. On the **Already Installed** page, leave *"Uninstall before installing"* selected and click **Next >**.
4. Observe the `"Unable to uninstall!"` error dialog.

### Bug 2: Clicking a Contact Does Not Open a Chat
1. Log in to Private Talk connected to Supabase and add a mutual contact so the contact chip appears under `CONTACTS`.
2. Click the contact chip in the sidebar (`Sidebar.tsx`).
3. Observe that no conversation opens, `CONVERSATIONS` remains empty, and no error feedback is shown in the UI.

### Bug 3: Creating a Group Chat Shows `conflict: conversation creation failed`
1. Click the **Create group chat** icon in the sidebar header to open `New Group Chat`.
2. Enter a valid group name (e.g., `"Dead"`), select one or more contacts, and click **Create Encrypted Group**.
3. Observe the red error banner: `"conflict: conversation creation failed"`.

## Suspected Code Paths

- `src-tauri/src/updater/mod.rs:504-524` (`default_windows_installer_launcher`) — spawns the downloaded NSIS installer via `std::process::Command::new(installer_path).spawn()` without passing Tauri's NSIS update flags (`/UPDATE`, `/P`, `/R`).
- `src-tauri/src/commands/updater.rs:29-50` (`update_install`) — spawns the NSIS installer before the app exits (`tokio::time::sleep(Duration::from_millis(250)).await; exit_app.exit(0);`), allowing the installer/uninstaller to race with the still-running `private-talk.exe` and `msedgewebview2.exe` processes.
- `src-tauri/windows/nsis-hooks.nsh:1-4` — defines `NSIS_HOOK_POSTINSTALL` but lacks `NSIS_HOOK_PREINSTALL` / `NSIS_HOOK_PREUNINSTALL` hooks to wait for or terminate lingering `private-talk.exe` processes and ensure `$INSTDIR\private-talk.exe` is unlocked before `Section Uninstall` runs `Delete "$INSTDIR\${MAINBINARYNAME}.exe"`.
- `supabase/migrations/0001_private_talk_schema.sql:310-344` (`conversations_select_member`, `conversations_insert_creator`, `conversation_members_insert_contact_or_self`) — contains a circular RLS dependency preventing new conversation creation.
- `src-tauri/src/supabase/postgrest.rs:397-483` (`SupabaseClient::create_conversation`) — performs conversation creation across three separate non-atomic REST calls (`POST /rest/v1/conversations` with `Prefer: return=representation`, `POST /rest/v1/conversation_members`, `POST /rest/v1/conversation_member_keys`) and maps any non-2xx response from `POST /rest/v1/conversations` to `SupabaseError::Conflict("conversation creation failed")`.
- `src/components/layout/Sidebar.tsx:134-160` and `src/App.tsx:397-401` (`onStartDirectChat`) — invokes `tauriClient.conversationStartDirect(contactId)` without catching or displaying errors when direct conversation creation fails.

## Root Cause Hypothesis

**High confidence.**

### 1. NSIS Installer Upgrade Failure (Bug 1)
There are two compounding defects:
- **Missing `/UPDATE` flag when launching from the in-app updater**: Tauri v2's NSIS template (`installer.nsi`) checks `/UPDATE` (`$UpdateMode = 1`) in `PageLeaveReinstall` (`${If} $UpdateMode = 1 Goto reinst_done ${EndIf}`) specifically to bypass running `uninstall.exe` during updates and overwrite files in-place. Because `default_windows_installer_launcher` in `src-tauri/src/updater/mod.rs:508` spawns the installer with no arguments, `$UpdateMode` is `0`, forcing the user onto the interactive **Already Installed** page with *"Uninstall before installing"* selected.
- **Process lock race in `reinst_uninstall` / `Section Uninstall`**: `update_install` (`src-tauri/src/commands/updater.rs:41-47`) launches the installer 250ms before calling `exit_app.exit(0)`. When `reinst_uninstall` runs `uninstall.exe _?=$4`, `Section Uninstall` runs `Delete "$INSTDIR\${MAINBINARYNAME}.exe"`. In NSIS, `Delete` is non-fatal when a file is still locked by a terminating process or WebView2 child process: it silently fails to delete `private-talk.exe`, continues executing `Section Uninstall`, and deletes the `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Private Talk` registry key (`DeleteRegKey SHCTX "${UNINSTKEY}"`). When `uninstall.exe` exits, `PageLeaveReinstall` checks `${If} $0 <> 0 ${OrIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"`, sees `private-talk.exe` still exists on disk, shows `"Unable to uninstall!"`, and calls `Abort`. Any subsequent click on **Next** then reads an empty `UninstallString` from the deleted registry key and fails immediately with `"Unable to uninstall!"`.

### 2. Direct & Group Conversation Creation Failure (Bug 2 & Bug 3)
Both direct chat creation (`conversation_start_direct_core`) and group chat creation (`conversation_create_group_core`) call `SupabaseClient::create_conversation` (`src-tauri/src/supabase/postgrest.rs:397`), which hits a circular Row-Level Security (RLS) deadlock in `supabase/migrations/0001_private_talk_schema.sql`:
1. Step 1 sends `POST /rest/v1/conversations` with `Prefer: return=representation` (`INSERT INTO public.conversations ... RETURNING *`). In PostgreSQL, `INSERT ... RETURNING *` requires the new row to satisfy both `FOR INSERT` (`conversations_insert_creator`) and `FOR SELECT` (`conversations_select_member`).
2. `conversations_select_member` requires `public.is_conversation_member(id, auth.uid())` to be `true`. Because `public.conversation_members` is not populated until Step 2, `is_conversation_member(id, auth.uid())` is always `false` during Step 1, causing PostgreSQL to reject the `INSERT` with HTTP `403` (`42501: new row violates row-level security policy for table "conversations"`), which `postgrest.rs:424` maps to `SupabaseError::Conflict("conversation creation failed")`.
3. Even if `Prefer: return=representation` is removed from Step 1, Step 2 (`POST /rest/v1/conversation_members`) evaluates `conversation_members_insert_contact_or_self`, which requires either `public.is_conversation_member(conversation_id, auth.uid())` (which is `STABLE` and returns `false` using the statement-start snapshot when 0 members exist) or `EXISTS (SELECT 1 FROM public.conversations conv WHERE conv.id = conversation_members.conversation_id AND (conv.host_id = auth.uid() OR NOT conv.is_group))`. Because that subquery runs under caller RLS, `SELECT 1 FROM public.conversations` is filtered by `conversations_select_member` (`is_conversation_member(id, auth.uid())`), which is also `false`.
4. When `create_conversation` returns `Err(SupabaseError::Conflict("conversation creation failed"))`, `GroupManageDrawer.tsx:57-58` catches and displays `"conflict: conversation creation failed"`, while `Sidebar.tsx:136` does not catch errors from `onStartDirectChat(c.id)`, making contact clicks appear to do nothing.

## Proposed Remediation

**Preferred**:

1. **Fix in-app update & NSIS uninstaller race (Bug 1)**:
   - In `src-tauri/src/updater/mod.rs` (`default_windows_installer_launcher`), pass `["/P", "/UPDATE", "/R"]` (or `["/UPDATE"]` if keeping interactive UI, though `/P /UPDATE /R` is Tauri's standard passive in-place update + auto-relaunch flags) when spawning the verified NSIS installer from the in-app updater.
   - In `src-tauri/windows/nsis-hooks.nsh`, add `NSIS_HOOK_PREINSTALL` and `NSIS_HOOK_PREUNINSTALL` macros that wait briefly / ensure `${MAINBINARYNAME}.exe` is no longer running or holding an image lock before `Section Install` or `Section Uninstall` touches `$INSTDIR\${MAINBINARYNAME}.exe` (for users who run the setup `.exe` manually and pick *"Uninstall before installing"*).

2. **Fix conversation creation RLS deadlock & make creation atomic (Bug 2 & Bug 3)**:
   - Add a new migration `supabase/migrations/0003_fix_conversation_creation_rls.sql` that:
     1. Defines a `SECURITY DEFINER` helper `public.can_bootstrap_conversation_member(conv_id uuid, uid uuid)` (or updates `conversations_select_member` / `conversation_members_insert_contact_or_self`) AND/OR adds an atomic `SECURITY DEFINER` RPC `public.create_conversation_with_keys(...)` that inserts the `conversations`, `conversation_members`, and `conversation_member_keys` rows in a single transaction while enforcing all security invariants (caller authenticated, direct pair deduplication, all added members are mutual contacts of `auth.uid()`, and distributor is `auth.uid()`).
     2. Also fixes the underlying RLS policies (`conversations_select_member` allowing `host_id = auth.uid()` and `conversation_members_insert_contact_or_self` using a `SECURITY DEFINER` check on `public.conversations` when `conversation_members` has no rows yet) so direct PostgREST table inserts also work without circular RLS failure.
   - Update `SupabaseClient::create_conversation` in `src-tauri/src/supabase/postgrest.rs` to call the atomic RPC (with fallback to `Prefer: return=minimal` + sequential member/key insert if needed) and keep `LocalLoopbackStore` behavior identical.
   - In `src/components/layout/Sidebar.tsx`, handle errors from `onStartDirectChat(c.id)` and display `searchError` (or a contact error banner) plus disable duplicate clicks while opening a direct chat so failures are never swallowed silently.

**Alternatives** (optional):
- *Alternative for Bug 2 & 3 (RLS policy fix only without RPC)*: Fix `conversations_select_member` and `conversation_members_insert_contact_or_self` in SQL and change `POST /rest/v1/conversations` to insert self into `conversation_members` before other members. Trade-off: still leaves conversation creation split across 3 non-atomic HTTP requests where a mid-flight network error can leave an orphaned `conversations` row. Combining the RLS policy fix with an atomic RPC (or atomic step ordering) is safer.

**Files likely to change**:
- `src-tauri/src/updater/mod.rs`
- `src-tauri/windows/nsis-hooks.nsh`
- `supabase/migrations/0003_fix_conversation_creation_rls.sql`
- `src-tauri/src/supabase/postgrest.rs`
- `src/components/layout/Sidebar.tsx`
- `specs/001-private-talk-chat/contracts/supabase-schema-and-realtime.md`

**Tests to add or update**:
- Unit test in `src-tauri/src/updater/mod.rs` (or `src-tauri/tests/`) verifying updater installer launcher arguments and fail-closed verification.
- Integration / adversarial tests in `src-tauri/tests/` verifying direct conversation creation, idempotent re-opening of an existing direct chat when clicking a contact, group conversation creation, and fail-closed rejection when adding non-contacts.

## Risks & Considerations

- **Supabase migration deployment**: Because `public.conversations` and `public.conversation_members` RLS policies live in the remote Supabase PostgreSQL database, `supabase/migrations/0003_fix_conversation_creation_rls.sql` must be applied to the Supabase project (`supabase db push` or SQL Editor) for the remote PostgREST backend to allow conversation creation.
- **Constitution compliance**: Any `SECURITY DEFINER` function added in `0003_fix_conversation_creation_rls.sql` must set `SET search_path = public`, validate `auth.uid() IS NOT NULL`, enforce mutual-contact checks on all invited members, and never accept or store plaintext keys (`ephemeral_pub_key = 32B`, `nonce = 12B`, `wrapped_key = 48B`, `signature = 64B`).

## Open Questions

- None. All three symptoms are directly reproducible from the current codebase and schema.
