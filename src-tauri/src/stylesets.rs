//! User style sets (O19): one JSON file per set in
//! `%APPDATA%\io.github.oilyhand.mdnote\stylesets\<id>.json`, plus importing
//! and exporting a set as a file to share. The window checks the JSON; this
//! side only stores it.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::files;
use crate::images::checked_id;

pub const DIR: &str = "stylesets";
/// A style set file is small; anything bigger is not one.
const MAX_SIZE: u64 = 1024 * 1024;

#[derive(Serialize)]
pub struct StoredSet {
    id: String,
    text: String,
}

fn set_path(state: &AppState, id: &str) -> AppResult<PathBuf> {
    Ok(state
        .storage
        .path(DIR)
        .join(format!("{}.json", checked_id(id)?)))
}

fn read_small(path: &Path) -> AppResult<String> {
    let size = fs::metadata(path)
        .map_err(|e| AppError::from_io(e, path))?
        .len();
    if size > MAX_SIZE {
        return Err(AppError::Io(format!(
            "{}: too large for a style set",
            path.display()
        )));
    }
    let bytes = fs::read(path).map_err(|e| AppError::from_io(e, path))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Every user set, in no particular order.
#[tauri::command]
pub fn list_style_sets(state: State<AppState>) -> Vec<StoredSet> {
    let Ok(entries) = fs::read_dir(state.storage.path(DIR)) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let id = path.file_stem()?.to_str()?.to_string();
            let is_set = path.extension().is_some_and(|e| e == "json") && checked_id(&id).is_ok();
            is_set.then(|| read_small(&path).ok().map(|text| StoredSet { id, text }))?
        })
        .collect()
}

#[tauri::command]
pub fn save_style_set(state: State<AppState>, id: String, text: String) -> AppResult<()> {
    let path = set_path(&state, &id)?;
    let dir = state.storage.path(DIR);
    fs::create_dir_all(&dir).map_err(|e| AppError::from_io(e, &dir))?;
    files::safe_write(&path, text.as_bytes())
}

#[tauri::command]
pub fn delete_style_set(state: State<AppState>, id: String) -> AppResult<()> {
    let path = set_path(&state, &id)?;
    match fs::remove_file(&path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err(AppError::from_io(error, &path))
        }
        _ => Ok(()),
    }
}

/// The text of a style set file chosen for Import.
#[tauri::command]
pub async fn import_style_set(path: String) -> AppResult<String> {
    read_small(Path::new(&path))
}

/// Writes a style set to the file chosen for Export.
#[tauri::command]
pub async fn export_style_set(path: String, text: String) -> AppResult<()> {
    files::safe_write(Path::new(&path), text.as_bytes())
}
