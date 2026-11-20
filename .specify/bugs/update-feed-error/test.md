# Bug Verification: In-App Update Check Fails With HTTP 404 on Private Repository Feed

- **Slug**: update-feed-error
- **Tested**: 2026-11-20T10:07:00+07:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

Local Rust and frontend test suites and the TypeScript/Vite build pass with zero failures, confirming `check_http_success` preserves HTTP status codes without leaking URL credentials and respects the `silent` flag. However, the bug is marked `partial` because live GitHub feed network checks were skipped (requiring explicit user consent) and the desktop GUI reproduction in Private Talk v0.2.0 was not executed.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix: live HTTPS feed) | Unauthenticated `GET` to `https://github.com/truonghoangthuan/private-talk-chat/releases/latest/download/latest.json` and `PrivateTalk_0.2.0_x64-setup.exe` | skipped | Network-dependent check skipped without explicit user consent |
| Reproduction (post-fix: desktop GUI) | Launch Private Talk v0.2.0, open Profile Settings, click **Check for update** | not-run | Interactive native Tauri desktop GUI not exercisable in headless CLI session |
| New / updated tests | `cargo test --manifest-path src-tauri/Cargo.toml` (`updater_security_tests::http_transport_surfaces_status_without_leaking_credentials_and_respects_silent_flag`) | pass | Exit 0; 5 passed in `updater_security_tests` using loopback HTTP server (404/403, credential non-leakage, `silent=true`/`false`) |
| Regression suite (Rust) | `cargo test --manifest-path src-tauri/Cargo.toml` | pass | Exit 0; 17 passed, 0 failed (`private_talk_lib`: 1, `crypto_negative_tests`: 4, `dpapi_roundtrip_tests`: 3, `group_epoch_rotation_tests`: 2, `replies_and_pins_tests`: 2, `updater_security_tests`: 5) |
| Regression suite (Frontend) | `npm test` | pass | Exit 0; Vitest 2 files / 7 passed (`src/lib/ui-polish.test.ts`, `src/lib/__tests__/ui-polish.test.ts`) |
| Lint / type-check & build | `npm run build` (`tsc && vite build`) | pass | Exit 0; TypeScript check and Vite production bundle succeeded |

## Output Excerpts

```text
Running tests\updater_security_tests.rs
running 5 tests
test t013_silent_startup_check_suppresses_network_errors_but_fails_closed_on_forgery ... ok
test http_transport_surfaces_status_without_leaking_credentials_and_respects_silent_flag ... ok
test t010_manifest_signing_roundtrip_and_key_mismatch_fail_closed ... ok
test t005_concurrent_lock_and_dpapi_session_preservation ... ok
test t005_rejects_forged_signature_draft_prerelease_semver_url_and_tampered_installer ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
```

```text
npm notice run tsc && vite build
vite v7.3.8 building client environment for production...
✓ 1609 modules transformed.
✓ built in 7.55s
```

```text
 Test Files  2 passed (2)
      Tests  7 passed (7)
```

## Residual Risks

- Live GitHub Releases reachability (`https://github.com/truonghoangthuan/private-talk-chat/releases/latest/download/latest.json` and `PrivateTalk_0.2.0_x64-setup.exe`) and repository public visibility were not re-checked in this run because network checks were skipped.
- End-to-end desktop GUI behavior (clicking **Check for update** in Private Talk v0.2.0 and verifying Ed25519 manifest signature validation against the compiled public key) remains unverified here.
- Local changes in `src-tauri/src/updater/mod.rs` (`check_http_success`) and `src-tauri/tests/updater_security_tests.rs` are still uncommitted in the working tree; existing `v0.2.0` binaries will not display HTTP status codes on future failures until a new release ships.

## Recommendation

Hold — local test suites and TypeScript/Vite builds pass, but live network and desktop GUI verification were not exercised in this session. Authorize a live HTTPS feed check or click **Check for update** in Private Talk v0.2.0 Profile Settings to confirm `Up to date` (and clean signature verification) before closing the bug.
