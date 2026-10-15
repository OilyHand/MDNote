//! Moving tabs between windows (O1): **Move to New Window**, tearing a tab off
//! by dragging it out of the tab bar, and dropping it on another window's tab
//! bar. The design was proven in Phase 0 (spike 1).
//!
//! The page reorders tabs inside its own tab bar. Once a tab is dragged out of
//! it, the page hands the tab over, and Rust follows the mouse across the whole
//! screen (the page gets no pointer events outside its window), then decides on
//! release where the tab goes. The tab (text, metadata and Undo history) travels
//! as JSON that Rust does not look into.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::windows::{PendingWindow, is_document_window, open_document_window};

/// The small label that follows the mouse while a tab is dragged.
pub const GHOST: &str = "tab-ghost";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabDrag {
    /// The moving tab, as the page packed it.
    tab: Value,
    doc_id: String,
    title: String,
    /// How many tabs the source window has, this one included.
    tab_count: usize,
    /// The tab bar's top and bottom edges, in CSS pixels from the top of the page.
    bar_top: f64,
    bar_bottom: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabAttach {
    tab: Value,
    /// Where it was dropped, to choose its place among the tabs.
    client_x: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabPlace {
    doc_id: String,
    client_x: f64,
}

/// Opens a new window that shows `tab` once it is ready.
fn open_with_tab(app: &AppHandle, tab: Value, position: Option<(i32, i32)>) -> AppResult<()> {
    let state = app.state::<AppState>();
    let label = state.registry.lock().unwrap().new_label(app);
    state.registry.lock().unwrap().pending.insert(
        label.clone(),
        PendingWindow {
            transfers: vec![tab],
            ..Default::default()
        },
    );
    open_document_window(app, &label, None, position)
        .map(|_| ())
        .map_err(|e| AppError::Internal(format!("could not open a window: {e}")))
}

/// The tab's right-click menu and File > Move Tab to New Window.
#[tauri::command]
pub async fn move_tab_to_new_window(
    app: AppHandle,
    window: WebviewWindow,
    tab: Value,
) -> AppResult<()> {
    let position = window.outer_position().ok().map(|p| (p.x + 40, p.y + 40));
    open_with_tab(&app, tab, position)
}

/// The page dragged a tab out of its tab bar: follow the mouse from here on.
#[tauri::command]
pub async fn start_tab_drag(app: AppHandle, window: WebviewWindow, drag: TabDrag) -> AppResult<()> {
    let ghost = ghost_window(&app, &drag.title);
    let source = window.label().to_string();
    std::thread::spawn(move || follow_mouse(app, source, drag, ghost));
    Ok(())
}

fn percent_encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The drag label, created the first time a tab is dragged and hidden afterwards.
fn ghost_window(app: &AppHandle, title: &str) -> Option<WebviewWindow> {
    if let Some(ghost) = app.get_webview_window(GHOST) {
        let title = serde_json::to_string(title).unwrap_or_default();
        let _ = ghost.eval(format!("window.setGhostTitle?.({title})"));
        return Some(ghost);
    }
    let url = format!("index.html?window=ghost&title={}", percent_encode(title));
    let ghost = WebviewWindowBuilder::new(app, GHOST, WebviewUrl::App(url.into()))
        .title("MDNote")
        .inner_size(240.0, 34.0)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .inspect_err(|error| log::warn!("no drag label: {error}"))
        .ok()?;
    let _ = ghost.set_ignore_cursor_events(true);
    Some(ghost)
}

fn follow_mouse(app: AppHandle, source: String, drag: TabDrag, ghost: Option<WebviewWindow>) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON};
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    // SAFETY: GetAsyncKeyState has no preconditions.
    let is_down = |key: i32| unsafe { (GetAsyncKeyState(key) as u16) & 0x8000 != 0 };

    if let Some(ghost) = &ghost {
        let _ = ghost.show();
    }
    let mut cursor = POINT::default();
    let cancelled = loop {
        // SAFETY: `cursor` is a valid POINT to write to.
        let _ = unsafe { GetCursorPos(&mut cursor) };
        if let Some(ghost) = &ghost {
            let _ = ghost.set_position(PhysicalPosition::new(cursor.x + 14, cursor.y + 14));
        }
        if is_down(VK_ESCAPE.0 as i32) {
            break true;
        }
        if !is_down(VK_LBUTTON.0 as i32) {
            break false;
        }
        std::thread::sleep(Duration::from_millis(8));
    };
    if let Some(ghost) = &ghost {
        let _ = ghost.hide();
    }
    let _ = app.emit_to(source.as_str(), "tab-drag-end", cancelled);
    if !cancelled {
        drop_tab(&app, &source, drag, cursor.x, cursor.y);
    }
}

fn drop_tab(app: &AppHandle, source: &str, drag: TabDrag, x: i32, y: i32) {
    let doc_id = drag.doc_id.clone();
    match window_under_cursor(app, x, y, drag.bar_top, drag.bar_bottom) {
        // Back onto its own tab bar: just a new place among the tabs.
        Some((target, client_x, true)) if target == source => {
            let _ = app.emit_to(source, "tab-reorder", TabPlace { doc_id, client_x });
        }
        // Onto another window's tab bar: the tab moves there.
        Some((target, client_x, true)) => {
            let attach = TabAttach {
                tab: drag.tab,
                client_x,
            };
            let _ = app.emit_to(target.as_str(), "tab-attach", attach);
            let _ = app.emit_to(source, "tab-detached", TabPlace { doc_id, client_x });
            if let Some(window) = app.get_webview_window(&target) {
                let _ = window.set_focus();
            }
        }
        // Anywhere else with the window's only tab: the window itself moves, as in Chrome.
        _ if drag.tab_count == 1 => {
            if let Some(window) = app.get_webview_window(source) {
                let _ = window.unmaximize();
                let _ = window.set_position(PhysicalPosition::new(x - 120, y - 50));
            }
        }
        // Anywhere else: a new window under the mouse.
        _ => match open_with_tab(app, drag.tab, Some((x - 120, y - 50))) {
            Ok(()) => {
                let place = TabPlace {
                    doc_id,
                    client_x: 0.0,
                };
                let _ = app.emit_to(source, "tab-detached", place);
            }
            Err(error) => log::error!("{error}"),
        },
    }
}

/// The topmost MDNote document window under the cursor: its label, the cursor's
/// x in CSS pixels, and whether the cursor is over its tab bar.
fn window_under_cursor(
    app: &AppHandle,
    x: i32,
    y: i32,
    bar_top: f64,
    bar_bottom: f64,
) -> Option<(String, f64, bool)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::{GA_ROOT, GetAncestor, WindowFromPoint};

    // SAFETY: plain Win32 queries with valid arguments.
    let root = unsafe { GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT) };
    for (label, window) in app.webview_windows() {
        if !is_document_window(&label) || window.hwnd().ok() != Some(root) {
            continue;
        }
        let origin = window.inner_position().ok()?;
        let scale = window.scale_factor().ok()?;
        let client_x = f64::from(x - origin.x) / scale;
        let client_y = f64::from(y - origin.y) / scale;
        // A little slack, so a drop just above or below the tabs still counts.
        let over_tab_bar = (bar_top - 8.0..bar_bottom + 8.0).contains(&client_y);
        return Some((label, client_x, over_tab_bar));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_are_encoded_for_the_ghost_address() {
        assert_eq!(percent_encode("a b.md"), "a%20b.md");
        assert_eq!(percent_encode("한"), "%ED%95%9C");
    }
}
