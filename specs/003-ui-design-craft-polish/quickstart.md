# Quickstart & Validation Guide: Cryptographic Visual Identity and Desktop UI Craft Polish

**Feature**: `003-ui-design-craft-polish`  
**Date**: 2026-11-20

---

## 1. Prerequisites

- Windows 10/11 desktop environment
- Node.js 20+ and npm
- Rust 1.85+ (`x86_64-pc-windows-msvc`) for full desktop execution (`npm run tauri dev`)

---

## 2. Automated Build & Unit Test Verification

Run the frontend unit tests (verifying deterministic cryptographic fingerprint formatting, epoch transition divider insertion, and 2-minute consecutive message grouping rules) plus TypeScript/Vite production compilation:

```powershell
# Run Vitest unit tests for UI helpers (fingerprint & timeline grouping/epoch markers)
npm test

# TypeScript strict check + Vite production bundle
npm run build

# Verify Rust core tests remain green
cargo test --manifest-path src-tauri/Cargo.toml
```

**Expected Outcome**:
- `npm test` passes all unit tests in `src/lib/__tests__/ui-polish.test.ts`.
- `npm run build` exits with code `0` and zero TypeScript errors.
- `cargo test` passes all cryptographic, DPAPI, and group epoch rotation tests.

---

## 3. Interactive Desktop UI Verification Scenarios

Launch the application (using local loopback mode if Supabase env vars are unset):

```powershell
npm run tauri dev
```

### Scenario A: Cryptographic Fingerprints & Epoch Rotation Markers (US1)
1. Register or sign in on the `AuthScreen` (confirm title renders at `22px`).
2. Open **Profile Settings** from the left rail:
   - Verify your deterministic cryptographic identity fingerprint badge (`XXXX • XXXX`) is displayed.
   - Verify the manual `"Local Avatar Path"` text input is gone, leaving only `"Choose Avatar (≤ 5 MB)"`.
3. Create a group conversation or open a 1-to-1 chat:
   - Verify the `ChatHeader` displays the `16px` conversation title, the `E2EE` badge, and the conversation's deterministic fingerprint badge (`XXXX • XXXX`).
4. In a group conversation, send a message, remove a member (triggering an epoch key rotation to Epoch 2), and send another message:
   - Verify an inline timeline divider `"Epoch 2 • Key rotated"` renders between the Epoch 1 and Epoch 2 messages, and the header fingerprint badge updates for Epoch 2.

### Scenario B: Light/Dark Theme Contrast, Hover Feedback & Typography Floor (US2)
1. Click the Sun/Moon toggle in `NavRail` to switch to **Light Mode**:
   - Hover over `NavRail` buttons, `Sidebar` conversation rows, modal close (`X`) buttons, and message action buttons (`Edit`, `Remove`). Confirm every interactive element displays a visible slate hover surface (`--bg-hover`).
2. Inspect incoming peer messages vs. outgoing messages in both Light and Dark mode:
   - Confirm incoming peer messages use the neutral `--bg-bubble-peer` surface while outgoing messages use `#6366F1`.
3. Send an image or video attachment:
   - Confirm the filename and KB size caption inside the outgoing `#6366F1` bubble renders in high-contrast light text (`text-xs text-white/90`, contrast `> 7:1`).

### Scenario C: Multi-Line Composer, 2-Minute Message Grouping & Real Avatars (US3)
1. Focus the message composer, type `"Line 1"`, press `Shift+Enter`, type `"Line 2"`, and confirm the textarea expands up to 5 lines without sending. Press `Enter` (without `Shift`) and confirm the multi-line message sends and resets composer height.
2. Send 2 consecutive messages within 2 minutes:
   - Confirm they group tightly (`4px` vertical gap) without repeating the sender header.
3. Upload a profile avatar for a peer contact:
   - Confirm the uploaded avatar image appears in the sidebar contacts strip, conversation list row, and `ChatHeader`.

### Scenario D: Two-Step Destructive Confirmations & Single-Row Contacts Strip (US4)
1. Hover over a sent message and click the Trash (`Remove`) icon:
   - Confirm inline `"Confirm"` and `"Cancel"` buttons appear instead of immediately wiping the message. Click `"Cancel"` to verify no deletion occurs, then click Trash -> `"Confirm"` to remove.
2. Open **Group Settings** (`Group` button in `ChatHeader`):
   - Click member removal (`UserMinus`) or `"Leave Group"` and confirm inline `"Confirm"` / `"Cancel"` buttons appear before execution.
3. Inspect `NavRail` and `Sidebar`:
   - Confirm only one group-creation button exists (in the `Sidebar` header, removed from `NavRail`).
   - Confirm the `Sidebar` contacts list remains a single-row horizontal scroll strip (`overflow-x-auto`) even with 20+ contacts.
