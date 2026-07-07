//! Cloud storage provider implementations
//!
//! This module provides support for various cloud storage providers
//! including OneDrive, Google Drive, and Dropbox.

pub mod auth_store;
pub mod dropbox;
pub mod googledrive;
pub mod onedrive;
pub mod provider;

// Re-export commonly used types
pub use provider::{
    AccountInfo, AuthResult, AuthToken, BackupIncludes, BackupInfo, BackupOptions, CloudProvider,
    CloudProviderType, ConflictResolution, FileInfo, RestoreConflict, RestoreResult, SyncConflict,
    SyncResult,
};

// Re-export auth store types
pub use auth_store::{AuthStore, CloudAuthProvider};

// Re-export provider configurations and implementations
pub use dropbox::{DropboxConfig, DropboxProvider};
pub use googledrive::{GoogleDriveConfig, GoogleDriveProvider};
pub use onedrive::{OneDriveConfig, OneDriveProvider};
