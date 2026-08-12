//! Secure, memory-bounded PDF byte access for native mobile PDF.js.

use crate::database::Repository;
use crate::models::FileType;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{File, Metadata};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::State;

pub const MAX_PDF_RANGE_BYTES: u64 = 512 * 1024;
const FINGERPRINT_SAMPLE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PdfNativeError {
    pub code: &'static str,
    pub message: String,
    pub recoverable: bool,
}

impl PdfNativeError {
    fn new(code: &'static str, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            recoverable,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDocumentSourceInfo {
    pub document_id: String,
    pub size: u64,
    pub identity: String,
    pub fingerprint: String,
    pub max_chunk_size: u64,
}

// NOTE: range reads return raw bytes via `tauri::ipc::Response` (ArrayBuffer
// on the JS side) — there is intentionally NO response struct. The metadata
// the old `PdfDocumentRange { offset, bytes, identity, eof }` JSON shape
// carried is implicit in the contract (design D1 of
// optimize-performance-hotspots):
//   - `offset` was an echo of the request;
//   - `eof` is derivable by the caller: fewer bytes than requested, with the
//     total size already known from `open_pdf_document_source`;
//   - `identity` is validated server-side — a mismatch fails the command with
//     `pdf_source_changed` instead of being echoed back.
// Serializing `Vec<u8>` through serde_json turned every 512 KB chunk into
// ~1.8 MB of JSON number-array text, re-parsed per page fetch on mobile.

#[derive(Debug)]
struct InspectedPdf {
    path: PathBuf,
    size: u64,
    identity: String,
    fingerprint: String,
}

fn modified_nanos(metadata: &Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0)
}

fn identity_for(path: &Path, metadata: &Metadata) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_os_str().to_string_lossy().as_bytes());
    hasher.update(metadata.len().to_le_bytes());
    hasher.update(modified_nanos(metadata).to_le_bytes());
    format!("{:x}", hasher.finalize())
}

fn sampled_fingerprint(path: &Path, size: u64) -> std::result::Result<String, PdfNativeError> {
    let mut file = File::open(path).map_err(|error| {
        PdfNativeError::new(
            "pdf_source_unavailable",
            format!("Could not open the PDF: {error}"),
            true,
        )
    })?;
    let sample_len = usize::try_from(size.min(FINGERPRINT_SAMPLE_BYTES as u64)).unwrap_or(0);
    let mut first = vec![0_u8; sample_len];
    file.read_exact(&mut first).map_err(|error| {
        PdfNativeError::new(
            "pdf_source_unavailable",
            format!("Could not fingerprint the PDF: {error}"),
            true,
        )
    })?;

    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());
    hasher.update(&first);
    if size > FINGERPRINT_SAMPLE_BYTES as u64 {
        let tail_len = usize::try_from(size.min(FINGERPRINT_SAMPLE_BYTES as u64)).unwrap_or(0);
        file.seek(SeekFrom::Start(size - tail_len as u64))
            .map_err(|error| {
                PdfNativeError::new(
                    "pdf_source_unavailable",
                    format!("Could not seek in the PDF: {error}"),
                    true,
                )
            })?;
        let mut last = vec![0_u8; tail_len];
        file.read_exact(&mut last).map_err(|error| {
            PdfNativeError::new(
                "pdf_source_unavailable",
                format!("Could not fingerprint the PDF: {error}"),
                true,
            )
        })?;
        hasher.update(last);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn inspect_pdf_path(
    path: &Path,
    include_fingerprint: bool,
) -> std::result::Result<InspectedPdf, PdfNativeError> {
    let canonical = std::fs::canonicalize(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "pdf_source_missing"
        } else if error.kind() == std::io::ErrorKind::PermissionDenied {
            "pdf_source_unauthorized"
        } else {
            "pdf_source_unavailable"
        };
        PdfNativeError::new(code, "The PDF is not available on this device.", true)
    })?;
    let metadata = std::fs::metadata(&canonical).map_err(|error| {
        PdfNativeError::new(
            "pdf_source_unavailable",
            format!("Could not inspect the PDF: {error}"),
            true,
        )
    })?;
    if !metadata.is_file() {
        return Err(PdfNativeError::new(
            "pdf_source_unauthorized",
            "The selected PDF source is not a regular file.",
            false,
        ));
    }
    let is_pdf = canonical
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err(PdfNativeError::new(
            "pdf_not_pdf",
            "The document source is not a PDF.",
            false,
        ));
    }
    let size = metadata.len();
    let identity = identity_for(&canonical, &metadata);
    let fingerprint = if include_fingerprint {
        sampled_fingerprint(&canonical, size)?
    } else {
        String::new()
    };
    Ok(InspectedPdf {
        path: canonical,
        size,
        identity,
        fingerprint,
    })
}

fn read_range_from_path(
    inspected: &InspectedPdf,
    offset: u64,
    length: u64,
) -> std::result::Result<Vec<u8>, PdfNativeError> {
    if length > MAX_PDF_RANGE_BYTES {
        return Err(PdfNativeError::new(
            "pdf_range_too_large",
            format!("PDF byte ranges are limited to {MAX_PDF_RANGE_BYTES} bytes."),
            true,
        ));
    }
    if offset > inspected.size {
        return Err(PdfNativeError::new(
            "pdf_invalid_range",
            "The requested PDF byte range begins after the end of the file.",
            false,
        ));
    }

    let available = inspected.size.saturating_sub(offset);
    let read_len = length.min(available);
    let mut bytes = vec![0_u8; usize::try_from(read_len).unwrap_or(0)];
    if read_len > 0 {
        let mut file = File::open(&inspected.path).map_err(|error| {
            PdfNativeError::new(
                "pdf_source_unavailable",
                format!("Could not open the PDF range: {error}"),
                true,
            )
        })?;
        file.seek(SeekFrom::Start(offset)).map_err(|error| {
            PdfNativeError::new(
                "pdf_invalid_range",
                format!("Could not seek to the PDF range: {error}"),
                false,
            )
        })?;
        file.read_exact(&mut bytes).map_err(|error| {
            PdfNativeError::new(
                "pdf_source_changed",
                format!("The PDF changed while its byte range was being read: {error}"),
                true,
            )
        })?;
    }

    Ok(bytes)
}

async fn inspect_document_pdf(
    document_id: &str,
    repo: &Repository,
    include_fingerprint: bool,
) -> std::result::Result<InspectedPdf, PdfNativeError> {
    let document = repo
        .get_document(document_id)
        .await
        .map_err(|_| {
            PdfNativeError::new(
                "pdf_source_unavailable",
                "Could not resolve the PDF document.",
                true,
            )
        })?
        .ok_or_else(|| {
            PdfNativeError::new(
                "pdf_source_missing",
                "The PDF document no longer exists in the library.",
                true,
            )
        })?;
    if !matches!(document.file_type, FileType::Pdf) {
        return Err(PdfNativeError::new(
            "pdf_not_pdf",
            "The requested document is not a PDF.",
            false,
        ));
    }
    if document.file_path.trim().is_empty() {
        return Err(PdfNativeError::new(
            "pdf_source_missing",
            "This PDF has not been downloaded to this device.",
            true,
        ));
    }
    // The caller supplies only a database document ID. The path is taken from
    // that authorized row, so arbitrary paths and traversal input cannot cross
    // this command boundary.
    inspect_pdf_path(Path::new(&document.file_path), include_fingerprint)
}

/// Range-command core, factored out of the Tauri commands so the
/// authorization and identity-change behavior is unit-testable without a
/// Tauri runtime (task 6.4). The commands are thin wrappers over these.
pub async fn get_pdf_document_source_info_impl(
    document_id: &str,
    repo: &Repository,
) -> std::result::Result<PdfDocumentSourceInfo, PdfNativeError> {
    let inspected = inspect_document_pdf(document_id, repo, true).await?;
    Ok(PdfDocumentSourceInfo {
        document_id: document_id.to_string(),
        size: inspected.size,
        identity: inspected.identity,
        fingerprint: inspected.fingerprint,
        max_chunk_size: MAX_PDF_RANGE_BYTES,
    })
}

#[tauri::command]
pub async fn get_pdf_document_source_info(
    document_id: String,
    repo: State<'_, Repository>,
) -> std::result::Result<PdfDocumentSourceInfo, PdfNativeError> {
    get_pdf_document_source_info_impl(&document_id, &repo).await
}

/// Read one bounded byte range, re-validating the source identity first.
/// A changed identity fails with `pdf_source_changed` — no bytes from the
/// changed file are ever delivered (task 6.4).
pub async fn read_pdf_document_range_impl(
    document_id: &str,
    offset: u64,
    length: u64,
    expected_identity: &str,
    repo: &Repository,
) -> std::result::Result<Vec<u8>, PdfNativeError> {
    let inspected = inspect_document_pdf(document_id, repo, false).await?;
    if inspected.identity != expected_identity {
        return Err(PdfNativeError::new(
            "pdf_source_changed",
            "The PDF changed after it was opened. Reload it to continue.",
            true,
        ));
    }
    // The seek+read is blocking file I/O; run it on the blocking pool so a
    // page-turn burst of range reads can't stall async runtime workers
    // (design D5). `inspected` moves into the closure (it is only needed for
    // this read).
    tokio::task::spawn_blocking(move || read_range_from_path(&inspected, offset, length))
        .await
        .map_err(|error| {
            PdfNativeError::new(
                "pdf_source_unavailable",
                format!("The PDF range read task failed: {error}"),
                true,
            )
        })?
}

#[tauri::command]
pub async fn read_pdf_document_range(
    document_id: String,
    offset: u64,
    length: u64,
    expected_identity: String,
    repo: State<'_, Repository>,
) -> std::result::Result<tauri::ipc::Response, PdfNativeError> {
    let bytes = read_pdf_document_range_impl(
        &document_id,
        offset,
        length,
        &expected_identity,
        &repo,
    )
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::models::Document;
    use std::io::Write;

    fn fixture(bytes: &[u8]) -> (tempfile::TempDir, InspectedPdf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.pdf");
        let mut file = File::create(&path).unwrap();
        file.write_all(bytes).unwrap();
        file.sync_all().unwrap();
        let inspected = inspect_pdf_path(&path, true).unwrap();
        (dir, inspected)
    }

    /// In-memory repository with one PDF document pointing at `file_bytes`.
    async fn repo_with_pdf(file_bytes: &[u8]) -> (Repository, tempfile::TempDir, Document) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.pdf");
        std::fs::write(&path, file_bytes).unwrap();
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        let repo = Repository::new(db.pool().clone());
        let document = Document::new(
            "range-test".to_string(),
            path.to_string_lossy().to_string(),
            FileType::Pdf,
        );
        repo.create_document(&document).await.expect("document");
        (repo, dir, document)
    }

    #[test]
    fn reads_exact_and_overlapping_ranges() {
        let (_dir, inspected) = fixture(b"%PDF-0123456789");
        assert_eq!(read_range_from_path(&inspected, 0, 5).unwrap(), b"%PDF-");
        assert_eq!(read_range_from_path(&inspected, 3, 6).unwrap(), b"F-0123");
    }

    #[test]
    fn truncates_at_eof_and_accepts_empty_ranges() {
        // EOF is a caller-side derivation now (returned length < requested
        // length): assert the truncated/empty byte payloads that derivation
        // relies on.
        let (_dir, inspected) = fixture(b"%PDF-1234");
        let tail = read_range_from_path(&inspected, 7, 99).unwrap();
        assert_eq!(tail, b"34");
        assert!(tail.len() < 99, "short read is the EOF signal");
        let empty = read_range_from_path(&inspected, inspected.size, 0).unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn rejects_ranges_after_eof_and_oversized_ranges() {
        let (_dir, inspected) = fixture(b"%PDF-1234");
        assert_eq!(
            read_range_from_path(&inspected, inspected.size + 1, 1)
                .unwrap_err()
                .code,
            "pdf_invalid_range"
        );
        assert_eq!(
            read_range_from_path(&inspected, 0, MAX_PDF_RANGE_BYTES + 1)
                .unwrap_err()
                .code,
            "pdf_range_too_large"
        );
    }

    #[test]
    fn rejects_missing_non_pdf_and_directory_sources() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            inspect_pdf_path(&dir.path().join("missing.pdf"), true)
                .unwrap_err()
                .code,
            "pdf_source_missing"
        );
        let text = dir.path().join("not-pdf.txt");
        std::fs::write(&text, b"hello").unwrap();
        assert_eq!(
            inspect_pdf_path(&text, true).unwrap_err().code,
            "pdf_not_pdf"
        );
        let fake_dir = dir.path().join("folder.pdf");
        std::fs::create_dir(&fake_dir).unwrap();
        assert_eq!(
            inspect_pdf_path(&fake_dir, true).unwrap_err().code,
            "pdf_source_unauthorized"
        );
    }

    #[test]
    fn identity_changes_when_file_metadata_changes() {
        let (dir, inspected) = fixture(b"%PDF-before");
        let path = dir.path().join("fixture.pdf");
        std::fs::write(&path, b"%PDF-after-and-longer").unwrap();
        let changed = inspect_pdf_path(&path, true).unwrap();
        assert_ne!(inspected.identity, changed.identity);
        assert_ne!(inspected.fingerprint, changed.fingerprint);
    }

    // ------------------------------------------------------------------
    // Task 6.4 — range access preserves the existing authorization scoping.
    // ------------------------------------------------------------------

    #[tokio::test]
    async fn source_info_serves_an_authorized_document() {
        let (repo, _dir, document) = repo_with_pdf(b"%PDF-0123456789").await;
        let info = get_pdf_document_source_info_impl(&document.id, &repo)
            .await
            .expect("authorized source info");
        assert_eq!(info.size, 14);
        assert!(!info.identity.is_empty());
        assert_eq!(info.max_chunk_size, MAX_PDF_RANGE_BYTES);
    }

    #[tokio::test]
    async fn unknown_document_id_is_refused() {
        let (repo, _dir, _document) = repo_with_pdf(b"%PDF-0123456789").await;
        let error = get_pdf_document_source_info_impl("does-not-exist", &repo)
            .await
            .expect_err("unknown document must be refused");
        assert!(matches!(error.code, "pdf_source_unavailable" | "pdf_source_missing"));
    }

    #[tokio::test]
    async fn non_pdf_document_is_refused() {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        let repo = Repository::new(db.pool().clone());
        let document = Document::new("txt".to_string(), "/tmp/whatever.txt".to_string(), FileType::Markdown);
        repo.create_document(&document).await.expect("document");
        let error = get_pdf_document_source_info_impl(&document.id, &repo)
            .await
            .expect_err("non-PDF must be refused");
        assert_eq!(error.code, "pdf_not_pdf");
    }

    #[tokio::test]
    async fn identity_change_fails_the_range_instead_of_mixed_content() {
        let (repo, dir, document) = repo_with_pdf(b"%PDF-before").await;
        let info = get_pdf_document_source_info_impl(&document.id, &repo)
            .await
            .expect("source info");

        // The file is replaced after the source was resolved.
        std::fs::write(dir.path().join("library.pdf"), b"%PDF-after-and-longer").unwrap();

        // The stale expected_identity must fail; no bytes are delivered.
        let error = read_pdf_document_range_impl(&document.id, 0, 5, &info.identity, &repo)
            .await
            .expect_err("changed source must fail");
        assert_eq!(error.code, "pdf_source_changed");

        // Re-resolving yields the new identity, and reads then succeed.
        let refreshed = get_pdf_document_source_info_impl(&document.id, &repo)
            .await
            .expect("re-resolve");
        assert_ne!(refreshed.identity, info.identity);
        let bytes = read_pdf_document_range_impl(&document.id, 0, 4, &refreshed.identity, &repo)
            .await
            .expect("read after refresh");
        assert_eq!(bytes, b"%PDF");
    }
}
