use crate::database::Repository;
use crate::entitlements::EntitlementCache;
use crate::error::{PlethoraError, Result};
use crate::plethora_auth::AuthManager;

use super::cursor::{get_server_cursor, set_server_cursor, touch_successful_sync};
use super::device::{adopt_device_id, ensure_device_id};
use super::flags::sync_v2_enabled;
use super::gate::cloud_sync_enabled;
use super::issues;
use super::keys::{get_key_epoch, load_master_key, set_key_epoch};
use super::merge::apply_remote_record;
use super::outbox::{acknowledge_changes, drain_pending_batch};
use super::transport::{ack_cursor, pull_page, push_records};
use super::types::{EntityType, PullResult, PushResult, SyncOperation, SyncRecord};
use super::wire::{decode_remote_record, outbox_entry_to_wire, WireConflict, MAX_PUSH_RECORDS};
use super::SyncEngine;

async fn require_master_key() -> Result<[u8; 32]> {
    load_master_key()
        .await?
        .ok_or_else(|| {
            PlethoraError::Internal(
                "Sync encryption key not configured. Generate and store a recovery key in Settings → Sync."
                    .into(),
            )
        })
}

async fn require_account_id(auth: &AuthManager) -> Result<String> {
    auth.get_user_id()
        .ok_or_else(|| PlethoraError::Internal("Sign in required for sync".into()))
}

pub async fn push_outbox(
    repo: &Repository,
    auth: &AuthManager,
    entitlements: &EntitlementCache,
) -> Result<PushResult> {
    if !sync_v2_enabled(Some(cloud_sync_enabled(entitlements))) {
        return Err(PlethoraError::Internal(
            "Plethora Pro sync is disabled for this account".to_string(),
        ));
    }

    let access_token = auth
        .get_access_token()
        .ok_or_else(|| PlethoraError::Internal("Sign in required for sync push".to_string()))?;

    let mut tx = repo.pool().begin().await?;
    let device_id = sync_device_id(&mut tx, auth).await?;
    tx.commit().await?;

    let master_key = require_master_key().await?;
    let mut key_epoch = get_key_epoch().await?;
    let account = require_account_id(auth).await?;

    let mut total_accepted = 0usize;
    // Push sequence numbers are server log positions, not proof that this
    // device has pulled/applied every record up to that position. Advancing
    // the pull cursor from a push can skip unseen changes from other devices.
    let mut latest_seq = 0u64;

    'outer: loop {
        let batch = drain_pending_batch(repo.pool(), MAX_PUSH_RECORDS).await?;
        if batch.is_empty() {
            break;
        }

        let mut stale_epoch_retries = 0;
        let (response, change_ids) = loop {
            let mut wire_batch = Vec::new();
            let mut change_ids = Vec::new();
            let mut batch_bytes = 0usize;

            for entry in &batch {
                // Image outbox rows contain the local bytes so the domain write
                // and journal remain atomic. Before encrypting the sync record,
                // move those bytes into encrypted blob storage and replace the
                // record payload with encrypted metadata + opaque blob identity.
                let prepared_entry = if entry.entity_type == EntityType::ImageAsset
                    && !matches!(entry.operation, SyncOperation::Delete)
                {
                    let mut prepared = entry.clone();
                    prepared.payload = super::image_sync::prepare_payload_for_push(
                        &access_token,
                        &master_key,
                        &entry.payload,
                    )
                    .await?;
                    prepared
                } else {
                    entry.clone()
                };
                let wire = outbox_entry_to_wire(
                    &prepared_entry,
                    &device_id,
                    &account,
                    Some(&master_key),
                    key_epoch,
                )
                .map_err(PlethoraError::Internal)?;
                let wire_size = wire.payload_ciphertext.len() + wire.aad.len() + 64;
                if !wire_batch.is_empty()
                    && (wire_batch.len() >= MAX_PUSH_RECORDS
                        || batch_bytes.saturating_add(wire_size) > super::wire::MAX_PUSH_BYTES)
                {
                    break;
                }
                batch_bytes = batch_bytes.saturating_add(wire_size);
                change_ids.push(entry.change_id.clone());
                wire_batch.push(wire);
            }

            if wire_batch.is_empty() {
                break 'outer;
            }

            match push_records(&access_token, wire_batch).await {
                Ok(response) => break (response, change_ids),
                Err(PlethoraError::StaleSyncKeyEpoch { account_epoch })
                    if account_epoch > key_epoch && stale_epoch_retries < 2 =>
                {
                    set_key_epoch(account_epoch).await?;
                    key_epoch = account_epoch;
                    stale_epoch_retries += 1;
                }
                Err(error) => return Err(error),
            }
        };
        total_accepted += response.accepted;
        latest_seq = latest_seq.max(response.latest_seq);

        acknowledge_changes(repo.pool(), &change_ids).await?;
        mark_conflicts_failed(repo.pool(), &response.conflicts).await?;
    }

    Ok(PushResult {
        accepted: total_accepted,
        latest_seq,
    })
}

async fn mark_conflicts_failed(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    conflicts: &[WireConflict],
) -> Result<()> {
    for conflict in conflicts {
        sqlx::query("UPDATE sync_outbox SET sync_status = 'failed' WHERE change_id = ?1")
            .bind(&conflict.change_id)
            .execute(pool)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to mark sync conflict: {e}")))?;
        issues::record_revision_conflict(pool, conflict).await?;
    }
    Ok(())
}

pub async fn pull_remote(
    repo: &Repository,
    auth: &AuthManager,
    entitlements: &EntitlementCache,
) -> Result<PullResult> {
    if !sync_v2_enabled(Some(cloud_sync_enabled(entitlements))) {
        return Err(PlethoraError::Internal(
            "Plethora Pro sync is disabled for this account".to_string(),
        ));
    }

    let access_token = auth
        .get_access_token()
        .ok_or_else(|| PlethoraError::Internal("Sign in required for sync pull".to_string()))?;

    let master_key = require_master_key().await?;
    let mut local_epoch = get_key_epoch().await?;
    let account = require_account_id(auth).await?;

    let mut cursor = get_server_cursor(repo.pool()).await?;
    let start_cursor = cursor;
    let mut applied_records = Vec::new();

    let mut tx = repo.pool().begin().await?;
    let local_device_id = sync_device_id(&mut tx, auth).await?;
    tx.commit().await?;

    loop {
        let (page, next_cursor, has_more, account_epoch) =
            pull_page(&access_token, &local_device_id, cursor, 500).await?;
        if account_epoch > local_epoch {
            set_key_epoch(account_epoch).await?;
            local_epoch = account_epoch;
        }
        if page.is_empty() {
            cursor = next_cursor;
            break;
        }

        let mut tx = repo.pool().begin().await?;
        let mut page_max_seq = cursor;
        // device_id -> (min_seq, max_seq, count) of records that failed
        // authenticity verification, aggregated so one rogue device produces
        // one issue row instead of one per record.
        let mut undecryptable: std::collections::BTreeMap<String, (u64, u64, u64)> =
            std::collections::BTreeMap::new();

        for (wire, seq_number) in page {
            page_max_seq = page_max_seq.max(seq_number);
            let remote = match decode_remote_record(
                &wire,
                seq_number,
                &account,
                Some(&master_key),
                local_epoch,
            ) {
                Ok(remote) => remote,
                Err(reason) => {
                    // A record this device cannot decrypt was written under a
                    // different master key (e.g. a device that generated its
                    // own recovery key instead of importing the account's) or
                    // its ciphertext is corrupt. Either way it is
                    // cryptographically unrecoverable here; aborting the pull
                    // would let one rogue device wedge the account log
                    // forever, so surface an issue and skip past it.
                    tracing::warn!(
                        device_id = %wire.device_id,
                        seq = seq_number,
                        error = %reason,
                        "skipping undecryptable sync record"
                    );
                    let entry = undecryptable
                        .entry(wire.device_id.clone())
                        .or_insert((seq_number, seq_number, 0));
                    entry.0 = entry.0.min(seq_number);
                    entry.1 = entry.1.max(seq_number);
                    entry.2 += 1;
                    continue;
                }
            };
            apply_remote_record(&mut tx, &local_device_id, &remote).await?;

            applied_records.push(SyncRecord {
                id: remote.record_id.clone(),
                table_kind: remote.table_kind,
                record_id: remote.record_id,
                hlc: remote.hlc,
                device_id: remote.device_id,
                payload_ciphertext: String::new(),
                aad: String::new(),
                key_version: remote.key_epoch,
            });
        }

        for (device_id, (min_seq, max_seq, count)) in undecryptable {
            issues::record_undecryptable_records(&mut tx, &device_id, min_seq, max_seq, count)
                .await?;
        }

        tx.commit().await?;
        cursor = page_max_seq.max(next_cursor);
        set_server_cursor(repo.pool(), cursor).await?;

        if !has_more {
            break;
        }
    }

    touch_successful_sync(repo.pool()).await?;

    // The server only advances this device's cursor (and GCs tombstones) on an
    // explicit ack, so it must be sent strictly after every pulled record has
    // been applied and the new cursor persisted locally. A crash before the
    // ack simply replays the page, which every apply path tolerates.
    if cursor > start_cursor {
        ack_cursor(&access_token, cursor).await?;
    }

    Ok(PullResult {
        records: applied_records,
        cursor,
        has_more: false,
    })
}

/// Resolve the device id used to stamp sync traffic. The account issues the
/// authoritative identity at sign-in (it is embedded in the access token), so
/// adopt it whenever the auth session provides one; otherwise fall back to the
/// locally persisted id.
async fn sync_device_id(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    auth: &AuthManager,
) -> Result<String> {
    match auth.get_device_id() {
        Some(auth_device_id) => adopt_device_id(tx, &auth_device_id).await,
        None => ensure_device_id(tx).await,
    }
}

pub async fn run_sync_cycle(
    repo: &Repository,
    auth: &AuthManager,
    engine: &SyncEngine,
    entitlements: &EntitlementCache,
) -> Result<(PushResult, PullResult)> {
    // A brand-new device stages its pre-existing local library before pulling,
    // but does not publish it yet. Staging atomically assigns HLC/field clocks
    // to local state, so the first remote snapshots cannot overwrite unsynced
    // local fields merely because those fields had no clock. We then pull and
    // reconcile cloud state before the staged outbox is sent.
    if get_server_cursor(repo.pool()).await? == 0 {
        super::full_state::index_local_document_identities(repo.pool()).await?;
        super::image_sync::index_local_identities(repo.pool()).await?;
        loop {
            let progress = super::bootstrap::bootstrap_upload_scan(repo.pool()).await?;
            if progress.phase != "upload" {
                break;
            }
            tokio::task::yield_now().await;
        }
        let _ = pull_remote(repo, auth, entitlements).await?;
    } else {
        // Bootstrap is an engine invariant, not a UI action. Each scan is
        // bounded to 100 rows and survives process restarts.
        loop {
            let progress = super::bootstrap::bootstrap_upload_scan(repo.pool()).await?;
            if progress.phase != "upload" {
                break;
            }
            tokio::task::yield_now().await;
        }
    }

    let push = push_outbox(repo, auth, entitlements).await?;
    let pull = pull_remote(repo, auth, entitlements).await?;
    engine.set_last_synced(chrono::Utc::now().to_rfc3339());
    Ok((push, pull))
}

pub fn map_error(error: PlethoraError) -> String {
    error.to_string()
}
