//! Images pasted or dropped into a note (O15).
//!
//! Each image is saved in the note's image folder (`assets` by default; see
//! Preferences) under a name that is not taken yet, and the frontend inserts a
//! relative link. A note that was never saved has no folder: its images wait in
//! `%APPDATA%\…\unsaved-images\<document id>\` and move into place when the
//! note is first saved.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::ipc::{InvokeBody, Request};

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::preview::{is_image, percent_decode};

pub const UNSAVED_DIR: &str = "unsaved-images";

/// Where a note's images go (O12 > Files).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ImageFolder {
    /// `assets\` next to the note.
    #[default]
    Assets,
    /// `<note name>.assets\` next to the note.
    NoteName,
    /// The note's own folder.
    NoteFolder,
}

/// The image folder for `document`, and its path relative to the note
/// (forward slashes; empty for the note's own folder).
fn image_folder(document: &Path, choice: ImageFolder) -> (PathBuf, String) {
    let base = document.parent().unwrap_or(Path::new("."));
    match choice {
        ImageFolder::Assets => (base.join("assets"), "assets".into()),
        ImageFolder::NoteName => {
            let stem = document
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "note".into());
            let name = format!("{stem}.assets");
            (base.join(&name), name)
        }
        ImageFolder::NoteFolder => (base.to_path_buf(), String::new()),
    }
}

fn join_relative(folder: &str, name: &str) -> String {
    if folder.is_empty() {
        name.to_string()
    } else {
        format!("{folder}/{name}")
    }
}

/// A file name Windows accepts: no folders, no reserved characters.
fn clean_name(name: &str) -> String {
    let name = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.').to_string();
    if cleaned.is_empty() || cleaned.starts_with('.') {
        format!("image{cleaned}")
    } else {
        cleaned
    }
}

/// `name` if it is free in `dir`, otherwise `stem-1.ext`, `stem-2.ext`, …
fn unique_name(dir: &Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();
    let extension = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    (1..)
        .map(|n| format!("{stem}-{n}{extension}"))
        .find(|candidate| !dir.join(candidate).exists())
        .expect("some number is free")
}

/// Document ids are UUIDs; anything else could reach outside the folder.
pub(crate) fn checked_id(doc_id: &str) -> AppResult<&str> {
    let valid = !doc_id.is_empty() && doc_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    valid
        .then_some(doc_id)
        .ok_or_else(|| AppError::Internal(format!("invalid document id {doc_id}")))
}

fn unsaved_dir(state: &AppState, doc_id: &str) -> AppResult<PathBuf> {
    Ok(state.storage.path(UNSAVED_DIR).join(checked_id(doc_id)?))
}

/// The note's path; for a note never saved, a stand-in path in its waiting folder.
fn document_path(state: &AppState, document: Option<String>, doc_id: &str) -> AppResult<PathBuf> {
    match document {
        Some(path) if !path.is_empty() => Ok(PathBuf::from(path)),
        _ => Ok(unsaved_dir(state, doc_id)?.join("untitled.md")),
    }
}

fn image_folder_choice(state: &AppState) -> ImageFolder {
    state.prefs.lock().unwrap().image_folder
}

/// Saves `bytes` as a new image for the note and returns its relative path.
fn save_bytes(
    state: &AppState,
    document: Option<String>,
    doc_id: &str,
    name: &str,
    bytes: &[u8],
) -> AppResult<String> {
    let document = document_path(state, document, doc_id)?;
    let (folder, relative) = image_folder(&document, image_folder_choice(state));
    fs::create_dir_all(&folder).map_err(|e| AppError::from_io(e, &folder))?;
    let name = unique_name(&folder, &clean_name(name));
    let target = folder.join(&name);
    fs::write(&target, bytes).map_err(|e| AppError::from_io(e, &target))?;
    Ok(join_relative(&relative, &name))
}

fn header(request: &Request<'_>, name: &str) -> String {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default()
}

/// A pasted image. The body is the image file's bytes; the headers name the
/// note (`x-document`, empty if never saved), its id and the file name, all
/// percent-encoded. Returns the image's path relative to the note.
#[tauri::command]
pub async fn save_image(request: Request<'_>, state: State<'_, AppState>) -> AppResult<String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Internal("expected the image bytes".into()));
    };
    let document = Some(header(&request, "x-document")).filter(|d| !d.is_empty());
    let doc_id = header(&request, "x-doc-id");
    let name = header(&request, "x-name");
    save_bytes(&state, document, &doc_id, &name, bytes)
}

/// Dropped or chosen image files: each is copied into the image folder (unless
/// it is already there). Returns their paths relative to the note; files that
/// are not images are left out.
#[tauri::command]
pub async fn import_images(
    state: State<'_, AppState>,
    document: Option<String>,
    doc_id: String,
    paths: Vec<String>,
) -> AppResult<Vec<String>> {
    let note = document_path(&state, document.clone(), &doc_id)?;
    let (folder, relative) = image_folder(&note, image_folder_choice(&state));
    let mut links = Vec::new();
    for path in paths.iter().map(PathBuf::from).filter(|p| is_image(p)) {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let already_there = path.parent().is_some_and(|parent| {
            dunce::canonicalize(parent).ok() == dunce::canonicalize(&folder).ok()
        });
        if already_there {
            links.push(join_relative(&relative, &name));
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| AppError::from_io(e, &path))?;
        links.push(save_bytes(
            &state,
            document.clone(),
            &doc_id,
            &name,
            &bytes,
        )?);
    }
    Ok(links)
}

/// Moves a file, copying it when it goes to another drive.
fn move_file(from: &Path, to: &Path) -> AppResult<()> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to).map_err(|e| AppError::from_io(e, to))?;
    let _ = fs::remove_file(from);
    Ok(())
}

/// Every file below `dir`, with its path relative to `dir` (forward slashes).
fn files_below(dir: &Path, prefix: &str, out: &mut Vec<(PathBuf, String)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = join_relative(prefix, &name);
        if path.is_dir() {
            files_below(&path, &relative, out);
        } else {
            out.push((path, relative));
        }
    }
}

/// The note was saved for the first time as `document`: its waiting images move
/// into its image folder. Returns `[old link, new link]` pairs for every image
/// whose relative path changed, so the frontend can update the links.
#[tauri::command]
pub async fn adopt_unsaved_images(
    state: State<'_, AppState>,
    doc_id: String,
    document: String,
) -> AppResult<Vec<(String, String)>> {
    let waiting = unsaved_dir(&state, &doc_id)?;
    if !waiting.is_dir() {
        return Ok(Vec::new());
    }
    let (folder, relative) = image_folder(Path::new(&document), image_folder_choice(&state));
    let mut files = Vec::new();
    files_below(&waiting, "", &mut files);
    let mut renamed = Vec::new();
    for (path, old) in files.into_iter().filter(|(p, _)| is_image(p)) {
        fs::create_dir_all(&folder).map_err(|e| AppError::from_io(e, &folder))?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let name = unique_name(&folder, &name);
        move_file(&path, &folder.join(&name))?;
        let new = join_relative(&relative, &name);
        if new != old {
            renamed.push((old, new));
        }
    }
    let _ = fs::remove_dir_all(&waiting);
    Ok(renamed)
}

/// A never-saved note was closed without saving: its waiting images go too.
#[tauri::command]
pub fn discard_unsaved_images(state: State<AppState>, doc_id: String) -> AppResult<()> {
    let waiting = unsaved_dir(&state, &doc_id)?;
    if waiting.is_dir() {
        fs::remove_dir_all(&waiting).map_err(|e| AppError::from_io(e, &waiting))?;
    }
    Ok(())
}

/// The stand-in path the preview resolves a never-saved note's images against.
#[tauri::command]
pub fn unsaved_document_path(state: State<AppState>, doc_id: String) -> AppResult<String> {
    Ok(document_path(&state, None, &doc_id)?.display().to_string())
}

/// Removes waiting folders of notes that no longer exist (no recovery copy refers to them).
pub fn remove_stale_unsaved(state: &AppState, keep: &[String]) {
    let root = state.storage.path(UNSAVED_DIR);
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !keep.contains(&name) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_folders_relative_to_the_note() {
        let note = Path::new("C:\\notes\\회의 메모.md");
        assert_eq!(image_folder(note, ImageFolder::Assets).1, "assets");
        assert_eq!(
            image_folder(note, ImageFolder::NoteName).1,
            "회의 메모.assets"
        );
        assert_eq!(image_folder(note, ImageFolder::NoteFolder).1, "");
        assert_eq!(join_relative("", "a.png"), "a.png");
    }

    #[test]
    fn names_never_clash_or_escape_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("shot.png"), b"1").unwrap();
        fs::write(dir.path().join("shot-1.png"), b"2").unwrap();
        assert_eq!(unique_name(dir.path(), "shot.png"), "shot-2.png");
        assert_eq!(unique_name(dir.path(), "new.png"), "new.png");
        assert_eq!(clean_name("..\\..\\evil.png"), "evil.png");
        assert_eq!(clean_name("a:b?.png"), "a_b_.png");
        assert_eq!(clean_name(".png"), "image.png");
        assert!(checked_id("../x").is_err());
        assert!(checked_id("0f8e2c1a-1b2c-4d5e-8f90-123456789abc").is_ok());
    }
}
