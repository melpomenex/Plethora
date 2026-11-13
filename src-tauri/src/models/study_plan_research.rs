use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanResearchResult {
    pub id: String,
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanResearchSnapshot {
    pub id: String,
    pub plan_id: String,
    pub plan_version_id: String,
    pub query: String,
    pub url: String,
    pub title: String,
    pub publisher: String,
    pub fetched_at: String,
    pub revision_hash: String,
    pub locator: SnapshotLocator,
    pub excerpt: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotLocator {
    pub kind: String,
    pub value: String,
}
