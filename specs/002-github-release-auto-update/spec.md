# Feature Specification: GitHub Release Distribution and In-App Auto-Update

**Feature Branch**: `002-github-release-auto-update`  
**Created**: 2026-11-19  
**Status**: Draft  
**Input**: User description: "I want to release this application on the Github Release page. And I want this app has a feature `Check for update` and `Update`, this will support the user not to download again when we release a new version in Github."

## Clarifications

### Session 2026-11-19

- Q: Where in the Private Talk window should users access the manual "Check for update" and "Update" controls, including before logging in? (FR-001) → A: Inside the existing Profile Settings modal, plus a compact update action on the left navigation rail and login screen.
- Q: How should a maintainer trigger the automated build, signing, and publication of a new version to GitHub Releases? (FR-007) → A: Pushing a semantic version git tag (`v*.*.*`, e.g., `v0.2.0`), with optional manual workflow trigger.
- Q: Which published GitHub Releases should the in-app updater check for and offer to end users? (FR-002) → A: Stable releases only (latest published non-draft, non-prerelease GitHub Release).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Check for Updates and Install In-App Update (Priority: P1)

An existing Private Talk desktop user clicks "Check for update" inside the application to see whether a newer version is available on GitHub Releases. When a newer version exists, the user views the new version number and release notes, clicks "Update", watches download progress, and upgrades the application in place without manually opening a browser or downloading an installer again.

**Why this priority**: Directly delivers the user-facing self-update capability that eliminates manual installer downloads when new versions are published, while preserving the user's local session and encrypted chat access.

**Independent Test**: Can be fully tested by running an older application version (e.g., `0.1.0`) configured against a published release of a newer version (e.g., `0.2.0`), triggering "Check for update", clicking "Update", and verifying the application verifies the package signature, installs the update, restarts into `0.2.0`, and retains the user's logged-in session.

**Acceptance Scenarios**:

1. **Given** a user running Private Talk when no newer release exists on GitHub Releases, **When** the user selects "Check for update", **Then** the application checks the release feed and displays a clear status confirming the application is already on the latest version.
2. **Given** a user running Private Talk when a newer signed release exists on GitHub Releases, **When** the user selects "Check for update", **Then** the application displays the available version number, release notes summary, and an actionable "Update" button.
3. **Given** an available update is displayed, **When** the user clicks "Update", **Then** the application downloads the update package with visible progress feedback, cryptographically verifies the package signature before installation, applies the update, and restarts into the new version with the user's existing account session and encrypted chat history intact.
4. **Given** a downloaded update package whose cryptographic signature or integrity verification fails, **When** the application validates the package prior to installation, **Then** the system fails closed, aborts the update, deletes the unverified package, logs no sensitive user secrets, and displays a clear security warning to the user.

---

### User Story 2 - First-Time Installation and Release Publication via GitHub Releases (Priority: P2)

A maintainer publishes a new version tag for Private Talk, and the release workflow automatically builds, cryptographically signs, and publishes the Windows desktop installer, update bundle, signature file, and update manifest to the project's GitHub Releases page so new users can download the installer and existing users can update in-app.

**Why this priority**: Establishes the trusted distribution source on GitHub Releases required for both first-time installations and the in-app updater feed.

**Independent Test**: Can be tested by publishing a versioned release tag, verifying that the GitHub Release page contains the Windows installer, signed update artifact, and update manifest metadata, and installing the application cleanly on a Windows machine from that release page.

**Acceptance Scenarios**:

1. **Given** a maintainer triggers a new version release, **When** the release pipeline completes, **Then** a GitHub Release entry is published containing the Windows desktop installer for new users, the signed update package, detached cryptographic signature data, and the update manifest for existing clients.
2. **Given** a release build fails automated tests or lacks a valid signing key, **When** the release workflow runs, **Then** the pipeline fails closed and prevents publishing an unsigned or unverified release artifact to GitHub Releases.
3. **Given** a new user visiting the project's GitHub Releases page, **When** the user downloads and runs the published Windows installer, **Then** Private Talk installs on Windows with its current version clearly visible in the application interface.

---

### User Story 3 - Automatic Startup Update Notification (Priority: P3)

When a user launches Private Talk, the application quietly checks for a newer published release in the background and, if one is found, shows a non-intrusive update banner or prompt allowing the user to trigger "Update" immediately or dismiss it until later.

**Why this priority**: Improves convenience and security adoption by informing users of new releases automatically without interrupting active conversations if they choose to defer.

**Independent Test**: Can be tested by launching an older version of Private Talk while a newer version is published on GitHub Releases and verifying a non-blocking update notification appears with options to update immediately or dismiss.

**Acceptance Scenarios**:

1. **Given** a newer version is available on GitHub Releases, **When** the user launches Private Talk, **Then** a non-intrusive update indicator appears offering the "Update" action without blocking login or ongoing chat usage.
2. **Given** the device is offline or GitHub Releases is unreachable during application startup, **When** the background startup check fails, **Then** the application continues normal operation silently without showing disruptive error dialogs, while manual "Check for update" still reports network errors clearly when explicitly invoked.

---

### Edge Cases

- **Tampered or unsigned release artifact**: If the update manifest or downloaded installer package on GitHub Releases has a missing, malformed, or invalid cryptographic signature, the application MUST fail closed, discard the download, refuse execution, and display a verification failure alert.
- **Network drop or interrupted download**: If the network connection drops while checking for updates or downloading an update package, the application cancels the partial download cleanly, leaves the current installation untouched, and allows the user to retry "Check for update" or "Update".
- **Downgrade / rollback protection**: If the remote release manifest reports a version equal to or older than the currently running version, the application treats the client as up to date and refuses to downgrade unless explicitly uninstalled by the user.
- **Local session and encrypted data preservation**: Upgrading from version `N` to `N+1` MUST NOT overwrite or invalidate the user's Windows-protected local session file or cryptographic keys.
- **Duplicate update clicks**: While an update check or download is already in progress, repeated clicks on "Check for update" or "Update" are prevented so concurrent installers cannot corrupt the installation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide an accessible "Check for update" and "Update" section inside the Profile Settings modal, as well as a compact update control on both the left navigation rail and the unauthenticated login screen, displaying the currently installed version and querying the official GitHub Releases update feed for newer versions.
- **FR-002**: System MUST query only the latest published stable GitHub Release (non-draft, non-prerelease), compare it against the currently running Semantic Version (`MAJOR.MINOR.PATCH`), and clearly inform the user either that the application is up to date or that a newer stable version is available (including target version number and release notes summary).
- **FR-003**: System MUST provide an "Update" action whenever a newer valid version is detected, allowing the user to download and apply the update directly from within the application without manually downloading an installer via a web browser.
- **FR-004**: System MUST display clear state feedback throughout the update lifecycle: idle, checking for updates, up to date, update available, downloading (with progress), installing/restarting, and error/verification failed.
- **FR-005**: System MUST cryptographically verify the authenticity and integrity of every downloaded update package against an embedded trusted public signing key before executing or applying any update, and MUST fail closed (aborting installation and removing downloaded bytes) if verification fails.
- **FR-006**: System MUST preserve the user's Windows-protected local session state, credentials, and encryption keys across in-app updates so users remain authenticated and retain full access to encrypted conversations after the application restarts into the updated version.
- **FR-007**: Project MUST include an automated release workflow triggered by pushing a semantic version git tag (`v*.*.*`, e.g., `v0.2.0`) or invoking a manual workflow dispatch, which runs automated tests, builds Windows release installers and update bundles, signs the update artifacts, generates the release update manifest, and publishes them to the repository's GitHub Releases page.
- **FR-008**: System MUST perform a non-blocking background update check on application startup and surface a non-intrusive update prompt when a newer version is available, while ignoring transient network failures during background checks so offline or restricted-network startup is unaffected.
- **FR-009**: System MUST NOT log or transmit user credentials, session tokens, cryptographic keys, or chat contents during update checks, downloads, or error reporting.

### Key Entities *(include if feature involves data)*

- **Release Package**: A versioned distribution published to GitHub Releases consisting of a Windows desktop installer for first-time installation, an in-app update bundle, and a detached cryptographic signature.
- **Update Manifest**: Published release metadata stored alongside the GitHub Release containing the latest semantic version identifier, publication timestamp, release notes summary, Windows download URL, and cryptographic signature string.
- **Client Update State**: The in-memory status of the running application's updater workflow, tracking current installed version, latest discovered version, release notes, download progress percentage, and any verification or network error message.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can manually check for updates and receive an accurate "Up to date" or "Update available" result within 5 seconds under normal broadband connectivity.
- **SC-002**: Users upgrading from an older version can complete an in-app update with a single click on "Update" and 0 manual browser downloads or external installer steps.
- **SC-003**: 100% of unsigned, corrupted, or tampered update packages or manifests are rejected prior to installation (fail-closed) and verified by automated negative tests.
- **SC-004**: 100% of active local user sessions and encrypted conversation histories remain intact and accessible immediately after an in-app update restarts the application.
- **SC-005**: Publishing a new version release tag produces a complete GitHub Release containing the Windows installer, signed update artifact, and update manifest without manual file uploads.

## Assumptions

- **Target Platform**: Windows 10 and Windows 11 (64-bit `x86_64`) desktop environments, matching Private Talk's Windows-native architecture.
- **Public GitHub Releases Feed**: Published releases and update manifests are hosted on a publicly reachable GitHub Releases endpoint over HTTPS so end-user clients do not need a personal GitHub access token to check for or download updates.
- **User-Confirmed Installation**: Updates are never silently installed mid-conversation without user consent; the user explicitly clicks "Update" to apply the downloaded release and restart the app.
- **Cryptographic Signing Key Management**: The private update-signing key is held exclusively by project maintainers in protected release secrets, while the corresponding public verification key is embedded in the application binary at build time.
