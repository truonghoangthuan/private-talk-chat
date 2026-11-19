# Feature Specification: Private Talk Windows Chat Application

**Feature Branch**: `001-private-talk-chat`  
**Created**: 2026-11-19  
**Status**: Draft  
**Input**: User description: "Build `Private Talk`, a Windows chat app where the users can chat 1-to-1 or group chat like Microsoft Teams, or Facebook Messenger. - User can login or create new account by username and password. - User have to find other user account by their username to add their contact and able to chat or add them to a group chat. - User can upload their avatar, change display name. - User can send image, gif, video also. - User can create a group chat, edit group chat name, leave group chat, the host of the group chat can remove other members from the group. - User can edit or remove their sent message. - The application must support fully Windows notification, show number of new message on the taskbar icon. - The messages of the chats must be encrypted."

## Clarifications

### Session 2026-11-19

- Q: How should a user's private encryption keys be stored and recovered across logins? (FR-014) → A: Derive a password-based wrapping key (Argon2id/PBKDF2) to encrypt private key backups on the server, and cache active keys locally in Windows DPAPI.
- Q: Who can add new members to an existing group chat after creation, and can newly added members decrypt earlier group messages? (FR-007) → A: Any current group member can add their contacts to the group, and newly added members receive historical group keys so they can view all past and future messages.
- Q: When User A adds User B as a contact and starts a 1-to-1 chat, how does the chat work for User B if User B has not added User A yet? (FR-003) → A: Adding a user by username establishes a mutual contact relationship immediately so both users appear in each other's contact lists and can chat freely.
- Q: Should username search require an exact username match or allow partial prefix matching? (FR-002) → A: Exact case-insensitive username match only.
- Q: When a sender removes a message, should it disappear completely from the conversation timeline or leave a "Message removed" placeholder? (FR-010) → A: Permanently wipe the encrypted message body and media attachment, and display a "Message removed" placeholder in the chat timeline.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Account Registration, Login, and Profile Setup (Priority: P1)

A new or returning user opens Private Talk on Windows, creates an account with a unique username and password (or logs into an existing account), sets or updates their display name, and uploads an avatar image so contacts can recognize them.

**Why this priority**: Authentication, cryptographic identity initialization, and basic user identity are prerequisites for all contact discovery and messaging capabilities.

**Independent Test**: Can be fully tested by registering a new account, logging out, logging back in with the username and password, updating the display name and avatar, and verifying the updated profile persists across application restarts.

**Acceptance Scenarios**:

1. **Given** an unauthenticated user on the welcome screen, **When** the user submits a valid unused username and password, **Then** the system creates the account, initializes the user's encryption identity in Windows-protected storage, and signs the user in.
2. **Given** a registered user on the login screen, **When** the user enters valid credentials, **Then** the system authenticates the user and restores their encrypted local session.
3. **Given** an authenticated user in profile settings, **When** the user changes their display name and uploads a valid avatar image, **Then** the updated display name and avatar are saved and displayed to the user and their contacts.
4. **Given** an unauthenticated user, **When** the user attempts to register with an already-taken username or log in with an incorrect password, **Then** the system rejects the request with a clear error message and does not expose sensitive details.

---

### User Story 2 - Contact Discovery and Encrypted 1-to-1 Text & Media Messaging (Priority: P1)

An authenticated user searches for another user by username, adds them to their contact list, opens a 1-to-1 conversation, and exchanges end-to-end encrypted text messages, static images, animated GIFs, and videos.

**Why this priority**: Core value proposition of Private Talk—private, encrypted 1-to-1 communication with rich media after explicit contact discovery.

**Independent Test**: Can be tested with two accounts by having User A find User B by username, add User B as a contact, and send text, an image, a GIF, and a video to User B, verifying User B receives and views each item and that stored/transmitted payloads remain encrypted.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** the user searches for an existing username and selects "Add Contact", **Then** the target user is added to the user's contact list and becomes eligible for 1-to-1 and group chats.
2. **Given** two users where one has not yet added the other as a contact, **When** the user attempts to start a chat or add the non-contact to a group, **Then** the system requires adding the user as a contact by username first.
3. **Given** an active 1-to-1 chat with a contact, **When** the sender sends a text message, image, GIF, or video, **Then** the payload is encrypted on the sender's device before transmission and decrypted for display on the recipient's device.
4. **Given** an incoming message or attachment whose cryptographic signature or integrity check fails, **When** the recipient device processes the payload, **Then** the system fails closed, blocks rendering of the corrupted payload, and displays a clear security warning.

---

### User Story 3 - Group Chat Creation, Messaging, and Host Membership Control (Priority: P2)

An authenticated user creates a group chat with one or more contacts, exchanges encrypted messages and media with the group, renames the group, or leaves the group. The user who created the group (the group host) can remove other members from the group.

**Why this priority**: Enables multi-party collaboration alongside 1-to-1 chat, fulfilling the core group chat requirement.

**Independent Test**: Can be tested with three accounts where User A creates a group with Contacts B and C, all three exchange encrypted messages/media, a member renames the group, Host A removes Member C (verifying C no longer receives new messages), and Member B leaves the group.

**Acceptance Scenarios**:

1. **Given** an authenticated user with contacts, **When** the user creates a group chat with a group name and selected contacts, **Then** the group chat is created with the creator assigned as the group host and all selected contacts added as members.
2. **Given** an active group chat, **When** any current member sends a text message, image, GIF, or video, edits the group chat name, or adds a contact from their contact list to the group, **Then** all current group members receive the encrypted message/media or updated group state, and any newly added member receives prior group keys to decrypt and view full group message history.
3. **Given** a group chat, **When** the group host removes a member from the group, **Then** the removed member is revoked from the group roster, group encryption keys are rotated so the removed member cannot decrypt subsequent messages, and remaining members see the updated member list.
4. **Given** a group chat, **When** a non-host member attempts to remove another member, **Then** the system denies the action.
5. **Given** a group chat, **When** a member chooses to leave the group, **Then** the member is removed from active participation, group keys rotate for remaining members, and the user no longer receives new messages from that group.

---

### User Story 4 - Editing and Removing Sent Messages (Priority: P2)

An authenticated user who sent a message in a 1-to-1 or group chat edits the text of their sent message to fix a mistake, or removes their sent message so it is no longer visible in the conversation.

**Why this priority**: Standard modern messaging control expected in Teams/Messenger-style chat applications.

**Independent Test**: Can be tested by sending a message in a chat, editing its content and verifying the updated content and "edited" indicator appear for all participants, then removing a sent message and verifying it is removed for all participants.

**Acceptance Scenarios**:

1. **Given** a message previously sent by the current user, **When** the user edits the message text and saves, **Then** the updated encrypted message replaces the original text for all conversation participants and displays an "Edited" indicator.
2. **Given** a text or media message previously sent by the current user, **When** the user selects to remove the message, **Then** the encrypted message payload, any associated media attachment, and local decrypted cache are permanently wiped for all participants, and a "Message removed" placeholder is displayed in the conversation timeline.
3. **Given** a message sent by another participant, **When** the current user views message actions, **Then** the user cannot edit or remove the other participant's message.

---

### User Story 5 - Windows Notifications and Taskbar Unread Badge (Priority: P3)

When a user receives new messages while Private Talk is minimized, in the background, or focused on a different conversation, Windows displays native desktop notifications and updates the numeric unread message badge on the Windows taskbar icon.

**Why this priority**: Essential desktop user experience feature explicitly requested for Windows integration.

**Independent Test**: Can be tested by minimizing the application on Windows, sending 3 messages from another account, verifying 3 Windows toast notifications fire and the taskbar icon badge displays "3", then opening the conversation and verifying the taskbar badge clears.

**Acceptance Scenarios**:

1. **Given** Private Talk is running on Windows and minimized or unfocused, **When** a new message arrives in a 1-to-1 or group chat, **Then** the system triggers a native Windows notification without writing plaintext secrets to persistent logs.
2. **Given** a Windows notification for an incoming message, **When** the user clicks the notification, **Then** Private Talk brings its main window to the foreground and opens the corresponding chat conversation.
3. **Given** one or more unread messages across chats, **When** new messages arrive or are read, **Then** the Windows taskbar application icon displays an accurate badge with the total number of unread messages (and clears the badge when unread count reaches zero).

---

### Edge Cases

- **Host leaves group chat**: If the group host leaves a group chat that still has other members, host privileges transfer automatically to the longest-standing remaining member; if the last member leaves, the group chat is closed.
- **Invalid or oversized media uploads**: If a user selects an unsupported file format or a file exceeding the maximum allowed size (5 MB for avatars, 50 MB for chat images/GIFs/videos), the application blocks the upload before encryption/transmission and shows a clear size/format error.
- **Tampered or undecryptable messages**: If a message or attachment fails authenticated decryption or signature verification, the application fails closed, refuses to render the content, logs no sensitive data, and alerts the user in the chat view.
- **Edit/remove race or offline recipient**: If a sender edits or removes a message while a recipient is offline, the edit or removal instruction is applied as soon as the recipient reconnects so deleted content does not remain visible.
- **Removing a contact or non-existent username search**: Searching for a username that does not exist returns an explicit "No user found" state; users cannot add themselves as a contact.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to create a new account using a unique username and password, and authenticate returning users with their username and password.
- **FR-002**: System MUST allow authenticated users to search for other registered accounts by exact case-insensitive username match and add them to their contact list, immediately establishing a mutual contact relationship for both users.
- **FR-003**: System MUST restrict initiating 1-to-1 chats and adding members to group chats exclusively to users who have been added to the actor's contact list.
- **FR-004**: System MUST allow authenticated users to change their display name and upload or replace their profile avatar image.
- **FR-005**: System MUST support real-time 1-to-1 chat conversations and multi-user group chat conversations with instant real-time message delivery, live typing indicators, online presence status ("who is online"), and per-message seen receipts ("who has seen each message").
- **FR-006**: System MUST allow users in 1-to-1 and group chats to send and receive text messages, static images, animated GIFs, and video files.
- **FR-007**: System MUST allow any user to create a group chat with a custom name and selected contacts, automatically assigning the creator as the group host.
- **FR-008**: System MUST allow any current group chat participant to add contacts from their contact list to the group, edit the group chat name, and leave the group chat at any time; newly added members MUST receive the group's historical encryption keys so they can view all previous and future group messages.
- **FR-009**: System MUST allow only the group chat host to remove other members from the group chat, immediately revoking the removed member's access to future group messages.
- **FR-010**: System MUST allow users to edit the text of their own sent messages (marking them as edited for all participants) and remove their own sent messages (text or media) for all participants by permanently wiping the encrypted payload and media attachment while displaying a "Message removed" placeholder in the timeline.
- **FR-011**: System MUST display native Windows notifications for incoming messages when the target conversation is not actively focused, and bring the conversation into focus when the notification is clicked.
- **FR-012**: System MUST display and dynamically update a numeric badge on the Windows taskbar icon showing the total count of unread messages across all conversations, clearing the badge when all messages are read.
- **FR-013**: System MUST end-to-end encrypt all chat messages and media attachments (images, GIFs, videos) on the sender's device before transmission so that payloads remain encrypted in transit and at rest, using vetted authenticated encryption primitives.
- **FR-014**: System MUST store active cryptographic keys, credentials, and session secrets within Windows-native user-isolated protected storage boundaries (Windows DPAPI), wrap private key backups with a password-derived key (e.g., Argon2id/PBKDF2) for cross-login recovery without server exposure, and NEVER write plaintext messages, keys, or secrets to logs, crash dumps, or world-readable temporary directories.
- **FR-015**: System MUST rotate group encryption keys whenever a member leaves or is removed from a group chat, and MUST fail closed with a user-visible warning if any message or attachment fails cryptographic verification.
- **FR-016**: System MUST display real-time online/offline presence indicators for contacts and conversation participants, real-time typing indicators when participants are composing a message, and seen receipts recording and showing which participants have viewed each message.
- **FR-017**: System MUST present a modern, clean, minimal, premium, and aesthetic user interface with consistent spacing, refined typography, smooth transitions, and distraction-free visual hierarchy.

### Key Entities *(include if feature involves data)*

- **User Account**: Represents a registered user, holding a unique immutable username, password verifier, mutable display name, encrypted/authenticated avatar reference, public cryptographic identity keys, and password-wrapped private key backup blob.
- **Contact Entry**: Represents a mutual relationship established when one user discovers another user by username and adds them as a contact, enabling both users to initiate 1-to-1 chats and add each other to group chats.
- **Conversation**: Represents either a 1-to-1 chat between two users or a Group Chat with a mutable group name, a designated Host (User Account), a member roster, and conversation key state.
- **Message**: Represents a unit of communication within a Conversation, containing sender identity, timestamp, encrypted body/payload, edit status ("original" or "edited" with timestamp), deletion status, and per-user read/unread state.
- **Media Attachment**: Represents an encrypted image, GIF, or video associated with a Message, including media type metadata, encrypted binary content, and integrity authentication tag.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete new account creation, login, and profile setup (display name + avatar upload) in under 2 minutes.
- **SC-002**: Exact case-insensitive username search returns the matching contact result in under 1 second.
- **SC-003**: 95% of text messages in active 1-to-1 and group chats are delivered, decrypted, and displayed to online recipients in under 1 second.
- **SC-004**: Windows desktop notifications and taskbar unread badge counts update within 1 second of message arrival or conversation read state change with 100% count accuracy.
- **SC-005**: 100% of transmitted and persisted message payloads and media attachments are encrypted client-side prior to transmission, with 0 bytes of plaintext message content, keys, or credentials exposed on the server, in transit, or in application logs.
- **SC-006**: 100% of tampered, unauthenticated, or post-removal group messages are rejected by the client (fail-closed) and verified by automated negative security tests.

## Assumptions

- **Target Environment**: Supported modern Windows 10 and Windows 11 desktop environments with native notification and taskbar overlay/badge support.
- **Contact Addition Model**: Finding a user by username and clicking "Add Contact" immediately establishes a mutual contact relationship on both users' contact lists so chatting and group creation can proceed without an approval queue.
- **Host Succession**: When a group host leaves a group chat with remaining members, host ownership automatically transfers to the earliest-joined remaining member rather than dissolving the group for everyone.
- **Media Constraints**: Standard formats are supported (`PNG`, `JPG`, `WEBP` up to 5 MB for avatars; `PNG`, `JPG`, `WEBP`, `GIF`, `MP4`, `WEBM` up to 50 MB for chat attachments) to prevent memory exhaustion during client-side encryption and decryption.
- **Notification Privacy**: Windows notifications show sender/group name and message preview by default while never persisting notification text to diagnostic logs.
