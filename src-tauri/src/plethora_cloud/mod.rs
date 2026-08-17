use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudJobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CloudJobProgress {
    pub current: u64,
    pub total: u64,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CloudJobRecord {
    pub id: String,
    pub kind: String,
    pub status: CloudJobStatus,
    pub params: serde_json::Value,
    pub progress: Option<CloudJobProgress>,
    pub result: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct CloudJobService {
    local_jobs: Arc<RwLock<HashMap<String, CloudJobRecord>>>,
}

impl Default for CloudJobService {
    fn default() -> Self {
        Self::new()
    }
}

impl CloudJobService {
    pub fn new() -> Self {
        Self {
            local_jobs: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn submit_job(
        &self,
        kind: String,
        params: serde_json::Value,
        _idempotency_key: Option<String>,
    ) -> CloudJobRecord {
        let job_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let record = CloudJobRecord {
            id: job_id.clone(),
            kind,
            status: CloudJobStatus::Queued,
            params,
            progress: None,
            result: None,
            error: None,
            created_at: now.clone(),
            updated_at: now,
        };

        if let Ok(mut lock) = self.local_jobs.write() {
            lock.insert(job_id, record.clone());
        }

        record
    }

    pub fn get_job_status(&self, job_id: &str) -> Option<CloudJobRecord> {
        self.local_jobs
            .read()
            .ok()
            .and_then(|lock| lock.get(job_id).cloned())
    }

    pub fn cancel_job(&self, job_id: &str) -> bool {
        if let Ok(mut lock) = self.local_jobs.write() {
            if let Some(job) = lock.get_mut(job_id) {
                if job.status == CloudJobStatus::Queued || job.status == CloudJobStatus::Running {
                    job.status = CloudJobStatus::Cancelled;
                    job.updated_at = chrono::Utc::now().to_rfc3339();
                    return true;
                }
            }
        }
        false
    }
}

// -----------------------------------------------------------------------------
// Tauri Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub fn cloud_job_submit(
    service: tauri::State<Arc<CloudJobService>>,
    kind: String,
    params: serde_json::Value,
    idempotency_key: Option<String>,
) -> Result<CloudJobRecord, String> {
    Ok(service.submit_job(kind, params, idempotency_key))
}

#[tauri::command]
pub fn cloud_job_get_status(
    service: tauri::State<Arc<CloudJobService>>,
    job_id: String,
) -> Result<Option<CloudJobRecord>, String> {
    Ok(service.get_job_status(&job_id))
}

#[tauri::command]
pub fn cloud_job_cancel(
    service: tauri::State<Arc<CloudJobService>>,
    job_id: String,
) -> Result<bool, String> {
    Ok(service.cancel_job(&job_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cloud_job_lifecycle() {
        let service = CloudJobService::new();
        let job = service.submit_job(
            "document_reconstruct".to_string(),
            serde_json::json!({ "page_count": 10 }),
            None,
        );

        assert_eq!(job.status, CloudJobStatus::Queued);
        assert_eq!(job.kind, "document_reconstruct");

        let fetched = service.get_job_status(&job.id).unwrap();
        assert_eq!(fetched.id, job.id);

        let cancelled = service.cancel_job(&job.id);
        assert!(cancelled);

        let post_cancel = service.get_job_status(&job.id).unwrap();
        assert_eq!(post_cancel.status, CloudJobStatus::Cancelled);
    }
}
