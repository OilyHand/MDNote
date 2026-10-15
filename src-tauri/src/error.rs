//! Errors returned to the frontend.
//!
//! Every command returns `Result<T, AppError>`. The frontend receives
//! `{ code, detail }`, translates `code` into the user's language and shows it,
//! so no failure is ever silent (see the Phase 1 lessons in ImplementationPlan.md).

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("file not found: {0}")]
    NotFound(String),
    #[error("access denied: {0}")]
    AccessDenied(String),
    #[error("the file is read-only: {0}")]
    ReadOnly(String),
    #[error("the text contains characters that {0} cannot store")]
    Unmappable(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    fn code(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "notFound",
            AppError::AccessDenied(_) => "accessDenied",
            AppError::ReadOnly(_) => "readOnly",
            AppError::Unmappable(_) => "unmappable",
            AppError::Io(_) => "io",
            AppError::Internal(_) => "internal",
        }
    }

    /// Wraps an I/O error, keeping the path so the message can name the file.
    pub fn from_io(error: std::io::Error, path: &std::path::Path) -> Self {
        let path = path.display().to_string();
        match error.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound(path),
            std::io::ErrorKind::PermissionDenied => AppError::AccessDenied(path),
            _ => AppError::Io(format!("{path}: {error}")),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let detail = match self {
            AppError::NotFound(s)
            | AppError::AccessDenied(s)
            | AppError::ReadOnly(s)
            | AppError::Unmappable(s)
            | AppError::Io(s)
            | AppError::Internal(s) => s,
        };
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("detail", detail)?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
