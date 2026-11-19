# Quickstart & End-to-End Validation Guide: GitHub Release & Auto-Update

**Feature**: `002-github-release-auto-update`  
**Date**: 2026-11-19  
**Target Platform**: Windows 10 / Windows 11 Desktop (64-bit)

---

## 1. Prerequisites

1. **Windows 10 (1809+) or Windows 11** (`x86_64-pc-windows-msvc`).
2. **Rust Toolchain** (`rustup` stable `1.85+`) and **Node.js `22+` / `npm`**.
3. **Maintainer Signing Keypair** (for local simulation or CI release secrets):
   - Generated via `cargo run --manifest-path src-tauri/Cargo.toml --bin sign_release -- --keygen` (outputs private seed for `PRIVATE_TALK_UPDATER_SIGNING_KEY` and public key for `PRIVATE_TALK_UPDATER_PUBKEY`).

---

## 2. Automated Verification Commands (Constitution Principle V Gate)

Run both frontend typecheck/build and Rust unit + adversarial updater security tests:

```powershell
# Frontend TypeScript check + Vite production build
npm run build

# Rust full suite (includes crypto, DPAPI, epoch rotation, and updater negative tests)
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected updater test coverage in `src-tauri/tests/updater_security_tests.rs`:
- Rejects manifest with invalid/forged `Ed25519` signature (fail-closed `VerificationFailed`).
- Rejects installer bytes whose `SHA-256` or byte length differs from signed manifest (fail-closed `VerificationFailed`, 0 bytes written to disk).
- Rejects `draft: true`, `prerelease: true`, pre-release semver tags (e.g. `0.2.0-rc.1`), and non-HTTPS URLs.
- Enforces downgrade protection (`remote <= current` returns `UpToDate`).
- Verifies silent startup check swallows transient network failures into `Idle`, while manual check reports `Error`.
- Verifies `%LOCALAPPDATA%\PrivateTalk\<profile>\session.dpapi` remains untouched across manifest check and verified staging.

---

## 3. Local End-to-End Update Simulation (`0.1.0` -> `0.2.0`)

1. Generate an `Ed25519` test keypair and build a signed test `latest.json` pointing to a locally served NSIS installer (`http://127.0.0.1:<port>/PrivateTalk_0.2.0_x64-setup.exe`) using `sign_release`.
2. Start a local static HTTP file server hosting `latest.json` and `PrivateTalk_0.2.0_x64-setup.exe`.
3. Launch the `0.1.0` app pointed at the local feed and test public key:
   ```powershell
   $env:PRIVATE_TALK_UPDATE_URL="http://127.0.0.1:8080/latest.json"
   $env:PRIVATE_TALK_UPDATER_PUBKEY="<hex-or-base64-test-pubkey>"
   npm run tauri dev
   ```

### Validation Scenarios

1. **Scenario 1 — Up-to-date Check (`0.1.0` vs `0.1.0`)**:
   - Open `Profile Settings` (or footer on `AuthScreen`) and click `"Check for update"`.
   - Confirm status updates to `"Up to date (v0.1.0)"` within `< 5s`.
2. **Scenario 2 — In-App Update & DPAPI Session Preservation (`0.1.0` -> `0.2.0`)**:
   - Log in as a test user so `%LOCALAPPDATA%\PrivateTalk\session.dpapi` exists.
   - Click `"Check for update"` in `Profile Settings` or `NavRail` (or click `"Update"` on the startup notification banner).
   - Verify `v0.2.0` and release notes display, click `"Update"`, watch progress reach `100%`, confirm verified installer launches and upgrades the app, and confirm restart restores the authenticated session without re-entering credentials.
3. **Scenario 3 — Fail-Closed Tampered Package Rejection**:
   - Modify 1 byte of the hosted `.exe` without re-signing `latest.json`, then click `"Update"`.
   - Confirm UI displays the red security warning (`VerificationFailed`), aborts installation, and `%LOCALAPPDATA%\PrivateTalk\updates\` contains no unverified executable.
4. **Scenario 4 — Offline Startup Check**:
   - Stop the local feed server and launch the app.
   - Confirm no error dialog appears on startup, while manually clicking `"Check for update"` reports a clear network error with retry available.
5. **Scenario 5 — Automated GitHub Release Workflow**:
   - Configure `PRIVATE_TALK_UPDATER_SIGNING_KEY` in GitHub repository Secrets.
   - Align versions to `0.2.0`, commit, and push tag `v0.2.0`.
   - Confirm `.github/workflows/release.yml` passes all tests, builds `PrivateTalk_0.2.0_x64-setup.exe`, signs `latest.json` + `.sig`, and publishes the stable GitHub Release.
