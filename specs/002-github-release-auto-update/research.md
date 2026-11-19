# Phase 0 Research: GitHub Release Distribution and In-App Auto-Update

**Feature**: `002-github-release-auto-update`  
**Date**: 2026-11-19  
**Stack Direction**: Rust Core Updater (`Tauri v2`) + GitHub Releases Static Manifest (`latest.json`) + GitHub Actions CI/CD

---

## 1. In-App Update Architecture in Rust Core (Zero New Runtime Dependencies)

- **Decision**: Implement the updater engine (`src-tauri/src/updater/mod.rs`) and Tauri IPC handlers (`src-tauri/src/commands/updater.rs`) directly in Rust using crates already declared in `src-tauri/Cargo.toml` (`reqwest` with `rustls-tls`, `ed25519-dalek`, `sha2`, `base64`, `hex`, `serde`, `serde_json`, `chrono`, `tokio`, `zeroize`). Keep `src/` WebView UI as pure presentation interacting exclusively through `src/lib/tauri-client.ts` and `src/lib/types.ts`.
- **Rationale**:
  - Preserves the `AGENTS.md` boundary: 100% of network transport, cryptographic verification, and OS installer execution runs in compiled Rust rather than JavaScript.
  - Zero new Cargo or npm dependencies, eliminating supply-chain surface expansion (Constitution Principle III & Development Gate: Simplicity & Minimal Attack Surface).
  - Keeps `src-tauri/tauri.conf.json` CSP (`connect-src`) and `src-tauri/capabilities/default.json` permissions tightly scoped because the WebView never issues external HTTPS requests to GitHub.
  - Supports deterministic offline unit, integration, and adversarial fail-closed testing in `src-tauri/tests/updater_security_tests.rs` via an injectable release feed abstraction (consistent with `LocalLoopbackStore` in `src-tauri/src/supabase/`).
- **Alternatives Considered**:
  - *Fetching GitHub Releases API from WebView TypeScript*: Rejected because it violates `AGENTS.md` architecture boundaries, forces widening WebView CSP `connect-src`, and cannot verify signatures or launch installers safely.
  - *Adding third-party updater crates or plugins*: Rejected because existing `reqwest`, `ed25519-dalek`, and `sha2` crates already cover HTTPS download, SHA-256 hashing, and Ed25519 verification in minimal auditable Rust code with strict in-memory pre-write validation.

---

## 2. Cryptographic Package Verification & Fail-Closed Security Model (FR-005, SC-003)

- **Decision**: Verify every update package with an embedded trusted `Ed25519` public key (`32` bytes via compile-time `PRIVATE_TALK_UPDATER_PUBKEY` with a deterministic default key) over a canonical message binding target `MAJOR.MINOR.PATCH` version, installer `SHA-256` digest, and exact installer byte length (`privatetalk-update-v1\n{version}\n{installer_sha256}\n{installer_size_bytes}`). Stream the installer download into a bounded in-memory buffer (`MAX_INSTALLER_BYTES = 104_857_600`, 100 MiB) and verify byte length, `SHA-256`, and `Ed25519` signature in Rust memory *before* writing any installer binary to disk.
- **Rationale**:
  - Guarantees unsigned, tampered, truncated, or corrupted installer bytes never reach disk as an executable file (fail-closed behavior per Constitution Principle I, III, IV).
  - Strict Semantic Version parsing (`MAJOR.MINOR.PATCH` unsigned integers only; rejects leading zeros, pre-release suffixes, and build metadata) plus monotonic check (`remote_version > current_version`) prevents downgrade/rollback attacks and pre-release leakage.
  - Rejects non-HTTPS installer URLs (except loopback HTTP in explicit automated test configurations) and rejects path-traversal characters in `installer_file_name`.
- **Alternatives Considered**:
  - *Writing installer directly to `%TEMP%` and verifying post-download*: Rejected because partial or tampered executable bytes would touch disk prior to verification.
  - *Relying on GitHub HTTPS/TLS transport alone without `Ed25519` verification*: Rejected because Constitution Principle IV and FR-005 require cryptographic authenticity against a maintainer-controlled signing key.

---

## 3. Stable-Only GitHub Releases Feed & Automated Release Pipeline (FR-002, FR-007, SC-005)

- **Decision**:
  - Publish a signed `latest.json` manifest as an asset on GitHub Releases (`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`, overridable for testing via `PRIVATE_TALK_UPDATE_URL`). GitHub's `/releases/latest/download/` route automatically resolves exclusively to the latest published **non-draft, non-prerelease** release. Rust also validates `draft == false`, `prerelease == false`, and strict `MAJOR.MINOR.PATCH` format.
  - Automate build, verification, signing, and release publication via `.github/workflows/release.yml` triggered on `push.tags: ['v*.*.*']` and `workflow_dispatch`. The workflow:
    1. Enforces tag-to-version alignment (`Cargo.toml`, `tauri.conf.json`, `package.json`).
    2. Runs `npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml` (Constitution Principle V gate).
    3. Fails closed if `PRIVATE_TALK_UPDATER_SIGNING_KEY` secret is missing or invalid.
    4. Builds the Windows x64 NSIS installer (`npx tauri build --bundles nsis`).
    5. Executes a lightweight Rust signing binary (`src-tauri/src/bin/sign_release.rs`) that computes `SHA-256`, signs the canonical payload with `ed25519-dalek`, and emits `<installer>.sig` + `latest.json`.
    6. Publishes `PrivateTalk_<version>_x64-setup.exe`, `PrivateTalk_<version>_x64-setup.exe.sig`, and `latest.json` to the GitHub Release.
- **Rationale**: Sharing `updater` serialization and `Ed25519` primitives between `sign_release` and the client verifier eliminates cross-tool signature encoding bugs while remaining self-contained in Rust.
- **Alternatives Considered**:
  - *Polling the unauthenticated GitHub REST API `/releases/latest` JSON directly without a signed manifest*: Rejected because GitHub API responses are unsigned, rate-limited (60 req/hr per IP), and lack the detached cryptographic signature required by FR-005.
  - *Using OpenSSL/PowerShell scripts for CI signing*: Rejected to avoid format drift between signing and Rust verification.

---

## 4. Windows DPAPI Session Preservation Across In-Place Upgrades (FR-006, SC-004)

- **Decision**: Write verified update installers to `%LOCALAPPDATA%\PrivateTalk\updates\<installer_file_name>` and launch the Windows NSIS installer process without touching `%LOCALAPPDATA%\PrivateTalk\session.dpapi` or `%LOCALAPPDATA%\PrivateTalk\<profile>\session.dpapi`. Clean up stale installers in `updates\` after successful startup of the new version.
- **Rationale**:
  - Tauri's Windows NSIS installer updates application binaries under the Windows per-user install location while preserving `%LOCALAPPDATA%\PrivateTalk\`.
  - Windows DPAPI (`CryptProtectData` in `src-tauri/src/platform/dpapi.rs`) binds ciphertext to the current Windows user logon credentials, not the executable version or path, so version `N+1` restores the active authenticated session and E2EE keys via `auth_restore_session` immediately on restart.
- **Alternatives Considered**:
  - *Storing installer inside `%LOCALAPPDATA%\PrivateTalk\` root or clearing application data during NSIS uninstall*: Rejected because deleting `%LOCALAPPDATA%\PrivateTalk\` would wipe `session.dpapi` and force re-authentication.

---

## 5. Non-Intrusive UI Integration Across Login, NavRail, and Profile Settings (FR-001, FR-004, FR-008)

- **Decision**:
  - Run a non-blocking startup check (`update_check({ silent: true })`) once on initial mount in `src/App.tsx`. When `silent: true`, transient network errors silently return `idle` without alerting the user; manual checks (`silent: false`) surface clear error feedback.
  - Share a single `UpdateStatusDto` state and `updater:state_changed` listener in `App.tsx`, surfacing controls in all required locations:
    1. **`src/components/modals/ProfileModal.tsx`**: "Application Update" section showing installed version (`vX.Y.Z`), current status (`idle`, `checking`, `up_to_date`, `available`, `downloading` progress bar, `installing`, `verification_failed` red security warning, `error`), release notes summary, `"Check for update"`, and `"Update"` action button.
    2. **`src/components/layout/NavRail.tsx`**: Compact bottom rail update icon button displaying status badge dot when an update is available and opening/triggering update actions.
    3. **`src/components/modals/AuthScreen.tsx`**: Compact footer strip on the login/register card showing current version, `"Check for update"` button, inline `"Update"` button when available, progress indicator, and fail-closed warning state prior to login.
    4. **`src/App.tsx` Startup Banner**: Dismissible non-blocking banner when `phase === "available"`, offering `"Update"` and `"Later"`.
- **Rationale**: Centralizing updater state in `App.tsx` ensures consistent status across login, navigation rail, and settings modal with minimal component props and zero duplicated IPC polling.
- **Alternatives Considered**:
  - *Dedicated separate update window or independent component-local updater hooks*: Rejected because component-local hooks could issue duplicate concurrent update checks and violate the minimal 3-zone UI aesthetic.
