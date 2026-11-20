# Bug Verification: NSIS Upgrade Uninstall Failure and Direct/Group Conversation Creation RLS Failure

- **Slug**: installer-contact-group-bugs
- **Tested**: 2026-11-20T15:52:12+07:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

All local Rust unit/integration tests (23 passed, 0 failed) and the frontend TypeScript/Vite production build passed with no regressions, confirming the updater launch flags, `LocalLoopbackStore` direct/group conversation creation, and UI error handling compile and pass. The result is `partial` because neither the live Windows NSIS two-version upgrade nor the remote Supabase PostgreSQL migration (`0003_fix_conversation_creation_rls.sql`) was exercised in this environment.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (Bug 1: NSIS upgrade) | Install older NSIS build and upgrade via in-app updater or setup `.exe` | skipped | Requires `npm run tauri build` NSIS packaging and two-version Windows install test |
| Reproduction (Bug 2 & 3: Live Supabase RLS) | Direct & group chat creation against remote Supabase PostgreSQL | skipped | Network/remote DB dependent; `supabase/migrations/0003_fix_conversation_creation_rls.sql` must be pushed to Supabase first |
| New / updated tests (Updater flags) | `cargo test --manifest-path src-tauri/Cargo.toml` (`updater_security_tests::windows_installer_launcher_uses_in_place_update_flags`) | pass | 6/6 tests passed in `updater_security_tests` |
| New / updated tests (Conversation creation) | `cargo test --manifest-path src-tauri/Cargo.toml` (`conversation_creation_tests::direct_and_group_conversation_creation_and_fail_closed_non_contact`) | pass | 1/1 test passed in `conversation_creation_tests` (uses `LocalLoopbackStore`) |
| Regression suite (Rust) | `cargo test --manifest-path src-tauri/Cargo.toml` | pass | 23 passed, 0 failed across unit and 8 integration test binaries |
| Lint / type-check & bundle (Frontend) | `npm run build` (`tsc && vite build`) | pass | Exit 0; built in 5.16s |

## Output Excerpts

```text
     Running tests\conversation_creation_tests.rs
test direct_and_group_conversation_creation_and_fail_closed_non_contact ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.71s

     Running tests\updater_security_tests.rs
test windows_installer_launcher_uses_in_place_update_flags ... ok
...
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
```

```text
npm notice run tsc && vite build
vite v7.3.8 building client environment for production...
dist/index.html                      0.42 kB │ gzip:  0.28 kB
dist/assets/index-B8R8W0Lo.js      292.58 kB │ gzip: 86.26 kB
✓ built in 5.16s
```

## Residual Risks

- **Remote Supabase migration not yet verified live**: `supabase/migrations/0003_fix_conversation_creation_rls.sql` has not been executed against a live PostgreSQL / PostgREST instance; `conversation_creation_tests` exercises `LocalLoopbackStore` rather than PostgreSQL RLS evaluation.
- **NSIS installer upgrade not yet verified live**: `src-tauri/windows/nsis-hooks.nsh` (`NSIS_HOOK_PREINSTALL` / `NSIS_HOOK_PREUNINSTALL`) and `/P /UPDATE /R` launcher flags are not exercised by `cargo test`; a full `npm run tauri build` upgrade test on Windows is still required.

## Recommendation

Hold — local unit, integration, and frontend build checks pass, but live verification is still needed: apply `supabase/migrations/0003_fix_conversation_creation_rls.sql` to the remote Supabase project to verify direct/group chat creation end-to-end, and run a two-version Windows NSIS upgrade test after `npm run tauri build`.
