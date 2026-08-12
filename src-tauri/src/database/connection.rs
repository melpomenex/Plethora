//! Database connection management

use sqlx::{pool::PoolOptions, sqlite::SqliteConnectOptions, Sqlite, SqlitePool};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use crate::error::{IncrementumError, Result};

#[derive(Clone)]
pub struct Database {
    pool: SqlitePool,
}

/// Outcome of [`Database::open_or_recover`]. Lets the caller tell the user
/// whether their existing database was reused or had to be quarantined and
/// recreated from scratch after failing the startup integrity check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenOutcome {
    /// An existing database was opened and passed the integrity check.
    OpenedExisting,
    /// A brand new database was created (no prior file existed).
    CreatedFresh,
    /// The existing database was corrupt. It was quarantined aside and a
    /// fresh, empty database was created in its place. The quarantined files
    /// are kept on disk so the user (or a developer) can inspect them later.
    RecoveredAfterQuarantine,
}

/// Why an open attempt failed. The distinction is load-bearing: only
/// `Corrupt` — an actual non-`ok` verdict from SQLite's structural check —
/// may cause the database to be quarantined. Treating a lock, a pool acquire
/// timeout, or a permission error as corruption renames a healthy database
/// aside and silently loses the user's library.
enum OpenFailure {
    /// SQLite reported a structural problem; the string is its verdict.
    Corrupt(String),
    /// Anything else: locks, timeouts, permissions, IO, bad path.
    Transient(IncrementumError),
}

/// Classify a connect-time sqlx error. A file that is not a database at all
/// (`SQLITE_NOTADB`) or whose pages are damaged (`SQLITE_CORRUPT`) never
/// reaches `quick_check`, so those two must be recognised here — while
/// `SQLITE_BUSY`/`LOCKED`/`CANTOPEN`/`IOERR` and pool timeouts must not be.
fn classify_connect_error(err: &sqlx::Error) -> OpenFailure {
    let primary_code = match err {
        sqlx::Error::Database(db_err) => db_err
            .code()
            .and_then(|c| c.parse::<i32>().ok())
            // SQLite reports extended result codes; the primary code is the
            // low byte (e.g. SQLITE_CORRUPT_VTAB 267 -> SQLITE_CORRUPT 11).
            .map(|code| code & 0xff),
        _ => None,
    };
    const SQLITE_CORRUPT: i32 = 11;
    const SQLITE_NOTADB: i32 = 26;

    match primary_code {
        Some(SQLITE_CORRUPT) | Some(SQLITE_NOTADB) => OpenFailure::Corrupt(err.to_string()),
        _ => OpenFailure::Transient(IncrementumError::Internal(format!(
            "Database connection pool failed (check if another process has the DB locked): {}",
            err
        ))),
    }
}

impl Database {
    /// Create a new database connection pool.
    ///
    /// **Fatal on corruption**: if the file fails the startup integrity check,
    /// this returns an error. Callers that want automatic recovery should use
    /// [`Database::open_or_recover`] instead.
    pub async fn new(path: PathBuf) -> Result<Self> {
        let (db, _outcome) = Self::open_or_recover(path).await?;
        Ok(db)
    }

    /// Open the database, automatically recovering from corruption.
    ///
    /// Tries to open the existing file and run `PRAGMA integrity_check`. If the
    /// check fails (or the file cannot be opened at all), the corrupt file and
    /// its WAL/SHM siblings are moved aside into a timestamped quarantine name
    /// and a fresh database is created in the original location. This keeps the
    /// app launchable even when the on-disk database is damaged, instead of
    /// panicking inside the Tauri setup hook.
    ///
    /// The second return value tells the caller which path was taken so it can
    /// surface a "your database was reset" notice to the user.
    pub async fn open_or_recover(path: PathBuf) -> Result<(Self, OpenOutcome)> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let already_existed = path.exists();

        // Retry non-corruption failures before giving up. A locked file or a
        // pool acquire timeout (Syncthing writing in the directory, a lingering
        // pool from a previous instance) is transient — and must NEVER be
        // treated as corruption, because quarantining renames a perfectly
        // healthy database aside and loses the user's library.
        let mut last_transient: Option<IncrementumError> = None;
        for (attempt, backoff_ms) in [250u64, 1000, 0].iter().enumerate() {
            match Self::open_checked(&path).await {
                Ok(db) => {
                    let outcome = if already_existed {
                        OpenOutcome::OpenedExisting
                    } else {
                        OpenOutcome::CreatedFresh
                    };
                    return Ok((db, outcome));
                }
                Err(OpenFailure::Corrupt(verdict)) if already_existed => {
                    // Genuinely corrupt: quarantine the damaged files and start
                    // over rather than making the app unlaunchable.
                    tracing::error!(
                        "Database at {} failed its integrity check ({}); quarantining and recreating",
                        path.display(),
                        verdict
                    );
                    if let Err(quarantine_err) = Self::quarantine_corrupt_files(&path).await {
                        tracing::warn!(
                            "Failed to quarantine corrupt database files ({}); \
                             continuing with a fresh database anyway. The corrupt \
                             file may be overwritten.",
                            quarantine_err
                        );
                    }
                    let db = Self::open_with_integrity_check(&path).await?;
                    return Ok((db, OpenOutcome::RecoveredAfterQuarantine));
                }
                Err(OpenFailure::Corrupt(verdict)) => {
                    // No prior file existed yet the fresh one is already
                    // corrupt — a genuine environment problem, don't mask it.
                    return Err(IncrementumError::Internal(format!(
                        "Database integrity check failed: {verdict}"
                    )));
                }
                Err(OpenFailure::Transient(err)) => {
                    tracing::warn!(
                        "Database at {} could not be opened (attempt {}): {}",
                        path.display(),
                        attempt + 1,
                        err
                    );
                    last_transient = Some(err);
                    if *backoff_ms > 0 {
                        tokio::time::sleep(Duration::from_millis(*backoff_ms)).await;
                    }
                }
            }
        }

        // Out of retries with no corruption verdict. Fail loudly and leave the
        // file untouched — an actionable startup error beats a silent reset.
        Err(last_transient.unwrap_or_else(|| {
            IncrementumError::Internal("Database could not be opened".to_string())
        }))
    }

    /// Open the database at `path` and verify it with `PRAGMA integrity_check`.
    ///
    /// Flattens [`Self::open_checked`]'s failure kinds back into a plain error;
    /// callers that must distinguish corruption from a transient failure (i.e.
    /// anything that decides to quarantine) use `open_checked` directly.
    async fn open_with_integrity_check(path: &Path) -> Result<Self> {
        Self::open_checked(path).await.map_err(|failure| match failure {
            OpenFailure::Corrupt(verdict) => {
                IncrementumError::Internal(format!("Database integrity check failed: {verdict}"))
            }
            OpenFailure::Transient(err) => err,
        })
    }

    /// Open the database at `path`, distinguishing a failed structural check
    /// (`OpenFailure::Corrupt`) from every other reason an open can fail
    /// (`OpenFailure::Transient`: locks, timeouts, permissions, IO).
    async fn open_checked(path: &Path) -> std::result::Result<Self, OpenFailure> {
        // Create connection options with proper concurrency settings
        let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", path.display()))
            .map_err(|e| {
                OpenFailure::Transient(IncrementumError::Internal(format!(
                    "Invalid database path: {}",
                    e
                )))
            })?
            .create_if_missing(true)
            // Set busy timeout to wait for locks instead of failing immediately
            .busy_timeout(Duration::from_secs(30))
            // Enable foreign keys
            .pragma("foreign_keys", "ON")
            // Rows removed by an ON DELETE CASCADE only fire their table's
            // triggers when this is ON. Migration 081's count triggers depend
            // on it: deleting an extract cascades its learning_items, and
            // documents.learning_item_count must follow them down.
            .pragma("recursive_triggers", "ON")
            // WAL mode for better concurrency (set per-connection so every pool
            // connection inherits it, rather than a one-shot PRAGMA on the first)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            // NORMAL synchronous with WAL gives good durability/performance trade-off
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);

        // SQLite serializes writes, so a large pool mostly adds connection
        // startup and lock contention on low-power Android devices. Keep a
        // smaller mobile pool while retaining headroom on desktop; deferred
        // sync work no longer needs twenty connections during first render.
        let max_connections = if cfg!(any(target_os = "android", target_os = "ios")) {
            4
        } else {
            12
        };
        let pool = PoolOptions::<Sqlite>::new()
            .max_connections(max_connections)
            .acquire_timeout(Duration::from_secs(60))
            .connect_with(options)
            .await
            .map_err(|e| classify_connect_error(&e))?;

        // Close the pool if any subsequent step fails so we don't leave a
        // half-initialized connection pool around after returning an error.
        //
        // `quick_check` (not `integrity_check`) on purpose: it verifies the
        // same structural integrity that matters for deciding whether the DB
        // is safe to open — b-tree page structure, page counts, freelist —
        // but skips the expensive cross-check that every table row also
        // appears in its indexes. On a ~100MB DB that cross-check dominates
        // (a full integrity_check took >1s here and blocked the main thread,
        // since this runs inside block_on in the setup hook). quick_check
        // detects the same corruption that triggers quarantine below.
        let integrity = sqlx::query_as::<_, (String,)>("PRAGMA quick_check")
            .fetch_one(&pool)
            .await;
        match integrity {
            Ok((check,)) if check == "ok" => Ok(Self { pool }),
            Ok((check,)) => {
                // SQLite gave a verdict and it isn't "ok" — the file really is
                // damaged. Only this branch may lead to quarantine.
                tracing::error!("Database integrity check failed: {}", check);
                pool.close().await;
                Err(OpenFailure::Corrupt(check))
            }
            Err(e) => {
                // The check could not even run (lock, timeout, IO). That is not
                // a corruption verdict and must not cost the user their data.
                pool.close().await;
                Err(OpenFailure::Transient(IncrementumError::Internal(format!(
                    "Database integrity check could not run: {}",
                    e
                ))))
            }
        }
    }

    /// Move a corrupt database file and its WAL/SHM siblings aside into
    /// timestamped quarantine names, so the original path is free for a fresh
    /// database. The quarantined files are kept on disk for later inspection.
    async fn quarantine_corrupt_files(path: &Path) -> std::result::Result<(), std::io::Error> {
        let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");

        async fn quarantine(p: &Path, timestamp: &str) -> std::result::Result<(), std::io::Error> {
            if !p.exists() {
                return Ok(());
            }
            // <original-name>.corrupt.<timestamp>
            let mut name = match p.file_name() {
                Some(n) => n.to_owned(),
                None => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "cannot quarantine a path with no file name",
                    ))
                }
            };
            name.push(format!(".corrupt.{timestamp}"));
            let dest = p.with_file_name(name);
            tracing::info!(
                "Quarantining corrupt database file: {} -> {}",
                p.display(),
                dest.display()
            );
            tokio::fs::rename(p, dest).await
        }

        quarantine(path, &timestamp.to_string()).await?;
        // WAL and shared-memory sidecars created by SQLite in WAL mode.
        let mut wal = path.as_os_str().to_owned();
        wal.push("-wal");
        quarantine(Path::new(&wal), &timestamp.to_string()).await?;
        let mut shm = path.as_os_str().to_owned();
        shm.push("-shm");
        quarantine(Path::new(&shm), &timestamp.to_string()).await?;
        Ok(())
    }

    /// Get a reference to the connection pool
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Create a Database wrapper from an existing pool
    pub fn from_pool(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Run migrations on the database
    pub async fn migrate(&self) -> Result<()> {
        crate::database::migrations::run_migrations(self.pool()).await
    }

    /// Close the database connection
    pub async fn close(self) {
        self.pool.close().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_database_creation() {
        let db = Database::new(PathBuf::from(":memory:")).await;
        assert!(db.is_ok());
    }

    #[tokio::test]
    async fn test_synchronous_mode_is_normal() {
        let db = Database::new(PathBuf::from(":memory:")).await.unwrap();

        let row: (i32,) = sqlx::query_as("PRAGMA synchronous")
            .fetch_one(db.pool())
            .await
            .unwrap();

        // NORMAL is encoded as 1 by SQLite
        assert_eq!(row.0, 1, "PRAGMA synchronous should be NORMAL (1)");
    }

    #[tokio::test]
    async fn test_journal_mode_is_wal() {
        let db = Database::new(PathBuf::from(":memory:")).await.unwrap();

        let row: (String,) = sqlx::query_as("PRAGMA journal_mode")
            .fetch_one(db.pool())
            .await
            .unwrap();

        // WAL mode may not persist in :memory: databases; just verify the query works
        // and the journal_mode is set (could be "memory" or "wal" for in-memory DBs).
        // For file-backed databases this should be "wal".
        assert!(
            ["wal", "memory"].contains(&row.0.to_lowercase().as_str()),
            "PRAGMA journal_mode should be wal or memory, got: {}",
            row.0,
        );
    }

    /// Helper: unique temp dir per test, cleaned up on drop.
    fn temp_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "incrementum-db-test-{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn open_or_recover_creates_fresh_db_when_none_exists() {
        let dir = temp_test_dir("fresh");
        let db_path = dir.join("incrementum.db");

        let (db, outcome) = Database::open_or_recover(db_path.clone()).await.unwrap();
        assert_eq!(outcome, OpenOutcome::CreatedFresh);
        // Migrations should run cleanly on the fresh DB.
        db.migrate().await.unwrap();
        assert!(db_path.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn open_or_recover_reuses_healthy_existing_db() {
        let dir = temp_test_dir("reuse");
        let db_path = dir.join("incrementum.db");

        // First open creates + migrates.
        let (db, outcome) = Database::open_or_recover(db_path.clone()).await.unwrap();
        assert_eq!(outcome, OpenOutcome::CreatedFresh);
        db.migrate().await.unwrap();
        db.close().await;

        // Second open should reuse the existing healthy file.
        let (db, outcome) = Database::open_or_recover(db_path.clone()).await.unwrap();
        assert_eq!(outcome, OpenOutcome::OpenedExisting);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The bug this guards against cost a user their whole library: a healthy
    /// database that merely could not be opened (lock, permissions, IO) was
    /// classified as corrupt and renamed aside. Startup must fail loudly and
    /// leave every file exactly where it is.
    #[cfg(unix)]
    #[tokio::test]
    async fn open_or_recover_does_not_quarantine_an_unopenable_but_healthy_db() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_test_dir("unopenable");
        let db_path = dir.join("incrementum.db");

        // A real, healthy database…
        let (db, _) = Database::open_or_recover(db_path.clone()).await.unwrap();
        db.migrate().await.unwrap();
        db.close().await;
        // `close()` returns before the sqlx SQLite background thread's final
        // WAL checkpoint necessarily finishes: the checkpoint can still write
        // the full database through its already-open fd AFTER we chmod the
        // path (fd writes bypass the permission check), growing the file and
        // racing the assertions below. Wait until the file size is stable so
        // the database is fully settled before we measure it or lock it down.
        // (Observed on macOS/APFS; the WAL file itself may legitimately
        // persist, so stability of the main file — not `-wal` absence — is
        // the deterministic signal.)
        let settle_deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut last_len = std::fs::metadata(&db_path).unwrap().len();
        let mut stable_reads = 0;
        loop {
            tokio::time::sleep(Duration::from_millis(5)).await;
            let len = std::fs::metadata(&db_path).unwrap().len();
            if len == last_len {
                stable_reads += 1;
                if stable_reads >= 3 {
                    break;
                }
            } else {
                stable_reads = 0;
                last_len = len;
            }
            assert!(
                std::time::Instant::now() < settle_deadline,
                "database did not finish settling"
            );
        }
        let size_before = last_len;

        // …that we cannot open (SQLITE_CANTOPEN, not a corruption verdict).
        std::fs::set_permissions(&db_path, std::fs::Permissions::from_mode(0o000)).unwrap();
        // The mode change is not atomic with a subsequent open on macOS/APFS:
        // a fresh sqlite open within the first milliseconds can still succeed
        // (the vnode's permission check lags the chmod; observed flakily even
        // though a plain `File::open` reports the new mode). Sleep briefly so
        // the permission change is fully effective before reopening.
        tokio::time::sleep(Duration::from_millis(10)).await;

        let result = Database::open_or_recover(db_path.clone()).await;
        assert!(result.is_err(), "unopenable DB should surface an error");

        std::fs::set_permissions(&db_path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(
            std::fs::metadata(&db_path).unwrap().len(),
            size_before,
            "the original database must be left untouched"
        );
        let quarantined: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.contains(".corrupt."))
            .collect();
        assert!(
            quarantined.is_empty(),
            "a healthy DB must never be quarantined, got: {quarantined:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn open_or_recover_quarantines_corrupt_db_and_starts_fresh() {
        let dir = temp_test_dir("corrupt");
        let db_path = dir.join("incrementum.db");

        // Write garbage bytes that SQLite will reject the integrity check on.
        std::fs::write(&db_path, b"this is not a valid sqlite database file").unwrap();

        // open_or_recover must NOT fail — it should quarantine and recreate.
        let (db, outcome) = Database::open_or_recover(db_path.clone()).await.unwrap();
        assert_eq!(
            outcome,
            OpenOutcome::RecoveredAfterQuarantine,
            "corrupt DB should be quarantined and a fresh DB created"
        );

        // The original path now holds a fresh, usable database.
        assert!(db_path.exists());
        db.migrate().await.unwrap();

        // The corrupt original was renamed aside, not deleted.
        let entries: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            entries
                .iter()
                .any(|n| n.starts_with("incrementum.db.corrupt.")),
            "expected a quarantined db file, got: {entries:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Directly exercises the WAL/SHM sidecar quarantine: feed the helper real
    /// sidecar files and confirm they get renamed aside. We call the helper
    /// directly because SQLite's `create_if_missing` open re-creates/clears the
    /// sidecars during the recovery path, so an end-to-end test can't observe
    /// a pre-existing sidecar surviving to quarantine time.
    #[tokio::test]
    async fn quarantine_corrupt_files_moves_wal_and_shm_sidecars() {
        let dir = temp_test_dir("sidecars");
        let db_path = dir.join("incrementum.db");

        std::fs::write(&db_path, b"corrupt main").unwrap();
        std::fs::write(db_path.with_extension("db-wal"), b"corrupt wal").unwrap();
        std::fs::write(db_path.with_extension("db-shm"), b"corrupt shm").unwrap();

        Database::quarantine_corrupt_files(&db_path).await.unwrap();

        let entries: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        // All three files should have been moved aside; none of the originals
        // should remain at their original names.
        assert!(
            entries
                .iter()
                .any(|n| n.starts_with("incrementum.db.corrupt.")),
            "main db should be quarantined, got: {entries:?}"
        );
        assert!(
            entries
                .iter()
                .any(|n| n.starts_with("incrementum.db-wal.corrupt.")),
            "wal sidecar should be quarantined, got: {entries:?}"
        );
        assert!(
            entries
                .iter()
                .any(|n| n.starts_with("incrementum.db-shm.corrupt.")),
            "shm sidecar should be quarantined, got: {entries:?}"
        );
        assert!(
            !entries.iter().any(|n| n == "incrementum.db"
                || n == "incrementum.db-wal"
                || n == "incrementum.db-shm"),
            "no original file should remain at its original name, got: {entries:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn open_or_recover_recovers_repeatedly() {
        // Two consecutive corruptions should each be quarantined without
        // clobbering the previous quarantine (timestamped names prevent that).
        let dir = temp_test_dir("repeat");
        let db_path = dir.join("incrementum.db");

        // Round 1: corrupt -> quarantine -> fresh.
        std::fs::write(&db_path, b"corrupt v1").unwrap();
        let (db, outcome) = Database::open_or_recover(db_path.clone()).await.unwrap();
        assert_eq!(outcome, OpenOutcome::RecoveredAfterQuarantine);
        db.close().await;

        // Round 2: corrupt the freshly created file again.
        std::fs::write(&db_path, b"corrupt v2").unwrap();
        // Sleep briefly so the second quarantine timestamp differs from the first.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let (db, outcome) = Database::open_or_recover(db_path.clone()).await.unwrap();
        assert_eq!(outcome, OpenOutcome::RecoveredAfterQuarantine);
        db.close().await;

        let quarantined: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("incrementum.db.corrupt."))
            .collect();
        assert_eq!(
            quarantined.len(),
            2,
            "both corrupt files should be preserved separately, got: {quarantined:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
