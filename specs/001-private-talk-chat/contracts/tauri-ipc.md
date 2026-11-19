# Contract: Tauri Rust-to-UI IPC, Custom Protocol & UI/UX Specification

**Feature**: `001-private-talk-chat`  
**Date**: 2026-11-19  
**Boundary**: WebView2 TypeScript UI <-> Tauri v2 Rust Core

---

## 1. Security Invariants of the Tauri IPC Boundary

1. **No Cryptographic Keys Across IPC**: Private keys (`X25519`, `Ed25519`), `key_wrapping_key`, and raw `ConversationEpochKey` bytes NEVER cross the Tauri IPC boundary into JavaScript.
2. **Fail-Closed Decryption Contract**: If a message or attachment fails `Ed25519` signature verification or `ChaCha20-Poly1305` AEAD decryption in Rust, the Rust command/event returns `DecryptionStatus::VerificationFailed` with `content: null`. The UI MUST display a red fail-closed warning banner (`"Security Warning: Message integrity verification failed and content was blocked"`) and NEVER render partial or unverified data.
3. **In-Memory Media Streaming (`privatetalk-media://`)**: Decrypted media attachments (`PNG`, `JPG`, `WEBP`, `GIF`, `MP4`, `WEBM`) are streamed from Rust memory via `privatetalk-media://localhost/<conversation_id>/<message_id>` and never written to unencrypted disk files.

---

## 2. Tauri Commands (`invoke`)

### 2.1 Authentication & Profile Commands

| Command | Arguments | Return Type | Behavior |
|---------|-----------|-------------|----------|
| `auth_register` | `{ username: string, password: string, display_name: string }` | `Result<UserProfileDto, AppError>` | Generates `kdf_salt`, derives split credentials (`Argon2id` + `HKDF`), generates `X25519` & `Ed25519` keypairs, wraps private keys, registers user in Supabase, persists session in Windows DPAPI. |
| `auth_login` | `{ username: string, password: string }` | `Result<UserProfileDto, AppError>` | Derives split credentials, authenticates with Supabase, downloads & unwraps private keys (failing closed on tamper), caches in Windows DPAPI, connects Realtime WebSocket. |
| `auth_restore_session` | `{}` | `Result<Option<UserProfileDto>, AppError>` | Unprotects `%LOCALAPPDATA%\PrivateTalk\session.dpapi` via Windows DPAPI and restores active session. |
| `auth_logout` | `{}` | `Result<(), AppError>` | Zeroizes all in-memory keys and media cache, deletes `session.dpapi`, disconnects Realtime, clears taskbar badge. |
| `profile_update` | `{ display_name?: string, avatar_file_path?: string }` | `Result<UserProfileDto, AppError>` | Validates avatar (`<= 5 MB`, `PNG/JPG/WEBP`), uploads to `avatars` bucket, updates `profiles.display_name` & `avatar_path`. |

### 2.2 Contacts & Conversation Commands

| Command | Arguments | Return Type | Behavior |
|---------|-----------|-------------|----------|
| `contact_add_by_username` | `{ username: string }` | `Result<ContactDto, AppError>` | Exact case-insensitive search via `add_mutual_contact` RPC; establishes immediate mutual contact for both users. |
| `contact_list` | `{}` | `Result<Vec<ContactDto>, AppError>` | Returns mutual contacts enriched with live online status (`is_online`). |
| `conversation_list` | `{}` | `Result<Vec<ConversationDto>, AppError>` | Returns caller's active 1-to-1 and group conversations with member rosters, latest decrypted preview, and unread count. |
| `conversation_start_direct` | `{ contact_user_id: string }` | `Result<ConversationDto, AppError>` | Verifies user is in `contacts`; opens existing or creates new 1-to-1 conversation with `EpochKey(1)` wrapped for both users. |
| `conversation_create_group` | `{ name: string, member_user_ids: Vec<string> }` | `Result<ConversationDto, AppError>` | Verifies all members are in creator's `contacts`; assigns creator as `host_id`, generates & wraps `EpochKey(1)` for all members. |
| `conversation_rename_group` | `{ conversation_id: string, name: string }` | `Result<ConversationDto, AppError>` | Updates group name for all participants. |
| `conversation_add_group_member` | `{ conversation_id: string, contact_user_id: string }` | `Result<ConversationDto, AppError>` | Verifies contact is in caller's `contacts`; wraps all historical epoch keys (`1..=current_epoch`) for new member so they can view past and future messages. |
| `conversation_remove_group_member` | `{ conversation_id: string, target_user_id: string }` | `Result<ConversationDto, AppError>` | Host-only enforcement; removes member, increments `current_epoch`, generates fresh `EpochKey(new_epoch)` for remaining members only. |
| `conversation_leave_group` | `{ conversation_id: string }` | `Result<(), AppError>` | Removes self (transferring host to earliest-joined member if caller was host), rotates group key to `current_epoch + 1` for remaining members. |

### 2.3 Messaging, Typing, and Seen Receipt Commands

| Command | Arguments | Return Type | Behavior |
|---------|-----------|-------------|----------|
| `message_list` | `{ conversation_id: string, limit: u32, before?: string }` | `Result<Vec<MessageDto>, AppError>` | Fetches encrypted messages, verifies `Ed25519` signatures, decrypts with corresponding `EpochKey`, enriches with `seen_by: Vec<SeenReceiptDto>`. |
| `message_send` | `{ conversation_id: string, text?: string, attachment_path?: string }` | `Result<MessageDto, AppError>` | Validates attachment (`<= 50 MB`, allowed format), encrypts attachment & message envelope with `ChaCha20-Poly1305`, signs with `Ed25519`, uploads ciphertext. |
| `message_edit` | `{ message_id: string, new_text: string }` | `Result<MessageDto, AppError>` | Sender-only; re-encrypts & re-signs updated envelope, sets `is_edited = true, edited_at = now()`. |
| `message_remove` | `{ message_id: string }` | `Result<MessageDto, AppError>` | Sender-only; permanently wipes `ciphertext`, `nonce`, `signature`, deletes encrypted object from `chat-media` bucket, wipes local memory cache, sets `is_removed = true`. |
| `message_mark_seen` | `{ conversation_id: string, up_to_message_id: string }` | `Result<(), AppError>` | Upserts `message_reads` for unread messages in conversation up to `up_to_message_id`, updates Windows taskbar unread badge. |
| `typing_set_status` | `{ conversation_id: string, is_typing: bool }` | `Result<(), AppError>` | Broadcasts ephemeral `typing` event over Supabase Realtime `room:<conversation_id>`. |

### 2.4 Application Updater Commands

| Command | Arguments | Return Type | Behavior |
|---------|-----------|-------------|----------|
| `update_get_status` | `{}` | `Result<UpdateStatusDto, AppError>` | Returns current `UpdateStatusDto` snapshot including `current_version`. |
| `update_check` | `{ silent?: bool }` | `Result<UpdateStatusDto, AppError>` | Checks GitHub Releases `latest.json`, verifies `Ed25519` signature, `draft: false`, `prerelease: false`, and strict `MAJOR.MINOR.PATCH` semver; swallows network errors to `idle` when `silent` is true. |
| `update_install` | `{}` | `Result<UpdateStatusDto, AppError>` | Downloads installer into Rust RAM with progress events, verifies exact byte length, `SHA-256`, and `Ed25519` signature before writing `%LOCALAPPDATA%\PrivateTalk\updates\<installer_file_name>`, launches installer, and exits cleanly. |

---

## 3. Tauri Real-Time Events (Rust -> WebView UI)

| Event Name | Payload DTO | Trigger Condition |
|------------|-------------|-------------------|
| `realtime:presence_changed` | `{ online_user_ids: Vec<string> }` | User comes online or goes offline on `presence:global`. |
| `realtime:typing_changed` | `{ conversation_id: string, typing_users: Vec<{ user_id: string, display_name: string }> }` | Broadcast `typing` received or 3.5s expiry timer elapsed. |
| `realtime:message_upsert` | `MessageDto` | New message decrypted, message edited, or message removed (`is_removed = true`). |
| `realtime:message_seen` | `{ conversation_id: string, message_id: string, seen_by: Vec<SeenReceiptDto> }` | Another participant marks a message as seen in `message_reads`. |
| `realtime:conversation_updated` | `ConversationDto` | New chat, group rename, member added/removed/left, or host changed. |
| `realtime:contact_added` | `ContactDto` | Mutual contact added by either user. |
| `window:navigate_conversation` | `{ conversation_id: string }` | User clicked a Windows desktop toast notification. |
| `updater:state_changed` | `UpdateStatusDto` | Updater phase transitions (`checking`, `up_to_date`, `available`, `downloading`, `installing`, `verification_failed`, `error`, `idle`). |

---

## 4. UI/UX Modern, Clean, Minimal, Premium Design Contract

- **Aesthetic Principles**:
  - **Color System**: Deep obsidian dark theme default (`#0B0D12` background, `#12161F` elevated surface, `#1A202C` message bubble, `#6366F1` primary indigo accent, `#10B981` emerald online dot, `#EF4444` fail-closed security alert) with seamless light mode support.
  - **Typography**: `Inter` / `Geist` variable sans-serif for crisp legibility on Windows ClearType displays; `14px` body messages (`1.5` line height), `12px` muted metadata timestamps.
  - **Real-Time Presence & Feedback Micro-UI**:
    - **Online Status**: `8px` emerald dot (`#10B981`) with subtle glow on contact avatars and conversation headers when online; muted slate ring when offline.
    - **Typing Indicator**: Smooth 3-dot staggered wave pill (`"Alice is typing..."`) anchored above the composer and italicized in the conversation sidebar preview.
    - **Seen Receipts**: Compact overlapping `16px` avatar stack aligned under the latest message each participant has seen (`"Seen by Alice, Bob • 14:05"` tooltip on hover).
    - **Removed & Edited States**: Edited messages show a subtle `"Edited"` label beside the timestamp; removed messages display a minimal frosted pill (`"Message removed"`) with no media or original text remnants.
    - **Security Verification Banner**: Any message failing signature or AEAD verification renders a distinct red lock alert banner (`"Verification failed — content blocked"`).
