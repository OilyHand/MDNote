//! Notices when an open document is changed or deleted by another program (O1).
//!
//! The parent folder of every open document is watched (one watch per folder).
//! Events are collected for a short moment, because other editors often save by
//! deleting and re-creating a file. Then each affected document's size and
//! modification time are compared with the version MDNote last read or wrote.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::files::{self, FileStamp};
use crate::paths;

const SETTLE_TIME: Duration = Duration::from_millis(300);

#[derive(Clone, Copy, PartialEq, Eq)]
enum DiskState {
    Present(FileStamp),
    Missing,
}

struct Watched {
    path: PathBuf,
    /// The version MDNote last read or wrote.
    known: Option<FileStamp>,
    /// The last state reported to the frontend, so each change is reported once.
    reported: Option<DiskState>,
}

#[derive(Default)]
struct Watches {
    documents: HashMap<String, Watched>,
    folders: HashMap<PathBuf, usize>,
}

pub struct DocumentWatcher {
    watches: Arc<Mutex<Watches>>,
    watcher: Mutex<RecommendedWatcher>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskChange {
    path: String,
    /// "changed" or "removed".
    kind: &'static str,
}

impl DocumentWatcher {
    pub fn new(app: AppHandle) -> AppResult<Self> {
        let (sender, receiver) = channel::<PathBuf>();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event {
                for path in event.paths {
                    let _ = sender.send(path);
                }
            }
        })
        .map_err(|e| AppError::Internal(format!("file watcher: {e}")))?;

        let watches = Arc::new(Mutex::new(Watches::default()));
        let worker_watches = Arc::clone(&watches);
        std::thread::spawn(move || process_events(app, receiver, worker_watches));

        Ok(Self {
            watches,
            watcher: Mutex::new(watcher),
        })
    }

    pub fn watch(&self, path: &Path, known: Option<FileStamp>) -> AppResult<()> {
        let key = paths::key(path);
        let mut watches = self.watches.lock().unwrap();
        if let Some(existing) = watches.documents.get_mut(&key) {
            existing.known = known;
            existing.reported = None;
            return Ok(());
        }
        let folder = path.parent().map(Path::to_path_buf).unwrap_or_default();
        if !watches.folders.contains_key(&folder) {
            self.watcher
                .lock()
                .unwrap()
                .watch(&folder, RecursiveMode::NonRecursive)
                .map_err(|e| AppError::Io(format!("{}: {e}", folder.display())))?;
        }
        *watches.folders.entry(folder).or_insert(0) += 1;
        watches.documents.insert(
            key,
            Watched {
                path: path.to_path_buf(),
                known,
                reported: None,
            },
        );
        Ok(())
    }

    pub fn unwatch(&self, path: &Path) {
        let key = paths::key(path);
        let mut watches = self.watches.lock().unwrap();
        let Some(removed) = watches.documents.remove(&key) else {
            return;
        };
        let folder = removed
            .path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default();
        if let Some(count) = watches.folders.get_mut(&folder) {
            *count -= 1;
            if *count == 0 {
                watches.folders.remove(&folder);
                let _ = self.watcher.lock().unwrap().unwatch(&folder);
            }
        }
    }

    /// A watched document (or a folder holding some) was renamed or moved by
    /// MDNote: it stays watched under its new path, and the old path is not
    /// reported as deleted.
    pub fn moved(&self, from: &Path, to: &Path) {
        let from_key = paths::key(from);
        let inside = format!("{from_key}\\");
        let affected: Vec<(PathBuf, Option<FileStamp>)> = {
            let watches = self.watches.lock().unwrap();
            watches
                .documents
                .iter()
                .filter(|(key, _)| **key == from_key || key.starts_with(&inside))
                .map(|(_, w)| (w.path.clone(), w.known))
                .collect()
        };
        for (old, known) in affected {
            let rest = old
                .strip_prefix(from)
                .map(Path::to_path_buf)
                .unwrap_or_default();
            let new = if rest.as_os_str().is_empty() {
                to.to_path_buf()
            } else {
                to.join(rest)
            };
            self.unwatch(&old);
            if let Err(error) = self.watch(&new, known) {
                log::warn!("could not watch {}: {error}", new.display());
            }
        }
    }

    /// Records a version MDNote itself wrote or read, so it isn't reported as a change.
    pub fn set_known(&self, path: &Path, stamp: FileStamp) {
        let key = paths::key(path);
        if let Some(watched) = self.watches.lock().unwrap().documents.get_mut(&key) {
            watched.known = Some(stamp);
            watched.reported = None;
        }
    }
}

fn process_events(app: AppHandle, receiver: Receiver<PathBuf>, watches: Arc<Mutex<Watches>>) {
    loop {
        // Wait for the first event, then collect the rest until things settle.
        let Ok(first) = receiver.recv() else { return };
        let mut changed = vec![first];
        loop {
            match receiver.recv_timeout(SETTLE_TIME) {
                Ok(path) => changed.push(path),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }

        let keys: std::collections::HashSet<String> =
            changed.iter().map(|p| paths::key(p)).collect();
        let mut watches = watches.lock().unwrap();
        for watched in watches.documents.values_mut() {
            if !keys.contains(&paths::key(&watched.path)) {
                continue;
            }
            let now = match files::stamp(&watched.path) {
                Ok(stamp) => DiskState::Present(stamp),
                Err(_) => DiskState::Missing,
            };
            let unchanged = matches!(now, DiskState::Present(s) if Some(s) == watched.known);
            if unchanged || watched.reported == Some(now) {
                continue;
            }
            watched.reported = Some(now);
            let kind = match now {
                DiskState::Present(_) => "changed",
                DiskState::Missing => "removed",
            };
            let change = DiskChange {
                path: watched.path.display().to_string(),
                kind,
            };
            let _ = app.emit("document-disk-change", change);
        }
    }
}

#[tauri::command]
pub fn watch_document(
    state: State<AppState>,
    path: String,
    stamp: Option<FileStamp>,
) -> AppResult<()> {
    state.watcher.watch(Path::new(&path), stamp)
}

#[tauri::command]
pub fn unwatch_document(state: State<AppState>, path: String) {
    state.watcher.unwatch(Path::new(&path));
}
