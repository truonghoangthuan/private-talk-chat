# AGENTS.md

Guidance for coding agents working in `private-talk-chat`.

## Authority & Spec Hierarchy

1. **Constitution (`.specify/memory/constitution.md`, v1.0.0)**: Non-negotiable security and engineering rules. Supersedes convenience conventions.
2. **Feature Specs & Contracts (`specs/001-private-talk-chat/`, `specs/004-privacy-blur-replies-pins/`)**:
   - `spec.md`: Requirements and user acceptance scenarios
   - `data-model.md`: Cryptographic structs, key lifecycle, DPAPI schema
   - `contracts/tauri-ipc.md`: IPC commands, events, and fail-closed UI contract
   - `contracts/supabase-schema-and-realtime.md`: Tables, RLS, RPCs, Realtime channels
   - `quickstart.md`: End-to-end validation steps

Verify compliance with the Constitution before finalizing any design or code change.

## Architecture & Module Boundaries

- **WebView UI (`src/`)**: React 19, TypeScript (`strict: true`, `noUnusedLocals`, `noUnusedParameters`), Tailwind CSS v4, Radix UI, Lucide icons.
  - Pure presentation and UI state only.
  - All backend, auth, crypto, and OS calls go through `src/lib/tauri-client.ts` (`invoke` / `listen`) using DTOs in `src/lib/types.ts`.
  - **Never** import Supabase clients, store tokens/keys, or perform cryptography in `src/`.
- **Rust Core (`src-tauri/src/`)**:
  - `crypto/`: `kdf.rs` (split-credential `HKDF` + `Argon2id`), `keys.rs` (`X25519` + `Ed25519` + bundle/epoch wrapping), `aead.rs` (`ChaCha20-Poly1305` + `Ed25519` message/media envelopes, including `reply_to_message_id` inside `EncryptedMessageEnvelope`).
  - `platform/`: Windows-native `dpapi.rs` (`CryptProtectData`/`CryptUnprotectData`), `taskbar.rs` (`ITaskbarList3`), `notifications.rs`. Guard Win32 code with `#[cfg(windows)]`.
  - `state/media_cache.rs`: `DecryptedMediaCache` storing `Zeroizing<Vec<u8>>` in RAM (max 64 entries / 150 MiB).
  - `supabase/`: HTTP/WebSocket clients (`auth.rs`, `postgrest.rs`, `storage.rs`, `realtime.rs`) plus `LocalLoopbackStore` fallback when Supabase env vars are absent.
  - `commands/`: Tauri IPC handlers (`auth.rs`, `contacts.rs`, `conversations.rs`, `messages.rs` including `message_pin`, `message_unpin`, `message_list_pinned`, and reply verification/preview resolution, `mod.rs`).
  - `lib.rs`: Initializes tracing, registers `privatetalk-media://` custom URI handler, emits `window:focus_changed`, and registers all Tauri commands.
- **Database (`supabase/`)**: PostgreSQL schema, `citext`, RLS policies, `SECURITY DEFINER` RPCs (`add_mutual_contact`, `remove_or_leave_group_member`, `remove_sent_message`), `avatars` / `chat-media` storage buckets in `supabase/migrations/0001_private_talk_schema.sql`, and `public.pinned_messages` + auto-unpin in `supabase/migrations/0002_pinned_messages.sql`.

## Non-Negotiable Security Invariants

- **Zero Server Plaintext**: Never transmit raw passwords, private keys, plaintext messages, or plaintext chat media to Supabase. Keep split-credential derivation intact (`derive_supabase_auth_password` vs `derive_key_wrapping_key`).
- **No Keys Over IPC**: Private keys (`X25519`, `Ed25519`), wrapping keys, and raw epoch keys must never cross the Tauri IPC boundary to JavaScript.
- **No Unencrypted Temp Files**: Decrypted media attachments (`PNG`, `JPG`, `WEBP`, `GIF`, `MP4`, `WEBM`) must stay in `DecryptedMediaCache` and be served only via `privatetalk-media://localhost/<conversation_id>/<message_id>` with `Cache-Control: no-store`.
- **Fail Closed**: On `ChaCha20-Poly1305` AEAD or `Ed25519` signature verification failure, return `DecryptionStatus::VerificationFailed` with `text: None` and `attachment: None` (UI blocks content with a warning). Never fall back to unverified or plaintext payloads.
- **Zero-Leakage Errors & Logs**: Never log or include passwords, access/refresh tokens, private keys, or message plaintexts in `tracing` events, `AppError`, or `SupabaseError`. Wrap secrets in `Zeroizing` / `ZeroizeOnDrop`.
- **Group Key Rotation**: Adding a member shares epochs `1..=current_epoch`; removing a member (host-only) or leaving a group must increment `current_epoch` and distribute the new epoch key exclusively to remaining members.
- **Minimal Permissions & CSP**: Keep `src-tauri/capabilities/default.json` permissions and `src-tauri/tauri.conf.json` CSP tightly scoped.
- **Profile Isolation**: Preserve `PRIVATE_TALK_PROFILE` handling in `platform/dpapi.rs` (`%LOCALAPPDATA%\PrivateTalk\<profile>\session.dpapi`).
- **Authenticated Reply Binding & Cross-Conversation Fail-Closed Rejection**: `reply_to_message_id` must remain inside `EncryptedMessageEnvelope` and fail closed (`DecryptionStatus::VerificationFailed`) if self-referential or referencing a message outside the conversation.
- **Focus-Loss Privacy Shield**: Preserve full-viewport blur (`window:focus_changed`, `blur`, `visibilitychange`) across both authenticated and unauthenticated screens whenever the window is unfocused.

## Build, Check & Test Commands

Run checks relevant to your changes before claiming completion:

```powershell
# Frontend TypeScript check + Vite production build
npm run build

# Rust test suite (crypto negative tests, DPAPI roundtrip, group epoch rotation)
cargo test --manifest-path src-tauri/Cargo.toml

# Desktop dev server (note tauri.conf.json uses npm run dev / npm run build)
npm run tauri dev
```

Notes:
- `npm test` executes `vitest run`; no `*.test.*` files currently exist under `src/`, so check or add Vitest tests explicitly if introducing testable frontend logic.
- Any change to cryptography, authentication, DPAPI storage, IPC boundaries, RLS, or network transport requires negative/adversarial tests in `src-tauri/tests/` verifying fail-closed rejection (Constitution Principle V).

## Change Checklists

- **Adding/modifying a Tauri IPC command or event**:
  1. Implement/update handler in `src-tauri/src/commands/` and register it in `tauri::generate_handler!` in `src-tauri/src/lib.rs`.
  2. Update `src/lib/tauri-client.ts` and `src/lib/types.ts`.
  3. Update `specs/001-private-talk-chat/contracts/tauri-ipc.md`.
- **Changing Supabase tables, RLS, or RPCs**:
  1. Add/update SQL in `supabase/migrations/` and matching client queries in `src-tauri/src/supabase/`.
  2. Keep `LocalLoopbackStore` behavior in `src-tauri/src/supabase/` consistent so offline/test flows stay accurate.
  3. Update `specs/001-private-talk-chat/contracts/supabase-schema-and-realtime.md`.
