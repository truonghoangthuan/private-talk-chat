# UI Design Craft & Component Contract: Bloop Desktop Polish

**Feature**: `003-ui-design-craft-polish`  
**Date**: 2026-11-20  
**IPC Impact**: None (`specs/001-private-talk-chat/contracts/tauri-ipc.md` remains unchanged; zero private keys or new commands cross the Tauri IPC boundary).

---

## 1. Theme Tokens Contract (`src/styles/globals.css`)

Both `:root` (Light Mode) and `.dark` (Dark Mode) MUST define these semantic tokens:

| CSS Variable | Light Mode (`:root`) | Dark Mode (`.dark`) | Purpose |
|--------------|----------------------|---------------------|---------|
| `--bg-canvas` | `#F8FAFC` | `#0B0D12` | Primary workspace background |
| `--bg-surface` | `#FFFFFF` | `#12161F` | Rail, sidebar, header, modal surface |
| `--bg-bubble` | `#EEF2FF` | `#1A202C` | Accented surface token |
| `--bg-bubble-peer` | `#F1F5F9` | `#151924` | Neutral incoming peer message bubble surface |
| `--bg-hover` | `rgba(15, 23, 42, 0.06)` | `rgba(255, 255, 255, 0.06)` | Standard interactive button/row hover fill (`>= 4%` delta) |
| `--bg-hover-strong` | `rgba(15, 23, 42, 0.10)` | `rgba(255, 255, 255, 0.10)` | Elevated action hover fill inside bubbles/toolbars |
| `--text-primary` | `#0F172A` | `#F8FAFC` | Primary copy (`>= 12:1` contrast) |
| `--text-muted` | `#475569` | `#94A3B8` | Metadata & secondary labels (`>= 4.5:1` contrast on canvas/surface/peer bubble) |
| `--border-hairline` | `rgba(15, 23, 42, 0.08)` | `rgba(255, 255, 255, 0.07)` | `1px` structural hairline borders |

---

## 2. Typography Scale Contract (FR-003, SC-001)

| UI Element | Tailwind Class / Size | Line Height / Weight | Notes |
|------------|-----------------------|----------------------|-------|
| Auth screen primary title (`AuthScreen`) | `text-[22px]` (`22px`) | `font-semibold tracking-tight` | Primary brand entry heading |
| Active conversation title (`ChatHeader`) | `text-base` (`16px`) | `font-semibold` | Clear hierarchy above `14px` messages |
| Message bubble body & composer input | `text-sm` / `text-[14px]` (`14px`) | `leading-[1.5]` | Core reading and writing copy |
| All metadata, timestamps, section headers, badges, captions | `text-xs` (`12px`) | `font-medium` or `font-normal` | Minimum `12px` floor across the app |
| Micro-avatar single-letter initial (`seen_by` stack / counter pill) | `text-[10px]` (`10px`) | `font-bold` | Sole permitted exception below `12px` |

---

## 3. Component Behavioral Contracts

### 3.1 `ChatHeader` & `ProfileModal` — Cryptographic Identity Fingerprint Badge (FR-001)
- `ChatHeader` MUST display a monospace cryptographic fingerprint badge (`font-mono text-xs`) derived via `formatCryptoFingerprint(`${conversation.id}:epoch-${conversation.current_epoch}`)` next to the `E2EE` status pill.
- `ProfileModal` MUST display the user's identity fingerprint badge (`font-mono text-xs`) derived via `formatCryptoFingerprint(`${user.id}:${user.username}`)` in the profile summary section.
- `ProfileModal` MUST NOT render a manual `"Local Avatar Path"` text input (FR-009).

### 3.2 `MessageTimeline` & `MessageBubble` — Epoch Dividers, Grouping, Contrast, and Two-Step Removal (FR-001, FR-002, FR-006, FR-007, FR-008)
- **Epoch Divider**: When adjacent messages have different `epoch` values, render an inline centered divider: `"Epoch {msg.epoch} • Key rotated"`.
- **Consecutive Grouping**: Consecutive verified messages from the same sender within `120 seconds` in the same epoch render with `4px` (`mt-1`) spacing and omit the repeated sender display name header.
- **Incoming vs. Outgoing Surface**:
  - Outgoing (`isOwn = true`): `bg-[#6366F1] text-white`
  - Incoming (`isOwn = false`): `bg-[var(--bg-bubble-peer)] text-[var(--text-primary)]`
- **Media Caption Contrast (`MediaViewer`)**:
  - Outgoing attachment caption uses `text-white/90` (`>= 4.5:1` contrast against outgoing bubble).
  - Incoming attachment caption uses `text-[var(--text-muted)]` (`>= 4.5:1` contrast against incoming bubble).
  - Caption text size MUST be `text-xs` (`12px`).
- **Two-Step Message Removal**: Clicking the trash icon enters confirmation mode showing inline `"Confirm"` and `"Cancel"` buttons before calling `onRemove(message.id)`.

### 3.3 `MessageComposer` — Auto-Expanding Multi-Line Textarea (FR-005)
- Uses `<textarea rows={1}>` that expands vertically with content up to 5 lines (`max-h-[120px]`), scrolling internally thereafter.
- `Enter` (without `Shift`) prevents newline and submits when non-empty (`text.trim().length > 0 || attachmentPath`).
- `Shift+Enter` inserts a newline.

### 3.4 `Sidebar` & `NavRail` — Single-Row Contacts Strip, Real Avatars, and Deduplicated Group Trigger (FR-004, FR-009)
- `NavRail` MUST NOT render a duplicate `"New Group Chat"` button (`onOpenCreateGroup` prop removed from `NavRail`).
- `Sidebar` contacts strip MUST use a single horizontal scroll row (`flex items-center gap-2 overflow-x-auto pb-1`) with `shrink-0` pills so 20+ contacts never wrap vertically.
- `Sidebar` (contacts strip + conversation list rows) and `ChatHeader` MUST render uploaded participant `avatar_url` images when available, falling back to two-letter initials on null or image load error.

### 3.5 `GroupManageDrawer` — Two-Step Confirmation for Member Removal and Leaving Group (FR-008)
- Clicking member removal (`UserMinus`) displays inline `"Confirm"` and `"Cancel"` buttons for that member row before calling `onRemoveMember`.
- Clicking `"Leave Group"` displays inline `"Confirm Leave"` and `"Cancel"` buttons before calling `onLeaveGroup`.
