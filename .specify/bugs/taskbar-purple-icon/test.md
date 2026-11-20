# Bug Verification: Windows Taskbar Shows Solid Purple Square Instead of Custom App Icon

- **Slug**: taskbar-purple-icon
- **Tested**: 2026-11-20T10:36:00+07:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

All automated unit/integration tests, TypeScript/Vite build, and `.ico` decoding checks pass, confirming `src-tauri/icons/icon.ico` has standard `planes = 1` DIB/PNG frames and the Rust/frontend codebase builds cleanly. However, the live Windows 11 reproduction (building the NSIS installer, upgrading `v0.1.0` in place without restarting `explorer.exe`, and visually verifying the taskbar icon and `ITaskbarList3::SetOverlayIcon` unread badge) was not executed, so the fix is marked `partial`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | Install `v0.1.0` -> upgrade in place with NSIS installer -> inspect Windows 11 taskbar & `SetOverlayIcon` | skipped | Expensive full `tauri build` + UAC install into `C:\Program Files\Bloop` + interactive GUI check not run |
| New / updated tests | `cargo test --manifest-path src-tauri/Cargo.toml` (`ico_format_tests`) | pass | `icon_ico_has_standard_planes_dimensions_and_payload_formats` passed |
| `.ico` decoder check | PowerShell `System.Drawing.Icon("src-tauri\icons\icon.ico", 32, 32)` | pass | `Size=32x32 TL=(0,0,0,0) Mid=(27,115,231,65)` |
| Regression suite | `cargo test --manifest-path src-tauri/Cargo.toml` | pass | 1 unit test + 17 integration tests across 6 binaries passed |
| Lint / type-check | `npm run build` | pass | `tsc && vite build` clean (`dist/` built in 4.95s) |

## Output Excerpts

```text
running 1 test
test icon_ico_has_standard_planes_dimensions_and_payload_formats ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

```text
Size=32x32 TL=(0,0,0,0) Mid=(27,115,231,65)
```

```text
✓ 1609 modules transformed.
✓ built in 4.95s
```

## Residual Risks

- Runtime `WM_SETICON` (`ICON_BIG` / `ICON_SMALL`) interaction with `ITaskbarList3::SetOverlayIcon` unread badge has not been visually verified in a live Windows 11 window.
- NSIS `NSIS_HOOK_POSTINSTALL` (`SHChangeNotify`) and `installerIcon` / `uninstallerIcon` have not been tested via an actual `npm run tauri build` + in-place `v0.1.0` -> `v0.2.0` upgrade.
- Pinned taskbar shortcuts (`User Pinned\TaskBar`) may still hold stale Explorer icon cache entries if pinned prior to upgrade.

## Recommendation

Hold — run `npm run tauri build`, upgrade `v0.1.0` in place with the generated NSIS installer on Windows 11 without restarting `explorer.exe`, and visually confirm the taskbar icon, Alt+Tab icon, and unread badge overlay before closing.
