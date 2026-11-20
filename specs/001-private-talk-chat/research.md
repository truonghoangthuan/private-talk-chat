# Phase 0 Research: Bloop Windows Chat Application

**Feature**: `001-private-talk-chat`  
**Date**: 2026-11-19  
**Stack Direction**: Rust + Supabase + Modern Minimal Premium UI on Windows

---

## 1. Windows Desktop Application Architecture (Rust + Modern Aesthetic UI)

- **Decision**: Use **Tauri v2** (Rust core backend + Windows WebView2 frontend powered by React 19, TypeScript, Tailwind CSS v4, and Radix UI primitives).
- **Rationale**:
  - **Security Boundary in Rust**: 100% of cryptographic operations, key derivation, Windows DPAPI storage, Supabase authentication/network transport, and file encryption occur inside the compiled Rust binary. Plaintext keys remain in Rust memory (`zeroize` on drop) and are never exposed to the WebView frontend.
  - **Modern, Clean, Minimal, Premium UI/UX**: Tailwind CSS + Radix UI in WebView2 enables high-craft typography (`Inter` / `Geist`), subtle translucent surfaces, smooth micro-interactions (typing indicator pulses, online presence badges, seen receipt avatar stacks), and distraction-free layout without writing thousands of lines of custom GPU shaders.
  - **Native Multimedia & Small Footprint**: Windows 10/11 includes Edge WebView2 by default, providing hardware-accelerated `MP4`, `WEBM`, `GIF`, `WEBP`, `PNG`, and `JPG` rendering without bundling a 50+ MB Chromium binary or C++ FFmpeg dependencies.
- **Alternatives Considered**:
  - *Pure Rust GUI (`iced`, `slint`, `egui`)*: Rejected because native video playback (`MP4`/`WEBM`), animated GIFs, and high-craft modern minimal aesthetics require heavy external C/C++ codec bindings (`gstreamer`/`ffmpeg`) and custom layout boilerplate.
  - *Electron*: Rejected because it lacks a native Rust core, ships a heavy Chromium runtime, and stores secrets in Node.js V8 heap memory rather than zeroizable Rust structs.

---

## 2. Supabase Backend & Zero-Knowledge End-to-End Encryption Boundary

- **Decision**: Use **Supabase** (Auth, PostgreSQL with Row-Level Security, Realtime, and Storage) strictly as an untrusted cipher-routing and state-synchronization backend, paired with **client-side split-credential key derivation** in Rust.
- **Rationale**:
  - **Split-Credential Password Handling**: Users register and log in with `username` and `password`. In Rust:
    1. `supabase_auth_password` (256-bit hex): Derived pre-auth via `HKDF-SHA256(ikm = password, salt = SHA256("privatetalk-auth-v1:" || lower(username))[0..16], info = "supabase-auth")` and sent over TLS to Supabase Auth with synthetic email `<username>@privatetalk.internal` (email confirmation disabled). Supabase verifies login and issues a standard JWT (`auth.uid()`) for RLS without ever seeing the user's raw password or requiring a pre-auth DB lookup.
    2. `key_wrapping_key` (256-bit): After Auth login returns `auth.uid()`, Rust fetches `profiles.kdf_salt` (16 random bytes) and derives `key_wrapping_key` via `Argon2id` (`m=64 MiB, t=3, p=4`) + `HKDF-SHA256(info = "key-wrapping")` exclusively in Rust memory to encrypt/decrypt the user's private cryptographic identity bundle (`profiles.wrapped_priv_keys`).
  - **Row-Level Security (RLS)**: Supabase Postgres RLS policies enforce at the database engine level that users can only read/write conversations they belong to, can only edit/remove their own messages, and only the conversation `host_id` can remove other members.
- **Alternatives Considered**:
  - *Sending raw user password to Supabase Auth and using the same password to wrap private keys*: Rejected because it violates Constitution Principle I & II (a malicious or compromised server could derive the wrapping key during login).
  - *Custom Rust backend server on top of Supabase*: Rejected (Ponytail principle: smallest complete change). Direct Rust client-to-Supabase communication using Supabase REST (`postgrest`), Auth (`gotrue`), Storage, and Realtime WebSocket protocols eliminates an entire middle-tier server while keeping E2EE inside the Rust desktop client.

---

## 3. End-to-End Encryption Primitives & Group Key Rotation

- **Decision**:
  - **Identity Keys per User**: `X25519` keypair (`x25519-dalek`) for Diffie-Hellman key agreement + `Ed25519` keypair (`ed25519-dalek`) for message & key-bundle authentication signatures.
  - **Conversation Keys (`EpochKey`)**: Every conversation (both 1-to-1 and group) uses a symmetric 256-bit `ConversationEpochKey` (starting at `epoch = 1`).
  - **Key Distribution**: When a conversation is created, a member is added, or a member leaves/is removed, a new 256-bit `ConversationEpochKey` is generated in Rust. For each current member, the key is encrypted using an ephemeral-static `X25519` ECDH shared secret (`HKDF-SHA256` -> `ChaCha20-Poly1305`) and signed with the distributor's `Ed25519` key, then stored in `conversation_member_keys(conversation_id, epoch, recipient_id, wrapped_key, distributor_id, signature)`.
  - **Historical Keys for Added Group Members (FR-008)**: When an existing member adds a contact to a group, the inviter wraps all historical epoch keys (`1..=current_epoch`) for the new member's `X25519` public key and inserts them into `conversation_member_keys`, allowing the new member to decrypt past and future messages.
  - **Forward Access Revocation on Member Removal/Leave (FR-009, FR-015)**: When a member leaves or is removed by the host, `current_epoch` increments (`epoch + 1`), and a fresh `ConversationEpochKey` is distributed only to remaining members. The removed member never receives `epoch + 1`.
  - **Message & Media Payload Encryption**: Each message and media attachment uses a fresh CSPRNG 96-bit nonce (`OsRng`) and `ChaCha20-Poly1305` AEAD encrypted with a per-message key derived from `HKDF-SHA256(ConversationEpochKey, message_id)` and signed with the sender's `Ed25519` private key over `(conversation_id || message_id || epoch || nonce || ciphertext_hash)`.
- **Rationale**: Uses audited, pure-Rust RustCrypto crates (`chacha20poly1305`, `x25519-dalek`, `ed25519-dalek`, `argon2`, `hkdf`, `sha2`, `zeroize`). `O(N)` epoch key wrapping easily satisfies groups up to 100 members with <10 ms latency and far less complexity than MLS (RFC 9420) while directly supporting historical key sharing on member addition.
- **Alternatives Considered**:
  - *MLS (`openmls`)*: Rejected because MLS strictly prohibits sharing historical epoch keys with newly joined members, which conflicts with FR-008 clarification ("newly added members receive historical group keys so they can view all past and future messages").

---

## 4. Real-Time Messaging, Typing Indicators, Seen Receipts, and Online Presence

- **Decision**: Use a single **Supabase Realtime WebSocket connection** managed by the Rust backend with three channels/mechanisms:
  1. **Real-Time Message, Edit/Remove & Seen Receipt Sync (`postgres_changes`)**:
     - Subscribe to `INSERT` and `UPDATE` on `public.messages` (filtered by user's conversations via RLS) for instant message delivery, message edits, and message removals.
     - Subscribe to `INSERT` and `UPDATE` on `public.message_reads` to record and display **who has seen each message** in real time.
     - Subscribe to `INSERT`, `UPDATE`, and `DELETE` on `public.conversation_members`, `public.conversations`, and `public.contacts`.
  2. **Typing Indicators (`broadcast`)**:
     - On each active conversation channel `room:<conversation_id>`, broadcast lightweight ephemeral events `{ event: "typing", payload: { user_id, is_typing } }` throttled to once every 2 seconds while typing, with a client-side 3.5-second auto-expiry timer. Zero database writes for typing events.
  3. **Online Presence (`presence`)**:
     - Join the Supabase Realtime Presence channel `presence:global` upon login, tracking `{ user_id, status: "online", last_active_at }`. Supabase Realtime automatically broadcasts `presence_diff` (`joins` and `leaves`) when a user connects, disconnects, or closes the app.
- **Rationale**: Consolidates all real-time features over one authenticated WebSocket connection. Typing and presence avoid database write amplification by using Supabase Realtime Broadcast and Presence, while seen receipts (`message_reads`) are persisted in Postgres so users can see who read messages even if they were offline when the message was viewed.
- **Alternatives Considered**:
  - *Storing typing/online status in Postgres tables with polling*: Rejected due to unnecessary DB write load and latency (>1s vs <100ms over WebSocket broadcast/presence).

---

## 5. Windows-Native Data Protection (DPAPI), Notifications, and Taskbar Unread Badge

- **Decision**:
  - **Local Secret Storage (Windows DPAPI)**: Use the official `windows` crate (`Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData}` with `CRYPTPROTECT_UI_FORBIDDEN`) bound to the current Windows user logon session to encrypt the active session bundle (`supabase_refresh_token`, `user_private_keys`, cached `ConversationEpochKeys`) stored at `%LOCALAPPDATA%\PrivateTalk\session.dpapi`.
  - **Decrypted Media Handling**: Encrypted attachments downloaded from Supabase Storage (`chat-media` bucket) are decrypted in Rust memory and served to the WebView via a custom Tauri in-memory URI scheme (`privatetalk-media://localhost/<attachment_id>`) backed by an LRU in-memory cache with strict `zeroize` on eviction/logout. No decrypted image, GIF, or video is ever written to disk or `%TEMP%`.
  - **Windows Toast Notifications**: Use `tauri-plugin-notification` / Windows WinRT Toast Notification API (`Windows::UI::Notifications::ToastNotificationManager`) when the app window is minimized, unfocused, or viewing a different conversation. Clicking the toast triggers window restoration (`set_focus()`) and navigates to the conversation.
  - **Windows Taskbar Numeric Unread Badge**: Render an in-memory 32x32 RGBA badge icon in Rust showing the unread count (`1`..`99+`) and apply it to the main window `HWND` via COM `ITaskbarList3::SetOverlayIcon` (`windows::Win32::UI::Shell::ITaskbarList3`), clearing it with `SetOverlayIcon(hwnd, None, None)` when total unread reaches `0`.
- **Rationale**: Fully complies with Constitution Principle III (Windows-Native Data Protection & Isolation) and Principle IV (Zero-Leakage Observability). The custom Tauri protocol `privatetalk-media://` allows `<img src="privatetalk-media://..." />` and `<video src="privatetalk-media://..." />` to stream decrypted bytes straight from Rust memory without touching disk.
- **Alternatives Considered**:
  - *Writing decrypted videos to temporary files in `%TEMP%`*: Strictly prohibited by Constitution Principle III ("Decrypted message content and key material MUST NOT be written to unencrypted temporary files").

---

## 6. Modern, Clean, Minimal, Premium & Aesthetic UI/UX Design System

- **Decision**:
  - **Visual Direction**: High-craft dark/light adaptive minimal interface inspired by Linear and modern Apple/Teams desktop aesthetics—clean neutral slate palette (`#0B0D12` dark canvas / `#F8FAFC` light canvas, `#6366F1` indigo accent), subtle `1px` hairlines (`rgba(255,255,255,0.07)`), generous whitespace, and clear visual hierarchy.
  - **Layout Architecture**: Three-zone desktop layout:
    1. **Left Navigation & Profile Rail (64px)**: User avatar with live green online presence ring, unread counter pill, theme toggle, and profile settings modal trigger.
    2. **Conversations & Contacts Sidebar (280px)**: Exact-username contact finder bar, online contacts carousel/list with green presence dots, and conversation list showing latest decrypted snippet, timestamp, unread badge, and live `"typing..."` micro-label.
    3. **Active Conversation Stage (Flexible)**:
       - **Header**: Contact/Group avatar, title, live online status or member count, E2EE verified lock badge, and group management drawer trigger.
       - **Message Timeline**: Grouped message bubbles with smooth fade/slide-in, inline media lightbox/video player, `"Edited"` subtle tag, `"Message removed"` muted italic pill, hover action toolbar (`Edit`, `Remove` for own messages), and **Seen Receipts Bar** below messages showing micro-avatars of participants who have seen up to that message (with tooltip listing names & timestamps).
       - **Floating Typing Pill & Composer**: Animated 3-dot typing indicator (`"Alice is typing..."`) directly above a clean rounded message composer with media attachment picker (up to 50 MB validation badge).
- **Rationale**: Delivers a cohesive, premium, clutter-free user experience where every required capability (E2EE status, online presence, typing indicator, seen receipts, group host controls, media attachments) has an intuitive, low-friction visual home.
