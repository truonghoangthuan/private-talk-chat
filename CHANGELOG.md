# Changelog

All notable changes to Bloop are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

Entries below "## [Unreleased]" are added automatically by the recurring
autonomous dev job (branch prefix `auto/`), one line per merged PR, in the
form: `- <type>: <summary> (#<PR>)` with the originating issue noted when
applicable.

## [Unreleased]

- feat: show a network connectivity banner — a persistent "You're offline" warning while `navigator.onLine` is false (sends/realtime silently stop working otherwise with no explanation), and a brief auto-dismissing "Back online — you were offline for \<duration\>" confirmation on reconnect, via a new pure `formatOfflineDuration` helper. Client-side only (issue #46)
- feat: show the full weekday/date/time (e.g. `Thursday, November 20, 2025 at 2:32:45 PM`) as a native hover tooltip on message bubble timestamps — including the verification-failed and removed-message timestamp lines — so the exact second and full date are available on demand without adding always-visible chrome to the compact `HH:MM`/"Yesterday" label. Client-side only, pure `formatFullMessageTimestamp` helper (issue #44)
- feat: reflect the total unread message count in the window/document title (e.g. `(3) Bloop`, reverting to plain `Bloop` once everything is read) via a new pure `computeDocumentTitle` helper, so there's a way to tell at a glance whether anything new has arrived while the app is minimized, behind other windows, or just unfocused — matching the Slack/Discord/Gmail tab-title convention. Client-side only (issue #42)

- feat: auto-link `http(s)://` URLs inside message text as real, clickable anchors (underlined, opens in a new tab, `rel="noopener noreferrer"`) instead of rendering them as inert plain text — trailing sentence punctuation and wrapping parens are kept out of the link. Client-side only, pure-function text segmentation (`splitMessageTextIntoLinkSegments`), no `dangerouslySetInnerHTML` (issue #39)
- feat: show an inline "New messages" divider in the timeline, anchored above the first message that was unread when the conversation was opened (Slack/Discord-style), so the viewer knows exactly where to start reading instead of only seeing a sidebar unread badge. Client-side only, snapshotting `unread_count` before it's reset by marking messages seen (issue #37)
- fix: message editing now uses an auto-growing textarea (Shift+Enter for a newline, Enter to save) instead of a single-line text input, so multi-line messages can actually be edited without losing their line breaks (issue #35)
- feat: add in-conversation message search — a search icon in the chat header opens an inline bar that filters the currently-loaded message history by text, shows an `N of M` match counter, and steps through matches with the up/down buttons or Enter/Shift+Enter/Arrow keys, jumping to and highlighting each one the same way "jump to pinned message" already does. Client-side only, matching against already-loaded messages — no new backend search endpoint (issue #33)
- feat: the composer is now a drag-and-drop target for attachments — dragging a file from the OS file explorer over it shows a dashed-border highlight, and dropping it stages the file exactly like the paperclip picker (same MIME/size validation, now shared via a new `validateAttachmentFile` helper instead of being duplicated) (issue #31)
- feat: the staged attachment chip in the composer now shows a real thumbnail for images (generated client-side, never touching Tauri IPC) and a generic file/video icon badge otherwise, instead of just a bare filename — makes it easier to confirm the right file is about to be sent before it's encrypted (issue #29)
- feat: clicking an image attachment now opens a full-screen lightbox (Escape, close button, or backdrop click to dismiss) so the full, uncropped image can be viewed instead of the cropped `max-h-72` inline thumbnail; videos are unchanged since `<video controls>` already has native fullscreen (issue #27)
- feat: pressing Escape now also cancels an in-progress message edit, or dismisses a pending "Confirm remove" prompt, without needing the mouse — same convention as the composer's reply/attachment Escape handling (issue #25)
- feat: pressing Escape in the composer now cancels an active reply (or clears a staged attachment if no reply is active) without needing the mouse, matching Slack/Discord/Telegram conventions (issue #22)
- chore: add a dev-only Playwright screenshot harness (`harness.html`, `scripts/harness-main.tsx`, `scripts/screenshot-component.mjs` — `npm run screenshot`) for capturing before/after PNGs of a single component in isolation, to attach visual diffs to PRs. Not part of the shipped app build.
- fix: stop composer draft text from leaking between conversations when switching without sending; unsent drafts are now kept per-conversation and restored on return
- feat: show date context ("Yesterday", "Nov 18", or "Nov 18, 2025") ahead of the time on message bubbles once a message wasn't sent earlier today, so scrolling into older history no longer shows a bare, date-less `HH:MM` (issue #18)
- feat: show a soft character counter under the composer once a draft gets long (amber past 80% of a 4,000-char guidance limit, red past it), purely informational — sending is never blocked since no server-side text length cap is enforced (issue #20)
- test: add a frontend e2e suite (Playwright + `@tauri-apps/api` mocked via a Vite alias, `npm run test:e2e`) covering login/register, conversation switching, message send, and per-conversation draft persistence against the real `App.tsx`/component tree. No Rust toolchain was available to drive the actual compiled Tauri app, so this exercises the frontend only.

## [0.3.0] - 2026-11-20

- feat: add one-click copy-to-clipboard for message text on hover
- feat: rename app/installation display name from "Private Talk" to "Bloop" (issue #11) — product name, window/taskbar title, installer name, in-app UI text, README, and package.json updated. Internal Rust/Tauri implementation details (DPAPI session-storage folder, bundle identifier, crate name, crypto domain-separation strings, custom media protocol scheme) intentionally left as "PrivateTalk"/"privatetalk" for a follow-up once Rust changes can be compile-verified in this environment.
- feat: add a conversation filter/search box to the sidebar, matching against the resolved chat title and latest message preview
- feat: stop yanking the timeline to the bottom on new messages while scrolled up reading history; show a "N new messages" jump-to-latest button instead

## [0.2.1] - baseline
Baseline at the time autonomous development tracking began. See git history
(`git log`) for everything prior to this file's introduction.
