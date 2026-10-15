//! Small JSON files in `%APPDATA%\io.github.oilyhand.mdnote\`.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{AppError, AppResult};
use crate::files;

pub struct Storage {
    dir: PathBuf,
}

impl Storage {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    /// Reads `name`. A missing file gives `T::default()`. A broken file is kept as
    /// `<name>.bak` (so nothing is lost) and also gives the default.
    pub fn load<T: DeserializeOwned + Default>(&self, name: &str) -> T {
        let path = self.path(name);
        let Ok(bytes) = std::fs::read(&path) else {
            return T::default();
        };
        // Notepad and Windows PowerShell 5.1 save UTF-8 with a BOM; JSON parsers reject it.
        let json = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
        match serde_json::from_slice(json) {
            Ok(value) => value,
            Err(error) => {
                log::warn!(
                    "{} is not valid ({error}); keeping it as .bak",
                    path.display()
                );
                let _ = std::fs::rename(&path, backup_path(&path));
                T::default()
            }
        }
    }

    pub fn save<T: Serialize>(&self, name: &str, value: &T) -> AppResult<()> {
        std::fs::create_dir_all(&self.dir).map_err(|e| AppError::from_io(e, &self.dir))?;
        let json =
            serde_json::to_vec_pretty(value).map_err(|e| AppError::Internal(e.to_string()))?;
        files::safe_write(&self.path(name), &json)
    }
}

fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".bak");
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    type Data = BTreeMap<String, u32>;

    #[test]
    fn reads_json_with_or_without_a_bom() {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::new(dir.path().to_path_buf());
        std::fs::write(storage.path("plain.json"), br#"{"a":1}"#).unwrap();
        std::fs::write(storage.path("bom.json"), b"\xEF\xBB\xBF{\"a\":2}").unwrap();
        assert_eq!(storage.load::<Data>("plain.json")["a"], 1);
        assert_eq!(storage.load::<Data>("bom.json")["a"], 2);
    }

    #[test]
    fn keeps_a_broken_file_as_bak_and_uses_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::new(dir.path().to_path_buf());
        std::fs::write(storage.path("broken.json"), b"{ not json").unwrap();
        assert!(storage.load::<Data>("broken.json").is_empty());
        assert!(storage.path("broken.json.bak").exists());
        assert!(!storage.path("broken.json").exists());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::new(dir.path().join("new-folder"));
        let data: Data = [("x".to_string(), 7)].into();
        storage.save("data.json", &data).unwrap();
        assert_eq!(storage.load::<Data>("data.json"), data);
    }
}
