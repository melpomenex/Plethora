//! Versioned, page-granular native cache for the canonical PDF model (v2).
//!
//! Layout: `pdf-reflow-v2/{sha256(documentId)}/{sha256(identity|schema|engine)}`
//! holding `page-N.json` (typed canonical pages) plus `assets/{sha256}.png`
//! source crops. Asset ids are content hashes, so identical crops dedupe
//! across pages. Eviction treats page JSON and assets as one LRU pool; an
//! evicted asset is tolerable because crops are regenerable on demand — the
//! page JSON is the primary cache.
//!
//! This module absorbs the v1 opaque-JSON cache (`commands/pdf_reflow_cache.rs`)
//! with typed pages; the v1 commands stay registered until phase 10 cleanup.

use crate::error::{IncrementumError, Result};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use super::model::PdfCanonicalPage;

const PDF_REFLOW_V2_CACHE_LIMIT_BYTES: u64 = 128 * 1024 * 1024;

fn key_hash(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

pub fn asset_id_for(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn is_hash_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub struct PdfReflowCache {
    root: PathBuf,
}

impl PdfReflowCache {
    pub fn open(app: &AppHandle) -> Result<Self> {
        let root = app
            .path()
            .app_cache_dir()
            .map(|path| path.join("incrementum").join("pdf-reflow-v2"))
            .map_err(|error| {
                IncrementumError::Internal(format!("Failed to resolve PDF cache: {error}"))
            })?;
        Ok(Self { root })
    }

    #[cfg(test)]
    pub fn at_root(root: PathBuf) -> Self {
        Self { root }
    }

    fn entry_dir(
        &self,
        document_id: &str,
        source_identity: &str,
        schema_version: u32,
        engine_version: &str,
    ) -> PathBuf {
        self.root.join(key_hash(&[document_id])).join(key_hash(&[
            source_identity,
            &schema_version.to_string(),
            engine_version,
        ]))
    }

    fn page_path(dir: &Path, page_number: u32) -> PathBuf {
        dir.join(format!("page-{page_number}.json"))
    }

    fn asset_path(dir: &Path, asset_id: &str) -> PathBuf {
        dir.join("assets").join(format!("{asset_id}.png"))
    }

    fn ensure_page_number(page_number: u32) -> Result<()> {
        if page_number == 0 {
            return Err(IncrementumError::InvalidInput(
                "PDF page numbers start at 1".into(),
            ));
        }
        Ok(())
    }

    pub async fn get_page(
        &self,
        document_id: &str,
        source_identity: &str,
        schema_version: u32,
        engine_version: &str,
        page_number: u32,
    ) -> Result<Option<PdfCanonicalPage>> {
        Self::ensure_page_number(page_number)?;
        let path = self
            .page_path_or_none(
                document_id,
                source_identity,
                schema_version,
                engine_version,
                page_number,
            )
            .await?;
        let Some(path) = path else {
            return Ok(None);
        };
        match tokio::fs::read(path).await {
            Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    /// Returns the path only when the entry directory exists, so cache misses
    /// never create directory trees (writes are the only thing that should
    /// materialize keys).
    async fn page_path_or_none(
        &self,
        document_id: &str,
        source_identity: &str,
        schema_version: u32,
        engine_version: &str,
        page_number: u32,
    ) -> Result<Option<PathBuf>> {
        let dir = self.entry_dir(document_id, source_identity, schema_version, engine_version);
        let path = Self::page_path(&dir, page_number);
        if tokio::fs::try_exists(&path).await? {
            Ok(Some(path))
        } else {
            Ok(None)
        }
    }

    pub async fn put_page(
        &self,
        document_id: &str,
        source_identity: &str,
        schema_version: u32,
        engine_version: &str,
        page: &PdfCanonicalPage,
    ) -> Result<()> {
        Self::ensure_page_number(page.page_number)?;
        if page.schema_version != schema_version || page.engine_version != engine_version {
            return Err(IncrementumError::InvalidInput(format!(
                "Page stamped with {}/{} does not match cache key {}/{}",
                page.schema_version, page.engine_version, schema_version, engine_version
            )));
        }
        let dir = self.entry_dir(document_id, source_identity, schema_version, engine_version);
        let path = Self::page_path(&dir, page.page_number);
        write_bytes_atomic(&path, &serde_json::to_vec(page)?, "json").await?;
        self.enforce_limit().await
    }

    /// Stores a source-crop asset and returns its content-hash asset id.
    pub async fn put_asset(
        &self,
        document_id: &str,
        source_identity: &str,
        schema_version: u32,
        engine_version: &str,
        bytes: &[u8],
    ) -> Result<String> {
        if bytes.is_empty() {
            return Err(IncrementumError::InvalidInput(
                "PDF reflow assets must not be empty".into(),
            ));
        }
        let asset_id = asset_id_for(bytes);
        let dir = self.entry_dir(document_id, source_identity, schema_version, engine_version);
        let path = Self::asset_path(&dir, &asset_id);
        write_bytes_atomic(&path, bytes, "png").await?;
        self.enforce_limit().await?;
        Ok(asset_id)
    }

    pub async fn get_asset(
        &self,
        document_id: &str,
        source_identity: &str,
        schema_version: u32,
        engine_version: &str,
        asset_id: &str,
    ) -> Result<Option<Vec<u8>>> {
        if !is_hash_id(asset_id) {
            return Err(IncrementumError::InvalidInput(
                "Asset ids must be 64-character hex hashes".into(),
            ));
        }
        let dir = self.entry_dir(document_id, source_identity, schema_version, engine_version);
        let path = Self::asset_path(&dir, asset_id);
        match tokio::fs::read(path).await {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn delete_document(&self, document_id: &str) -> Result<()> {
        let document_dir = self.root.join(key_hash(&[document_id]));
        tokio::fs::remove_dir_all(&document_dir)
            .await
            .or_else(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    Ok(())
                } else {
                    Err(error)
                }
            })?;
        Ok(())
    }

    async fn enforce_limit(&self) -> Result<()> {
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || {
            enforce_limit_blocking(&root, PDF_REFLOW_V2_CACHE_LIMIT_BYTES)
        })
        .await
        .map_err(|error| {
            IncrementumError::Internal(format!("PDF cache cleanup failed: {error}"))
        })??;
        Ok(())
    }
}

async fn write_bytes_atomic(path: &Path, bytes: &[u8], extension: &str) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| IncrementumError::InvalidInput("Invalid PDF cache path".into()))?;
    tokio::fs::create_dir_all(parent).await?;
    let temp = path.with_extension(format!("{extension}.tmp-{}", uuid::Uuid::new_v4()));
    tokio::fs::write(&temp, bytes).await?;
    if let Err(error) = tokio::fs::rename(&temp, path).await {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(IncrementumError::Io(error));
    }
    Ok(())
}

fn enforce_limit_blocking(root: &Path, limit_bytes: u64) -> Result<()> {
    if !root.exists() {
        return Ok(());
    }
    // Pages and assets share one LRU pool ordered by mtime.
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    fn collect(
        path: &Path,
        files: &mut Vec<(PathBuf, u64, std::time::SystemTime)>,
    ) -> std::io::Result<()> {
        for entry in std::fs::read_dir(path)? {
            let path = entry?.path();
            if path.is_dir() {
                collect(&path, files)?;
            } else if path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value == "json" || value == "png")
            {
                let metadata = std::fs::metadata(&path)?;
                files.push((
                    path,
                    metadata.len(),
                    metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
                ));
            }
        }
        Ok(())
    }
    collect(root, &mut files)?;
    let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in files {
        if total <= limit_bytes {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::model::{
        PdfCanonicalClassification, PdfCanonicalPage, PdfCanonicalPageState,
        PDF_CANONICAL_ENGINE_VERSION, PDF_CANONICAL_SCHEMA_VERSION,
    };

    fn sample_page(page_number: u32) -> PdfCanonicalPage {
        PdfCanonicalPage {
            page_number,
            width: 612.0,
            height: 792.0,
            rotation: 0,
            state: PdfCanonicalPageState::Ready,
            classification: PdfCanonicalClassification::Semantic,
            confidence: 0.9,
            text_coverage: 0.9,
            words: vec![],
            lines: vec![],
            blocks: vec![],
            warnings: vec![],
            error_category: None,
            schema_version: PDF_CANONICAL_SCHEMA_VERSION,
            engine_version: PDF_CANONICAL_ENGINE_VERSION.into(),
        }
    }

    #[test]
    fn versioned_cache_paths_do_not_contain_user_input() {
        let cache = PdfReflowCache::at_root(PathBuf::from("/cache"));
        let dir = cache.entry_dir("../../private", "source/id", 2, "rust-hybrid-v2");
        assert_eq!(dir.file_name().unwrap().to_string_lossy().len(), 64);
        assert_eq!(
            dir.parent()
                .unwrap()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .len(),
            64
        );
        assert!(PdfReflowCache::page_path(&dir, 7).ends_with("page-7.json"));
    }

    #[test]
    fn asset_ids_are_hashed_hex_and_traversal_is_rejected() {
        assert!(is_hash_id(&"a".repeat(64)));
        assert!(!is_hash_id(&"g".repeat(64)));
        assert!(!is_hash_id("../../etc/passwd"));
        let dir = Path::new("/cache");
        let path = PdfReflowCache::asset_path(dir, &"a".repeat(64));
        assert!(path.ends_with(format!("{}.png", "a".repeat(64))));
    }

    #[tokio::test]
    async fn stale_engine_version_entry_is_not_returned_after_bump() {
        // A page written under a previous engine version (e.g. the pre-bump
        // "rust-hybrid-v2") must become unreachable once
        // PDF_CANONICAL_ENGINE_VERSION moves on: the cache key derives from
        // identity|schema|engine, so the stale page lives under a different
        // hash and reads for the current engine miss cleanly.
        let dir = tempfile::tempdir().unwrap();
        let cache = PdfReflowCache::at_root(dir.path().to_path_buf());
        let mut stale = sample_page(3);
        stale.engine_version = "rust-hybrid-v2".into();
        cache
            .put_page(
                "doc-1",
                "identity",
                PDF_CANONICAL_SCHEMA_VERSION,
                "rust-hybrid-v2",
                &stale,
            )
            .await
            .unwrap();
        // Still readable under its own (stale) key...
        assert!(cache
            .get_page("doc-1", "identity", PDF_CANONICAL_SCHEMA_VERSION, "rust-hybrid-v2", 3)
            .await
            .unwrap()
            .is_some());
        // ...but NOT under the current engine key.
        assert_ne!(PDF_CANONICAL_ENGINE_VERSION, "rust-hybrid-v2");
        assert!(cache
            .get_page(
                "doc-1",
                "identity",
                PDF_CANONICAL_SCHEMA_VERSION,
                PDF_CANONICAL_ENGINE_VERSION,
                3,
            )
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn page_round_trips_typed_json() {
        let dir = tempfile::tempdir().unwrap();
        let cache = PdfReflowCache::at_root(dir.path().to_path_buf());
        let page = sample_page(3);
        cache
            .put_page(
                "doc-1",
                "identity",
                PDF_CANONICAL_SCHEMA_VERSION,
                PDF_CANONICAL_ENGINE_VERSION,
                &page,
            )
            .await
            .unwrap();
        let loaded = cache
            .get_page(
                "doc-1",
                "identity",
                PDF_CANONICAL_SCHEMA_VERSION,
                PDF_CANONICAL_ENGINE_VERSION,
                3,
            )
            .await
            .unwrap()
            .expect("page should be cached");
        assert_eq!(loaded, page);
        // Misses return None without materializing directories.
        assert!(cache
            .get_page(
                "doc-1",
                "identity",
                PDF_CANONICAL_SCHEMA_VERSION,
                PDF_CANONICAL_ENGINE_VERSION,
                4
            )
            .await
            .unwrap()
            .is_none());
        assert!(!cache
            .entry_dir(
                "doc-1",
                "identity",
                PDF_CANONICAL_SCHEMA_VERSION,
                PDF_CANONICAL_ENGINE_VERSION
            )
            .join("page-4.json")
            .exists());
    }

    #[tokio::test]
    async fn put_page_rejects_stamp_key_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let cache = PdfReflowCache::at_root(dir.path().to_path_buf());
        let error = cache
            .put_page("doc-1", "identity", 2, "other-engine", &sample_page(1))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("does not match cache key"));
    }

    #[tokio::test]
    async fn assets_round_trip_and_content_dedupe() {
        let dir = tempfile::tempdir().unwrap();
        let cache = PdfReflowCache::at_root(dir.path().to_path_buf());
        let bytes = vec![1, 2, 3, 4, 5];
        let asset_id = cache
            .put_asset("doc-1", "identity", 2, "rust-hybrid-v2", &bytes)
            .await
            .unwrap();
        assert_eq!(asset_id, asset_id_for(&bytes));
        let again = cache
            .put_asset("doc-1", "identity", 2, "rust-hybrid-v2", &bytes)
            .await
            .unwrap();
        assert_eq!(asset_id, again);
        let loaded = cache
            .get_asset("doc-1", "identity", 2, "rust-hybrid-v2", &asset_id)
            .await
            .unwrap()
            .expect("asset should be cached");
        assert_eq!(loaded, bytes);
        assert!(cache
            .get_asset("doc-1", "identity", 2, "rust-hybrid-v2", "not-a-hash")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn eviction_removes_oldest_files_beyond_cap() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("cache");
        std::fs::create_dir_all(&root).unwrap();
        for i in 0..5 {
            let path = root.join(format!("page-{i}.json"));
            std::fs::write(&path, vec![0u8; 1024]).unwrap();
            let stamp = std::time::SystemTime::now() + std::time::Duration::from_secs(i);
            let stamped = filetime::FileTime::from_system_time(stamp);
            filetime::set_file_mtime(&path, stamped).unwrap();
        }
        enforce_limit_blocking(&root, 2048).unwrap();
        let remaining: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .collect();
        assert_eq!(
            remaining.len(),
            2,
            "oldest files beyond the cap are evicted"
        );
    }
}
