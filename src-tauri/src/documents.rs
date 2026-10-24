//! Commands for reading and saving documents.

use std::path::Path;

use tauri::{AppHandle, State};

use crate::AppState;
use crate::error::AppResult;
use crate::files::{self, FileStamp, LineEnding, LoadedFile, TextEncoding};

/// Reads a document. Unless `remember` is false (a background check after another
/// program touched the file), it is also added to the recent files list.
#[tauri::command]
pub async fn read_document(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    remember: Option<bool>,
) -> AppResult<LoadedFile> {
    let path = Path::new(&path);
    let loaded = files::read_document(path)?;
    state.watcher.set_known(path, loaded.stamp);
    if remember.unwrap_or(true) {
        if let Err(error) = crate::recent::add(&app, &state, path) {
            log::warn!("could not update recent files: {error}");
        }
    }
    Ok(loaded)
}

/// Saves a document with the given encoding and line ending. Unless `remember`
/// is false (links updated in a note that is not open), it also becomes a
/// recent file.
#[tauri::command]
pub async fn write_document(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    text: String,
    encoding: TextEncoding,
    line_ending: LineEnding,
    remember: Option<bool>,
) -> AppResult<FileStamp> {
    let path = Path::new(&path);
    let stamp = files::write_document(path, &text, encoding, line_ending)?;
    // Our own write must not be reported as a change by another program.
    state.watcher.set_known(path, stamp);
    if remember.unwrap_or(true) {
        if let Err(error) = crate::recent::add(&app, &state, path) {
            log::warn!("could not update recent files: {error}");
        }
    }
    Ok(stamp)
}

/// The code page Windows uses for "ANSI" text (the status bar's encoding menu offers it).
#[tauri::command]
pub fn system_code_page() -> u16 {
    files::system_ansi_codepage()
}

/// The line ending new documents start with.
#[tauri::command]
pub fn default_line_ending() -> LineEnding {
    files::DEFAULT_LINE_ENDING
}
