use crate::models::study_plan_research::{SnapshotLocator, StudyPlanResearchSnapshot};
use chrono::Utc;
use sqlx::{Pool, Row, Sqlite};
use uuid::Uuid;

#[derive(Clone)]
pub struct StudyPlanResearchRepository {
    pool: Pool<Sqlite>,
}

impl StudyPlanResearchRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub async fn assert_model_only_version(
        &self,
        plan_id: &str,
        plan_version_id: &str,
    ) -> Result<(), String> {
        let row = sqlx::query(
            "SELECT v.knowledge_authority_json
             FROM study_plan_versions v
             JOIN study_plans p ON p.id = v.plan_id
             WHERE p.id = ? AND v.id = ?",
        )
        .bind(plan_id)
        .bind(plan_version_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| format!("Could not load the Study Plan: {error}"))?
        .ok_or_else(|| "The Study Plan version no longer exists.".to_string())?;
        let authority: serde_json::Value =
            serde_json::from_str(&row.get::<String, _>("knowledge_authority_json"))
                .map_err(|error| format!("The Study Plan knowledge policy is invalid: {error}"))?;
        if authority.get("kind").and_then(serde_json::Value::as_str) != Some("model-only") {
            return Err(
                "Web Research is available only for AI Knowledge Only Study Plans.".to_string(),
            );
        }
        Ok(())
    }

    pub async fn save_candidate(
        &self,
        mut snapshot: StudyPlanResearchSnapshot,
    ) -> Result<StudyPlanResearchSnapshot, String> {
        self.assert_model_only_version(&snapshot.plan_id, &snapshot.plan_version_id)
            .await?;
        if snapshot.id.trim().is_empty() {
            snapshot.id = format!("wrs_{}", Uuid::new_v4().simple());
        }
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Could not begin the source revision update: {error}"))?;
        let unchanged = sqlx::query(
            "SELECT id, plan_id, plan_version_id, query, url, title, publisher, fetched_at,
                    revision_hash, locator_kind, locator_value, excerpt, status
             FROM study_plan_research_snapshots
             WHERE plan_id = ? AND plan_version_id = ? AND url = ?
               AND revision_hash = ? AND status = 'accepted'
             ORDER BY fetched_at DESC LIMIT 1",
        )
        .bind(&snapshot.plan_id)
        .bind(&snapshot.plan_version_id)
        .bind(&snapshot.url)
        .bind(&snapshot.revision_hash)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| format!("Could not compare the source revision: {error}"))?;
        if let Some(row) = unchanged {
            return Ok(snapshot_from_row(row));
        }
        sqlx::query(
            "UPDATE study_plan_research_snapshots SET status = 'stale'
             WHERE plan_id = ? AND plan_version_id = ? AND url = ? AND status = 'accepted'",
        )
        .bind(&snapshot.plan_id)
        .bind(&snapshot.plan_version_id)
        .bind(&snapshot.url)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not mark changed source revisions stale: {error}"))?;
        snapshot.status = "candidate".to_string();
        let created_at = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO study_plan_research_snapshots
             (id, plan_id, plan_version_id, query, url, title, publisher, fetched_at,
              revision_hash, locator_kind, locator_value, excerpt, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?)",
        )
        .bind(&snapshot.id)
        .bind(&snapshot.plan_id)
        .bind(&snapshot.plan_version_id)
        .bind(&snapshot.query)
        .bind(&snapshot.url)
        .bind(&snapshot.title)
        .bind(&snapshot.publisher)
        .bind(&snapshot.fetched_at)
        .bind(&snapshot.revision_hash)
        .bind(&snapshot.locator.kind)
        .bind(&snapshot.locator.value)
        .bind(&snapshot.excerpt)
        .bind(created_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not save the source snapshot: {error}"))?;
        transaction
            .commit()
            .await
            .map_err(|error| format!("Could not commit the source revision update: {error}"))?;
        Ok(snapshot)
    }

    pub async fn list_for_version(
        &self,
        plan_id: &str,
        plan_version_id: &str,
    ) -> Result<Vec<StudyPlanResearchSnapshot>, String> {
        self.assert_model_only_version(plan_id, plan_version_id)
            .await?;
        let rows = sqlx::query(
            "SELECT id, plan_id, plan_version_id, query, url, title, publisher, fetched_at,
                    revision_hash, locator_kind, locator_value, excerpt, status
             FROM study_plan_research_snapshots
             WHERE plan_id = ? AND plan_version_id = ?
             ORDER BY fetched_at DESC, created_at DESC",
        )
        .bind(plan_id)
        .bind(plan_version_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Could not list source snapshots: {error}"))?;
        Ok(rows.into_iter().map(snapshot_from_row).collect())
    }

    pub async fn accept(
        &self,
        snapshot_id: &str,
        plan_id: &str,
        plan_version_id: &str,
    ) -> Result<StudyPlanResearchSnapshot, String> {
        self.assert_model_only_version(plan_id, plan_version_id)
            .await?;
        let result = sqlx::query(
            "UPDATE study_plan_research_snapshots SET status = 'accepted'
             WHERE id = ? AND plan_id = ? AND plan_version_id = ? AND status = 'candidate'",
        )
        .bind(snapshot_id)
        .bind(plan_id)
        .bind(plan_version_id)
        .execute(&self.pool)
        .await
        .map_err(|error| format!("Could not accept the source snapshot: {error}"))?;
        if result.rows_affected() == 0 {
            return Err(
                "This source snapshot is not an available candidate for the selected Study Plan version.".to_string(),
            );
        }
        let row = sqlx::query(
            "SELECT id, plan_id, plan_version_id, query, url, title, publisher, fetched_at,
                    revision_hash, locator_kind, locator_value, excerpt, status
             FROM study_plan_research_snapshots WHERE id = ?",
        )
        .bind(snapshot_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| format!("Could not reload accepted source: {error}"))?;
        Ok(snapshot_from_row(row))
    }
}

fn snapshot_from_row(row: sqlx::sqlite::SqliteRow) -> StudyPlanResearchSnapshot {
    StudyPlanResearchSnapshot {
        id: row.get("id"),
        plan_id: row.get("plan_id"),
        plan_version_id: row.get("plan_version_id"),
        query: row.get("query"),
        url: row.get("url"),
        title: row.get("title"),
        publisher: row.get("publisher"),
        fetched_at: row.get("fetched_at"),
        revision_hash: row.get("revision_hash"),
        locator: SnapshotLocator {
            kind: row.get("locator_kind"),
            value: row.get("locator_value"),
        },
        excerpt: row.get("excerpt"),
        status: row.get("status"),
    }
}
