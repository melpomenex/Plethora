//! Repository for managing saved queue presets in SQLite

use chrono::{DateTime, Utc};
use sqlx::{Pool, Row, Sqlite};
use uuid::Uuid;

use crate::error::{PlethoraError, Result};
use crate::models::saved_queue::{
    CreateSavedQueueInput, SavedQueue, SavedQueueFilters, SavedQueueItemTypes,
    UpdateSavedQueueInput,
};

#[derive(Clone)]
pub struct SavedQueueRepository {
    pool: Pool<Sqlite>,
}

impl SavedQueueRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    fn row_to_saved_queue(row: &sqlx::sqlite::SqliteRow) -> Result<SavedQueue> {
        let filters_json: String = row.get("filters_json");
        let item_types_json: String = row.get("item_types_json");
        let filters: SavedQueueFilters = serde_json::from_str(&filters_json).unwrap_or_default();
        let item_types: SavedQueueItemTypes =
            serde_json::from_str(&item_types_json).unwrap_or_default();

        let created_at_str: String = row.get("created_at");
        let updated_at_str: String = row.get("updated_at");

        let created_at = DateTime::parse_from_rfc3339(&created_at_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());
        let updated_at = DateTime::parse_from_rfc3339(&updated_at_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());

        let is_default_i64: i64 = row.get("is_default");

        Ok(SavedQueue {
            id: row.get("id"),
            name: row.get("name"),
            icon: row.try_get("icon").ok(),
            collection_id: row.try_get("collection_id").ok(),
            filters,
            item_types,
            session_duration_minutes: row.get("session_duration_minutes"),
            max_items: row.get("max_items"),
            daqe_preset_id: row.try_get("daqe_preset_id").ok(),
            session_goal: row.try_get("session_goal").ok(),
            is_default: is_default_i64 != 0,
            sort_order: row.get("sort_order"),
            created_at,
            updated_at,
        })
    }

    pub async fn get_saved_queues(&self, collection_id: Option<&str>) -> Result<Vec<SavedQueue>> {
        let rows = match collection_id {
            Some(col_id) => {
                sqlx::query(
                    "SELECT * FROM saved_queues WHERE collection_id = ?1 OR collection_id IS NULL ORDER BY sort_order ASC, name ASC",
                )
                .bind(col_id)
                .fetch_all(&self.pool)
                .await?
            }
            None => {
                sqlx::query("SELECT * FROM saved_queues ORDER BY sort_order ASC, name ASC")
                    .fetch_all(&self.pool)
                    .await?
            }
        };

        rows.iter().map(Self::row_to_saved_queue).collect()
    }

    pub async fn get_saved_queue(&self, id: &str) -> Result<Option<SavedQueue>> {
        let row = sqlx::query("SELECT * FROM saved_queues WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        row.as_ref().map(Self::row_to_saved_queue).transpose()
    }

    pub async fn create_saved_queue(&self, input: CreateSavedQueueInput) -> Result<SavedQueue> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let filters = input.filters.unwrap_or_default();
        let item_types = input.item_types.unwrap_or_default();
        let filters_json = serde_json::to_string(&filters)
            .map_err(|e| PlethoraError::Internal(format!("Failed to serialize filters: {}", e)))?;
        let item_types_json = serde_json::to_string(&item_types).map_err(|e| {
            PlethoraError::Internal(format!("Failed to serialize item_types: {}", e))
        })?;

        let is_default = input.is_default.unwrap_or(false);
        let session_duration = input.session_duration_minutes.unwrap_or(60);
        let max_items = input.max_items.unwrap_or(50);

        let mut tx = self.pool.begin().await?;

        if is_default {
            if let Some(ref col_id) = input.collection_id {
                sqlx::query(
                    "UPDATE saved_queues SET is_default = 0 WHERE collection_id = ?1 OR collection_id IS NULL",
                )
                .bind(col_id)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query("UPDATE saved_queues SET is_default = 0")
                    .execute(&mut *tx)
                    .await?;
            }
        }

        // Get max sort_order
        let max_order: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM saved_queues",
        )
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO saved_queues (
                id, name, icon, collection_id, filters_json, item_types_json,
                session_duration_minutes, max_items, daqe_preset_id, session_goal,
                is_default, sort_order, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            "#,
        )
        .bind(&id)
        .bind(&input.name)
        .bind(input.icon.as_deref())
        .bind(input.collection_id.as_deref())
        .bind(&filters_json)
        .bind(&item_types_json)
        .bind(session_duration)
        .bind(max_items)
        .bind(input.daqe_preset_id.as_deref())
        .bind(input.session_goal.as_deref())
        .bind(if is_default { 1i64 } else { 0i64 })
        .bind(max_order)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        self.get_saved_queue(&id)
            .await?
            .ok_or_else(|| PlethoraError::Internal("Created saved queue could not be found".into()))
    }

    pub async fn update_saved_queue(
        &self,
        id: &str,
        input: UpdateSavedQueueInput,
    ) -> Result<SavedQueue> {
        let existing = self
            .get_saved_queue(id)
            .await?
            .ok_or_else(|| PlethoraError::NotFound(format!("Saved queue {} not found", id)))?;

        let name = input.name.unwrap_or(existing.name);
        let icon = input.icon.or(existing.icon);
        let collection_id = input.collection_id.or(existing.collection_id);
        let filters = input.filters.unwrap_or(existing.filters);
        let item_types = input.item_types.unwrap_or(existing.item_types);
        let session_duration = input
            .session_duration_minutes
            .unwrap_or(existing.session_duration_minutes);
        let max_items = input.max_items.unwrap_or(existing.max_items);
        let daqe_preset_id = input.daqe_preset_id.or(existing.daqe_preset_id);
        let session_goal = input.session_goal.or(existing.session_goal);
        let is_default = input.is_default.unwrap_or(existing.is_default);
        let sort_order = input.sort_order.unwrap_or(existing.sort_order);

        let filters_json = serde_json::to_string(&filters)
            .map_err(|e| PlethoraError::Internal(format!("Failed to serialize filters: {}", e)))?;
        let item_types_json = serde_json::to_string(&item_types).map_err(|e| {
            PlethoraError::Internal(format!("Failed to serialize item_types: {}", e))
        })?;

        let now = Utc::now().to_rfc3339();
        let mut tx = self.pool.begin().await?;

        if is_default && !existing.is_default {
            if let Some(ref col_id) = collection_id {
                sqlx::query(
                    "UPDATE saved_queues SET is_default = 0 WHERE (collection_id = ?1 OR collection_id IS NULL) AND id != ?2",
                )
                .bind(col_id)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query("UPDATE saved_queues SET is_default = 0 WHERE id != ?1")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        sqlx::query(
            r#"
            UPDATE saved_queues SET
                name = ?1, icon = ?2, collection_id = ?3, filters_json = ?4,
                item_types_json = ?5, session_duration_minutes = ?6, max_items = ?7,
                daqe_preset_id = ?8, session_goal = ?9, is_default = ?10,
                sort_order = ?11, updated_at = ?12
            WHERE id = ?13
            "#,
        )
        .bind(&name)
        .bind(icon.as_deref())
        .bind(collection_id.as_deref())
        .bind(&filters_json)
        .bind(&item_types_json)
        .bind(session_duration)
        .bind(max_items)
        .bind(daqe_preset_id.as_deref())
        .bind(session_goal.as_deref())
        .bind(if is_default { 1i64 } else { 0i64 })
        .bind(sort_order)
        .bind(&now)
        .bind(id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        self.get_saved_queue(id)
            .await?
            .ok_or_else(|| PlethoraError::Internal("Updated saved queue disappeared".into()))
    }

    pub async fn delete_saved_queue(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM saved_queues WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_active_saved_queue_id(&self) -> Result<Option<String>> {
        let row = sqlx::query("SELECT value FROM settings WHERE key = 'active_saved_queue_id'")
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.and_then(|r| r.try_get::<String, _>("value").ok()))
    }

    pub async fn set_active_saved_queue_id(&self, id: Option<&str>) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        match id {
            Some(queue_id) => {
                sqlx::query(
                    "INSERT INTO settings (key, value, date_modified) VALUES ('active_saved_queue_id', ?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = ?1, date_modified = ?2",
                )
                .bind(queue_id)
                .bind(&now)
                .execute(&self.pool)
                .await?;
            }
            None => {
                sqlx::query("DELETE FROM settings WHERE key = 'active_saved_queue_id'")
                    .execute(&self.pool)
                    .await?;
            }
        }
        Ok(())
    }
}
