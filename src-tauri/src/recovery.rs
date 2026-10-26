//! Crash recovery (O1): copies of documents with unsaved changes.
//!
//! While a document has unsaved changes, the window keeps a copy in
//! `%APPDATA%\…\recovery\<document id>.json`, updated shortly after typing
//! pauses and removed when the document is saved or closed without saving.
//! So after a normal exit the folder is empty; copies found at start-up mean
//! MDNote closed unexpectedly, and the main window offers to restore them.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::files::{LineEnding, TextEncoding};
use crate::images::checked_id;

pub const DIR: &str = "recovery";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCopy {
    pub doc_id: String,
    /// The file the document belongs to; None if it was never saved.
    pub path: Option<String>,
    /// The N in "Untitled-N".
    pub untitled: Option<u32>,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
    pub text: String,
    /// When the copy was written (ms since 1970), shown in the restore question.
    pub saved_ms: u64,
}

fn copy_path(state: &AppState, doc_id: &str) -> AppResult<PathBuf> {
    Ok(state
        .storage
        .path(DIR)
        .join(format!("{}.json", checked_id(doc_id)?)))
}

/// Reads every copy left by the previous run (called once, at start-up).
pub fn load_left_over(state: &AppState) -> Vec<RecoveryCopy> {
    let Ok(entries) = fs::read_dir(state.storage.path(DIR)) else {
        return Vec::new();
    };
    let mut copies: Vec<RecoveryCopy> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| {
            let bytes = fs::read(e.path()).ok()?;
            match serde_json::from_slice(&bytes) {
                Ok(copy) => Some(copy),
                Err(error) => {
                    log::warn!("unreadable recovery copy {}: {error}", e.path().display());
                    None
                }
            }
        })
        .collect();
    copies.sort_by_key(|c| c.saved_ms);
    copies
}

#[tauri::command]
pub fn write_recovery(state: State<AppState>, copy: RecoveryCopy) -> AppResult<()> {
    let path = copy_path(&state, &copy.doc_id)?;
    let dir = state.storage.path(DIR);
    fs::create_dir_all(&dir).map_err(|e| AppError::from_io(e, &dir))?;
    let json = serde_json::to_vec(&copy).map_err(|e| AppError::Internal(e.to_string()))?;
    // Written next to the copy, then swapped in, so a crash mid-write keeps the old copy.
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json).map_err(|e| AppError::from_io(e, &temp))?;
    fs::rename(&temp, &path).map_err(|e| AppError::from_io(e, &path))
}

#[tauri::command]
pub fn remove_recovery(state: State<AppState>, doc_id: String) -> AppResult<()> {
    let path = copy_path(&state, &doc_id)?;
    match fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(AppError::from_io(e, &path)),
        _ => Ok(()),
    }
}

/// The copies found at start-up, handed to the main window once.
#[tauri::command]
pub fn take_recovery(window: WebviewWindow, state: State<AppState>) -> Vec<RecoveryCopy> {
    if window.label() != crate::windows::MAIN {
        return Vec::new();
    }
    std::mem::take(&mut *state.recovered.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_round_trip_as_json() {
        let copy = RecoveryCopy {
            doc_id: "0f8e2c1a-1b2c-4d5e-8f90-123456789abc".into(),
            path: None,
            untitled: Some(2),
            encoding: TextEncoding::Utf8,
            line_ending: LineEnding::Crlf,
            text: "한글\n".into(),
            saved_ms: 1,
        };
        let json = serde_json::to_string(&copy).unwrap();
        assert!(json.contains("\"docId\"") && json.contains("\"lineEnding\":\"crlf\""));
        let back: RecoveryCopy = serde_json::from_str(&json).unwrap();
        assert_eq!(back.text, copy.text);
    }
}
