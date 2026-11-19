# Quickstart & Validation Guide: Privacy Focus Blur, Custom Icon, Replies, and Pinned Messages

**Feature**: `004-privacy-blur-replies-pins`  
**Date**: 2026-11-20

---

## 1. Prerequisites & Setup

1. **Apply Database Migration** (when using live Supabase):
   ```powershell
   supabase db reset
   ```
   Or execute `supabase/migrations/0002_pinned_messages.sql` in the Supabase SQL Editor after `0001_private_talk_schema.sql`.

2. **Build & Run Automated Verification Suite**:
   ```powershell
   # Frontend TypeScript & Vite production build
   npm run build

   # Frontend unit tests
   npm test

   # Rust security, negative crypto, reply binding, and shared pin tests
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

---

## 2. End-to-End Validation Scenarios

### Scenario 1: Automatic Privacy Blur on Window Focus Loss (US1)
1. Launch Private Talk:
   ```powershell
   npm run tauri dev
   ```
2. Log in and open an active conversation with messages and media.
3. Click outside the Private Talk window (or press `Alt+Tab`).
4. **Expected**: Within `<100ms`, the full viewport blurs behind the privacy shield (`"Window unfocused — content hidden for privacy"`), making all messages, contact names, and media previews illegible.
5. Click back into the Private Talk window.
6. **Expected**: The privacy blur clears immediately and normal interaction resumes.

### Scenario 2: Authenticated Message Replies & Jump-to-Parent (US2)
1. Hover over an existing verified message in a 1-to-1 or group chat and click **Reply**.
2. **Expected**: A reply preview banner appears above the message composer showing the target sender and snippet with a cancel (`X`) button.
3. Type a reply and press `Enter`.
4. **Expected**: The sent message displays a quoted preview of the parent message for all conversation participants.
5. Click the quoted parent preview on the reply bubble.
6. **Expected**: The timeline scrolls to and highlights the original parent message.
7. Edit or remove the original parent message.
8. **Expected**: Editing updates the quoted preview text; removing replaces the quoted preview with `"Message removed"` and zero plaintext leakage.

### Scenario 3: Shared Pinned Messages & `Pinned` Chat Subtab (US3)
1. Hover over two verified messages in a conversation and click **Pin** on each.
2. **Expected**: Both messages show a pinned indicator in the timeline, and the `Pinned (2)` subtab badge in `ChatHeader` updates for all participants in real time.
3. Click the **`Pinned`** subtab in `ChatHeader`.
4. **Expected**: Both pinned messages are listed in reverse chronological pin order (`pinned_at DESC`).
5. Click **Jump to message** on a pinned item.
6. **Expected**: The view switches back to the `Messages` subtab, scrolls to the target message, and highlights it.
7. Unpin one message from the `Pinned` subtab, and remove the other message as its sender.
8. **Expected**: Both disappear from the `Pinned` subtab and the empty state is shown.

### Scenario 4: Custom Branded Application Icon (US4)
1. Observe the running application's window titlebar, Windows taskbar button, `Alt+Tab` switcher, and in-app brand emblem (`AuthScreen`, `NavRail`, workspace empty state, and privacy blur shield).
2. **Expected**: The user-supplied blue emblem icon renders cleanly at all DPI scales while keeping the Windows taskbar unread badge overlay legible.
