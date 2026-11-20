# Bug Assessment: In-App Update Check Fails With HTTP 404 on Private Repository Feed

- **Slug**: update-feed-error
- **Created**: 2026-11-20T09:53:00+07:00
- **Source**: pasted text (with user screenshot)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> "The check for update feature is broken, it only show the error message like this image."

Screenshot (`media_1795141924347_90cbf66f.png`) shows the **Application Update** section inside the Profile Settings modal:
- Installed version: `Installed v0.2.0`
- Control: `Check for update` button
- Error banner: `Release feed returned an unexpected HTTP status.`

## Symptom

Clicking **Check for update** in Bloop v0.2.0 always transitions the updater into the `error` phase and displays `Release feed returned an unexpected HTTP status.`, even when a published `v0.2.0` GitHub Release with `latest.json` exists. Expected behavior: the client fetches `latest.json`, verifies its Ed25519 signature, and reports `Up to date` (when running `v0.2.0`) or `Available` (when a newer stable release exists).

## Reproduction

1. Launch Bloop v0.2.0 (built with the default `DEFAULT_UPDATE_FEED_URL` or CI `PRIVATE_TALK_UPDATE_URL`).
2. Open **Profile Settings** (or use the left navigation rail / login screen update trigger) and click **Check for update** (invoking `update_check(silent = false)` from `src/App.tsx:72-78`).
3. Rust `HttpUpdateFeedTransport::fetch_manifest` sends an unauthenticated HTTPS `GET` to `https://github.com/truonghoangthuan/private-talk-chat/releases/latest/download/latest.json`.
4. Because `truonghoangthuan/private-talk-chat` is a private GitHub repository (`isPrivate: true`), GitHub returns `HTTP 404 Not Found` (reproduced via unauthenticated HTTPS request and GitHub REST API).
5. `HttpUpdateFeedTransport::fetch_manifest` rejects non-2xx responses with `"Release feed returned an unexpected HTTP status."` (`src-tauri/src/updater/mod.rs:428-433`), which `ProfileModal.tsx:245-249` renders in red.

Note: `App.tsx:157` also calls `updateCheck(true)` on startup; `UpdaterManager::check_for_updates` suppresses `UPDATE_NETWORK_ERROR` when `silent == true` (`src-tauri/src/updater/mod.rs:683-691`), so the failure only surfaces visibly on manual checks.

## Suspected Code Paths

- `src-tauri/src/updater/mod.rs:17-18` (`DEFAULT_UPDATE_FEED_URL`) — hardcodes `https://github.com/truonghoangthuan/private-talk-chat/releases/latest/download/latest.json`, which requires public unauthenticated release access.
- `src-tauri/src/updater/mod.rs:420-433` (`HttpUpdateFeedTransport::fetch_manifest`) — issues an unauthenticated `GET` and maps every non-2xx status code to the generic message `"Release feed returned an unexpected HTTP status."` without surfacing the HTTP status code (`404`) in logs or `AppError`.
- `src-tauri/src/updater/mod.rs:448-465` (`HttpUpdateFeedTransport::download_installer`) — likewise performs an unauthenticated `GET` against `manifest.installer_url` (`https://github.com/truonghoangthuan/private-talk-chat/releases/download/v0.2.0/PrivateTalk_0.2.0_x64-setup.exe`) and maps any non-2xx response to `"Update download returned an unexpected HTTP status."`.
- `.github/workflows/release.yml:93,99,120` — compiles `PRIVATE_TALK_UPDATE_URL` and signs `installer_url` pointing directly to `github.com/${{ github.repository }}/releases/...`, which fails unauthenticated requests while the repository is private.
- `specs/002-github-release-auto-update/spec.md:107` — documents the unmet assumption: *"Public GitHub Releases Feed: Published releases and update manifests are hosted on a publicly reachable GitHub Releases endpoint over HTTPS so end-user clients do not need a personal GitHub access token"*.

## Root Cause Hypothesis

Confidence: **high**.

`truonghoangthuan/private-talk-chat` is a private GitHub repository (`"isPrivate": true`), whereas the updater transport (`HttpUpdateFeedTransport`) and `.github/workflows/release.yml` assume a publicly reachable GitHub Releases feed (`specs/002-github-release-auto-update/spec.md:107`). Although release `v0.2.0` is published with `latest.json`, `PrivateTalk_0.2.0_x64-setup.exe`, and `.sig`, GitHub returns `404 Not Found` to unauthenticated HTTPS requests for both `latest.json` and `PrivateTalk_0.2.0_x64-setup.exe`. Because `fetch_manifest` collapses all non-2xx statuses into `"Release feed returned an unexpected HTTP status."`, the UI displays an opaque error with no indication of the `404` / private-repo failure.

## Proposed Remediation

**Preferred**:
1. **Publish release artifacts on a public HTTPS endpoint** (keep private source private or open the repo):
   - Either make `truonghoangthuan/private-talk-chat` public (matching `specs/002-github-release-auto-update/spec.md:107`), **or** publish only the release binaries (`latest.json`, `PrivateTalk_<ver>_x64-setup.exe`, `.sig`) to a dedicated public GitHub releases-only repository (or public HTTPS object storage / CDN) from `.github/workflows/release.yml`, and point `DEFAULT_UPDATE_FEED_URL`, `PRIVATE_TALK_UPDATE_URL`, and `sign_release --url` at that public URL.
2. **Surface the HTTP status code in updater diagnostics** in `src-tauri/src/updater/mod.rs`:
   - In `HttpUpdateFeedTransport::fetch_manifest` (`:428-433`) and `download_installer` (`:460-465`), log the numeric HTTP status (`tracing::warn!(status = resp.status().as_u16(), ...)`, keeping zero tokens/secrets in logs) and include the status code in `AppError.message` (e.g., `"Release feed returned unexpected HTTP 404."`) so future 404/403/5xx failures are immediately distinguishable.

**Alternatives**:
- *Authenticated proxy via Supabase Edge Function*: Proxy `latest.json` and installer downloads through a server-side endpoint holding a read-only release token, keeping GitHub Releases private. Trade-off: adds server infrastructure, egress cost, and a new failure point; unnecessary if a public releases-only repo or public static bucket is acceptable (and Ed25519 + SHA-256 verification in Rust already guarantees package authenticity regardless of host).
- *Never embed a GitHub PAT in the client binary*: Distributing any GitHub token inside the desktop app violates Constitution Principle I (extractable client credential).

**Files likely to change**:
- `.github/workflows/release.yml` (if publishing release assets to a separate public releases repo/bucket)
- `src-tauri/src/updater/mod.rs` (update `DEFAULT_UPDATE_FEED_URL` if distribution host changes; include numeric HTTP status code in `fetch_manifest` / `download_installer` errors and tracing)
- `src-tauri/tests/updater_security_tests.rs`

**Tests to add or update**:
- Unit/integration test in `src-tauri/tests/updater_security_tests.rs` verifying non-2xx transport errors preserve safe HTTP status code context without leaking URL credentials, and verifying `silent = true` vs `silent = false` behavior on HTTP 404.
- End-to-end smoke check after remediation: `Invoke-WebRequest` / `curl` unauthenticated against the configured `latest.json` and `installer_url` returns HTTP `200`, and clicking **Check for update** in `v0.2.0` transitions to `up_to_date` (or `available` on `v0.1.0`).

## Risks & Considerations

- **Security**: Do not embed GitHub tokens or relax HTTPS / Ed25519 / SHA-256 verification. Even on a public feed host, `validate_and_verify_manifest` and `verify_installer_bytes` enforce authenticity fail-closed.
- **Existing installed clients (`v0.2.0`)**: Clients already installed with `https://github.com/truonghoangthuan/private-talk-chat/releases/latest/download/latest.json` baked in at compile time can only self-update in place if **that exact URL becomes publicly readable** (making the repo public or keeping a public mirror only helps new builds unless `truonghoangthuan/private-talk-chat` itself becomes public, or `v0.2.0` users install the next release manually once).

## Open Questions

- [NEEDS CLARIFICATION: Should `truonghoangthuan/private-talk-chat` be made public, or do you want `.github/workflows/release.yml` to publish release assets to a separate public releases-only repository/bucket (requiring a one-time manual update for existing `v0.2.0` installs)?]
