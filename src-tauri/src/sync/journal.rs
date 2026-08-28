use crate::error::Result;
use sqlx::{Sqlite, Transaction};

use super::outbox::mark_dirty;
use super::scheduler;
use super::types::{EntityType, SyncOperation};

/// Journal a syncable mutation inside the caller's open SQLite transaction.
pub async fn journal_entity(
    tx: &mut Transaction<'_, Sqlite>,
    entity_type: EntityType,
    entity_id: &str,
    operation: SyncOperation,
    base_revision: Option<i64>,
    payload: Vec<u8>,
) -> Result<()> {
    mark_dirty(
        tx,
        entity_type,
        entity_id,
        operation,
        base_revision,
        payload,
    )
    .await?;
    Ok(())
}

/// Debounced background sync after a committed domain write.
pub fn notify_after_commit() {
    scheduler::request_background_sync(false);
}
