-- Fix circular RLS deadlock on conversation creation and add atomic RPC

CREATE OR REPLACE FUNCTION public.can_bootstrap_conversation_member(conv_id uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE c.id = conv_id
          AND (
              c.host_id = uid
              OR (
                  NOT c.is_group
                  AND c.direct_pair_key IS NOT NULL
                  AND uid::text = ANY(string_to_array(c.direct_pair_key, ':'))
              )
          )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.conversation_members cm
        WHERE cm.conversation_id = conv_id
    );
$$;

DROP POLICY IF EXISTS conversations_select_member ON public.conversations;
CREATE POLICY conversations_select_member ON public.conversations
    FOR SELECT USING (
        public.is_conversation_member(id, auth.uid())
        OR host_id = auth.uid()
        OR (
            NOT is_group
            AND direct_pair_key IS NOT NULL
            AND auth.uid()::text = ANY(string_to_array(direct_pair_key, ':'))
        )
    );

DROP POLICY IF EXISTS conversation_members_insert_contact_or_self ON public.conversation_members;
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
            OR public.can_bootstrap_conversation_member(conversation_id, auth.uid())
        )
    );

CREATE OR REPLACE FUNCTION public.create_conversation_with_keys(
    conv_id uuid,
    p_is_group boolean,
    p_name text,
    p_direct_pair_key text,
    p_member_ids uuid[],
    p_wrapped_keys jsonb
)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_id uuid := auth.uid();
    existing_conv public.conversations%ROWTYPE;
    created_conv public.conversations%ROWTYPE;
    uid uuid;
    key_item jsonb;
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
    END IF;

    IF p_member_ids IS NULL OR NOT (caller_id = ANY(p_member_ids)) THEN
        RAISE EXCEPTION 'CALLER_MUST_BE_MEMBER' USING ERRCODE = '42501';
    END IF;

    FOREACH uid IN ARRAY p_member_ids
    LOOP
        IF uid <> caller_id AND NOT EXISTS (
            SELECT 1
            FROM public.contacts c
            WHERE c.user_id = caller_id
              AND c.contact_id = uid
        ) THEN
            RAISE EXCEPTION 'CONTACT_REQUIRED' USING ERRCODE = '42501';
        END IF;
    END LOOP;

    IF NOT p_is_group THEN
        IF array_length(p_member_ids, 1) <> 2 THEN
            RAISE EXCEPTION 'INVALID_DIRECT_MEMBERS' USING ERRCODE = 'P0001';
        END IF;
        IF p_direct_pair_key IS NOT NULL THEN
            SELECT *
            INTO existing_conv
            FROM public.conversations
            WHERE direct_pair_key = p_direct_pair_key
            LIMIT 1;
            IF FOUND THEN
                RETURN existing_conv;
            END IF;
        END IF;
    END IF;

    INSERT INTO public.conversations (
        id,
        is_group,
        name,
        direct_pair_key,
        host_id,
        current_epoch
    )
    VALUES (
        conv_id,
        p_is_group,
        CASE WHEN p_is_group THEN p_name ELSE NULL END,
        CASE WHEN p_is_group THEN NULL ELSE p_direct_pair_key END,
        CASE WHEN p_is_group THEN caller_id ELSE NULL END,
        1
    )
    RETURNING * INTO created_conv;

    INSERT INTO public.conversation_members (conversation_id, user_id, added_by)
    SELECT conv_id, m_uid, caller_id
    FROM unnest(p_member_ids) AS m_uid
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    FOR key_item IN SELECT * FROM jsonb_array_elements(p_wrapped_keys)
    LOOP
        IF NOT ((key_item->>'recipient_id')::uuid = ANY(p_member_ids)) THEN
            RAISE EXCEPTION 'RECIPIENT_NOT_MEMBER' USING ERRCODE = '42501';
        END IF;
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
            1,
            (key_item->>'recipient_id')::uuid,
            caller_id,
            decode(key_item->>'ephemeral_pub_key_b64', 'base64'),
            decode(key_item->>'nonce_b64', 'base64'),
            decode(key_item->>'wrapped_key_b64', 'base64'),
            decode(key_item->>'signature_b64', 'base64')
        );
    END LOOP;

    RETURN created_conv;
END;
$$;

REVOKE ALL ON FUNCTION public.can_bootstrap_conversation_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_bootstrap_conversation_member(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_conversation_with_keys(uuid, boolean, text, text, uuid[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_conversation_with_keys(uuid, boolean, text, text, uuid[], jsonb) TO authenticated;
