# Bug Verification: Duplicate Sent Messages, Broken Attachment Picker, and Abrupt UI Animations

- **Slug**: chat-messaging-ui-bugs
- **Tested**: 2026-11-20T17:45:17+07:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

All automated frontend build, Vitest unit tests (90/90), and Rust unit/integration tests (23/23) passed, and code inspection confirms the deduplication, native Tauri v2 dialog/drag-drop, and CSS motion fixes are in place. Result is marked `partial` because the live Tauri desktop GUI reproduction steps in `npm run tauri dev` (sending a message in WebView2, picking/dropping an attachment via OS dialog, and visually inspecting animations) were not interactively executed in this headless CLI session.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | Live `npm run tauri dev` desktop UI walkthrough (send message, native file picker/drop, visual motion) | not-run | Headless CLI session cannot drive interactive WebView2 OS file dialogs or visually verify GPU animations. |
| Code-path verification | `Select-String -Path src/App.tsx,src/components/chat/MessageComposer.tsx,src-tauri/capabilities/default.json -Pattern "upsertMessageWithReplySync\|pickAttachmentFile\|onFileDragDrop\|dialog:allow-open"` | pass | Confirmed `upsertMessageWithReplySync(prev, sent)` at `src/App.tsx:582`, native dialog/drag-drop wiring in `MessageComposer.tsx`, and `"dialog:allow-open"` in `default.json`. |
| New / updated tests | `npm test` | pass | 2 test files, 90 tests passed (`src/lib/__tests__/ui-polish.test.ts`: 10 tests; `src/lib/ui-polish.test.ts`: 80 tests). |
| Regression suite | `cargo test --manifest-path src-tauri/Cargo.toml` | pass | 23 tests passed (1 lib unit test + 22 integration tests across 9 suites; 0 failed). |
| Lint / type-check | `npm run build` | pass | `tsc && vite build` succeeded (1615 modules transformed, 0 errors). |

## Output Excerpts

```text
> npm run build
✓ 1615 modules transformed.
✓ built in 2.29s
```

```text
> npm test
 ✓ src/lib/__tests__/ui-polish.test.ts (10 tests) 7ms
 ✓ src/lib/ui-polish.test.ts (80 tests) 34ms
 Test Files  2 passed (2)
      Tests  90 passed (90)
```

```text
> cargo test --manifest-path src-tauri/Cargo.toml
- private_talk_lib: 1 passed
- auth_refresh_tests: 3 passed
- conversation_creation_tests: 1 passed
- crypto_negative_tests: 4 passed
- dpapi_roundtrip_tests: 3 passed
- group_epoch_rotation_tests: 2 passed
- ico_format_tests: 1 passed
- replies_and_pins_tests: 2 passed
- updater_security_tests: 6 passed
```

## Residual Risks

- Live WebView2 behavior (`tauri-plugin-dialog` native file picker, `getCurrentWebview().onDragDropEvent` OS path delivery, and visual smoothness of CSS animations) is only verified statically and via mocked unit tests until exercised in `npm run tauri dev`.

## Recommendation

Hold — automated build, unit, and Rust integration suites pass with zero regressions, but run `npm run tauri dev` once to manually confirm sending a message, picking/dropping an attachment, and UI animation smoothness before closing the bug.
