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
    // Keep restricted source associations after a later unlink or deletion.
    sqlx::query("INSERT OR IGNORE INTO private_sync_ownership SELECT o.entity_type, o.entity_id, o.document_id FROM document_sync_ownership o JOIN documents d ON d.id = o.document_id WHERE o.entity_type = ?1 AND o.entity_id = ?2 AND d.is_local_only = 1")
        .bind(entity_type.as_str()).bind(entity_id).execute(&mut **tx).await?;
    if !crate::database::document_privacy::sync_entity_allowed(&mut **tx, entity_type, entity_id)
        .await?
    {
        return Ok(());
    }
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
