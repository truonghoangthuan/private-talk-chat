# Phase 0 Research: Cryptographic Visual Identity and Desktop UI Craft Polish

**Feature**: `003-ui-design-craft-polish`  
**Date**: 2026-11-20  
**Scope**: Pure WebView UI (`src/`) design craft and cryptographic identity presentation polish (`0` Rust/Supabase changes)

---

## 1. Deterministic Cryptographic Identity Fingerprint Without Crossing the IPC Key Boundary

- **Decision**: Compute a deterministic 16-bit hexadecimal fingerprint (`XXXX • XXXX`, e.g., `7A3F • 9C12`) in a small pure helper (`formatCryptoFingerprint(seed: string)`) using FNV-1a 32-bit hashing over existing non-secret public identifiers:
  - **User Identity Fingerprint** (in `ProfileModal`): seeded from `${user.id}:${user.username}`
  - **Conversation Channel Fingerprint** (in `ChatHeader`): seeded from `${conversation.id}:epoch-${conversation.current_epoch}`
- **Rationale**:
  - Preserves Constitution Principle I & III and `AGENTS.md` ("Private keys (`X25519`, `Ed25519`), wrapping keys, and raw epoch keys must never cross the Tauri IPC boundary to JavaScript").
  - Zero new Tauri IPC commands or Rust DTO fields needed (Ponytail principle: smallest complete change using data already in `UserProfileDto` and `ConversationDto`).
  - Including `current_epoch` in the conversation fingerprint seed makes the header badge visibly update whenever a group key rotation increments the epoch.
- **Alternatives Considered**:
  - *Exposing public `X25519`/`Ed25519` key hex over Tauri IPC*: Rejected because it touches Rust DTOs, Tauri commands, and IPC contracts (`contracts/tauri-ipc.md`) when the spec explicitly assumes presentation-layer derivation from public identifiers and epoch metadata.
  - *Async WebCrypto `crypto.subtle.digest('SHA-256')`*: Rejected because async state in presentational headers adds flicker and boilerplate for a synchronous deterministic display badge.

---

## 2. Theme-Adaptive Surface, Hover, and Incoming vs. Outgoing Bubble Tokens

- **Decision**: Add semantic CSS variables in `src/styles/globals.css` for both `:root` (Light) and `.dark` (Dark):
  - `--bg-hover`: `rgba(15, 23, 42, 0.06)` in Light mode (`~6%` luminance delta on `#FFFFFF` / `#F8FAFC`), `rgba(255, 255, 255, 0.06)` in Dark mode (`~6%` luminance delta on `#12161F` / `#0B0D12`).
  - `--bg-hover-strong`: `rgba(15, 23, 42, 0.10)` in Light mode, `rgba(255, 255, 255, 0.10)` in Dark mode.
  - Replace hardcoded `hover:bg-white/5` and `hover:bg-white/10` across `App.tsx`, `NavRail.tsx`, `Sidebar.tsx`, `MessageComposer.tsx`, `MessageBubble.tsx`, `ProfileModal.tsx`, and `GroupManageDrawer.tsx` with `hover:bg-[var(--bg-hover)]`.
  - Switch incoming peer message bubbles in `MessageBubble.tsx` from `bg-[var(--bg-bubble)]` (`#EEF2FF` indigo tint) to `bg-[var(--bg-bubble-peer)]` (`#F1F5F9` neutral slate in Light, `#151924` neutral elevated slate in Dark).
- **Rationale**:
  - Fixes broken light-mode hover feedback (`hover:bg-white/5` is invisible against `#FFFFFF`) with a single CSS token.
  - Restores clear visual separation between incoming neutral peer bubbles (`--bg-bubble-peer`) and outgoing indigo bubbles (`#6366F1`).
- **Alternatives Considered**:
  - *Tailwind `dark:hover:bg-white/5 hover:bg-slate-900/5` on every element*: Rejected because CSS custom properties in `globals.css` keep class lists short and centralized.

---

## 3. Typography Hierarchy Floor (`12px` Minimum Metadata) and `4.5:1` Media Caption Contrast

- **Decision**:
  - Promote all `text-[10px]` and `text-[11px]` metadata, timestamps, section headers, error messages, and badges across components to `text-xs` (`12px`), reserving `text-[10px]` strictly for single-letter micro-avatar initials (and numeric badge counters where compact circular fit applies, or `text-xs` on pills). Specifically, update `MediaViewer`, `MessageBubble`, `ChatHeader`, `Sidebar`, `ProfileModal`, `AuthScreen`, and `GroupManageDrawer` labels/timestamps/badges to `text-xs` (`12px`), `ChatHeader` conversation title to `text-base` (`16px`), and `AuthScreen` primary title to `text-[22px]` (`22px`).
  - Pass `isOwn?: boolean` (or style context) to `MediaViewer` so outgoing indigo bubbles render attachment captions with high-contrast `text-white/90` (`> 7:1` contrast on `#6366F1` / darkened container) and incoming bubbles use `text-[var(--text-primary)]` / `text-[var(--text-muted)]` (`>= 4.6:1` contrast).
- **Rationale**:
  - Directly satisfies FR-003, FR-007, and SC-001 (`>= 4.5:1` WCAG AA contrast in both light and dark modes).
- **Alternatives Considered**:
  - *Opaque white card inside outgoing bubble for media caption*: Rejected because translucent dark footer with `text-white/95` on outgoing and `bg-[var(--bg-surface)] text-[var(--text-primary)]` on incoming looks cleaner and avoids heavy nested boxes.

---

## 4. Consecutive Message Grouping and Epoch Transition Dividers in `MessageTimeline`

- **Decision**: Compute per-message layout flags in `MessageTimeline.tsx` (extracted as a pure helper `buildTimelineItems(messages: MessageDto[])` for unit testability):
  - **Epoch Transition Divider**: Insert an epoch marker before `messages[i]` when `i > 0 && messages[i].epoch !== messages[i - 1].epoch`, rendering `"Epoch {messages[i].epoch} • Key rotated"`.
  - **Consecutive Message Grouping**: A message `messages[i]` joins the previous message's group (`isGroupedWithPrev = true`) iff:
    1. `i > 0`
    2. `messages[i].sender_id === messages[i - 1].sender_id`
    3. `messages[i].epoch === messages[i - 1].epoch`
    4. Both `messages[i]` and `messages[i - 1]` have `status === "verified"` and `!is_removed`
    5. `Math.abs(Date.parse(messages[i].created_at) - Date.parse(messages[i - 1].created_at)) <= 120_000` (2 minutes)
  - When `isGroupedWithPrev` is true: use `mt-1` (`4px` vertical spacing instead of `16px`) and omit the repeated peer sender display name header.
- **Rationale**:
  - Pure presentation derivation over `MessageDto[]` with zero backend changes.
  - Handles the edge case where an epoch rotation occurs within a 2-minute burst by breaking the group and inserting the `"Epoch N • Key rotated"` divider.
- **Alternatives Considered**:
  - *Grouping non-verified or removed messages*: Rejected per spec Assumption 2 ("breaks automatically on sender change, epoch transition, or non-verified message states").

---

## 5. Multi-Line Auto-Expanding `MessageComposer` (`Enter` vs. `Shift+Enter`)

- **Decision**: Replace `<input type="text">` in `MessageComposer.tsx` with a `<textarea rows={1}>`:
  - `onKeyDown`: When `e.key === "Enter" && !e.shiftKey`, call `e.preventDefault()` and trigger message submission (if `text.trim().length > 0 || attachmentPath`). When `Shift+Enter` is pressed, allow default newline insertion.
  - Auto-resize height on change/reset via `textarea.style.height = "auto"; textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px"` (5 lines at `20px` line-height + vertical padding = `~120px` max height, with `overflow-y-auto` beyond 5 lines).
- **Rationale**:
  - Zero external dependencies; standard DOM `scrollHeight` clamping in 4 lines of TypeScript.
- **Alternatives Considered**:
  - *`react-textarea-autosize` package*: Rejected (Ponytail Rule 4: never add a dependency for a few lines).

---

## 6. Real Peer Avatars with Graceful Initials Fallback

- **Decision**: Create or inline a clean `AvatarBadge` helper/component used across `Sidebar` (contacts strip and conversation list rows) and `ChatHeader`:
  - For 1-to-1 conversations, resolve `peer = conversation.members.find(m => m.user_id !== currentUserId)` and read `peer?.avatar_url`.
  - For contacts in the sidebar strip, read `contact.avatar_url`.
  - Render `<img src={avatarUrl} onError={() => setImgError(true)} />` when `avatarUrl && !imgError`; fall back to two-letter initials (`title.slice(0, 2).toUpperCase()`) when absent or on load error.
- **Rationale**:
  - `ContactDto.avatar_url` and `ConversationMemberDto.avatar_url` are already populated by the Rust backend and present in `src/lib/types.ts`—the UI simply ignored them in `Sidebar.tsx` and `ChatHeader.tsx`.
  - `onError` state handles unavailable/broken avatar URLs gracefully (Edge Case 3).
- **Alternatives Considered**:
  - *Radix Avatar primitive*: Can either use plain `<img>` with `onError` state (matching `NavRail.tsx`) or `@radix-ui/react-avatar`; plain `<img>` with local error fallback state is 10 lines, zero extra wrapper overhead, and deterministic in tests.

---

## 7. Inline Two-Step Confirmation for Destructive Actions & Chrome Cleanup

- **Decision**:
  - **Message Removal (`MessageBubble.tsx`)**: Clicking the trash icon sets `confirmingRemove = true` and renders inline `"Confirm"` (`bg-[#EF4444] text-white`) and `"Cancel"` buttons in place of the action icons. Clicking `"Cancel"` resets `confirmingRemove = false`.
  - **Group Member Removal & Leave Group (`GroupManageDrawer.tsx`)**:
    - Clicking remove on a member sets `confirmingRemoveUserId = m.user_id`, rendering inline `"Confirm"` / `"Cancel"` buttons for that row.
    - Clicking `"Leave Group"` sets `confirmingLeave = true`, rendering inline `"Confirm Leave"` and `"Cancel"` buttons at the drawer footer.
  - **Navigation & Modal Chrome Cleanup**:
    - Remove the duplicate `Users` ("New Group Chat") button and `onOpenCreateGroup` prop from `NavRail.tsx` (keeping the single group creation button in `Sidebar.tsx` header).
    - Remove the manual `"Local Avatar Path (optional override)"` text input from `ProfileModal.tsx` (keeping the file picker as the sole avatar selection control).
    - Change the contacts container in `Sidebar.tsx` from `flex flex-wrap gap-2` to `flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar` with `shrink-0` contact pills so 20+ contacts scroll horizontally in a single fixed-height row.
- **Rationale**:
  - Satisfies FR-008, FR-009, SC-004, and SC-005 with localized component state (`useState`) and zero global modal clutter.
