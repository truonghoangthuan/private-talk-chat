# Bug Fix: Windows Taskbar Shows Solid Purple Square Instead of Custom App Icon

- **Slug**: taskbar-purple-icon
- **Fixed**: 2026-11-20T10:34:00+07:00
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Explicitly set Win32 `WM_SETICON` (`ICON_BIG` and `ICON_SMALL`) on the main `HWND` from embedded PE icon resource `32512` at startup, added an NSIS `POSTINSTALL` hook calling `SHChangeNotify(SHCNE_ASSOCCHANGED)` with installer/uninstaller icons, standardized `src-tauri/icons/icon.ico` (`planes = 1`, DIB frames for `16..128`, PNG for `256`), and added `cargo:rerun-if-changed=icons/icon.ico`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src-tauri/Cargo.toml` | modified | Added `Win32_System_LibraryLoader` feature to `windows` |
| `src-tauri/src/platform/taskbar.rs` | modified | Added `apply_main_window_icons` (`LoadImageW` resource `32512` with `LR_SHARED` + `WM_SETICON` for `ICON_BIG` and `ICON_SMALL`) |
| `src-tauri/src/lib.rs` | modified | Invoked `platform::taskbar::apply_main_window_icons` in Tauri `.setup` |
| `src-tauri/windows/nsis-hooks.nsh` | added | Added `NSIS_HOOK_POSTINSTALL` calling `shell32::SHChangeNotify(0x08000000, ...)` |
| `src-tauri/tauri.conf.json` | modified | Configured `bundle.windows.nsis` (`installerHooks`, `installerIcon`, `uninstallerIcon`) |
| `src-tauri/icons/icon.ico` | modified | Regenerated from `icons/icon.png` with `planes = 1`, DIB `16..128`, PNG `256` |
| `src-tauri/build.rs` | modified | Added `cargo:rerun-if-changed=icons/icon.ico` |
| `src-tauri/tests/ico_format_tests.rs` | added | Structural `.ico` validation test for header, planes, dimensions, and DIB/PNG payloads |

## Diff Highlights

```rust
// src-tauri/src/platform/taskbar.rs
let res_id = PCWSTR(32512usize as *const u16);
let load_and_set = |wparam: u32, cx_metric, cy_metric| {
    let cx = GetSystemMetrics(cx_metric);
    let cy = GetSystemMetrics(cy_metric);
    if let Ok(handle) = LoadImageW(hmod, res_id, IMAGE_ICON, cx, cy, LR_SHARED) {
        if !handle.is_invalid() {
            SendMessageW(
                hwnd,
                WM_SETICON,
                WPARAM(wparam as usize),
                LPARAM(handle.0 as isize),
            );
        }
    }
};
load_and_set(ICON_BIG, SM_CXICON, SM_CYICON);
load_and_set(ICON_SMALL, SM_CXSMICON, SM_CYSMICON);
```

## Tests Added or Updated

- `src-tauri/tests/ico_format_tests.rs::icon_ico_has_standard_planes_dimensions_and_payload_formats` — verifies `ICONDIR` header, `planes = 1`, square dimensions `16, 24, 32, 48, 64, 128, 256`, `BITMAPINFOHEADER` DIB payloads for `< 256`, and PNG payload for `256`.

## Local Verification

- Commands run:
  - `cargo test --manifest-path src-tauri/Cargo.toml` → passed (1 unit test + 17 integration tests across 6 test binaries, including `ico_format_tests`)
  - `npm run build` → passed (`tsc && vite build` clean)
  - PowerShell `System.Drawing.Icon("src-tauri\icons\icon.ico", 32, 32)` → decoded cleanly without pixel corruption
- Manual checks:
  - Not yet run: full NSIS installer build + in-place `v0.1.0` -> `v0.2.0` upgrade on Windows 11 without Explorer restart, and live `ITaskbarList3::SetOverlayIcon` unread badge check.

## Deviations from Assessment

- None.

## Follow-ups

- Build NSIS installer and verify in-place upgrade + live taskbar unread badge overlay via `/speckit-bug-test slug=taskbar-purple-icon`.
