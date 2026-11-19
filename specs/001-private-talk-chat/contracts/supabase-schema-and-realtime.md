# Contract: Supabase Schema, RLS, Storage & Realtime Protocol

**Feature**: `001-private-talk-chat`  
**Date**: 2026-11-19  

---

## 1. PostgreSQL Schema & Row-Level Security (RLS) Contract

All tables in `public` MUST have `ENABLE ROW LEVEL SECURITY` active. Plaintext messages or private keys are never accepted by the database.

### 1.1 Helper Security Functions (RPCs)

1. **`public.is_conversation_member(conv_id uuid, uid uuid) RETURNS boolean`** (`SECURITY DEFINER`):
   - Returns `true` if `(conv_id, uid)` exists in `public.conversation_members`.
2. **`public.add_mutual_contact(target_username text) RETURNS public.profiles`** (`SECURITY DEFINER`):
   - Performs exact case-insensitive lookup: `SELECT * FROM public.profiles WHERE lower(username) = lower(target_username)`.
   - Rejects if not found (`P0002: USER_NOT_FOUND`) or if `target.id = auth.uid()` (`P0001: CANNOT_ADD_SELF`).
   - Atomically inserts `(auth.uid(), target.id)` and `(target.id, auth.uid())` into `public.contacts ON CONFLICT DO NOTHING`.
   - Returns the target user's public profile.
3. **`public.remove_or_leave_group_member(conv_id uuid, target_user_id uuid, new_epoch integer, new_wrapped_keys jsonb)`** (`SECURITY DEFINER`):
   - Verifies caller `auth.uid()` is either `target_user_id` (leaving) or `conversations.host_id` (host removing another member).
   - Deletes `(conv_id, target_user_id)` from `public.conversation_members`.
   - If no rows remain in `public.conversation_members` for `conv_id`, deletes `conv_id` from `public.conversations` (`ON DELETE CASCADE`) and returns.
   - If `target_user_id = conversations.host_id`, updates `conversations.host_id` to the remaining member with minimum `joined_at`.
   - Updates `conversations.current_epoch = new_epoch` and inserts `new_wrapped_keys` into `public.conversation_member_keys` for all remaining members.
4. **`public.remove_sent_message(msg_id uuid) RETURNS text`** (`SECURITY DEFINER`):
   - Verifies `messages.sender_id = auth.uid()`.
   - Deletes any matching `public.pinned_messages` row (`DELETE FROM public.pinned_messages WHERE message_id = msg_id`).
   - Captures old `media_object_path`, sets `ciphertext = NULL, nonce = NULL, signature = NULL, media_object_path = NULL, is_removed = true, removed_at = now()`, and returns the old `media_object_path` so the caller can delete the encrypted object from the `chat-media` Storage bucket.

### 1.2 RLS Policies Summary

| Table | Operation | RLS Policy Expression |
|-------|-----------|-----------------------|
| `profiles` | `SELECT` | `auth.role() = 'authenticated'` (needed for exact username search & public keys) |
| `profiles` | `INSERT` / `UPDATE` | `auth.uid() = id` |
| `contacts` | `SELECT` | `auth.uid() = user_id` |
| `conversations` | `SELECT` | `public.is_conversation_member(id, auth.uid())` |
| `conversations` | `INSERT` | `auth.uid() = COALESCE(host_id, auth.uid())` |
| `conversations` | `UPDATE` | `public.is_conversation_member(id, auth.uid())` (group name updates) |
| `conversation_members` | `SELECT` | `public.is_conversation_member(conversation_id, auth.uid())` |
| `conversation_members` | `INSERT` | Caller is creator or already member AND target is in caller's `contacts` |
| `conversation_member_keys` | `SELECT` | `recipient_id = auth.uid()` |
| `conversation_member_keys` | `INSERT` | `distributor_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid())` |
| `messages` | `SELECT` | `public.is_conversation_member(conversation_id, auth.uid())` |
| `messages` | `INSERT` | `sender_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid())` |
| `messages` | `UPDATE` | `sender_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid())` |
| `message_reads` | `SELECT` | `public.is_conversation_member(conversation_id, auth.uid())` |
| `message_reads` | `INSERT` / `UPDATE` | `user_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid())` |
| `pinned_messages` | `SELECT` | `public.is_conversation_member(conversation_id, auth.uid())` |
| `pinned_messages` | `INSERT` | `pinned_by = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid())` and target message belongs to `conversation_id` with `NOT is_removed` |
| `pinned_messages` | `DELETE` | `public.is_conversation_member(conversation_id, auth.uid())` |

---

## 2. Supabase Storage Buckets Contract

| Bucket ID | Public | Max File Size | Allowed Content Types | Encryption Policy |
|-----------|--------|---------------|-----------------------|-------------------|
| `avatars` | `false` (Authenticated RLS) | `5 MB` | `image/png`, `image/jpeg`, `image/webp` | Authenticated upload by `<user_id>/*`; readable by authenticated users |
| `chat-media` | `false` (Conversation Member RLS) | `50 MB` | `application/octet-stream` (encrypted blob) | **Mandatory client-side `ChaCha20-Poly1305` ciphertext before upload**. Path format: `<conversation_id>/<message_id>.enc` |

---

## 3. Supabase Realtime Channels Contract

### 3.1 Global Online Presence Channel (`presence:global`)
- **Type**: Supabase Realtime Presence
- **Track Payload**:
  ```json
  {
    "user_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "status": "online",
    "online_at": "2026-11-19T07:00:00Z"
  }
  ```
- **Behavior**: Synchronizes who is currently online across all authenticated clients. Disconnect or app exit automatically triggers a `presence_diff` leave event within the WebSocket heartbeat window.

### 3.2 Conversation Typing Broadcast Channel (`room:<conversation_id>`)
- **Type**: Supabase Realtime Broadcast (`ack: false`, ephemeral)
- **Event**: `"typing"`
- **Payload**:
  ```json
  {
    "conversation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "user_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "display_name": "Alice",
    "is_typing": true
  }
  ```

### 3.3 Database Change Subscriptions (`postgres_changes`)
Subscribed by the Rust Realtime manager upon login:
1. `public.messages` (`INSERT`, `UPDATE`): Triggers immediate decryption in Rust, emits `chat:message_received`, `chat:message_updated`, or `chat:message_removed` to Tauri WebView, triggers Windows toast notification if unfocused, and refreshes Windows taskbar unread badge.
2. `public.message_reads` (`INSERT`, `UPDATE`): Updates seen-by list for the message (`chat:message_seen_updated`) and recalculates unread count for the current user.
3. `public.conversations` & `public.conversation_members` (`INSERT`, `UPDATE`, `DELETE`): Updates group name, member roster, host status, and triggers key rotation fetch.
4. `public.contacts` (`INSERT`): Adds new mutual contact in real time when another user adds the current user by username.
5. `public.pinned_messages` (`INSERT`, `DELETE`): Emits `realtime:pins_changed` and refreshes message pin state for the affected conversation.
