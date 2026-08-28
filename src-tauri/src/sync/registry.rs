use super::types::{EntityType, MergeStrategy, SyncOperation};

/// Metadata for a whitelisted syncable entity family.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntitySpec {
    pub entity_type: EntityType,
    pub merge_strategy: MergeStrategy,
}

pub fn entity_spec(entity_type: EntityType) -> Option<EntitySpec> {
    Some(match entity_type {
        EntityType::LearningItem => EntitySpec {
            entity_type,
            merge_strategy: MergeStrategy::FieldLww,
        },
        EntityType::ReviewResult => EntitySpec {
            entity_type,
            merge_strategy: MergeStrategy::AppendOnly,
        },
        EntityType::Document | EntityType::Extract | EntityType::Setting => EntitySpec {
            entity_type,
            merge_strategy: MergeStrategy::FieldLww,
        },
        EntityType::Collection | EntityType::Tag => EntitySpec {
            entity_type,
            merge_strategy: MergeStrategy::SetLike,
        },
        EntityType::Tombstone => EntitySpec {
            entity_type,
            merge_strategy: MergeStrategy::FieldLww,
        },
    })
}

pub fn is_syncable(entity_type: EntityType) -> bool {
    entity_spec(entity_type).is_some()
}

pub fn operation_allowed(entity_type: EntityType, operation: SyncOperation) -> bool {
    match entity_spec(entity_type) {
        Some(spec) => match spec.merge_strategy {
            MergeStrategy::AppendOnly => matches!(
                operation,
                SyncOperation::AppendEvent | SyncOperation::Create
            ),
            MergeStrategy::FieldLww => matches!(
                operation,
                SyncOperation::Create | SyncOperation::Update | SyncOperation::Delete
            ),
            MergeStrategy::SetLike => matches!(
                operation,
                SyncOperation::Create | SyncOperation::Update | SyncOperation::Delete
            ),
        },
        None => false,
    }
}
