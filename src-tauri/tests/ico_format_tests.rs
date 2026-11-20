use std::fs;
use std::path::PathBuf;

fn read_u16_le(buf: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([buf[offset], buf[offset + 1]])
}

fn read_u32_le(buf: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        buf[offset],
        buf[offset + 1],
        buf[offset + 2],
        buf[offset + 3],
    ])
}

#[test]
fn icon_ico_has_standard_planes_dimensions_and_payload_formats() {
    let icon_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/icon.ico");
    let data = fs::read(&icon_path).expect("icons/icon.ico should exist and be readable");

    assert!(data.len() >= 6, "ICO header too short");
    assert_eq!(read_u16_le(&data, 0), 0, "ICONDIR reserved must be 0");
    assert_eq!(read_u16_le(&data, 2), 1, "ICONDIR type must be 1 (icon)");

    let count = read_u16_le(&data, 4) as usize;
    let expected_dims = [16u32, 24, 32, 48, 64, 128, 256];
    assert_eq!(count, expected_dims.len(), "unexpected frame count");

    let mut actual_dims = Vec::with_capacity(count);
    for i in 0..count {
        let entry = 6 + i * 16;
        let w = if data[entry] == 0 { 256 } else { data[entry] as u32 };
        let h = if data[entry + 1] == 0 { 256 } else { data[entry + 1] as u32 };
        assert_eq!(w, h, "icon frame {i} must be square");

        let planes = read_u16_le(&data, entry + 4);
        assert_eq!(planes, 1, "icon frame {w}x{h} must have planes = 1");

        let size = read_u32_le(&data, entry + 8) as usize;
        let offset = read_u32_le(&data, entry + 12) as usize;
        assert!(offset + size <= data.len(), "frame {w}x{h} out of bounds");

        let payload = &data[offset..offset + size];
        if w < 256 {
            assert!(size >= 40, "DIB frame {w}x{h} too short");
            assert_eq!(read_u32_le(payload, 0), 40, "frame {w}x{h} must use BITMAPINFOHEADER");
            assert_eq!(read_u32_le(payload, 4), w, "DIB width mismatch");
            assert_eq!(read_u32_le(payload, 8), h * 2, "DIB height must be 2*h");
            assert_eq!(read_u16_le(payload, 12), 1, "DIB biPlanes must be 1");
        } else {
            assert!(
                payload.starts_with(b"\x89PNG\r\n\x1a\n"),
                "256x256 frame must be PNG-encoded"
            );
        }

        actual_dims.push(w);
    }

    assert_eq!(actual_dims, expected_dims);
}
