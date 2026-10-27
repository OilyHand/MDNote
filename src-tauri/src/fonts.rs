//! The installed font families, read through DirectWrite (O3; spike 4).
//!
//! The legacy system font collection already includes fonts installed for the
//! current user only, and its family names are the ones CSS `font-family`
//! accepts in WebView2. The list is built once (about 35 ms) and cached; the
//! font picker's Refresh asks DirectWrite to look for newly installed fonts.

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;
use windows::Win32::Graphics::DirectWrite::*;

use crate::AppState;
use crate::error::{AppError, AppResult};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    /// The en-us family name (stored in settings and `.mdmeta` files).
    pub name: String,
    /// The Korean name, when the family has one (shown in the Korean UI).
    pub name_ko: Option<String>,
    pub monospaced: bool,
    pub has_hangul: bool,
    /// The font's single line height as a multiple of its size: Word's
    /// "Single" line spacing (O4).
    pub line_height: f32,
}

/// When a font reports no usable metrics.
const DEFAULT_LINE_HEIGHT: f32 = 1.2;

const fn table_tag(tag: &[u8; 4]) -> u32 {
    u32::from_le_bytes(*tag)
}

/// The OpenType table `tag` of a font, copied out.
fn font_table(face: &IDWriteFontFace, tag: &[u8; 4]) -> Option<Vec<u8>> {
    let mut data = std::ptr::null_mut();
    let mut size = 0u32;
    let mut context = std::ptr::null_mut();
    let mut exists = windows::core::BOOL::default();
    // SAFETY: DirectWrite fills the pointers; the table is copied before it is released.
    unsafe {
        face.TryGetFontTable(
            table_tag(tag),
            &mut data,
            &mut size,
            &mut context,
            &mut exists,
        )
        .ok()?;
        if !exists.as_bool() || data.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(data as *const u8, size as usize).to_vec();
        face.ReleaseFontTable(context);
        Some(bytes)
    }
}

fn read_u16(table: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes([
        *table.get(offset)?,
        *table.get(offset + 1)?,
    ]))
}

/// Japanese, Chinese and Korean code pages in OS/2 `ulCodePageRange1` (bits 17-21).
const EAST_ASIAN_CODE_PAGES: u32 = 0b1_1111 << 17;

/// Word's single line height as a multiple of the font size, measured in Word
/// 365 for many fonts: for most fonts, GDI's height (the Windows ascent and
/// descent, plus the "external leading" the line gap adds beyond them); for
/// East Asian fonts, 1.3 times the Windows ascent and descent. So Segoe UI is
/// 1.331, Arial 1.150, Malgun Gothic 1.729 and Gulim 1.300, and Korean text in
/// Word is spaced much wider than DirectWrite's metrics (1.33) suggest.
fn word_line_height(font: &IDWriteFont) -> Option<f32> {
    // SAFETY: a plain COM call on a font object owned by the caller.
    let face = unsafe { font.CreateFontFace() }.ok()?;
    let head = font_table(&face, b"head")?;
    let hhea = font_table(&face, b"hhea")?;
    let os2 = font_table(&face, b"OS/2")?;
    let units = read_u16(&head, 18)? as f32;
    let ascender = read_u16(&hhea, 4)? as i16 as f32;
    let descender = read_u16(&hhea, 6)? as i16 as f32;
    let line_gap = read_u16(&hhea, 8)? as i16 as f32;
    let win_ascent = read_u16(&os2, 74)? as f32;
    let win_descent = read_u16(&os2, 76)? as f32;
    let win_height = win_ascent + win_descent;
    // Version 0 OS/2 tables have no code page bits.
    let code_pages = match (read_u16(&os2, 78), read_u16(&os2, 80)) {
        (Some(high), Some(low)) => ((high as u32) << 16) | low as u32,
        _ => 0,
    };
    let height = if code_pages & EAST_ASIAN_CODE_PAGES != 0 {
        1.3 * win_height
    } else {
        win_height + (line_gap - (win_height - (ascender - descender))).max(0.0)
    };
    let ratio = height / units;
    (0.5..=4.0)
        .contains(&ratio)
        .then(|| (ratio * 1000.0).round() / 1000.0)
}

fn line_height(font: &IDWriteFont) -> f32 {
    word_line_height(font).unwrap_or(DEFAULT_LINE_HEIGHT)
}

#[derive(Default)]
pub struct FontCache(Mutex<Option<Vec<FontFamily>>>);

const HANGUL_GA: u32 = 0xAC00;

/// All (locale, string) pairs of a localized-strings object.
unsafe fn strings(list: &IDWriteLocalizedStrings) -> windows::core::Result<Vec<(String, String)>> {
    let mut out = Vec::new();
    unsafe {
        for i in 0..list.GetCount() {
            let locale_len = list.GetLocaleNameLength(i)? as usize;
            let mut locale = vec![0u16; locale_len + 1];
            list.GetLocaleName(i, &mut locale)?;
            let len = list.GetStringLength(i)? as usize;
            let mut value = vec![0u16; len + 1];
            list.GetString(i, &mut value)?;
            out.push((
                String::from_utf16_lossy(&locale[..locale_len]).to_lowercase(),
                String::from_utf16_lossy(&value[..len]),
            ));
        }
    }
    Ok(out)
}

fn read_fonts(check_for_updates: bool) -> AppResult<Vec<FontFamily>> {
    let error = |e: windows::core::Error| AppError::Internal(format!("DirectWrite: {e}"));
    // SAFETY: plain COM calls on objects owned by this function.
    unsafe {
        let factory: IDWriteFactory =
            DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).map_err(error)?;
        let mut collection: Option<IDWriteFontCollection> = None;
        factory
            .GetSystemFontCollection(&mut collection, check_for_updates)
            .map_err(error)?;
        let collection =
            collection.ok_or_else(|| AppError::Internal("no font collection".into()))?;

        let mut families = Vec::new();
        for i in 0..collection.GetFontFamilyCount() {
            let Ok(family) = collection.GetFontFamily(i) else {
                continue;
            };
            let Ok(names) = family.GetFamilyNames().and_then(|n| strings(&n)) else {
                continue;
            };
            let pick = |locale: &str| {
                names
                    .iter()
                    .find(|(l, _)| l == locale)
                    .map(|(_, n)| n.clone())
            };
            let Some(name) = pick("en-us").or_else(|| names.first().map(|(_, n)| n.clone())) else {
                continue;
            };
            let font = family.GetFirstMatchingFont(
                DWRITE_FONT_WEIGHT_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                DWRITE_FONT_STYLE_NORMAL,
            );
            let (monospaced, has_hangul, line_height) = match font {
                Ok(font) => (
                    windows::core::Interface::cast::<IDWriteFont1>(&font)
                        .map(|f| f.IsMonospacedFont().as_bool())
                        .unwrap_or(false),
                    font.HasCharacter(HANGUL_GA)
                        .map(|b| b.as_bool())
                        .unwrap_or(false),
                    line_height(&font),
                ),
                Err(_) => (false, false, DEFAULT_LINE_HEIGHT),
            };
            families.push(FontFamily {
                name_ko: pick("ko-kr").filter(|ko| *ko != name),
                name,
                monospaced,
                has_hangul,
                line_height,
            });
        }
        families.sort_by_key(|f| f.name.to_lowercase());
        families.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
        Ok(families)
    }
}

/// The installed font families. `refresh` looks for fonts installed since the last call.
#[tauri::command]
pub async fn list_fonts(state: State<'_, AppState>, refresh: bool) -> AppResult<Vec<FontFamily>> {
    let mut cache = state.fonts.0.lock().unwrap();
    if refresh || cache.is_none() {
        *cache = Some(read_fonts(refresh)?);
    }
    Ok(cache.clone().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_well_known_windows_fonts() {
        let fonts = read_fonts(false).unwrap();
        let consolas = fonts
            .iter()
            .find(|f| f.name == "Consolas")
            .expect("Consolas");
        assert!(consolas.monospaced);
        let malgun = fonts
            .iter()
            .find(|f| f.name == "Malgun Gothic")
            .expect("Malgun Gothic");
        assert_eq!(malgun.name_ko.as_deref(), Some("맑은 고딕"));
        assert!(malgun.has_hangul);
    }

    #[test]
    fn single_lines_match_word() {
        // Measured in Word 365 (single line spacing, 20 pt, average gap between lines).
        let measured = [
            ("Segoe UI", 1.331),
            ("Calibri", 1.222),
            ("Cambria", 1.172),
            ("Consolas", 1.170),
            ("Arial", 1.150),
            ("Times New Roman", 1.150),
            ("Malgun Gothic", 1.729),
            ("Gulim", 1.300),
            ("Batang", 1.300),
            ("Microsoft YaHei", 1.715),
        ];
        let fonts = read_fonts(false).unwrap();
        for (name, word) in measured {
            // Fonts from Windows' optional language packs may be missing.
            let Some(font) = fonts.iter().find(|f| f.name == name) else {
                continue;
            };
            assert!(
                (font.line_height - word).abs() < 0.01,
                "{name}: {} (Word {word})",
                font.line_height
            );
        }
    }
}
