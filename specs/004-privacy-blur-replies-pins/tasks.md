---

description: "Task list for feature 004-privacy-blur-replies-pins"
---

# Tasks: Privacy Focus Blur, Custom Application Icon, Message Replies, and Pinned Messages

**Input**: Design documents from `/specs/004-privacy-blur-replies-pins/`

**Prerequisites**: `plan.md` (required), `spec.md` (required for user stories), `research.md`, `data-model.md`, `contracts/tauri-ipc.md`, `contracts/supabase-schema-and-realtime.md`, `quickstart.md`

**Tests**: Required for cryptographic envelope changes, reply verification, fail-closed cross-conversation checks, and shared pin authorization/auto-unpin per Constitution Principle V (`Test-First Verification & Security Gates`).

**Organization**: Tasks are grouped by user story (`US1`..`US4`) in priority order to enable independent implementation and testing of each increment, followed by documentation and governance synchronization (`README.md`, `AGENTS.md`, and canonical contracts).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Exact file paths and verbatim `data-model.md` constraints are included in task descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify master icon artwork and baseline project build/test readiness before foundational schema and DTO changes.

- [X] T001 Verify canonical master icon source exists at `specs/004-privacy-blur-replies-pins/assets/app-icon-source.png` and prepare target asset directory `src/assets/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core cryptographic envelope extension, PostgreSQL migration, `LocalLoopbackStore` parity, and shared Rust/TypeScript DTO definitions that block User Stories 2 and 3.

**⚠️ CRITICAL**: Complete this phase before starting User Story 2 or User Story 3 implementation.

- [X] T002 Extend `EncryptedMessageEnvelope` with `#[serde(default, skip_serializing_if = "Option::is_none")] pub reply_to_message_id: Option<Uuid>` in `src-tauri/src/crypto/aead.rs`
- [X] T003 [P] Create PostgreSQL migration for `public.pinned_messages` (`conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE`, `message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE`, `pinned_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`, `pinned_at timestamptz NOT NULL DEFAULT now()`, `PRIMARY KEY (conversation_id, message_id)`), index `idx_pinned_messages_conv_pinned_at ON public.pinned_messages (conversation_id, pinned_at DESC)`, RLS policies (`pinned_messages_select_member`, `pinned_messages_insert_member` requiring `pinned_by = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid()) AND NOT m.is_removed`, `pinned_messages_delete_member`), and updated `public.remove_sent_message(msg_id uuid)` executing `DELETE FROM public.pinned_messages WHERE message_id = msg_id;` in `supabase/migrations/0002_pinned_messages.sql`
- [X] T004 [P] Define `PinnedMessageRow` (`conversation_id: Uuid`, `message_id: Uuid`, `pinned_by: Uuid`, `pinned_at: DateTime<Utc>`) and add `pub pinned_messages: Vec<PinnedMessageRow>` to `LocalLoopbackStore` in `src-tauri/src/supabase/mod.rs`
- [X] T005 Implement PostgREST and `LocalLoopbackStore` methods `pin_message`, `unpin_message`, and `list_pinned_messages` (enforcing `is_conversation_member`, same-conversation message validation, `!msg.is_removed`, and `ORDER BY pinned_at DESC`), and update `rpc_remove_sent_message` and last-member group cleanup to delete matching `pinned_messages` entries in `src-tauri/src/supabase/postgrest.rs`
- [X] T006 [P] Define `MessageReplyPreviewDto` (`message_id: String`, `sender_id: String`, `sender_display_name: String`, `status: DecryptionStatus`, `text: Option<String>`, `has_attachment: bool`, `attachment_mime: Option<String>`, `is_edited: bool`), `PinnedMessageDto` (`conversation_id: String`, `message_id: String`, `pinned_by_id: String`, `pinned_by_display_name: String`, `pinned_at: DateTime<Utc>`, `message: MessageDto`), and extend `MessageDto` with `reply_to: Option<MessageReplyPreviewDto>`, `is_pinned: bool`, `pinned_at: Option<DateTime<Utc>>`, and `pinned_by_display_name: Option<String>` in `src-tauri/src/commands/mod.rs`
- [X] T007 [P] Add `MessageReplyPreviewDto` (`status: DecryptionStatus` as `"verified" | "verification_failed" | "removed"`, `text: string | null`, `has_attachment: boolean`, `attachment_mime: string | null`, `is_edited: boolean`), `PinnedMessageDto`, and extend `MessageDto` with `reply_to: MessageReplyPreviewDto | null`, `is_pinned: boolean`, `pinned_at: string | null`, and `pinned_by_display_name: string | null` in `src/lib/types.ts`

**Checkpoint**: Foundation ready — user stories can now proceed.

---

## Phase 3: User Story 1 - Automatic Privacy Blur on Focus Loss (Priority: P1) 🎯 MVP

**Goal**: Immediately obscure the entire application viewport (`<100ms`) behind a full-window privacy blur shield whenever the Bloop window loses OS focus, and immediately restore clarity when focus returns.

**Independent Test**: Open Bloop (authenticated or unauthenticated), click outside the window or press `Alt+Tab`, verify the entire viewport immediately blurs behind the privacy shield making all text/contacts/media illegible, and click back into the window to verify instant restoration.

### Implementation for User Story 1

- [X] T008 [P] [US1] Attach `.on_window_event` listener in `tauri::Builder` to emit `window:focus_changed` with payload `{ "focused": focused }` on `tauri::WindowEvent::Focused(focused)` in `src-tauri/src/lib.rs`
- [X] T009 [P] [US1] Add `onWindowFocusChanged` event listener subscribing to `"window:focus_changed"` (`{ focused: boolean }`) in `src/lib/tauri-client.ts`
- [X] T010 [US1] Implement `isWindowFocused` state (`document.hasFocus()` initial value, updated by `window` `"focus"`/`"blur"`, `document` `"visibilitychange"`, and `tauriClient.onWindowFocusChanged`) and render the full-viewport privacy blur shield (`blur-xl select-none pointer-events-none` on content + `fixed inset-0 z-50 backdrop-blur-2xl bg-[var(--bg-canvas)]/80` overlay across both `AuthScreen` and authenticated `AppShell` views) in `src/App.tsx`

**Checkpoint**: User Story 1 is functional and independently testable.

---

## Phase 4: User Story 2 - Reply to a Message in Chat (Priority: P1)

**Goal**: Allow any active participant in a 1-to-1 or group chat to reply to a verified, non-removed message with cryptographic reply binding inside `EncryptedMessageEnvelope`, render a composer reply preview banner and quoted parent summary on sent replies, scroll/highlight the parent message on quote click, and fail closed on removed, unverified, or cross-conversation parent references.

**Independent Test**: Click "Reply" on a message, verify the composer reply banner appears, send a reply, verify the quoted parent message renders for all participants, click the quote to scroll to and highlight the original message, and verify editing or removing the parent message updates the quote or replaces it with `"Message removed"` (zero plaintext leakage).

### Tests for User Story 2 (Mandatory per Constitution Principle V) ⚠️

- [X] T011 [P] [US2] Extend `src-tauri/tests/crypto_negative_tests.rs` with unit tests verifying `EncryptedMessageEnvelope` roundtrip with `reply_to_message_id: Some(Uuid)`, backward compatibility when `reply_to_message_id` is omitted in JSON, and fail-closed `DecryptionStatus::VerificationFailed` when ciphertext containing `reply_to_message_id` is tampered
- [X] T012 [P] [US2] Create `src-tauri/tests/replies_and_pins_tests.rs` with negative and integration tests covering: (a) valid reply roundtrip resolving `MessageReplyPreviewDto` with `DecryptionStatus::Verified`, (b) fail-closed rejection when replying to a removed message or message from another conversation, (c) fail-closed `DecryptionStatus::VerificationFailed` (`text: None, attachment: None, reply_to: None`) when a decrypted envelope contains a self-referential `parent_id == row.id` or cross-conversation `parent_id`, (d) safe `DecryptionStatus::Removed` placeholder (`text: None, has_attachment: false`) when the parent message is subsequently removed, and (e) preservation of `reply_to_message_id` when editing a reply message

### Implementation for User Story 2

- [X] T013 [US2] Update `message_send_core`, `message_send`, `message_edit_core`, and `decrypt_message_row` in `src-tauri/src/commands/messages.rs` to validate `reply_to_message_id` before encryption, preserve `reply_to_message_id` on message edits, enforce fail-closed cross-conversation and self-reference rejection (`parent_id == row.id` or `parent_row.conversation_id != row.conversation_id` -> `DecryptionStatus::VerificationFailed`), and resolve `MessageReplyPreviewDto` (`Verified`, `Removed`, or `VerificationFailed` with zero plaintext leakage)
- [X] T014 [P] [US2] Update `tauriClient.messageSend` in `src/lib/tauri-client.ts` to accept optional `replyToMessageId?: string` and pass `replyToMessageId` to the `message_send` command
- [X] T015 [P] [US2] Update `src/components/chat/MessageComposer.tsx` to accept `replyingTo: MessageDto | null` and `onCancelReply: () => void`, rendering the active reply preview banner (`Replying to <sender_display_name>`, text snippet or attachment label, and dismiss button) above the input form
- [X] T016 [P] [US2] Update `src/components/chat/MessageBubble.tsx` to render the clickable quoted parent message preview (`message.reply_to` with safe `"Message removed"` or `"Unverified message"` placeholder when `status !== "verified"`), expose a hover `Reply` action button on verified non-removed messages, and support a highlighted visual ring state (`isHighlighted?: boolean`)
- [X] T017 [US2] Update `src/components/chat/MessageTimeline.tsx` and `src/App.tsx` to manage `replyingTo` draft state, clear `replyingTo` on conversation switch or send, and implement `scrollToMessage(messageId)` that scrolls to the target message element (`id="msg-<id>"`) and applies a temporary highlight ring

**Checkpoint**: User Stories 1 and 2 are functional and independently testable.

---

## Phase 5: User Story 3 - Pin Multiple Messages and Browse the `Pinned` Chat Subtab (Priority: P2)

**Goal**: Allow any active participant in a 1-to-1 or group chat to pin or unpin multiple verified, non-removed messages for the entire conversation, synchronize pin state in real time, automatically unpin removed messages, and provide a `Messages` | `Pinned (<count>)` subtab in each conversation with jump-to-message and unpin controls.

**Independent Test**: Pin two messages in a chat, verify both show pinned badges in the timeline and the `Pinned (2)` subtab count updates for all participants, switch to the `Pinned` subtab to view them in reverse chronological pin order (`pinned_at DESC`), click "Jump to message" to return to the timeline at that message, and unpin or remove a message to verify it disappears from `Pinned`.

### Tests for User Story 3 (Mandatory per Constitution Principle V) ⚠️

- [X] T018 [US3] Extend `src-tauri/tests/replies_and_pins_tests.rs` with integration and negative tests covering: (a) any active 1-to-1 or group participant (including non-host group members) can pin and unpin verified messages and list them in `pinned_at DESC` order, (b) fail-closed rejection when a non-member or removed group member attempts to pin/unpin/list pins, (c) fail-closed rejection when attempting to pin a removed message or a message from a different conversation, and (d) automatic removal of a message from `pinned_messages` when its sender removes the message via `message_remove_core`

### Implementation for User Story 3

- [X] T019 [US3] Implement `message_pin_core`, `message_unpin_core`, `message_list_pinned_core`, and Tauri commands `message_pin`, `message_unpin`, and `message_list_pinned` (plus pin metadata hydration on `decrypt_message_row` and `realtime:pins_changed` emission in `message_remove`) in `src-tauri/src/commands/messages.rs`
- [X] T020 [US3] Subscribe to `{ "event": "*", "schema": "public", "table": "pinned_messages" }` in `src-tauri/src/supabase/realtime.rs`, emit `"realtime:pins_changed"` (`{ "conversation_id": cid }`) on `pinned_messages` changes in `src-tauri/src/commands/mod.rs`, and register `commands::messages::message_pin`, `commands::messages::message_unpin`, and `commands::messages::message_list_pinned` in `src-tauri/src/lib.rs`
- [X] T021 [P] [US3] Add `messagePin`, `messageUnpin`, `messageListPinned`, and `onPinsChanged` listener in `src/lib/tauri-client.ts`
- [X] T022 [P] [US3] Update `src/components/chat/ChatHeader.tsx` to render the `Messages` and `Pinned` (with numeric count badge) subtab switcher bar
- [X] T023 [P] [US3] Create `src/components/chat/PinnedMessagesView.tsx` displaying pinned messages in reverse chronological pin order (`pinned_at DESC`) with sender, timestamp, `Pinned by <name>`, decrypted content/media preview, `Jump to message` action, `Unpin` action, and empty state (`"No pinned messages in this conversation yet"`)
- [X] T024 [US3] Update `src/components/chat/MessageBubble.tsx`, `src/components/chat/MessageTimeline.tsx`, and `src/App.tsx` to wire `Pin` / `Unpin` actions and pinned indicator badges on timeline messages, synchronize `pinnedMessages` via `messageListPinned` and `onPinsChanged`, switch between `Messages` and `Pinned` subtabs, and jump from a pinned entry back to the highlighted message in the `Messages` timeline

**Checkpoint**: User Stories 1, 2, and 3 are functional and independently testable.

---

## Phase 6: User Story 4 - Custom Branded Application Icon (Priority: P3)

**Goal**: Package and display the user-supplied blue emblem artwork (`specs/004-privacy-blur-replies-pins/assets/app-icon-source.png`) across Windows application icon resources (`16x16`..`256x256` `.ico` and Tauri PNGs) and in-app brand surfaces while preserving `ITaskbarList3` unread badge overlay legibility.

**Independent Test**: Build/launch Bloop on Windows and verify that `src-tauri/icons/icon.ico`, window chrome, taskbar button (with unread badge overlay), `AuthScreen`, `NavRail`, workspace empty state, and privacy blur shield display the custom emblem icon sharply without distortion.

### Implementation for User Story 4

- [X] T025 [P] [US4] Generate multi-resolution Windows `src-tauri/icons/icon.ico` (`16x16`, `24x24`, `32x32`, `48x48`, `64x64`, `128x128`, `256x256` RGBA frames), `src-tauri/icons/icon.png` (`512x512`), `src-tauri/icons/32x32.png`, `src-tauri/icons/128x128.png`, `src-tauri/icons/128x128@2x.png`, and `src/assets/app-icon.png` from `specs/004-privacy-blur-replies-pins/assets/app-icon-source.png`
- [X] T026 [US4] Update in-app brand emblem surfaces in `src/components/modals/AuthScreen.tsx`, `src/components/layout/NavRail.tsx`, and `src/App.tsx` (workspace empty state and privacy focus blur shield) to render `src/assets/app-icon.png`

**Checkpoint**: All 4 user stories are complete and independently testable.

---

## Phase 7: Polish, Documentation & Cross-Cutting Concerns

**Purpose**: Synchronize canonical contracts, `README.md`, and `AGENTS.md` per the implementation plan and `AGENTS.md` Change Checklists, and run full verification gates.

- [X] T027 [P] Update canonical IPC contract `specs/001-private-talk-chat/contracts/tauri-ipc.md` and canonical Supabase contract `specs/001-private-talk-chat/contracts/supabase-schema-and-realtime.md` with `reply_to_message_id`, `message_pin`, `message_unpin`, `message_list_pinned`, `realtime:pins_changed`, `window:focus_changed`, and `public.pinned_messages`
- [X] T028 [P] Update `README.md` to document Automatic Privacy Blur on Focus Loss, Authenticated Message Replies, Shared Pinned Messages & `Pinned` Subtab, Custom Branded Application Icon, `supabase/migrations/0002_pinned_messages.sql`, and `src/components/chat/PinnedMessagesView.tsx`
- [X] T029 [P] Update `AGENTS.md` to reference `specs/004-privacy-blur-replies-pins/`, document the updated `aead.rs`, `commands/messages.rs`, and `supabase/migrations/0002_pinned_messages.sql` architecture boundaries, and add security invariants for Authenticated Reply Binding & Cross-Conversation Fail-Closed Rejection and Focus-Loss Privacy Shield
- [X] T030 Execute full verification suite (`npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml`) to confirm zero TypeScript/Vite errors and all Rust unit, negative crypto, reply, and pin tests pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — starts immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS** User Story 2 and User Story 3.
- **Phase 3 (User Story 1 - P1 Privacy Blur)**: Independent of Phase 2 database/crypto changes; can start immediately after Phase 1 or alongside Phase 2.
- **Phase 4 (User Story 2 - P1 Message Replies)**: Depends on Phase 2 (`T002`, `T006`, `T007`).
- **Phase 5 (User Story 3 - P2 Pinned Messages & `Pinned` Subtab)**: Depends on Phase 2 (`T003`..`T007`) and integrates cleanly with `MessageBubble.tsx`, `MessageTimeline.tsx`, and `App.tsx` from Phase 4.
- **Phase 6 (User Story 4 - P3 Custom Branded Application Icon)**: Depends on Phase 1 (`T001`); asset generation (`T025`) can run in parallel with any phase.
- **Phase 7 (Polish & Documentation)**: Depends on completion of Phases 3–6.

### User Story Dependency Graph

```text
Phase 1 (Setup: T001)
 ├──► Phase 3 (US1: Privacy Blur on Focus Loss [P1] - T008..T010) 🎯 MVP Increment 1
 ├──► Phase 6 (US4: Custom Branded App Icon [P3] - T025..T026)
 └──► Phase 2 (Foundational: Envelope, DB Migration, Store & DTOs - T002..T007)
       ├──► Phase 4 (US2: Authenticated Message Replies [P1] - T011..T017) 🎯 MVP Increment 2
       └──► Phase 5 (US3: Shared Pinned Messages & Pinned Subtab [P2] - T018..T024)
             └──► Phase 7 (Docs, Contracts & Full Verification Gate - T027..T030)
```

### Parallel Opportunities

- **Foundational (Phase 2)**: `T003` (SQL migration), `T004` (`Supabase` row models), `T006` (Rust DTOs), and `T007` (TypeScript DTOs) touch separate files and can run in parallel.
- **User Story 1**: `T008` (`src-tauri/src/lib.rs`) and `T009` (`src/lib/tauri-client.ts`) can run in parallel before `T010` (`src/App.tsx`).
- **User Story 2**: `T011` (`crypto_negative_tests.rs`) and `T012` (`replies_and_pins_tests.rs`) can run in parallel; `T014` (`tauri-client.ts`), `T015` (`MessageComposer.tsx`), and `T016` (`MessageBubble.tsx`) can run in parallel before `T017`.
- **User Story 3**: `T021` (`tauri-client.ts`), `T022` (`ChatHeader.tsx`), and `T023` (`PinnedMessagesView.tsx`) can run in parallel before `T024`.
- **User Story 4**: `T025` (icon generation) can run in parallel with backend work in Phases 2–5.
- **Polish (Phase 7)**: `T027` (canonical contracts), `T028` (`README.md`), and `T029` (`AGENTS.md`) can all run in parallel before `T030`.

---

## Parallel Execution Examples

### Parallel Example 1: Foundational Layer (Phase 2)

```bash
Task: "T003 [P] Create PostgreSQL migration for public.pinned_messages in supabase/migrations/0002_pinned_messages.sql"
Task: "T004 [P] Define PinnedMessageRow and extend LocalLoopbackStore in src-tauri/src/supabase/mod.rs"
Task: "T006 [P] Define MessageReplyPreviewDto, PinnedMessageDto, and extend MessageDto in src-tauri/src/commands/mod.rs"
Task: "T007 [P] Add MessageReplyPreviewDto, PinnedMessageDto, and extend MessageDto in src/lib/types.ts"
```

### Parallel Example 2: User Story 2 (Message Replies)

```bash
# Security & negative tests in parallel:
Task: "T011 [P] [US2] Extend src-tauri/tests/crypto_negative_tests.rs with reply envelope tampering tests"
Task: "T012 [P] [US2] Create src-tauri/tests/replies_and_pins_tests.rs with reply validation and fail-closed tests"

# UI components & client bindings in parallel:
Task: "T014 [P] [US2] Update tauriClient.messageSend in src/lib/tauri-client.ts"
Task: "T015 [P] [US2] Update src/components/chat/MessageComposer.tsx with active reply preview banner"
Task: "T016 [P] [US2] Update src/components/chat/MessageBubble.tsx with quoted parent preview and Reply action"
```

### Parallel Example 3: User Story 3 (Pinned Messages & Subtab)

```bash
Task: "T021 [P] [US3] Add messagePin, messageUnpin, messageListPinned, and onPinsChanged in src/lib/tauri-client.ts"
Task: "T022 [P] [US3] Update src/components/chat/ChatHeader.tsx with Messages | Pinned (<count>) subtab bar"
Task: "T023 [P] [US3] Create src/components/chat/PinnedMessagesView.tsx for the Pinned subtab"
```

---

## Implementation Strategy

### MVP First (P1 Stories: User Story 1 + User Story 2)

1. Complete **Phase 1: Setup** (`T001`) and **Phase 2: Foundational** (`T002`..`T007`).
2. Complete **Phase 3: User Story 1** (`T008`..`T010`) — validates immediate focus-loss privacy blur (`<100ms`).
3. Complete **Phase 4: User Story 2** (`T011`..`T017`) — validates authenticated E2EE replies and jump-to-parent navigation.
4. **STOP and VALIDATE**: Run `cargo test --manifest-path src-tauri/Cargo.toml` and `npm run build`.

### Incremental Delivery

1. **Foundation + US1 (P1)**: Focus-loss privacy blur shield active across all windows.
2. **+ US2 (P1)**: End-to-end authenticated message replies with quote navigation and fail-closed parent removal/tampering protection.
3. **+ US3 (P2)**: Shared conversation message pinning, real-time pin sync, auto-unpin on message removal, and `Pinned` subtab.
4. **+ US4 (P3) & Polish**: Multi-resolution custom Windows application icon, in-app brand emblems, and updated `README.md`, `AGENTS.md`, and canonical contracts.

---

## Phase 8: Convergence

- [X] T031 Update `onEditMessage`, `onRemoveMessage`, and `onMessageUpsert` in `src/App.tsx` to refresh matching `pinnedMessages` entries (and prune removed ones) and update `reply_to` previews on in-memory `messages` when a parent message is edited or removed per spec Edge Cases (Original message edited after being replied to or pinned) (partial)
- [X] T032 Render an `Edited` indicator on `message.reply_to` quoted previews in `src/components/chat/MessageBubble.tsx` when `message.reply_to.is_edited` is true and on pinned cards in `src/components/chat/PinnedMessagesView.tsx` when `message.is_edited` is true per spec Edge Cases (Original message edited after being replied to or pinned) (partial)
