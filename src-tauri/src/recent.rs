//! The recent files list, stored in `recent.json`.

use std::path::Path;

use tauri::{AppHandle, Emitter, State};

use crate::AppState;
use crate::error::AppResult;
use crate::paths;

pub const FILE: &str = "recent.json";

/// Moves `path` to the top of the list.
pub fn add(app: &AppHandle, state: &AppState, path: &Path) -> AppResult<()> {
    let limit = state.prefs.lock().unwrap().recent_files_limit as usize;
    let key = paths::key(path);
    let mut recent = state.recent.lock().unwrap();
    recent.retain(|p| paths::key(Path::new(p)) != key);
    recent.insert(0, path.display().to_string());
    recent.truncate(limit);
    save(app, state, &recent)
}

pub fn trim(app: &AppHandle, state: &AppState, limit: u32) -> AppResult<()> {
    let mut recent = state.recent.lock().unwrap();
    if recent.len() > limit as usize {
        recent.truncate(limit as usize);
        save(app, state, &recent)?;
    }
    Ok(())
}

fn save(app: &AppHandle, state: &AppState, recent: &[String]) -> AppResult<()> {
    state.storage.save(FILE, &recent)?;
    let _ = app.emit("recent-files-changed", recent);
    Ok(())
}

#[tauri::command]
pub fn get_recent_files(state: State<AppState>) -> Vec<String> {
    state.recent.lock().unwrap().clone()
}

#[tauri::command]
pub fn remove_recent_file(app: AppHandle, state: State<AppState>, path: String) -> AppResult<()> {
    let key = paths::key(Path::new(&path));
    let mut recent = state.recent.lock().unwrap();
    recent.retain(|p| paths::key(Path::new(p)) != key);
    save(&app, &state, &recent)
}

#[tauri::command]
pub fn clear_recent_files(app: AppHandle, state: State<AppState>) -> AppResult<()> {
    let mut recent = state.recent.lock().unwrap();
    recent.clear();
    save(&app, &state, &recent)
}
