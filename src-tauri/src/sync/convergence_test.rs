#[cfg(test)]
mod convergence {
    use std::collections::{HashMap, HashSet};

    use super::super::merge::hlc_gt;
    use super::super::types::{EntityType, SyncOperation};
    use super::super::wire::{decode_remote_record, outbox_entry_to_wire, WireSyncRecord};

    const TEST_MASTER_KEY: [u8; 32] = [7u8; 32];

    #[derive(Clone)]
    struct StoredRecord {
        wire: WireSyncRecord,
        seq: u64,
    }

    struct MockSyncServer {
        records: Vec<StoredRecord>,
        processed_changes: HashSet<String>,
        entity_revisions: HashMap<(String, String), i64>,
        next_seq: u64,
    }

    impl MockSyncServer {
        fn new() -> Self {
            Self {
                records: Vec::new(),
                processed_changes: HashSet::new(),
                entity_revisions: HashMap::new(),
                next_seq: 0,
            }
        }

        fn push(&mut self, batch: Vec<WireSyncRecord>) -> (usize, u64) {
            let mut accepted = 0usize;
            let mut latest = self.next_seq;
            for wire in batch {
                if let Some(change_id) = &wire.change_id {
                    if self.processed_changes.contains(change_id) {
                        continue;
                    }
                }
                if self.records.iter().any(|stored| {
                    stored.wire.device_id == wire.device_id && stored.wire.hlc == wire.hlc
                }) {
                    continue;
                }

                self.next_seq += 1;
                latest = self.next_seq;
                self.records.push(StoredRecord {
                    wire: wire.clone(),
                    seq: self.next_seq,
                });
                accepted += 1;

                if let Some(change_id) = &wire.change_id {
                    self.processed_changes.insert(change_id.clone());
                }
                let key = (wire.table_kind.clone(), wire.record_id.clone());
                let revision = self.entity_revisions.get(&key).copied().unwrap_or(0) + 1;
                self.entity_revisions.insert(key, revision);
            }
            (accepted, latest)
        }

        fn pull(&self, cursor: u64) -> (Vec<(WireSyncRecord, u64)>, u64, bool) {
            let mut rows: Vec<(WireSyncRecord, u64)> = self
                .records
                .iter()
                .filter(|record| record.seq > cursor)
                .map(|record| (record.wire.clone(), record.seq))
                .collect();
            rows.sort_by_key(|(_, seq)| *seq);
            let has_more = rows.len() > 500;
            if has_more {
                rows.truncate(500);
            }
            let next_cursor = rows.last().map(|(_, seq)| *seq).unwrap_or(cursor);
            (rows, next_cursor, has_more)
        }
    }

    #[test]
    fn two_device_review_uploads_converge_through_mock_server() {
        let mut server = MockSyncServer::new();

        let review_payload = br#"{"id":"rev-1","item_id":"item-1","collection_id":"col-1","rating":3,"time_taken":5,"new_due_date":"2026-01-01T00:00:00Z","new_interval":1.0,"new_ease_factor":2.5,"reviewed_at_ms":1000,"device_id":"device-a","session_id":null}"#;
        let entry_a = super::super::types::OutboxEntry {
            change_id: "change-a".to_string(),
            entity_type: EntityType::ReviewResult,
            entity_id: "rev-1".to_string(),
            operation: SyncOperation::AppendEvent,
            base_revision: None,
            payload: review_payload.to_vec(),
            hlc: "1000:0".to_string(),
            created_at: 1,
            sync_status: super::super::types::SyncOutboxStatus::Pending,
        };
        let wire_a = outbox_entry_to_wire(&entry_a, "device-a", "acct", Some(&TEST_MASTER_KEY), 1).expect("wire");
        let (accepted_a, _) = server.push(vec![wire_a]);
        assert_eq!(accepted_a, 1);

        let mut entry_b = entry_a.clone();
        entry_b.change_id = "change-b".to_string();
        entry_b.hlc = "1001:0".to_string();
        entry_b.payload = br#"{"id":"rev-2","item_id":"item-1","collection_id":"col-1","rating":2,"time_taken":4,"new_due_date":"2026-01-02T00:00:00Z","new_interval":0.5,"new_ease_factor":2.3,"reviewed_at_ms":2000,"device_id":"device-b","session_id":null}"#.to_vec();
        entry_b.entity_id = "rev-2".to_string();
        let wire_b = outbox_entry_to_wire(&entry_b, "device-b", "acct", Some(&TEST_MASTER_KEY), 1).expect("wire");
        let (accepted_b, latest) = server.push(vec![wire_b]);
        assert_eq!(accepted_b, 1);

        let (page, cursor, has_more) = server.pull(0);
        assert!(!has_more);
        assert_eq!(page.len(), 2);
        assert_eq!(cursor, latest);

        let decoded: Vec<_> = page
            .into_iter()
            .map(|(wire, seq)| decode_remote_record(&wire, seq, "acct", Some(&TEST_MASTER_KEY), 1).expect("decode"))
            .collect();
        assert_eq!(decoded.len(), 2);
        assert!(decoded.iter().any(|record| record.device_id == "device-a"));
        assert!(decoded.iter().any(|record| record.device_id == "device-b"));
    }

    #[test]
    fn duplicate_change_id_push_is_idempotent() {
        let mut server = MockSyncServer::new();
        let entry = super::super::types::OutboxEntry {
            change_id: "dup-change".to_string(),
            entity_type: EntityType::LearningItem,
            entity_id: "item-1".to_string(),
            operation: SyncOperation::Update,
            base_revision: Some(1),
            payload: br#"{"schema_version":1,"entity_type":"learning_item","id":"item-1","collection_id":"col-1","question":"Q","answer":"A","due_date":"2026-01-01T00:00:00Z","algorithm_type":"fsrs","updated_at":null}"#.to_vec(),
            hlc: "2000:0".to_string(),
            created_at: 1,
            sync_status: super::super::types::SyncOutboxStatus::Pending,
        };
        let wire = outbox_entry_to_wire(&entry, "device-a", "acct", Some(&TEST_MASTER_KEY), 1).expect("wire");
        let (first, _) = server.push(vec![wire.clone()]);
        let (second, _) = server.push(vec![wire]);
        assert_eq!(first, 1);
        assert_eq!(second, 0);
    }

    #[test]
    fn delete_tombstone_round_trips_through_server_mock() {
        let mut server = MockSyncServer::new();
        let delete_payload = br#"{"schema_version":1,"entity_type":"learning_item","id":"item-1","deleted_at":"2026-01-01T00:00:00Z"}"#;
        let entry = super::super::types::OutboxEntry {
            change_id: "delete-1".to_string(),
            entity_type: EntityType::LearningItem,
            entity_id: "item-1".to_string(),
            operation: SyncOperation::Delete,
            base_revision: Some(3),
            payload: delete_payload.to_vec(),
            hlc: "3000:0".to_string(),
            created_at: 1,
            sync_status: super::super::types::SyncOutboxStatus::Pending,
        };
        let wire = outbox_entry_to_wire(&entry, "device-a", "acct", Some(&TEST_MASTER_KEY), 1).expect("wire");
        let (accepted, _) = server.push(vec![wire]);
        assert_eq!(accepted, 1);
        let (page, _, _) = server.pull(0);
        assert_eq!(page.len(), 1);
        let remote = decode_remote_record(&page[0].0, page[0].1, "acct", Some(&TEST_MASTER_KEY), 1).expect("decode");
        assert_eq!(remote.operation, Some(SyncOperation::Delete));
    }

    // A device that generated its own recovery key encrypts under a master key
    // no other device can derive. Such records must fail decode (so the pull
    // loop quarantines them) while sibling records stay readable — one rogue
    // record cannot take the whole page down with it.
    #[test]
    fn foreign_master_key_record_fails_decode_while_peers_decode() {
        let foreign_master_key: [u8; 32] = [9u8; 32];
        let mut server = MockSyncServer::new();

        let payload = br#"{"schema_version":1,"entity_type":"learning_item","id":"item-1","collection_id":"col-1","question":"Q","answer":"A","due_date":"2026-01-01T00:00:00Z","algorithm_type":"fsrs","updated_at":null}"#;
        let make_entry = |change_id: &str, entity_id: &str, hlc: &str| {
            super::super::types::OutboxEntry {
                change_id: change_id.to_string(),
                entity_type: EntityType::LearningItem,
                entity_id: entity_id.to_string(),
                operation: SyncOperation::Update,
                base_revision: None,
                payload: payload.to_vec(),
                hlc: hlc.to_string(),
                created_at: 1,
                sync_status: super::super::types::SyncOutboxStatus::Pending,
            }
        };

        let good = outbox_entry_to_wire(
            &make_entry("change-good", "item-good", "4000:0"),
            "device-good",
            "acct",
            Some(&TEST_MASTER_KEY),
            1,
        )
        .expect("wire");
        let rogue = outbox_entry_to_wire(
            &make_entry("change-rogue", "item-rogue", "4001:0"),
            "device-rogue",
            "acct",
            Some(&foreign_master_key),
            1,
        )
        .expect("wire");
        server.push(vec![good, rogue]);

        let (page, cursor, _) = server.pull(0);
        assert_eq!(page.len(), 2);

        let mut decoded = 0;
        let mut quarantined = 0;
        for (wire, seq) in page {
            match decode_remote_record(&wire, seq, "acct", Some(&TEST_MASTER_KEY), 1) {
                Ok(record) => {
                    assert_eq!(record.device_id, "device-good");
                    decoded += 1;
                }
                Err(reason) => {
                    assert!(
                        reason.contains("Decryption") || reason.contains("authenticity"),
                        "unexpected reason: {reason}"
                    );
                    quarantined += 1;
                }
            }
        }
        assert_eq!(decoded, 1);
        assert_eq!(quarantined, 1);
        assert_eq!(cursor, 2);
    }
}
