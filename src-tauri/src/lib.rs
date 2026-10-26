//! MDNote's Rust side: everything that touches Windows or the file system.

mod documents;
mod error;
mod files;
mod folders;
mod fonts;
mod images;
mod locale;
mod meta;
mod paths;
mod prefs;
mod preview;
mod recent;
mod recovery;
mod shell;
mod storage;
mod tabs;
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
    pub fonts: fonts::FontCache,
    pub folders: folders::FolderWatchers,
    /// Recovery copies found at start-up (MDNote closed unexpectedly last time).
    pub recovered: Mutex<Vec<recovery::RecoveryCopy>>,
}

/// A debug build started with `MDNOTE_CONFIG_DIR` is an isolated test run: it keeps
/// its settings, session and WebView2 data in that folder, and it never hands its
/// files to an installed MDNote that happens to be running. (Sharing WebView2's
/// data folder with a running MDNote fails when the two start WebView2 with
/// different options, such as a DevTools port.)
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
    if let Some(dir) = test_config_dir() {
        if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
            // SAFETY: set before any other thread starts; nothing reads the
            // environment concurrently this early in start-up.
            unsafe { std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir.join("webview")) };
        }
    }
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
                fonts: fonts::FontCache::default(),
                folders: folders::FolderWatchers::default(),
                recovered: Mutex::new(Vec::new()),
            });

            let state = app.state::<AppState>();
            let recovered = recovery::load_left_over(&state);
            // Waiting images of never-saved notes are kept only if a recovery copy needs them.
            let keep: Vec<String> = recovered.iter().map(|c| c.doc_id.clone()).collect();
            images::remove_stale_unsaved(&state, &keep);
            *state.recovered.lock().unwrap() = recovered;
            let session = windows::load_session(&state)?;
            prefs::apply_theme(&handle, theme);
            windows::restore_windows(&handle, &state, &session);
            Ok(())
        })
        .on_window_event(windows::on_window_event)
        .invoke_handler(tauri::generate_handler![
            documents::read_document,
            documents::write_document,
            documents::default_line_ending,
            documents::system_code_page,
            meta::read_meta,
            meta::write_meta,
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
            windows::quit_app,
            windows::cancel_quit,
            tabs::move_tab_to_new_window,
            tabs::start_tab_drag,
            shell::open_preferences,
            shell::open_default_apps_settings,
            preview::resolve_images,
            preview::resolve_link,
            fonts::list_fonts,
            folders::list_folder,
            folders::watch_folder,
            folders::unwatch_folder,
            folders::rename_entry,
            folders::move_entry,
            folders::create_note,
            folders::create_folder,
            folders::delete_entry,
            folders::existing_files,
            images::save_image,
            images::import_images,
            images::adopt_unsaved_images,
            images::discard_unsaved_images,
            images::unsaved_document_path,
            recovery::write_recovery,
            recovery::remove_recovery,
            recovery::take_recovery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MDNote");
}
