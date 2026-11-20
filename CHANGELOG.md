# Changelog

All notable changes to Bloop are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

Entries below "## [Unreleased]" are added automatically by the recurring
autonomous dev job (branch prefix `auto/`), one line per merged PR, in the
form: `- <type>: <summary> (#<PR>)` with the originating issue noted when
applicable.

## [Unreleased]

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
