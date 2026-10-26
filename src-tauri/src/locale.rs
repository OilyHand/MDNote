//! Facts about the user's Windows language and region settings.

use windows::Win32::Globalization::{GetLocaleInfoEx, LOCALE_IMEASURE, LOCALE_IPAPERSIZE};
use windows::core::PCWSTR;

const LANG_KOREAN: u16 = 0x12;

/// "ko" if Windows' display language is Korean, "en" otherwise (O11).
pub fn windows_ui_language() -> &'static str {
    // SAFETY: GetUserDefaultUILanguage has no preconditions.
    let langid = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
    // The low 10 bits of a LANGID are the primary language.
    if langid & 0x3FF == LANG_KOREAN {
        "ko"
    } else {
        "en"
    }
}

/// A value of the user's region settings (Settings > Time & language > Region).
fn region_value(kind: u32) -> Option<String> {
    let mut buffer = [0u16; 16];
    // SAFETY: a null locale name means the user's default locale; the buffer
    // outlives the call and its length is passed along.
    let len = unsafe { GetLocaleInfoEx(PCWSTR::null(), kind, Some(&mut buffer)) };
    (len > 1).then(|| String::from_utf16_lossy(&buffer[..len as usize - 1]))
}

/// "in" where Windows uses the U.S. measurement system, "cm" elsewhere (O9).
pub fn windows_units() -> &'static str {
    if region_value(LOCALE_IMEASURE).as_deref() == Some("1") {
        "in"
    } else {
        "cm"
    }
}

/// Letter or Legal paper where Windows' region uses them (the U.S. and
/// Canada), A4 everywhere else, as in Word (O9).
pub fn windows_paper() -> &'static str {
    match region_value(LOCALE_IPAPERSIZE).as_deref() {
        Some("1") | Some("5") => "Letter",
        _ => "A4",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn region_settings_are_read() {
        assert!(["cm", "in"].contains(&windows_units()));
        assert!(["A4", "Letter"].contains(&windows_paper()));
        assert!(region_value(LOCALE_IMEASURE).is_some());
    }
}
