//! Versioned, page-granular native cache for semantic PDF reflow results.

use crate::error::{PlethoraError, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const PDF_REFLOW_CACHE_LIMIT_BYTES: u64 = 128 * 1024 * 1024;

fn key_hash(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn cache_root(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join("incrementum").join("pdf-reflow-v1"))
        .map_err(|error| {
            PlethoraError::Internal(format!("Failed to resolve PDF cache: {error}"))
        })
}

fn document_cache_dir(
    root: &Path,
    document_id: &str,
    source_identity: &str,
    schema_version: u32,
    engine_version: &str,
) -> PathBuf {
    root.join(key_hash(&[document_id])).join(key_hash(&[
        source_identity,
        &schema_version.to_string(),
        engine_version,
    ]))
}

fn page_path(dir: &Path, page_number: u32) -> PathBuf {
    dir.join(format!("page-{page_number}.json"))
}

async fn write_json_atomic(path: &Path, value: &Value) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| PlethoraError::InvalidInput("Invalid PDF cache path".into()))?;
    tokio::fs::create_dir_all(parent).await?;
    let temp = path.with_extension(format!("json.tmp-{}", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(value)?;
    tokio::fs::write(&temp, bytes).await?;
    if let Err(error) = tokio::fs::rename(&temp, path).await {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(PlethoraError::Io(error));
    }
    Ok(())
}

async fn enforce_cache_limit(root: &Path) -> Result<()> {
    let root = root.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<()> {
        if !root.exists() {
            return Ok(());
        }
        let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
        fn collect(
            path: &Path,
            files: &mut Vec<(PathBuf, u64, std::time::SystemTime)>,
        ) -> std::io::Result<()> {
            for entry in std::fs::read_dir(path)? {
                let path = entry?.path();
                if path.is_dir() {
                    collect(&path, files)?;
                } else if path.extension().and_then(|value| value.to_str()) == Some("json") {
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
        collect(&root, &mut files)?;
        let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
        files.sort_by_key(|(_, _, modified)| *modified);
        for (path, size, _) in files {
            if total <= PDF_REFLOW_CACHE_LIMIT_BYTES {
                break;
            }
            if std::fs::remove_file(path).is_ok() {
                total = total.saturating_sub(size);
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| PlethoraError::Internal(format!("PDF cache cleanup failed: {error}")))??;
    Ok(())
}

#[tauri::command]
pub async fn get_pdf_reflow_cache_page(
    document_id: String,
    source_identity: String,
    schema_version: u32,
    engine_version: String,
    page_number: u32,
    app: AppHandle,
) -> Result<Option<Value>> {
    if page_number == 0 {
        return Err(PlethoraError::InvalidInput(
            "PDF page numbers start at 1".into(),
        ));
    }
    let root = cache_root(&app)?;
    let path = page_path(
        &document_cache_dir(
            &root,
            &document_id,
            &source_identity,
            schema_version,
            &engine_version,
        ),
        page_number,
    );
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
pub async fn put_pdf_reflow_cache_page(
    document_id: String,
    source_identity: String,
    schema_version: u32,
    engine_version: String,
    page_number: u32,
    page: Value,
    app: AppHandle,
) -> Result<()> {
    if page_number == 0 {
        return Err(PlethoraError::InvalidInput(
            "PDF page numbers start at 1".into(),
        ));
    }
    let root = cache_root(&app)?;
    let path = page_path(
        &document_cache_dir(
            &root,
            &document_id,
            &source_identity,
            schema_version,
            &engine_version,
        ),
        page_number,
    );
    write_json_atomic(&path, &page).await?;
    enforce_cache_limit(&root).await
}

#[tauri::command]
pub async fn delete_pdf_reflow_cache(document_id: String, app: AppHandle) -> Result<()> {
    let root = cache_root(&app)?;
    let document_dir = root.join(key_hash(&[&document_id]));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versioned_cache_paths_do_not_contain_user_input() {
        let root = Path::new("/cache");
        let path = document_cache_dir(root, "../../private", "source/id", 1, "engine:v1");
        let leaf = path.file_name().unwrap().to_string_lossy();
        assert_eq!(leaf.len(), 64);
        assert!(!leaf.contains(".."));
        assert_eq!(
            path.parent()
                .unwrap()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .len(),
            64
        );
        assert!(page_path(&path, 7).ends_with("page-7.json"));
    }

    #[tokio::test]
    async fn atomic_page_write_round_trips_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("page-1.json");
        let value = serde_json::json!({"pageNumber": 1, "text": "safe"});
        write_json_atomic(&path, &value).await.unwrap();
        let stored: Value = serde_json::from_slice(&tokio::fs::read(path).await.unwrap()).unwrap();
        assert_eq!(stored, value);
    }
}
