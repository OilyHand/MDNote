//! Reading and writing text files without losing their encoding or line endings.
//!
//! The editor always works with `\n`. On load the original encoding and line
//! ending are detected and returned with the text; on save they are applied
//! again, so an untouched file is written back byte for byte.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
const UTF16LE_BOM: &[u8] = &[0xFF, 0xFE];
const UTF16BE_BOM: &[u8] = &[0xFE, 0xFF];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TextEncoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    /// A Windows "ANSI" code page, e.g. 949 (Korean) or 1252 (Western European).
    Ansi {
        codepage: u16,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

/// Identifies one version of a file on disk, to notice changes made by other programs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub modified_ms: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFile {
    pub path: String,
    /// The text with `\n` line breaks only.
    pub text: String,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
    pub stamp: FileStamp,
    /// The file was not UTF-8 or UTF-16 and was read with the system's ANSI code page.
    pub ansi_fallback: bool,
    /// The file used both CRLF and LF; it will be saved with `line_ending` throughout.
    pub mixed_line_endings: bool,
}

/// Line ending for documents that have none yet (new or single-line files).
/// CRLF matches Notepad and other Windows programs.
pub const DEFAULT_LINE_ENDING: LineEnding = LineEnding::Crlf;

pub fn read_document(path: &Path) -> AppResult<LoadedFile> {
    let bytes = fs::read(path).map_err(|e| AppError::from_io(e, path))?;
    let (text, encoding, ansi_fallback) = decode(&bytes, system_ansi_codepage());
    let (line_ending, mixed_line_endings) = detect_line_ending(&text);
    Ok(LoadedFile {
        path: path.display().to_string(),
        text: normalize_line_endings(&text),
        encoding,
        line_ending,
        stamp: stamp(path)?,
        ansi_fallback,
        mixed_line_endings,
    })
}

pub fn write_document(
    path: &Path,
    text: &str,
    encoding: TextEncoding,
    line_ending: LineEnding,
) -> AppResult<FileStamp> {
    let bytes = encode(text, encoding, line_ending)?;
    safe_write(path, &bytes)?;
    stamp(path)
}

pub fn stamp(path: &Path) -> AppResult<FileStamp> {
    let meta = fs::metadata(path).map_err(|e| AppError::from_io(e, path))?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStamp {
        modified_ms,
        size: meta.len(),
    })
}

// ---------------------------------------------------------------------------
// Decoding and encoding
// ---------------------------------------------------------------------------

/// Returns the text, its encoding, and whether the ANSI fallback was used.
pub fn decode(bytes: &[u8], ansi_codepage: u16) -> (String, TextEncoding, bool) {
    if let Some(rest) = bytes.strip_prefix(UTF8_BOM) {
        return (
            String::from_utf8_lossy(rest).into_owned(),
            TextEncoding::Utf8Bom,
            false,
        );
    }
    if let Some(rest) = bytes.strip_prefix(UTF16LE_BOM) {
        return (
            decode_utf16(rest, u16::from_le_bytes),
            TextEncoding::Utf16Le,
            false,
        );
    }
    if let Some(rest) = bytes.strip_prefix(UTF16BE_BOM) {
        return (
            decode_utf16(rest, u16::from_be_bytes),
            TextEncoding::Utf16Be,
            false,
        );
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return (text.to_owned(), TextEncoding::Utf8, false);
    }
    let encoding = ansi_encoding(ansi_codepage);
    let (text, _) = encoding.decode_without_bom_handling(bytes);
    (
        text.into_owned(),
        TextEncoding::Ansi {
            codepage: ansi_codepage,
        },
        true,
    )
}

fn decode_utf16(bytes: &[u8], to_unit: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| to_unit([pair[0], pair[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

/// Encodes `\n`-separated text with the given encoding and line ending.
pub fn encode(text: &str, encoding: TextEncoding, line_ending: LineEnding) -> AppResult<Vec<u8>> {
    let text = match line_ending {
        LineEnding::Lf => text.to_owned(),
        LineEnding::Crlf => text.replace('\n', "\r\n"),
    };
    Ok(match encoding {
        TextEncoding::Utf8 => text.into_bytes(),
        TextEncoding::Utf8Bom => [UTF8_BOM, text.as_bytes()].concat(),
        TextEncoding::Utf16Le => encode_utf16(&text, UTF16LE_BOM, u16::to_le_bytes),
        TextEncoding::Utf16Be => encode_utf16(&text, UTF16BE_BOM, u16::to_be_bytes),
        TextEncoding::Ansi { codepage } => {
            let encoding = ansi_encoding(codepage);
            let (bytes, _, unmappable) = encoding.encode(&text);
            // encoding_rs would replace such characters with "&#NNNN;". Refuse instead,
            // so the user can choose to save as UTF-8.
            if unmappable {
                return Err(AppError::Unmappable(encoding.name().to_owned()));
            }
            bytes.into_owned()
        }
    })
}

fn encode_utf16(text: &str, bom: &[u8], to_bytes: fn(u16) -> [u8; 2]) -> Vec<u8> {
    let mut out = bom.to_vec();
    out.extend(text.encode_utf16().flat_map(to_bytes));
    out
}

fn ansi_encoding(codepage: u16) -> &'static encoding_rs::Encoding {
    codepage::to_encoding(codepage).unwrap_or(encoding_rs::WINDOWS_1252)
}

/// The code page Windows uses for "ANSI" text, e.g. 949 on Korean Windows.
pub fn system_ansi_codepage() -> u16 {
    // SAFETY: GetACP has no preconditions.
    unsafe { windows::Win32::Globalization::GetACP() as u16 }
}

// ---------------------------------------------------------------------------
// Line endings
// ---------------------------------------------------------------------------

/// Returns the line ending to save with, and whether the text mixes several kinds.
pub fn detect_line_ending(text: &str) -> (LineEnding, bool) {
    let crlf = text.matches("\r\n").count();
    let cr = text.matches('\r').count() - crlf;
    let lf = text.matches('\n').count() - crlf;
    let kinds = [crlf, lf, cr].iter().filter(|&&n| n > 0).count();
    let line_ending = match (crlf, lf) {
        (0, 0) => DEFAULT_LINE_ENDING,
        (crlf, lf) if crlf >= lf => LineEnding::Crlf,
        _ => LineEnding::Lf,
    };
    (line_ending, kinds > 1)
}

pub fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

// ---------------------------------------------------------------------------
// Safe writing
// ---------------------------------------------------------------------------

static TEMP_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Writes `bytes` to a temporary file next to `path`, then swaps it in.
/// A crash at any point leaves either the old file or the new one, never a
/// half-written file. `ReplaceFileW` keeps the original's attributes,
/// permissions and creation time.
pub fn safe_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Ok(meta) = fs::metadata(path) {
        if meta.permissions().readonly() {
            return Err(AppError::ReadOnly(path.display().to_string()));
        }
    }
    let temp = temp_path(path);
    let result = write_temp(&temp, bytes).and_then(|()| {
        if path.exists() {
            replace_file(path, &temp)
        } else {
            fs::rename(&temp, path).map_err(|e| AppError::from_io(e, path))
        }
    });
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    path.with_file_name(format!(".{name}.{}-{n}.mdnote-tmp", std::process::id()))
}

fn write_temp(temp: &Path, bytes: &[u8]) -> AppResult<()> {
    let mut file: File = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp)
        .map_err(|e| AppError::from_io(e, temp))?;
    file.write_all(bytes)
        .map_err(|e| AppError::from_io(e, temp))?;
    file.sync_all().map_err(|e| AppError::from_io(e, temp))
}

fn replace_file(target: &Path, replacement: &Path) -> AppResult<()> {
    use windows::Win32::Storage::FileSystem::{
        REPLACEFILE_IGNORE_ACL_ERRORS, REPLACEFILE_IGNORE_MERGE_ERRORS, ReplaceFileW,
    };
    use windows::core::HSTRING;

    let target_w = HSTRING::from(target.as_os_str());
    let replacement_w = HSTRING::from(replacement.as_os_str());
    // SAFETY: both strings are valid, NUL-terminated paths that outlive the call.
    unsafe {
        ReplaceFileW(
            &target_w,
            &replacement_w,
            None,
            REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_IGNORE_ACL_ERRORS,
            None,
            None,
        )
    }
    .map_err(|e| {
        let io = std::io::Error::from_raw_os_error(e.code().0 & 0xFFFF);
        AppError::from_io(io, target)
    })
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/encoding")
            .join(name);
        fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    /// Decoding a fixture and encoding it again must give back the same bytes.
    fn assert_round_trip(name: &str, expected: TextEncoding, expected_eol: LineEnding) {
        let bytes = fixture(name);
        let (text, encoding, _) = decode(&bytes, 949);
        let (eol, mixed) = detect_line_ending(&text);
        assert_eq!(encoding, expected, "{name}: encoding");
        assert_eq!(eol, expected_eol, "{name}: line ending");
        assert!(!mixed, "{name}: should not be mixed");
        assert!(text.contains("한글"), "{name}: Korean text decoded");
        let normalized = normalize_line_endings(&text);
        assert_eq!(
            encode(&normalized, encoding, eol).unwrap(),
            bytes,
            "{name}: round trip"
        );
    }

    #[test]
    fn round_trips_every_supported_encoding() {
        assert_round_trip("utf8-lf.md", TextEncoding::Utf8, LineEnding::Lf);
        assert_round_trip("utf8-crlf.md", TextEncoding::Utf8, LineEnding::Crlf);
        assert_round_trip("utf8-bom.md", TextEncoding::Utf8Bom, LineEnding::Crlf);
        assert_round_trip("utf16le.md", TextEncoding::Utf16Le, LineEnding::Crlf);
        assert_round_trip("utf16be.md", TextEncoding::Utf16Be, LineEnding::Lf);
        assert_round_trip(
            "cp949.md",
            TextEncoding::Ansi { codepage: 949 },
            LineEnding::Crlf,
        );
    }

    #[test]
    fn ansi_fallback_is_reported() {
        let (_, _, fallback) = decode(&fixture("cp949.md"), 949);
        assert!(fallback);
        let (_, _, fallback) = decode(&fixture("utf8-lf.md"), 949);
        assert!(!fallback);
    }

    #[test]
    fn mixed_line_endings_pick_the_majority() {
        assert_eq!(
            detect_line_ending("a\r\nb\r\nc\n"),
            (LineEnding::Crlf, true)
        );
        assert_eq!(detect_line_ending("a\nb\nc\r\n"), (LineEnding::Lf, true));
        assert_eq!(detect_line_ending("one line"), (DEFAULT_LINE_ENDING, false));
        assert_eq!(normalize_line_endings("a\r\nb\rc\n"), "a\nb\nc\n");
    }

    /// Phase 1 hands-on test 19: the exact bytes Notepad wrote (two trailing line
    /// breaks after an emoji) must read as written and save back unchanged.
    #[test]
    fn trailing_blank_lines_after_emoji_round_trip() {
        let bytes = "Hello World!!!\r\n안녕하세요!\r\n🤣\r\n\r\n".as_bytes();
        let (text, encoding, _) = decode(bytes, 949);
        let (eol, mixed) = detect_line_ending(&text);
        let normalized = normalize_line_endings(&text);
        assert_eq!(normalized, "Hello World!!!\n안녕하세요!\n🤣\n\n");
        assert_eq!(
            (encoding, eol, mixed),
            (TextEncoding::Utf8, LineEnding::Crlf, false)
        );
        assert_eq!(encode(&normalized, encoding, eol).unwrap(), bytes);
    }

    #[test]
    fn plain_crlf_with_emoji_is_unchanged() {
        let text = "🤣\r\n하하하\r\n";
        assert_eq!(normalize_line_endings(text), "🤣\n하하하\n");
        assert_eq!(detect_line_ending(text), (LineEnding::Crlf, false));
    }

    #[test]
    fn ansi_refuses_characters_it_cannot_store() {
        let result = encode(
            "emoji 😀",
            TextEncoding::Ansi { codepage: 949 },
            LineEnding::Lf,
        );
        assert!(matches!(result, Err(AppError::Unmappable(_))));
    }

    #[test]
    fn safe_write_creates_and_replaces_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");

        safe_write(&path, b"first").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"first");

        safe_write(&path, "두 번째".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "두 번째");

        // No temporary files are left behind.
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".mdnote-tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn safe_write_refuses_read_only_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("locked.md");
        fs::write(&path, b"keep me").unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions.clone()).unwrap();

        assert!(matches!(
            safe_write(&path, b"new"),
            Err(AppError::ReadOnly(_))
        ));
        assert_eq!(fs::read(&path).unwrap(), b"keep me");

        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        fs::set_permissions(&path, permissions).unwrap();
    }

    #[test]
    fn write_document_applies_encoding_and_line_endings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        write_document(&path, "가\n나\n", TextEncoding::Utf8Bom, LineEnding::Crlf).unwrap();
        assert_eq!(
            fs::read(&path).unwrap(),
            [UTF8_BOM, "가\r\n나\r\n".as_bytes()].concat()
        );

        let loaded = read_document(&path).unwrap();
        assert_eq!(loaded.text, "가\n나\n");
        assert_eq!(loaded.encoding, TextEncoding::Utf8Bom);
        assert_eq!(loaded.line_ending, LineEnding::Crlf);
    }
}
