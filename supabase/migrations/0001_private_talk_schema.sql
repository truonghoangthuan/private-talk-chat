-- Bloop Windows Chat Application Schema
-- Enforces E2EE ciphertext-only persistence, mutual contacts, group key epochs, and strict RLS.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Profiles (1-to-1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username citext UNIQUE NOT NULL CHECK (username ~ '^[a-zA-Z0-9_]{3,32}$'),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 64),
    avatar_path text NULL,
    public_enc_key bytea NOT NULL CHECK (octet_length(public_enc_key) = 32),
    public_sign_key bytea NOT NULL CHECK (octet_length(public_sign_key) = 32),
    wrapped_priv_keys bytea NOT NULL,
    kdf_salt bytea NOT NULL CHECK (octet_length(kdf_salt) = 16),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Mutual Contacts
CREATE TABLE IF NOT EXISTS public.contacts (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, contact_id),
    CHECK (user_id <> contact_id)
);

-- 3. Conversations (1-to-1 & Group)
CREATE TABLE IF NOT EXISTS public.conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    is_group boolean NOT NULL DEFAULT false,
    name text NULL CHECK (NOT is_group OR (name IS NOT NULL AND char_length(name) BETWEEN 1 AND 80)),
    direct_pair_key text UNIQUE NULL,
    host_id uuid NULL REFERENCES public.profiles(id),
    current_epoch integer NOT NULL DEFAULT 1 CHECK (current_epoch >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT is_group OR host_id IS NOT NULL)
);

-- 4. Conversation Members
CREATE TABLE IF NOT EXISTS public.conversation_members (
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    added_by uuid NOT NULL REFERENCES public.profiles(id),
    PRIMARY KEY (conversation_id, user_id)
);

-- 5. Per-Member Wrapped Epoch Keys
CREATE TABLE IF NOT EXISTS public.conversation_member_keys (
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    epoch integer NOT NULL CHECK (epoch >= 1),
    recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    distributor_id uuid NOT NULL REFERENCES public.profiles(id),
    ephemeral_pub_key bytea NOT NULL CHECK (octet_length(ephemeral_pub_key) = 32),
    nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
    wrapped_key bytea NOT NULL CHECK (octet_length(wrapped_key) = 48),
    signature bytea NOT NULL CHECK (octet_length(signature) = 64),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, epoch, recipient_id)
);

-- 6. End-to-End Encrypted Messages
CREATE TABLE IF NOT EXISTS public.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES public.profiles(id),
    epoch integer NOT NULL CHECK (epoch >= 1),
    nonce bytea NULL CHECK (is_removed OR octet_length(nonce) = 12),
    ciphertext bytea NULL CHECK (is_removed OR ciphertext IS NOT NULL),
    signature bytea NULL CHECK (is_removed OR octet_length(signature) = 64),
    media_object_path text NULL,
    is_edited boolean NOT NULL DEFAULT false,
    edited_at timestamptz NULL,
    is_removed boolean NOT NULL DEFAULT false,
    removed_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON public.messages (conversation_id, created_at DESC);

-- 7. Per-Message Seen Receipts
CREATE TABLE IF NOT EXISTS public.message_reads (
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, message_id, user_id)
);

-- Helper Security Functions (SECURITY DEFINER)

CREATE OR REPLACE FUNCTION public.is_conversation_member(conv_id uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.conversation_members cm
        WHERE cm.conversation_id = conv_id
          AND cm.user_id = uid
    );
$$;

CREATE OR REPLACE FUNCTION public.add_mutual_contact(target_username text)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_id uuid := auth.uid();
    target_profile public.profiles%ROWTYPE;
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
    END IF;

    SELECT *
    INTO target_profile
    FROM public.profiles
    WHERE lower(username::text) = lower(trim(target_username))
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF target_profile.id = caller_id THEN
        RAISE EXCEPTION 'CANNOT_ADD_SELF' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.contacts (user_id, contact_id)
    VALUES (caller_id, target_profile.id), (target_profile.id, caller_id)
    ON CONFLICT DO NOTHING;

    RETURN target_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_or_leave_group_member(
    conv_id uuid,
    target_user_id uuid,
    new_epoch integer,
    new_wrapped_keys jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_id uuid := auth.uid();
    conv_record public.conversations%ROWTYPE;
    next_host_id uuid;
    member_count integer;
    key_item jsonb;
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
    END IF;

    SELECT *
    INTO conv_record
    FROM public.conversations
    WHERE id = conv_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CONVERSATION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF NOT conv_record.is_group THEN
        RAISE EXCEPTION 'NOT_A_GROUP_CONVERSATION' USING ERRCODE = 'P0001';
    END IF;

    IF caller_id <> target_user_id AND caller_id <> conv_record.host_id THEN
        RAISE EXCEPTION 'FORBIDDEN_HOST_ONLY' USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.conversation_members
    WHERE conversation_id = conv_id
      AND user_id = target_user_id;

    SELECT count(*)
    INTO member_count
    FROM public.conversation_members
    WHERE conversation_id = conv_id;

    IF member_count = 0 THEN
        DELETE FROM public.conversations WHERE id = conv_id;
        RETURN;
    END IF;

    IF target_user_id = conv_record.host_id THEN
        SELECT user_id
        INTO next_host_id
        FROM public.conversation_members
        WHERE conversation_id = conv_id
        ORDER BY joined_at ASC, user_id ASC
        LIMIT 1;
    ELSE
        next_host_id := conv_record.host_id;
    END IF;

    IF new_epoch <> conv_record.current_epoch + 1 THEN
        RAISE EXCEPTION 'INVALID_EPOCH_INCREMENT' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.conversations
    SET host_id = next_host_id,
        current_epoch = new_epoch,
        updated_at = now()
    WHERE id = conv_id;

    FOR key_item IN SELECT * FROM jsonb_array_elements(new_wrapped_keys)
    LOOP
        INSERT INTO public.conversation_member_keys (
            conversation_id,
            epoch,
            recipient_id,
            distributor_id,
            ephemeral_pub_key,
            nonce,
            wrapped_key,
            signature
        )
        VALUES (
            conv_id,
            new_epoch,
            (key_item->>'recipient_id')::uuid,
            caller_id,
            decode(key_item->>'ephemeral_pub_key_b64', 'base64'),
            decode(key_item->>'nonce_b64', 'base64'),
            decode(key_item->>'wrapped_key_b64', 'base64'),
            decode(key_item->>'signature_b64', 'base64')
        );
    END LOOP;
END;
$$;

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

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_member_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY profiles_select_authenticated ON public.profiles
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY profiles_insert_own ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY profiles_update_own ON public.profiles
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY contacts_select_own ON public.contacts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY conversations_select_member ON public.conversations
    FOR SELECT USING (public.is_conversation_member(id, auth.uid()));

CREATE POLICY conversations_insert_creator ON public.conversations
    FOR INSERT WITH CHECK (auth.uid() = COALESCE(host_id, auth.uid()));

CREATE POLICY conversations_update_member ON public.conversations
    FOR UPDATE USING (public.is_conversation_member(id, auth.uid()))
    WITH CHECK (public.is_conversation_member(id, auth.uid()));

CREATE POLICY conversation_members_select_member ON public.conversation_members
    FOR SELECT USING (public.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY conversation_members_insert_contact_or_self ON public.conversation_members
    FOR INSERT WITH CHECK (
        added_by = auth.uid()
        AND (
            user_id = auth.uid()
            OR EXISTS (
                SELECT 1
                FROM public.contacts c
                WHERE c.user_id = auth.uid()
                  AND c.contact_id = conversation_members.user_id
            )
        )
        AND (
            public.is_conversation_member(conversation_id, auth.uid())
            OR EXISTS (
                SELECT 1
                FROM public.conversations conv
                WHERE conv.id = conversation_members.conversation_id
                  AND (conv.host_id = auth.uid() OR NOT conv.is_group)
            )
        )
    );

CREATE POLICY conversation_member_keys_select_recipient ON public.conversation_member_keys
    FOR SELECT USING (recipient_id = auth.uid());

CREATE POLICY conversation_member_keys_insert_distributor ON public.conversation_member_keys
    FOR INSERT WITH CHECK (
        distributor_id = auth.uid()
        AND public.is_conversation_member(conversation_id, auth.uid())
    );

CREATE POLICY messages_select_member ON public.messages
    FOR SELECT USING (public.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY messages_insert_sender ON public.messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid()
        AND public.is_conversation_member(conversation_id, auth.uid())
    );

CREATE POLICY messages_update_sender ON public.messages
    FOR UPDATE USING (
        sender_id = auth.uid()
        AND public.is_conversation_member(conversation_id, auth.uid())
    )
    WITH CHECK (
        sender_id = auth.uid()
        AND public.is_conversation_member(conversation_id, auth.uid())
    );

CREATE POLICY message_reads_select_member ON public.message_reads
    FOR SELECT USING (public.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY message_reads_insert_own ON public.message_reads
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND public.is_conversation_member(conversation_id, auth.uid())
    );

CREATE POLICY message_reads_update_own ON public.message_reads
    FOR UPDATE USING (
        user_id = auth.uid()
        AND public.is_conversation_member(conversation_id, auth.uid())
    )
    WITH CHECK (
        user_id = auth.uid()
        AND public.is_conversation_member(conversation_id, auth.uid())
    );

-- Storage Buckets & Policies
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('avatars', 'avatars', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp']),
    ('chat-media', 'chat-media', false, 52428800, ARRAY['application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY avatars_select_authenticated ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY avatars_insert_own ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY avatars_update_own ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY chat_media_select_member ON storage.objects
    FOR SELECT USING (
        bucket_id = 'chat-media'
        AND public.is_conversation_member(((storage.foldername(name))[1])::uuid, auth.uid())
    );

CREATE POLICY chat_media_insert_member ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'chat-media'
        AND public.is_conversation_member(((storage.foldername(name))[1])::uuid, auth.uid())
    );

CREATE POLICY chat_media_delete_member ON storage.objects
    FOR DELETE USING (
        bucket_id = 'chat-media'
        AND public.is_conversation_member(((storage.foldername(name))[1])::uuid, auth.uid())
    );
