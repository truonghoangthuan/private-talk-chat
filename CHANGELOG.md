# Changelog

All notable changes to Bloop are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

Entries below "## [Unreleased]" are added automatically by the recurring
autonomous dev job (branch prefix `auto/`), one line per merged PR, in the
form: `- <type>: <summary> (#<PR>)` with the originating issue noted when
applicable.

## [Unreleased]

- feat: add one-click copy-to-clipboard for message text on hover
- feat: rename app/installation display name from "Private Talk" to "Bloop" (issue #11) — product name, window/taskbar title, installer name, in-app UI text, README, and package.json updated. Internal Rust/Tauri implementation details (DPAPI session-storage folder, bundle identifier, crate name, crypto domain-separation strings, custom media protocol scheme) intentionally left as "PrivateTalk"/"privatetalk" for a follow-up once Rust changes can be compile-verified in this environment.
- feat: add a conversation filter/search box to the sidebar, matching against the resolved chat title and latest message preview
- feat: stop yanking the timeline to the bottom on new messages while scrolled up reading history; show a "N new messages" jump-to-latest button instead

## [0.2.1] - baseline
Baseline at the time autonomous development tracking began. See git history
(`git log`) for everything prior to this file's introduction.
