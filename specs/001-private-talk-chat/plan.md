# Implementation Plan: Private Talk Windows Chat Application

**Branch**: `001-private-talk-chat` | **Date**: 2026-11-19 | **Spec**: [spec.md](file:///c:/work/temp/playground/private-talk-chat/specs/001-private-talk-chat/spec.md)

**Input**: Feature specification from `/specs/001-private-talk-chat/spec.md`

## Summary

Build **Private Talk**, a native Windows 10/11 end-to-end encrypted desktop chat application using **Rust (Tauri v2)** and **Supabase** (Auth, PostgreSQL with RLS, Realtime Broadcast/Presence/Postgres-Changes, and Storage) featuring a **modern, clean, minimal, premium, and aesthetic UI/UX**. All cryptographic operations (`Argon2id` + `HKDF` split-credential key derivation, `X25519` ECDH key wrapping, `ChaCha20-Poly1305` authenticated encryption for messages and media attachments, `Ed25519` sender signatures, and group epoch key rotation), Windows DPAPI local secret protection, in-memory media streaming (`privatetalk-media://`), native Windows toast notifications, and `ITaskbarList3` numeric taskbar unread badges execute inside the compiled Rust core. Real-time message delivery, live typing indicators, online presence (`who is online`), and per-message seen receipts (`who seen message`) are synchronized over Supabase Realtime WebSockets.

## Technical Context

**Language/Version**: Rust `1.85+` (2024 edition, `x86_64-pc-windows-msvc`) + TypeScript `5.7+` (WebView2 UI layer)

**Primary Dependencies**:
- **Rust Core (`src-tauri`)**: `tauri` (v2), `tauri-plugin-notification`, `windows` (v0.58+ for Windows DPAPI `CryptProtectData`/`CryptUnprotectData` and `ITaskbarList3::SetOverlayIcon`), `chacha20poly1305`, `x25519-dalek`, `ed25519-dalek`, `argon2`, `hkdf`, `sha2`, `rand_core`, `zeroize`, `reqwest` (rustls-tls), `tokio`, `tokio-tungstenite` (Supabase Realtime Phoenix WebSocket client), `serde`, `serde_json`
- **Frontend UI (`src`)**: React 19, Tailwind CSS v4, Radix UI primitives, Lucide icons (clean minimal aesthetic icon set)
- **Backend Platform (`supabase`)**: Supabase Auth, PostgreSQL 15+ (with `citext` and Row-Level Security), Supabase Realtime (Postgres Changes, Broadcast, Presence), Supabase Storage (`avatars` and `chat-media` buckets)

**Storage**:
- **Remote**: Supabase PostgreSQL (encrypted message envelopes, wrapped keys, profiles, contacts, group rosters, seen receipts) & Supabase Storage (`avatars` up to 5 MB; `chat-media` encrypted blobs up to 50 MB)
- **Local Windows Device**: Windows DPAPI encrypted session blob (`%LOCALAPPDATA%\PrivateTalk\session.dpapi`) + zeroized in-memory LRU cache for decrypted messages and media streams

**Testing**: `cargo test --workspace` (Rust unit, cryptographic negative/tamper tests, DPAPI boundary tests, contract tests) + Vitest (UI component & state tests)

**Target Platform**: Windows 10 (1809+) and Windows 11 Desktop (64-bit)

**Project Type**: `desktop-app` (Tauri v2 Rust desktop application with Supabase backend)

**Performance Goals**:
- `< 1s` p95 real-time message delivery, decryption, and UI rendering (SC-003)
- `< 200ms` typing indicator and online presence propagation via Supabase Realtime WebSockets
- `< 1s` exact case-insensitive username search (SC-002) and Windows notification / taskbar unread badge update (SC-004)
- `60 fps` smooth minimal UI transitions and media playback

**Constraints**:
- **Zero Server Plaintext**: 0 bytes of plaintext messages, media attachments, raw passwords, or private keys transmitted to or stored in Supabase (SC-005)
- **No Unencrypted Temp Files**: Decrypted attachments (`PNG`, `JPG`, `WEBP`, `GIF`, `MP4`, `WEBM` up to 50 MB) must stream from Rust memory via custom protocol `privatetalk-media://` without touching disk
- **Fail-Closed Verification**: 100% of tampered, unauthenticated, or post-removal group payloads rejected with user-visible security warning (SC-006)

**Scale/Scope**: Desktop client supporting 1-to-1 and group chats (up to 100 members per group), 5 core user stories, 7 Supabase database tables with RLS, 2 storage buckets, and a 3-zone modern minimal desktop UI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Constitution Principle | Pre-Research Gate | Post-Design Verification |
|------------------------|-------------------|--------------------------|
| **I. Security-First Architecture** | **PASS** — Split-credential login ensures Supabase Auth never sees raw password; RLS enforces least privilege on all tables. | **PASS** — Verified in `research.md` §2 and `contracts/supabase-schema-and-realtime.md` §1. |
| **II. Mandatory End-to-End Message Encryption** | **PASS** — All messages & media encrypted client-side in Rust using `ChaCha20-Poly1305` + `X25519` + `Ed25519` before upload; group key epochs rotate on member removal/leave. | **PASS** — Verified in `data-model.md` §2.5–2.6 (`EncryptedMessageEnvelope`, `conversation_member_keys`). |
| **III. Windows-Native Data Protection & Isolation** | **PASS** — Local session & active keys encrypted via Windows DPAPI (`CryptProtectData`); decrypted media served from Rust RAM via `privatetalk-media://` custom URI protocol. | **PASS** — Verified in `research.md` §5 and `data-model.md` §4. |
| **IV. Zero-Leakage Observability & Fail-Closed Behavior** | **PASS** — Custom Rust tracing subscriber redacts all secret/payload fields; AEAD or `Ed25519` verification failure aborts rendering and displays security warning banner. | **PASS** — Verified in `contracts/tauri-ipc.md` §1.2. |
| **V. Test-First Verification & Security Gates** | **PASS** — Dedicated negative security tests for tampered ciphertexts, forged signatures, revoked group epochs, and DPAPI storage required before release. | **PASS** — Verified in `quickstart.md` §3.1. |

## Project Structure

### Documentation (this feature)

```text
specs/001-private-talk-chat/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── supabase-schema-and-realtime.md
│   └── tauri-ipc.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
supabase/
├── config.toml
└── migrations/
    └── 0001_private_talk_schema.sql    # Tables, CITEXT, RLS policies, RPCs, Storage buckets

src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── src/
│   ├── main.rs                         # Tauri entrypoint & custom privatetalk-media:// protocol
│   ├── lib.rs                          # App state initialization & command registration
│   ├── crypto/
│   │   ├── mod.rs
│   │   ├── kdf.rs                      # Argon2id + HKDF split-credential derivation
│   │   ├── keys.rs                     # X25519 + Ed25519 keypair generation, wrapping & Zeroize
│   │   └── aead.rs                     # ChaCha20-Poly1305 message & media encryption/verification
│   ├── platform/
│   │   ├── mod.rs
│   │   ├── dpapi.rs                    # Windows CryptProtectData / CryptUnprotectData wrapper
│   │   ├── taskbar.rs                  # Windows ITaskbarList3::SetOverlayIcon unread badge
│   │   └── notifications.rs            # Windows Toast Notification & click-to-focus handler
│   ├── supabase/
│   │   ├── mod.rs
│   │   ├── auth.rs                     # Supabase Auth REST client
│   │   ├── postgrest.rs                # Profiles, contacts, conversations, messages, reads RPC/REST
│   │   ├── storage.rs                  # Encrypted chat-media & avatar upload/download
│   │   └── realtime.rs                 # WebSocket manager (postgres_changes, typing broadcast, presence)
│   ├── state/
│   │   ├── mod.rs
│   │   └── media_cache.rs              # Zeroized in-memory decrypted media store for custom protocol
│   └── commands/
│       ├── mod.rs
│       ├── auth.rs
│       ├── contacts.rs
│       ├── conversations.rs
│       └── messages.rs
└── tests/
    ├── crypto_negative_tests.rs        # Tampered ciphertext, wrong epoch, bad signature fail-closed tests
    ├── dpapi_roundtrip_tests.rs        # Windows DPAPI protection tests
    └── group_epoch_rotation_tests.rs   # Historical key grant & member removal key rotation tests

src/
├── main.tsx
├── App.tsx
├── styles/
│   └── globals.css                     # Tailwind CSS v4 tokens (clean minimal obsidian/light theme)
├── lib/
│   ├── tauri-client.ts                 # Typed invoke() & listen() wrappers
│   └── types.ts                        # Shared DTO interfaces matching contracts/tauri-ipc.md
└── components/
    ├── layout/
    │   ├── AppShell.tsx                # 3-zone minimal layout (Rail, Sidebar, Stage)
    │   ├── NavRail.tsx                 # User avatar, online status dot, unread badge, settings trigger
    │   └── Sidebar.tsx                 # Exact username search, contacts with online dots, chat list
    ├── chat/
    │   ├── ChatHeader.tsx              # Title, online presence / member count, E2EE badge, group drawer
    │   ├── MessageTimeline.tsx         # Virtualized messages, seen-by avatar stacks, fail-closed alert
    │   ├── MessageBubble.tsx           # Text/media bubble, Edited tag, Message removed pill, hover actions
    │   ├── MediaViewer.tsx             # In-memory image/GIF/MP4/WEBM preview via privatetalk-media://
    │   ├── TypingIndicator.tsx         # Animated minimal typing wave pill ("Alice is typing...")
    │   └── MessageComposer.tsx         # Clean input bar, typing broadcast hook, <=50MB file picker
    └── modals/
        ├── AuthScreen.tsx              # Minimal login / registration view
        ├── ProfileModal.tsx            # Display name & <=5MB avatar uploader
        └── GroupManageDrawer.tsx       # Add contacts, rename group, leave, host member removal
```

**Structure Decision**: Tauri v2 desktop architecture (`src-tauri/` Rust security & networking core + `src/` React/Tailwind minimal UI + `supabase/migrations/` declarative schema and RLS policies). Keeps 100% of cryptography, Windows OS integrations, and Supabase traffic in Rust without an unnecessary intermediate backend server.

## Complexity Tracking

No Constitution violations. All principles satisfied with zero exemptions.
