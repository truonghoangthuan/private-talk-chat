# Implementation Plan: Cryptographic Visual Identity and Desktop UI Craft Polish

**Branch**: `003-ui-design-craft-polish` | **Date**: 2026-11-20 | **Spec**: [spec.md](file:///c:/work/temp/playground/private-talk-chat/specs/003-ui-design-craft-polish/spec.md)

**Input**: Feature specification from `/specs/003-ui-design-craft-polish/spec.md`

## Summary

Apply all 7 desktop UI design craft and cryptographic visual identity fixes across the React/Tailwind WebView presentation layer (`src/`) with zero changes to the Rust cryptographic core (`src-tauri/`) or Supabase backend (`supabase/`):
1. **Cryptographic Visual Identity & Epoch Transition Markers (FR-001)**: Render deterministic, human-verifiable cryptographic fingerprint badges (`XXXX • XXXX`) in `ChatHeader` and `ProfileModal` (derived purely from public identifiers and epoch numbers without exposing private keys over IPC), and insert inline `"Epoch N • Key rotated"` timeline dividers in `MessageTimeline` whenever adjacent messages cross an encryption epoch boundary.
2. **Theme-Adaptive Surfaces, Hover Tokens & Bubble Separation (FR-002)**: Introduce `--bg-hover` and `--bg-hover-strong` CSS tokens in `src/styles/globals.css`, replace hardcoded `hover:bg-white/5` classes so light mode has clear hover feedback (`>= 4%` luminance delta), and apply `--bg-bubble-peer` to incoming peer bubbles so they are visually distinct from outgoing accented bubbles.
3. **Typography Scale Floor & Media Caption Contrast (FR-003, FR-007)**: Enforce a `12px` (`text-xs`) floor for all metadata, timestamps, badges, and captions (`10px` reserved solely for micro-avatar initials), promote `ChatHeader` title to `16px` (`text-base`) and `AuthScreen` heading to `22px` (`text-[22px]`), and render outgoing attachment captions in `MediaViewer` with high-contrast `text-white/90` (`>= 4.5:1` contrast ratio).
4. **Multi-Line Auto-Expanding Composer (FR-005)**: Replace the single-line `<input type="text">` in `MessageComposer` with an auto-expanding `<textarea rows={1}>` (up to 5 lines / `120px` max height) supporting `Enter` to send and `Shift+Enter` for newline.
5. **Consecutive Message Grouping (FR-006)**: Group consecutive verified messages from the same sender within a 2-minute (`120s`) window in the same encryption epoch using compact `4px` (`mt-1`) spacing and omitting repeated sender headers.
6. **Real Peer Avatars Everywhere (FR-004)**: Display uploaded `avatar_url` images in the `Sidebar` contacts strip, `Sidebar` conversation rows, and `ChatHeader`, falling back gracefully to two-letter initials on null or load error.
7. **Two-Step Destructive Confirmations & Streamlined Chrome (FR-008, FR-009)**: Require inline `Confirm` / `Cancel` interactions before message removal (`MessageBubble`), member removal, or leaving a group (`GroupManageDrawer`); remove the duplicate group-creation button from `NavRail`; remove the manual local avatar path text input from `ProfileModal`; and constrain the `Sidebar` contacts list to a single-row horizontal scroll strip (`overflow-x-auto`).

## Technical Context

**Language/Version**: TypeScript `5.7+` (`strict: true`, `noUnusedLocals`, `noUnusedParameters`) in WebView2 UI layer (Rust `1.85+` core untouched)

**Primary Dependencies**: React `19.0.0`, Tailwind CSS `v4.0.0`, Lucide React `^0.475.0`, Vitest `^3.0.0` (zero new npm or Cargo packages added)

**Storage**: N/A (presentation-only update consuming existing DTOs from `src/lib/types.ts`)

**Testing**: `npm test` (`vitest run` unit tests for deterministic fingerprint formatting, epoch transition divider insertion, and 2-minute message grouping in `src/lib/__tests__/ui-polish.test.ts`), `npm run build` (`tsc && vite build`), and `cargo test --manifest-path src-tauri/Cargo.toml`

**Target Platform**: Windows 10 (1809+) and Windows 11 Desktop (64-bit Tauri v2 WebView2)

**Project Type**: `desktop-app` (Tauri v2 Windows desktop application)

**Performance Goals**: `60 fps` UI transitions, `< 1ms` synchronous fingerprint and timeline item derivation for 50-message conversation views

**Constraints**:
- **No Keys Over IPC**: Fingerprints MUST derive strictly from public IDs, usernames, and epoch numbers already present in `UserProfileDto` and `ConversationDto`.
- **Fail-Closed Rendering Preserved**: `verification_failed` and `removed` message states MUST NEVER group with verified messages and MUST retain their distinct warning/removed UI treatment.
- **Zero New Dependencies**: Implement fingerprint hashing, timeline grouping, and auto-expanding textarea with standard TypeScript/DOM APIs (Ponytail Rule 4).

**Scale/Scope**: 1 new pure helper module (`src/lib/ui-polish.ts` + 1 unit test file `src/lib/__tests__/ui-polish.test.ts`), 1 CSS token stylesheet (`src/styles/globals.css`), and 10 existing React components in `src/`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Constitution Principle | Pre-Research Gate | Post-Design Verification |
|------------------------|-------------------|--------------------------|
| **I. Security-First Architecture** | **PASS** — Pure UI presentation polish; does not weaken auth, RLS, or IPC boundaries. Two-step confirmation actively prevents accidental message wipes and unintended group key rotations. | **PASS** — Verified in `research.md` §1 & §7 and `contracts/ui-design-craft-contract.md` §3. |
| **II. Mandatory End-to-End Message Encryption** | **PASS** — Client-side encryption envelopes (`ChaCha20-Poly1305` + `Ed25519`) and epoch key rotation remain untouched in Rust; UI now explicitly surfaces epoch rotations (`"Epoch N • Key rotated"`) in the timeline. | **PASS** — Verified in `data-model.md` §2.2. |
| **III. Windows-Native Data Protection & Isolation** | **PASS** — Zero private keys cross IPC; decrypted media continues streaming exclusively from `DecryptedMediaCache` via `privatetalk-media://`. Removing the raw local file path text input in `ProfileModal` reduces arbitrary path entry surface. | **PASS** — Verified in `research.md` §1 & §7. |
| **IV. Zero-Leakage Observability & Fail-Closed Behavior** | **PASS** — `DecryptionStatus::VerificationFailed` messages remain fail-closed (`text: None`, `attachment: None`) and are explicitly excluded from consecutive message grouping so warning banners always stand out. | **PASS** — Verified in `data-model.md` §2.2 (`status === "verified"` check). |
| **V. Test-First Verification & Security Gates** | **PASS** — Dedicated Vitest unit tests will verify fingerprint determinism, epoch boundary splitting, and non-grouping of `verification_failed` / `removed` messages alongside existing `cargo test` security suites. | **PASS** — Verified in `quickstart.md` §2. |

## Project Structure

### Documentation (this feature)

```text
specs/003-ui-design-craft-polish/
├── plan.md                                  # This file (/speckit-plan command output)
├── research.md                              # Phase 0 output (/speckit-plan command)
├── data-model.md                            # Phase 1 output (/speckit-plan command)
├── quickstart.md                            # Phase 1 output (/speckit-plan command)
├── contracts/                               # Phase 1 output (/speckit-plan command)
│   └── ui-design-craft-contract.md
└── tasks.md                                 # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── App.tsx                                  # Remove duplicate onOpenCreateGroup prop passed to NavRail; use --bg-hover on update banner buttons
├── styles/
│   └── globals.css                          # Add --bg-hover, --bg-hover-strong, and high-contrast --text-muted tokens for Light/Dark modes
├── lib/
│   ├── types.ts                             # Unchanged existing IPC DTOs
│   ├── tauri-client.ts                      # Unchanged existing IPC invoke/listen wrappers
│   ├── ui-polish.ts                         # NEW: formatCryptoFingerprint() and buildTimelineItems() pure helpers
│   └── __tests__/
│       └── ui-polish.test.ts                # NEW: Vitest unit tests for fingerprint badges, epoch dividers, and 2-min grouping
└── components/
    ├── layout/
    │   ├── AppShell.tsx                     # Unchanged 3-zone desktop shell
    │   ├── NavRail.tsx                      # Remove duplicate group-create button; use hover:bg-[var(--bg-hover)]
    │   └── Sidebar.tsx                      # Single-row horizontal contacts strip, real avatar images with fallback, 12px text floor, --bg-hover
    ├── chat/
    │   ├── ChatHeader.tsx                   # 16px title, real peer avatar image, deterministic cryptographic fingerprint badge, 12px subtitle/badges
    │   ├── MessageTimeline.tsx              # Render inline "Epoch N • Key rotated" dividers and pass isGroupedWithPrev to MessageBubble
    │   ├── MessageBubble.tsx                # Distinct --bg-bubble-peer incoming surface, 4px grouped spacing, omitted grouped sender header, inline Confirm/Cancel removal, 12px metadata
    │   ├── MediaViewer.tsx                  # High-contrast (>= 4.5:1) 12px attachment filename/size caption for outgoing & incoming bubbles
    │   └── MessageComposer.tsx              # Auto-expanding <textarea> (up to 5 lines), Enter to send, Shift+Enter newline, --bg-hover
    └── modals/
        ├── AuthScreen.tsx                   # 22px primary brand title, 12px footer/error metadata
        ├── ProfileModal.tsx                 # Cryptographic identity fingerprint badge, remove manual Local Avatar Path input, 12px metadata, --bg-hover
        └── GroupManageDrawer.tsx            # Inline Confirm/Cancel for member removal and Leave Group, 12px metadata, --bg-hover
```

**Structure Decision**: Pure frontend presentation enhancement inside `src/`, adding a single 50-line pure helper module (`src/lib/ui-polish.ts`) with Vitest unit tests (`src/lib/__tests__/ui-polish.test.ts`) and surgical edits to `src/styles/globals.css` and existing React components. No Rust (`src-tauri/`) or database (`supabase/`) files are modified.

## Complexity Tracking

No Constitution violations. Zero new dependencies, zero backend changes, and full compliance with all five Core Principles.
