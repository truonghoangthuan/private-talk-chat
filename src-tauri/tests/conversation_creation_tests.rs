use private_talk_lib::commands::auth::{auth_register_core, RegisterArgs};
use private_talk_lib::commands::contacts::contact_add_by_username_core;
use private_talk_lib::commands::conversations::{
    conversation_create_group_core, conversation_start_direct_core,
};
use private_talk_lib::commands::AppState;
use private_talk_lib::supabase::SupabaseClient;
use tempfile::tempdir;

#[tokio::test]
async fn direct_and_group_conversation_creation_and_fail_closed_non_contact() {
    let dir = tempdir().expect("temp dir");
    let shared_backend = SupabaseClient::new_local();

    let alice_state = AppState::new_for_test(dir.path().join("alice.dpapi"), shared_backend.clone());
    let bob_state = AppState::new_for_test(dir.path().join("bob.dpapi"), shared_backend.clone());
    let charlie_state =
        AppState::new_for_test(dir.path().join("charlie.dpapi"), shared_backend.clone());
    let mallory_state =
        AppState::new_for_test(dir.path().join("mallory.dpapi"), shared_backend.clone());

    let _alice = auth_register_core(
        &alice_state,
        RegisterArgs {
            username: "alice".into(),
            password: "alice-password-123".into(),
            display_name: "Alice".into(),
        },
    )
    .await
    .expect("register alice");

    let bob = auth_register_core(
        &bob_state,
        RegisterArgs {
            username: "bob".into(),
            password: "bob-password-123".into(),
            display_name: "Bob".into(),
        },
    )
    .await
    .expect("register bob");

    let charlie = auth_register_core(
        &charlie_state,
        RegisterArgs {
            username: "charlie".into(),
            password: "charlie-password-123".into(),
            display_name: "Charlie".into(),
        },
    )
    .await
    .expect("register charlie");

    let mallory = auth_register_core(
        &mallory_state,
        RegisterArgs {
            username: "mallory".into(),
            password: "mallory-password-123".into(),
            display_name: "Mallory".into(),
        },
    )
    .await
    .expect("register mallory");

    // Fail closed when starting direct chat with a non-contact.
    let non_contact_direct = conversation_start_direct_core(&alice_state, &mallory.id)
        .await
        .expect_err("non-contact direct chat must fail closed");
    assert_eq!(non_contact_direct.code, "CONTACT_REQUIRED");

    // Add Bob and Charlie as mutual contacts.
    contact_add_by_username_core(&alice_state, "bob")
        .await
        .expect("add bob");
    contact_add_by_username_core(&alice_state, "charlie")
        .await
        .expect("add charlie");

    // Direct chat creation & idempotent re-open.
    let direct_1 = conversation_start_direct_core(&alice_state, &bob.id)
        .await
        .expect("start direct chat with bob");
    assert!(!direct_1.is_group);
    assert_eq!(direct_1.members.len(), 2);

    let direct_2 = conversation_start_direct_core(&alice_state, &bob.id)
        .await
        .expect("re-open direct chat with bob");
    assert_eq!(direct_1.id, direct_2.id);

    // Fail closed when creating a group including a non-contact.
    let non_contact_group = conversation_create_group_core(
        &alice_state,
        "Blocked Group",
        vec![bob.id.clone(), mallory.id.clone()],
    )
    .await
    .expect_err("group with non-contact must fail closed");
    assert_eq!(non_contact_group.code, "CONTACT_REQUIRED");

    // Valid group creation.
    let group = conversation_create_group_core(
        &alice_state,
        "Dead",
        vec![bob.id.clone(), charlie.id.clone()],
    )
    .await
    .expect("create group");
    assert!(group.is_group);
    assert_eq!(group.name.as_deref(), Some("Dead"));
    assert_eq!(group.members.len(), 3);
}
