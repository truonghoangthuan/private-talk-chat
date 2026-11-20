# Implementation Plan: GitHub Release Distribution and In-App Auto-Update

**Branch**: `002-github-release-auto-update` | **Date**: 2026-11-19 | **Spec**: [spec.md](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/spec.md)

**Input**: Feature specification from `/specs/002-github-release-auto-update/spec.md`

## Summary

Deliver automated **GitHub Releases distribution** (`.github/workflows/release.yml`) and a **fail-closed Rust in-app updater** (`src-tauri/src/updater/mod.rs`) for **Bloop** on Windows 10/11 (`x86_64`). Existing clients perform a non-blocking startup background check and expose manual `"Check for update"` and `"Update"` controls across the **Profile Settings modal**, **left navigation rail**, and **unauthenticated login screen**. All release feeds (`latest.json`), `Ed25519` cryptographic signature verification, `SHA-256` integrity validation in Rust memory, and verified Windows installer staging execute in Rust using existing crates—adding zero new runtime dependencies—while preserving Windows DPAPI local sessions (`%LOCALAPPDATA%\PrivateTalk\<profile>\session.dpapi`) across restarts.

## Technical Context

**Language/Version**: Rust `1.85+` (2021 edition, `x86_64-pc-windows-msvc`) + TypeScript `5.7+` (React 19 WebView2 UI) + GitHub Actions YAML

**Primary Dependencies**:
- **Rust Core (`src-tauri`)**: Existing crates only (`tauri` v2, `reqwest` with `rustls-tls`, `ed25519-dalek`, `sha2`, `base64`, `hex`, `serde`, `serde_json`, `chrono`, `tokio`, `thiserror`, `tracing`) — zero new Cargo dependencies
- **Frontend UI (`src`)**: Existing React 19, Tailwind CSS v4, Lucide icons (`src/lib/tauri-client.ts`, `src/lib/types.ts`) — zero new npm dependencies
- **CI/CD (`github`)**: GitHub Actions (`windows-latest`), `actions/checkout`, `dtolnay/rust-toolchain`, `actions/setup-node`, `softprops/action-gh-release` (or `gh release create`)

**Storage**:
- **Remote Distribution**: Public GitHub Releases HTTPS assets (`PrivateTalk_<version>_x64-setup.exe`, `.sig`, `latest.json`)
- **Local Staging**: Verified installer binary staged exclusively after in-memory signature + SHA-256 verification at `%LOCALAPPDATA%\PrivateTalk\updates\<installer_file_name>`
- **Protected Session Isolation**: Existing `%LOCALAPPDATA%\PrivateTalk\<profile>\session.dpapi` remains untouched across updates

**Testing**: `cargo test --manifest-path src-tauri/Cargo.toml` (unit + adversarial fail-closed signature/hash/downgrade/prerelease tests in `src-tauri/tests/updater_security_tests.rs`) + `npm run build` (TypeScript strict check + Vite bundle)

**Target Platform**: Windows 10 (1809+) and Windows 11 Desktop (`x86_64`)

**Project Type**: `desktop-app` (Tauri v2 Rust desktop application + GitHub Actions release pipeline)

**Performance Goals**:
- `< 5s` manual `"Check for update"` round-trip under normal broadband connectivity (SC-001)
- Non-blocking background startup check with zero UI thread freeze (FR-008)
- Throttled progress events (`<= 10 Hz`) during installer download so UI renders smoothly at 60 fps

**Constraints**:
- **Fail-Closed Verification**: 100% of unsigned, forged, corrupted, draft, prerelease, or downgraded manifests/installers rejected in Rust RAM before any executable byte touches disk (FR-005, SC-003)
- **Zero-Leakage & Boundary Integrity**: No user tokens, keys, or profile metadata in update HTTP calls or logs (FR-009); WebView CSP `connect-src` stays strictly restricted (`AGENTS.md`)
- **Single Active Update Lock**: Concurrent `"Check for update"` / `"Update"` invocations prevented via `UpdaterManager` state lock

**Scale/Scope**: Windows desktop client auto-updater (`3` UI entry points + startup banner), `3` Tauri IPC commands, `1` real-time Tauri event, `1` pure-Rust signing CLI utility (`sign_release`), and `1` GitHub Actions release workflow.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Constitution Principle | Pre-Research Gate | Post-Design Verification |
|------------------------|-------------------|--------------------------|
| **I. Security-First Architecture** | **PASS** — Embedded trusted `Ed25519` public key verifies signed release manifests and installer SHA-256 digests in Rust; no insecure HTTP or signature-bypass flags. | **PASS** — Verified in [research.md](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/research.md) §2 and [github-release-manifest.md](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/contracts/github-release-manifest.md) §2. |
| **II. Mandatory End-to-End Message Encryption** | **PASS** — Chat E2EE keys, message pipelines, and Supabase storage remain isolated and unaffected by update transport. | **PASS** — Verified; updater touches zero chat/crypto key modules. |
| **III. Windows-Native Data Protection & Isolation** | **PASS** — `%LOCALAPPDATA%\PrivateTalk\<profile>\session.dpapi` is untouched by updater and NSIS upgrades; unverified binaries never write to disk. | **PASS** — Verified in [data-model.md](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/data-model.md) §3. |
| **IV. Zero-Leakage Observability & Fail-Closed Behavior** | **PASS** — Failed signature/SHA-256 aborts immediately to `VerificationFailed`, discards RAM buffer, logs zero secrets, and shows clear warning banner. | **PASS** — Verified in [tauri-updater-ipc.md](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/contracts/tauri-updater-ipc.md) §1–2. |
| **V. Test-First Verification & Security Gates** | **PASS** — Negative/adversarial tests for bad signatures, tampered installer bytes, downgrade, and prerelease tags required in Rust test suite and CI release gate. | **PASS** — Verified in [quickstart.md](file:///c:/work/temp/playground/private-talk-chat/specs/002-github-release-auto-update/quickstart.md) §2 and CI gates. |

## Project Structure

### Documentation (this feature)

```text
specs/002-github-release-auto-update/
├── plan.md                                  # This file (/speckit-plan output)
├── research.md                              # Phase 0 architecture & security decisions
├── data-model.md                            # Update lifecycle, manifest, semver & DTOs
├── quickstart.md                            # Automated test & local E2E validation guide
└── contracts/
    ├── tauri-updater-ipc.md                 # IPC commands, events, and UI placement contract
    └── github-release-manifest.md           # latest.json schema, signing & CI release workflow
```

### Source Code (repository root)

```text
.github/
└── workflows/
    └── release.yml                          # Tag-triggered & manual Windows build, test, sign & GH Release job

src-tauri/
├── src/
│   ├── lib.rs                               # Register updater commands & AppState.updater initialization
│   ├── updater/
│   │   └── mod.rs                           # Semver, ReleaseManifest, Ed25519 + SHA-256 verification, download & Windows launch
│   ├── bin/
│   │   └── sign_release.rs                  # Maintainer/CI CLI utility: keygen, SHA-256, Ed25519 .sig & latest.json generator
│   └── commands/
│       ├── mod.rs                           # Embed UpdaterManager inside AppState
│       └── updater.rs                       # IPC commands: update_get_status, update_check, update_install
└── tests/
    └── updater_security_tests.rs            # Negative/adversarial fail-closed tests & DPAPI preservation tests

src/
├── App.tsx                                  # Startup background check, shared UpdateStatusDto state, dismissible banner
├── lib/
│   ├── types.ts                             # UpdatePhase & UpdateStatusDto TypeScript interfaces
│   └── tauri-client.ts                      # Typed updateGetStatus, updateCheck, updateInstall, onUpdateStateChanged
└── components/
    ├── layout/
    │   └── NavRail.tsx                      # Compact update action control with available-update indicator
    └── modals/
        ├── AuthScreen.tsx                   # Compact version & pre-login update check/install footer
        └── ProfileModal.tsx                 # Application Update card with progress, notes & fail-closed alert
```

**Structure Decision**: Extends the existing Tauri v2 (`src-tauri/` + `src/`) boundary directly with zero new runtime dependencies and adds a single Windows CI/CD workflow (`.github/workflows/release.yml`). All cryptographic verification, manifest parsing, and installer execution live in Rust (`src-tauri/src/updater/mod.rs`), while React components remain pure UI consumers of `UpdateStatusDto`.

## Complexity Tracking

No Constitution violations. All principles satisfied with zero exemptions and zero new runtime dependencies.
