# Bug Verification: Contact Search Fails With "invalid response from backend" Due to Unrefreshed Expired Supabase JWT

- **Slug**: contact-search-invalid-response
- **Tested**: 2026-11-20T11:48:49+07:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

Automated mock-server reproduction tests, the full Rust regression suite (21 tests), and the frontend TypeScript/Vite build all pass with zero failures. The result is marked `partial` because live end-to-end reproduction against remote Supabase (`https://bhsansqjmllapeuypjrf.supabase.co`) and the desktop GUI was not executed.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix, automated) | `cargo test --manifest-path src-tauri/Cargo.toml --test auth_refresh_tests` | pass | 3 passed against local mock HTTP server (`restore_session_refreshes_expired_jwt_and_persists_new_tokens`, `restore_session_fails_closed_and_wipes_dpapi_when_refresh_rejected`, `rpc_add_mutual_contact_maps_401_jwt_expired_to_auth_rejected_and_active_session_refreshes`) |
| Reproduction (post-fix, live desktop/remote) | Launch Private Talk against live Supabase with expired `%LOCALAPPDATA%\PrivateTalk\session.dpapi` and search `cubu69` | skipped | Network/live-account dependent; not executed in automated verification |
| Regression suite | `cargo test --manifest-path src-tauri/Cargo.toml` | pass | 21 passed, 0 failed across unit tests and 7 integration test binaries |
| Lint / type-check | `npm run build` | pass | `tsc && vite build` exited 0 (`dist/assets/index-jtNpYpno.js 292.23 kB`) |

## Output Excerpts

```text
Running tests\auth_refresh_tests.rs
test rpc_add_mutual_contact_maps_401_jwt_expired_to_auth_rejected_and_active_session_refreshes ... ok
test restore_session_fails_closed_and_wipes_dpapi_when_refresh_rejected ... ok
test restore_session_refreshes_expired_jwt_and_persists_new_tokens ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

```text
npm notice run tsc && vite build
✓ 1609 modules transformed.
✓ built in 5.47s
```

## Residual Risks

- Live remote Supabase `/auth/v1/token?grant_type=refresh_token` and PostgREST `add_mutual_contact` behavior was verified via a local mock HTTP server in `auth_refresh_tests.rs`, not against the live `bhsansqjmllapeuypjrf.supabase.co` deployment.
- As noted in `fix.md`, `RealtimeManager` is not reconnected after a mid-session token refresh.

## Recommendation

Hold — automated reproduction, Rust regression suite, and frontend build all pass; launch `npm run tauri dev` once against live Supabase with the existing expired `session.dpapi` and search `cubu69` to confirm end-to-end before closing.
