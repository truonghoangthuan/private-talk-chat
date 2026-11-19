# Quickstart & End-to-End Validation Guide: Private Talk

**Feature**: `001-private-talk-chat`  
**Date**: 2026-11-19  
**Target Platform**: Windows 10 / Windows 11 Desktop (64-bit)

---

## 1. Prerequisites

1. **Windows 10 (1809+) or Windows 11** with Microsoft Edge WebView2 Runtime (pre-installed on modern Windows).
2. **Rust Toolchain**: `rustup` with stable MSVC toolchain (`x86_64-pc-windows-msvc`, Rust `1.85+`).
3. **Node.js / pnpm**: Node.js `22+` and `pnpm` (for building the minimal React + Tailwind CSS WebView bundle).
4. **Supabase Project or Supabase Local CLI**:
   - Local development: `supabase start` (via Docker Desktop) or a hosted Supabase project URL + Anon Key.

---

## 2. Environment & Database Setup

1. Apply the Supabase database migration and storage bucket policies located in `supabase/migrations/`:
   ```powershell
   supabase db reset
   ```
   *(Or run `supabase/migrations/0001_private_talk_schema.sql` in the Supabase SQL Editor).*
2. Create `.env` in repository root:
   ```ini
   PRIVATE_TALK_SUPABASE_URL=http://127.0.0.1:54321
   PRIVATE_TALK_SUPABASE_ANON_KEY=<your-anon-key>
   ```

---

## 3. Build, Test, and Run Commands

### 3.1 Run Automated Security & Unit Test Suite (Constitution Principle V Gate)
Verifies split-credential Argon2id derivation, `ChaCha20-Poly1305` E2EE, `Ed25519` signature verification, Windows DPAPI storage roundtrip, group epoch key rotation on member removal, and fail-closed rejection of tampered/unauthenticated payloads:
```powershell
cargo test --workspace
```

### 3.2 Run Application in Development Mode
```powershell
pnpm install
pnpm tauri dev
```

### 3.3 Launch Two Isolated Instances on One Windows Machine (Multi-User Testing)
To test real-time 1-to-1 and group chat, typing indicators, online presence, and seen receipts locally with two accounts (`alice` and `bob`):
```powershell
# Terminal 1 (Instance A - Default Profile)
$env:PRIVATE_TALK_PROFILE="alice"; pnpm tauri dev

# Terminal 2 (Instance B - Second Profile)
$env:PRIVATE_TALK_PROFILE="bob"; pnpm tauri dev -- --no-watch
```

---

## 4. End-to-End Verification Scenarios

### Scenario 1: Account Registration, DPAPI Key Storage & Profile Setup (US1)
1. In Instance A, register username `alice` with a password and display name `Alice Vance`.
2. Upload a `< 5 MB` PNG avatar and confirm it displays in the navigation rail.
3. Close and reopen Instance A: verify Windows DPAPI (`%LOCALAPPDATA%\PrivateTalk\alice\session.dpapi`) automatically restores the authenticated session and private keys.
4. Query Supabase `public.profiles`: confirm `wrapped_priv_keys` is opaque ciphertext and no plaintext private key exists in the database.

### Scenario 2: Contact Discovery, Online Presence, Typing Indicator, Seen Receipts & E2EE Media (US2)
1. In Instance B, register username `bob`. Verify `bob` shows as **Online** (emerald presence dot) once added.
2. In Instance A (`alice`), search for exact username `BOB` (case-insensitive) and click **Add Contact**.
3. Verify `bob` immediately appears in `alice`'s contact list AND `alice` immediately appears in `bob`'s contact list in real time with green **Online** indicators.
4. Open the 1-to-1 chat in both instances. Begin typing in Instance A and verify `"Alice Vance is typing..."` appears in Instance B within `< 200 ms`.
5. Send a text message, a PNG image, an animated GIF, and an MP4 video (`< 50 MB`) from `alice` to `bob`.
6. Verify `bob` receives and renders all 4 items in real time, and that `alice` immediately sees `bob`'s micro-avatar under the message (**Seen by Bob**).
7. Inspect Supabase `public.messages` and Storage bucket `chat-media`: confirm 100% of stored payloads are encrypted ciphertext (`ChaCha20-Poly1305`).

### Scenario 3: Group Chat, Historical Key Sharing & Host Removal Key Rotation (US3)
1. Register a third account `charlie`. Have `alice` add `charlie` as a contact.
2. Have `alice` create a group chat `"Project Vault"` initially with `bob` (`epoch = 1`) and send 2 encrypted messages.
3. Have `alice` (or `bob`) add `charlie` to `"Project Vault"`. Verify `charlie` receives historical `epoch = 1` keys and decrypts the 2 earlier messages plus new messages.
4. Have `alice` (Group Host) remove `charlie` from `"Project Vault"`.
5. Confirm `conversations.current_epoch` increments to `2`, a new `EpochKey(2)` is distributed only to `alice` and `bob`, and `charlie` cannot access or decrypt any post-removal messages.

### Scenario 4: Message Edit & Permanent Removal Wipe (US4)
1. In `"Project Vault"`, have `alice` edit a sent text message. Confirm `"Edited"` appears in real time for `bob`.
2. Have `alice` remove a sent media message. Confirm:
   - The timeline shows the minimal `"Message removed"` placeholder for both `alice` and `bob`.
   - In Supabase Postgres, `ciphertext`, `nonce`, `signature`, and `media_object_path` for that row are `NULL`.
   - The encrypted object in `chat-media` Storage bucket is permanently deleted.

### Scenario 5: Windows Notifications & Taskbar Unread Badge (US5)
1. Minimize Instance B (`bob`) to the Windows taskbar.
2. Send 3 messages from `alice` to `bob`.
3. Verify 3 native Windows Toast Notifications appear and the Windows taskbar icon for Instance B displays a numeric `"3"` overlay badge.
4. Click the Windows notification: verify Instance B restores to the foreground, opens the chat with `alice`, records `seen_at` in `message_reads`, and clears the Windows taskbar unread badge.
