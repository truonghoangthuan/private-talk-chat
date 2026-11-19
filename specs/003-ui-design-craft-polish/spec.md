# Feature Specification: Cryptographic Visual Identity and Desktop UI Craft Polish

**Feature Branch**: `003-ui-design-craft-polish`  
**Created**: 2026-11-20  
**Status**: Draft  
**Input**: User description: "I want to apply all the 7 fixes above"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cryptographic Identity Fingerprints and Epoch Rotation Timeline Markers (Priority: P1)

Users opening a conversation or viewing their profile immediately recognize that Private Talk is a zero-knowledge encrypted workspace through visible cryptographic identity fingerprints and inline timeline markers whenever conversation keys rotate.

**Why this priority**: Establishes an unmistakable cryptographic identity and surfaces security state transitions (such as key rotation after group membership changes) directly where users communicate.

**Independent Test**: Can be fully tested by opening any 1-to-1 or group conversation and the Profile Settings dialog to verify deterministic fingerprint badges appear, and by viewing or triggering a group key rotation (e.g., removing a member) to verify an inline epoch transition divider renders in the timeline.

**Acceptance Scenarios**:

1. **Given** an authenticated user viewing an active 1-to-1 or group conversation, **When** the conversation header renders, **Then** a deterministic, human-verifiable cryptographic fingerprint badge is displayed alongside the encryption status.
2. **Given** an authenticated user opening Profile Settings, **When** the profile summary renders, **Then** the user's own deterministic cryptographic identity fingerprint badge is displayed for verification.
3. **Given** a conversation whose messages span multiple encryption epochs (such as after a group member is removed or leaves), **When** the message timeline renders messages across an epoch boundary, **Then** an inline divider marker (`"Epoch N • Key rotated"`) appears between the old-epoch and new-epoch messages.

---

### User Story 2 - Consistent Light/Dark Theme Surfaces, Contrast, and Typography Hierarchy (Priority: P1)

Users switching between light and dark themes experience consistent hover feedback on every control, clear visual separation between incoming and outgoing message bubbles, legible attachment captions, and a crisp typographic hierarchy with no undersized text.

**Why this priority**: Fixes broken light-mode hover feedback, low-contrast media captions, and sub-readable micro-labels that directly harm daily legibility and visual polish.

**Independent Test**: Can be fully tested by toggling between light and dark themes, hovering over navigation/sidebar/composer/modal buttons, inspecting incoming vs. outgoing message bubbles with media attachments, and measuring text sizes and color contrast ratios.

**Acceptance Scenarios**:

1. **Given** the application is set to light mode, **When** the user hovers over navigation rail controls, sidebar conversation rows, message action buttons, or modal close buttons, **Then** each control displays a clearly visible theme-adaptive hover background.
2. **Given** the application is in light or dark mode, **When** incoming peer messages render beside outgoing messages, **Then** incoming peer messages use a neutral surface distinct from the user's accented outgoing bubble surface.
3. **Given** any screen in light or dark mode, **When** text elements and headings are inspected, **Then** all labels, badges, timestamps, and metadata are at least 12px (10px minimum reserved solely for single-letter micro-avatar initials), message body text is 14px, active conversation titles are 16px, and the sign-in screen title is 22px.
4. **Given** an outgoing message containing an image or video attachment, **When** the attachment filename and file size caption render inside the accented bubble, **Then** the caption text achieves at least a 4.5:1 contrast ratio against its container background.

---

### User Story 3 - Multi-Line Message Composition, Grouped Timeline Bubbles, and Real Peer Avatars (Priority: P2)

Users compose multi-line messages effortlessly, read rapid back-and-forth chats as visually grouped message blocks rather than fragmented cards, and see uploaded participant avatars consistently across contacts, conversation lists, and chat headers.

**Why this priority**: Aligns core chat ergonomics and visual recognition with modern desktop messaging expectations.

**Independent Test**: Can be fully tested by typing multi-line text with `Shift+Enter` and submitting with `Enter`, sending multiple messages within 2 minutes from the same participant to observe grouped spacing, and viewing contacts/conversations whose users have uploaded profile avatars.

**Acceptance Scenarios**:

1. **Given** an active conversation composer, **When** the user presses `Shift+Enter`, **Then** a newline is inserted and the input expands vertically up to a bounded height (5 lines) before scrolling; pressing `Enter` submits the message.
2. **Given** consecutive verified messages sent by the same participant within 2 minutes under the same encryption epoch, **When** the timeline renders them, **Then** adjacent messages group tightly (`4px` vertical gap) without repeating the sender's name header.
3. **Given** a contact or peer who has uploaded a profile avatar image, **When** they appear in the sidebar contacts strip, conversation list, or active chat header, **Then** their uploaded avatar image is displayed instead of two-letter fallback initials.

---

### User Story 4 - Two-Step Confirmation for Destructive Actions and Streamlined Navigation Chrome (Priority: P3)

Users are protected from accidental permanent message wipes or group key rotations via inline two-step confirmations, and navigate a cleaner interface free of duplicate triggers, developer file-path inputs, or oversized contact grids.

**Why this priority**: Prevents irreversible user mistakes and reduces interface clutter without altering core messaging functionality.

**Independent Test**: Can be fully tested by initiating message removal, member removal, and leaving a group to verify inline confirmation prompts appear before action execution, checking that only one group-creation control and one avatar file picker exist, and adding 20+ contacts to confirm the contacts strip scrolls horizontally within a bounded single row.

**Acceptance Scenarios**:

1. **Given** a user clicks to remove a sent message, remove a group member, or leave a group, **When** the initial destructive action is triggered, **Then** the interface displays an inline `"Confirm"` and `"Cancel"` prompt and performs no destructive change until `"Confirm"` is clicked.
2. **Given** an authenticated user viewing the main workspace and Profile Settings, **When** inspecting navigation controls and profile inputs, **Then** the group-creation button appears once in the sidebar header (not duplicated in the left navigation rail), and Profile Settings provides only the file picker for avatar selection with no manual local file-path text input.
3. **Given** a user with 20 or more contacts in the sidebar, **When** the sidebar renders, **Then** the contacts section remains a compact single-row horizontal scroll strip so the conversations list remains visible and usable below it.

---

### Edge Cases

- **Epoch boundary within a 2-minute burst**: If the same sender sends two messages less than 2 minutes apart across an encryption epoch change, the timeline MUST break the message group and insert the inline epoch rotation divider between them.
- **Whitespace-only multi-line input**: Pressing `Enter` when the composer contains only spaces or line breaks (and no attachment) MUST NOT submit an empty message.
- **Unavailable avatar image**: If an uploaded avatar image fails to load or is missing, the UI MUST gracefully display the participant's two-letter initials badge alongside their online presence dot.
- **Abandoned destructive confirmation**: If a user opens an inline `"Confirm"` / `"Cancel"` prompt for message removal or group member removal and then clicks `"Cancel"` or switches conversations, the pending confirmation state MUST reset without modifying data.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a deterministic, human-readable cryptographic identity fingerprint badge in the active conversation header and in Profile Settings, and MUST render an inline epoch transition divider (`"Epoch N • Key rotated"`) in the message timeline whenever adjacent messages belong to different encryption epochs.
- **FR-002**: System MUST provide theme-adaptive hover, surface, and border styling in both light and dark modes so every interactive control shows a distinct hover state and incoming peer messages use a neutral bubble surface distinct from outgoing accented bubbles.
- **FR-003**: System MUST enforce a minimum `12px` font size for all text labels, timestamps, badges, and metadata (`10px` minimum reserved exclusively for single-letter micro-avatar initials), `14px` for message body copy, `16px` for active conversation titles, and `22px` for the primary authentication heading.
- **FR-004**: System MUST render each participant's uploaded avatar image in the contacts strip, conversation list rows, and active conversation header whenever an avatar URL is present, falling back to two-letter initials only when absent or unloaded.
- **FR-005**: System MUST provide an auto-expanding multi-line message composer (bounded to 5 lines max height) where `Enter` sends the message and `Shift+Enter` inserts a newline.
- **FR-006**: System MUST visually group consecutive verified messages from the same sender within a 2-minute window in the same encryption epoch using compact (`4px`) spacing and omitting repeated sender headers.
- **FR-007**: System MUST render media attachment captions (filename and file size) at a minimum `4.5:1` contrast ratio against their bubble background for both outgoing and incoming messages in light and dark themes.
- **FR-008**: System MUST require an inline two-step confirmation (`Confirm` / `Cancel`) before executing permanent message removal, group member removal, or leaving a group.
- **FR-009**: System MUST expose a single group-creation trigger in the sidebar header (removing the duplicate trigger from the left navigation rail), remove the manual local file-path text input from Profile Settings, and constrain the sidebar contacts list to a single-row horizontal scroll strip.

### Key Entities

- **Identity Verification Fingerprint**: A compact, deterministic visual digest derived from non-secret public account or conversation metadata that signals cryptographic identity without exposing private keys.
- **Epoch Transition Marker**: A timeline separator displaying the new epoch number whenever conversation encryption keys rotate between consecutive messages.
- **Message Group**: A sequence of adjacent verified messages from the same sender within the same epoch and a 2-minute interval sharing one sender header.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of body text, metadata labels (`>= 12px`), and media attachment captions achieve at least a `4.5:1` contrast ratio across both light and dark themes.
- **SC-002**: 100% of interactive buttons and conversation rows display a visible hover state (`>= 4%` luminance delta) in both light and dark modes.
- **SC-003**: Users can compose and send multi-line messages using `Shift+Enter` and `Enter` in under 5 seconds without external copy-paste workarounds.
- **SC-004**: Destructive actions (message removal, member removal, group leave) require 2 explicit interactions (`Action` then `Confirm`), reducing accidental single-click executions to 0%.
- **SC-005**: With 20 or more contacts added, the contacts strip occupies a single fixed-height horizontal row (`<= 15%` of sidebar height), keeping at least 75% of sidebar vertical space available for conversations.
- **SC-006**: The polished desktop interface achieves an overall score of `>= 8.0 / 10` (and Concept score `>= 7.5 / 10`) on the 6-dimension design review rubric.

## Assumptions

- Cryptographic fingerprint badges are derived strictly from public, non-secret identifiers and epoch metadata already present in the presentation layer, preserving the zero-private-key boundary.
- Consecutive message grouping uses a 2-minute (`120 seconds`) threshold and breaks automatically on sender change, epoch transition, or non-verified message states (removed or verification failed).
- Existing profile avatar upload validation (PNG, JPEG, WEBP up to 5 MB via the native file picker) remains the sole user-facing avatar selection flow once the raw path override input is removed.
