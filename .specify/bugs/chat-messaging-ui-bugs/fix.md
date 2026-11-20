# Bug Fix: Duplicate Sent Messages, Broken Attachment Picker, and Abrupt UI Animations

- **Slug**: chat-messaging-ui-bugs
- **Fixed**: 2026-11-20T17:39:08+07:00
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Deduplicated sent messages in `App.tsx` using `upsertMessageWithReplySync`, replaced Electron-only `File.path` reads with native Tauri v2 dialog and drag-drop APIs (`tauri-plugin-dialog` + `getCurrentWebview().onDragDropEvent`), and added GPU-composited CSS entrance animations and initial-load vs. incremental scroll behavior.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/App.tsx` | modified | Replaced `[...prev, sent]` with `upsertMessageWithReplySync(prev, sent)` in `onSend`. |
| `package.json` | modified | Added `@tauri-apps/plugin-dialog`. |
| `src-tauri/Cargo.toml` | modified | Added `tauri-plugin-dialog = "2"`. |
| `src-tauri/src/lib.rs` | modified | Registered `tauri_plugin_dialog::init()`. |
| `src-tauri/capabilities/default.json` | modified | Granted `"dialog:allow-open"` permission. |
| `src/lib/tauri-client.ts` | modified | Added `pickAttachmentFile`, `pickAvatarFile`, and `onFileDragDrop`. |
| `src/lib/ui-polish.ts` | modified | Added `getTimelineScrollBehavior`, `extractFileName`, `validateAttachmentPath`, and `validateAvatarPath`. |
| `src/components/chat/MessageComposer.tsx` | modified | Switched attachment picker and drag-drop to `tauriClient.pickAttachmentFile` and `tauriClient.onFileDragDrop`; added `animate-slide-up-fade` / `animate-fade-in`. |
| `src/components/modals/ProfileModal.tsx` | modified | Switched avatar picker to `tauriClient.pickAvatarFile` + `validateAvatarPath`; added `animate-fade-in` / `animate-scale-in`. |
| `src/styles/globals.css` | modified | Added GPU-composited `@keyframes` (`fade-in`, `scale-in`, `slide-in-right`, `slide-up-fade`, `message-in`) and `prefers-reduced-motion: reduce` support. |
| `src/components/chat/MessageTimeline.tsx` | modified | Used `getTimelineScrollBehavior` for initial `"auto"` vs. incremental `"smooth"` scroll; animated unseen pill. |
| `src/components/chat/MessageBubble.tsx` | modified | Added `animate-message-in` to message bubble wrapper. |
| `src/components/modals/GroupManageDrawer.tsx` | modified | Added `animate-fade-in` backdrop and `animate-slide-in-right` panel. |
| `src/components/chat/MediaViewer.tsx` | modified | Added `animate-fade-in` backdrop and `animate-scale-in` lightbox image. |
| `src/components/chat/MessageSearchBar.tsx` | modified | Added `animate-slide-up-fade` entrance. |
| `src/lib/__tests__/ui-polish.test.ts` | modified | Added unit tests for `upsertMessageWithReplySync`, `validateAttachmentPath`, `validateAvatarPath`, and `getTimelineScrollBehavior`. |

## Tests Added or Updated

- `src/lib/__tests__/ui-polish.test.ts::upsertMessageWithReplySync` — verifies deduplication when `realtime:message_upsert` and `messageSend` return the same `MessageDto.id`.
- `src/lib/__tests__/ui-polish.test.ts::validateAttachmentPath` — verifies case-insensitive allowed extensions (`png/jpg/jpeg/webp/gif/mp4/webm`) and rejection of disallowed extensions.
- `src/lib/__tests__/ui-polish.test.ts::validateAvatarPath` — verifies `png/jpg/jpeg/webp` acceptance and rejection of disallowed extensions.
- `src/lib/__tests__/ui-polish.test.ts::getTimelineScrollBehavior` — verifies `"auto"` on initial load (`0 -> 50`) and `"smooth"` on incremental updates (`50 -> 51`).

## Local Verification

- Commands run: `npm run build && npm test` → passed (`tsc && vite build` succeeded, 2 test files / 90 tests passed).
- Commands run: `cargo test --manifest-path src-tauri/Cargo.toml` → passed (23 tests passed across unit and integration suites).

## Deviations from Assessment

None.

## Follow-ups

- Run `/speckit-bug-test slug=chat-messaging-ui-bugs` to verify in the live Tauri desktop window (`npm run tauri dev`).
