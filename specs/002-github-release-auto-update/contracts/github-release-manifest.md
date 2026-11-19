# Contract: GitHub Release Manifest & CI/CD Distribution Pipeline

**Feature**: `002-github-release-auto-update`  
**Date**: 2026-11-19  
**Scope**: `.github/workflows/release.yml`, `src-tauri/src/bin/sign_release.rs`, and GitHub Releases Assets

---

## 1. GitHub Releases Asset Contract

Every stable release tag `v<MAJOR>.<MINOR>.<PATCH>` (e.g., `v0.2.0`) MUST publish the following assets to the GitHub Release page:

| Asset Name | Purpose | Consumer |
|------------|---------|----------|
| `PrivateTalk_<version>_x64-setup.exe` | Windows 10/11 64-bit NSIS installer | New users (browser download) & in-app updater |
| `PrivateTalk_<version>_x64-setup.exe.sig` | Detached base64 `Ed25519` signature string | Independent verification / auditability |
| `latest.json` | Signed JSON update manifest (`ReleaseManifest`) | Existing clients querying `/releases/latest/download/latest.json` |

---

## 2. `latest.json` Manifest Schema

```json
{
  "version": "0.2.0",
  "published_at": "2026-11-19T12:00:00Z",
  "notes": "Add in-app GitHub Release auto-update with Ed25519 signature verification.",
  "draft": false,
  "prerelease": false,
  "installer_url": "https://github.com/<owner>/<repo>/releases/download/v0.2.0/PrivateTalk_0.2.0_x64-setup.exe",
  "installer_file_name": "PrivateTalk_0.2.0_x64-setup.exe",
  "installer_size_bytes": 14680064,
  "installer_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "signature": "<base64-encoded-64-byte-ed25519-signature>"
}
```

### Canonical Signature Construction

The `Ed25519` signature in `latest.json` and `.sig` is computed over the exact UTF-8 byte sequence:

```text
privatetalk-update-v1\n{version}\n{installer_sha256}\n{installer_size_bytes}
```

Where:
- `{version}` is strictly `MAJOR.MINOR.PATCH` (no `v` prefix).
- `{installer_sha256}` is the 64-character lowercase hexadecimal SHA-256 digest of the exact installer `.exe` file bytes.
- `{installer_size_bytes}` is the exact byte length of the installer `.exe` file in base-10.

---

## 3. GitHub Actions Workflow Contract (`.github/workflows/release.yml`)

### 3.1 Triggers

- `push.tags: ['v[0-9]+.[0-9]+.[0-9]+']` (matches strict stable tags such as `v0.2.0`, excludes `-alpha`/`-rc` prerelease tags).
- `workflow_dispatch` with required `tag` string input (validated against `^v[0-9]+\.[0-9]+\.[0-9]+$`).

### 3.2 Runner & Secrets

- **Runner**: `windows-latest` (`x86_64-pc-windows-msvc`).
- **Required Repository Secret**: `PRIVATE_TALK_UPDATER_SIGNING_KEY` (32-byte `Ed25519` private seed encoded as 64-char hex or base64).
- **Optional Repository Variable/Secret**: `PRIVATE_TALK_UPDATER_PUBKEY` (32-byte `Ed25519` public key compiled into client binary; verified to match `PRIVATE_TALK_UPDATER_SIGNING_KEY` during CI before publishing).
- **Automatic Token**: `GITHUB_TOKEN` with `contents: write` permission for publishing GitHub Release assets.

### 3.3 Fail-Closed Pre-Publish Gates (Constitution Principle V)

The workflow MUST abort before creating or publishing a GitHub Release if any of the following fail:
1. Tag string is not valid `vMAJOR.MINOR.PATCH` or does not match `version` in `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `package.json`.
2. `PRIVATE_TALK_UPDATER_SIGNING_KEY` is missing, malformed, or does not derive the embedded `PRIVATE_TALK_UPDATER_PUBKEY`.
3. `npm run build` fails TypeScript compilation or Vite bundling.
4. `cargo test --manifest-path src-tauri/Cargo.toml` fails any cryptographic, DPAPI, epoch rotation, or updater negative test.
5. `npx tauri build --bundles nsis` fails to produce the Windows installer executable.
6. `sign_release` fails to generate and self-verify `latest.json` and `.sig`.

### 3.4 Publication

- Publishes a **non-draft, non-prerelease** GitHub Release (`draft: false`, `prerelease: false`) tagged `v<version>` with auto-generated/curated release notes and all 3 assets (`PrivateTalk_<version>_x64-setup.exe`, `PrivateTalk_<version>_x64-setup.exe.sig`, and `latest.json`).
