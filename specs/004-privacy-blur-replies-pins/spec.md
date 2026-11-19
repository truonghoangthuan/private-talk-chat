# Feature Specification: Privacy Focus Blur, Custom Application Icon, Message Replies, and Pinned Messages

**Feature Branch**: `004-privacy-blur-replies-pins`  
**Created**: 2026-11-20  
**Status**: Draft  
**Input**: User description: "I want this app is blur when the user loss focus. Use my uploaded image as the icon of this application I want this app support reply a message in a chat. I also want the feature to pin one or more message in a chat, then we have a subtab name `Pinned` in the chat."

## Clarifications

### Session 2026-11-20

- Q: When a participant pins a message in a 1-to-1 or group chat, should that pinned message appear in the `Pinned` subtab for all participants in the conversation or only for the user who pinned it? (FR-009) → A: Shared for everyone in the chat (any current participant can pin or unpin for the whole conversation).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic Privacy Blur on Focus Loss (Priority: P1)

When an authenticated or unauthenticated user switches away from the Private Talk window (for example, clicking another application, pressing Alt+Tab, or minimizing/deactivating the window), the entire application viewport immediately blurs to obscure on-screen conversations, contact names, and sensitive content from shoulder-surfing or screen-sharing exposure. When the user focuses the Private Talk window again, the blur immediately clears and normal interaction resumes.

**Why this priority**: Directly protects visual confidentiality of private conversations in accordance with the project's security-first architecture whenever the user is not actively focused on the window.

**Independent Test**: Can be fully tested by opening Private Talk with an active conversation visible, clicking outside the application window to remove focus, verifying the entire interface becomes visually obscured and illegible, and clicking back into the window to verify the interface immediately restores clarity.

**Acceptance Scenarios**:

1. **Given** Private Talk is open and actively focused on the desktop, **When** the application window loses focus to another window or the desktop shell, **Then** the application immediately applies a full-window privacy blur that obscures all text, avatars, and media previews.
2. **Given** Private Talk is currently in an unfocused, blurred state, **When** the user brings focus back to the Private Talk window, **Then** the privacy blur is removed immediately and the user can interact with the interface without delay.
3. **Given** Private Talk is unfocused and blurred, **When** a new message arrives in the background, **Then** the incoming message content remains obscured behind the privacy blur until the window regains focus.

---

### User Story 2 - Reply to a Message in Chat (Priority: P1)

A participant in a 1-to-1 or group chat selects a "Reply" action on an existing message in the conversation timeline, sees a reply context banner above the message composer, types their response (with or without an attachment), and sends it. All conversation participants see the new message linked to a quoted preview of the original message and can click the quoted preview to scroll to and highlight the original message in the chat timeline.

**Why this priority**: Essential conversational threading capability for clarity in fast-moving 1-to-1 and group chats while maintaining end-to-end encryption integrity.

**Independent Test**: Can be fully tested by selecting "Reply" on a message in a conversation, sending a reply text, verifying the sent message displays the quoted parent message for both sender and recipient, and clicking the quoted reference to verify the timeline scrolls to and highlights the original message.

**Acceptance Scenarios**:

1. **Given** an active 1-to-1 or group chat with existing messages, **When** a user activates the "Reply" action on a non-removed message, **Then** the message composer displays a reply preview banner showing the target message's sender and a summary snippet (or media indicator) along with a dismiss control to cancel the reply.
2. **Given** the message composer is in reply mode targeting a specific message, **When** the user submits a new message, **Then** the sent message includes an authenticated reference to the parent message and renders with a quoted preview of that parent message for all conversation participants.
3. **Given** a reply message displayed in the conversation timeline, **When** a user clicks the quoted parent message preview, **Then** the conversation view navigates to the original parent message and visually highlights it.
4. **Given** a reply message whose parent message is subsequently removed by its sender (or fails cryptographic verification), **When** any participant views the reply message, **Then** the quoted preview displays a "Message removed" (or unverified) placeholder without exposing any deleted or unverified content.

---

### User Story 3 - Pin Multiple Messages and Browse the `Pinned` Chat Subtab (Priority: P2)

A participant in a 1-to-1 or group chat pins one or more important messages in the conversation. Each pinned message displays a pinned indicator in the main timeline, and the conversation header provides a `Pinned` subtab (alongside the main conversation view). Selecting the `Pinned` subtab displays all currently pinned messages for that conversation, allowing participants to review them, jump directly to any pinned message in the main timeline, or unpin messages.

**Why this priority**: Allows chat participants to bookmark and quickly retrieve multiple important encrypted messages per conversation via a dedicated `Pinned` subtab.

**Independent Test**: Can be fully tested by pinning two messages in a chat, switching to the `Pinned` subtab in that chat, verifying both pinned messages appear there for all participants, clicking one to jump back to the main timeline, and unpinning one message to verify it disappears from the `Pinned` subtab.

**Acceptance Scenarios**:

1. **Given** an active 1-to-1 or group chat, **When** a current participant selects the "Pin" action on one or more non-removed messages, **Then** each selected message is marked as pinned for all participants in that conversation and the `Pinned` subtab badge/count updates to reflect the total number of pinned messages.
2. **Given** an active chat with a `Pinned` subtab, **When** the user switches to the `Pinned` subtab, **Then** the view lists all currently pinned messages for that conversation in reverse chronological pin order (most recently pinned first), displaying sender, timestamp, and decrypted content/media preview.
3. **Given** the user is viewing the `Pinned` subtab, **When** the user selects a pinned message to view in context, **Then** the chat switches back to the main message timeline, scrolls to the selected message, and highlights it.
4. **Given** a message is currently pinned in a conversation, **When** a participant selects "Unpin" from either the main timeline or the `Pinned` subtab, **Then** the message is unpinned for all conversation participants and removed from the `Pinned` subtab.
5. **Given** a conversation with zero pinned messages, **When** the user opens the `Pinned` subtab, **Then** the subtab displays a clear empty state explaining that no messages are pinned in this chat yet.

---

### User Story 4 - Custom Branded Application Icon (Priority: P3)

When a user installs, launches, or views Private Talk on Windows, the application displays the user-supplied blue emblem icon across the desktop shortcut, executable, window titlebar, taskbar button (preserving unread badge overlays), and in-app brand surfaces.

**Why this priority**: Establishes consistent visual identity across the Windows operating system shell and application chrome using the user's provided artwork.

**Independent Test**: Can be tested by building/launching the application on Windows and verifying that the window icon, taskbar icon, and packaged application resources display the newly provided icon at all standard Windows DPI scales without distortion.

**Acceptance Scenarios**:

1. **Given** Private Talk is installed or running on Windows, **When** the user views the application in the Windows taskbar, Alt+Tab switcher, window titlebar, or executable file properties, **Then** the application displays the provided custom icon sharp and proportioned at standard resolutions.
2. **Given** Private Talk has unread messages while using the updated application icon, **When** the taskbar unread badge is rendered, **Then** the numeric unread badge remains clearly legible over the updated taskbar icon.

---

### Edge Cases

- **Replying to or pinning a removed or unverified message**: Users cannot initiate a new reply or pin action on a message that has already been removed or that failed cryptographic verification.
- **Original message removed after being pinned**: When a sender removes a message that is currently pinned, the message is automatically unpinned and removed from the `Pinned` subtab for all participants so no ghost entry remains.
- **Original message edited after being replied to or pinned**: Because replies and pins reference the message identity and decrypt from the canonical encrypted message payload, an authorized edit by the original sender updates the displayed text in both the `Pinned` subtab and any reply quote preview (with the "Edited" indicator).
- **Tampered reply reference**: If a message payload claims to reply to a message ID outside the current conversation or fails signature/integrity verification, the system fails closed and blocks rendering of the unverified content.
- **Rapid focus switching**: Rapidly toggling window focus (e.g., repeated Alt+Tab) transitions the privacy blur cleanly without locking user input or leaking transient unblurred frames while unfocused.
- **Removed or departed group members**: A user who has left or been removed from a group chat cannot pin or unpin messages or send replies in that conversation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST automatically obscure the entire application viewport with a privacy blur overlay whenever the main application window loses operating system focus, and immediately remove the blur when the window regains focus.
- **FR-002**: System MUST prevent reading message text, contact details, and media previews while the privacy blur overlay is active.
- **FR-003**: System MUST replace the default application icon across all Windows application icon resolutions, window chrome, and brand surfaces with the user-provided custom icon artwork while preserving taskbar unread badge visibility.
- **FR-004**: System MUST allow any active participant in a 1-to-1 or group chat to select a non-removed, cryptographically verified message and compose a reply referencing that parent message.
- **FR-005**: System MUST display an active reply banner above the message composer while a reply is being drafted, allowing the user to cancel the reply link before sending.
- **FR-006**: System MUST cryptographically bind any parent message reply reference within the authenticated message payload so reply linkage cannot be forged or altered in transit or at rest without failing verification.
- **FR-007**: System MUST render each reply message with a quoted summary of the referenced parent message (sender display name and text snippet or attachment label) and scroll to and highlight the parent message when the user activates the quoted summary.
- **FR-008**: System MUST replace the quoted summary of a parent message with a safe placeholder if the parent message was removed by its sender or failed cryptographic verification, leaking zero plaintext.
- **FR-009**: System MUST allow any active participant in a 1-to-1 or group chat to pin one or more non-removed, cryptographically verified messages for the entire conversation and unpin any currently pinned message, without restricting pinning exclusively to the group host.
- **FR-010**: System MUST synchronize shared message pin and unpin state changes across all active participants of the conversation in real time and persist the shared pin list across sessions so all participants (including newly added group members with historical epoch keys) see the same `Pinned` subtab contents.
- **FR-011**: System MUST provide a `Pinned` subtab within each chat conversation view that displays all currently pinned messages for that conversation, along with a count indicator and an empty state when no messages are pinned.
- **FR-012**: System MUST allow users in the `Pinned` subtab to jump directly to a pinned message's location in the main conversation timeline or unpin the message directly from the subtab.
- **FR-013**: System MUST automatically unpin a message and remove it from the `Pinned` subtab if the message is subsequently removed by its sender.

### Key Entities *(include if feature involves data)*

- **Window Focus Privacy State**: Represents whether the application window currently holds operating system foreground focus, governing whether the full-viewport privacy blur shield is engaged.
- **Message Reply Reference**: An authenticated association linking a sent Message to the unique identifier of a parent Message within the same Conversation.
- **Pinned Message Entry**: Represents an active bookmark of a specific Message within a Conversation, recording the conversation, the pinned message reference, the participant who pinned it, and the timestamp when it was pinned.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The privacy blur overlay engages within 100 milliseconds of the application window losing focus and clears within 100 milliseconds of the window regaining focus in 100% of focus transitions.
- **SC-002**: Users can initiate a reply to an existing message, send the response, and navigate to the original message via the quoted preview in under 5 seconds.
- **SC-003**: Pinning or unpinning a message updates the main chat timeline indicator and the `Pinned` subtab for all online conversation participants in under 1 second.
- **SC-004**: 100% of reply references remain end-to-end authenticated within the encrypted message envelope, and 100% of tampered reply payloads or unauthorized pin actions are rejected fail-closed.
- **SC-005**: The custom application icon renders cleanly without pixelation or clipping across standard Windows desktop icon sizes (16x16 through 256x256) while keeping taskbar unread counters legible.

## Assumptions

- **Focus Loss Definition**: "Loss of focus" means the application window is no longer the active foreground window in the operating system (including when switching to another application, clicking the desktop/taskbar, or opening external windows).
- **Pin Permissions**: Consistent with collaborative chat behavior in 1-to-1 and group chats, any current member of the conversation can pin or unpin messages in that conversation, and multiple messages can be pinned simultaneously without an arbitrary low cap.
- **Encrypted Storage & Zero Plaintext**: Pinning a message stores only metadata linking the message identifier to the conversation; the message content itself remains end-to-end encrypted and is decrypted solely on authorized client devices.
- **Provided Icon Source**: The uploaded icon image (`media_1795109722000_fdc74632.png`, saved in the feature directory at `specs/004-privacy-blur-replies-pins/assets/app-icon-source.png`) serves as the canonical master artwork for generating all required application icon assets.
