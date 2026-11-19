use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use ed25519_dalek::SigningKey;
use private_talk_lib::commands::AppError;
use private_talk_lib::platform::dpapi::{
    load_session_from_path, save_session_to_path, DpapiProtectedSession,
};
use private_talk_lib::updater::{
    build_signed_manifest, BoxFuture, ProgressCallback, ReleaseManifest, SemanticVersion,
    UpdateFeedTransport, UpdatePhase, UpdaterConfig, UpdaterManager,
};
use tempfile::tempdir;
use tokio::sync::Notify;
use uuid::Uuid;

struct MockTransport {
    manifest_result: Result<Vec<u8>, AppError>,
    installer_result: Result<Vec<u8>, AppError>,
    delay_notify: Option<Arc<Notify>>,
}

impl UpdateFeedTransport for MockTransport {
    fn fetch_manifest<'a>(&'a self, _url: &'a str) -> BoxFuture<'a, Result<Vec<u8>, AppError>> {
        Box::pin(async move {
            if let Some(notify) = &self.delay_notify {
                notify.notified().await;
            }
            self.manifest_result.clone()
        })
    }

    fn download_installer<'a>(
        &'a self,
        _url: &'a str,
        on_progress: ProgressCallback<'a>,
    ) -> BoxFuture<'a, Result<Vec<u8>, AppError>> {
        Box::pin(async move {
            let bytes = self.installer_result.clone()?;
            let half = bytes.len() / 2;
            on_progress(half as u64, Some(bytes.len() as u64));
            on_progress(bytes.len() as u64, Some(bytes.len() as u64));
            Ok(bytes)
        })
    }
}

fn test_keys(seed_byte: u8) -> ([u8; 32], [u8; 32]) {
    let seed = [seed_byte; 32];
    let pubkey = SigningKey::from_bytes(&seed).verifying_key().to_bytes();
    (seed, pubkey)
}

fn test_config(updates_dir: PathBuf, pubkey: [u8; 32], feed_url: &str) -> UpdaterConfig {
    UpdaterConfig {
        current_version: SemanticVersion::parse("0.1.0").unwrap(),
        feed_url: feed_url.to_string(),
        trusted_pubkey: pubkey,
        updates_dir,
        allow_loopback_http: false,
    }
}

fn sample_manifest(seed: &[u8; 32], version: &str, bytes: &[u8]) -> ReleaseManifest {
    build_signed_manifest(
        seed,
        version,
        Utc::now(),
        "Security and auto-update release",
        "https://github.com/private-talk/private-talk-chat/releases/download/v0.2.0/PrivateTalk_0.2.0_x64-setup.exe",
        "PrivateTalk_0.2.0_x64-setup.exe",
        bytes,
    )
    .expect("signed manifest")
}

#[tokio::test]
async fn t005_rejects_forged_signature_draft_prerelease_semver_url_and_tampered_installer() {
    let dir = tempdir().expect("tempdir");
    let (seed, pubkey) = test_keys(7);
    let installer = b"MZ-valid-test-nsis-installer-payload".to_vec();

    // 1. Forged Ed25519 signature fails closed with VerificationFailed
    let mut forged = sample_manifest(&seed, "0.2.0", &installer);
    forged.signature = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==".to_string();
    let mgr = UpdaterManager::new(
        test_config(dir.path().join("updates1"), pubkey, "https://github.com/test/latest.json"),
        Arc::new(MockTransport {
            manifest_result: Ok(serde_json::to_vec(&forged).unwrap()),
            installer_result: Ok(installer.clone()),
            delay_notify: None,
        }),
        Arc::new(|_| Ok(())),
    );
    let status = mgr.check_for_updates(false, |_| {}).await.expect("status");
    assert_eq!(status.phase, UpdatePhase::VerificationFailed);
    assert_eq!(status.error_code.as_deref(), Some("UPDATE_SIGNATURE_INVALID"));
    assert!(!dir.path().join("updates1").exists());

    // 2. Draft and prerelease flags fail closed
    for (draft, prerelease) in [(true, false), (false, true)] {
        let mut m = sample_manifest(&seed, "0.2.0", &installer);
        m.draft = draft;
        m.prerelease = prerelease;
        let mgr = UpdaterManager::new(
            test_config(dir.path().join("updates2"), pubkey, "https://github.com/test/latest.json"),
            Arc::new(MockTransport {
                manifest_result: Ok(serde_json::to_vec(&m).unwrap()),
                installer_result: Ok(installer.clone()),
                delay_notify: None,
            }),
            Arc::new(|_| Ok(())),
        );
        let st = mgr.check_for_updates(false, |_| {}).await.unwrap();
        assert_eq!(st.phase, UpdatePhase::VerificationFailed);
        assert_eq!(st.error_code.as_deref(), Some("UPDATE_MANIFEST_INVALID"));
    }

    // 3. Pre-release semver, leading zero semver, path traversal filename, non-HTTPS URL fail closed
    for bad_ver in ["0.2.0-rc.1", "01.2.0", "0.2.0+build1", "0.2"] {
        assert!(SemanticVersion::parse(bad_ver).is_err());
    }
    let mut bad_url = sample_manifest(&seed, "0.2.0", &installer);
    bad_url.installer_url = "http://evil.example.com/PrivateTalk.exe".to_string();
    let mgr_bad_url = UpdaterManager::new(
        test_config(dir.path().join("updates3"), pubkey, "https://github.com/test/latest.json"),
        Arc::new(MockTransport {
            manifest_result: Ok(serde_json::to_vec(&bad_url).unwrap()),
            installer_result: Ok(installer.clone()),
            delay_notify: None,
        }),
        Arc::new(|_| Ok(())),
    );
    assert_eq!(
        mgr_bad_url.check_for_updates(false, |_| {}).await.unwrap().phase,
        UpdatePhase::VerificationFailed
    );

    let mut bad_name = sample_manifest(&seed, "0.2.0", &installer);
    bad_name.installer_file_name = "../escape.exe".to_string();
    let mgr_bad_name = UpdaterManager::new(
        test_config(dir.path().join("updates4"), pubkey, "https://github.com/test/latest.json"),
        Arc::new(MockTransport {
            manifest_result: Ok(serde_json::to_vec(&bad_name).unwrap()),
            installer_result: Ok(installer.clone()),
            delay_notify: None,
        }),
        Arc::new(|_| Ok(())),
    );
    assert_eq!(
        mgr_bad_name.check_for_updates(false, |_| {}).await.unwrap().phase,
        UpdatePhase::VerificationFailed
    );

    // 4. Tampered installer bytes (SHA-256 mismatch) abort before writing to disk
    let updates_dir = dir.path().join("updates5");
    let valid_manifest = sample_manifest(&seed, "0.2.0", &installer);
    let mut tampered = installer.clone();
    tampered[0] ^= 0xFF;
    let mgr_tampered = UpdaterManager::new(
        test_config(updates_dir.clone(), pubkey, "https://github.com/test/latest.json"),
        Arc::new(MockTransport {
            manifest_result: Ok(serde_json::to_vec(&valid_manifest).unwrap()),
            installer_result: Ok(tampered),
            delay_notify: None,
        }),
        Arc::new(|_| Ok(())),
    );
    assert_eq!(
        mgr_tampered.check_for_updates(false, |_| {}).await.unwrap().phase,
        UpdatePhase::Available
    );
    let (res, launched) = mgr_tampered.install_update(|_| {}).await.unwrap();
    assert!(!launched);
    assert_eq!(res.phase, UpdatePhase::VerificationFailed);
    assert_eq!(res.error_code.as_deref(), Some("UPDATE_HASH_MISMATCH"));
    assert!(
        !updates_dir.exists() || std::fs::read_dir(&updates_dir).unwrap().count() == 0,
        "unverified installer bytes must never touch disk"
    );

    // 5. Downgrade and equal version protection -> UpToDate
    for older_or_equal in ["0.1.0", "0.0.9"] {
        let m = sample_manifest(&seed, older_or_equal, &installer);
        let mgr_old = UpdaterManager::new(
            test_config(dir.path().join("updates6"), pubkey, "https://github.com/test/latest.json"),
            Arc::new(MockTransport {
                manifest_result: Ok(serde_json::to_vec(&m).unwrap()),
                installer_result: Ok(installer.clone()),
                delay_notify: None,
            }),
            Arc::new(|_| Ok(())),
        );
        let st = mgr_old.check_for_updates(false, |_| {}).await.unwrap();
        assert_eq!(st.phase, UpdatePhase::UpToDate);
    }
}

#[tokio::test]
async fn t005_concurrent_lock_and_dpapi_session_preservation() {
    let dir = tempdir().expect("tempdir");
    let (seed, pubkey) = test_keys(11);
    let installer = b"MZ-verified-installer-0.2.0".to_vec();
    let manifest = sample_manifest(&seed, "0.2.0", &installer);

    // Concurrent check lock returns UPDATE_IN_PROGRESS
    let gate = Arc::new(Notify::new());
    let mgr_lock = Arc::new(UpdaterManager::new(
        test_config(dir.path().join("updates_lock"), pubkey, "https://github.com/test/latest.json"),
        Arc::new(MockTransport {
            manifest_result: Ok(serde_json::to_vec(&manifest).unwrap()),
            installer_result: Ok(installer.clone()),
            delay_notify: Some(gate.clone()),
        }),
        Arc::new(|_| Ok(())),
    ));

    let m1 = mgr_lock.clone();
    let first = tokio::spawn(async move { m1.check_for_updates(false, |_| {}).await });
    tokio::task::yield_now().await;
    let second = mgr_lock.check_for_updates(false, |_| {}).await;
    assert_eq!(second.unwrap_err().code, "UPDATE_IN_PROGRESS");
    gate.notify_waiters();
    assert_eq!(first.await.unwrap().unwrap().phase, UpdatePhase::Available);

    // DPAPI session preserved across check + verified staging
    let session_path = dir.path().join("alice").join("session.dpapi");
    let session = DpapiProtectedSession {
        user_id: Uuid::new_v4(),
        username: "alice".to_string(),
        display_name: "Alice".to_string(),
        avatar_path: None,
        supabase_access_token: "access-token-secret".to_string(),
        supabase_refresh_token: "refresh-token-secret".to_string(),
        x25519_private_key: [1u8; 32],
        ed25519_private_key: [2u8; 32],
        cached_epoch_keys: HashMap::new(),
    };
    save_session_to_path(&session_path, &session).expect("dpapi save");
    let before_bytes = std::fs::read(&session_path).expect("read dpapi");

    let updates_dir = dir.path().join("updates_ok");
    let launched_paths = Arc::new(Mutex::new(Vec::<PathBuf>::new()));
    let launched_clone = launched_paths.clone();
    let mgr_ok = UpdaterManager::new(
        test_config(updates_dir.clone(), pubkey, "https://github.com/test/latest.json"),
        Arc::new(MockTransport {
            manifest_result: Ok(serde_json::to_vec(&manifest).unwrap()),
            installer_result: Ok(installer.clone()),
            delay_notify: None,
        }),
        Arc::new(move |p| {
            launched_clone.lock().unwrap().push(p.to_path_buf());
            Ok(())
        }),
    );

    assert_eq!(
        mgr_ok.check_for_updates(false, |_| {}).await.unwrap().phase,
        UpdatePhase::Available
    );
    let (installed_status, launched) = mgr_ok.install_update(|_| {}).await.unwrap();
    assert!(launched);
    assert_eq!(installed_status.phase, UpdatePhase::Installing);
    assert_eq!(installed_status.progress_percent, Some(100));
    assert_eq!(
        launched_paths.lock().unwrap().as_slice(),
        &[updates_dir.join("PrivateTalk_0.2.0_x64-setup.exe")]
    );

    let after_bytes = std::fs::read(&session_path).expect("read dpapi after update");
    assert_eq!(before_bytes, after_bytes);
    let restored = load_session_from_path(&session_path)
        .expect("dpapi unprotect")
        .expect("session present");
    assert_eq!(restored.user_id, session.user_id);
    assert_eq!(restored.x25519_private_key, session.x25519_private_key);
}

#[tokio::test]
async fn t010_manifest_signing_roundtrip_and_key_mismatch_fail_closed() {
    let dir = tempdir().expect("tempdir");
    let (good_seed, good_pub) = test_keys(21);
    let (wrong_seed, _) = test_keys(99);
    let installer = b"MZ-sample-binary-for-signing".to_vec();

    let manifest = build_signed_manifest(
        &good_seed,
        "v0.2.0",
        Utc::now(),
        "Signed release",
        "https://github.com/private-talk/private-talk-chat/releases/download/v0.2.0/PrivateTalk_0.2.0_x64-setup.exe",
        "PrivateTalk_0.2.0_x64-setup.exe",
        &installer,
    )
    .expect("build signed manifest");
    assert_eq!(manifest.version, "0.2.0");

    // Signed with matching key -> Available
    let mgr_good = UpdaterManager::new(
        test_config(dir.path().join("u_good"), good_pub, "https://github.com/test/latest.json"),
        Arc::new(MockTransport {
            manifest_result: Ok(serde_json::to_vec(&manifest).unwrap()),
            installer_result: Ok(installer.clone()),
            delay_notify: None,
        }),
        Arc::new(|_| Ok(())),
    );
    assert_eq!(
        mgr_good.check_for_updates(false, |_| {}).await.unwrap().phase,
        UpdatePhase::Available
    );

    // Signed with mismatched private key -> VerificationFailed
    let bad_manifest = sample_manifest(&wrong_seed, "0.2.0", &installer);
    let mgr_wrong = UpdaterManager::new(
        test_config(dir.path().join("u_wrong"), good_pub, "https://github.com/test/latest.json"),
        Arc::new(MockTransport {
            manifest_result: Ok(serde_json::to_vec(&bad_manifest).unwrap()),
            installer_result: Ok(installer),
            delay_notify: None,
        }),
        Arc::new(|_| Ok(())),
    );
    let res = mgr_wrong.check_for_updates(false, |_| {}).await.unwrap();
    assert_eq!(res.phase, UpdatePhase::VerificationFailed);
    assert_eq!(res.error_code.as_deref(), Some("UPDATE_SIGNATURE_INVALID"));
}

#[tokio::test]
async fn t013_silent_startup_check_suppresses_network_errors_but_fails_closed_on_forgery() {
    let dir = tempdir().expect("tempdir");
    let (seed, pubkey) = test_keys(33);
    let installer = b"MZ-silent-check-installer".to_vec();

    // Network error: silent=true -> Idle, silent=false -> Error (UPDATE_NETWORK_ERROR)
    let mgr_net = UpdaterManager::new(
        test_config(dir.path().join("u_net"), pubkey, "https://github.com/test/latest.json"),
        Arc::new(MockTransport {
            manifest_result: Err(AppError::new("UPDATE_NETWORK_ERROR", "offline")),
            installer_result: Ok(installer.clone()),
            delay_notify: None,
        }),
        Arc::new(|_| Ok(())),
    );
    let silent_res = mgr_net.check_for_updates(true, |_| {}).await.unwrap();
    assert_eq!(silent_res.phase, UpdatePhase::Idle);
    assert!(silent_res.error_code.is_none());

    let manual_res = mgr_net.check_for_updates(false, |_| {}).await.unwrap();
    assert_eq!(manual_res.phase, UpdatePhase::Error);
    assert_eq!(manual_res.error_code.as_deref(), Some("UPDATE_NETWORK_ERROR"));

    // Forged manifest with silent=true STILL fails closed with VerificationFailed
    let mut forged = sample_manifest(&seed, "0.2.0", &installer);
    forged.signature = "invalid".to_string();
    let mgr_forged = UpdaterManager::new(
        test_config(dir.path().join("u_forged"), pubkey, "https://github.com/test/latest.json"),
        Arc::new(MockTransport {
            manifest_result: Ok(serde_json::to_vec(&forged).unwrap()),
            installer_result: Ok(installer),
            delay_notify: None,
        }),
        Arc::new(|_| Ok(())),
    );
    let forged_res = mgr_forged.check_for_updates(true, |_| {}).await.unwrap();
    assert_eq!(forged_res.phase, UpdatePhase::VerificationFailed);
    assert_eq!(forged_res.error_code.as_deref(), Some("UPDATE_SIGNATURE_INVALID"));
}
