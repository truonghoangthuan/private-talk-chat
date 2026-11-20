# Bug Assessment: Duplicate Sent Messages, Broken Attachment Picker, and Abrupt UI Animations

- **Slug**: chat-messaging-ui-bugs
- **Created**: 2026-11-20
- **Source**: pasted text (+ 2 user screenshots)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> - I sent a message and it shows duplicated message.
> - When selecting an attachments, it show the error message.
> - The animation of the application is not make me feel "smooth", enhance it also

Screenshots provided:
1. Chat timeline showing `"Test 3"` rendered twice consecutively at `04:47 PM` immediately after sending once.
2. Message composer displaying red error banner: `"File path unavailable outside Tauri desktop window."`.

## Symptom

1. **Duplicate sent message**: Sending a single message immediately renders two identical message bubbles with the same content and timestamp in the active timeline; expected a single message bubble.
2. **Attachment selection failure**: Selecting (or dropping) any valid image/GIF/video in the Tauri desktop app always fails with `"File path unavailable outside Tauri desktop window."`; expected the file to stage and send. (The same underlying pattern also silently breaks avatar selection in `ProfileModal`.)
3. **Abrupt UI motion**: Messages, modals, drawers, lightbox, banners, and conversation-load scrolling pop in or jank without smooth GPU-composited transitions; expected crisp, smooth desktop-grade transitions that respect reduced motion.

## Reproduction

### Issue 1 — Duplicate sent message
1. Launch the Tauri desktop app and open any conversation.
2. Type `"Test 3"` in `MessageComposer` and press Enter (or click Send).
3. Observe two identical `"Test 3"` bubbles rendered in the timeline.

### Issue 2 — Attachment selection error
1. Open any conversation in the Tauri desktop app.
2. Click the paperclip icon (or drag-and-drop an image/video) and select any valid PNG/JPG/WEBP/GIF/MP4/WEBM file.
3. Observe the red error banner: `"File path unavailable outside Tauri desktop window."`.

### Issue 3 — Unsmooth animations
1. Open the app, switch conversations, send messages, open Profile Settings / Group Settings drawer / MediaViewer lightbox / Search bar, or toggle window focus.
2. Observe instant un-animated mount pops on overlays/bubbles and smooth-scroll jank across 50 messages on initial conversation load.

## Suspected Code Paths

- `src-tauri/src/commands/messages.rs:820-838` (`message_send`) — Emits `realtime:message_upsert` with `&dto` before returning `Ok(dto)`.
- `src/App.tsx:249-258` (`onMessageUpsert` listener) — Calls `setMessages((prev) => upsertMessageWithReplySync(prev, msg))`, inserting the sent message into state.
- `src/App.tsx:573-583` (`MessageComposer` `onSend`) — Blindly appends `[...prev, sent]` instead of deduplicating via `upsertMessageWithReplySync(prev, sent)`, unlike `onEditMessage` (`src/App.tsx:509`) and `onRemoveMessage` (`src/App.tsx:518`).
- `src/components/chat/MessageComposer.tsx:79-105, 126-133, 271-282` (`stageFile`, `handleFileSelect`, `handleDrop`) — Reads `(file as File & { path?: string }).path`, an Electron-only property that is always `undefined` in Tauri v2 WebView2.
- `src/components/modals/ProfileModal.tsx:32-51` (`handleFileChange`) — Same `(file as File & { path?: string }).path` assumption; silently leaves `avatarFilePath` empty on Tauri v2.
- `src-tauri/Cargo.toml:23-26`, `src-tauri/src/lib.rs:67-69`, `src-tauri/capabilities/default.json:6-9`, `package.json:15-24` — `tauri-plugin-dialog` is not installed or registered.
- `src/styles/globals.css:1-63` — Only defines `@keyframes typing-dot`; no motion easing tokens, entrance keyframes, or `@media (prefers-reduced-motion: reduce)` handling.
- `src/components/chat/MessageTimeline.tsx:44-58` — Runs `scrollIntoView({ behavior: "smooth" })` even when switching conversations (0 → N messages), causing scroll sweep instead of instant initial snap + smooth incremental scroll.
- `src/components/chat/MessageBubble.tsx`, `src/components/modals/ProfileModal.tsx:82-83`, `src/components/modals/GroupManageDrawer.tsx:84-85`, `src/components/chat/MediaViewer.tsx:62-82`, `src/App.tsx:298-313` — Instant conditional mounts with no fade/slide/scale entrance transitions.

## Root Cause Hypothesis

1. **Duplicate sent message (confidence: high)**: `message_send` in `src-tauri/src/commands/messages.rs:836` emits `realtime:message_upsert` before returning `Ok(dto)`. `App.tsx:251` handles that event via `upsertMessageWithReplySync(prev, msg)`, and then `App.tsx:581` runs `setMessages((prev) => [...prev, sent])`, unconditionally pushing a second copy with the same `id` (also causing duplicate React keys in `MessageTimeline`).
2. **Attachment error (confidence: high)**: `MessageComposer.tsx:86` (and `ProfileModal.tsx:46`) assumes HTML5 `File.path` is populated by the desktop shell. In Tauri v2 (WebView2), browsers never expose real OS filesystem paths on `File` objects, so `nativePath` is always `undefined` and triggers the `"File path unavailable outside Tauri desktop window."` error branch.
3. **Abrupt animations (confidence: high)**: The UI relies solely on instant React conditional mounts and bare Tailwind `transition-colors` without entrance keyframes, drawer/modal transitions, button micro-feedback, or initial-load vs. incremental scroll distinction in `MessageTimeline`.

## Proposed Remediation

**Preferred** (minimal, zero-bloat fix aligned with existing Tauri IPC contracts and security invariants):

1. **Deduplicate sent messages in `App.tsx`**:
   - Replace `setMessages((prev) => [...prev, sent])` at `src/App.tsx:581` with `setMessages((prev) => upsertMessageWithReplySync(prev, sent))`. This makes `onSend` idempotent regardless of whether `realtime:message_upsert` (local emit or Supabase Realtime) arrives before or after `messageSend` resolves.

2. **Use native Tauri v2 file dialog + drag-drop events for attachments (and avatars)**:
   - Add `tauri-plugin-dialog = "2"` in `src-tauri/Cargo.toml`, `@tauri-apps/plugin-dialog` in `package.json`, register `.plugin(tauri_plugin_dialog::init())` in `src-tauri/src/lib.rs`, and grant `"dialog:allow-open"` in `src-tauri/capabilities/default.json` (tightly scoped per Constitution).
   - Add a small helper in `src/lib/tauri-client.ts` wrapping `open(...)` from `@tauri-apps/plugin-dialog` (with extension filters for attachments: `png, jpg, jpeg, webp, gif, mp4, webm`; and avatars: `png, jpg, jpeg, webp`) and `getCurrentWebview().onDragDropEvent(...)` from `@tauri-apps/api/webview` for drag-and-drop native paths.
   - Update `MessageComposer.tsx` to trigger the native dialog on paperclip click and subscribe to Tauri's drag-drop event for native file paths (validating extension/kind via a small helper in `ui-polish.ts`, while Rust continues to enforce authoritative 50 MB and MIME validation in `message_send_core`). Update `ProfileModal.tsx` to use the same dialog helper for avatar picking.
   - Keep `message_send` and `profile_update` IPC signatures (`attachment_path: Option<String>`, `avatar_file_path: Option<String>`) unchanged — zero plaintext bytes cross IPC and zero temp files are created.

3. **Pure-CSS GPU-composited motion polish (no new animation libraries)**:
   - Add lightweight `@keyframes` and utility classes in `src/styles/globals.css` (`fade-in`, `scale-in`, `slide-in-right`, `slide-up-fade`, `message-in`) using only `transform` and `opacity` with crisp ease-out timing (`cubic-bezier(0.16, 1, 0.3, 1)`), plus `@media (prefers-reduced-motion: reduce)` disabling non-essential motion.
   - Apply subtle entrance animations to: `MessageBubble` (incremental bubbles), `ProfileModal` (backdrop fade + card scale-in), `GroupManageDrawer` (backdrop fade + right slide-in), `MediaViewer` lightbox, `MessageSearchBar`, composer banners/chips (`MessageComposer`), "new messages" pill (`MessageTimeline`), and smooth `transition-opacity`/`duration-150` on interactive buttons/hover toolbars.
   - In `MessageTimeline.tsx`, distinguish initial conversation load (`prevMessageCount === 0` → `behavior: "auto"` instant jump to bottom) from incremental new messages (`behavior: "smooth"`), eliminating the jarring 50-message scroll sweep on conversation switch.

**Alternatives**:
- *Pass file bytes (`ArrayBuffer`) over Tauri IPC instead of adding `tauri-plugin-dialog`*: Keeps `<input type="file">` and `URL.createObjectURL` thumbnails working, but requires changing the `message_send` / `profile_update` IPC contract, implementing raw binary `tauri::ipc::Request` handling for up to 50 MB attachments to avoid JSON overhead, and moving unencrypted file bytes across the WebView→Rust boundary. Rejected in favor of `tauri-plugin-dialog` to preserve the existing path-based IPC boundary and keep plaintext file reads strictly in Rust.
- *Add `framer-motion` for animations*: Enables exit animations out of the box, but adds significant bundle weight and complexity for a lightweight desktop chat app where CSS keyframes + Tailwind transitions cover 95% of perceived smoothness.

**Files likely to change**:
- `src/App.tsx`
- `src/components/chat/MessageComposer.tsx`
- `src/components/modals/ProfileModal.tsx`
- `src/lib/tauri-client.ts`
- `src/lib/ui-polish.ts`
- `src/lib/ui-polish.test.ts` (and/or `src/lib/__tests__/ui-polish.test.ts`)
- `src/styles/globals.css`
- `src/components/chat/MessageTimeline.tsx`
- `src/components/chat/MessageBubble.tsx`
- `src/components/modals/GroupManageDrawer.tsx`
- `src/components/chat/MediaViewer.tsx`
- `src/components/chat/MessageSearchBar.tsx`
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/default.json`

**Tests to add or update**:
- Unit test verifying `upsertMessageWithReplySync` prevents duplicate entries when `message:upsert` and `messageSend` return the same `MessageDto.id`.
- Unit test for attachment extension/path validation helper (allowed extensions `png/jpg/jpeg/webp/gif/mp4/webm`, case-insensitive, rejects disallowed extensions).
- Unit test for `MessageTimeline` scroll behavior helper (initial load uses `"auto"`, incremental append uses `"smooth"`).
- Existing `cargo test --manifest-path src-tauri/Cargo.toml` and `npm run build` + `npm test`.

## Risks & Considerations

- **Capability & CSP compliance**: Adding `"dialog:allow-open"` to `src-tauri/capabilities/default.json` grants user-initiated file open dialogs only (no arbitrary filesystem read/write permissions exposed to JS). Rust still performs authoritative file size (`<= 50 MB`) and MIME validation in `message_send_core`.
- **Staged attachment image thumbnail**: Switching from HTML5 `File` to a native OS path means `URL.createObjectURL(file)` is no longer available in the composer before sending; the staged attachment chip will show the file icon (image/video badge) + filename unless an explicit preview loader is added. (Keeping the icon+filename chip avoids reading unencrypted files into WebView memory.)
- **Privacy shield timing**: Any transition added to the focus-loss privacy overlay in `App.tsx` must not delay hiding sensitive content when focus is lost (keep blur/cover immediate on focus loss; smooth transition only if non-delaying).
- **Duplicate test files**: Note both `src/lib/ui-polish.test.ts` and `src/lib/__tests__/ui-polish.test.ts` exist; keep Vitest tests clean and non-duplicative during `/speckit-bug-fix`.

## Open Questions

- None — all three issues are directly confirmed in the codebase and screenshots.
