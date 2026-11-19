# Data Model: Cryptographic Visual Identity and Desktop UI Craft Polish

**Feature**: `003-ui-design-craft-polish`  
**Date**: 2026-11-20  
**Architecture Layer**: WebView Presentation Layer (`src/`) — Zero Rust/Supabase schema or Tauri IPC DTO changes required

---

## 1. Existing Tauri IPC DTOs Consumed (Unchanged)

All data required by this feature is already provided by the existing Rust-to-WebView DTOs in `src/lib/types.ts`:

- `UserProfileDto`: `{ id, username, display_name, avatar_url }`
- `ContactDto`: `{ id, username, display_name, avatar_url, is_online }`
- `ConversationMemberDto`: `{ user_id, username, display_name, avatar_url, is_online, is_host, joined_at }`
- `ConversationDto`: `{ id, is_group, name, host_id, current_epoch, members, latest_preview, latest_timestamp, unread_count, updated_at }`
- `MessageDto`: `{ id, conversation_id, sender_id, sender_username, sender_display_name, sender_avatar_url, epoch, status, text, attachment, is_edited, edited_at, is_removed, removed_at, created_at, seen_by }`

> **Security Invariant**: Private keys (`X25519`, `Ed25519`), key wrapping keys, and raw symmetric epoch keys remain strictly inside Rust memory (`Zeroizing`) and never cross IPC.

---

## 2. Presentation View Models & Pure Helpers (`src/lib/ui-polish.ts`)

### 2.1 `CryptoFingerprintBadge`

A deterministic, human-verifiable visual digest derived from public account or conversation metadata.

| Field | Type | Description |
|-------|------|-------------|
| `seed` | `string` | Public non-secret identifier seed (`"${user.id}:${user.username}"` for profile identity, `"${conversation.id}:epoch-${conversation.current_epoch}"` for conversation channel) |
| `formatted` | `string` | 8 uppercase hex characters grouped into two 4-hex blocks separated by a bullet: `"XXXX • XXXX"` (e.g., `"7A3F • 9C12"`) |

**Validation & Invariants**:
- Deterministic: identical `seed` always produces identical `"XXXX • XXXX"` output.
- Sensitivity: incrementing `conversation.current_epoch` produces a distinct `"XXXX • XXXX"` fingerprint in the header.
- Zero secrets: derived strictly from public UUIDs, usernames, and integer epoch numbers.

---

### 2.2 `TimelineRenderItem` (Epoch Transition Markers & Message Grouping)

Computed from an ordered array of `MessageDto[]` for rendering in `MessageTimeline.tsx`.

```ts
export interface TimelineMessageItem {
  kind: "message";
  message: MessageDto;
  isGroupedWithPrev: boolean;
}

export interface TimelineEpochMarkerItem {
  kind: "epoch_divider";
  id: string;
  epoch: number;
  label: string; // e.g. "Epoch 2 • Key rotated"
}

export type TimelineRenderItem = TimelineMessageItem | TimelineEpochMarkerItem;
```

**Derivation Rules (`buildTimelineItems(messages: MessageDto[])`)**:
1. **Epoch Transition Marker (`TimelineEpochMarkerItem`)**:
   - Emitted immediately before `messages[i]` whenever `i > 0 && messages[i].epoch !== messages[i - 1].epoch`.
   - `label` is formatted as `` `Epoch ${messages[i].epoch} • Key rotated` ``.
2. **Consecutive Message Grouping (`isGroupedWithPrev`)**:
   - `true` if and only if all 5 conditions hold for `messages[i]` and `messages[i - 1]`:
     1. `i > 0`
     2. `messages[i].epoch === messages[i - 1].epoch` (never group across an epoch rotation)
     3. `messages[i].sender_id === messages[i - 1].sender_id`
     4. `messages[i].status === "verified" && !messages[i].is_removed && messages[i - 1].status === "verified" && !messages[i - 1].is_removed`
     5. `Math.abs(Date.parse(messages[i].created_at) - Date.parse(messages[i - 1].created_at)) <= 120_000` (within 2 minutes / 120,000 ms)
   - When `isGroupedWithPrev === true`:
     - Vertical spacing above the message reduces from `16px` (`mt-4`) to `4px` (`mt-1`).
     - Peer sender display name header is omitted (shared with the group lead bubble).

---

### 2.3 Inline Two-Step Destructive Confirmation State

Local ephemeral UI states preventing accidental single-click destructive execution:

| Component | State Variable | Initial | Trigger Transition | Confirm Action | Cancel / Reset Transition |
|-----------|----------------|---------|--------------------|----------------|---------------------------|
| `MessageBubble` | `confirmingRemove: boolean` | `false` | Click Trash icon -> `true` | Click `"Confirm"` -> invokes `onRemove(message.id)` | Click `"Cancel"` -> `false` |
| `GroupManageDrawer` (Member Row) | `confirmingRemoveUserId: string \| null` | `null` | Click `UserMinus` on member `m` -> `m.user_id` | Click `"Confirm"` -> invokes `onRemoveMember(conv.id, m.user_id)` and resets `null` | Click `"Cancel"` or drawer close -> `null` |
| `GroupManageDrawer` (Footer) | `confirmingLeave: boolean` | `false` | Click `"Leave Group"` -> `true` | Click `"Confirm Leave"` -> invokes `onLeaveGroup(conv.id)` | Click `"Cancel"` or drawer close -> `false` |
