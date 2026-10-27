//! App-wide preferences (O12), stored in `preferences.json`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::AppState;
use crate::error::AppResult;
use crate::images::ImageFolder;
use crate::locale;

pub const FILE: &str = "preferences.json";
pub const MAX_RECENT_FILES: u32 = 30;
const MAX_RECENT_FONTS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LanguagePref {
    /// Korean if Windows' display language is Korean, English otherwise.
    #[default]
    System,
    En,
    Ko,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemePref {
    #[default]
    System,
    Light,
    Dark,
}

/// The unit page measurements are shown in (O9).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum UnitsPref {
    /// Inches where Windows uses the U.S. measurement system, centimetres elsewhere.
    #[default]
    System,
    Cm,
    In,
}

/// Which items the status bar shows (O18); chosen by right-clicking it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StatusBarItems {
    /// "Page 2 of 5", in Print Layout (O9).
    pub page: bool,
    pub words: bool,
    pub characters: bool,
    pub characters_no_spaces: bool,
    pub cursor: bool,
    pub encoding: bool,
    pub line_ending: bool,
    pub zoom: bool,
}

impl Default for StatusBarItems {
    fn default() -> Self {
        Self {
            page: true,
            words: true,
            characters: true,
            characters_no_spaces: true,
            cursor: true,
            encoding: true,
            line_ending: true,
            zoom: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub language: LanguagePref,
    pub restore_session: bool,
    pub recent_files_limit: u32,
    pub theme: ThemePref,
    /// Source editor font family; empty means the built-in default.
    pub editor_font_family: String,
    /// Source editor font size in CSS pixels.
    pub editor_font_size: u32,
    pub editor_word_wrap: bool,
    pub editor_line_numbers: bool,
    /// Editor conveniences (O17), each of which can be turned off.
    pub editor_list_continuation: bool,
    pub editor_close_brackets: bool,
    pub editor_wrap_selection: bool,
    pub editor_renumber_lists: bool,
    /// Line source tables up when the cursor leaves them (O16).
    pub editor_format_tables: bool,
    /// Where pasted and dropped images are saved (O15).
    pub image_folder: ImageFolder,
    /// Show non-Markdown files in the folder sidebar (O14).
    pub sidebar_show_all_files: bool,
    /// View > Status Bar (O18).
    pub status_bar: bool,
    pub status_bar_items: StatusBarItems,
    /// The styles documents start with (O4, O12): how they differ from the
    /// built-in styles, in the form of a `.mdmeta` "styles" object. The
    /// window checks the values; Rust keeps them as they are.
    pub default_styles: Map<String, Value>,
    /// The style set the default styles were taken from, for display (O19).
    pub default_style_set: String,
    /// The page setup for documents without their own (O9), in the form of a
    /// `.mdmeta` "page" object; null: the Windows region decides the paper.
    pub default_page: Option<Value>,
    pub units: UnitsPref,
    /// The font picker's recently used fonts, newest first (O3).
    pub recent_fonts: Vec<String>,
    /// Settings written by a newer MDNote are kept as they are.
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

pub const EDITOR_FONT_SIZES: std::ops::RangeInclusive<u32> = 8..=40;

impl Default for Preferences {
    fn default() -> Self {
        Self {
            language: LanguagePref::System,
            restore_session: true,
            recent_files_limit: 10,
            theme: ThemePref::System,
            editor_font_family: String::new(),
            editor_font_size: 14,
            editor_word_wrap: true,
            editor_line_numbers: false,
            editor_list_continuation: true,
            editor_close_brackets: true,
            editor_wrap_selection: true,
            editor_renumber_lists: true,
            editor_format_tables: true,
            image_folder: ImageFolder::Assets,
            sidebar_show_all_files: false,
            status_bar: true,
            status_bar_items: StatusBarItems::default(),
            default_styles: Map::new(),
            default_style_set: String::new(),
            default_page: None,
            units: UnitsPref::System,
            recent_fonts: Vec::new(),
            unknown: Map::new(),
        }
    }
}

impl Preferences {
    pub fn sanitized(mut self) -> Self {
        self.recent_files_limit = self.recent_files_limit.min(MAX_RECENT_FILES);
        self.editor_font_size = self
            .editor_font_size
            .clamp(*EDITOR_FONT_SIZES.start(), *EDITOR_FONT_SIZES.end());
        self.recent_fonts.truncate(MAX_RECENT_FONTS);
        self
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesView {
    pub preferences: Preferences,
    /// The language "System" currently stands for: "en" or "ko".
    pub system_language: &'static str,
    /// What Windows' region settings stand for: "cm" or "in", and "A4" or "Letter".
    pub system_units: &'static str,
    pub system_paper: &'static str,
}

impl PreferencesView {
    pub fn new(preferences: Preferences) -> Self {
        Self {
            preferences,
            system_language: locale::windows_ui_language(),
            system_units: locale::windows_units(),
            system_paper: locale::windows_paper(),
        }
    }
}

#[tauri::command]
pub fn get_preferences(state: State<AppState>) -> PreferencesView {
    PreferencesView::new(state.prefs.lock().unwrap().clone())
}

#[tauri::command]
pub fn set_preferences(
    app: AppHandle,
    state: State<AppState>,
    preferences: Preferences,
) -> AppResult<()> {
    let preferences = preferences.sanitized();
    state.storage.save(FILE, &preferences)?;
    *state.prefs.lock().unwrap() = preferences.clone();
    crate::recent::trim(&app, &state, preferences.recent_files_limit)?;
    apply_theme(&app, preferences.theme);
    let _ = app.emit("preferences-changed", PreferencesView::new(preferences));
    Ok(())
}

/// Sets the title-bar theme of every window to match the preference.
pub fn apply_theme(app: &AppHandle, theme: ThemePref) {
    let theme = match theme {
        ThemePref::System => None,
        ThemePref::Light => Some(tauri::Theme::Light),
        ThemePref::Dark => Some(tauri::Theme::Dark),
    };
    for window in app.webview_windows().values() {
        let _ = window.set_theme(theme);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_get_defaults_and_unknown_fields_survive() {
        let json = r#"{ "theme": "dark", "futureSetting": { "a": 1 } }"#;
        let prefs: Preferences = serde_json::from_str(json).unwrap();
        assert_eq!(prefs.theme, ThemePref::Dark);
        assert!(prefs.restore_session);
        assert_eq!(prefs.recent_files_limit, 10);

        let saved = serde_json::to_value(&prefs).unwrap();
        assert_eq!(saved["futureSetting"]["a"], 1);
    }

    #[test]
    fn recent_file_limit_is_capped() {
        let prefs = Preferences {
            recent_files_limit: 500,
            ..Default::default()
        };
        assert_eq!(prefs.sanitized().recent_files_limit, MAX_RECENT_FILES);
    }
}
