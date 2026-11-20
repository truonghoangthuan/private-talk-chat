# Changelog

All notable changes to Bloop are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

Entries below "## [Unreleased]" are added automatically by the recurring
autonomous dev job (branch prefix `auto/`), one line per merged PR, in the
form: `- <type>: <summary> (#<PR>)` with the originating issue noted when
applicable.

## [Unreleased]

- chore: add a dev-only Playwright screenshot harness (`harness.html`, `scripts/harness-main.tsx`, `scripts/screenshot-component.mjs` — `npm run screenshot`) for capturing before/after PNGs of a single component in isolation, to attach visual diffs to PRs. Not part of the shipped app build.
- fix: stop composer draft text from leaking between conversations when switching without sending; unsent drafts are now kept per-conversation and restored on return
- feat: show date context ("Yesterday", "Nov 18", or "Nov 18, 2025") ahead of the time on message bubbles once a message wasn't sent earlier today, so scrolling into older history no longer shows a bare, date-less `HH:MM` (issue #18)
- feat: show a soft character counter under the composer once a draft gets long (amber past 80% of a 4,000-char guidance limit, red past it), purely informational — sending is never blocked since no server-side text length cap is enforced (issue #20)

## [0.3.0] - 2026-11-20

- feat: add one-click copy-to-clipboard for message text on hover
- feat: rename app/installation display name from "Private Talk" to "Bloop" (issue #11) — product name, window/taskbar title, installer name, in-app UI text, README, and package.json updated. Internal Rust/Tauri implementation details (DPAPI session-storage folder, bundle identifier, crate name, crypto domain-separation strings, custom media protocol scheme) intentionally left as "PrivateTalk"/"privatetalk" for a follow-up once Rust changes can be compile-verified in this environment.
- feat: add a conversation filter/search box to the sidebar, matching against the resolved chat title and latest message preview
- feat: stop yanking the timeline to the bottom on new messages while scrolled up reading history; show a "N new messages" jump-to-latest button instead

## [0.2.1] - baseline
Baseline at the time autonomous development tracking began. See git history
(`git log`) for everything prior to this file's introduction.
