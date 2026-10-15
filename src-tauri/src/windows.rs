//! Which window shows which documents, routing of files opened from Explorer,
//! and session restore (O1).
//!
//! Each window reports its tabs whenever they change. Rust uses that to
//! - switch to the existing tab when a file that is already open is opened again,
//! - send files opened from Explorer to the most recently used window, and
//! - write `session.json`, so the next start can restore windows and tabs.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::AppState;
use crate::error::AppResult;
use crate::paths;

pub const SESSION_FILE: &str = "session.json";
pub const MAIN: &str = "main";

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

#[derive(Default)]
pub struct Registry {
    pub windows: HashMap<String, WindowSession>,
    pub last_focused: Option<String>,
    /// Files named on the command line at start-up, handed to the main window once.
    pub startup_paths: Vec<String>,
    /// The saved session, handed to the main window once.
    pub restored: Option<WindowSession>,
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
    }
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

/// Restores the main window's size and position, then shows it.
pub fn restore_main_window(app: &AppHandle, state: &AppState, session: &Session) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let saved = session.windows.iter().find(|w| w.label == MAIN);
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
        let restore_tabs = state.prefs.lock().unwrap().restore_session;
        let mut restored = saved.clone();
        if !restore_tabs {
            restored.tabs.clear();
            restored.active = 0;
        }
        registry.windows.insert(MAIN.to_string(), restored.clone());
        registry.restored = Some(restored);
    }
    registry.last_focused = Some(MAIN.to_string());
    drop(registry);
    let _ = window.show();
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
}

/// Called once by a window when it is ready.
#[tauri::command]
pub fn take_startup(window: WebviewWindow, state: State<AppState>) -> Startup {
    let mut registry = state.registry.lock().unwrap();
    if window.label() != MAIN {
        return Startup {
            tabs: Vec::new(),
            active: 0,
            paths: Vec::new(),
        };
    }
    let restored = registry.restored.take().unwrap_or_default();
    Startup {
        tabs: restored.tabs,
        active: restored.active,
        paths: std::mem::take(&mut registry.startup_paths),
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
// Window events
// ---------------------------------------------------------------------------

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    match event {
        tauri::WindowEvent::Focused(true) if window.label() != crate::shell::PREFERENCES => {
            state.registry.lock().unwrap().last_focused = Some(window.label().to_string());
        }
        tauri::WindowEvent::Moved(_)
        | tauri::WindowEvent::Resized(_)
        | tauri::WindowEvent::CloseRequested { .. } => {
            remember_bounds(window, &state);
        }
        tauri::WindowEvent::Destroyed => {
            // The last window keeps its tabs in the session; others are forgotten.
            let others_open = app
                .webview_windows()
                .keys()
                .any(|label| label != window.label() && label != crate::shell::PREFERENCES);
            if others_open {
                state
                    .registry
                    .lock()
                    .unwrap()
                    .windows
                    .remove(window.label());
            }
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
    if window.label() == crate::shell::PREFERENCES {
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
