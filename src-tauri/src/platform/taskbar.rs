use tauri::{AppHandle, Runtime};

/// Formats the taskbar unread count (`1`..`99+`). Returns `None` when count is 0.
pub fn format_badge_label(unread_count: u32) -> Option<String> {
    if unread_count == 0 {
        None
    } else if unread_count > 99 {
        Some("99+".to_string())
    } else {
        Some(unread_count.to_string())
    }
}

/// Renders a 32x32 BGRA bitmap badge for Windows `ITaskbarList3::SetOverlayIcon`.
pub fn render_unread_badge_bgra(unread_count: u32) -> Option<[u8; 32 * 32 * 4]> {
    let label = format_badge_label(unread_count)?;
    let mut pixels = [0u8; 32 * 32 * 4];

    // Draw filled indigo-crimson circle (radius 15 centered at 15.5, 15.5).
    for y in 0..32i32 {
        for x in 0..32i32 {
            let dx = (x as f32) - 15.5;
            let dy = (y as f32) - 15.5;
            let dist = (dx * dx + dy * dy).sqrt();
            let idx = ((y * 32 + x) * 4) as usize;
            if dist <= 14.5 {
                // BGRA for #EF4444 (R=239, G=68, B=68)
                pixels[idx] = 68;
                pixels[idx + 1] = 68;
                pixels[idx + 2] = 239;
                pixels[idx + 3] = 255;
            } else if dist <= 15.5 {
                // White subtle border
                pixels[idx] = 255;
                pixels[idx + 1] = 255;
                pixels[idx + 2] = 255;
                pixels[idx + 3] = 220;
            }
        }
    }

    // Minimal 5x7 bitmap font for '0'..'9' and '+'.
    let chars: Vec<char> = label.chars().collect();
    let char_w = 5i32;
    let gap = 1i32;
    let total_w = (chars.len() as i32) * char_w + ((chars.len() as i32) - 1) * gap;
    let start_x = (32 - total_w) / 2;
    let start_y = (32 - 7) / 2;

    for (ci, ch) in chars.iter().enumerate() {
        let glyph = glyph_5x7(*ch);
        let gx = start_x + (ci as i32) * (char_w + gap);
        for (row, bits) in glyph.iter().enumerate() {
            for col in 0..5i32 {
                if (bits >> (4 - col)) & 1 == 1 {
                    let px = gx + col;
                    let py = start_y + (row as i32);
                    if (0..32).contains(&px) && (0..32).contains(&py) {
                        let idx = ((py * 32 + px) * 4) as usize;
                        pixels[idx] = 255;
                        pixels[idx + 1] = 255;
                        pixels[idx + 2] = 255;
                        pixels[idx + 3] = 255;
                    }
                }
            }
        }
    }

    Some(pixels)
}

fn glyph_5x7(ch: char) -> [u8; 7] {
    match ch {
        '0' => [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
        '1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        '2' => [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
        '3' => [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
        '4' => [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
        '5' => [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
        '6' => [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
        '7' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
        '8' => [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
        '9' => [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
        '+' => [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
        _ => [0; 7],
    }
}

#[cfg(windows)]
pub fn update_taskbar_unread_badge<R: Runtime>(app: &AppHandle<R>, unread_count: u32) {
    use tauri::Manager;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{ITaskbarList3, TaskbarList};
    use windows::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, DestroyIcon, HICON, ICONINFO};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd_raw = hwnd.0 as isize;

    let badge = render_unread_badge_bgra(unread_count);
    let label = format_badge_label(unread_count);

    let _ = window.run_on_main_thread(move || unsafe {
        let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);
        let com_init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if let Ok(taskbar) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_INPROC_SERVER) {
            let _ = taskbar.HrInit();
            match (badge, label) {
                (Some(bgra), Some(text)) => {
                    let hbm_color = CreateBitmap(32, 32, 1, 32, Some(bgra.as_ptr() as *const _));
                    let mask = [0u8; 32 * 4]; // 1bpp AND mask
                    let hbm_mask = CreateBitmap(32, 32, 1, 1, Some(mask.as_ptr() as *const _));

                    if !hbm_color.is_invalid() && !hbm_mask.is_invalid() {
                        let icon_info = ICONINFO {
                            fIcon: true.into(),
                            xHotspot: 0,
                            yHotspot: 0,
                            hbmMask: hbm_mask,
                            hbmColor: hbm_color,
                        };
                        if let Ok(hicon) = CreateIconIndirect(&icon_info) {
                            let desc: Vec<u16> = format!("{text} unread messages\0").encode_utf16().collect();
                            let _ = taskbar.SetOverlayIcon(hwnd, hicon, PCWSTR(desc.as_ptr()));
                            let _ = DestroyIcon(hicon);
                        }
                    }

                    if !hbm_color.is_invalid() {
                        let _ = DeleteObject(hbm_color);
                    }
                    if !hbm_mask.is_invalid() {
                        let _ = DeleteObject(hbm_mask);
                    }
                }
                _ => {
                    let _ = taskbar.SetOverlayIcon(hwnd, HICON::default(), PCWSTR::null());
                }
            }
        }
        if com_init.is_ok() {
            CoUninitialize();
        }
    });
}

#[cfg(not(windows))]
pub fn update_taskbar_unread_badge<R: Runtime>(_app: &AppHandle<R>, _unread_count: u32) {}

#[cfg(windows)]
pub fn apply_main_window_icons<R: Runtime>(app: &AppHandle<R>) {
    use tauri::Manager;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_SHARED,
        SM_CXICON, SM_CXSMICON, SM_CYICON, SM_CYSMICON, WM_SETICON,
    };

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd_raw = hwnd.0 as isize;

    let _ = window.run_on_main_thread(move || unsafe {
        let Ok(hmod) = GetModuleHandleW(None) else {
            return;
        };
        let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);
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
    });
}

#[cfg(not(windows))]
pub fn apply_main_window_icons<R: Runtime>(_app: &AppHandle<R>) {}
