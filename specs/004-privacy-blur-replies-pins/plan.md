# Implementation Plan: Privacy Focus Blur, Custom Application Icon, Message Replies, and Pinned Messages

**Branch**: `004-privacy-blur-replies-pins` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-privacy-blur-replies-pins/spec.md` + user requirement to plan updates for `README.md` and `AGENTS.md`.

## Summary

Deliver four security-first capabilities with the smallest complete diff (`/ponytail`), plus synchronized documentation updates (`README.md`, `AGENTS.md`, and base contracts):
1. **Automatic Privacy Blur on Focus Loss (US1)**: Listen to Tauri native `WindowEvent::Focused` (`window:focus_changed`) alongside WebView2 `window` `blur`/`focus` and `document` `visibilitychange` events in `src/App.tsx` to immediately obscure the entire viewport behind a full-window privacy blur shield whenever unfocused.
2. **Authenticated Message Replies (US2)**: Bind optional `reply_to_message_id: Option<Uuid>` inside `EncryptedMessageEnvelope` (`ChaCha20-Poly1305` + `Ed25519`), validate same-conversation membership and fail-closed cross-conversation tampering in Rust, and add composer reply banner, quoted parent preview, and click-to-scroll highlighting in the UI.
3. **Shared Pinned Messages & `Pinned` Subtab (US3)**: Add `public.pinned_messages` with conversation-member RLS (`supabase/migrations/0002_pinned_messages.sql`), automatic unpin on `remove_sent_message`, `LocalLoopbackStore` parity, Realtime `postgres_changes` sync (`realtime:pins_changed`), Tauri commands (`message_pin`, `message_unpin`, `message_list_pinned`), and a `Messages` / `Pinned` subtab switcher in `ChatHeader` with jump-to-message navigation.
4. **Custom Branded Application Icon (US4)**: Generate multi-resolution Windows `.ico` (`16x16`..`256x256`) and Tauri PNG icon assets in `src-tauri/icons/` plus `src/assets/app-icon.png` from `specs/004-privacy-blur-replies-pins/assets/app-icon-source.png`, updating in-app brand surfaces while preserving `ITaskbarList3` unread badge legibility.
5. **Documentation & Agent Guidance Updates**: Update `README.md`, `AGENTS.md`, `specs/001-private-talk-chat/contracts/tauri-ipc.md`, and `specs/001-private-talk-chat/contracts/supabase-schema-and-realtime.md` to reflect the new features, IPC commands/events, schema migration, and security invariants.

## Technical Context

**Language/Version**: Rust `1.85+` (`2021` edition, `x86_64-pc-windows-msvc`), TypeScript `5.7+` (`strict: true`), React `19`

**Primary Dependencies**: Tauri `v2`, `chacha20poly1305` `0.10`, `ed25519-dalek` `2`, `x25519-dalek` `2`, `hkdf` `0.12`, `sha2` `0.10`, `zeroize` `1`, `tokio-tungstenite` `0.24`, Tailwind CSS `v4`, `lucide-react`, `vitest`

**Storage**: Supabase PostgreSQL with RLS (`0001_private_talk_schema.sql` + `0002_pinned_messages.sql`), Supabase Storage (`avatars`, `chat-media`), Windows DPAPI (`%LOCALAPPDATA%\PrivateTalk\<profile>\session.dpapi`), in-memory `LocalLoopbackStore` & `DecryptedMediaCache`

**Testing**: `cargo test --manifest-path src-tauri/Cargo.toml` (Rust unit + negative/adversarial integration tests in `src-tauri/tests/`), `npm test` (`vitest run`), `npm run build` (`tsc --noEmit && vite build`)

**Target Platform**: Windows 10 (1809+) and Windows 11 (64-bit) desktop (`WebView2`)

**Project Type**: Tauri v2 desktop application (React/TypeScript frontend + Rust core + Supabase backend)

**Performance Goals**: `<100ms` focus-loss privacy blur engagement/clearing (SC-001); `<1s` real-time pin/unpin synchronization across conversation participants (SC-003); `60 fps` timeline scrolling and highlight transitions

**Constraints**: Zero plaintext on server; zero cryptographic keys across Tauri IPC; fail-closed verification on tampered reply references or unauthorized pin actions; preserve taskbar unread overlay badge legibility across `16x16`–`256x256` icon sizes

**Scale/Scope**: 1-to-1 and group conversations; multiple pinned messages per conversation ordered by `pinned_at DESC`; backward-compatible encrypted message envelope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- **I. Security-First Architecture (PASS)**:
  - Focus-loss privacy blur defaults to active on all screens (authenticated and unauthenticated) with no insecure bypass flag.
  - Cross-conversation reply reference injection or self-referential reply cycles fail closed in Rust before reaching the UI.
  - Only active conversation members can pin, unpin, or list pinned messages, enforced by both Rust checks and PostgreSQL RLS.
- **II. Mandatory End-to-End Message Encryption (PASS)**:
  - `reply_to_message_id` is stored inside `EncryptedMessageEnvelope`, encrypted under `ChaCha20-Poly1305` and authenticated by the sender's `Ed25519` signature.
  - `public.pinned_messages` stores only UUID references (`conversation_id`, `message_id`, `pinned_by`, `pinned_at`) and zero message plaintext.
- **III. Windows-Native Data Protection & Isolation (PASS)**:
  - No decrypted message text, reply preview, or pinned message content is written to unencrypted disk files.
  - Multi-resolution Windows `.ico` and `ITaskbarList3` unread badge integration remain native Win32/Tauri boundaries.
- **IV. Zero-Leakage Observability & Fail-Closed Behavior (PASS)**:
  - Removed (`is_removed = true`) or verification-failed parent messages render a safe placeholder (`text: None, has_attachment: false`) in reply quotes and are excluded/auto-unpinned from `Pinned`.
  - No plaintext or key material is logged in `tracing` or error payloads.
- **V. Test-First Verification & Security Gates (PASS)**:
  - Includes adversarial and negative tests in `src-tauri/tests/` verifying fail-closed rejection of tampered `reply_to_message_id` ciphertext, cross-conversation reply references, pinning removed/foreign messages, non-member pin/unpin attempts, and automatic unpin upon message removal.

## Project Structure

### Documentation (this feature & repo-wide docs)

```text
specs/004-privacy-blur-replies-pins/
├── plan.md                                      # This file (/speckit-plan output)
├── research.md                                  # Phase 0 output
├── data-model.md                                # Phase 1 output
├── quickstart.md                                # Phase 1 output
├── contracts/
│   ├── tauri-ipc.md                             # Phase 1 IPC & UI contract delta
│   └── supabase-schema-and-realtime.md          # Phase 1 DB, RLS & Realtime contract delta
└── tasks.md                                     # Phase 2 output (/speckit-tasks command)

specs/001-private-talk-chat/contracts/
├── tauri-ipc.md                                 # Updated canonical IPC contract (per AGENTS.md checklist)
└── supabase-schema-and-realtime.md              # Updated canonical Supabase contract (per AGENTS.md checklist)

README.md                                        # Updated feature overview, structure & setup docs
AGENTS.md                                        # Updated architecture, security invariants & DB guidance
```

### Source Code (repository root)

```text
supabase/
└── migrations/
    ├── 0001_private_talk_schema.sql
    └── 0002_pinned_messages.sql                 # New table public.pinned_messages, RLS, updated remove_sent_message RPC

src-tauri/
├── icons/
│   ├── icon.ico                                 # Multi-resolution Windows ICO generated from app-icon-source.png
│   ├── icon.png                                 # 512x512 master PNG icon
│   ├── 32x32.png                                # 32x32 PNG icon
│   ├── 128x128.png                              # 128x128 PNG icon
│   └── 128x128@2x.png                           # 256x256 PNG icon
├── src/
│   ├── crypto/
│   │   └── aead.rs                              # Add reply_to_message_id: Option<Uuid> to EncryptedMessageEnvelope
│   ├── supabase/
│   │   ├── mod.rs                               # Add PinnedMessageRow & LocalLoopbackStore.pinned_messages
│   │   ├── postgrest.rs                         # Add pin_message, unpin_message, list_pinned_messages; update rpc_remove_sent_message
│   │   └── realtime.rs                          # Subscribe to public.pinned_messages in postgres_changes
│   ├── commands/
│   │   ├── mod.rs                               # Add MessageReplyPreviewDto, PinnedMessageDto, extend MessageDto, emit realtime:pins_changed
│   │   └── messages.rs                          # Reply validation/resolution, message_pin, message_unpin, message_list_pinned
│   └── lib.rs                                   # Register new commands & emit window:focus_changed on WindowEvent::Focused
└── tests/
    ├── crypto_negative_tests.rs                 # Extend with reply envelope tampering tests
    └── replies_and_pins_tests.rs                # Negative & E2EE tests for replies, cross-conv rejection, shared pins & auto-unpin

src/
├── assets/
│   └── app-icon.png                             # Custom branded emblem asset for in-app surfaces
├── components/
│   ├── chat/
│   │   ├── ChatHeader.tsx                       # Add Messages | Pinned (<count>) subtab bar
│   │   ├── MessageBubble.tsx                    # Quoted parent preview, Reply & Pin/Unpin actions, pinned badge, highlight state
│   │   ├── MessageComposer.tsx                  # Active reply preview banner & cancel control
│   │   ├── MessageTimeline.tsx                  # Scroll-to-message & highlight support for reply quotes and pinned jumps
│   │   └── PinnedMessagesView.tsx               # Pinned subtab list (reverse chronological), empty state, Jump & Unpin actions
│   ├── layout/
│   │   └── NavRail.tsx                          # Render custom app icon emblem
│   └── modals/
│       └── AuthScreen.tsx                       # Render custom app icon emblem
├── lib/
│   ├── tauri-client.ts                          # Update messageSend; add messagePin, messageUnpin, messageListPinned, onPinsChanged, onWindowFocusChanged
│   └── types.ts                                 # Add MessageReplyPreviewDto, PinnedMessageDto; extend MessageDto
└── App.tsx                                      # Window focus-loss privacy blur shield, reply draft state, active subtab & pinned state sync
```

**Structure Decision**: Retain the existing Tauri v2 desktop architecture (`src/` React 19 UI + `src-tauri/` Rust core + `supabase/migrations/` PostgreSQL schema). Add one focused component (`src/components/chat/PinnedMessagesView.tsx`), one additive SQL migration (`supabase/migrations/0002_pinned_messages.sql`), and one integration test suite (`src-tauri/tests/replies_and_pins_tests.rs`), while updating existing modules in place.

## Documentation Update Plan (`README.md` & `AGENTS.md`)

1. **`README.md` Updates**:
   - **Features Section**:
     - Document **Automatic Privacy Blur on Focus Loss** (instant full-viewport blur shield when the window loses OS focus).
     - Document **Authenticated Message Replies** (`reply_to_message_id` cryptographically bound inside the `ChaCha20-Poly1305` + `Ed25519` message envelope, with click-to-jump parent navigation and fail-closed removal/verification handling).
     - Document **Shared Pinned Messages & `Pinned` Subtab** (any participant in a 1-to-1 or group chat can pin/unpin messages, synchronized in real time via `public.pinned_messages` and browseable in the `Pinned` chat subtab).
     - Document **Custom Branded Application Icon** across Windows shell surfaces and in-app chrome with `ITaskbarList3` unread badge overlay support.
   - **Repository Structure & Setup Sections**:
     - List `supabase/migrations/0002_pinned_messages.sql`, `src/components/chat/PinnedMessagesView.tsx`, and `specs/004-privacy-blur-replies-pins/`.
2. **`AGENTS.md` Updates**:
   - **Authority & Spec Hierarchy**: Add `specs/004-privacy-blur-replies-pins/` alongside `specs/001-private-talk-chat/`.
   - **Architecture & Module Boundaries**:
     - Note `aead.rs` `EncryptedMessageEnvelope` includes optional `reply_to_message_id`.
     - Note `commands/messages.rs` includes `message_pin`, `message_unpin`, `message_list_pinned`, and reply verification/preview resolution.
     - Note `supabase/migrations/0002_pinned_messages.sql` (`pinned_messages` table, RLS, and auto-unpin in `remove_sent_message`).
   - **Non-Negotiable Security Invariants**:
     - Add **Authenticated Reply Binding & Cross-Conversation Fail-Closed Rejection**: `reply_to_message_id` must remain inside `EncryptedMessageEnvelope` and fail closed (`DecryptionStatus::VerificationFailed`) if referencing a message outside the conversation.
     - Add **Focus-Loss Privacy Shield**: Preserve full-viewport blur when unfocused so no sensitive content is exposed while the window is inactive.
3. **Canonical Contract Sync (`specs/001-private-talk-chat/contracts/*`)**:
   - Update `specs/001-private-talk-chat/contracts/tauri-ipc.md` and `specs/001-private-talk-chat/contracts/supabase-schema-and-realtime.md` per the `AGENTS.md` Change Checklists.

## Complexity Tracking

No Constitution violations. All additions use existing cryptographic primitives, existing Tauri IPC patterns, and existing Supabase PostgREST/Realtime infrastructure with zero new third-party runtime dependencies.
