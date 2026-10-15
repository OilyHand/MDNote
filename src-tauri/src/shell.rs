//! Windows integration: the Preferences window and the Default Apps settings page.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

pub const PREFERENCES: &str = "preferences";

/// Opens the Preferences window, or brings it to the front if it is already open.
#[tauri::command]
pub async fn open_preferences(app: AppHandle, window: WebviewWindow) -> AppResult<()> {
    if let Some(existing) = app.get_webview_window(PREFERENCES) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }
    let theme = app.state::<crate::AppState>().prefs.lock().unwrap().theme;
    let preferences = WebviewWindowBuilder::new(
        &app,
        PREFERENCES,
        WebviewUrl::App("index.html?window=preferences".into()),
    )
    .title("MDNote")
    .inner_size(580.0, 640.0)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .parent(&window)
    .map_err(|e| AppError::Internal(e.to_string()))?
    .center()
    .build()
    .map_err(|e| AppError::Internal(e.to_string()))?;
    crate::prefs::apply_theme(&app, theme);
    let _ = preferences.set_focus();
    Ok(())
}

/// Windows doesn't let apps make themselves the default for a file type, so
/// this opens the Settings page where the user confirms it (O1).
#[tauri::command]
pub fn open_default_apps_settings() -> AppResult<()> {
    tauri_plugin_opener::open_url("ms-settings:defaultapps", None::<&str>)
        .map_err(|e| AppError::Internal(e.to_string()))
}
