//! Tauri commands for Unified Learning Goals (Phase 1C).

use crate::database::{LearningGoalRepository, Repository};
use crate::error::Result;
use crate::models::learning_goal::{
    CreateLearningGoalInput, EvaluateGoalFeasibilityContext, EvolveLearningGoalInput,
    GoalFeasibilityReport, GoalSourceKind, LearningGoal, LearningGoalMilestone,
    LearningGoalSource, LinkGoalSourceInput, ListLearningGoalsFilter, UpdateLearningGoalInput,
    UpsertGoalMilestoneInput,
};
use tauri::State;

#[tauri::command]
pub async fn create_learning_goal(
    repository: State<'_, Repository>,
    input: CreateLearningGoalInput,
) -> Result<LearningGoal> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.create_learning_goal(&input).await
}

#[tauri::command]
pub async fn list_learning_goals(
    repository: State<'_, Repository>,
    filter: Option<ListLearningGoalsFilter>,
) -> Result<Vec<LearningGoal>> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.list_learning_goals(filter.as_ref()).await
}

#[tauri::command]
pub async fn get_learning_goal_detail(
    repository: State<'_, Repository>,
    goal_id: String,
) -> Result<Option<LearningGoal>> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.get_learning_goal_detail(&goal_id).await
}

#[tauri::command]
pub async fn update_learning_goal(
    repository: State<'_, Repository>,
    goal_id: String,
    patch: UpdateLearningGoalInput,
) -> Result<LearningGoal> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.update_learning_goal(&goal_id, &patch).await
}

#[tauri::command]
pub async fn evolve_learning_goal(
    repository: State<'_, Repository>,
    goal_id: String,
    evolution: EvolveLearningGoalInput,
) -> Result<LearningGoal> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.evolve_learning_goal(&goal_id, &evolution).await
}

#[tauri::command]
pub async fn delete_learning_goal(
    repository: State<'_, Repository>,
    goal_id: String,
) -> Result<()> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.delete_learning_goal(&goal_id).await
}

#[tauri::command]
pub async fn link_learning_goal_source(
    repository: State<'_, Repository>,
    input: LinkGoalSourceInput,
) -> Result<LearningGoalSource> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.link_goal_source(&input).await
}

#[tauri::command]
pub async fn unlink_learning_goal_source(
    repository: State<'_, Repository>,
    goal_id: String,
    source_kind: GoalSourceKind,
    source_id: String,
) -> Result<()> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.unlink_goal_source(&goal_id, source_kind, &source_id)
        .await
}

#[tauri::command]
pub async fn upsert_learning_goal_milestone(
    repository: State<'_, Repository>,
    goal_id: String,
    milestone: UpsertGoalMilestoneInput,
) -> Result<LearningGoalMilestone> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.upsert_goal_milestone(&goal_id, &milestone).await
}

#[tauri::command]
pub async fn get_learning_goal_feasibility(
    repository: State<'_, Repository>,
    goal_id: String,
    context: Option<EvaluateGoalFeasibilityContext>,
) -> Result<GoalFeasibilityReport> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.get_learning_goal_feasibility(&goal_id, context.as_ref())
        .await
}

#[tauri::command]
pub async fn list_goals_for_source(
    repository: State<'_, Repository>,
    source_kind: GoalSourceKind,
    source_id: String,
) -> Result<Vec<LearningGoal>> {
    let repo = LearningGoalRepository::new(repository.pool().clone());
    repo.list_goals_for_source(source_kind, &source_id).await
}
