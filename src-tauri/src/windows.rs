//! Which window shows which documents, routing of files opened from Explorer,
//! and session restore (O1).
//!
//! Each window reports its tabs whenever they change. Rust uses that to
//! - switch to the existing tab when a file that is already open is opened again,
//! - send files opened from Explorer to the most recently used window, and
//! - write `session.json`, so the next start can restore windows and tabs.

use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::AppState;
use crate::error::AppResult;
use crate::paths;

pub const SESSION_FILE: &str = "session.json";
pub const MAIN: &str = "main";

/// Windows closed within this time of the last one count as closed together.
const CLOSED_TOGETHER: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TabSession {
    pub path: String,
    pub scroll_top: f64,
    pub cursor: u32,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowSession {
    pub label: String,
    pub bounds: Option<Bounds>,
    pub tabs: Vec<TabSession>,
    pub active: usize,
    /// The folder the window's sidebar shows (O14).
    pub folder: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub version: u32,
    pub windows: Vec<WindowSession>,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            version: 1,
            windows: Vec::new(),
        }
    }
}

/// What a new window shows once it is ready: tabs from the session, or tabs moved to it.
#[derive(Default)]
pub struct PendingWindow {
    pub tabs: Vec<TabSession>,
    pub active: usize,
    pub folder: Option<String>,
    /// Tabs moved from another window, with text, metadata and Undo history (opaque to Rust).
    pub transfers: Vec<Value>,
}

#[derive(Default)]
pub struct Registry {
    pub windows: HashMap<String, WindowSession>,
    pub last_focused: Option<String>,
    /// Files named on the command line at start-up, handed to the main window once.
    pub startup_paths: Vec<String>,
    /// The saved session, handed to the main window once.
    pub restored: Option<WindowSession>,
    /// Windows that were opened but have not asked for their tabs yet.
    pub pending: HashMap<String, PendingWindow>,
    next_window: u32,
    /// Windows closed while others stayed open, and when (see "Window events").
    closed: Vec<(Instant, WindowSession)>,
    /// File > Exit is closing every window.
    quitting: bool,
}

impl Registry {
    fn window_showing(&self, key: &str) -> Option<String> {
        self.windows
            .iter()
            .find(|(_, w)| w.tabs.iter().any(|t| paths::key(Path::new(&t.path)) == key))
            .map(|(label, _)| label.clone())
    }

    fn target_window(&self, app: &AppHandle) -> Option<WebviewWindow> {
        self.last_focused
            .as_deref()
            .and_then(|label| app.get_webview_window(label))
            .or_else(|| app.get_webview_window(MAIN))
            .or_else(|| {
                app.webview_windows()
                    .into_iter()
                    .find(|(label, _)| is_document_window(label))
                    .map(|(_, window)| window)
            })
    }

    /// A label for a new document window: "w-1", "w-2", …
    pub fn new_label(&mut self, app: &AppHandle) -> String {
        loop {
            self.next_window += 1;
            let label = format!("w-{}", self.next_window);
            if app.get_webview_window(&label).is_none() && !self.pending.contains_key(&label) {
                return label;
            }
        }
    }
}

/// Document windows, as opposed to Preferences and the tab-drag label.
pub fn is_document_window(label: &str) -> bool {
    label == MAIN || label.starts_with("w-")
}

/// Opens a document window. It asks for its tabs (take_startup) once its page is ready.
pub fn open_document_window(
    app: &AppHandle,
    label: &str,
    bounds: Option<Bounds>,
    position: Option<(i32, i32)>,
) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("MDNote")
        .inner_size(1100.0, 760.0)
        .min_inner_size(560.0, 360.0)
        .visible(false)
        .build()?;
    if let Some(bounds) = bounds {
        if is_on_screen(&window, bounds) {
            apply_placement(&window, bounds);
        }
        if bounds.maximized {
            let _ = window.maximize();
        }
    } else if let Some((x, y)) = position {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    let theme = app.state::<AppState>().prefs.lock().unwrap().theme;
    crate::prefs::apply_theme(app, theme);
    let _ = window.show();
    let _ = window.set_focus();
    Ok(window)
}

/// Saves every window's tabs and size to `session.json`.
pub fn save_session(state: &AppState) {
    let registry = state.registry.lock().unwrap();
    let session = Session {
        version: 1,
        windows: registry.windows.values().cloned().collect(),
    };
    if let Err(error) = state.storage.save(SESSION_FILE, &session) {
        log::error!("could not save the session: {error}");
    }
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

/// Restores the windows of the last session: the main window's size and
/// position (always) and, with session restore on, every window and its tabs.
/// If the main window was closed before the others, the first other window's
/// tabs open in it.
pub fn restore_windows(app: &AppHandle, state: &AppState, session: &Session) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let restore_tabs = state.prefs.lock().unwrap().restore_session;
    let mut others: Vec<WindowSession> = session
        .windows
        .iter()
        .filter(|w| w.label != MAIN && (!w.tabs.is_empty() || w.folder.is_some()))
        .cloned()
        .collect();
    let main_saved = session.windows.iter().find(|w| w.label == MAIN).cloned();
    let saved = match main_saved {
        Some(saved) => Some(saved),
        None if restore_tabs && !others.is_empty() => Some(others.remove(0)),
        None => None,
    };
    let saved = saved.as_ref();
    if let Some(bounds) = saved.and_then(|w| w.bounds) {
        if is_on_screen(&window, bounds) {
            apply_placement(&window, bounds);
        }
        if bounds.maximized {
            let _ = window.maximize();
        }
    }

    let mut registry = state.registry.lock().unwrap();
    if let Some(saved) = saved {
        // Bounds are always remembered; tabs only when session restore is on.
        let mut restored = saved.clone();
        if !restore_tabs {
            restored.tabs.clear();
            restored.active = 0;
            restored.folder = None;
        }
        restored.label = MAIN.to_string();
        registry.windows.insert(MAIN.to_string(), restored.clone());
        registry.restored = Some(restored);
    }
    registry.last_focused = Some(MAIN.to_string());
    drop(registry);
    let _ = window.show();
    let _ = window.set_focus();

    if !restore_tabs {
        return;
    }
    for saved in others {
        let label = state.registry.lock().unwrap().new_label(app);
        state.registry.lock().unwrap().pending.insert(
            label.clone(),
            PendingWindow {
                tabs: saved.tabs,
                active: saved.active,
                folder: saved.folder,
                transfers: Vec::new(),
            },
        );
        if let Err(error) = open_document_window(app, &label, saved.bounds, None) {
            log::error!("could not reopen a window from the last session: {error}");
        }
    }
    // The main window comes first, as at the end of the last session.
    let _ = window.set_focus();
}

/// A saved position is only used if part of the window is on a connected monitor.
fn is_on_screen(window: &WebviewWindow, bounds: Bounds) -> bool {
    let Ok(monitors) = window.available_monitors() else {
        return false;
    };
    monitors.iter().any(|monitor| {
        let pos = monitor.position();
        let size = monitor.size();
        let right = pos.x + size.width as i32;
        let bottom = pos.y + size.height as i32;
        bounds.x + 100 < right
            && bounds.x + bounds.width as i32 > pos.x + 100
            && bounds.y >= pos.y - 10
            && bounds.y + 40 < bottom
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Startup {
    /// Tabs from the previous session (empty when session restore is off).
    pub tabs: Vec<TabSession>,
    pub active: usize,
    /// Files named on the command line; they open after the restored tabs.
    pub paths: Vec<String>,
    /// Tabs moved here from another window.
    pub transfers: Vec<Value>,
    /// The folder the sidebar showed last time.
    pub folder: Option<String>,
}

/// Called once by a window when it is ready.
#[tauri::command]
pub fn take_startup(window: WebviewWindow, state: State<AppState>) -> Startup {
    let mut registry = state.registry.lock().unwrap();
    if window.label() != MAIN {
        let pending = registry.pending.remove(window.label()).unwrap_or_default();
        return Startup {
            tabs: pending.tabs,
            active: pending.active,
            paths: Vec::new(),
            transfers: pending.transfers,
            folder: pending.folder,
        };
    }
    let restored = registry.restored.take().unwrap_or_default();
    Startup {
        tabs: restored.tabs,
        active: restored.active,
        paths: std::mem::take(&mut registry.startup_paths),
        transfers: Vec::new(),
        folder: restored.folder,
    }
}

// ---------------------------------------------------------------------------
// Tabs and routing
// ---------------------------------------------------------------------------

/// A window reports its tabs whenever they change.
#[tauri::command]
pub fn report_tabs(
    window: WebviewWindow,
    state: State<AppState>,
    tabs: Vec<TabSession>,
    active: usize,
    folder: Option<String>,
) {
    {
        let mut registry = state.registry.lock().unwrap();
        let entry = registry
            .windows
            .entry(window.label().to_string())
            .or_insert_with(|| WindowSession {
                label: window.label().to_string(),
                ..Default::default()
            });
        entry.tabs = tabs;
        entry.active = active;
        entry.folder = folder;
    }
    save_session(&state);
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenRequest {
    paths: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusRequest {
    path: String,
}

/// Opens files: a file that is already open gets its tab activated (in whichever
/// window shows it); the rest open as new tabs in `target`.
pub fn route_open(app: &AppHandle, state: &AppState, target: &WebviewWindow, paths: Vec<String>) {
    let registry = state.registry.lock().unwrap();
    let mut to_open = Vec::new();
    for path in paths {
        let key = paths::key(Path::new(&path));
        match registry.window_showing(&key) {
            Some(label) => {
                let _ = app.emit_to(label.as_str(), "focus-document", FocusRequest { path });
                if let Some(window) = app.get_webview_window(&label) {
                    bring_to_front(&window);
                }
            }
            None => to_open.push(path),
        }
    }
    drop(registry);
    if !to_open.is_empty() {
        let _ = app.emit_to(
            target.label(),
            "open-documents",
            OpenRequest { paths: to_open },
        );
        bring_to_front(target);
    }
}

#[tauri::command]
pub fn open_paths(
    app: AppHandle,
    window: WebviewWindow,
    state: State<AppState>,
    paths: Vec<String>,
) {
    route_open(&app, &state, &window, paths);
}

/// A second `MDNote.exe "file.md"` was started: open the files here instead.
pub fn on_second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    let state = app.state::<AppState>();
    let paths = paths::file_arguments(&args, Path::new(&cwd));
    let target = state.registry.lock().unwrap().target_window(app);
    let Some(target) = target else { return };
    if paths.is_empty() {
        bring_to_front(&target);
    } else {
        route_open(app, &state, &target, paths);
    }
}

fn bring_to_front(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

// ---------------------------------------------------------------------------
// Quitting
// ---------------------------------------------------------------------------

/// File > Exit: every window closes (each asks about its unsaved documents),
/// and the next start brings them all back.
#[tauri::command]
pub fn quit_app(app: AppHandle, state: State<AppState>) {
    state.registry.lock().unwrap().quitting = true;
    for (label, window) in app.webview_windows() {
        if is_document_window(&label) {
            let _ = window.close();
        }
    }
}

/// A window refused to close (Cancel in a save question): MDNote is not quitting after all.
#[tauri::command]
pub fn cancel_quit(state: State<AppState>) {
    state.registry.lock().unwrap().quitting = false;
}

// ---------------------------------------------------------------------------
// Window events
// ---------------------------------------------------------------------------

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    match event {
        tauri::WindowEvent::Focused(true) if is_document_window(window.label()) => {
            state.registry.lock().unwrap().last_focused = Some(window.label().to_string());
        }
        tauri::WindowEvent::Moved(_)
        | tauri::WindowEvent::Resized(_)
        | tauri::WindowEvent::CloseRequested { .. } => {
            remember_bounds(window, &state);
        }
        tauri::WindowEvent::Destroyed => {
            if !is_document_window(window.label()) {
                return;
            }
            state.folders.forget(window.label());
            let others_open = app
                .webview_windows()
                .keys()
                .any(|label| label != window.label() && is_document_window(label));
            let mut registry = state.registry.lock().unwrap();
            if others_open {
                // Set aside: it comes back next time only if MDNote is quitting.
                if let Some(closed) = registry.windows.remove(window.label()) {
                    registry.closed.push((Instant::now(), closed));
                }
            } else {
                // The last window. The session keeps it, and the windows that closed
                // together with it: File > Exit, or several closed at once (such as
                // the taskbar's "Close all windows"). Windows closed earlier are gone.
                let quitting = registry.quitting;
                for (when, closed) in std::mem::take(&mut registry.closed) {
                    if quitting || when.elapsed() <= CLOSED_TOGETHER {
                        registry.windows.insert(closed.label.clone(), closed);
                    }
                }
            }
            drop(registry);
            save_session(&state);
            if !others_open {
                app.exit(0);
            }
        }
        _ => {}
    }
}

/// Remembers the window's size and position.
fn remember_bounds(window: &tauri::Window, state: &AppState) {
    if !is_document_window(window.label()) {
        return;
    }
    let Some(bounds) = placement(window) else {
        return;
    };
    let mut registry = state.registry.lock().unwrap();
    let entry = registry
        .windows
        .entry(window.label().to_string())
        .or_insert_with(|| WindowSession {
            label: window.label().to_string(),
            ..Default::default()
        });
    entry.bounds = Some(bounds);
}

/// The window's normal (not maximized or minimized) rectangle, and whether it is
/// maximized. Windows keeps the normal rectangle even while the window is
/// maximized, so restoring always gets a sensible un-maximized size.
fn placement(window: &tauri::Window) -> Option<Bounds> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, WINDOWPLACEMENT,
        WPF_RESTORETOMAXIMIZED,
    };
    let hwnd = window.hwnd().ok()?;
    let mut wp = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };
    // SAFETY: `hwnd` is this window's live handle and `wp.length` is set as required.
    unsafe { GetWindowPlacement(hwnd, &mut wp) }.ok()?;
    let rect = wp.rcNormalPosition;
    let maximized = wp.showCmd == SW_SHOWMAXIMIZED.0 as u32
        || (wp.showCmd == SW_SHOWMINIMIZED.0 as u32 && wp.flags.contains(WPF_RESTORETOMAXIMIZED));
    Some(Bounds {
        x: rect.left,
        y: rect.top,
        width: (rect.right - rect.left).max(0) as u32,
        height: (rect.bottom - rect.top).max(0) as u32,
        maximized,
    })
}

/// Sets the normal rectangle without showing the window (it is shown afterwards).
fn apply_placement(window: &WebviewWindow, bounds: Bounds) {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{SW_HIDE, SetWindowPlacement, WINDOWPLACEMENT};
    let Ok(hwnd) = window.hwnd() else { return };
    let wp = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        showCmd: SW_HIDE.0 as u32,
        rcNormalPosition: RECT {
            left: bounds.x,
            top: bounds.y,
            right: bounds.x + bounds.width as i32,
            bottom: bounds.y + bounds.height as i32,
        },
        ..Default::default()
    };
    // SAFETY: `hwnd` is this window's live handle and `wp` is fully initialized.
    if let Err(error) = unsafe { SetWindowPlacement(hwnd, &wp) } {
        log::warn!("could not restore the window position: {error}");
    }
}

pub fn load_session(state: &AppState) -> AppResult<Session> {
    Ok(state.storage.load(SESSION_FILE))
}
