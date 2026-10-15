//! Path helpers. Windows paths are case-insensitive, so documents are compared by a key.

use std::path::{Path, PathBuf};

/// Resolves a command-line argument against the directory it was given in.
pub fn resolve(arg: &str, cwd: &Path) -> PathBuf {
    let path = Path::new(arg);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    dunce::canonicalize(&absolute).unwrap_or(absolute)
}

/// A key that is equal for two spellings of the same file
/// (different letter case, `.\` segments, or a relative path).
pub fn key(path: &Path) -> String {
    let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    canonical.to_string_lossy().to_lowercase()
}

/// Command-line arguments that name files (skips the program and any `--flags`).
pub fn file_arguments(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .map(|arg| resolve(arg, cwd).display().to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_ignore_case_and_relative_segments() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Note.md");
        std::fs::write(&file, "x").unwrap();
        let other_spelling = dir.path().join(".").join("NOTE.MD");
        assert_eq!(key(&file), key(&other_spelling));
    }

    #[test]
    fn file_arguments_skip_program_and_flags() {
        let dir = tempfile::tempdir().unwrap();
        let args = vec![
            "MDNote.exe".to_string(),
            "--flag".to_string(),
            "a.md".to_string(),
        ];
        let files = file_arguments(&args, dir.path());
        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("a.md"));
        assert!(Path::new(&files[0]).is_absolute());
    }
}
