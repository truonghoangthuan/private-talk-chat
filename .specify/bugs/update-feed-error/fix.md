# Bug Fix: Public Release Feed Access and Updater HTTP Status Diagnostics

- **Slug**: update-feed-error
- **Fixed**: 2026-11-20T10:01:34+07:00
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Resolved the in-app update HTTP 404 failure by switching `truonghoangthuan/private-talk-chat` to public visibility (matching `specs/002-github-release-auto-update/spec.md`) so unauthenticated clients can fetch `latest.json` and release installers, and updated `HttpUpdateFeedTransport` to log and surface numeric HTTP status codes without leaking URL credentials.

## Changes

| File / Resource | Change | Notes |
|---|---|---|
| GitHub repository `truonghoangthuan/private-talk-chat` | visibility changed (`PRIVATE` → `PUBLIC`) | Enables unauthenticated `GET` to `/releases/latest/download/latest.json` and installer assets for existing `v0.2.0` installs and future releases |
| `src-tauri/src/updater/mod.rs` | modified | Extracted `check_http_success` helper used by `HttpUpdateFeedTransport::fetch_manifest` and `download_installer` to log numeric HTTP status via `tracing::warn!` and return `"<subject> returned unexpected HTTP <code>."` |
| `src-tauri/tests/updater_security_tests.rs` | modified (added test) | Added `http_transport_surfaces_status_without_leaking_credentials_and_respects_silent_flag` covering real HTTP 404/403 transport errors, zero URL credential leakage, and `silent = true` vs `silent = false` behavior |

## Diff Highlights

```rust
fn check_http_success(resp: &reqwest::Response, subject: &str) -> Result<(), AppError> {
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let code = status.as_u16();
    tracing::warn!(status = code, subject, "Update HTTP request failed");
    Err(AppError::new(
        "UPDATE_NETWORK_ERROR",
        format!("{subject} returned unexpected HTTP {code}."),
    ))
}
```

## Tests Added or Updated

- `src-tauri/tests/updater_security_tests.rs::http_transport_surfaces_status_without_leaking_credentials_and_respects_silent_flag` — verifies `HttpUpdateFeedTransport::fetch_manifest` (404) and `download_installer` (403) include the numeric HTTP status in `AppError.message` without leaking embedded URL credentials/query parameters, and verifies `UpdaterManager::check_for_updates` suppresses `UPDATE_NETWORK_ERROR` to `Idle` when `silent = true` while surfacing `Error` with HTTP `404` when `silent = false`.

## Local Verification

- Commands run:
  - `cargo test --manifest-path src-tauri/Cargo.toml` → passed (`private_talk_lib`: 1 passed; `crypto_negative_tests`: 4 passed; `dpapi_roundtrip_tests`: 3 passed; `group_epoch_rotation_tests`: 2 passed; `replies_and_pins_tests`: 2 passed; `updater_security_tests`: 5 passed; 0 failed).
  - `gh repo edit truonghoangthuan/private-talk-chat --visibility public --accept-visibility-change-consequences; gh repo view truonghoangthuan/private-talk-chat --json visibility,url` → `visibility: "PUBLIC"`.
  - Unauthenticated HTTP check via `curl.exe`:
    - `https://github.com/truonghoangthuan/private-talk-chat/releases/latest/download/latest.json` → `http_code=200` (`version: 0.2.0`, `draft: False`, `prerelease: False`).
    - `https://github.com/truonghoangthuan/private-talk-chat/releases/download/v0.2.0/PrivateTalk_0.2.0_x64-setup.exe` → `http_code=200`.
- Manual checks: Desktop GUI click on **Check for update** was not executed in this headless session (covered in `/speckit-bug-test`).

## Deviations from Assessment

- None. Resolved the open clarification question with the user before applying changes, keeping `DEFAULT_UPDATE_FEED_URL` and `.github/workflows/release.yml` unchanged because the repository itself was made public.

## Follow-ups

- Run `/speckit-bug-test slug=update-feed-error` (and verify **Check for update** in the running desktop app transitions from `error` to `Up to date` on `v0.2.0`).
- Ship the Rust HTTP diagnostic enhancement in the next release tag (`v0.2.1` or `v0.3.0`); existing `v0.2.0` installs immediately regain working updates against the now-public feed URL.
