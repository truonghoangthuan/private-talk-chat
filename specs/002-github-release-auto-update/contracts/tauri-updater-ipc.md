# Contract: Tauri Updater IPC & UI Integration

**Feature**: `002-github-release-auto-update`  
**Date**: 2026-11-19  
**Boundary**: WebView2 TypeScript UI (`src/`) <-> Tauri v2 Rust Core (`src-tauri/`)

---

## 1. Security Invariants of the Updater IPC Boundary

1. **Public Verification Key Only in Client**: Only the 32-byte `Ed25519` public verification key is compiled into the client binary. The private signing key never exists in source control or client binaries.
2. **Fail-Closed Verification Before Disk Write**: Downloaded installer bytes remain in Rust memory until byte length, `SHA-256` digest, and `Ed25519` signature match the trusted public key. Failed verification discards all downloaded bytes, transitions to `phase: "verification_failed"`, and prevents execution.
3. **Stable Releases & Anti-Downgrade**: Draft releases (`draft: true`), prereleases (`prerelease: true`), malformed semver tags, and versions `<= current_version` never trigger an installable update.
4. **Zero Credential Leakage**: Updater HTTP requests send no cookies, Supabase auth headers, profile identifiers, or user data, and WebView CSP `connect-src` remains unchanged.
5. **DPAPI Session Preservation**: Updating does not alter `%LOCALAPPDATA%\PrivateTalk\<profile>\session.dpapi`.

---

## 2. Tauri Commands (`invoke`)

| Command | Arguments | Return Type | Behavior |
|---------|-----------|-------------|----------|
| `update_get_status` | `{}` | `Result<UpdateStatusDto, AppError>` | Returns the current `UpdateStatusDto` snapshot including `current_version`. |
| `update_check` | `{ silent?: boolean }` | `Result<UpdateStatusDto, AppError>` | Checks `latest.json` on GitHub Releases. Validates `draft == false`, `prerelease == false`, `Ed25519` signature on manifest metadata, and strict `MAJOR.MINOR.PATCH` semver. Emits `updater:state_changed`. When `silent === true`, network errors revert quietly to `idle` and resolve `Ok(status)`. When `silent !== true`, network errors transition to `error`; signature/tamper errors always fail closed to `verification_failed`. |
| `update_install` | `{}` | `Result<UpdateStatusDto, AppError>` | Guards against concurrent updates (`UPDATE_IN_PROGRESS`). Uses verified `Available` manifest (or re-fetches and verifies), downloads installer bytes while emitting `updater:state_changed` progress updates (`0..=100`), verifies size + `SHA-256` + `Ed25519` in memory, writes verified installer to `%LOCALAPPDATA%\PrivateTalk\updates\<installer_file_name>`, launches installer process on Windows, and exits/restarts the running app cleanly. |

### Error Codes (`AppError.code`)

| Code | Trigger Condition |
|------|-------------------|
| `UPDATE_IN_PROGRESS` | `update_check` or `update_install` invoked while check, download, or install is already running. |
| `UPDATE_NOT_AVAILABLE` | `update_install` invoked when no newer verified release is available. |
| `UPDATE_NETWORK_ERROR` | Network failure, DNS/TLS error, or non-2xx HTTP status when `silent === false` or during installer download. |
| `UPDATE_SIGNATURE_INVALID` | Manifest or package `Ed25519` signature invalid, missing, or malformed. |
| `UPDATE_HASH_MISMATCH` | Downloaded installer bytes `SHA-256` or byte length differs from signed manifest. |
| `UPDATE_MANIFEST_INVALID` | Malformed JSON, draft/prerelease flag set, non-HTTPS URL, or invalid semver/filename. |
| `UPDATE_INSTALL_FAILED` | Failed to write verified installer to `updates\` or failed to spawn installer process. |

---

## 3. Tauri Real-Time Events (Rust -> WebView UI)

| Event Name | Payload DTO | Trigger Condition |
|------------|-------------|-------------------|
| `updater:state_changed` | `UpdateStatusDto` | Emitted on every phase transition (`checking`, `up_to_date`, `available`, `downloading` throttled progress ticks, `installing`, `verification_failed`, `error`, `idle`). |

---

## 4. TypeScript Client Contract (`src/lib/types.ts` & `src/lib/tauri-client.ts`)

```ts
export type UpdatePhase =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "installing"
  | "verification_failed"
  | "error";

export interface UpdateStatusDto {
  phase: UpdatePhase;
  current_version: string;
  latest_version: string | null;
  release_notes: string | null;
  published_at: string | null;
  progress_percent: number | null;
  downloaded_bytes: number | null;
  total_bytes: number | null;
  error_code: string | null;
  error_message: string | null;
}
```

Required functions in `src/lib/tauri-client.ts`:
- `updateGetStatus(): Promise<UpdateStatusDto>`
- `updateCheck(silent?: boolean): Promise<UpdateStatusDto>`
- `updateInstall(): Promise<UpdateStatusDto>`
- `onUpdateStateChanged(handler: (status: UpdateStatusDto) => void): Promise<UnlistenFn>`

---

## 5. UI Placement & Interaction Contract (FR-001, FR-004, FR-008)

1. **Profile Settings Modal (`ProfileModal.tsx`)**:
   - Displays current version (`v{current_version}`), status badge, release notes summary (when `available` / `downloading` / `installing`), download progress bar (`{progress_percent}%`), fail-closed security warning alert on `verification_failed`, and primary `"Check for update"` / `"Update"` button disabled while `checking`, `downloading`, or `installing`.
2. **Left Navigation Rail (`NavRail.tsx`)**:
   - Compact update action button in the lower control cluster showing current/available indicator dot; clicking triggers `updateInstall()` when `available` or opens update check feedback (`updateCheck(false)`).
3. **Unauthenticated Login Screen (`AuthScreen.tsx`)**:
   - Compact bottom footer row displaying `v{current_version}`, `"Check for update"` trigger, and inline `"Update"` button + progress/security alert so users can update prior to signing in.
4. **Startup Notification Banner (`App.tsx`)**:
   - Runs `updateCheck(true)` once on app startup without blocking login or chat.
   - Displays a dismissible non-intrusive banner when `phase === "available"` with `"Update"` and `"Dismiss"` buttons; silent network failures remain invisible.
