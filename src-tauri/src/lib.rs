//! MDNote's Rust side: everything that touches Windows or the file system.

mod documents;
mod error;
mod files;
mod locale;
mod paths;
mod prefs;
mod recent;
mod shell;
mod storage;
mod watch;
mod windows;

use std::sync::Mutex;

use tauri::Manager;

use crate::prefs::Preferences;
use crate::storage::Storage;
use crate::watch::DocumentWatcher;
use crate::windows::Registry;

pub struct AppState {
    pub storage: Storage,
    pub prefs: Mutex<Preferences>,
    pub recent: Mutex<Vec<String>>,
    pub registry: Mutex<Registry>,
    pub watcher: DocumentWatcher,
}

/// A debug build started with `MDNOTE_CONFIG_DIR` is an isolated test run: it keeps
/// its settings and session in that folder, and it never hands its files to an
/// installed MDNote that happens to be running.
fn test_config_dir() -> Option<std::path::PathBuf> {
    if cfg!(debug_assertions) {
        std::env::var_os("MDNOTE_CONFIG_DIR").map(Into::into)
    } else {
        None
    }
}

/// `%APPDATA%\io.github.oilyhand.mdnote`, unless this is an isolated test run.
fn config_dir(app: &tauri::App) -> tauri::Result<std::path::PathBuf> {
    match test_config_dir() {
        Some(dir) => Ok(dir),
        None => app.path().app_config_dir(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    if test_config_dir().is_none() {
        // Must be registered first: a second MDNote.exe hands its files to this one and exits.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            windows::on_second_instance(app, args, cwd);
        }));
    }
    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let storage = Storage::new(config_dir(app)?);
            let prefs: Preferences = storage.load::<Preferences>(prefs::FILE).sanitized();
            let recent: Vec<String> = storage.load(recent::FILE);
            let theme = prefs.theme;

            let mut registry = Registry::default();
            let cwd = std::env::current_dir().unwrap_or_default();
            let args: Vec<String> = std::env::args().collect();
            registry.startup_paths = paths::file_arguments(&args, &cwd);

            app.manage(AppState {
                storage,
                prefs: Mutex::new(prefs),
                recent: Mutex::new(recent),
                registry: Mutex::new(registry),
                watcher: DocumentWatcher::new(handle.clone())?,
            });

            let state = app.state::<AppState>();
            let session = windows::load_session(&state)?;
            prefs::apply_theme(&handle, theme);
            windows::restore_main_window(&handle, &state, &session);
            Ok(())
        })
        .on_window_event(windows::on_window_event)
        .invoke_handler(tauri::generate_handler![
            documents::read_document,
            documents::write_document,
            documents::default_line_ending,
            prefs::get_preferences,
            prefs::set_preferences,
            recent::get_recent_files,
            recent::remove_recent_file,
            recent::clear_recent_files,
            watch::watch_document,
            watch::unwatch_document,
            windows::take_startup,
            windows::report_tabs,
            windows::open_paths,
            shell::open_preferences,
            shell::open_default_apps_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MDNote");
}
