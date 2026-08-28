#[cfg(test)]
mod chaos {
    use super::super::retry::{record_failure, record_success, should_attempt_now};
    use super::super::wire::{decode_remote_record, outbox_entry_to_wire};
    use super::super::types::{EntityType, OutboxEntry, SyncOperation, SyncOutboxStatus};

    const TEST_MASTER_KEY: [u8; 32] = [7u8; 32];

    #[test]
    fn backoff_blocks_immediate_retry_after_failure() {
        record_success();
        assert!(should_attempt_now());
        record_failure();
        assert!(!should_attempt_now());
        record_success();
        assert!(should_attempt_now());
    }

    #[test]
    fn partial_push_payload_still_decodes_remaining_records() {
        let entry = OutboxEntry {
            change_id: "chaos-1".to_string(),
            entity_type: EntityType::LearningItem,
            entity_id: "item-1".to_string(),
            operation: SyncOperation::Update,
            base_revision: Some(1),
            payload: br#"{"schema_version":1,"entity_type":"learning_item","id":"item-1","collection_id":"col-1","question":"Q","answer":"A","due_date":"2026-01-01T00:00:00Z","algorithm_type":"fsrs","updated_at":null}"#.to_vec(),
            hlc: "4000:0".to_string(),
            created_at: 1,
            sync_status: SyncOutboxStatus::Pending,
        };
        let wire = outbox_entry_to_wire(&entry, "device-a", "acct", Some(&TEST_MASTER_KEY), 1).expect("wire");
        let decoded = decode_remote_record(&wire, 1, "acct", Some(&TEST_MASTER_KEY), 1).expect("decode");
        assert_eq!(decoded.record_id, "item-1");
    }

    #[test]
    fn stale_epoch_records_are_rejected_on_pull() {
        let entry = OutboxEntry {
            change_id: "chaos-2".to_string(),
            entity_type: EntityType::Document,
            entity_id: "doc-1".to_string(),
            operation: SyncOperation::Update,
            base_revision: None,
            payload: br#"{"schema_version":1,"entity_type":"document","id":"doc-1"}"#.to_vec(),
            hlc: "5000:0".to_string(),
            created_at: 1,
            sync_status: SyncOutboxStatus::Pending,
        };
        let wire = outbox_entry_to_wire(&entry, "device-a", "acct", Some(&TEST_MASTER_KEY), 1).expect("wire");
        let err = decode_remote_record(&wire, 1, "acct", Some(&TEST_MASTER_KEY), 2).expect_err("epoch");
        assert!(err.contains("epoch"));
    }
}
