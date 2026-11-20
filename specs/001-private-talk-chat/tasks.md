---
description: "Actionable, dependency-ordered task list for Bloop Windows Chat Application"
---

# Tasks: Bloop Windows Chat Application

**Input**: Design documents from `/specs/001-private-talk-chat/`
**Prerequisites**: [plan.md](file:///c:/work/temp/playground/private-talk-chat/specs/001-private-talk-chat/plan.md) (required), [spec.md](file:///c:/work/temp/playground/private-talk-chat/specs/001-private-talk-chat/spec.md) (required), [research.md](file:///c:/work/temp/playground/private-talk-chat/specs/001-private-talk-chat/research.md), [data-model.md](file:///c:/work/temp/playground/private-talk-chat/specs/001-private-talk-chat/data-model.md), [contracts/](file:///c:/work/temp/playground/private-talk-chat/specs/001-private-talk-chat/contracts/)

**Tests**: Included for cryptographic, Windows DPAPI, and group epoch rotation security gates required by Constitution Principle V (`Test-First Verification & Security Gates`) and `SC-006`.

**Organization**: Tasks are grouped by user story (`US1`–`US5`) to enable independent implementation, verification, and incremental MVP delivery.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (`[US1]`–`[US5]`, used strictly in User Story phases)
- Exact file paths and verbatim `data-model.md` constraints are included in task descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the Tauri v2 (Rust + React/TypeScript/Tailwind CSS v4) workspace and Supabase configuration.

- [X] T001 Configure Tauri v2 Rust crate dependencies (`tauri`, `tauri-plugin-notification`, `windows`, `chacha20poly1305`, `x25519-dalek`, `ed25519-dalek`, `argon2`, `hkdf`, `sha2`, `rand_core`, `zeroize`, `reqwest`, `tokio`, `tokio-tungstenite`, `serde`, `serde_json`) and Windows desktop capabilities in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`
- [X] T002 [P] Initialize React 19, TypeScript 5.7+, Tailwind CSS v4, Radix UI primitives, and Lucide icons frontend build configuration in `package.json`, `tsconfig.json`, and `vite.config.ts`
- [X] T003 [P] Configure minimal dark/light adaptive design tokens (`#0B0D12` dark canvas, `#F8FAFC` light canvas, `#12161F` elevated surface, `#1A202C` message bubble, `#6366F1` primary indigo accent, `#10B981` emerald online dot, `#EF4444` fail-closed security alert, `Inter`/`Geist` typography) in `src/styles/globals.css`
- [X] T004 [P] Configure Supabase local project settings (Auth with email confirmation disabled, Realtime, Storage) and environment variable template in `supabase/config.toml` and `.env.example`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core database schema, cryptographic primitives, Windows DPAPI boundary, in-memory media protocol, Supabase client, and 3-zone UI shell that MUST be complete before any user story begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 Create declarative PostgreSQL migration for `profiles`, `contacts`, `conversations`, `conversation_members`, `conversation_member_keys`, `messages`, and `message_reads` tables with `citext`, Row-Level Security policies, `SECURITY DEFINER` RPCs (`is_conversation_member`, `add_mutual_contact`, `remove_or_leave_group_member`, `remove_sent_message`), and Storage buckets (`avatars`, `chat-media`) enforcing all table constraints (`PK`, `REFERENCES ... ON DELETE CASCADE`, `UNIQUE NOT NULL`, `CHECK (username ~ '^[a-zA-Z0-9_]{3,32}$')`, `CHECK (char_length(display_name) BETWEEN 1 AND 64)`, `CHECK (octet_length(public_enc_key) = 32)`, `CHECK (octet_length(public_sign_key) = 32)`, `CHECK (octet_length(kdf_salt) = 16)`, `CHECK (user_id <> contact_id)`, `CHECK (NOT is_group OR (name IS NOT NULL AND char_length(name) BETWEEN 1 AND 80))`, `CHECK (current_epoch >= 1)`, `CHECK (epoch >= 1)`, `CHECK (octet_length(ephemeral_pub_key) = 32)`, `CHECK (octet_length(nonce) = 12)`, `CHECK (octet_length(wrapped_key) = 48)`, `CHECK (octet_length(signature) = 64)`, `CHECK (is_removed OR octet_length(nonce) = 12)`, `CHECK (is_removed OR ciphertext IS NOT NULL)`, `CHECK (is_removed OR octet_length(signature) = 64)`) in `supabase/migrations/0001_private_talk_schema.sql`
- [X] T006 [P] Implement split-credential derivation in `src-tauri/src/crypto/kdf.rs` and `src-tauri/src/crypto/mod.rs`: pre-auth `HKDF-SHA256` with deterministic `SHA-256("privatetalk-auth-v1:" || lower(username))[0..16]` salt for `supabase_auth_password`, and post-auth `Argon2id` (`m=64 MiB, t=3, p=4`, random 16-byte `kdf_salt` satisfying `CHECK (octet_length(kdf_salt) = 16)`) + `HKDF-SHA256` for 256-bit `key_wrapping_key`
- [X] T007 [P] Implement `X25519` (`public_enc_key` 32 bytes) and `Ed25519` (`public_sign_key` 32 bytes) keypair generation, private key bundle wrapping (`wrapped_priv_keys`), ephemeral-static `X25519` ECDH `ConversationEpochKey` wrapping/unwrapping (`ephemeral_pub_key` 32 bytes, `nonce` 12 bytes, `wrapped_key` 48 bytes, `signature` 64 bytes), and `ZeroizeOnDrop` key structs in `src-tauri/src/crypto/keys.rs`
- [X] T008 [P] Implement `ChaCha20-Poly1305` authenticated encryption/decryption (96-bit 12-byte CSPRNG `nonce`) and `Ed25519` 64-byte signature creation/verification for `EncryptedMessageEnvelope` and media buffers with fail-closed `DecryptionStatus::VerificationFailed` handling in `src-tauri/src/crypto/aead.rs`
- [X] T009 [P] Implement Windows DPAPI wrapper (`CryptProtectData` and `CryptUnprotectData` with `CRYPTPROTECT_UI_FORBIDDEN`) for `DpapiProtectedSession` (`x25519_private_key: [u8; 32]`, `ed25519_private_key: [u8; 32]`, `cached_epoch_keys: HashMap<(Uuid, i32), [u8; 32]>`, all `ZeroizeOnDrop`) persisted at `%LOCALAPPDATA%\PrivateTalk\session.dpapi` (with optional `PRIVATE_TALK_PROFILE` isolation) in `src-tauri/src/platform/dpapi.rs` and `src-tauri/src/platform/mod.rs`
- [X] T010 [P] Implement zeroized in-memory LRU decrypted media cache and register custom Tauri URI scheme `privatetalk-media://localhost/<conversation_id>/<message_id>` in `src-tauri/src/state/media_cache.rs`, `src-tauri/src/state/mod.rs`, and `src-tauri/src/main.rs`
- [X] T011 Implement Supabase Auth, PostgREST, Storage, and Realtime Phoenix WebSocket client (`presence:global`, `room:<conversation_id>`, and `postgres_changes` subscriptions) with secret-redacting error types in `src-tauri/src/supabase/mod.rs`, `src-tauri/src/supabase/auth.rs`, `src-tauri/src/supabase/postgrest.rs`, `src-tauri/src/supabase/storage.rs`, and `src-tauri/src/supabase/realtime.rs`
- [X] T012 [P] Define shared TypeScript DTO contracts (`UserProfileDto`, `ContactDto`, `ConversationDto`, `MessageDto`, `SeenReceiptDto`, `DecryptionStatus`) and typed Tauri `invoke()`/`listen()` client helpers in `src/lib/types.ts` and `src/lib/tauri-client.ts`
- [X] T013 Initialize Tauri managed state, zero-leakage tracing subscriber, command registration, and 3-zone minimal application shell (`AppShell`, `NavRail`, `Sidebar`) in `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src/components/layout/AppShell.tsx`, `src/components/layout/NavRail.tsx`, `src/components/layout/Sidebar.tsx`, `src/App.tsx`, and `src/main.tsx`

**Checkpoint**: Foundation ready — user story implementation can now proceed.

---

## Phase 3: User Story 1 - Account Registration, Login, and Profile Setup (Priority: P1) 🎯 MVP

**Goal**: Enable users to create an account or sign in with a unique username and password, derive split credentials and encryption keys in Rust, persist session secrets in Windows DPAPI, and update their display name and avatar.

**Independent Test**: Register a new account (`alice`), upload a `<= 5 MB` PNG avatar, change display name, restart the app to verify automatic Windows DPAPI session restoration, log out, and log back in with username and password while verifying `profiles.wrapped_priv_keys` in Supabase remains opaque ciphertext.

### Tests for User Story 1 ⚠️

- [X] T014 [P] [US1] Write automated tests for Argon2id+HKDF split-credential derivation, private key bundle wrapping/unwrapping, and Windows DPAPI `DpapiProtectedSession` roundtrip and tamper rejection in `src-tauri/tests/dpapi_roundtrip_tests.rs`

### Implementation for User Story 1

- [X] T015 [US1] Implement `auth_register`, `auth_login`, `auth_restore_session`, `auth_logout`, and `profile_update` Tauri commands enforcing `username` (`3..=32` ASCII alphanumeric/underscore characters matching `CHECK (username ~ '^[a-zA-Z0-9_]{3,32}$')`), `display_name` (`NOT NULL`, `CHECK (char_length(display_name) BETWEEN 1 AND 64)`), `public_enc_key` (`octet_length(public_enc_key) = 32`), `public_sign_key` (`octet_length(public_sign_key) = 32`), `kdf_salt` (`octet_length(kdf_salt) = 16`), and avatar upload validation (`image/png`, `image/jpeg`, `image/webp`; strictly `<= 5 MB` (`5,242,880` bytes)) in `src-tauri/src/commands/auth.rs`
- [X] T016 [P] [US1] Build minimal login and registration screen with username (`^[a-zA-Z0-9_]{3,32}$`), password, and display name (`1..=64` chars) validation and clear error banners in `src/components/modals/AuthScreen.tsx`
- [X] T017 [P] [US1] Build profile settings modal for updating `display_name` (`BETWEEN 1 AND 64` chars) and uploading an avatar image (`image/png`, `image/jpeg`, `image/webp`; strictly `<= 5 MB` (`5,242,880` bytes)) with live preview in `src/components/modals/ProfileModal.tsx`

**Checkpoint**: User Story 1 is functional and independently testable as the authentication and identity MVP.

---

## Phase 4: User Story 2 - Contact Discovery and Encrypted 1-to-1 Text & Media Messaging (Priority: P1)

**Goal**: Enable authenticated users to find other users by exact case-insensitive username match, establish immediate mutual contacts, see live online presence (`who is online`), typing indicators, and per-message seen receipts (`who seen message`), and exchange end-to-end encrypted text, images, GIFs, and videos with fail-closed verification.

**Independent Test**: Using two instances (`alice` and `bob`), search `BOB` from `alice` to establish a mutual contact, verify live green online dots, open a 1-to-1 chat, verify `< 200ms` typing indicator propagation, send encrypted text, PNG, GIF, and MP4 (`<= 50 MB`), confirm `bob` views them via `privatetalk-media://` and `alice` sees `"Seen by Bob"`, and verify tampered ciphertexts fail closed with a security warning banner.

### Tests for User Story 2 ⚠️

- [X] T018 [P] [US2] Write negative security tests verifying fail-closed rejection (`DecryptionStatus::VerificationFailed`) on tampered `ChaCha20-Poly1305` ciphertexts, corrupted media SHA-256 hashes, wrong epoch keys, and forged 64-byte `Ed25519` signatures in `src-tauri/tests/crypto_negative_tests.rs`

### Implementation for User Story 2

- [X] T019 [P] [US2] Implement `contact_add_by_username` and `contact_list` Tauri commands enforcing exact case-insensitive username search (`3..=32` ASCII alphanumeric/underscore characters, `CHECK (user_id <> contact_id)` rejecting self-addition), immediate mutual contact insertion via `add_mutual_contact` RPC, and live `OnlinePresenceState` (`status: "online" | "offline"`) enrichment in `src-tauri/src/commands/contacts.rs`
- [X] T020 [US2] Implement `conversation_list` and `conversation_start_direct` Tauri commands loading caller's active conversations (with member rosters, latest decrypted snippet, and unread counts), verifying target user is in caller's `contacts`, setting deterministic `direct_pair_key` (`UNIQUE NULL`, `"<min_uuid>:<max_uuid>"`), and distributing wrapped `EpochKey(1)` (`current_epoch` `NOT NULL DEFAULT 1`, `CHECK (current_epoch >= 1)`, `ephemeral_pub_key` 32 bytes, `nonce` 12 bytes, `wrapped_key` 48 bytes, `signature` 64 bytes) in `src-tauri/src/commands/conversations.rs`
- [X] T021 [US2] Implement `message_list`, `message_send`, `message_mark_seen`, and `typing_set_status` Tauri commands enforcing pre-encryption media validation (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `video/mp4`, `video/webm`; strictly `<= 50 MB` (`52,428,800` bytes)), `ChaCha20-Poly1305` encryption (`nonce` 12 bytes, `ciphertext IS NOT NULL`, `Ed25519` `signature` 64 bytes), encrypted blob upload to `chat-media` (`<conversation_id>/<message_id>.enc`), in-memory decryption into `privatetalk-media://`, `message_reads` seen receipt upserts (`seen_at` `NOT NULL DEFAULT now()`), and ephemeral typing broadcast (`expires_at: Instant` auto-cleared after 3.5s) in `src-tauri/src/commands/messages.rs`
- [X] T022 [P] [US2] Wire exact case-insensitive username search bar, mutual contact list with 8px emerald online presence dots (`#10B981`), conversation list with decrypted snippets and live `"typing..."` micro-labels, and active conversation header with E2EE lock badge in `src/components/layout/Sidebar.tsx` and `src/components/chat/ChatHeader.tsx`
- [X] T023 [P] [US2] Build message timeline, message bubbles, red fail-closed security warning banner (`"Verification failed — content blocked"`), overlapping 16px seen-by avatar stack with hover timestamp tooltip (`realtime:message_seen`), and inline `privatetalk-media://` image/GIF/video viewer in `src/components/chat/MessageTimeline.tsx`, `src/components/chat/MessageBubble.tsx`, and `src/components/chat/MediaViewer.tsx`
- [X] T024 [US2] Build animated 3-dot wave typing indicator pill (`"Alice is typing..."`) and message composer with 2-second throttled `typing_set_status` broadcast and `<= 50 MB` (`52,428,800` bytes) media attachment picker validation in `src/components/chat/TypingIndicator.tsx` and `src/components/chat/MessageComposer.tsx`

**Checkpoint**: User Stories 1 and 2 are functional and independently testable (complete 1-to-1 encrypted text & media chat with presence, typing indicators, and seen receipts).

---

## Phase 5: User Story 3 - Group Chat Creation, Messaging, and Host Membership Control (Priority: P2)

**Goal**: Enable users to create group chats with contacts, exchange encrypted messages and media, rename the group, add contacts with full historical epoch key access (`1..=current_epoch`), leave the group (with earliest-joined host succession), and allow only the group host to remove members with immediate `current_epoch + 1` key rotation.

**Independent Test**: Create a group with `alice` (host) and `bob`, send encrypted messages in `epoch = 1`, add `charlie` and verify `charlie` decrypts historical `epoch = 1` messages, then have host `alice` remove `charlie` and verify `current_epoch` rotates to `2` so `charlie` cannot decrypt subsequent messages.

### Tests for User Story 3 ⚠️

- [X] T025 [P] [US3] Write automated tests verifying historical epoch key wrapping (`1..=current_epoch`) for newly added group members and forward-secret `EpochKey(current_epoch + 1)` rotation excluding removed/left members in `src-tauri/tests/group_epoch_rotation_tests.rs`

### Implementation for User Story 3

- [X] T026 [US3] Implement `conversation_create_group`, `conversation_rename_group`, `conversation_add_group_member`, `conversation_remove_group_member`, and `conversation_leave_group` Tauri commands enforcing group name constraint (`CHECK (NOT is_group OR (name IS NOT NULL AND char_length(name) BETWEEN 1 AND 80))`), creator `host_id` assignment (`NOT NULL` when `is_group = true`), contact-only member addition wrapping historical keys `1..=current_epoch` (`CHECK (epoch >= 1)`), host-only member removal, earliest-`joined_at` host succession on host leave (or cascading conversation deletion when last member leaves), and `current_epoch + 1` key rotation via `remove_or_leave_group_member` RPC in `src-tauri/src/commands/conversations.rs`
- [X] T027 [US3] Build group creation and management drawer supporting group name editing (`1..=80` chars), contact picker for adding members, member roster with online dots and Host badge, host-only member removal action, and leave group button in `src/components/modals/GroupManageDrawer.tsx` and integrate drawer trigger in `src/components/chat/ChatHeader.tsx`

**Checkpoint**: User Story 3 is functional and independently testable.

---

## Phase 6: User Story 4 - Editing and Removing Sent Messages (Priority: P2)

**Goal**: Allow senders to edit the text of their own sent messages (displaying an `"Edited"` indicator) or permanently remove their own sent text or media messages (wiping ciphertext, media storage object, and local decrypted cache while displaying `"Message removed"`).

**Independent Test**: Send a text message and a media message in a chat, edit the text message and confirm `"Edited"` appears for all participants, then remove the media message and confirm `"Message removed"` renders while `ciphertext`, `nonce`, `signature`, and `media_object_path` are `NULL` in Postgres and the encrypted blob is deleted from `chat-media`.

### Implementation for User Story 4

- [X] T028 [US4] Implement `message_edit` and `message_remove` Tauri commands enforcing sender-only ownership (`sender_id = auth.uid()`), re-encrypting and re-signing edited messages (`is_edited = true`, `edited_at = now()`, rejecting edits when `is_removed = true`), and permanently wiping removed payloads via `remove_sent_message` RPC (`is_removed = true`, `removed_at = now()`, `ciphertext = NULL`, `nonce = NULL`, `signature = NULL`, `media_object_path = NULL` satisfying `CHECK (is_removed OR octet_length(nonce) = 12)`, `CHECK (is_removed OR ciphertext IS NOT NULL)`, `CHECK (is_removed OR octet_length(signature) = 64)`), deleting the encrypted blob from `chat-media` Storage bucket, and zeroizing the local `media_cache` entry in `src-tauri/src/commands/messages.rs`
- [X] T029 [US4] Add sender-only hover action bar (`Edit`, `Remove`), inline message edit input flow, subtle `"Edited"` timestamp badge, and frosted italic `"Message removed"` placeholder pill in `src/components/chat/MessageBubble.tsx`

**Checkpoint**: User Story 4 is functional and independently testable.

---

## Phase 7: User Story 5 - Windows Notifications and Taskbar Unread Badge (Priority: P3)

**Goal**: Display native Windows desktop toast notifications for incoming messages when unfocused/minimized (with click-to-open conversation navigation) and maintain an accurate numeric unread count badge (`1`..`99+`) on the Windows taskbar icon via `ITaskbarList3::SetOverlayIcon`.

**Independent Test**: Minimize instance B (`bob`), send 3 messages from `alice`, verify 3 native Windows Toast Notifications fire and the Windows taskbar icon shows numeric badge `"3"`, then click a notification and verify the app window restores, opens the conversation, marks messages seen, and clears the taskbar badge.

### Implementation for User Story 5

- [X] T030 [P] [US5] Implement native Windows Toast Notification dispatcher when window is minimized, unfocused, or viewing a different conversation (with zero plaintext logging) and click activation handler emitting `window:navigate_conversation` in `src-tauri/src/platform/notifications.rs`
- [X] T031 [P] [US5] Implement in-memory 32x32 RGBA numeric unread badge renderer (`1`..`99+`) and Windows COM `ITaskbarList3::SetOverlayIcon` overlay updater (clearing overlay with `None` when total unread count reaches `0`) in `src-tauri/src/platform/taskbar.rs`
- [X] T032 [US5] Connect Realtime `messages` and `message_reads` handlers to trigger Windows toast notifications, recalculate total unread count across conversations for `ITaskbarList3` taskbar badge updates, and focus target conversation on `window:navigate_conversation` in `src-tauri/src/supabase/realtime.rs`, `src-tauri/src/commands/messages.rs`, and `src/App.tsx`

**Checkpoint**: All 5 user stories are complete and independently testable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final security audit and end-to-end multi-instance verification across all stories.

- [X] T033 [P] Audit all `tracing` instrumentation and error serializations across `src-tauri/src/` to ensure zero plaintext message contents, private keys, passphrases, or tokens are ever written to logs or crash output (Constitution Principle IV)
- [X] T034 Run full Rust workspace test suite (`cargo test --workspace`) and execute the 5 multi-instance verification scenarios in `specs/001-private-talk-chat/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — starts immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS** all user stories.
- **Phase 3 (US1 - Auth & Profile, P1)**: Depends on Phase 2.
- **Phase 4 (US2 - Contacts & 1-to-1 E2EE Chat, P1)**: Depends on Phase 2 and US1 authentication session state.
- **Phase 5 (US3 - Group Chat & Host Controls, P2)**: Depends on Phase 2 and reuses contact/messaging foundations from US2.
- **Phase 6 (US4 - Edit & Remove Sent Messages, P2)**: Depends on Phase 2 and message sending/rendering from US2.
- **Phase 7 (US5 - Windows Notifications & Taskbar Badge, P3)**: Depends on Phase 2 and Realtime message/read events from US2.
- **Phase 8 (Polish)**: Depends on completion of Phases 3–7.

### User Story Dependency Graph

```text
Phase 1: Setup
   │
   ▼
Phase 2: Foundational (DB Schema, Crypto, DPAPI, Media Protocol, Realtime, AppShell)
   │
   ▼
Phase 3: US1 (P1 - Auth, Split-Credential KDF, DPAPI Session, Profile & Avatar) 🎯 MVP
   │
   ▼
Phase 4: US2 (P1 - Exact Username Contacts, 1-to-1 E2EE Text/Media, Presence, Typing, Seen)
   ├───► Phase 5: US3 (P2 - Group Chat, Historical Keys, Host Removal & Key Rotation)
   ├───► Phase 6: US4 (P2 - Edit & Permanent Removal Wipe of Sent Messages)
   └───► Phase 7: US5 (P3 - Windows Toast Notifications & Taskbar Unread Badge)
            │
            ▼
       Phase 8: Polish & Quickstart Verification
```

### Parallel Opportunities

- **Setup (Phase 1)**: `T002`, `T003`, `T004` can run in parallel with `T001`.
- **Foundational (Phase 2)**: `T006`, `T007`, `T008`, `T009`, `T010`, `T012` touch isolated files and can run in parallel after `T005`.
- **User Story 1**: `T014`, `T016`, `T017` can run in parallel across Rust tests and React modals.
- **User Story 2**: `T018`, `T019`, `T022`, `T023` can run in parallel across Rust tests, contact commands, and UI components.
- **User Story 3**: `T025` (rotation tests) and `T027` (group drawer UI) can run in parallel with `T026`.
- **User Story 5**: `T030` (`notifications.rs`) and `T031` (`taskbar.rs`) can run in parallel before `T032`.
- **Cross-Story Parallelism**: Once US2 (`Phase 4`) is complete, `US3` (Phase 5), `US4` (Phase 6), and `US5` (Phase 7) can be developed concurrently by separate engineers.

---

## Parallel Examples per User Story

### User Story 1
```bash
# Run DPAPI & split-credential test authoring and UI modals in parallel:
Task T014: "Write automated tests for Argon2id+HKDF split-credential derivation and Windows DPAPI in src-tauri/tests/dpapi_roundtrip_tests.rs"
Task T016: "Build minimal login and registration screen in src/components/modals/AuthScreen.tsx"
Task T017: "Build profile settings modal in src/components/modals/ProfileModal.tsx"
```

### User Story 2
```bash
# Run crypto negative tests, contacts command, and chat UI views in parallel:
Task T018: "Write negative security tests in src-tauri/tests/crypto_negative_tests.rs"
Task T019: "Implement contact_add_by_username and contact_list commands in src-tauri/src/commands/contacts.rs"
Task T022: "Wire exact-username search bar, online dots, and chat header in src/components/layout/Sidebar.tsx and src/components/chat/ChatHeader.tsx"
Task T023: "Build message timeline, seen-by avatar stack, and media viewer in src/components/chat/MessageTimeline.tsx, src/components/chat/MessageBubble.tsx, and src/components/chat/MediaViewer.tsx"
```

### User Story 3
```bash
# Run group key rotation test suite and group drawer UI in parallel:
Task T025: "Write automated tests for historical epoch key sharing and rotation in src-tauri/tests/group_epoch_rotation_tests.rs"
Task T027: "Build group creation and management drawer in src/components/modals/GroupManageDrawer.tsx"
```

### User Story 5
```bash
# Run Windows notifications and ITaskbarList3 badge modules in parallel:
Task T030: "Implement native Windows Toast Notification dispatcher in src-tauri/src/platform/notifications.rs"
Task T031: "Implement in-memory 32x32 RGBA numeric unread badge renderer and ITaskbarList3 updater in src-tauri/src/platform/taskbar.rs"
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2 Core P1)

1. Complete **Phase 1: Setup** (`T001`–`T004`).
2. Complete **Phase 2: Foundational** (`T005`–`T013`).
3. Complete **Phase 3: User Story 1** (`T014`–`T017`) → Validate registration, login, DPAPI session persistence, and avatar/display name setup (`SC-001`).
4. Complete **Phase 4: User Story 2** (`T018`–`T024`) → Validate exact username discovery (`SC-002`), `< 1s` E2EE 1-to-1 text & media messaging (`SC-003`), online presence, typing indicators, seen receipts, and fail-closed tamper rejection (`SC-005`, `SC-006`).

### Incremental Delivery

1. **Increment 1 (P1 Identity MVP)**: Setup + Foundational + US1.
2. **Increment 2 (P1 1-to-1 E2EE Messaging MVP)**: Add US2 (Contacts, 1-to-1 Text/Media E2EE, Presence, Typing, Seen Receipts).
3. **Increment 3 (P2 Group Chat & Key Rotation)**: Add US3 (Group creation, historical epoch keys on add, host-only removal with epoch rotation).
4. **Increment 4 (P2 Message Lifecycle)**: Add US4 (Edit and permanent wipe removal of sent messages).
5. **Increment 5 (P3 Windows OS Polish)**: Add US5 (Windows Toast Notifications & `ITaskbarList3` numeric taskbar badge) + Phase 8 validation.
