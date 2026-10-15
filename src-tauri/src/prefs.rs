//! App-wide preferences (O12), stored in `preferences.json`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::AppState;
use crate::error::AppResult;
use crate::locale;

pub const FILE: &str = "preferences.json";
pub const MAX_RECENT_FILES: u32 = 30;

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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub language: LanguagePref,
    pub restore_session: bool,
    pub recent_files_limit: u32,
    pub theme: ThemePref,
    /// Settings written by a newer MDNote are kept as they are.
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            language: LanguagePref::System,
            restore_session: true,
            recent_files_limit: 10,
            theme: ThemePref::System,
            unknown: Map::new(),
        }
    }
}

impl Preferences {
    pub fn sanitized(mut self) -> Self {
        self.recent_files_limit = self.recent_files_limit.min(MAX_RECENT_FILES);
        self
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesView {
    pub preferences: Preferences,
    /// The language "System" currently stands for: "en" or "ko".
    pub system_language: &'static str,
}

#[tauri::command]
pub fn get_preferences(state: State<AppState>) -> PreferencesView {
    PreferencesView {
        preferences: state.prefs.lock().unwrap().clone(),
        system_language: locale::windows_ui_language(),
    }
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
    let view = PreferencesView {
        preferences,
        system_language: locale::windows_ui_language(),
    };
    let _ = app.emit("preferences-changed", view);
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
