//! Error types for Incrementum
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PlethoraError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("FSRS error: {0}")]
    Fsrs(#[from] fsrs::FSRSError),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Algorithm Arena preview is stale: {0}")]
    ArenaPreviewStale(String),

    #[error("Algorithm Arena custom interval is invalid: {0}")]
    ArenaInvalidInterval(String),

    #[error("Algorithm Arena is unavailable: {0}")]
    ArenaUnsupported(String),

    #[error("Algorithm Arena model selection is invalid: {0}")]
    ArenaInvalidModel(String),

    #[error("Algorithm Arena review was already committed: {0}")]
    ArenaAlreadyCommitted(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Integration error: {0}")]
    IntegrationError(String),

    /// An integration failed because the user is not authenticated (expired
    /// session, missing credentials, etc.). Serialized as a distinct
    /// `integration_auth_error` type so the frontend can offer a re-authenticate
    /// path rather than a generic error.
    #[error("Integration auth error: {0}")]
    IntegrationAuthError(String),

    #[error("Sync error: {0}")]
    SyncError(String),

    #[error("Shell error: {0}")]
    ShellError(String),
}

// Implement From<String> for PlethoraError
impl From<String> for PlethoraError {
    fn from(s: String) -> Self {
        PlethoraError::Internal(s)
    }
}

// Implement From<tauri_plugin_shell::Error> for PlethoraError
impl From<tauri_plugin_shell::Error> for PlethoraError {
    fn from(e: tauri_plugin_shell::Error) -> Self {
        PlethoraError::ShellError(e.to_string())
    }
}

// Implement From<tauri_plugin_notification::Error> for PlethoraError
impl From<tauri_plugin_notification::Error> for PlethoraError {
    fn from(e: tauri_plugin_notification::Error) -> Self {
        PlethoraError::Internal(e.to_string())
    }
}

// Implement From<anyhow::Error> for PlethoraError
impl From<anyhow::Error> for PlethoraError {
    fn from(e: anyhow::Error) -> Self {
        PlethoraError::Internal(e.to_string())
    }
}

impl serde::Serialize for PlethoraError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        use serde::ser::SerializeMap;

        let (type_name, message) = match self {
            Self::Database(e) => ("database", e.to_string()),
            Self::Io(e) => ("io", e.to_string()),
            Self::Serialization(e) => ("serialization", e.to_string()),
            Self::Fsrs(e) => ("fsrs", e.to_string()),
            Self::NotFound(msg) => ("not_found", msg.clone()),
            Self::InvalidInput(msg) => ("invalid_input", msg.clone()),
            Self::Validation(msg) => ("validation", msg.clone()),
            Self::ArenaPreviewStale(msg) => ("arena_preview_stale", msg.clone()),
            Self::ArenaInvalidInterval(msg) => ("arena_invalid_interval", msg.clone()),
            Self::ArenaUnsupported(msg) => ("arena_unsupported", msg.clone()),
            Self::ArenaInvalidModel(msg) => ("arena_invalid_model", msg.clone()),
            Self::ArenaAlreadyCommitted(msg) => ("arena_already_committed", msg.clone()),
            Self::Internal(msg) => ("internal", msg.clone()),
            Self::IntegrationError(msg) => ("integration_error", msg.clone()),
            Self::IntegrationAuthError(msg) => ("integration_auth_error", msg.clone()),
            Self::SyncError(msg) => ("sync_error", msg.clone()),
            Self::ShellError(msg) => ("shell_error", msg.clone()),
        };

        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("type", type_name)?;
        map.serialize_entry("message", &message)?;
        map.end()
    }
}

pub type Result<T> = std::result::Result<T, PlethoraError>;

// Type alias for backwards compatibility
pub use PlethoraError as AppError;
