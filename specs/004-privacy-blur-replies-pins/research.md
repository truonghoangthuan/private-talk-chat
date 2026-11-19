# Phase 0 Research: Privacy Focus Blur, Custom Application Icon, Message Replies, and Pinned Messages

**Feature**: `004-privacy-blur-replies-pins`  
**Date**: 2026-11-20

---

## 1. Window Focus Loss Detection & Full-Viewport Privacy Blur (FR-001, FR-002, SC-001)

- **Decision**: Combine Tauri native window focus events (`tauri::WindowEvent::Focused(bool)` emitted as `window:focus_changed`) with WebView2 DOM `window` `blur`/`focus` and `document` `visibilitychange` listeners in `src/App.tsx`, rendering an immediate CSS `backdrop-blur-2xl` overlay shield plus `blur-xl` filter on the underlying root view whenever unfocused.
- **Rationale**:
  - WebView2 `window.addEventListener("blur")` fires synchronously (<5 ms) when focus leaves the webview, while Tauri's native `WindowEvent::Focused(false)` catches OS-level window deactivation (Alt+Tab, Win+D, taskbar click, minimize, or clicking native window chrome) even if the webview child control didn't hold DOM focus.
  - Applying both a content-level `blur-xl select-none pointer-events-none` class and a `fixed inset-0 z-50 backdrop-blur-2xl` shield guarantees zero legible text, contact names, or media previews during rapid focus switching or background message arrivals.
- **Alternatives Considered**:
  - *DOM `blur`/`focus` events alone*: Rejected because clicking the native Windows titlebar or minimizing when WebView2 hasn't received a click can miss edge deactivation states.
  - *Unmounting React tree on blur*: Rejected because unmounting resets scroll position, draft text in `MessageComposer`, and open modals.

---

## 2. Cryptographically Bound Message Reply References (FR-004..FR-008, SC-004)

- **Decision**: Embed `#[serde(default, skip_serializing_if = "Option::is_none")] pub reply_to_message_id: Option<Uuid>` directly inside `EncryptedMessageEnvelope` in `src-tauri/src/crypto/aead.rs`, and resolve parent quote previews (`MessageReplyPreviewDto`) in Rust during `decrypt_message_row`.
- **Rationale**:
  - `EncryptedMessageEnvelope` is serialized to JSON and encrypted with `ChaCha20-Poly1305` (with AAD = `conversation_id || message_id || epoch`), and the resulting ciphertext hash is signed with the sender's `Ed25519` key (`MSG_SIG_PREFIX || conversation_id || message_id || epoch || nonce || sha256(ciphertext)`).
  - Putting `reply_to_message_id` inside `EncryptedMessageEnvelope` ensures:
    1. **Zero Server Plaintext / Metadata Leakage**: Supabase never sees the reply graph in plaintext columns.
    2. **Cryptographic Authentication**: Any tampering with `reply_to_message_id` in transit or at rest invalidates both the `Ed25519` signature and the `ChaCha20-Poly1305` Poly1305 tag.
    3. **Fail-Closed Cross-Conversation Validation**: Upon decryption, Rust verifies that `reply_to_message_id != row.id` and that any existing parent message belongs to `row.conversation_id`. If a crafted envelope references a message from another conversation, `decrypt_message_row` fails closed with `DecryptionStatus::VerificationFailed`.
    4. **Backward Compatibility**: `#[serde(default, skip_serializing_if = "Option::is_none")]` transparently decrypts existing messages sent before feature `004` without altering the wire format for non-reply messages.
    5. **Live Edit & Removal Consistency**: Because only the parent `Uuid` is stored in the envelope (not a static plaintext copy of the parent text), if the parent message is later edited or removed, `decrypt_message_row` and frontend state resolve the parent's latest verified text or `"Message removed"` placeholder with zero stale plaintext leakage.
- **Alternatives Considered**:
  - *Plaintext `reply_to_message_id` column on `public.messages`*: Rejected because an unauthenticated DB column could be altered server-side unless added to AAD/signature version v2, and it unnecessarily leaks conversational threading metadata to the server.
  - *Storing parent quote text snapshot inside the child envelope*: Rejected because if the parent sender later removes their message (`FR-008`), a copied quote inside the child message would continue leaking the deleted plaintext.

---

## 3. Shared Pinned Messages & Real-Time Synchronization (FR-009..FR-013, SC-003)

- **Decision**: Add a dedicated `public.pinned_messages` table in `supabase/migrations/0002_pinned_messages.sql` with strict conversation-member RLS, cascade cleanup on message removal (`remove_sent_message`), matching `LocalLoopbackStore` support, and a `postgres_changes` Realtime subscription on `public.pinned_messages`.
- **Rationale**:
  - Any active conversation participant (1-to-1 or group, not restricted to group host) must be able to pin or unpin messages for the entire conversation (`FR-009`).
  - Current RLS on `public.messages` restricts `UPDATE` strictly to `sender_id = auth.uid()`. Keeping `public.messages` immutable to non-senders preserves sender-only edit/removal security while allowing any conversation member to `INSERT` or `DELETE` rows in `public.pinned_messages`.
  - Storing `(conversation_id, message_id, pinned_by, pinned_at)` leaks zero message plaintext to Supabase; clients decrypt the referenced `messages` row locally using their conversation epoch keys.
  - Updating `public.remove_sent_message(msg_id)` to delete matching `public.pinned_messages` rows guarantees that removed messages are automatically unpinned (`FR-013`).
- **Alternatives Considered**:
  - *Adding `is_pinned` column on `public.messages`*: Rejected because allowing non-senders to `UPDATE public.messages` weakens table-level RLS protecting `ciphertext`, `nonce`, and `signature`.
  - *Local-only pin state in DPAPI*: Rejected per clarification session 2026-11-20 (`FR-009`, `FR-010`: pins are shared across all conversation participants).

---

## 4. Custom Branded Application Icon Packaging (FR-003, SC-005)

- **Decision**: Generate multi-resolution Windows `.ico` (`16x16`, `24x24`, `32x32`, `48x48`, `64x64`, `128x128`, `256x256` RGBA frames) and standard Tauri PNG icon sizes (`icon.png`, `32x32.png`, `128x128.png`, `128x128@2x.png`) from `specs/004-privacy-blur-replies-pins/assets/app-icon-source.png`, and embed the icon in `src/assets/app-icon.png` for in-app brand surfaces (`AuthScreen`, `NavRail`, workspace empty state, privacy blur shield).
- **Rationale**:
  - Windows taskbar, Alt+Tab switcher, titlebar, and Explorer shell select different frame dimensions from `src-tauri/icons/icon.ico` depending on DPI scaling (100%–250%). Including all standard frames from `16x16` to `256x256` ensures crisp rendering and keeps the bottom-right `ITaskbarList3::SetOverlayIcon` unread counter legible.
- **Alternatives Considered**:
  - *Single-frame 256x256 `.ico`*: Rejected because Windows downscaling at 16x16 and 24x24 produces aliasing artifacts in the window titlebar and system tray/taskbar small-icon mode.

---

## 5. Documentation & Governance Alignment (`README.md` & `AGENTS.md`)

- **Decision**: Update `README.md`, `AGENTS.md`, and `specs/001-private-talk-chat/contracts/*` as first-class deliverables of the implementation plan.
- **Rationale**:
  - `AGENTS.md` defines the canonical change checklists and security invariants for all agents working in `private-talk-chat`. Recording the new IPC commands (`message_pin`, `message_unpin`, `message_list_pinned`, `message_send` with `reply_to_message_id`), events (`realtime:pins_changed`, `window:focus_changed`), database migration (`0002_pinned_messages.sql`), and security rules keeps project documentation and governance synchronized.
