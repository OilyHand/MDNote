//! The folder sidebar (O14): listing a folder one level at a time, watching it
//! for changes made outside MDNote, and the file operations of its menu.
//!
//! A note's companions travel with it: its `<name>.mdmeta` formatting file (O7)
//! and its `<name>.assets` image folder (O15). Renames and moves are reported
//! to every window ("paths-moved"), so open tabs follow them.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc::{RecvTimeoutError, channel};
use std::time::{Duration, UNIX_EPOCH};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::AppState;
use crate::error::{AppError, AppResult};

const SETTLE_TIME: Duration = Duration::from_millis(300);
const NOTE_EXTENSIONS: &[&str] = &["md", "markdown"];
/// A note's formatting file (O7).
pub const META_SUFFIX: &str = ".mdmeta";
/// Files that belong to a note, named after it.
const COMPANION_SUFFIXES: &[&str] = &[META_SUFFIX, ".assets"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_note: bool,
    modified_ms: u64,
}

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| extensions.contains(&e.to_ascii_lowercase().as_str()))
}

pub fn is_note(path: &Path) -> bool {
    has_extension(path, NOTE_EXTENSIONS)
}

/// Hidden and system files, and names starting with a dot, as File Explorer hides them.
fn is_hidden(meta: &fs::Metadata, name: &str) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    name.starts_with('.') || meta.file_attributes() & (HIDDEN | SYSTEM) != 0
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

/// The folders and notes directly inside `path`. `.mdmeta` files are never listed
/// (they belong to their note); other files only with `show_all`.
#[tauri::command]
pub async fn list_folder(path: String, show_all: bool) -> AppResult<Vec<FolderEntry>> {
    let dir = Path::new(&path);
    let entries = fs::read_dir(dir).map_err(|e| AppError::from_io(e, dir))?;
    let mut listed = Vec::new();
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let is_dir = meta.is_dir();
        let note = !is_dir && is_note(&path);
        let skip = is_hidden(&meta, &name)
            || (!is_dir && has_extension(&path, &["mdmeta"]))
            || (!is_dir && !note && !show_all);
        if skip {
            continue;
        }
        listed.push(FolderEntry {
            name,
            path: path.display().to_string(),
            is_dir,
            is_note: note,
            modified_ms: modified_ms(&meta),
        });
    }
    Ok(listed)
}

// ---------------------------------------------------------------------------
// Watching
// ---------------------------------------------------------------------------

/// One watcher per window, for the folder its sidebar shows.
#[derive(Default)]
pub struct FolderWatchers {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl FolderWatchers {
    /// The window closed: stop watching its folder.
    pub fn forget(&self, label: &str) {
        self.watchers.lock().unwrap().remove(label);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderChange {
    /// Folders whose contents changed.
    dirs: Vec<String>,
}

/// Watches the window's folder (and everything below it); changes are reported
/// to that window as "folder-changed", a moment after they settle.
#[tauri::command]
pub fn watch_folder(
    app: AppHandle,
    window: WebviewWindow,
    state: State<AppState>,
    path: String,
) -> AppResult<()> {
    let label = window.label().to_string();
    let (sender, receiver) = channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            for path in event.paths {
                let _ = sender.send(path);
            }
        }
    })
    .map_err(|e| AppError::Internal(format!("folder watcher: {e}")))?;
    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| AppError::Io(format!("{path}: {e}")))?;

    let target = label.clone();
    // Ends when the watcher is dropped (the window closes or watches another folder).
    std::thread::spawn(move || {
        loop {
            let Ok(first) = receiver.recv() else { return };
            let mut changed = vec![first];
            loop {
                match receiver.recv_timeout(SETTLE_TIME) {
                    Ok(path) => changed.push(path),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            let dirs: BTreeSet<String> = changed
                .iter()
                .filter_map(|p| p.parent().map(|d| d.display().to_string()))
                .collect();
            let change = FolderChange {
                dirs: dirs.into_iter().collect(),
            };
            let _ = app.emit_to(target.as_str(), "folder-changed", change);
        }
    });
    state
        .folders
        .watchers
        .lock()
        .unwrap()
        .insert(label, watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_folder(window: WebviewWindow, state: State<AppState>) {
    state.folders.forget(window.label());
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

/// A name Windows accepts for a file or folder.
fn checked_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    let reserved = name
        .chars()
        .any(|c| "<>:\"/\\|?*".contains(c) || c.is_control());
    if name.is_empty() || name == "." || name == ".." || name.ends_with('.') || reserved {
        return Err(AppError::InvalidName(name.to_string()));
    }
    Ok(name.to_string())
}

/// `<name>.mdmeta` and `<name>.assets` next to a note, if they exist.
fn companions(note: &Path) -> Vec<(PathBuf, &'static str)> {
    let (Some(dir), Some(stem)) = (note.parent(), note.file_stem()) else {
        return Vec::new();
    };
    if !is_note(note) {
        return Vec::new();
    }
    let stem = stem.to_string_lossy();
    COMPANION_SUFFIXES
        .iter()
        .map(|suffix| (dir.join(format!("{stem}{suffix}")), *suffix))
        .filter(|(path, _)| path.exists())
        .collect()
}

pub fn companion_for(note: &Path, suffix: &str) -> PathBuf {
    let stem = note
        .file_stem()
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();
    note.with_file_name(format!("{stem}{suffix}"))
}

fn same_file(a: &Path, b: &Path) -> bool {
    crate::paths::key(a) == crate::paths::key(b)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PathsMoved {
    /// Old and new paths; a moved folder also moves everything inside it.
    moves: Vec<(String, String)>,
}

/// Renames or moves `from` to `to`, with a note's companions. Open documents
/// stay watched under their new paths, recent files follow, and every window
/// is told, so open tabs follow too.
fn move_with_companions(
    app: &AppHandle,
    state: &AppState,
    from: &Path,
    to: &Path,
) -> AppResult<()> {
    let case_only = same_file(from, to);
    if to.exists() && !case_only {
        return Err(AppError::Exists(to.display().to_string()));
    }
    let travelling: Vec<(PathBuf, PathBuf)> = companions(from)
        .into_iter()
        .map(|(path, suffix)| (path, companion_for(to, suffix)))
        .collect();
    if let Some((_, taken)) = travelling
        .iter()
        .find(|(c, t)| t.exists() && !same_file(c, t))
    {
        return Err(AppError::Exists(taken.display().to_string()));
    }
    fs::rename(from, to).map_err(|e| AppError::from_io(e, from))?;
    let mut moves = vec![(from.to_path_buf(), to.to_path_buf())];
    for (companion, target) in travelling {
        match fs::rename(&companion, &target) {
            Ok(()) => moves.push((companion, target)),
            Err(error) => log::warn!("could not move {}: {error}", companion.display()),
        }
    }
    for (old, new) in &moves {
        state.watcher.moved(old, new);
    }
    let moves: Vec<(String, String)> = moves
        .into_iter()
        .map(|(a, b)| (a.display().to_string(), b.display().to_string()))
        .collect();
    crate::recent::moved(app, state, &moves);
    let _ = app.emit("paths-moved", PathsMoved { moves });
    Ok(())
}

/// Rename (F2). A note keeps its extension if the new name has none.
#[tauri::command]
pub async fn rename_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    name: String,
) -> AppResult<String> {
    let from = PathBuf::from(&path);
    let mut name = checked_name(&name)?;
    if is_note(&from) && !is_note(Path::new(&name)) {
        let extension = from
            .extension()
            .map(|e| e.to_string_lossy())
            .unwrap_or_default();
        name = format!("{name}.{extension}");
    }
    let to = from.with_file_name(&name);
    move_with_companions(&app, &state, &from, &to)?;
    Ok(to.display().to_string())
}

/// Moving by dragging in the tree.
#[tauri::command]
pub async fn move_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    folder: String,
) -> AppResult<String> {
    let from = PathBuf::from(&path);
    let folder = PathBuf::from(&folder);
    let inside = crate::paths::key(&folder);
    let moved = crate::paths::key(&from);
    if inside == moved || inside.starts_with(&format!("{moved}\\")) {
        return Err(AppError::IntoItself(from.display().to_string()));
    }
    let Some(file_name) = from.file_name() else {
        return Err(AppError::InvalidName(path));
    };
    let to = folder.join(file_name);
    if same_file(&from, &to) {
        return Ok(path); // dropped on its own folder
    }
    move_with_companions(&app, &state, &from, &to)?;
    Ok(to.display().to_string())
}

/// `name` in `dir`, or "name 2", "name 3", … if it is taken.
fn free_path(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    (1..)
        .map(|n| {
            let numbered = if n == 1 {
                stem.to_string()
            } else {
                format!("{stem} {n}")
            };
            dir.join(format!("{numbered}{extension}"))
        })
        .find(|path| !path.exists())
        .expect("some number is free")
}

/// New note: an empty `.md` file, named `name` (numbered if taken).
#[tauri::command]
pub async fn create_note(folder: String, name: String) -> AppResult<String> {
    let name = checked_name(&name)?;
    let path = free_path(Path::new(&folder), &name, ".md");
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| AppError::from_io(e, &path))?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn create_folder(folder: String, name: String) -> AppResult<String> {
    let name = checked_name(&name)?;
    let path = free_path(Path::new(&folder), &name, "");
    fs::create_dir(&path).map_err(|e| AppError::from_io(e, &path))?;
    Ok(path.display().to_string())
}

/// Delete: to the Recycle Bin, a note together with its companions.
#[tauri::command]
pub async fn delete_entry(path: String) -> AppResult<()> {
    let target = PathBuf::from(&path);
    let mut items = vec![target.clone()];
    items.extend(companions(&target).into_iter().map(|(p, _)| p));
    trash::delete_all(&items).map_err(|e| AppError::Io(format!("{path}: {e}")))
}

/// Which of these files exist (for links that a move would break).
#[tauri::command]
pub fn existing_files(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_file()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_windows_refuses_are_refused() {
        assert!(checked_name("메모 1").is_ok());
        for bad in ["", "  ", "a/b", "a:b", "what?", "..", "end."] {
            assert!(checked_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_note_finds_its_companions() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("회의.md");
        fs::write(&note, "x").unwrap();
        fs::write(dir.path().join("회의.mdmeta"), "{}").unwrap();
        fs::create_dir(dir.path().join("회의.assets")).unwrap();
        fs::write(dir.path().join("other.mdmeta"), "{}").unwrap();
        let mut found: Vec<&str> = companions(&note).into_iter().map(|(_, s)| s).collect();
        found.sort();
        assert_eq!(found, vec![".assets", ".mdmeta"]);
        assert_eq!(
            companion_for(&dir.path().join("b.md"), ".mdmeta"),
            dir.path().join("b.mdmeta")
        );
    }

    #[test]
    fn the_tree_never_lists_metadata_files() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["a.md", "a.mdmeta", "b.png"] {
            fs::write(dir.path().join(name), "{}").unwrap();
        }
        let path = dir.path().display().to_string();
        let names = |show_all| {
            let listed =
                tauri::async_runtime::block_on(list_folder(path.clone(), show_all)).unwrap();
            let mut names: Vec<String> = listed.into_iter().map(|e| e.name).collect();
            names.sort();
            names
        };
        assert_eq!(names(false), vec!["a.md"]);
        assert_eq!(names(true), vec!["a.md", "b.png"]);
    }

    #[test]
    fn new_names_are_numbered_when_taken() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("New note.md"), "").unwrap();
        assert_eq!(
            free_path(dir.path(), "New note", ".md"),
            dir.path().join("New note 2.md")
        );
    }
}
