//! Universal Wearable Health Data Import Platform.

pub mod apple_health;
pub mod archive;
pub mod csv_reader;
pub mod detector;
pub mod garmin;
pub mod generic_csv;
pub mod google_fitbit;
pub mod limits;
pub mod orchestrator;
pub mod oura;
pub mod plethora_json;
pub mod polar;
pub mod registry;
pub mod ringconn;
pub mod samsung_health;
pub mod types;
pub mod watched;
pub mod whoop;
pub mod withings;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::Mutex;
use types::ImportCancellationToken;

pub struct ImportJobManager {
    active_jobs: Mutex<HashMap<String, ImportCancellationToken>>,
}

impl Default for ImportJobManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ImportJobManager {
    pub fn new() -> Self {
        Self {
            active_jobs: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, job_id: &str) -> ImportCancellationToken {
        let token = ImportCancellationToken::new();
        if let Ok(mut map) = self.active_jobs.lock() {
            map.insert(job_id.to_string(), token.clone());
        }
        token
    }

    pub fn cancel(&self, job_id: &str) -> bool {
        if let Ok(map) = self.active_jobs.lock() {
            if let Some(token) = map.get(job_id) {
                token.cancel();
                return true;
            }
        }
        false
    }

    pub fn finish(&self, job_id: &str) {
        if let Ok(mut map) = self.active_jobs.lock() {
            map.remove(job_id);
        }
    }
}
