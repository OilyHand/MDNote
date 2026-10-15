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
    /// The en-us family name (stored in settings and `.mdn` files).
    pub name: String,
    /// The Korean name, when the family has one (shown in the Korean UI).
    pub name_ko: Option<String>,
    pub monospaced: bool,
    pub has_hangul: bool,
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
            let (monospaced, has_hangul) = match font {
                Ok(font) => (
                    windows::core::Interface::cast::<IDWriteFont1>(&font)
                        .map(|f| f.IsMonospacedFont().as_bool())
                        .unwrap_or(false),
                    font.HasCharacter(HANGUL_GA)
                        .map(|b| b.as_bool())
                        .unwrap_or(false),
                ),
                Err(_) => (false, false),
            };
            families.push(FontFamily {
                name_ko: pick("ko-kr").filter(|ko| *ko != name),
                name,
                monospaced,
                has_hangul,
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
}
