//! Printing (O2, O9) on the document's paper.
//!
//! The browser's print dialog takes the paper from the printer's own settings,
//! not from the page, so an A4 note came out on Letter paper. MDNote has its
//! own Print dialog instead and hands WebView2 the paper, the margins and the
//! printer, as Word hands the page size to the printer.

use std::sync::mpsc::{Sender, channel};

use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_PRINT_COLOR_MODE, COREWEBVIEW2_PRINT_COLOR_MODE_COLOR,
    COREWEBVIEW2_PRINT_COLOR_MODE_DEFAULT, COREWEBVIEW2_PRINT_COLOR_MODE_GRAYSCALE,
    COREWEBVIEW2_PRINT_DUPLEX, COREWEBVIEW2_PRINT_DUPLEX_DEFAULT,
    COREWEBVIEW2_PRINT_DUPLEX_ONE_SIDED, COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_LONG_EDGE,
    COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_SHORT_EDGE, COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM,
    COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    COREWEBVIEW2_PRINT_STATUS, COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE,
    COREWEBVIEW2_PRINT_STATUS_SUCCEEDED, ICoreWebView2_2, ICoreWebView2_16,
    ICoreWebView2Controller, ICoreWebView2Environment6, ICoreWebView2PrintSettings2,
};
use webview2_com::PrintCompletedHandler;
use windows::Win32::Graphics::Printing::{
    EnumPrintersW, GetDefaultPrinterW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
    PRINTER_INFO_4W,
};
use windows::core::{HSTRING, Interface, PCWSTR, PWSTR};

use crate::error::{AppError, AppResult};

const MM_PER_INCH: f64 = 25.4;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Printers {
    pub names: Vec<String>,
    /// Windows' default printer, if there is one.
    pub default: Option<String>,
}

/// The installed printers, local and shared, sorted by name.
#[tauri::command]
pub fn list_printers() -> AppResult<Printers> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let (mut needed, mut count) = (0u32, 0u32);
    // SAFETY: the first call only reports the buffer size; the expected
    // "insufficient buffer" error is ignored.
    let _ = unsafe { EnumPrintersW(flags, PCWSTR::null(), 4, None, &mut needed, &mut count) };
    let mut names = Vec::new();
    if needed > 0 {
        // u64s keep the buffer aligned for the PRINTER_INFO_4W records.
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        // SAFETY: the buffer holds `needed` bytes, as the first call asked.
        let bytes = unsafe {
            std::slice::from_raw_parts_mut(buffer.as_mut_ptr().cast::<u8>(), needed as usize)
        };
        // SAFETY: as above; Windows fills the buffer and reports the count.
        unsafe {
            EnumPrintersW(
                flags,
                PCWSTR::null(),
                4,
                Some(bytes),
                &mut needed,
                &mut count,
            )
        }
        .map_err(|e| AppError::Internal(format!("listing printers: {e}")))?;
        // SAFETY: Windows wrote `count` records at the start of the buffer; their
        // strings point into the same buffer, which outlives this loop.
        let infos = unsafe {
            std::slice::from_raw_parts(buffer.as_ptr().cast::<PRINTER_INFO_4W>(), count as usize)
        };
        for info in infos {
            // SAFETY: a null-terminated string inside the buffer (see above).
            if let Ok(name) = unsafe { info.pPrinterName.to_string() } {
                names.push(name);
            }
        }
    }
    names.sort_by_key(|n| n.to_lowercase());
    Ok(Printers {
        names,
        default: default_printer(),
    })
}

fn default_printer() -> Option<String> {
    let mut len = 0u32;
    // SAFETY: the first call only reports the length, in characters.
    let _ = unsafe { GetDefaultPrinterW(None, &mut len) };
    if len == 0 {
        return None;
    }
    let mut buffer = vec![0u16; len as usize];
    // SAFETY: the buffer holds `len` characters, as the first call asked.
    let ok = unsafe { GetDefaultPrinterW(Some(PWSTR(buffer.as_mut_ptr())), &mut len) };
    ok.as_bool()
        .then(|| String::from_utf16_lossy(&buffer[..len.saturating_sub(1) as usize]))
}

/// What to print: the printer, the copies and pages, and the document's page.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRequest {
    pub printer: String,
    pub copies: u32,
    /// Pages such as "1-3, 5"; empty for all of them.
    pub pages: String,
    /// The paper upright, in mm; `landscape` turns it.
    pub paper_width: f64,
    pub paper_height: f64,
    pub landscape: bool,
    /// Top, right, bottom and left, in mm.
    pub margins: [f64; 4],
    pub sides: Sides,
    pub color: ColorMode,
}

/// One or both sides of the paper; `Printer` leaves it to the printer's setting.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Sides {
    Printer,
    OneSided,
    LongEdge,
    ShortEdge,
}

impl Sides {
    fn duplex(&self) -> COREWEBVIEW2_PRINT_DUPLEX {
        match self {
            Sides::Printer => COREWEBVIEW2_PRINT_DUPLEX_DEFAULT,
            Sides::OneSided => COREWEBVIEW2_PRINT_DUPLEX_ONE_SIDED,
            Sides::LongEdge => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_LONG_EDGE,
            Sides::ShortEdge => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_SHORT_EDGE,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorMode {
    Printer,
    Color,
    Grayscale,
}

impl ColorMode {
    fn mode(&self) -> COREWEBVIEW2_PRINT_COLOR_MODE {
        match self {
            ColorMode::Printer => COREWEBVIEW2_PRINT_COLOR_MODE_DEFAULT,
            ColorMode::Color => COREWEBVIEW2_PRINT_COLOR_MODE_COLOR,
            ColorMode::Grayscale => COREWEBVIEW2_PRINT_COLOR_MODE_GRAYSCALE,
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PrintOutcome {
    Printed,
    PrinterUnavailable,
}

/// Prints the window's rendered page (its print style sheet) as requested.
#[tauri::command]
pub async fn print_document(
    window: WebviewWindow,
    request: PrintRequest,
) -> AppResult<PrintOutcome> {
    let (done, outcome) = channel();
    window
        .with_webview(move |webview| {
            let failed = done.clone();
            if let Err(e) = start_print(&webview.controller(), &request, done) {
                let _ = failed.send(Err(AppError::Internal(format!("printing: {e}"))));
            }
        })
        .map_err(|e| AppError::Internal(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || outcome.recv())
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .map_err(|_| AppError::Internal("printing stopped without an answer".into()))?
}

fn start_print(
    controller: &ICoreWebView2Controller,
    request: &PrintRequest,
    done: Sender<AppResult<PrintOutcome>>,
) -> windows::core::Result<()> {
    let inches = |mm: f64| mm / MM_PER_INCH;
    let [top, right, bottom, left] = request.margins;
    // SAFETY: WebView2 calls made on the window's UI thread (with_webview runs
    // there), with settings objects created by the same environment.
    unsafe {
        let webview = controller.CoreWebView2()?;
        let environment = webview
            .cast::<ICoreWebView2_2>()?
            .Environment()?
            .cast::<ICoreWebView2Environment6>()?;
        let settings = environment.CreatePrintSettings()?;
        settings.SetOrientation(if request.landscape {
            COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
        } else {
            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
        })?;
        settings.SetPageWidth(inches(request.paper_width))?;
        settings.SetPageHeight(inches(request.paper_height))?;
        settings.SetMarginTop(inches(top))?;
        settings.SetMarginRight(inches(right))?;
        settings.SetMarginBottom(inches(bottom))?;
        settings.SetMarginLeft(inches(left))?;
        settings.SetScaleFactor(1.0)?;
        settings.SetShouldPrintBackgrounds(true)?;
        settings.SetShouldPrintHeaderAndFooter(false)?;
        let more = settings.cast::<ICoreWebView2PrintSettings2>()?;
        // The paper comes from the page size above, not from the printer's settings.
        more.SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)?;
        more.SetPrinterName(&HSTRING::from(request.printer.as_str()))?;
        more.SetCopies(request.copies.clamp(1, 999) as i32)?;
        more.SetDuplex(request.sides.duplex())?;
        more.SetColorMode(request.color.mode())?;
        if !request.pages.trim().is_empty() {
            more.SetPageRanges(&HSTRING::from(request.pages.trim()))?;
        }
        let handler = PrintCompletedHandler::create(Box::new(
            move |result: windows::core::Result<()>, status: COREWEBVIEW2_PRINT_STATUS| {
                let _ = done.send(match result {
                    Err(e) => Err(AppError::Internal(format!("printing: {e}"))),
                    Ok(()) => outcome(status),
                });
                Ok(())
            },
        ));
        webview
            .cast::<ICoreWebView2_16>()?
            .Print(&settings, &handler)?;
    }
    Ok(())
}

fn outcome(status: COREWEBVIEW2_PRINT_STATUS) -> AppResult<PrintOutcome> {
    if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED {
        Ok(PrintOutcome::Printed)
    } else if status == COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE {
        Ok(PrintOutcome::PrinterUnavailable)
    } else {
        Err(AppError::Internal(format!(
            "printing failed ({})",
            status.0
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn printers_are_listed() {
        let printers = list_printers().unwrap();
        if let Some(default) = &printers.default {
            assert!(printers.names.contains(default), "{printers:?}");
        }
    }
}
