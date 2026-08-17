//! One-time desktop migration from the legacy Incrementum app-data directory
//! (task 3.1, change `rebrand-incrementum-to-plethora`).
//!
//! When the Plethora identifier (`com.plethora.app`) resolves to a fresh
//! app-data directory and the legacy `com.incrementum.app` directory exists
//! next to it, the backend records a *pending* migration and lets the frontend
//! offer a localized consent dialog (the webview owns the i18n tables; the
//! native pre-webview dialog cannot be localized). On consent the frontend
//! invokes [`crate::migrate_legacy_data`], which:
//!
//! 1. closes the live database pool,
//! 2. moves the (brand-new, possibly demo-seeded) current database file set
//!    aside under a `.pre-migration-backup` name — nothing is ever deleted,
//! 3. **copies** (never moves) the entire legacy tree into the new directory,
//!    renaming the db file set `incrementum.db*` → `plethora.db*`,
//! 4. verifies the copied database size matches the source, and on any
//!    failure restores the backup set and returns an error,
//! 5. writes a completion marker and asks the frontend to relaunch.
//!
//! The legacy directory is NEVER modified or deleted by app code; it stays
//! intact as the rollback path. Declining the dialog writes a declined marker
//! and the offer is never repeated.

use std::path::{Path, PathBuf};

pub const LEGACY_IDENTIFIER: &str = "com.incrementum.app";

/// Completion marker (JSON). Presence means the migration ran; the frontend
/// notice is surfaced exactly once via the `noticed` flag inside.
pub const MIGRATION_MARKER: &str = ".incrementum-migration.json";
/// Written at first detection, re-checked on every boot until answered.
const PENDING_MARKER: &str = ".incrementum-migration-pending";
/// Written when the user declines; suppresses the offer forever.
const DECLINED_MARKER: &str = ".incrementum-migration-declined";
/// Disposable directories that are never copied.
const SKIP_DIRS: [&str; 2] = ["logs", "temp_transcription"];

#[derive(Debug, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct MigrationReport {
    pub legacy_dir: String,
    pub copied_files: u64,
    /// Path of the set-aside pre-migration database, when one existed.
    pub backup_db: Option<String>,
    pub completed_at: String,
    /// Whether the frontend already surfaced the completion notice.
    #[serde(default)]
    pub noticed: bool,
}

/// The legacy app-data directory: the sibling of `new_dir` named after the
/// legacy identifier. Deriving it from the resolver-provided new dir keeps
/// this correct on every desktop platform regardless of how Tauri maps
/// identifiers to base directories.
pub fn legacy_app_data_dir(new_dir: &Path) -> PathBuf {
    new_dir
        .parent()
        .map(|parent| parent.join(LEGACY_IDENTIFIER))
        .unwrap_or_else(|| PathBuf::from(LEGACY_IDENTIFIER))
}

fn dir_is_empty(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(mut entries) => entries.next().is_none(),
        Err(_) => true,
    }
}

/// Whether a migration should be offered. On the first qualifying boot this
/// WRITES the pending marker (so the offer survives the directory filling up
/// with the fresh database); later boots re-arm from that marker.
pub fn detect_pending_migration(new_dir: &Path) -> Option<PathBuf> {
    if new_dir.join(MIGRATION_MARKER).exists() || new_dir.join(DECLINED_MARKER).exists() {
        return None;
    }
    let legacy_dir = legacy_app_data_dir(new_dir);
    if !legacy_dir.is_dir() || dir_is_empty(&legacy_dir) {
        return None;
    }
    let pending = new_dir.join(PENDING_MARKER);
    if pending.exists() {
        return Some(legacy_dir);
    }
    if dir_is_empty(new_dir) {
        // First boot: arm the offer BEFORE the fresh database files make the
        // directory non-empty.
        if std::fs::create_dir_all(new_dir).is_ok() {
            let _ = std::fs::write(
                &pending,
                serde_json::to_string(&serde_json::json!({
                    "legacy_dir": legacy_dir.display().to_string(),
                    "offered_at": chrono::Utc::now().to_rfc3339(),
                }))
                .unwrap_or_default(),
            );
            return Some(legacy_dir);
        }
        return None;
    }
    None
}

/// Read the completion marker, marking it as noticed. Returns the report the
/// first time (so a `LegacyDataMigrated` notice can be surfaced) and `None`
/// afterwards.
pub fn take_migration_completion_notice(new_dir: &Path) -> Option<MigrationReport> {
    let path = new_dir.join(MIGRATION_MARKER);
    let raw = std::fs::read_to_string(&path).ok()?;
    let mut report: MigrationReport = serde_json::from_str(&raw).ok()?;
    if report.noticed {
        return None;
    }
    report.noticed = true;
    let _ = std::fs::write(&path, serde_json::to_string_pretty(&report).unwrap_or(raw));
    Some(report)
}

fn db_set(dir: &Path, stem: &str) -> [PathBuf; 3] {
    [
        dir.join(format!("{stem}-wal")),
        dir.join(format!("{stem}-shm")),
        dir.join(stem),
    ]
}

/// Move the current database file set aside (never delete). Returns the backup
/// main-db path when a live database existed.
fn set_aside_current_db(new_dir: &Path) -> std::io::Result<Option<PathBuf>> {
    let set = db_set(new_dir, crate::database::connection::DB_FILE_NAME);
    let mut backed_up_main: Option<PathBuf> = None;
    for path in &set {
        if !path.exists() {
            continue;
        }
        let mut name = path.file_name().unwrap_or_default().to_owned();
        name.push(".pre-migration-backup");
        let dest = path.with_file_name(name);
        std::fs::rename(path, &dest)?;
        if backed_up_main.is_none() && *path == set[2] {
            backed_up_main = Some(dest);
        }
    }
    Ok(backed_up_main)
}

fn restore_backed_up_db(new_dir: &Path) {
    let stem = crate::database::connection::DB_FILE_NAME;
    for path in db_set(new_dir, stem) {
        let mut name = path.file_name().unwrap_or_default().to_owned();
        name.push(".pre-migration-backup");
        let backup = path.with_file_name(name);
        if backup.exists() {
            let _ = std::fs::rename(&backup, &path);
        }
    }
}

/// Destination path for a copied entry. The database file set is renamed from
/// the legacy stem to the new stem; everything else keeps its name.
fn mapped_dest(dest_root: &Path, src_file: &Path, legacy_stem: &str, new_stem: &str) -> PathBuf {
    let name = src_file
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    let mapped = if name == legacy_stem
        || name == format!("{legacy_stem}-wal")
        || name == format!("{legacy_stem}-shm")
        || name.starts_with(&format!("{legacy_stem}.corrupt."))
    {
        name.replacen(legacy_stem, new_stem, 1)
    } else {
        name.to_string()
    };
    dest_root.join(mapped)
}

fn copy_tree(
    src: &Path,
    dest: &Path,
    legacy_stem: &str,
    new_stem: &str,
    counter: &mut u64,
) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            // Marker/state files of a running Plethora install are never
            // overwritten from the legacy tree.
            if name.starts_with(".incrementum-migration") {
                continue;
            }
            copy_tree(&path, &dest.join(name), legacy_stem, new_stem, counter)?;
        } else {
            let dest_path = mapped_dest(dest, &path, legacy_stem, new_stem);
            if dest_path.exists() {
                // Never overwrite anything already present in the new
                // install (the pending/declined markers, the backed-up db).
                continue;
            }
            std::fs::copy(&path, &dest_path)?;
            *counter += 1;
        }
    }
    Ok(())
}

/// Perform the full migration. See the module docs for the ordering and the
/// safety invariants (copy-never-move, set-aside-never-delete, verify, and
/// restore-on-failure).
pub fn perform_migration(new_dir: &Path, legacy_dir: &Path) -> anyhow::Result<MigrationReport> {
    if !legacy_dir.is_dir() {
        anyhow::bail!(
            "legacy data directory no longer exists: {}",
            legacy_dir.display()
        );
    }
    let legacy_stem = crate::database::connection::LEGACY_DB_FILE_NAME;
    let new_stem = crate::database::connection::DB_FILE_NAME;

    let backup_db = set_aside_current_db(new_dir)?;

    let mut copied: u64 = 0;
    let copy_result = copy_tree(legacy_dir, new_dir, legacy_stem, new_stem, &mut copied);

    // Verification: when the legacy database existed, its copy must exist and
    // match the source size byte-for-byte.
    let legacy_db = legacy_dir.join(legacy_stem);
    let new_db = new_dir.join(new_stem);
    let verified = if legacy_db.exists() {
        match (std::fs::metadata(&legacy_db), std::fs::metadata(&new_db)) {
            (Ok(a), Ok(b)) => a.len() == b.len(),
            _ => false,
        }
    } else {
        true
    };

    if let Err(err) = copy_result {
        // Roll back to the pre-migration state: remove the partial db copy
        // (our own write, not user data), restore the set-aside live db.
        let _ = std::fs::remove_file(&new_db);
        restore_backed_up_db(new_dir);
        anyhow::bail!("legacy data copy failed: {err}");
    }
    if !verified {
        let _ = std::fs::remove_file(&new_db);
        restore_backed_up_db(new_dir);
        anyhow::bail!(
            "legacy database copy verification failed ({} -> {})",
            legacy_db.display(),
            new_db.display()
        );
    }

    let report = MigrationReport {
        legacy_dir: legacy_dir.display().to_string(),
        copied_files: copied,
        backup_db: backup_db.as_ref().map(|p| p.display().to_string()),
        completed_at: chrono::Utc::now().to_rfc3339(),
        noticed: false,
    };
    std::fs::write(
        new_dir.join(MIGRATION_MARKER),
        serde_json::to_string_pretty(&report).unwrap_or_default(),
    )?;
    let _ = std::fs::remove_file(new_dir.join(PENDING_MARKER));
    tracing::info!(
        "legacy data migration complete: {} files copied from {}",
        copied,
        legacy_dir.display()
    );
    Ok(report)
}

/// Record an explicit user decline so the offer never repeats.
pub fn mark_declined(new_dir: &Path) {
    let _ = std::fs::write(
        new_dir.join(DECLINED_MARKER),
        chrono::Utc::now().to_rfc3339(),
    );
    let _ = std::fs::remove_file(new_dir.join(PENDING_MARKER));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "plethora-legacy-migration-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn populate_legacy(dir: &Path) {
        std::fs::write(dir.join("incrementum.db"), b"database-bytes").unwrap();
        std::fs::write(dir.join("incrementum.db-wal"), b"wal-bytes").unwrap();
        std::fs::write(dir.join("incrementum.db-shm"), b"shm-bytes").unwrap();
        std::fs::write(
            dir.join("incrementum.db.corrupt.20260101T000000Z"),
            b"quarantined",
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("ai_keys")).unwrap();
        std::fs::write(dir.join("ai_keys/openai.enc"), b"enc").unwrap();
        std::fs::create_dir_all(dir.join("tokens")).unwrap();
        std::fs::write(dir.join("tokens/dropbox.enc"), b"tok").unwrap();
        std::fs::create_dir_all(dir.join("documents/pdf")).unwrap();
        std::fs::write(dir.join("documents/pdf/book.pdf"), b"pdf").unwrap();
        std::fs::create_dir_all(dir.join("models/whisper")).unwrap();
        std::fs::write(dir.join("models/whisper/small.bin"), b"model").unwrap();
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        std::fs::write(dir.join("logs/startup.log"), b"log").unwrap();
        std::fs::create_dir_all(dir.join("temp_transcription")).unwrap();
        std::fs::write(dir.join("temp_transcription/x.wav"), b"tmp").unwrap();
        std::fs::write(dir.join("storage_state.json"), b"{}").unwrap();
    }

    #[test]
    fn detection_arms_on_first_boot_and_rearms_from_marker() {
        let base = temp_dir("detect");
        let new_dir = base.join("com.plethora.app");
        let legacy = base.join("com.incrementum.app");
        std::fs::create_dir_all(&legacy).unwrap();
        populate_legacy(&legacy);

        // First boot: new dir missing entirely.
        assert_eq!(detect_pending_migration(&new_dir), Some(legacy.clone()));
        assert!(new_dir.join(PENDING_MARKER).exists());

        // Subsequent boot: new dir no longer empty (fresh db created), but the
        // pending marker re-arms the offer.
        std::fs::write(new_dir.join("plethora.db"), b"fresh").unwrap();
        assert_eq!(detect_pending_migration(&new_dir), Some(legacy.clone()));

        // After completion: never again.
        std::fs::write(
            new_dir.join(MIGRATION_MARKER),
            serde_json::to_string(&MigrationReport {
                legacy_dir: legacy.display().to_string(),
                copied_files: 1,
                backup_db: None,
                completed_at: String::new(),
                noticed: true,
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(detect_pending_migration(&new_dir), None);

        // After declining: never again.
        std::fs::remove_file(new_dir.join(MIGRATION_MARKER)).unwrap();
        mark_declined(&new_dir);
        assert_eq!(detect_pending_migration(&new_dir), None);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn detection_ignores_missing_or_empty_legacy_dir() {
        let base = temp_dir("detect-empty");
        let new_dir = base.join("com.plethora.app");
        assert_eq!(detect_pending_migration(&new_dir), None);

        let legacy = base.join("com.incrementum.app");
        std::fs::create_dir_all(&legacy).unwrap();
        assert_eq!(detect_pending_migration(&new_dir), None);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn perform_migration_copies_renames_db_and_preserves_legacy() {
        let base = temp_dir("perform");
        let new_dir = base.join("com.plethora.app");
        let legacy = base.join("com.incrementum.app");
        std::fs::create_dir_all(&legacy).unwrap();
        populate_legacy(&legacy);
        // A fresh Plethora install already exists in the new dir.
        std::fs::create_dir_all(&new_dir).unwrap();
        std::fs::write(new_dir.join("plethora.db"), b"fresh-empty-db").unwrap();
        std::fs::write(new_dir.join("plethora.db-wal"), b"fresh-wal").unwrap();

        let report = perform_migration(&new_dir, &legacy).unwrap();

        // DB set copied under the new stem with the exact source bytes.
        assert_eq!(
            std::fs::read(new_dir.join("plethora.db")).unwrap(),
            b"database-bytes"
        );
        assert_eq!(
            std::fs::read(new_dir.join("plethora.db-wal")).unwrap(),
            b"wal-bytes"
        );
        assert_eq!(
            std::fs::read(new_dir.join("plethora.db-shm")).unwrap(),
            b"shm-bytes"
        );
        // Quarantine sibling carried over under the new stem.
        assert!(new_dir
            .join("plethora.db.corrupt.20260101T000000Z")
            .exists());
        // Other content copied verbatim.
        assert!(new_dir.join("ai_keys/openai.enc").exists());
        assert!(new_dir.join("tokens/dropbox.enc").exists());
        assert!(new_dir.join("documents/pdf/book.pdf").exists());
        assert!(new_dir.join("models/whisper/small.bin").exists());
        assert!(new_dir.join("storage_state.json").exists());
        // Disposable dirs skipped.
        assert!(!new_dir.join("logs").exists());
        assert!(!new_dir.join("temp_transcription").exists());

        // The pre-migration fresh db was set aside, not deleted.
        assert_eq!(
            std::fs::read(new_dir.join("plethora.db.pre-migration-backup")).unwrap(),
            b"fresh-empty-db"
        );
        assert_eq!(
            std::fs::read(new_dir.join("plethora.db-wal.pre-migration-backup")).unwrap(),
            b"fresh-wal"
        );

        // Legacy dir completely intact.
        assert!(legacy.join("incrementum.db").exists());
        assert!(legacy.join("incrementum.db-wal").exists());
        assert!(legacy.join("documents/pdf/book.pdf").exists());
        assert!(legacy.join("logs/startup.log").exists());

        // Completion marker written; pending marker gone.
        assert!(new_dir.join(MIGRATION_MARKER).exists());
        assert!(!new_dir.join(PENDING_MARKER).exists());
        assert!(report.copied_files > 0);
        assert!(report.backup_db.is_some());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn completion_notice_is_surfaced_exactly_once() {
        let base = temp_dir("notice");
        let new_dir = base.join("com.plethora.app");
        let legacy = base.join("com.incrementum.app");
        std::fs::create_dir_all(&legacy).unwrap();
        populate_legacy(&legacy);
        std::fs::create_dir_all(&new_dir).unwrap();

        perform_migration(&new_dir, &legacy).unwrap();
        let first = take_migration_completion_notice(&new_dir);
        assert!(first.is_some(), "first read must surface the notice");
        let second = take_migration_completion_notice(&new_dir);
        assert!(second.is_none(), "notice must be one-shot");

        let _ = std::fs::remove_dir_all(&base);
    }
}
