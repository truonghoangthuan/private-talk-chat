# Bug Assessment: Windows Taskbar Shows Solid Purple Square Instead of Custom App Icon

- **Slug**: taskbar-purple-icon
- **Created**: 2026-11-20T09:53:00+07:00
- **Source**: pasted text (with user screenshot)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> "Besides that, the taskboard icon is wrong, it only show the square purple like this."

Screenshot (`media_1795141956805_608c1e26.png`) shows the running Windows 11 taskbar button for Bloop as a solid purple/indigo square (`RGB(99, 102, 241)` / `#6366F1`) instead of the custom blue emblem icon (`src-tauri/icons/icon.ico` / `src/assets/app-icon.png`).

## Symptom

When running Bloop (`v0.2.0`) on Windows 11, the Windows taskbar displays a solid `#6366F1` square (`v0.1.0`'s legacy placeholder icon) instead of the custom blue `P` keyhole/speech emblem added in commit `a606e93`. Expected behavior: the Windows taskbar, Alt+Tab switcher, and window chrome render the custom blue emblem sharply at all DPI scales.

## Reproduction

1. Install Bloop `v0.1.0` (whose `src-tauri/icons/icon.ico` in `a606e93~1` was a 32x32 solid `RGBA(99, 102, 241, 255)` `#6366F1` square) and run it so Windows Explorer caches its icon.
2. Upgrade in place by running `PrivateTalk_0.2.0_x64-setup.exe` (`v0.2.0`, installed at `C:\Program Files\Bloop\private-talk.exe` without restarting `explorer.exe`).
3. Launch Bloop (`C:\Program Files\Bloop\private-talk.exe`).
4. Inspect the Windows 11 taskbar button: it still renders the solid `#6366F1` square even though `private-talk.exe` embeds the new blue emblem in `RT_GROUP_ICON 32512`.

## Suspected Code Paths

- `src-tauri/src/lib.rs:64-112` — launches the main window via `tauri::Builder::default().run(...)` without a Windows `setup` hook to set `WM_SETICON` (`ICON_BIG` / `ICON_SMALL`) directly from the executable's `32512` icon resource.
  - Underlying Tauri/Tao behavior verified in local Cargo registry: `tao-0.37.3/src/platform_impl/windows/window.rs:1447-1452` registers `WNDCLASSEXW` with `hIcon = NULL` and `hIconSm = NULL`, and `window.rs:1237-1238` + `tauri-runtime-wry-2.12.5/src/lib.rs:1159-1163` only invoke `set_window_icon` (`WM_SETICON` with `IconType::Small`), never `set_taskbar_icon` (`IconType::Big`).
- `src-tauri/tauri.conf.json:27-34` — configures `"targets": ["nsis"]` with no `bundle.windows.nsis.installerHooks` to notify the Windows Shell (`SHChangeNotify`) on upgrade, and no `installerIcon` / `uninstallerIcon` (`C:\Program Files\Bloop\uninstall.exe` still uses the default NSIS icon).
- `src-tauri/icons/icon.ico` — non-standard ICO structure: all 6 frames (`16, 24, 32, 48, 64, 256`) have `planes = 0` and PNG-encoded payloads (standard ICO uses `planes = 1` and uncompressed BMP/DIB for sizes `< 256`, PNG only for `256x256`; `.NET System.Drawing.Icon` misdecodes the 32x32 entry as corrupted pixels `TL=(241,198,150,89)`). Also omits `128x128` (`specs/004-privacy-blur-replies-pins/tasks.md` T025).
- `src-tauri/build.rs:1-3` — calls only `tauri_build::build()`, which emits `cargo:rerun-if-changed` for `tauri.conf.json` (`tauri-build-2.7.6/src/lib.rs:692`) but not for `icons/icon.ico`, risking stale cached Windows resources on incremental local or CI builds (`.github/workflows/release.yml:80` caches `src-tauri/target/`).

## Root Cause Hypothesis

Confidence: **high**.

Forensic inspection of the installed machine confirms `C:\Program Files\Bloop\private-talk.exe` (`v0.2.0`, `LastWriteTime 2026-11-20 01:47`) already embeds the new blue `P` emblem in PE `RT_GROUP_ICON 32512` (verified via PE parsing, `LoadImageW`, `ExtractIconEx`, and `SHGetImageList`) and contains zero bytes of `v0.1.0`'s `#6366F1` icon. The solid `#6366F1` (`RGB(99, 102, 241)`) square in the screenshot is **pixel-for-pixel `v0.1.0`'s cached icon** (`git show a606e93~1:src-tauri/icons/icon.ico`) persisted by Windows Explorer (`explorer.exe` started `2026-11-20 08:15:39`, prior to the `08:49` `v0.2.0` install).

This happens because of two code/packaging gaps:
1. Tauri/Tao creates the Win32 window with `WNDCLASSEXW.hIcon = NULL` and never sends `WM_SETICON(ICON_BIG, ...)`, forcing the Windows 11 taskbar to rely on Explorer's cached shell/shortcut icon (`private-talk.exe` / `Bloop.lnk`) rather than an `HICON` on the window.
2. The NSIS installer does not trigger `SHChangeNotify(SHCNE_ASSOCCHANGED, ...)` after overwriting the executable/shortcut on upgrade, so Explorer keeps rendering `v0.1.0`'s cached `#6366F1` square until Explorer restarts or the icon cache invalidates.
3. Secondary hygiene issues (`icon.ico` having `planes = 0` + PNG payloads for `16..64px`, and missing `cargo:rerun-if-changed=icons/icon.ico` in `src-tauri/build.rs`) threaten compatibility with legacy Windows ICO decoders and incremental builds.

## Proposed Remediation

**Preferred**:
1. **Explicitly set `ICON_BIG` (and `ICON_SMALL`) on the Win32 main `HWND` in Rust**: In `src-tauri/src/lib.rs` `setup` (calling a small `#[cfg(windows)]` helper in `src-tauri/src/platform/`), load resource `32512` via `LoadImageW` (`IMAGE_ICON`, `SM_CXICON`x`SM_CYICON` for big and `SM_CXSMICON`x`SM_CYSMICON` for small, `LR_SHARED`) and send `WM_SETICON(ICON_BIG, ...)` / `WM_SETICON(ICON_SMALL, ...)`, ensuring the taskbar and Alt+Tab buttons always display the embedded `.exe` icon directly regardless of Explorer cache state.
2. **Invalidate Windows Shell icon cache during NSIS install/upgrade**: Add a minimal NSIS hook file (`src-tauri/windows/nsis-hooks.nsh`) wired via `bundle.windows.nsis.installerHooks` in `src-tauri/tauri.conf.json` with `!macro NSIS_HOOK_POSTINSTALL` calling `System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'` (`SHCNE_ASSOCCHANGED`), and set `installerIcon` / `uninstallerIcon` to `icons/icon.ico`.
3. **Standardize `src-tauri/icons/icon.ico` and `src-tauri/build.rs`**: Regenerate `src-tauri/icons/icon.ico` with `planes = 1`, BMP/DIB frames for `16, 24, 32, 48, 64, 128`, and PNG for `256`, and add `println!("cargo:rerun-if-changed=icons/icon.ico");` in `src-tauri/build.rs`.

**Alternatives**:
- *Explorer icon-cache refresh only (no Rust `WM_SETICON(ICON_BIG)`)*: Only fixes Start Menu/shortcut caching via NSIS `SHChangeNotify`, leaving `tao`'s missing `ICON_BIG` unaddressed for `tauri dev` and un-notified runs.
- *Manual user workaround*: Restarting Windows Explorer (`taskkill /f /im explorer.exe && start explorer.exe`) or clearing `%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db` clears the stale `v0.1.0` icon on the current machine, but does not prevent the bug for other users upgrading `v0.1.0` -> `v0.2.0` (or future icon updates).

**Files likely to change**:
- `src-tauri/src/lib.rs` (call Windows window-icon setup on `"main"` window)
- `src-tauri/src/platform/` (add small `#[cfg(windows)]` `apply_main_window_icons` helper, or place alongside `taskbar.rs`)
- `src-tauri/tauri.conf.json` + new `src-tauri/windows/nsis-hooks.nsh` (`bundle.windows.nsis.installerHooks`, `installerIcon`, `uninstallerIcon`)
- `src-tauri/icons/icon.ico` (standard BMP/DIB `<= 128` + PNG `256` with `planes = 1`)
- `src-tauri/build.rs` (`cargo:rerun-if-changed=icons/icon.ico`)

**Tests to add or update**:
- Structural `.ico` validation test (verifying `icon.ico` contains `planes = 1`, expected dimensions `16..256`, and DIB headers for frames `< 256` alongside PNG for `256`).
- Windows manual verification after fix: install `v0.1.0`, upgrade in place to patched build without manually restarting `explorer.exe`, verify taskbar button, Alt+Tab, Start Menu shortcut, and `ITaskbarList3` unread badge overlay all display the blue emblem cleanly.

## Risks & Considerations

- **Taskbar unread badge interaction**: `src-tauri/src/platform/taskbar.rs` uses `ITaskbarList3::SetOverlayIcon` on the main `HWND`. Setting `WM_SETICON(ICON_BIG)` with `LR_SHARED` must be tested alongside `SetOverlayIcon` to confirm the red numeric unread badge still renders cleanly on top of the updated taskbar icon.
- **Win32 handle lifetime**: Passing `LR_SHARED` to `LoadImageW` on the current module's resource `32512` ensures the OS owns the shared `HICON` for the lifetime of the process (must not call `DestroyIcon` on `LR_SHARED` handles).
- **Installer vs runtime scope**: On Windows 11, pinned taskbar shortcuts (if a user pins the app manually) may still require `SHChangeNotify` or unpin/repin if Windows caches pinned shortcut icons separately in `User Pinned\TaskBar`.

## Open Questions

- None.
