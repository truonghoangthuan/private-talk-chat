use private_talk_lib::commands::auth::{
    auth_login_core, auth_register_core, auth_restore_session_core, profile_update_core,
    LoginArgs, ProfileUpdateArgs, RegisterArgs,
};
use private_talk_lib::commands::contacts::contact_add_by_username_core;
use private_talk_lib::commands::conversations::{
    conversation_add_group_member_core, conversation_create_group_core,
    conversation_leave_group_core, conversation_remove_group_member_core,
    conversation_start_direct_core,
};
use private_talk_lib::commands::messages::{
    message_edit_core, message_list_core, message_mark_seen_core, message_remove_core,
    message_send_core,
};
use private_talk_lib::commands::{compute_total_unread, AppState};
use private_talk_lib::crypto::aead::DecryptionStatus;
use private_talk_lib::handle_media_protocol;
use private_talk_lib::supabase::SupabaseClient;
use std::fs;
use tempfile::tempdir;

#[tokio::test]
async fn group_historical_key_grant_epoch_rotation_host_succession_and_message_lifecycle() {
    let dir = tempdir().expect("temp dir");
    let shared_backend = SupabaseClient::new_local();

    let alice_state = AppState::new_for_test(dir.path().join("alice.dpapi"), shared_backend.clone());
    let bob_state = AppState::new_for_test(dir.path().join("bob.dpapi"), shared_backend.clone());
    let charlie_state =
        AppState::new_for_test(dir.path().join("charlie.dpapi"), shared_backend.clone());

    let alice = auth_register_core(
        &alice_state,
        RegisterArgs {
            username: "alice".into(),
            password: "alice-password-123".into(),
            display_name: "Alice Vance".into(),
        },
    )
    .await
    .expect("register alice");

    let bob = auth_register_core(
        &bob_state,
        RegisterArgs {
            username: "bob".into(),
            password: "bob-password-123".into(),
            display_name: "Bob Stone".into(),
        },
    )
    .await
    .expect("register bob");

    let charlie = auth_register_core(
        &charlie_state,
        RegisterArgs {
            username: "charlie".into(),
            password: "charlie-password-123".into(),
            display_name: "Charlie Wu".into(),
        },
    )
    .await
    .expect("register charlie");

    // Mutual contact addition (case-insensitive exact match)
    contact_add_by_username_core(&alice_state, "BOB")
        .await
        .expect("alice adds bob");
    contact_add_by_username_core(&alice_state, "CHARLIE")
        .await
        .expect("alice adds charlie");

    // Alice creates group in epoch 1 with Bob
    let group = conversation_create_group_core(&alice_state, "Project Vault", vec![bob.id.clone()])
        .await
        .expect("create group");
    assert_eq!(group.current_epoch, 1);
    assert_eq!(group.host_id.as_deref(), Some(alice.id.as_str()));

    // Alice sends message in epoch 1
    let msg1 = message_send_core(&alice_state, &group.id, Some("Epoch 1 secret".into()), None)
        .await
        .expect("send msg1");

    // Non-host Bob cannot remove anyone
    assert!(conversation_remove_group_member_core(&bob_state, &group.id, &alice.id)
        .await
        .is_err());

    // Add Charlie -> Charlie receives historical epoch 1 key and decrypts msg1 (FR-008)
    let updated_group =
        conversation_add_group_member_core(&alice_state, &group.id, &charlie.id)
            .await
            .expect("add charlie");
    assert_eq!(updated_group.current_epoch, 1);

    let charlie_msgs_before = message_list_core(&charlie_state, &group.id, 50, None)
        .await
        .expect("charlie reads epoch 1 history");
    assert_eq!(charlie_msgs_before.len(), 1);
    assert_eq!(
        charlie_msgs_before[0].text.as_deref(),
        Some("Epoch 1 secret")
    );
    assert_eq!(charlie_msgs_before[0].status, DecryptionStatus::Verified);

    // Verify unread count and seen receipt flow
    let charlie_unread = compute_total_unread(
        &charlie_state,
        &charlie_state.active_session().expect("session"),
    )
    .await
    .expect("unread");
    assert_eq!(charlie_unread, 1);
    message_mark_seen_core(&charlie_state, &group.id, &msg1.id)
        .await
        .expect("mark seen");
    let charlie_unread_after = compute_total_unread(
        &charlie_state,
        &charlie_state.active_session().expect("session"),
    )
    .await
    .expect("unread after");
    assert_eq!(charlie_unread_after, 0);

    // Host Alice removes Charlie -> epoch rotates to 2, Charlie excluded (FR-009, FR-015)
    let rotated =
        conversation_remove_group_member_core(&alice_state, &group.id, &charlie.id)
            .await
            .expect("host removes charlie");
    assert_eq!(rotated.current_epoch, 2);
    assert!(!rotated.members.iter().any(|m| m.user_id == charlie.id));

    // Alice sends message in epoch 2
    let msg2 = message_send_core(
        &alice_state,
        &group.id,
        Some("Epoch 2 post-removal secret".into()),
        None,
    )
    .await
    .expect("send msg2");

    // Bob receives and decrypts epoch 2 message
    let bob_msgs = message_list_core(&bob_state, &group.id, 50, None)
        .await
        .expect("bob reads epoch 2");
    assert_eq!(bob_msgs.len(), 2);
    assert_eq!(
        bob_msgs[1].text.as_deref(),
        Some("Epoch 2 post-removal secret")
    );

    // Even if Charlie inspects raw store / queries messages directly, Charlie fails closed on epoch 2
    let charlie_msgs_after = message_list_core(&charlie_state, &group.id, 50, None)
        .await
        .expect("charlie list");
    let post_removal_msg = charlie_msgs_after
        .iter()
        .find(|m| m.id == msg2.id)
        .expect("msg2 entry");
    assert_eq!(
        post_removal_msg.status,
        DecryptionStatus::VerificationFailed
    );
    assert!(post_removal_msg.text.is_none());

    // Alice edits msg1 -> Bob sees edited text; Bob cannot edit Alice's message
    assert!(message_edit_core(&bob_state, &msg1.id, "Hacked").await.is_err());
    let edited = message_edit_core(&alice_state, &msg1.id, "Epoch 1 edited")
        .await
        .expect("alice edits msg1");
    assert!(edited.is_edited);
    assert_eq!(edited.text.as_deref(), Some("Epoch 1 edited"));

    // Alice removes msg2 -> ciphertext, nonce, signature wiped in backend & cannot edit after removal
    let removed = message_remove_core(&alice_state, &msg2.id)
        .await
        .expect("alice removes msg2");
    assert!(removed.is_removed);
    assert_eq!(removed.status, DecryptionStatus::Removed);
    assert!(message_edit_core(&alice_state, &msg2.id, "After remove")
        .await
        .is_err());

    {
        let store = shared_backend.local_store.lock().expect("store lock");
        let raw_row = store
            .messages
            .iter()
            .find(|m| m.id.to_string() == msg2.id)
            .expect("raw row");
        assert!(raw_row.is_removed);
        assert!(raw_row.ciphertext.is_none());
        assert!(raw_row.nonce.is_none());
        assert!(raw_row.signature.is_none());
        assert!(raw_row.media_object_path.is_none());
    }

    // Host Alice leaves -> host transfers to earliest-joined remaining member (Bob) and epoch rotates to 3
    conversation_leave_group_core(&alice_state, &group.id)
        .await
        .expect("alice leaves");
    {
        let store = shared_backend.local_store.lock().expect("store lock");
        let conv = store
            .conversations
            .values()
            .find(|c| c.id.to_string() == group.id)
            .expect("group remains");
        assert_eq!(conv.current_epoch, 3);
        assert_eq!(conv.host_id.map(|id| id.to_string()), Some(bob.id.clone()));
    }

    // Bob re-logins fresh and still unwraps historical & epoch 3 keys
    let bob_relogin = AppState::new_for_test(dir.path().join("bob2.dpapi"), shared_backend);
    auth_login_core(
        &bob_relogin,
        LoginArgs {
            username: "bob".into(),
            password: "bob-password-123".into(),
        },
    )
    .await
    .expect("bob relogin");
    let bob_relogin_msgs = message_list_core(&bob_relogin, &group.id, 50, None)
        .await
        .expect("bob relogin reads messages");
    assert_eq!(bob_relogin_msgs[0].text.as_deref(), Some("Epoch 1 edited"));
    assert!(bob_relogin_msgs[1].is_removed);
}

#[tokio::test]
async fn direct_chat_media_encryption_size_limits_and_dpapi_restore() {
    let dir = tempdir().expect("temp dir");
    let shared_backend = SupabaseClient::new_local();
    let alice_dpapi = dir.path().join("alice_direct.dpapi");

    let alice_state = AppState::new_for_test(alice_dpapi.clone(), shared_backend.clone());
    let bob_state = AppState::new_for_test(dir.path().join("bob_direct.dpapi"), shared_backend.clone());

    let _alice = auth_register_core(
        &alice_state,
        RegisterArgs {
            username: "alice_d".into(),
            password: "alice-password-123".into(),
            display_name: "Alice Direct".into(),
        },
    )
    .await
    .expect("register alice");

    let bob = auth_register_core(
        &bob_state,
        RegisterArgs {
            username: "bob_d".into(),
            password: "bob-password-123".into(),
            display_name: "Bob Direct".into(),
        },
    )
    .await
    .expect("register bob");

    // Avatar validation (>5 MB rejected, valid PNG accepted)
    let big_avatar = dir.path().join("big_avatar.png");
    fs::write(&big_avatar, vec![0u8; 5 * 1024 * 1024 + 1]).expect("write big avatar");
    assert!(profile_update_core(
        &alice_state,
        ProfileUpdateArgs {
            display_name: None,
            avatar_file_path: Some(big_avatar.to_string_lossy().into()),
        },
    )
    .await
    .is_err());

    let ok_avatar = dir.path().join("ok_avatar.png");
    fs::write(&ok_avatar, b"\x89PNG\r\n\x1a\navatar-bytes").expect("write ok avatar");
    let updated_alice = profile_update_core(
        &alice_state,
        ProfileUpdateArgs {
            display_name: Some("Alice Renamed".into()),
            avatar_file_path: Some(ok_avatar.to_string_lossy().into()),
        },
    )
    .await
    .expect("update profile");
    assert_eq!(updated_alice.display_name, "Alice Renamed");
    assert!(updated_alice.avatar_url.is_some());

    // Self-contact addition rejected; non-contact direct chat rejected
    assert!(contact_add_by_username_core(&alice_state, "ALICE_D").await.is_err());
    assert!(conversation_start_direct_core(&alice_state, &bob.id).await.is_err());

    contact_add_by_username_core(&alice_state, "BOB_D")
        .await
        .expect("mutual contact");
    let conv1 = conversation_start_direct_core(&alice_state, &bob.id)
        .await
        .expect("start direct");
    let conv2 = conversation_start_direct_core(&alice_state, &bob.id)
        .await
        .expect("deduplicated direct");
    assert_eq!(conv1.id, conv2.id);

    // Oversized (>50 MB) media blocked before upload
    let oversized = dir.path().join("too_big.mp4");
    {
        let f = fs::File::create(&oversized).expect("create oversized");
        f.set_len(50 * 1024 * 1024 + 1).expect("set len");
    }
    assert!(message_send_core(
        &alice_state,
        &conv1.id,
        None,
        Some(oversized.to_string_lossy().into()),
    )
    .await
    .is_err());

    // Valid PNG attachment encrypted, uploaded to chat-media, decrypted by Bob into privatetalk-media://
    let media_file = dir.path().join("clip.png");
    let plain_media = b"\x89PNG\r\n\x1a\nhello-e2ee-media";
    fs::write(&media_file, plain_media).expect("write png");

    let sent = message_send_core(
        &alice_state,
        &conv1.id,
        Some("Photo attached".into()),
        Some(media_file.to_string_lossy().into()),
    )
    .await
    .expect("send media msg");
    assert!(sent.attachment.is_some());

    let bob_msgs = message_list_core(&bob_state, &conv1.id, 50, None)
        .await
        .expect("bob reads media msg");
    assert_eq!(bob_msgs.len(), 1);
    let url = &bob_msgs[0].attachment.as_ref().expect("att").media_url;
    let uri_path = url.trim_start_matches("privatetalk-media://localhost");
    let proto_resp = handle_media_protocol(&bob_state, uri_path);
    assert_eq!(proto_resp.status().as_u16(), 200);
    assert_eq!(proto_resp.body().as_slice(), plain_media);

    // Removing media message deletes storage blob & evicts in-memory cache
    let removed = message_remove_core(&alice_state, &sent.id)
        .await
        .expect("remove media msg");
    assert!(removed.is_removed);
    let bob_after_remove = message_list_core(&bob_state, &conv1.id, 50, None)
        .await
        .expect("bob after remove");
    assert!(bob_after_remove[0].is_removed);
    assert_eq!(handle_media_protocol(&bob_state, uri_path).status().as_u16(), 404);

    // Simulate app restart via Windows DPAPI restore
    let restored_state = AppState::new_for_test(alice_dpapi, shared_backend);
    let restored_user = auth_restore_session_core(&restored_state)
        .await
        .expect("restore dpapi")
        .expect("session exists");
    assert_eq!(restored_user.username, "alice_d");
    assert_eq!(restored_user.display_name, "Alice Renamed");
}
