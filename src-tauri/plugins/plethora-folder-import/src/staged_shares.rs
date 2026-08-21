//! Staged share-extension payload reader (iOS Share Extension handoff).
//!
//! The iOS share extension stages each incoming share into the shared App
//! Group container as a self-contained directory:
//!
//! ```text
//! <App Group container>/shares/.staging/<uuid>/   (extension writes here)
//! <App Group container>/shares/.ready/<uuid>/     (atomic rename when complete)
//!   manifest.json
//!   <payload files, one per `file` item>
//! <App Group container>/shares/.claiming/<uuid>/  (main app claimed it)
//!   .claim          claim marker: unix timestamp (ms) written at claim time
//! <App Group container>/shares/.failed/<uuid>/    (retry bound exhausted)
//! ```
//!
//! Exactly-once semantics:
//! - claiming = atomic `.ready/<id>` → `.claiming/<id>` rename, so a batch is
//!   handed to at most one consumer;
//! - a crash between claim and completion leaves the dir under `.claiming/`;
//!   claims older than [`CLAIM_TIMEOUT`] are reclaimed back to `.ready/`
//!   (at-least-once redelivery — harmless because imports dedupe via content
//!   hash / canonical URL);
//! - after successful handoff to the app's import pipeline the consumer calls
//!   [`complete_claim`], which deletes the claimed directory;
//! - URL/text shares that fail (e.g. offline) are released with
//!   [`retry_claim`], which bumps the manifest's attempt counter and moves the
//!   batch back to `.ready/`; after [`MAX_ATTEMPTS`] the batch moves to
//!   `.failed/` instead (no silent loss, no infinite retry loop).
//!
//! The manifest JSON contract (written by the extension's `ShareStagingWriter`,
//! consumed here; camelCase matches the frontend `SharedBatch` contract):
//!
//! ```json
//! {
//!   "id": "<uuid>",
//!   "receivedAt": 1724200000000,
//!   "sourceApp": "com.apple.Safari",
//!   "attempts": 0,
//!   "items": [
//!     { "kind": "url",  "urlString": "https://…" },
//!     { "kind": "text", "text": "…", "title": "…" },
//!     { "kind": "file", "filename": "paper.pdf", "mimeType": "application/pdf" }
//!   ]
//! }
//! ```

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Subdirectory (inside the App Group container) holding the staged queues.
pub const SHARES_DIR: &str = "shares";
/// Claim-marker file written inside a claimed batch directory.
const CLAIM_MARKER: &str = ".claim";
/// Manifest filename inside a batch directory.
pub const MANIFEST_FILE: &str = "manifest.json";
/// A claimed batch older than this is assumed abandoned (crash) and reclaimed.
pub const CLAIM_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Bounded retries for URL/text shares that cannot be imported (e.g. offline).
/// After this many failed attempts the batch moves to `.failed/`.
pub const MAX_ATTEMPTS: u32 = 5;

/// One staged share batch, exactly as written by the extension.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedManifest {
    pub id: String,
    /// Unix epoch milliseconds when the extension staged the share.
    pub received_at: u64,
    #[serde(default)]
    pub source_app: Option<String>,
    #[serde(default)]
    pub attempts: u32,
    pub items: Vec<StagedManifestItem>,
}

/// One item within a staged manifest. Tagged JSON (`"kind"`) matching the
/// frontend `SharedItem.type` discriminator values.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StagedManifestItem {
    Url {
        #[serde(rename = "urlString")]
        url_string: String,
        #[serde(default)]
        title: Option<String>,
    },
    Text {
        text: String,
        #[serde(default)]
        title: Option<String>,
    },
    File {
        filename: String,
        #[serde(default)]
        mime_type: Option<String>,
    },
}

impl StagedManifestItem {
    /// For `file` items: the payload filename stored next to the manifest.
    pub fn filename(&self) -> Option<&str> {
        match self {
            StagedManifestItem::File { filename, .. } => Some(filename),
            _ => None,
        }
    }
}

/// A batch atomically claimed from `.ready/`.
#[derive(Debug)]
pub struct ClaimedShare {
    pub manifest: StagedManifest,
    /// Directory under `.claiming/` holding the manifest + payload files.
    pub dir: PathBuf,
}

/// Outcome of releasing a claimed batch for retry.
#[derive(Debug, PartialEq, Eq)]
pub enum RetryOutcome {
    /// Batch moved back to `.ready/` (attempt counter incremented).
    Released,
    /// Attempt bound exhausted; batch moved to `.failed/`.
    Exhausted,
}

// ──────────────────────────────────────────────────────────────────────────
// Queue layout helpers
// ──────────────────────────────────────────────────────────────────────────

fn queue_dir(root: &Path, name: &str) -> PathBuf {
    root.join(name)
}

fn fs_err(context: &str, err: io::Error) -> io::Error {
    io::Error::new(err.kind(), format!("{context}: {err}"))
}

// ──────────────────────────────────────────────────────────────────────────
// Claim / reclaim / complete / retry
// ──────────────────────────────────────────────────────────────────────────

/// Scan `.ready/` and atomically claim every pending batch.
///
/// Batches whose manifests fail to parse are moved straight to `.failed/`
/// rather than being re-served forever. Ordering is by `receivedAt` so older
/// shares import first.
pub fn scan_and_claim(root: &Path) -> io::Result<Vec<ClaimedShare>> {
    reclaim_stale(root)?;

    let ready = queue_dir(root, ".ready");
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    match std::fs::read_dir(&ready) {
        Ok(rd) => {
            for entry in rd {
                let entry = entry.map_err(|e| fs_err("scan .ready", e))?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                if entry.path().is_dir() {
                    entries.push((name, entry.path()));
                }
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(fs_err("scan .ready", e)),
    }

    // Deterministic consumption order (oldest first).
    std::fs::create_dir_all(queue_dir(root, ".claiming"))?;
    let mut claimed = Vec::new();
    for (name, from) in entries {
        let to = queue_dir(root, ".claiming").join(&name);
        if let Err(e) = std::fs::rename(&from, &to) {
            // Another consumer won the race or the dir vanished — skip it.
            if e.kind() == io::ErrorKind::NotFound || e.kind() == io::ErrorKind::AlreadyExists {
                continue;
            }
            return Err(fs_err("claim rename", e));
        }
        write_claim_marker(&to)?;
        match read_manifest(&to) {
            Ok(mut manifest) => {
                // Keep the directory name authoritative for id lookups.
                manifest.id = name.clone();
                claimed.push(ClaimedShare { manifest, dir: to });
            }
            Err(e) => {
                // Unreadable manifest: park it in .failed instead of looping.
                let failed = queue_dir(root, ".failed").join(&name);
                let _ = std::fs::create_dir_all(queue_dir(root, ".failed"));
                let _ = std::fs::rename(&to, &failed);
                return Err(io::Error::new(
                    e.kind(),
                    format!("staged share {name}: {e}"),
                ));
            }
        }
    }

    claimed.sort_by_key(|c| c.manifest.received_at);
    Ok(claimed)
}

fn read_manifest(dir: &Path) -> io::Result<StagedManifest> {
    let raw = std::fs::read_to_string(dir.join(MANIFEST_FILE))?;
    serde_json::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn write_claim_marker(dir: &Path) -> io::Result<()> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string());
    std::fs::write(dir.join(CLAIM_MARKER), now_ms)
}

fn claim_age(dir: &Path) -> Option<Duration> {
    let raw = std::fs::read_to_string(dir.join(CLAIM_MARKER)).ok()?;
    let ms: u128 = raw.trim().parse().ok()?;
    let claimed_at = std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms as u64);
    std::time::SystemTime::now()
        .duration_since(claimed_at)
        .ok()
}

/// Reclaim `.claiming/` batches whose claim is older than [`CLAIM_TIMEOUT`].
pub fn reclaim_stale(root: &Path) -> io::Result<usize> {
    let claiming = queue_dir(root, ".claiming");
    let mut reclaimed = 0;
    let rd = match std::fs::read_dir(&claiming) {
        Ok(rd) => rd,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(fs_err("scan .claiming", e)),
    };
    for entry in rd {
        let entry = entry.map_err(|e| fs_err("scan .claiming", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let stale = match claim_age(&path) {
            Some(age) => age >= CLAIM_TIMEOUT,
            // Missing/unreadable marker: treat as ancient so it can't wedge.
            None => true,
        };
        if !stale {
            continue;
        }
        let back = queue_dir(root, ".ready").join(entry.file_name());
        let _ = std::fs::create_dir_all(queue_dir(root, ".ready"));
        match std::fs::rename(&path, &back) {
            Ok(()) => reclaimed += 1,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                // A same-id batch is somehow already ready; drop the stale copy.
                let _ = std::fs::remove_dir_all(&path);
            }
            Err(e) => return Err(fs_err("reclaim rename", e)),
        }
    }
    Ok(reclaimed)
}

/// Delete a successfully handed-off claimed batch (idempotent).
pub fn complete_claim(root: &Path, id: &str) -> io::Result<()> {
    let dir = queue_dir(root, ".claiming").join(sanitize_id(id));
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(fs_err("complete claim", e)),
    }
}

/// Release a claimed batch for another attempt, enforcing [`MAX_ATTEMPTS`].
pub fn retry_claim(root: &Path, id: &str) -> io::Result<RetryOutcome> {
    let dir = queue_dir(root, ".claiming").join(sanitize_id(id));
    let mut manifest = read_manifest(&dir)?;
    manifest.attempts += 1;

    if manifest.attempts >= MAX_ATTEMPTS {
        let failed_root = queue_dir(root, ".failed");
        std::fs::create_dir_all(&failed_root)?;
        std::fs::rename(&dir, failed_root.join(sanitize_id(id)))?;
        return Ok(RetryOutcome::Exhausted);
    }

    write_manifest(&dir, &manifest)?;
    let back = queue_dir(root, ".ready").join(sanitize_id(id));
    std::fs::create_dir_all(queue_dir(root, ".ready"))?;
    std::fs::rename(&dir, &back).map_err(|e| fs_err("retry rename", e))?;
    Ok(RetryOutcome::Released)
}

fn write_manifest(dir: &Path, manifest: &StagedManifest) -> io::Result<()> {
    let json = serde_json::to_string_pretty(manifest)?;
    std::fs::write(dir.join(MANIFEST_FILE), json)
}

/// Ids come over IPC; refuse anything that could escape the queues dir.
fn sanitize_id(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if cleaned.is_empty() {
        // Degenerate id: a name that can never match a real batch dir.
        "__invalid_id__".to_string()
    } else {
        cleaned
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Payload materialization into the app's staging area
// ──────────────────────────────────────────────────────────────────────────

/// Copy every `file` item's payload out of the claimed batch directory into
/// the app-private staging root (`<app_data>/imports/share-extension/<id>/`),
/// returning `filename → staged absolute path`. Copy (not move) keeps the
/// container intact until [`complete_claim`], so a crash mid-import still
/// leaves the original staged for redelivery.
///
/// Returns the map plus the list of filenames that were missing on disk
/// (missing payloads are reported per-item instead of failing the batch).
pub fn materialize_files(
    claimed: &ClaimedShare,
    staging_root: &Path,
) -> io::Result<(std::collections::HashMap<String, String>, Vec<String>)> {
    let mut staged = std::collections::HashMap::new();
    let mut missing = Vec::new();
    for item in &claimed.manifest.items {
        let Some(filename) = item.filename() else {
            continue;
        };
        let source = claimed.dir.join(filename);
        if !source.is_file() {
            missing.push(filename.to_string());
            continue;
        }
        let dest_dir = staging_root.join(sanitize_id(&claimed.manifest.id));
        std::fs::create_dir_all(&dest_dir)?;
        let dest = dest_dir.join(sanitize_filename(filename));
        std::fs::copy(&source, &dest)?;
        staged.insert(
            filename.to_string(),
            dest.to_string_lossy().to_string(),
        );
    }
    Ok((staged, missing))
}

/// Strip path separators from extension-supplied filenames.
fn sanitize_filename(name: &str) -> String {
    name.replace(['/', '\\', ':'], "_")
}

// ──────────────────────────────────────────────────────────────────────────
// Tests (run on any host — pure filesystem logic)
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "plethora-staged-shares-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn manifest_json(id: &str, received_at: u64, attempts: u32) -> String {
        format!(
            r#"{{"id":"{id}","receivedAt":{received_at},"sourceApp":"com.apple.Safari","attempts":{attempts},
                "items":[{{"kind":"url","urlString":"https://example.com/a"}},
                         {{"kind":"text","text":"note","title":"T"}},
                         {{"kind":"file","filename":"paper.pdf","mimeType":"application/pdf"}}]}}"#
        )
    }

    fn stage_ready(root: &Path, id: &str, received_at: u64, attempts: u32) -> PathBuf {
        let dir = root.join(".ready").join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(MANIFEST_FILE), manifest_json(id, received_at, attempts)).unwrap();
        std::fs::write(dir.join("paper.pdf"), b"%PDF-fake").unwrap();
        dir
    }

    fn manifest_of(root: &Path, queue: &str, id: &str) -> StagedManifest {
        read_manifest(&root.join(queue).join(id)).unwrap()
    }

    #[test]
    fn manifest_roundtrip_maps_all_item_kinds() {
        let m: StagedManifest =
            serde_json::from_str(&manifest_json("abc", 1724200000000, 0)).unwrap();
        assert_eq!(m.id, "abc");
        assert_eq!(m.source_app.as_deref(), Some("com.apple.Safari"));
        assert_eq!(m.items.len(), 3);
        assert!(matches!(m.items[0], StagedManifestItem::Url { ref url_string, .. } if url_string == "https://example.com/a"));
        assert!(matches!(m.items[1], StagedManifestItem::Text { ref text, .. } if text == "note"));
        assert!(matches!(m.items[2], StagedManifestItem::File { ref filename, .. } if filename == "paper.pdf"));

        // Round-trip keeps camelCase field names stable for the writer side.
        let again: StagedManifest =
            serde_json::from_str(&serde_json::to_string(&m).unwrap()).unwrap();
        assert_eq!(again.received_at, 1724200000000);
    }

    #[test]
    fn manifest_tolerates_missing_optional_fields() {
        let m: StagedManifest = serde_json::from_str(
            r#"{"id":"x","receivedAt":1,"items":[{"kind":"url","urlString":"https://e.com"}]}"#,
        )
        .unwrap();
        assert!(m.source_app.is_none());
        assert_eq!(m.attempts, 0);
    }

    #[test]
    fn claim_moves_ready_to_claiming_and_returns_batches_oldest_first() {
        let root = temp_root("order");
        stage_ready(&root, "b-new", 2000, 0);
        stage_ready(&root, "a-old", 1000, 0);

        let claimed = scan_and_claim(&root).unwrap();
        assert_eq!(claimed.len(), 2);
        assert_eq!(claimed[0].manifest.id, "a-old");
        assert_eq!(claimed[1].manifest.id, "b-new");
        assert!(!root.join(".ready").join("a-old").exists());
        assert!(root.join(".claiming").join("a-old").join(CLAIM_MARKER).exists());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn claim_is_exactly_once_within_a_scan_cycle() {
        let root = temp_root("once");
        stage_ready(&root, "only", 1000, 0);

        let first = scan_and_claim(&root).unwrap();
        assert_eq!(first.len(), 1);
        // Second scan sees nothing: the batch is claimed, not re-served.
        let second = scan_and_claim(&root).unwrap();
        assert!(second.is_empty());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn fresh_claims_are_not_reclaimed_but_stale_ones_are() {
        let root = temp_root("reclaim");
        stage_ready(&root, "batch", 1000, 0);
        let claimed = scan_and_claim(&root).unwrap();
        assert_eq!(claimed.len(), 1);

        // Fresh claim marker → untouched.
        assert_eq!(reclaim_stale(&root).unwrap(), 0);
        assert!(root.join(".claiming").join("batch").exists());

        // Backdate the claim marker past the timeout → reclaimed to .ready.
        let marker = root.join(".claiming").join("batch").join(CLAIM_MARKER);
        let ancient = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
            - (CLAIM_TIMEOUT.as_millis() + 60_000);
        std::fs::write(&marker, ancient.to_string()).unwrap();

        assert_eq!(reclaim_stale(&root).unwrap(), 1);
        assert!(root.join(".ready").join("batch").exists());
        assert!(!root.join(".claiming").join("batch").exists());

        // And it can be claimed again (at-least-once redelivery).
        let again = scan_and_claim(&root).unwrap();
        assert_eq!(again.len(), 1);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn missing_claim_marker_is_treated_as_stale() {
        let root = temp_root("nomarker");
        stage_ready(&root, "batch", 1000, 0);
        let claimed = scan_and_claim(&root).unwrap();
        assert_eq!(claimed.len(), 1);
        std::fs::remove_file(
            root.join(".claiming").join("batch").join(CLAIM_MARKER),
        )
        .unwrap();

        assert_eq!(reclaim_stale(&root).unwrap(), 1);
        assert!(root.join(".ready").join("batch").exists());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn complete_claim_deletes_and_is_idempotent() {
        let root = temp_root("complete");
        stage_ready(&root, "batch", 1000, 0);
        scan_and_claim(&root).unwrap();

        complete_claim(&root, "batch").unwrap();
        assert!(!root.join(".claiming").join("batch").exists());
        // Idempotent: completing an unknown/already-consumed id is fine.
        complete_claim(&root, "batch").unwrap();
        complete_claim(&root, "never-existed").unwrap();

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn retry_increments_attempts_until_bound_then_fails_the_batch() {
        let root = temp_root("retry");
        stage_ready(&root, "batch", 1000, 0);

        for expected_attempts in 1..MAX_ATTEMPTS {
            let claimed = scan_and_claim(&root).unwrap();
            assert_eq!(claimed.len(), 1);
            assert_eq!(
                retry_claim(&root, "batch").unwrap(),
                RetryOutcome::Released
            );
            let m = manifest_of(&root, ".ready", "batch");
            assert_eq!(m.attempts, expected_attempts);
        }

        // Final allowed attempt exhausts the bound → .failed/.
        let claimed = scan_and_claim(&root).unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(
            retry_claim(&root, "batch").unwrap(),
            RetryOutcome::Exhausted
        );
        assert!(root.join(".failed").join("batch").exists());
        assert!(!root.join(".ready").join("batch").exists());
        assert!(!root.join(".claiming").join("batch").exists());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn materialize_files_copies_payloads_into_staging_and_reports_missing() {
        let root = temp_root("materialize");
        stage_ready(&root, "batch", 1000, 0);
        let claimed = scan_and_claim(&root).unwrap();

        let staging = root.join("app-staging");
        let (staged, missing) = materialize_files(&claimed[0], &staging).unwrap();

        // paper.pdf copied; url/text items contribute nothing.
        assert_eq!(staged.len(), 1);
        let path = staged.get("paper.pdf").unwrap();
        let staged_path = Path::new(path);
        assert!(staged_path.is_file());
        assert!(staged_path.starts_with(&staging));
        assert!(staged_path.to_string_lossy().contains("batch"));
        assert_eq!(std::fs::read(path).unwrap(), b"%PDF-fake");
        // Original stays in the container until complete_claim.
        assert!(claimed[0].dir.join("paper.pdf").is_file());

        // Missing payload is reported, not fatal.
        let empty = ClaimedShare {
            manifest: serde_json::from_str(
                r#"{"id":"gone","receivedAt":1,"attempts":0,"items":[{"kind":"file","filename":"nope.pdf"}]}"#,
            )
            .unwrap(),
            dir: root.join(".claiming").join("batch"),
        };
        let (_, missing2) = materialize_files(&empty, &staging).unwrap();
        assert_eq!(missing2, vec!["nope.pdf".to_string()]);
        assert!(missing.is_empty());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn sanitize_id_blocks_path_traversal() {
        assert_eq!(sanitize_id("abc-123_XY"), "abc-123_XY");
        assert_eq!(sanitize_id("../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_id("..\\..\\evil"), "evil");
        assert_eq!(sanitize_id(""), "__invalid_id__");
    }

    #[test]
    fn traversal_id_cannot_escape_queues() {
        let root = temp_root("traversal");
        stage_ready(&root, "batch", 1000, 0);
        scan_and_claim(&root).unwrap();

        // A hostile id must not delete anything outside .claiming/.
        complete_claim(&root, "../../../ready/batch").unwrap();
        assert!(root.join(".claiming").join("batch").exists());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn corrupt_manifest_is_parked_in_failed_not_looped() {
        let root = temp_root("corrupt");
        let dir = root.join(".ready").join("broken");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(MANIFEST_FILE), "{not json").unwrap();

        let result = scan_and_claim(&root);
        assert!(result.is_err());
        assert!(root.join(".failed").join("broken").exists());
        assert!(!root.join(".claiming").join("broken").exists());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn missing_shares_root_yields_empty_batch_list() {
        let root = temp_root("empty");
        let claimed = scan_and_claim(&root).unwrap();
        assert!(claimed.is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
