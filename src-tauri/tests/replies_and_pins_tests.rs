use private_talk_lib::commands::auth::{auth_login_core, auth_register_core, LoginArgs, RegisterArgs};
use private_talk_lib::commands::contacts::contact_add_by_username_core;
use private_talk_lib::commands::conversations::{
    conversation_create_group_core, conversation_remove_group_member_core,
    conversation_start_direct_core, ensure_epoch_key,
};
use private_talk_lib::commands::messages::{
    message_edit_core, message_list_core, message_list_pinned_core, message_pin_core,
    message_remove_core, message_send_core, message_unpin_core,
};
use private_talk_lib::commands::AppState;
use private_talk_lib::crypto::aead::{
    encrypt_and_sign_message, DecryptionStatus, EncryptedMessageEnvelope,
};
use private_talk_lib::supabase::{MessageRow, SupabaseClient};
use tempfile::tempdir;
use uuid::Uuid;

#[tokio::test]
async fn replies_roundtrip_edit_removal_and_fail_closed_tampering() {
    let dir = tempdir().expect("tempdir");
    let shared_supabase = SupabaseClient::new_local();

    let alice_state = AppState::new_for_test(dir.path().join("alice.dpapi"), shared_supabase.clone());
    let bob_state = AppState::new_for_test(dir.path().join("bob.dpapi"), shared_supabase.clone());

    let alice = auth_register_core(
        &alice_state,
        RegisterArgs {
            username: "alice_reply".into(),
            password: "alice-password-123".into(),
            display_name: "Alice".into(),
        },
    )
    .await
    .expect("register alice");

    let bob = auth_register_core(
        &bob_state,
        RegisterArgs {
            username: "bob_reply".into(),
            password: "bob-password-123".into(),
            display_name: "Bob".into(),
        },
    )
    .await
    .expect("register bob");

    // Re-login Alice to ensure fresh session
    auth_login_core(
        &alice_state,
        LoginArgs {
            username: alice.username.clone(),
            password: "alice-password-123".into(),
        },
    )
    .await
    .expect("login alice");

    contact_add_by_username_core(&alice_state, &bob.username)
        .await
        .expect("alice adds bob");

    let conv = conversation_start_direct_core(&alice_state, &bob.id)
        .await
        .expect("start direct conv");
    let other_conv = conversation_create_group_core(
        &alice_state,
        "Other Group",
        vec![bob.id.clone()],
    )
    .await
    .expect("create other conv");

    // 1. Send parent message in conv and foreign message in other_conv
    let parent = message_send_core(&alice_state, &conv.id, Some("Parent message".into()), None, None)
        .await
        .expect("send parent");
    let foreign = message_send_core(
        &alice_state,
        &other_conv.id,
        Some("Foreign message".into()),
        None,
        None,
    )
    .await
    .expect("send foreign");

    // 2. Bob sends a valid reply to parent
    let reply = message_send_core(
        &bob_state,
        &conv.id,
        Some("Bob reply".into()),
        None,
        Some(parent.id.clone()),
    )
    .await
    .expect("send valid reply");
    let preview = reply.reply_to.as_ref().expect("reply_to populated");
    assert_eq!(preview.message_id, parent.id);
    assert_eq!(preview.status, DecryptionStatus::Verified);
    assert_eq!(preview.text.as_deref(), Some("Parent message"));
    assert_eq!(preview.sender_display_name, "Alice");

    // 3. Edit reply -> reply_to_message_id must be preserved
    let edited_reply = message_edit_core(&bob_state, &reply.id, "Bob edited reply")
        .await
        .expect("edit reply");
    assert_eq!(edited_reply.text.as_deref(), Some("Bob edited reply"));
    assert_eq!(
        edited_reply.reply_to.as_ref().map(|r| r.message_id.as_str()),
        Some(parent.id.as_str())
    );

    // 4. Fail-closed rejection when replying to a message from another conversation
    let cross_err = message_send_core(
        &bob_state,
        &conv.id,
        Some("Cross conv".into()),
        None,
        Some(foreign.id.clone()),
    )
    .await
    .expect_err("cross-conversation reply must fail");
    assert_eq!(cross_err.code, "FORBIDDEN");

    // 5. Inject forged ciphertext with cross-conversation parent_id -> decrypt fails closed
    let cid = Uuid::parse_str(&conv.id).unwrap();
    let foreign_uuid = Uuid::parse_str(&foreign.id).unwrap();
    let forged_id = Uuid::new_v4();
    let alice_sess = alice_state.active_session().unwrap();
    let epoch_key = ensure_epoch_key(&alice_state, cid, 1).await.unwrap();
    let forged_env = EncryptedMessageEnvelope {
        text: Some("Tampered cross-conv reply".into()),
        attachment: None,
        reply_to_message_id: Some(foreign_uuid),
    };
    let enc_forged = encrypt_and_sign_message(
        cid,
        forged_id,
        1,
        &epoch_key,
        &alice_sess.ed25519_private_key,
        &forged_env,
    )
    .unwrap();
    shared_supabase
        .insert_message(
            &alice_sess.supabase_access_token,
            &MessageRow {
                id: forged_id,
                conversation_id: cid,
                sender_id: alice_sess.user_id,
                epoch: 1,
                nonce: Some(enc_forged.nonce.to_vec()),
                ciphertext: Some(enc_forged.ciphertext),
                signature: Some(enc_forged.signature.to_vec()),
                media_object_path: None,
                is_edited: false,
                edited_at: None,
                is_removed: false,
                removed_at: None,
                created_at: chrono::Utc::now(),
            },
        )
        .await
        .unwrap();

    // Also inject self-referential reply (parent_id == row.id) -> decrypt fails closed
    let self_id = Uuid::new_v4();
    let self_env = EncryptedMessageEnvelope {
        text: Some("Self loop".into()),
        attachment: None,
        reply_to_message_id: Some(self_id),
    };
    let enc_self = encrypt_and_sign_message(
        cid,
        self_id,
        1,
        &epoch_key,
        &alice_sess.ed25519_private_key,
        &self_env,
    )
    .unwrap();
    shared_supabase
        .insert_message(
            &alice_sess.supabase_access_token,
            &MessageRow {
                id: self_id,
                conversation_id: cid,
                sender_id: alice_sess.user_id,
                epoch: 1,
                nonce: Some(enc_self.nonce.to_vec()),
                ciphertext: Some(enc_self.ciphertext),
                signature: Some(enc_self.signature.to_vec()),
                media_object_path: None,
                is_edited: false,
                edited_at: None,
                is_removed: false,
                removed_at: None,
                created_at: chrono::Utc::now(),
            },
        )
        .await
        .unwrap();

    let listed = message_list_core(&bob_state, &conv.id, 50, None)
        .await
        .expect("list messages");
    let forged_dto = listed.iter().find(|m| m.id == forged_id.to_string()).unwrap();
    assert_eq!(forged_dto.status, DecryptionStatus::VerificationFailed);
    assert!(forged_dto.text.is_none());
    assert!(forged_dto.attachment.is_none());
    assert!(forged_dto.reply_to.is_none());

    let self_dto = listed.iter().find(|m| m.id == self_id.to_string()).unwrap();
    assert_eq!(self_dto.status, DecryptionStatus::VerificationFailed);
    assert!(self_dto.text.is_none());
    assert!(self_dto.reply_to.is_none());

    // 6. Remove parent message -> reply quote shows Removed with zero plaintext, and replying to removed fails
    message_remove_core(&alice_state, &parent.id)
        .await
        .expect("remove parent");
    let listed_after_remove = message_list_core(&bob_state, &conv.id, 50, None)
        .await
        .expect("list after remove");
    let reply_after = listed_after_remove
        .iter()
        .find(|m| m.id == reply.id)
        .unwrap();
    let removed_preview = reply_after.reply_to.as_ref().unwrap();
    assert_eq!(removed_preview.status, DecryptionStatus::Removed);
    assert!(removed_preview.text.is_none());
    assert!(!removed_preview.has_attachment);

    let reply_removed_err = message_send_core(
        &bob_state,
        &conv.id,
        Some("Reply to removed".into()),
        None,
        Some(parent.id.clone()),
    )
    .await
    .expect_err("replying to removed message must fail");
    assert_eq!(reply_removed_err.code, "MESSAGE_REMOVED");
}

#[tokio::test]
async fn pins_shared_authorization_ordering_and_auto_unpin_on_remove() {
    let dir = tempdir().expect("tempdir");
    let shared_supabase = SupabaseClient::new_local();

    let host_state = AppState::new_for_test(dir.path().join("host.dpapi"), shared_supabase.clone());
    let member_state = AppState::new_for_test(dir.path().join("member.dpapi"), shared_supabase.clone());
    let outsider_state = AppState::new_for_test(dir.path().join("outsider.dpapi"), shared_supabase.clone());

    let _host = auth_register_core(
        &host_state,
        RegisterArgs {
            username: "host_pin".into(),
            password: "host-password-123".into(),
            display_name: "Host".into(),
        },
    )
    .await
    .unwrap();
    let member = auth_register_core(
        &member_state,
        RegisterArgs {
            username: "member_pin".into(),
            password: "member-password-123".into(),
            display_name: "Member".into(),
        },
    )
    .await
    .unwrap();
    let _outsider = auth_register_core(
        &outsider_state,
        RegisterArgs {
            username: "outsider_pin".into(),
            password: "outsider-password-123".into(),
            display_name: "Outsider".into(),
        },
    )
    .await
    .unwrap();

    contact_add_by_username_core(&host_state, &member.username)
        .await
        .unwrap();

    let group = conversation_create_group_core(&host_state, "Pin Group", vec![member.id.clone()])
        .await
        .unwrap();
    let other_conv = conversation_start_direct_core(&host_state, &member.id)
        .await
        .unwrap();

    let m1 = message_send_core(&host_state, &group.id, Some("First pin".into()), None, None)
        .await
        .unwrap();
    let m2 = message_send_core(&member_state, &group.id, Some("Second pin".into()), None, None)
        .await
        .unwrap();
    let foreign_msg = message_send_core(&host_state, &other_conv.id, Some("Other chat".into()), None, None)
        .await
        .unwrap();

    // 1. Non-host member can pin m1, host can pin m2 -> list returns pinned_at DESC (m2 then m1)
    message_pin_core(&member_state, &group.id, &m1.id)
        .await
        .expect("member pins m1");
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    message_pin_core(&host_state, &group.id, &m2.id)
        .await
        .expect("host pins m2");

    let pinned_list = message_list_pinned_core(&member_state, &group.id)
        .await
        .expect("list pins");
    assert_eq!(pinned_list.len(), 2);
    assert_eq!(pinned_list[0].message_id, m2.id);
    assert_eq!(pinned_list[0].pinned_by_display_name, "Host");
    assert_eq!(pinned_list[1].message_id, m1.id);
    assert_eq!(pinned_list[1].pinned_by_display_name, "Member");

    // 2. Outsider cannot pin, unpin, or list pins
    assert_eq!(
        message_pin_core(&outsider_state, &group.id, &m1.id).await.unwrap_err().code,
        "FORBIDDEN"
    );
    assert_eq!(
        message_unpin_core(&outsider_state, &group.id, &m1.id).await.unwrap_err().code,
        "FORBIDDEN"
    );
    assert_eq!(
        message_list_pinned_core(&outsider_state, &group.id).await.unwrap_err().code,
        "FORBIDDEN"
    );

    // 3. Cannot pin a message from a different conversation
    assert_eq!(
        message_pin_core(&host_state, &group.id, &foreign_msg.id).await.unwrap_err().code,
        "FORBIDDEN"
    );

    // 4. Removing m2 automatically removes it from pinned_messages
    message_remove_core(&member_state, &m2.id)
        .await
        .expect("remove m2");
    let after_remove = message_list_pinned_core(&host_state, &group.id)
        .await
        .unwrap();
    assert_eq!(after_remove.len(), 1);
    assert_eq!(after_remove[0].message_id, m1.id);

    // 5. Cannot pin removed message
    assert_eq!(
        message_pin_core(&host_state, &group.id, &m2.id).await.unwrap_err().code,
        "MESSAGE_REMOVED"
    );

    // 6. Member can unpin m1, and removed group member is rejected
    message_unpin_core(&member_state, &group.id, &m1.id)
        .await
        .expect("member unpins m1");
    assert!(message_list_pinned_core(&host_state, &group.id).await.unwrap().is_empty());

    conversation_remove_group_member_core(&host_state, &group.id, &member.id)
        .await
        .expect("host removes member");
    assert_eq!(
        message_list_pinned_core(&member_state, &group.id).await.unwrap_err().code,
        "FORBIDDEN"
    );
}
