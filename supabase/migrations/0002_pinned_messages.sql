-- Migration 0002: Shared pinned_messages table, RLS policies, and auto-unpin on message removal

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

DROP POLICY IF EXISTS pinned_messages_select_member ON public.pinned_messages;
CREATE POLICY pinned_messages_select_member ON public.pinned_messages
    FOR SELECT
    USING (public.is_conversation_member(conversation_id, auth.uid()));

DROP POLICY IF EXISTS pinned_messages_insert_member ON public.pinned_messages;
CREATE POLICY pinned_messages_insert_member ON public.pinned_messages
    FOR INSERT
    WITH CHECK (
        pinned_by = auth.uid()
        AND public.is_conversation_member(conversation_id, auth.uid())
        AND EXISTS (
            SELECT 1
            FROM public.messages m
            WHERE m.id = pinned_messages.message_id
              AND m.conversation_id = pinned_messages.conversation_id
              AND NOT m.is_removed
        )
    );

DROP POLICY IF EXISTS pinned_messages_delete_member ON public.pinned_messages;
CREATE POLICY pinned_messages_delete_member ON public.pinned_messages
    FOR DELETE
    USING (public.is_conversation_member(conversation_id, auth.uid()));

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
