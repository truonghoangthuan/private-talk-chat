# Contract: Supabase Schema, RLS & Realtime Protocol Delta

**Feature**: `004-privacy-blur-replies-pins`  
**Date**: 2026-11-20  
**Migration**: `supabase/migrations/0002_pinned_messages.sql`

---

## 1. PostgreSQL Schema & Row-Level Security (RLS) Delta

### 1.1 Table `public.pinned_messages`

```sql
CREATE TABLE IF NOT EXISTS public.pinned_messages (
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    pinned_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    pinned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_pinned_messages_conv_pinned_at
    ON public.pinned_messages (conversation_id, pinned_at DESC);

ALTER TABLE public.pinned_messages ENABLE ROW LEVEL SECURITY;
```

### 1.2 RLS Policies on `public.pinned_messages`

| Policy Name | Operation | Expression |
|-------------|-----------|------------|
| `pinned_messages_select_member` | `SELECT` | `public.is_conversation_member(conversation_id, auth.uid())` |
| `pinned_messages_insert_member` | `INSERT` | `pinned_by = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid()) AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = pinned_messages.message_id AND m.conversation_id = pinned_messages.conversation_id AND NOT m.is_removed)` |
| `pinned_messages_delete_member` | `DELETE` | `public.is_conversation_member(conversation_id, auth.uid())` |

### 1.3 Updated RPC `public.remove_sent_message(msg_id uuid)`

Extends `public.remove_sent_message` so removing a message automatically deletes any pin entry for that message (`FR-013`):

```sql
CREATE OR REPLACE FUNCTION public.remove_sent_message(msg_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_id uuid := auth.uid();
    old_media_path text;
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
    END IF;

    SELECT media_object_path
    INTO old_media_path
    FROM public.messages
    WHERE id = msg_id
      AND sender_id = caller_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FORBIDDEN_OR_NOT_FOUND' USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.pinned_messages
    WHERE message_id = msg_id;

    UPDATE public.messages
    SET ciphertext = NULL,
        nonce = NULL,
        signature = NULL,
        media_object_path = NULL,
        is_removed = true,
        removed_at = now()
    WHERE id = msg_id
      AND sender_id = caller_id;

    RETURN old_media_path;
END;
$$;
```

---

## 2. Supabase Realtime Subscription Delta

In `src-tauri/src/supabase/realtime.rs` and `src-tauri/src/commands/mod.rs`:
- Add `{ "event": "*", "schema": "public", "table": "pinned_messages" }` to the `realtime:public` `postgres_changes` subscription array.
- On `INSERT` or `DELETE` events for `table == "pinned_messages"`, extract `conversation_id` from `record.conversation_id` or `old_record.conversation_id` and emit `realtime:pins_changed` (`{ "conversation_id": cid.to_string() }`) to the Tauri WebView.

---

## 3. `LocalLoopbackStore` Parity (`src-tauri/src/supabase/`)

To keep offline local runs and automated tests in `src-tauri/tests/` consistent with live Supabase:
- Add `pub pinned_messages: Vec<PinnedMessageRow>` to `LocalLoopbackStore`.
- Enforce membership checks (`is_conversation_member`), same-conversation message check, and `!msg.is_removed` in `pin_message`, `unpin_message`, and `list_pinned_messages`.
- Remove matching entries from `store.pinned_messages` inside `rpc_remove_sent_message` and when a group conversation is deleted on last member leave.
