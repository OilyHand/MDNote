//! Facts about the user's Windows language settings.

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
