//! A note's `.mdmeta` file (O7): the formatting Markdown cannot store.
//!
//! The window reads and checks the JSON; this side only finds, reads and
//! writes the file next to the note. Writing uses the same safe replacement
//! as notes, so a crash never leaves half a file.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::files;
use crate::folders::{META_SUFFIX, companion_for};

fn meta_path(note: &str) -> PathBuf {
    companion_for(Path::new(note), META_SUFFIX)
}

fn backup_path(meta: &Path) -> PathBuf {
    let mut name = meta.as_os_str().to_owned();
    name.push(".bak");
    PathBuf::from(name)
}

/// The text of the note's `.mdmeta`, or None if it has none.
#[tauri::command]
pub async fn read_meta(note: String) -> AppResult<Option<String>> {
    let path = meta_path(&note);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::from_io(error, &path)),
    };
    // Not UTF-8 cannot be valid JSON; the window reports it like any broken file.
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

/// Saves the note's `.mdmeta`, or removes it when `text` is None (every
/// setting is back at its default). With `backup`, the file that is there now
/// could not be read: it is first kept as `<name>.mdmeta.bak`.
#[tauri::command]
pub async fn write_meta(note: String, text: Option<String>, backup: bool) -> AppResult<()> {
    let path = meta_path(&note);
    if backup && path.exists() {
        let bak = backup_path(&path);
        fs::copy(&path, &bak).map_err(|e| AppError::from_io(e, &bak))?;
    }
    match text {
        Some(text) => files::safe_write(&path, text.as_bytes()),
        None => match fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err(AppError::from_io(error, &path))
            }
            _ => Ok(()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn writes_reads_and_removes_the_file_next_to_the_note() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("회의.md").display().to_string();
        assert_eq!(run(read_meta(note.clone())).unwrap(), None);

        run(write_meta(
            note.clone(),
            Some("{\"version\":1}\n".into()),
            false,
        ))
        .unwrap();
        assert!(dir.path().join("회의.mdmeta").exists());
        assert_eq!(
            run(read_meta(note.clone())).unwrap().as_deref(),
            Some("{\"version\":1}\n")
        );

        run(write_meta(note.clone(), None, false)).unwrap();
        assert!(!dir.path().join("회의.mdmeta").exists());
        // Removing a file that is not there is fine.
        run(write_meta(note, None, false)).unwrap();
    }

    #[test]
    fn a_broken_file_is_kept_before_it_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("a.md").display().to_string();
        fs::write(dir.path().join("a.mdmeta"), "{ broken").unwrap();
        run(write_meta(note, Some("{}".into()), true)).unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("a.mdmeta.bak")).unwrap(),
            "{ broken"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("a.mdmeta")).unwrap(),
            "{}"
        );
    }
}
