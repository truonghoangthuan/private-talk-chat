# Contract: Tauri Rust-to-UI IPC & UI/UX Delta Specification

**Feature**: `004-privacy-blur-replies-pins`  
**Date**: 2026-11-20  
**Boundary**: WebView2 TypeScript UI <-> Tauri v2 Rust Core

---

## 1. Security Invariants

1. **Authenticated Reply Linkage**: `reply_to_message_id` never crosses the network as unauthenticated plaintext metadata; it is bound inside `EncryptedMessageEnvelope` (`ChaCha20-Poly1305` + `Ed25519`).
2. **Fail-Closed Cross-Conversation & Verification Checks**:
   - Any reply referencing a `message_id` from a different `conversation_id` or self-referencing `row.id` fails closed with `DecryptionStatus::VerificationFailed` (`text: null, attachment: null, reply_to: null`).
   - Any reply referencing a parent message that was removed (`is_removed = true`) or failed cryptographic verification returns a safe `MessageReplyPreviewDto` with `text: null, has_attachment: false, attachment_mime: null`.
   - Pin requests (`message_pin`) on removed messages, unverified messages, or messages outside `conversation_id` are rejected fail-closed in Rust before any database write.
3. **Full-Viewport Focus-Loss Privacy Shield**: Whenever the main window loses OS focus (`window:focus_changed` with `{ focused: false }`, DOM `window` `blur`, or `document.hidden`), the UI immediately obscures the entire viewport (`AuthScreen`, `AppShell`, modals, media previews, and notifications) behind a non-bypassable blur overlay.

---

## 2. Modified & New Tauri Commands (`invoke`)

| Command | Arguments | Return Type | Behavior |
|---------|-----------|-------------|----------|
| `message_send` *(extended)* | `{ conversation_id: string, text?: string, attachment_path?: string, reply_to_message_id?: string }` | `Result<MessageDto, AppError>` | If `reply_to_message_id` is present, verifies parent message exists in `conversation_id`, is not removed, and decrypts as `Verified`; binds `reply_to_message_id` inside `EncryptedMessageEnvelope`, encrypts with `ChaCha20-Poly1305`, signs with `Ed25519`, stores ciphertext, emits `realtime:message_upsert`. |
| `message_edit` *(extended)* | `{ message_id: string, new_text: string }` | `Result<MessageDto, AppError>` | Preserves both existing `attachment` metadata and `reply_to_message_id` inside `EncryptedMessageEnvelope` when re-encrypting and re-signing edited text. |
| `message_remove` *(extended)* | `{ message_id: string }` | `Result<MessageDto, AppError>` | Wipes encrypted payload, deletes media blob, removes any pin entry for `message_id`, emits `realtime:message_upsert` and `realtime:pins_changed`. |
| `message_pin` *(new)* | `{ conversation_id: string, message_id: string }` | `Result<PinnedMessageDto, AppError>` | Verifies caller is an active member of `conversation_id` and target message belongs to `conversation_id`, is not removed, and decrypts with `DecryptionStatus::Verified`. Upserts row in `pinned_messages` and emits `realtime:pins_changed` + `realtime:message_upsert`. |
| `message_unpin` *(new)* | `{ conversation_id: string, message_id: string }` | `Result<(), AppError>` | Verifies caller is an active member of `conversation_id`, deletes row from `pinned_messages`, and emits `realtime:pins_changed` + `realtime:message_upsert`. |
| `message_list_pinned` *(new)* | `{ conversation_id: string }` | `Result<Vec<PinnedMessageDto>, AppError>` | Verifies caller is an active member of `conversation_id`, fetches `pinned_messages` ordered by `pinned_at DESC`, decrypts each referenced message, filters out any removed or verification-failed entry, and returns `Vec<PinnedMessageDto>`. |

---

## 3. New & Updated Tauri Events (Rust -> WebView UI)

| Event Name | Payload DTO | Trigger Condition |
|------------|-------------|-------------------|
| `window:focus_changed` *(new)* | `{ focused: boolean }` | Native Tauri window receives `tauri::WindowEvent::Focused(focused)`. |
| `realtime:pins_changed` *(new)* | `{ conversation_id: string }` | A message is pinned, unpinned, or auto-unpinned via message removal in `conversation_id` (local command or Supabase Realtime `postgres_changes` on `public.pinned_messages`). |
| `realtime:message_upsert` *(updated)* | `MessageDto` | Includes resolved `reply_to: MessageReplyPreviewDto \| null`, `is_pinned: boolean`, `pinned_at: string \| null`, and `pinned_by_display_name: string \| null`. |

---

## 4. UI/UX Interaction Contract

1. **Privacy Focus Blur Shield**:
   - Engages within `<100ms` of focus loss across both authenticated and unauthenticated screens.
   - Applies `blur-xl select-none pointer-events-none` to the application content container and overlays a `fixed inset-0 z-50 backdrop-blur-2xl bg-[var(--bg-canvas)]/80` shield displaying the custom Bloop emblem and `"Window unfocused — content hidden for privacy"`.
2. **Reply Workflow**:
   - Every verified, non-removed message in `MessageBubble` exposes a `Reply` action button on hover.
   - Selecting `Reply` activates a compact reply context banner at the top of `MessageComposer` showing `Replying to <sender_display_name>`, a 1-line snippet (or attachment indicator), and an `X` button to cancel reply mode.
   - Sent reply messages render a clickable quoted preview block above the message body inside `MessageBubble`. Clicking the quoted block scrolls the timeline to the referenced parent message (switching to the `Messages` subtab if needed) and briefly highlights the parent message bubble with an indigo pulse ring.
3. **Pin Workflow & `Pinned` Subtab**:
   - Every verified, non-removed message in `MessageBubble` exposes a `Pin` / `Unpin` toggle action on hover and displays a subtle pin badge when `message.is_pinned` is true.
   - `ChatHeader` provides a segmented subtab bar: `Messages` and `Pinned` (with a numeric badge showing the count of pinned messages in the active conversation).
   - Selecting `Pinned` switches the main stage to the `Pinned` subtab view, listing all pinned messages in reverse chronological pin order (`pinned_at DESC`) with sender, timestamp, `Pinned by <name>`, decrypted content/media preview, a `Jump to message` button, and an `Unpin` button.
   - When zero messages are pinned, the `Pinned` subtab renders a clean empty state (`"No pinned messages in this conversation yet"`).
4. **Custom Branded Application Icon**:
   - `src-tauri/icons/icon.ico` and `src-tauri/icons/icon.png` (plus standard Tauri icon sizes and `src/assets/app-icon.png`) use the provided blue emblem icon artwork (`specs/004-privacy-blur-replies-pins/assets/app-icon-source.png`).
