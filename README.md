# Bloop

End-to-end encrypted Windows 10/11 desktop chat application for 1-to-1 and group messaging, built with **Tauri v2 (Rust)**, **React 19 + TypeScript + Tailwind CSS v4**, and **Supabase** (Auth, PostgreSQL with RLS, Realtime, and Storage).

## Features

- **Username/Password Accounts & Profile Setup**: Register and log in with username + password, update display name, and upload avatars (`PNG`, `JPG`, `WEBP` up to 5 MB).
- **Split-Credential Auth & E2EE**:
  - `HKDF-SHA256` pre-login auth password derivation so Supabase Auth never receives the user's raw password.
  - `Argon2id` (64 MiB, 3 iterations, 4 lanes) + `HKDF-SHA256` local key-wrapping key for encrypted private key backups (`wrapped_priv_keys`).
  - `X25519` ECDH epoch key wrapping, `ChaCha20-Poly1305` authenticated encryption for messages and media, and `Ed25519` sender signatures.
- **Mutual Contacts & Real-Time Chat**: Exact case-insensitive username discovery (`add_mutual_contact`), live online presence, typing indicators, and per-message seen receipts over Supabase Realtime WebSockets.
- **Encrypted Rich Media**: Send `PNG`, `JPG`/`JPEG`, `WEBP`, `GIF`, `MP4`, and `WEBM` attachments up to 50 MB. Decrypted media streams strictly from zeroized Rust memory (`DecryptedMediaCache`) over the custom `privatetalk-media://` protocol with `Cache-Control: no-store`.
- **Group Chats & Epoch Rotation**: Any member can rename a group or add contacts (sharing historical epoch keys so new members can decrypt prior history). Host-only member removal and member leave rotate `current_epoch` and distribute a new epoch key only to remaining members.
- **Message Edit & Permanent Removal**: Edit sent messages in real time or permanently wipe encrypted payloads and storage objects (`remove_sent_message`), leaving a `"Message removed"` placeholder.
- **Authenticated Message Replies**: Reply to any verified message with `reply_to_message_id` bound inside `EncryptedMessageEnvelope` (`ChaCha20-Poly1305` + `Ed25519`), featuring a composer reply banner, clickable quoted parent previews, jump-to-parent highlighting, and fail-closed cross-conversation/removal protection.
- **Shared Pinned Messages & `Pinned` Subtab**: Any participant in a 1-to-1 or group chat can pin or unpin multiple verified messages, synchronized in real time via `public.pinned_messages` (with auto-unpin on message removal) and browseable in the `Pinned` chat subtab.
- **Automatic Privacy Blur on Focus Loss**: Full-viewport privacy blur shield engages immediately (`<100ms`) across both authenticated and unauthenticated screens whenever the window loses OS focus.
- **Windows Integration & Custom Branding**: Custom multi-resolution Windows `.ico` and in-app emblem (`src/assets/app-icon.png`), DPAPI-protected local session cache (`%LOCALAPPDATA%\PrivateTalk\session.dpapi`), native Windows toast notifications with click-to-focus, and `ITaskbarList3` unread overlay badges.

## Repository Structure

```text
src/                              # React 19 + TypeScript WebView UI
├── assets/app-icon.png           # Custom Bloop emblem
├── components/
│   ├── chat/                     # Timeline, composer, header, PinnedMessagesView, typing, media viewer
│   ├── layout/                   # AppShell, NavRail, Sidebar
│   └── modals/                   # AuthScreen, ProfileModal, GroupManageDrawer
├── lib/
│   ├── tauri-client.ts           # Typed Tauri invoke() & listen() IPC wrapper
│   └── types.ts                  # Frontend DTOs matching Rust IPC contracts
└── styles/globals.css            # Tailwind CSS v4 theme tokens

src-tauri/                        # Rust core (crypto, Windows platform, Supabase, IPC)
├── src/
│   ├── commands/                 # Tauri IPC handlers (auth, contacts, conversations, messages)
│   ├── crypto/                   # kdf.rs, keys.rs, aead.rs (zeroized primitives)
│   ├── platform/                 # Windows DPAPI, toast notifications, ITaskbarList3 badge
│   ├── state/media_cache.rs      # In-memory Zeroizing LRU cache (64 entries / 150 MiB max)
│   ├── supabase/                 # Auth, PostgREST, Storage, Realtime WebSocket, LocalLoopbackStore
│   └── lib.rs                    # AppState, privatetalk-media:// handler, IPC registration
└── tests/                        # Crypto negative, DPAPI roundtrip, group epoch rotation tests

supabase/
├── config.toml                   # Local Supabase CLI config (API :54321, DB :54322)
└── migrations/
    ├── 0001_private_talk_schema.sql  # Tables, CITEXT, RLS policies, RPCs, storage buckets
    └── 0002_pinned_messages.sql      # Shared pinned_messages table, RLS, auto-unpin RPC

specs/001-private-talk-chat/      # Core spec, plan, data model, contracts, quickstart
specs/004-privacy-blur-replies-pins/  # Privacy blur, custom icon, replies, and pins spec
```

## Prerequisites

- **OS**: Windows 10 (1809+) or Windows 11 (64-bit) with Microsoft Edge WebView2 Runtime
- **Rust**: `1.85+` with `x86_64-pc-windows-msvc` target
- **Node.js**: `22+` with `npm` (`tauri.conf.json` runs `npm run dev` and `npm run build`)
- **Supabase**: Supabase CLI (with Docker Desktop for local development) or a hosted Supabase project

## Setup

1. **Install frontend dependencies**:
   ```powershell
   npm install
   ```

2. **Start Supabase & apply migrations** (for live backend mode):
   ```powershell
   supabase start
   supabase db reset
   ```
   Or execute [`supabase/migrations/0001_private_talk_schema.sql`](supabase/migrations/0001_private_talk_schema.sql) in your Supabase project's SQL Editor.

3. **Configure environment variables**:
   Copy `.env.example` to `.env` (or export in your shell):
   ```ini
   PRIVATE_TALK_SUPABASE_URL=http://127.0.0.1:54321
   PRIVATE_TALK_SUPABASE_ANON_KEY=your-anon-key-here
   # Optional isolated profile directory under %LOCALAPPDATA%\PrivateTalk\<profile>\session.dpapi:
   # PRIVATE_TALK_PROFILE=alice
   ```
   When `PRIVATE_TALK_SUPABASE_URL` and `PRIVATE_TALK_SUPABASE_ANON_KEY` are unset, the Rust backend runs against `LocalLoopbackStore` (an in-memory loopback store used by tests and offline local runs).

## Development, Build & Test

- **Run desktop app in dev mode**:
  ```powershell
  npm run tauri dev
  ```
- **Run two isolated Windows profiles locally**:
  ```powershell
  # Terminal 1
  $env:PRIVATE_TALK_PROFILE="alice"; npm run tauri dev

  # Terminal 2
  $env:PRIVATE_TALK_PROFILE="bob"; npm run tauri dev -- -- --no-watch
  ```
- **Typecheck & build frontend bundle**:
  ```powershell
  npm run build
  ```
- **Build production Tauri bundle**:
  ```powershell
  npm run tauri build
  ```
- **Run Rust security & integration tests**:
  ```powershell
  cargo test --manifest-path src-tauri/Cargo.toml
  ```
- **Run frontend test runner** (currently no test files exist under `src/`):
  ```powershell
  npm test
  ```

## Specifications & Governance

Project governance is defined in [`.specify/memory/constitution.md`](.specify/memory/constitution.md), and feature contracts/validation scenarios live under [`specs/001-private-talk-chat/`](specs/001-private-talk-chat/).
