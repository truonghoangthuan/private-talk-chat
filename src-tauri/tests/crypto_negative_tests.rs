use base64::{engine::general_purpose::STANDARD as B64, Engine};
use private_talk_lib::commands::auth::{auth_register_core, RegisterArgs};
use private_talk_lib::commands::AppState;
use private_talk_lib::crypto::aead::{
    decrypt_media_attachment, encrypt_and_sign_message, encrypt_media_attachment,
    verify_and_decrypt_message, AttachmentMetadata, DecryptionStatus, EncryptedMessageEnvelope,
};
use private_talk_lib::crypto::keys::{generate_epoch_key, IdentityKeyPair};
use private_talk_lib::handle_media_protocol;
use private_talk_lib::platform::taskbar::{format_badge_label, render_unread_badge_bgra};
use private_talk_lib::supabase::SupabaseClient;
use tempfile::tempdir;
use uuid::Uuid;
use zeroize::Zeroizing;

#[test]
fn tampered_ciphertext_nonce_signature_and_wrong_epoch_fail_closed() {
    let sender = IdentityKeyPair::generate();
    let attacker = IdentityKeyPair::generate();
    let conv_id = Uuid::new_v4();
    let msg_id = Uuid::new_v4();
    let epoch_key = generate_epoch_key();
    let wrong_epoch_key = generate_epoch_key();

    let envelope = EncryptedMessageEnvelope {
        text: Some("Confidential roadmap update".to_string()),
        attachment: None,
    };

    let enc = encrypt_and_sign_message(
        conv_id,
        msg_id,
        1,
        &epoch_key,
        &sender.ed25519_private,
        &envelope,
    )
    .expect("encrypt message");

    // Valid decrypt works
    let ok = verify_and_decrypt_message(
        conv_id,
        msg_id,
        1,
        &epoch_key,
        &sender.ed25519_public,
        &enc.nonce,
        &enc.ciphertext,
        &enc.signature,
    )
    .expect("valid decrypt");
    assert_eq!(ok, envelope);

    // 1. Tampered ciphertext byte -> VerificationFailed
    let mut bad_ct = enc.ciphertext.clone();
    bad_ct[0] ^= 0x40;
    assert_eq!(
        verify_and_decrypt_message(
            conv_id,
            msg_id,
            1,
            &epoch_key,
            &sender.ed25519_public,
            &enc.nonce,
            &bad_ct,
            &enc.signature,
        ),
        Err(DecryptionStatus::VerificationFailed)
    );

    // 2. Tampered 12-byte nonce -> VerificationFailed
    let mut bad_nonce = enc.nonce;
    bad_nonce[5] ^= 0x01;
    assert_eq!(
        verify_and_decrypt_message(
            conv_id,
            msg_id,
            1,
            &epoch_key,
            &sender.ed25519_public,
            &bad_nonce,
            &enc.ciphertext,
            &enc.signature,
        ),
        Err(DecryptionStatus::VerificationFailed)
    );

    // 3. Forged / wrong sender Ed25519 signature -> VerificationFailed
    let mut bad_sig = enc.signature;
    bad_sig[10] ^= 0x80;
    assert_eq!(
        verify_and_decrypt_message(
            conv_id,
            msg_id,
            1,
            &epoch_key,
            &sender.ed25519_public,
            &enc.nonce,
            &enc.ciphertext,
            &bad_sig,
        ),
        Err(DecryptionStatus::VerificationFailed)
    );
    assert_eq!(
        verify_and_decrypt_message(
            conv_id,
            msg_id,
            1,
            &epoch_key,
            &attacker.ed25519_public,
            &enc.nonce,
            &enc.ciphertext,
            &enc.signature,
        ),
        Err(DecryptionStatus::VerificationFailed)
    );

    // 4. Wrong epoch key -> VerificationFailed
    assert_eq!(
        verify_and_decrypt_message(
            conv_id,
            msg_id,
            1,
            &wrong_epoch_key,
            &sender.ed25519_public,
            &enc.nonce,
            &enc.ciphertext,
            &enc.signature,
        ),
        Err(DecryptionStatus::VerificationFailed)
    );
}

#[test]
fn corrupted_media_hash_and_ciphertext_fail_closed() {
    let conv_id = Uuid::new_v4();
    let msg_id = Uuid::new_v4();
    let epoch_key = generate_epoch_key();
    let media_bytes = b"\x89PNG\r\n\x1a\nfake-image-payload";

    let enc = encrypt_media_attachment(conv_id, msg_id, 1, &epoch_key, media_bytes)
        .expect("encrypt media");

    let meta = AttachmentMetadata {
        mime_type: "image/png".to_string(),
        file_name: "photo.png".to_string(),
        size_bytes: media_bytes.len() as u64,
        media_nonce: B64.encode(enc.media_nonce),
        media_sha256: B64.encode(enc.media_sha256),
    };

    let dec = decrypt_media_attachment(conv_id, msg_id, 1, &epoch_key, &meta, &enc.ciphertext)
        .expect("decrypt media");
    assert_eq!(&*dec, media_bytes);

    // Corrupt SHA-256 metadata
    let mut bad_meta = meta.clone();
    bad_meta.media_sha256 = B64.encode([0u8; 32]);
    assert_eq!(
        decrypt_media_attachment(conv_id, msg_id, 1, &epoch_key, &bad_meta, &enc.ciphertext)
            .err(),
        Some(DecryptionStatus::VerificationFailed)
    );

    // Corrupt ciphertext
    let mut bad_ct = enc.ciphertext.clone();
    bad_ct[0] ^= 0x01;
    assert_eq!(
        decrypt_media_attachment(conv_id, msg_id, 1, &epoch_key, &meta, &bad_ct).err(),
        Some(DecryptionStatus::VerificationFailed)
    );
}

#[tokio::test]
async fn media_protocol_blocks_unauthenticated_and_evicted_requests_and_badge_renders() {
    let dir = tempdir().expect("tempdir");
    let state = AppState::new_for_test(dir.path().join("s.dpapi"), SupabaseClient::new_local());
    let cid = Uuid::new_v4();
    let mid = Uuid::new_v4();

    // Unauthenticated request rejected with 403
    state
        .media_cache
        .insert(cid, mid, "image/png".into(), Zeroizing::new(vec![1, 2, 3]));
    let unauth_resp = handle_media_protocol(&state, &format!("/{cid}/{mid}"));
    assert_eq!(unauth_resp.status().as_u16(), 403);

    // Authenticate
    auth_register_core(
        &state,
        RegisterArgs {
            username: "media_tester".into(),
            password: "strong-password-1".into(),
            display_name: "Media Tester".into(),
        },
    )
    .await
    .expect("register");

    let ok_resp = handle_media_protocol(&state, &format!("/{cid}/{mid}"));
    assert_eq!(ok_resp.status().as_u16(), 200);
    assert_eq!(ok_resp.body(), &vec![1u8, 2, 3]);

    // Remove from cache -> 404
    state.media_cache.remove(cid, mid);
    let gone_resp = handle_media_protocol(&state, &format!("/{cid}/{mid}"));
    assert_eq!(gone_resp.status().as_u16(), 404);

    // Taskbar unread badge formatting & RGBA pixel buffer assertions
    assert_eq!(format_badge_label(0), None);
    assert_eq!(format_badge_label(3), Some("3".to_string()));
    assert_eq!(format_badge_label(142), Some("99+".to_string()));
    assert!(render_unread_badge_bgra(0).is_none());
    let buf = render_unread_badge_bgra(3).expect("badge pixels");
    assert_eq!(buf.len(), 32 * 32 * 4);
}
