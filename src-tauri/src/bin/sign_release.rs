use std::path::PathBuf;

use chrono::Utc;
use ed25519_dalek::SigningKey;
use private_talk_lib::updater::{
    build_signed_manifest, decode_key_32, verify_installer_bytes, SemanticVersion,
};
use rand_core::{OsRng, RngCore};
use zeroize::Zeroizing;

fn main() {
    if let Err(err) = run() {
        eprintln!("sign_release error: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--keygen") {
        let mut seed = Zeroizing::new([0u8; 32]);
        OsRng.fill_bytes(&mut *seed);
        let pubkey = SigningKey::from_bytes(&seed).verifying_key().to_bytes();
        println!("PRIVATE_TALK_UPDATER_SIGNING_KEY={}", hex::encode(&*seed));
        println!("PRIVATE_TALK_UPDATER_PUBKEY={}", hex::encode(pubkey));
        return Ok(());
    }

    if !args.iter().any(|a| a == "--sign-installer") {
        return Err(
            "Usage: sign_release --keygen | --sign-installer <path> --version <semver> --url <https-url> --notes <text> --out-dir <dir> [--expected-pubkey <hex-or-b64>]"
                .to_string(),
        );
    }

    let installer_path = PathBuf::from(arg_value(&args, "--sign-installer")?);
    let version_raw = arg_value(&args, "--version")?;
    let installer_url = arg_value(&args, "--url")?;
    let notes = arg_value(&args, "--notes")?;
    let out_dir = PathBuf::from(arg_value(&args, "--out-dir")?);
    let expected_pubkey_arg = opt_arg_value(&args, "--expected-pubkey");

    let signing_key_raw = Zeroizing::new(
        std::env::var("PRIVATE_TALK_UPDATER_SIGNING_KEY")
            .map_err(|_| "PRIVATE_TALK_UPDATER_SIGNING_KEY env var is missing".to_string())?,
    );
    let signing_seed = Zeroizing::new(
        decode_key_32(&signing_key_raw, "KEY_INVALID")
            .map_err(|e| format!("Invalid signing key: {}", e.message))?,
    );
    let derived_pubkey = SigningKey::from_bytes(&signing_seed).verifying_key().to_bytes();

    if let Some(expected_raw) = expected_pubkey_arg
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            std::env::var("PRIVATE_TALK_UPDATER_PUBKEY")
                .ok()
                .filter(|s| !s.trim().is_empty())
        })
    {
        let expected_pubkey = decode_key_32(&expected_raw, "PUBKEY_INVALID")
            .map_err(|e| format!("Invalid expected public key: {}", e.message))?;
        if expected_pubkey != derived_pubkey {
            return Err(
                "Signing key does not match PRIVATE_TALK_UPDATER_PUBKEY".to_string(),
            );
        }
    }

    let version = SemanticVersion::parse(&version_raw).map_err(|e| e.message)?;
    let installer_file_name = installer_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid installer file name".to_string())?
        .to_string();
    let installer_bytes =
        std::fs::read(&installer_path).map_err(|e| format!("Failed reading installer: {e}"))?;

    let manifest = build_signed_manifest(
        &signing_seed,
        &version.to_string(),
        Utc::now(),
        &notes,
        &installer_url,
        &installer_file_name,
        &installer_bytes,
    )
    .map_err(|e| e.message)?;

    let allow_loopback = installer_url.starts_with("http://127.0.0.1")
        || installer_url.starts_with("http://localhost");
    verify_installer_bytes(&manifest, &installer_bytes, &derived_pubkey, allow_loopback)
        .map_err(|e| format!("Self-verification failed: {}", e.message))?;

    std::fs::create_dir_all(&out_dir).map_err(|e| format!("Failed creating out dir: {e}"))?;
    let sig_path = out_dir.join(format!("{installer_file_name}.sig"));
    let manifest_path = out_dir.join("latest.json");

    std::fs::write(&sig_path, &manifest.signature)
        .map_err(|e| format!("Failed writing signature file: {e}"))?;
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed serializing manifest: {e}"))?;
    std::fs::write(&manifest_path, manifest_json)
        .map_err(|e| format!("Failed writing latest.json: {e}"))?;

    println!("Generated {}", sig_path.display());
    println!("Generated {}", manifest_path.display());
    Ok(())
}

fn arg_value(args: &[String], flag: &str) -> Result<String, String> {
    opt_arg_value(args, flag).ok_or_else(|| format!("Missing required argument {flag}"))
}

fn opt_arg_value(args: &[String], flag: &str) -> Option<String> {
    args.windows(2)
        .find(|w| w[0] == flag)
        .map(|w| w[1].clone())
}
