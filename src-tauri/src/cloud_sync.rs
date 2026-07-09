//! Cloud Sync Manager
//!
//! Handles two-way synchronization between local data and cloud storage

use chrono::{DateTime, Utc};
use futures::future::try_join_all;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::cloud::{CloudProvider, ConflictResolution, SyncConflict, SyncResult};
use crate::database::Database;
use crate::error::AppError;

/// Maximum number of concurrent upload/download operations during two-way sync.
/// Capped to avoid overwhelming the cloud provider (rate limits / connection
/// ceilings). 8 is a reasonable default for typical cloud storage APIs.
const SYNC_CONCURRENCY: usize = 8;

/// Direction of a sync change batch, used by `run_change_batch`.
#[derive(Clone, Copy)]
enum ChangeDirection {
    Upload,
    Download,
}

/// Cloud sync manager
pub struct CloudSyncManager {
    db: Database,
    provider: Option<Box<dyn CloudProvider>>,
    device_id: String,
    sync_state: Arc<RwLock<CloudSyncState>>,
}

/// Cloud sync state
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CloudSyncState {
    last_sync: Option<DateTime<Utc>>,
    sync_version: u64,
    last_synced_documents: HashMap<String, String>, // doc_id -> version_hash
    pending_conflicts: Vec<SyncConflict>,
}

impl CloudSyncManager {
    /// Create a new cloud sync manager
    pub fn new(db: Database) -> Result<Self, AppError> {
        let device_id = Self::get_device_id();
        Ok(Self {
            db,
            provider: None,
            device_id,
            sync_state: Arc::new(RwLock::new(CloudSyncState::default())),
        })
    }

    /// Set the cloud provider
    pub async fn set_provider(&mut self, provider: Box<dyn CloudProvider>) {
        self.provider = Some(provider);
    }

    /// Get the device ID
    fn get_device_id() -> String {
        format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time before UNIX epoch")
                .as_secs()
        )
    }

    /// Perform two-way sync
    pub async fn two_way_sync(&mut self) -> Result<SyncResult, AppError> {
        let start_time = std::time::Instant::now();
        let provider_box = self
            .provider
            .as_ref()
            .ok_or_else(|| AppError::Internal("No cloud provider configured".to_string()))?;

        // Convert Box<dyn CloudProvider> to &dyn CloudProvider
        let provider: &dyn CloudProvider = provider_box.as_ref();

        if !provider.is_authenticated() {
            return Err(AppError::Internal(
                "Cloud provider not authenticated".to_string(),
            ));
        }

        // 1. Get local changes
        let local_changes = self.get_local_changes().await?;

        // 2. Get remote changes
        let remote_changes = self.get_remote_changes(provider).await?;

        // 3. Detect conflicts
        let conflicts = self
            .detect_conflicts(&local_changes, &remote_changes)
            .await?;

        // 4. Upload local changes (parallelized with bounded concurrency)
        //
        // Previously this awaited each `upload_change` serially. Uploads are
        // independent, so we run them concurrently, capped at
        // `SYNC_CONCURRENCY` in flight. The work is delegated to
        // `run_change_batch` so `self` and `provider` are passed as two
        // distinct parameters (not derived one from the other), which lets the
        // per-change futures borrow both without conflicting borrows of `self`.
        // `try_join_all` short-circuits on the first error, matching the
        // original `?`-bail.
        let uploaded = self
            .run_change_batch(provider, &local_changes, &conflicts, ChangeDirection::Upload)
            .await?;

        // 5. Download remote changes (parallelized with bounded concurrency)
        let downloaded = self
            .run_change_batch(provider, &remote_changes, &conflicts, ChangeDirection::Download)
            .await?;

        // 6. Update sync state
        let mut state = self.sync_state.write().await;
        state.last_sync = Some(Utc::now());
        state.sync_version += 1;

        let duration = start_time.elapsed().as_secs();

        Ok(SyncResult {
            success: true,
            uploaded,
            downloaded,
            conflicts,
            error: None,
            duration_secs: duration,
        })
    }

    /// Get local changes since last sync
    async fn get_local_changes(&self) -> Result<Vec<SyncChange>, AppError> {
        let state = self.sync_state.read().await;
        let _last_sync = state.last_sync;

        // TODO: Get all documents modified since last sync
        // For now, return empty changes
        let documents: Vec<crate::models::Document> = vec![];

        let mut changes = Vec::new();

        for doc in documents {
            let doc_modified = doc.date_modified;

            // Include all documents for now
            changes.push(SyncChange {
                item_id: doc.id.clone(),
                item_type: "document".to_string(),
                local_modified: Some(doc_modified),
                remote_modified: None,
                change_type: ChangeType::Modified,
                data: SyncData::Document {
                    id: doc.id.clone(),
                    title: doc.title.clone(),
                    file_path: Some(doc.file_path.clone()),
                    metadata: None,
                },
            });
        }

        Ok(changes)
    }

    /// Get remote changes from cloud
    async fn get_remote_changes(
        &self,
        provider: &dyn CloudProvider,
    ) -> Result<Vec<SyncChange>, AppError> {
        let state = self.sync_state.read().await;
        let last_sync = state.last_sync;

        // List files from cloud
        let files = provider.list_files("/sync").await?;

        let mut changes = Vec::new();

        for file in files {
            if file.is_folder {
                continue;
            }

            let file_modified = file.modified_time;

            // Include if modified after last sync
            let should_include = match last_sync {
                Some(last) => file_modified > last,
                None => true,
            };

            if should_include {
                changes.push(SyncChange {
                    item_id: file.id.clone(),
                    item_type: "document".to_string(),
                    local_modified: None,
                    remote_modified: Some(file_modified),
                    change_type: ChangeType::Modified,
                    data: SyncData::RemoteFile {
                        id: file.id,
                        name: file.name,
                        path: file.path,
                        size: file.size,
                    },
                });
            }
        }

        Ok(changes)
    }

    /// Detect conflicts between local and remote changes
    async fn detect_conflicts(
        &self,
        local_changes: &[SyncChange],
        remote_changes: &[SyncChange],
    ) -> Result<Vec<SyncConflict>, AppError> {
        let mut conflicts = Vec::new();

        let remote_map: HashMap<&str, &SyncChange> = remote_changes
            .iter()
            .filter_map(|c| {
                if let SyncData::RemoteFile { id, .. } = &c.data {
                    Some((id.as_str(), c))
                } else {
                    None
                }
            })
            .collect();

        for local in local_changes {
            if let SyncData::Document { id, .. } = &local.data {
                if let Some(remote) = remote_map.get(id.as_str()) {
                    // Both local and remote have changes - conflict!
                    conflicts.push(SyncConflict {
                        item_id: id.clone(),
                        item_type: "document".to_string(),
                        local_modified: local.local_modified.unwrap_or_else(Utc::now),
                        remote_modified: remote.remote_modified.unwrap_or_else(Utc::now),
                    });
                }
            }
        }

        Ok(conflicts)
    }

    /// Check if a change is conflicted
    fn is_conflicted(&self, change: &SyncChange, conflicts: &[SyncConflict]) -> bool {
        conflicts.iter().any(|c| c.item_id == change.item_id)
    }

    /// Run a batch of (upload or download) changes concurrently, bounded by
    /// `SYNC_CONCURRENCY`. Non-conflicted changes are cloned into owned
    /// `SyncChange`s so each per-change future owns its change and only borrows
    /// `self` and `provider` (both passed as distinct parameters here, so the
    /// borrow-checker sees them as independent lifetimes). Returns the number
    /// of changes actually applied. Short-circuits on the first error.
    async fn run_change_batch(
        &self,
        provider: &dyn CloudProvider,
        changes: &[SyncChange],
        conflicts: &[SyncConflict],
        direction: ChangeDirection,
    ) -> Result<usize, AppError> {
        let pending: Vec<SyncChange> = changes
            .iter()
            .filter(|c| !self.is_conflicted(c, conflicts))
            .cloned()
            .collect();
        let permits = Arc::new(tokio::sync::Semaphore::new(SYNC_CONCURRENCY));
        // Boxed so the Vec has a concrete element type; the lifetime is tied to
        // `self`/`provider`/`permits` which all outlive the `try_join_all`.
        let mut futs: Vec<
            std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), AppError>> + Send + '_>>,
        > = Vec::with_capacity(pending.len());
        for change in pending {
            let permit = permits.clone();
            futs.push(Box::pin(async move {
                let _permit = permit
                    .acquire_owned()
                    .await
                    .map_err(|e| AppError::Internal(format!("sync permit closed: {}", e)))?;
                match direction {
                    ChangeDirection::Upload => self.upload_change(provider, &change).await,
                    ChangeDirection::Download => self.download_change(provider, &change).await,
                }
            }));
        }
        Ok(try_join_all(futs).await?.len())
    }

    /// Upload a local change to cloud
    async fn upload_change(
        &self,
        provider: &dyn CloudProvider,
        change: &SyncChange,
    ) -> Result<(), AppError> {
        if let SyncData::Document {
            id,
            title: _,
            file_path,
            ..
        } = &change.data
        {
            // Read document file
            let file_data = if let Some(path) = file_path {
                tokio::fs::read(path)
                    .await
                    .map_err(|e| AppError::Internal(format!("Failed to read file: {}", e)))?
            } else {
                return Ok(()); // No file to upload
            };

            // Upload to cloud
            let cloud_path = format!("/sync/{}.json", id);
            let metadata = serde_json::to_vec(&change.data)
                .map_err(|e| AppError::Internal(format!("Failed to serialize metadata: {}", e)))?;

            // Upload file and metadata
            provider.upload_file(&cloud_path, file_data, None).await?;
            provider
                .upload_file(&format!("{}.meta", cloud_path), metadata, None)
                .await?;

            Ok(())
        } else {
            Ok(())
        }
    }

    /// Download a remote change from cloud
    async fn download_change(
        &self,
        provider: &dyn CloudProvider,
        change: &SyncChange,
    ) -> Result<(), AppError> {
        if let SyncData::RemoteFile { id, name, .. } = &change.data {
            // Download from cloud
            let cloud_path = format!("/sync/{}", id);
            let file_data = provider.download_file(&cloud_path, None).await?;

            let app_dir = std::env::current_dir().expect("failed to get current directory");
            let local_path = app_dir.join("documents").join(name);

            tokio::fs::create_dir_all(local_path.parent().expect("path has no parent"))
                .await
                .map_err(|e| AppError::Internal(format!("Failed to create directory: {}", e)))?;

            tokio::fs::write(&local_path, file_data)
                .await
                .map_err(|e| AppError::Internal(format!("Failed to write file: {}", e)))?;

            // TODO: Import document into database

            Ok(())
        } else {
            Ok(())
        }
    }

    /// Resolve conflicts using the specified strategy
    pub async fn resolve_conflicts(
        &mut self,
        resolutions: Vec<ConflictResolution>,
    ) -> Result<(), AppError> {
        let provider_box = self
            .provider
            .as_ref()
            .ok_or_else(|| AppError::Internal("No cloud provider configured".to_string()))?;

        // Convert Box<dyn CloudProvider> to &dyn CloudProvider
        let provider: &dyn CloudProvider = provider_box.as_ref();

        let state = self.sync_state.read().await;
        let conflicts = state.pending_conflicts.clone();
        drop(state);

        for (i, conflict) in conflicts.iter().enumerate() {
            let resolution = resolutions
                .get(i)
                .copied()
                .unwrap_or(ConflictResolution::KeepNewest);

            match resolution {
                ConflictResolution::KeepLocal => {
                    // Upload local version, overwriting remote
                    self.force_upload_local(provider, conflict).await?;
                }
                ConflictResolution::KeepRemote => {
                    // Download remote version, overwriting local
                    self.force_download_remote(provider, conflict).await?;
                }
                ConflictResolution::KeepNewest => {
                    if conflict.local_modified > conflict.remote_modified {
                        self.force_upload_local(provider, conflict).await?;
                    } else {
                        self.force_download_remote(provider, conflict).await?;
                    }
                }
                ConflictResolution::KeepBoth => {
                    self.create_duplicate(conflict).await?;
                }
            }
        }

        // Clear pending conflicts
        let mut state = self.sync_state.write().await;
        state.pending_conflicts.clear();

        Ok(())
    }

    /// Force upload local version
    async fn force_upload_local(
        &self,
        _provider: &dyn CloudProvider,
        _conflict: &SyncConflict,
    ) -> Result<(), AppError> {
        // TODO: Implement force upload
        Ok(())
    }

    /// Force download remote version
    async fn force_download_remote(
        &self,
        _provider: &dyn CloudProvider,
        _conflict: &SyncConflict,
    ) -> Result<(), AppError> {
        // TODO: Implement force download
        Ok(())
    }

    /// Create duplicate when both versions should be kept
    async fn create_duplicate(&self, _conflict: &SyncConflict) -> Result<(), AppError> {
        // TODO: Implement duplicate creation
        Ok(())
    }

    /// Get current sync status
    pub async fn get_sync_status(&self) -> Result<SyncStatus, AppError> {
        let state = self.sync_state.read().await;

        Ok(SyncStatus {
            last_sync: state.last_sync,
            sync_version: state.sync_version,
            pending_conflicts: state.pending_conflicts.len(),
            provider_authenticated: self
                .provider
                .as_ref()
                .map(|p| p.is_authenticated())
                .unwrap_or(false),
        })
    }
}

/// Sync change
#[derive(Debug, Clone)]
struct SyncChange {
    item_id: String,
    item_type: String,
    local_modified: Option<DateTime<Utc>>,
    remote_modified: Option<DateTime<Utc>>,
    change_type: ChangeType,
    data: SyncData,
}

/// Change type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChangeType {
    Added,
    Modified,
    Deleted,
}

/// Sync data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum SyncData {
    Document {
        id: String,
        title: String,
        file_path: Option<String>,
        metadata: Option<DocumentMetadata>,
    },
    RemoteFile {
        id: String,
        name: String,
        path: String,
        size: u64,
    },
}

/// Document metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DocumentMetadata {
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    category: Option<String>,
    tags: Vec<String>,
}

/// Sync status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub last_sync: Option<DateTime<Utc>>,
    pub sync_version: u64,
    pub pending_conflicts: usize,
    pub provider_authenticated: bool,
}
