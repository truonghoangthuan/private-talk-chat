---
description: "Task list for Cryptographic Visual Identity and Desktop UI Craft Polish"
---

# Tasks: Cryptographic Visual Identity and Desktop UI Craft Polish

**Input**: Design documents from `/specs/003-ui-design-craft-polish/`
**Prerequisites**: [plan.md](file:///c:/work/temp/playground/private-talk-chat/specs/003-ui-design-craft-polish/plan.md) (required), [spec.md](file:///c:/work/temp/playground/private-talk-chat/specs/003-ui-design-craft-polish/spec.md) (required for user stories), [research.md](file:///c:/work/temp/playground/private-talk-chat/specs/003-ui-design-craft-polish/research.md), [data-model.md](file:///c:/work/temp/playground/private-talk-chat/specs/003-ui-design-craft-polish/data-model.md), [contracts/ui-design-craft-contract.md](file:///c:/work/temp/playground/private-talk-chat/specs/003-ui-design-craft-polish/contracts/ui-design-craft-contract.md), [quickstart.md](file:///c:/work/temp/playground/private-talk-chat/specs/003-ui-design-craft-polish/quickstart.md)

**Tests**: Vitest unit tests in `src/lib/__tests__/ui-polish.test.ts` are included per `plan.md` (Constitution Principle V & Ponytail check for non-trivial branching/grouping logic).

**Organization**: Tasks are grouped by user story (`US1` through `US4`) to enable independent implementation and verification of each story with zero changes to `src-tauri/` or `supabase/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Exact file paths and verbatim `data-model.md` constraints are included in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared CSS theme tokens required across all light/dark surface, contrast, and hover tasks.

- [X] T001 Define light (`:root`) and dark (`.dark`) semantic theme tokens `--bg-hover` (`rgba(15, 23, 42, 0.06)` light / `rgba(255, 255, 255, 0.06)` dark), `--bg-hover-strong` (`rgba(15, 23, 42, 0.10)` light / `rgba(255, 255, 255, 0.10)` dark), `--bg-bubble-peer` (`#F1F5F9` light / `#151924` dark), and `--text-muted` (`#475569` light / `#94A3B8` dark) in `src/styles/globals.css`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core pure helper module and unit tests for deterministic cryptographic fingerprint badges, epoch rotation dividers, and 2-minute consecutive message grouping.

**⚠️ CRITICAL**: Must complete before User Story phases that consume `src/lib/ui-polish.ts`.

- [X] T002 Implement `formatCryptoFingerprint(seed: string): string` (returning `"8 uppercase hex characters grouped into two 4-hex blocks separated by a bullet: \"XXXX • XXXX\" (e.g., \"7A3F • 9C12\")"` from a `"Public non-secret identifier seed (\"${user.id}:${user.username}\" for profile identity, \"${conversation.id}:epoch-${conversation.current_epoch}\" for conversation channel)"`) and `buildTimelineItems(messages: MessageDto[]): TimelineRenderItem[]` (emitting `TimelineEpochMarkerItem` with `kind: "epoch_divider"` and `label` formatted as `` `Epoch ${messages[i].epoch} • Key rotated` `` `"immediately before messages[i] whenever i > 0 && messages[i].epoch !== messages[i - 1].epoch"`, and setting `isGroupedWithPrev: true` iff `"1. i > 0"`, `"2. messages[i].epoch === messages[i - 1].epoch (never group across an epoch rotation)"`, `"3. messages[i].sender_id === messages[i - 1].sender_id"`, `"4. messages[i].status === \"verified\" && !messages[i].is_removed && messages[i - 1].status === \"verified\" && !messages[i - 1].is_removed"`, and `"5. Math.abs(Date.parse(messages[i].created_at) - Date.parse(messages[i - 1].created_at)) <= 120_000 (within 2 minutes / 120,000 ms)"`) in `src/lib/ui-polish.ts`
- [X] T003 Create Vitest unit tests verifying deterministic `"XXXX • XXXX"` fingerprint formatting, epoch sensitivity, `"Epoch N • Key rotated"` divider insertion on epoch change, 2-minute (`120_000` ms) same-sender grouping, and fail-closed non-grouping of `verification_failed` or `is_removed` messages in `src/lib/__tests__/ui-polish.test.ts`

**Checkpoint**: `npm test` passes for `src/lib/__tests__/ui-polish.test.ts` — user story phases can now proceed.

---

## Phase 3: User Story 1 - Cryptographic Identity Fingerprints and Epoch Rotation Timeline Markers (Priority: P1) 🎯 MVP

**Goal**: Surface deterministic cryptographic identity fingerprint badges (`XXXX • XXXX`) in the conversation header and profile dialog, and render inline `"Epoch N • Key rotated"` markers whenever messages cross an encryption epoch boundary.

**Independent Test**: Open any 1-to-1 or group conversation and Profile Settings to confirm deterministic `"XXXX • XXXX"` fingerprint badges render; view or trigger a group key rotation across messages to confirm `"Epoch N • Key rotated"` renders inline in the timeline and the header fingerprint updates for the new epoch.

### Implementation for User Story 1

- [X] T004 [P] [US1] Render the conversation channel fingerprint badge (`font-mono text-xs`) using `formatCryptoFingerprint(`${conversation.id}:epoch-${conversation.current_epoch}`)` alongside the `E2EE` status pill in `src/components/chat/ChatHeader.tsx`
- [X] T005 [P] [US1] Render the user's deterministic identity fingerprint badge (`font-mono text-xs`) using `formatCryptoFingerprint(`${user.id}:${user.username}`)` in the profile summary section of `src/components/modals/ProfileModal.tsx`
- [X] T006 [P] [US1] Update `MessageTimeline` to transform `messages` via `buildTimelineItems(messages)` and render inline centered `"Epoch {item.epoch} • Key rotated"` divider markers (`text-xs`) for `kind === "epoch_divider"` items in `src/components/chat/MessageTimeline.tsx`

**Checkpoint**: User Story 1 is independently functional and verifiable via Quickstart Scenario A.

---

## Phase 4: User Story 2 - Consistent Light/Dark Theme Surfaces, Contrast, and Typography Hierarchy (Priority: P1)

**Goal**: Provide visible theme-adaptive hover states (`--bg-hover`), distinct incoming (`--bg-bubble-peer`) vs. outgoing (`#6366F1`) bubble surfaces, a `12px` (`text-xs`) metadata floor (`16px` chat title, `22px` auth title, `10px` reserved strictly for micro-avatar single-letter initials), and `>= 4.5:1` contrast media attachment captions across light and dark modes.

**Independent Test**: Toggle between light and dark themes, hover over all navigation/sidebar/bubble/modal controls, inspect incoming vs. outgoing message bubbles with image/video attachments, and verify font sizes (`22px` auth heading, `16px` conversation title, `14px` message body, `>= 12px` metadata) and `>= 4.5:1` caption contrast.

### Implementation for User Story 2

- [X] T007 [P] [US2] Promote primary brand heading to `text-[22px]` (`22px`) and enforce `text-xs` (`12px`) minimum on footer security badge and error metadata in `src/components/modals/AuthScreen.tsx`
- [X] T008 [P] [US2] Replace hardcoded `hover:bg-white/10` with `hover:bg-[var(--bg-hover)]` and enforce `text-xs` (`12px`) minimum on update banner controls in `src/App.tsx`
- [X] T009 [P] [US2] Update `MediaViewer` to accept `isOwn?: boolean`, enforce `text-xs` (`12px`) on attachment captions and error states, and style captions with `text-white/90` when `isOwn` is true and `text-[var(--text-muted)]` when `isOwn` is false (`>= 4.5:1` contrast) in `src/components/chat/MediaViewer.tsx`
- [X] T010 [US2] Switch incoming peer message bubbles to `bg-[var(--bg-bubble-peer)] text-[var(--text-primary)]`, pass `isOwn` to `MediaViewer`, replace `hover:bg-white/10` with `hover:bg-[var(--bg-hover)]`, and promote sender names, timestamps, status labels, and action buttons to `text-xs` (`12px`, keeping `text-[10px]` solely on single-letter `seen_by` micro-avatar initials) in `src/components/chat/MessageBubble.tsx`
- [X] T011 [P] [US2] Promote active conversation title to `text-base` (`16px`) and enforce `text-xs` (`12px`) minimum on status subtitle, `E2EE` badge, and header action buttons in `src/components/chat/ChatHeader.tsx`

**Checkpoint**: User Stories 1 and 2 are independently functional and verifiable via Quickstart Scenarios A & B.

---

## Phase 5: User Story 3 - Multi-Line Message Composition, Grouped Timeline Bubbles, and Real Peer Avatars (Priority: P2)

**Goal**: Enable multi-line message entry (`Enter` to send, `Shift+Enter` for newline, auto-expanding up to 5 lines / `120px`), tighten consecutive same-sender verified messages within 2 minutes (`4px` gap without repeated sender header), and display uploaded `avatar_url` images with two-letter initials fallback across contacts, conversation rows, and the chat header.

**Independent Test**: Type multi-line messages using `Shift+Enter` and submit with `Enter`; send consecutive messages within 2 minutes to verify `4px` (`mt-1`) spacing and omitted repeated sender header; verify uploaded contact/peer avatars appear in `Sidebar` and `ChatHeader` with fallback to two-letter initials on null or error.

### Implementation for User Story 3

- [X] T012 [P] [US3] Replace `<input type="text">` with an auto-expanding `<textarea rows={1}>` (`max-h-[120px]` / 5 lines), handle `Enter` (without `Shift`) to submit when `text.trim().length > 0 || attachmentPath` and `Shift+Enter` for newline, enforce `text-xs` (`12px`) on attachment chip/error banner, and use `hover:bg-[var(--bg-hover)]` in `src/components/chat/MessageComposer.tsx`
- [X] T013 [P] [US3] Pass `isGroupedWithPrev={item.isGroupedWithPrev}` from `MessageTimeline` (`src/components/chat/MessageTimeline.tsx`) to `MessageBubble` (`src/components/chat/MessageBubble.tsx`), rendering grouped bubbles with `mt-1` (`4px` top margin instead of `mt-4`) and omitting the repeated peer sender display name header when `isGroupedWithPrev` is true
- [X] T014 [P] [US3] Render the peer participant's uploaded `avatar_url` image (`members.find(m => m.user_id !== currentUserId)?.avatar_url`) in `ChatHeader` for 1-to-1 conversations with `onError` fallback to two-letter initials in `src/components/chat/ChatHeader.tsx`
- [X] T015 [P] [US3] Render uploaded `contact.avatar_url` and 1-to-1 peer `avatar_url` images with `onError` fallback to two-letter initials across the contacts strip and conversation list rows, enforce `text-xs` (`12px`) minimum on section headers/timestamps/badges, and replace `hover:bg-white/5` with `hover:bg-[var(--bg-hover)]` in `src/components/layout/Sidebar.tsx`

**Checkpoint**: User Stories 1, 2, and 3 are independently functional and verifiable via Quickstart Scenarios A, B, & C.

---

## Phase 6: User Story 4 - Two-Step Confirmation for Destructive Actions and Streamlined Navigation Chrome (Priority: P3)

**Goal**: Protect destructive actions (message removal, member removal, leaving a group) with inline `"Confirm"` / `"Cancel"` prompts, deduplicate the group creation button from `NavRail`, remove the manual local avatar path text input from `ProfileModal`, and constrain the `Sidebar` contacts strip to a single-row horizontal scroll container.

**Independent Test**: Click message remove, group member remove, and leave group to confirm inline `"Confirm"` and `"Cancel"` buttons appear and `"Cancel"` aborts without mutation; verify `NavRail` has no group creation button, `ProfileModal` has no manual file path input, and 20+ contacts scroll horizontally in a single row in `Sidebar`.

### Implementation for User Story 4

- [X] T016 [P] [US4] Add `confirmingRemove: boolean` (initial `false`) state to `MessageBubble` so clicking the Trash icon opens inline `"Confirm"` (invoking `onRemove(message.id)`) and `"Cancel"` (resetting `confirmingRemove` to `false`) buttons in `src/components/chat/MessageBubble.tsx`
- [X] T017 [P] [US4] Add `confirmingRemoveUserId: string | null` (initial `null`) and `confirmingLeave: boolean` (initial `false`) states to `GroupManageDrawer` for inline two-step `"Confirm"` / `"Cancel"` member removal and `"Confirm Leave"` / `"Cancel"` group leave, enforce `text-xs` (`12px`) metadata floor, and replace `hover:bg-white/5` with `hover:bg-[var(--bg-hover)]` in `src/components/modals/GroupManageDrawer.tsx`
- [X] T018 [P] [US4] Remove the duplicate `"New Group Chat"` (`Users`) button and `onOpenCreateGroup` prop from `src/components/layout/NavRail.tsx` (and its prop call site in `src/App.tsx`), replacing `hover:bg-white/5` with `hover:bg-[var(--bg-hover)]` in `src/components/layout/NavRail.tsx`
- [X] T019 [P] [US4] Remove the manual `"Local Avatar Path"` text input override from `ProfileModal`, enforce `text-xs` (`12px`) metadata floor, and replace `hover:bg-white/5` with `hover:bg-[var(--bg-hover)]` in `src/components/modals/ProfileModal.tsx`
- [X] T020 [US4] Convert the contacts container in `src/components/layout/Sidebar.tsx` from `flex-wrap` to a single-row horizontal scroll strip (`flex items-center gap-2 overflow-x-auto pb-1`) with `shrink-0` contact pills

**Checkpoint**: All 4 user stories are independently functional and verifiable via Quickstart Scenarios A–D.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation of unit tests, strict TypeScript/Vite production build, and Rust security test suites.

- [X] T021 Run `npm test`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml` to verify all unit tests, strict TypeScript checks, and Rust cryptographic tests pass per `specs/003-ui-design-craft-polish/quickstart.md`

---

## Phase 8: Convergence

- [X] T022 Fix light-mode incoming attachment caption contrast (`>= 4.5:1`) in `src/components/chat/MediaViewer.tsx` (use neutral/light container background or `--text-primary` when `!isOwn`) per FR-007 / SC-001 (partial)
- [X] T023 Enforce `text-xs` (`12px`) floor on `NavRail` unread counter badge (`src/components/layout/NavRail.tsx`) and use single-letter initial or `text-xs` on `Sidebar` contact micro-avatar (`src/components/layout/Sidebar.tsx`) per FR-003 (partial)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1 — T001)**: No dependencies — starts immediately.
- **Foundational (Phase 2 — T002, T003)**: No runtime dependency on T001; blocks `US1` and `US3` components that import `src/lib/ui-polish.ts`.
- **User Story 1 (Phase 3 — T004..T006)**: Depends on Phase 2 (`T002`).
- **User Story 2 (Phase 4 — T007..T011)**: Depends on Phase 1 (`T001`).
- **User Story 3 (Phase 5 — T012..T015)**: Depends on Phase 1 (`T001`) and Phase 2 (`T002`).
- **User Story 4 (Phase 6 — T016..T020)**: Depends on Phase 1 (`T001`).
- **Polish (Phase 7 — T021)**: Depends on completion of Phases 1–6.

### User Story Dependencies

- **User Story 1 (P1)**: Independent after Phase 2.
- **User Story 2 (P1)**: Independent after Phase 1.
- **User Story 3 (P2)**: Independent after Phases 1 & 2 (integrates cleanly with `MessageTimeline`, `MessageBubble`, and `ChatHeader`).
- **User Story 4 (P3)**: Independent after Phase 1.

### Parallel Opportunities

- `T001` (`src/styles/globals.css`) and `T002` (`src/lib/ui-polish.ts`) can run in parallel.
- Within **US1**: `T004` (`ChatHeader.tsx`), `T005` (`ProfileModal.tsx`), and `T006` (`MessageTimeline.tsx`) touch different files and can run in parallel.
- Within **US2**: `T007` (`AuthScreen.tsx`), `T008` (`App.tsx`), `T009` (`MediaViewer.tsx`), and `T011` (`ChatHeader.tsx`) touch different files and can run in parallel before `T010` (`MessageBubble.tsx`).
- Within **US3**: `T012` (`MessageComposer.tsx`), `T013` (`MessageTimeline.tsx`/`MessageBubble.tsx`), `T014` (`ChatHeader.tsx`), and `T015` (`Sidebar.tsx`) can run in parallel across distinct files.
- Within **US4**: `T016` (`MessageBubble.tsx`), `T017` (`GroupManageDrawer.tsx`), `T018` (`NavRail.tsx`/`App.tsx`), `T019` (`ProfileModal.tsx`), and `T020` (`Sidebar.tsx`) touch distinct components and can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Run all 3 User Story 1 component tasks in parallel after T002 completes:
Task T004: "Render conversation channel fingerprint badge in src/components/chat/ChatHeader.tsx"
Task T005: "Render user identity fingerprint badge in src/components/modals/ProfileModal.tsx"
Task T006: "Render inline 'Epoch N • Key rotated' dividers in src/components/chat/MessageTimeline.tsx"
```

## Parallel Example: User Story 4

```bash
# Run two-step destructive confirmation and chrome cleanup tasks in parallel:
Task T016: "Add inline Confirm/Cancel message removal state in src/components/chat/MessageBubble.tsx"
Task T017: "Add inline Confirm/Cancel member removal and group leave states in src/components/modals/GroupManageDrawer.tsx"
Task T018: "Remove duplicate group-create button from src/components/layout/NavRail.tsx and src/App.tsx"
Task T019: "Remove manual Local Avatar Path input from src/components/modals/ProfileModal.tsx"
Task T020: "Convert contacts container to single-row horizontal scroll strip in src/components/layout/Sidebar.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2 — Core P1 Priorities)

1. Complete Phase 1: Setup (`T001`) and Phase 2: Foundational (`T002`–`T003`).
2. Complete Phase 3: User Story 1 (`T004`–`T006`) — Cryptographic identity fingerprints and epoch rotation markers.
3. Complete Phase 4: User Story 2 (`T007`–`T011`) — Light/dark hover tokens, distinct peer bubble surfaces, `12px` typography floor, and `>= 4.5:1` attachment caption contrast.
4. **STOP and VALIDATE**: Run `npm test` and verify Quickstart Scenarios A & B.

### Incremental Delivery

1. Setup + Foundational (`T001`–`T003`) → Pure helpers tested and theme tokens ready.
2. Add US1 (`T004`–`T006`) → Cryptographic identity & epoch markers visible.
3. Add US2 (`T007`–`T011`) → Light/dark surfaces, contrast, and typography hierarchy polished.
4. Add US3 (`T012`–`T015`) → Multi-line composer, 2-minute bubble grouping, and real peer avatars active.
5. Add US4 (`T016`–`T020`) + Polish (`T021`) → Two-step destructive confirmations and streamlined chrome verified.
