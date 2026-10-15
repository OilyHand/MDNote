//! Paths the preview needs: images and links written relative to the document.
//!
//! Images are shown through Tauri's asset protocol. Each image file that a
//! document refers to is allowed one by one, so the page can load the note's
//! images but not arbitrary files.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico",
];

/// Web addresses and inline data are loaded by the page itself.
fn is_web(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    ["http://", "https://", "data:", "mailto:", "#"]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

/// Decodes `%XX` sequences (Markdown destinations are percent-encoded).
fn percent_decode(text: &str) -> String {
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(high * 16 + low);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Resolves a link or image target against the document's folder.
pub fn resolve(document: &Path, target: &str) -> Option<PathBuf> {
    if is_web(target) {
        return None;
    }
    // Drop "#heading" and "?query" parts.
    let target = target.split(['#', '?']).next().unwrap_or_default();
    if target.is_empty() {
        return None;
    }
    let target = percent_decode(target);
    let target = target
        .strip_prefix("file:///")
        .or_else(|| target.strip_prefix("file://"))
        .unwrap_or(&target);
    let path = Path::new(target);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        document.parent()?.join(path)
    };
    Some(dunce::canonicalize(&absolute).unwrap_or(absolute))
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// For each image source: the image file's path (now allowed for the page), or
/// null for web images and files that don't exist.
#[tauri::command]
pub fn resolve_images(
    app: AppHandle,
    document: Option<String>,
    sources: Vec<String>,
) -> Vec<Option<String>> {
    let Some(document) = document else {
        return vec![None; sources.len()];
    };
    let scope = app.asset_protocol_scope();
    sources
        .iter()
        .map(|source| {
            let path = resolve(Path::new(&document), source)?;
            if !is_image(&path) || !path.is_file() {
                return None;
            }
            scope.allow_file(&path).ok()?;
            Some(path.display().to_string())
        })
        .collect()
}

/// The file a link points to, if it exists (for links to other notes).
#[tauri::command]
pub fn resolve_link(document: Option<String>, target: String) -> Option<String> {
    let path = resolve(Path::new(&document?), &target)?;
    path.is_file().then(|| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_encoded_and_file_urls() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("note.md");
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        let image = dir.path().join("assets").join("그림 1.png");
        std::fs::write(&image, b"png").unwrap();
        let expected = dunce::canonicalize(&image).unwrap();

        let encoded = "assets/%EA%B7%B8%EB%A6%BC%201.png";
        assert_eq!(resolve(&doc, encoded), Some(expected.clone()));
        assert_eq!(
            resolve(&doc, "./assets/그림 1.png?v=2#x"),
            Some(expected.clone())
        );
        let url = format!(
            "file:///{}",
            expected.display().to_string().replace('\\', "/")
        );
        assert_eq!(resolve(&doc, &url), Some(expected));
    }

    #[test]
    fn leaves_web_targets_alone() {
        let doc = Path::new("C:\\notes\\note.md");
        assert_eq!(resolve(doc, "https://example.com/a.png"), None);
        assert_eq!(resolve(doc, "#heading"), None);
        assert_eq!(resolve(doc, "data:image/png;base64,AAAA"), None);
    }

    #[test]
    fn decodes_percent_sequences() {
        assert_eq!(percent_decode("a%20b%2"), "a b%2");
        assert_eq!(percent_decode("%ED%95%9C"), "한");
        assert_eq!(percent_decode("%한%"), "%한%"); // never panics on non-ASCII
    }
}
