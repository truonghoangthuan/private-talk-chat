---
description: "Actionable, dependency-ordered task list for GitHub Release Distribution and In-App Auto-Update"
---

# Tasks: GitHub Release Distribution and In-App Auto-Update

**Input**: Design documents from `/specs/002-github-release-auto-update/`  
**Prerequisites**: [plan.md](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/plan.md) (required), [spec.md](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/spec.md) (required), [research.md](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/research.md), [data-model.md](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/data-model.md), [contracts/](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/contracts/)

**Tests**: Included for fail-closed signature verification, SHA-256 package validation, draft/prerelease/downgrade rejection, Windows DPAPI session preservation, and silent startup checks per Constitution Principle V (`Test-First Verification & Security Gates`) and `SC-003`.

**Organization**: Tasks are grouped by user story (`US1`–`US3`) to enable independent implementation, testing, and incremental MVP delivery.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (`[US1]`, `[US2]`, `[US3]`, used strictly in User Story phases)
- Include exact file paths and verbatim `data-model.md` constraints in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare build target configuration and shared TypeScript IPC contracts without adding new Cargo or npm runtime dependencies.

- [X] T001 Verify Windows NSIS bundler target and preserve strict WebView CSP (`connect-src`) and capabilities in `src-tauri/tauri.conf.json` and `src-tauri/capabilities/default.json`
- [X] T002 [P] Define `UpdatePhase` (`idle`, `checking`, `up_to_date`, `available`, `downloading`, `installing`, `verification_failed`, `error`; `Serialized in snake_case across Tauri IPC`) and `UpdateStatusDto` (`progress_percent`: `0..=100 download progress during downloading`) plus typed `updateGetStatus`, `updateCheck`, `updateInstall`, and `onUpdateStateChanged` IPC wrappers in `src/lib/types.ts` and `src/lib/tauri-client.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core Rust updater verification engine, state synchronization, and IPC registration required before any user story UI or CI pipeline work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Implement `SemanticVersion` (`major: u64`, `minor: u64`, `patch: u64`; `Unsigned base-10 integer, no leading zeros unless "0"`, rejecting pre-release/build suffixes), `ReleaseManifest` (`notes`: `1..=4000 chars (trimmed)`, `draft`: `Must be false`, `prerelease`: `Must be false`, `installer_url`: `https://... URL (loopback http://127.0.0.1 / http://localhost allowed only in automated test config)`, `installer_file_name`: `[A-Za-z0-9._-]+, ends with .exe, no /, \, or ..`, `installer_size_bytes`: `1..=104_857_600 (max 100 MiB)`, `installer_sha256`: `Exactly 64 lowercase hex chars ([0-9a-f]{64})`, `signature`: `Base64-encoded 64-byte Ed25519 signature`), canonical signing payload `privatetalk-update-v1\n{version}\n{installer_sha256}\n{installer_size_bytes}`, in-memory `Ed25519` + `SHA-256` verification, single-flight lock (`UPDATE_IN_PROGRESS`), verified staging in `%LOCALAPPDATA%\PrivateTalk\updates\`, and Windows installer launcher in `src-tauri/src/updater/mod.rs`
- [X] T004 Wire `UpdaterManager` into `AppState` and implement/register `update_get_status`, `update_check`, and `update_install` commands emitting `updater:state_changed` in `src-tauri/src/commands/updater.rs`, `src-tauri/src/commands/mod.rs`, and `src-tauri/src/lib.rs` (depends on T003)

**Checkpoint**: Foundation ready — user story implementation can now proceed.

---

## Phase 3: User Story 1 - Check for Updates and Install In-App Update (Priority: P1) 🎯 MVP

**Goal**: Enable users to manually check for stable GitHub Releases, review version and release notes, download and cryptographically verify the installer in Rust memory with progress feedback, fail closed on invalid signatures/hashes, and install/restart while preserving Windows DPAPI `session.dpapi`.

**Independent Test**: Run `0.1.0` against a local signed `0.2.0` test release feed, trigger `"Check for update"` from Profile Settings, NavRail, or Login screen, click `"Update"`, verify progress updates and in-memory verification launch the installer into `0.2.0` with `session.dpapi` intact, and verify tampered packages abort with `VerificationFailed` and zero unverified bytes written to disk.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T005 [P] [US1] Write automated fail-closed negative and session-preservation tests verifying rejection (`VerificationFailed`, zero bytes written to `%LOCALAPPDATA%\PrivateTalk\updates\`) of invalid `Ed25519` signatures, `SHA-256`/size mismatches, `draft: true`, `prerelease: true`, pre-release semver tags, non-HTTPS URLs, downgrade/equal versions (`UpToDate`), concurrent update lock (`UPDATE_IN_PROGRESS`), and intact `%LOCALAPPDATA%\PrivateTalk\<profile>\session.dpapi` in `src-tauri/tests/updater_security_tests.rs`

### Implementation for User Story 1

- [X] T006 [P] [US1] Add "Application Update" section showing installed version (`v{current_version}`), status feedback (`idle`, `checking`, `up_to_date`, `available`, `downloading` progress bar, `installing`, red `verification_failed` alert, `error`), release notes summary, `"Check for update"`, and `"Update"` action in `src/components/modals/ProfileModal.tsx` (depends on T002)
- [X] T007 [P] [US1] Add compact update action control with available-update badge indicator and tooltip in `src/components/layout/NavRail.tsx` (depends on T002)
- [X] T008 [P] [US1] Add compact version footer with `"Check for update"`, inline `"Update"` action, progress indicator, and fail-closed verification alert for unauthenticated users in `src/components/modals/AuthScreen.tsx` (depends on T002)
- [X] T009 [US1] Connect `updateGetStatus`, `updateCheck(false)`, `updateInstall`, and `onUpdateStateChanged` shared state in `src/App.tsx` and pass update props to `AuthScreen`, `AppShell`, `NavRail`, and `ProfileModal` (depends on T004, T006, T007, T008)

**Checkpoint**: User Story 1 is fully functional and independently testable as the in-app update MVP.

---

## Phase 4: User Story 2 - First-Time Installation and Release Publication via GitHub Releases (Priority: P2)

**Goal**: Provide a pure-Rust maintainer signing utility and automated GitHub Actions release workflow triggered by pushing `v*.*.*` tags (or manual dispatch) that enforces test/build gates and publishes the Windows installer, `.sig`, and signed `latest.json` manifest to GitHub Releases.

**Independent Test**: Run `sign_release` on a sample binary and verify the generated `latest.json` and `.sig` pass verification against the embedded client public key; trigger `.github/workflows/release.yml` on tag `v*.*.*` and verify automated tests pass and Windows installer, `.sig`, and `latest.json` are published as a non-draft, non-prerelease GitHub Release.

### Tests for User Story 2 ⚠️

- [X] T010 [P] [US2] Add roundtrip signing and key-mismatch negative tests verifying `sign_release_manifest` produces valid `latest.json` (`privatetalk-update-v1\n{version}\n{installer_sha256}\n{installer_size_bytes}`) and fails closed when signed with a mismatched private key in `src-tauri/tests/updater_security_tests.rs` (depends on T003)

### Implementation for User Story 2

- [X] T011 [P] [US2] Create pure-Rust release signing CLI binary (`--keygen`, `--sign-installer`) generating `Ed25519` keypairs, computing lowercase 64-char `SHA-256`, outputting detached `<installer>.sig`, and emitting signed `latest.json` matching `ReleaseManifest` schema in `src-tauri/src/bin/sign_release.rs` (depends on T003)
- [X] T012 [US2] Create GitHub Actions Windows release workflow triggered on `push.tags: ['v[0-9]+.[0-9]+.[0-9]+']` and `workflow_dispatch` enforcing tag-to-version alignment (`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `package.json`), `PRIVATE_TALK_UPDATER_SIGNING_KEY` validation, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npx tauri build --bundles nsis`, `sign_release`, and publishing `PrivateTalk_<version>_x64-setup.exe`, `.sig`, and `latest.json` to GitHub Releases in `.github/workflows/release.yml` (depends on T001, T011)

**Checkpoint**: User Story 2 enables automated signed Windows distribution on GitHub Releases.

---

## Phase 5: User Story 3 - Automatic Startup Update Notification (Priority: P3)

**Goal**: Quietly check for a newer stable GitHub Release on application launch without blocking login or chat, suppress transient network errors silently during background checks, and present a non-intrusive dismissible update prompt.

**Independent Test**: Launch `0.1.0` with a newer signed `0.2.0` release available and verify a non-blocking banner offers `"Update"` and `"Dismiss"`; launch offline and verify zero error dialogs appear while manual `"Check for update"` still surfaces network errors.

### Tests for User Story 3 ⚠️

- [X] T013 [P] [US3] Add automated unit tests verifying `update_check` with `silent: true` transitions transient network/HTTP errors silently to `Idle` while `silent: false` transitions to `Error` (`UPDATE_NETWORK_ERROR`), and `silent: true` still fails closed (`VerificationFailed`) on forged signatures in `src-tauri/tests/updater_security_tests.rs` (depends on T003)

### Implementation for User Story 3

- [X] T014 [US3] Trigger non-blocking `updateCheck(true)` once on startup in `src/App.tsx` and render a non-intrusive dismissible update notification banner with `"Update"` and `"Dismiss"` controls across authenticated (`src/components/layout/AppShell.tsx`) and login (`src/components/modals/AuthScreen.tsx`) views when `phase === "available"` (depends on T009)

**Checkpoint**: All user stories (`US1`, `US2`, `US3`) are complete and independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final security/observability audit and full build + quickstart verification across all artifacts.

- [X] T015 [P] Audit `src-tauri/src/updater/mod.rs`, `src-tauri/src/commands/updater.rs`, and `src-tauri/src/bin/sign_release.rs` to verify zero user credentials, Supabase tokens, or private signing keys appear in HTTP headers, tracing events, or error payloads (FR-009)
- [X] T016 Run `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, and local E2E scenarios in `specs/002-github-release-auto-update/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Starts immediately (`T001`, `T002` in parallel).
- **Phase 2 (Foundational)**: Depends on Phase 1 (`T003` -> `T004`) — **BLOCKS** all user stories.
- **Phase 3 (US1 - Manual Check & In-App Update, P1)**: Depends on Phase 2 (`T004` and `T002`).
- **Phase 4 (US2 - GitHub Releases CI & Signing, P2)**: Depends on `T001` and `T003`; independent of US1/US3 UI work.
- **Phase 5 (US3 - Startup Background Check & Banner, P3)**: Depends on `T003` (`T013`) and `T009` (`T014`).
- **Phase 6 (Polish)**: Depends on completion of Phases 3–5.

### User Story Dependency Graph

```text
Phase 1: Setup (T001, T002)
   │
   ▼
Phase 2: Foundational (T003 -> T004)
   ├──────────────────────────────────────┐
   ▼                                      ▼
Phase 3: US1 (P1 MVP)                  Phase 4: US2 (P2 Release CI & Signer)
(T005, T006, T007, T008 -> T009)       (T010, T011 -> T012)
   │                                      │
   ▼                                      │
Phase 5: US3 (P3 Startup Banner)          │
(T013, T014)                              │
   └──────────────────┬───────────────────┘
                      ▼
               Phase 6: Polish (T015, T016)
```

### Parallel Opportunities

- **Setup (Phase 1)**: `T001` and `T002` touch isolated files (`tauri.conf.json`/`default.json` vs `src/lib/*`) and run in parallel.
- **User Story 1 (Phase 3)**: `T005` (Rust security tests), `T006` (`ProfileModal.tsx`), `T007` (`NavRail.tsx`), and `T008` (`AuthScreen.tsx`) run in parallel before `T009` wires `src/App.tsx`.
- **User Story 2 (Phase 4)**: `T010` (signing roundtrip tests) and `T011` (`sign_release.rs`) run in parallel with Phase 3 UI tasks as soon as `T003` completes.
- **Cross-Story Parallelism**: Phase 4 (`US2` backend signer + GitHub Actions workflow) executes completely independently from Phase 3 (`US1`) and Phase 5 (`US3`) frontend tasks after `T003`.

---

## Parallel Examples per User Story

### User Story 1
```text
# Parallel Rust negative tests and three UI entry points after Phase 2:
T005: "Write automated fail-closed negative and session-preservation tests in src-tauri/tests/updater_security_tests.rs"
T006: "Add Application Update section in src/components/modals/ProfileModal.tsx"
T007: "Add compact update action control in src/components/layout/NavRail.tsx"
T008: "Add compact version footer and update action in src/components/modals/AuthScreen.tsx"
```

### User Story 2
```text
# Parallel signing tests and CLI binary after T003:
T010: "Add roundtrip signing and key-mismatch negative tests in src-tauri/tests/updater_security_tests.rs"
T011: "Create pure-Rust release signing CLI binary in src-tauri/src/bin/sign_release.rs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete **Phase 1: Setup** (`T001`–`T002`).
2. Complete **Phase 2: Foundational** (`T003`–`T004`).
3. Complete **Phase 3: User Story 1** (`T005`–`T009`) → Validate in-app update check, fail-closed `Ed25519` + `SHA-256` verification, installer launch, and Windows DPAPI session preservation (`SC-001`–`SC-004`).

### Incremental Delivery

1. **Increment 1 (P1 In-App Updater MVP)**: Setup + Foundational + US1 (`T001`–`T009`).
2. **Increment 2 (P2 Automated GitHub Releases)**: Add US2 (`T010`–`T012`) to automate signed Windows NSIS builds and `latest.json` publishing on tag push (`SC-005`).
3. **Increment 3 (P3 Startup Update Prompt)**: Add US3 (`T013`–`T014`) + Phase 6 audit and validation (`T015`–`T016`).
