//! Tauri commands for versioned Study Plan lessons.

use crate::database::{Repository, StudyPlanLessonRepository};
use crate::models::{
    CreateStudyPlanLessonInput, SaveStudyPlanLessonCheckpointInput, StudyCommandError, StudyPlanLesson,
};
use tauri::State;

fn repository(repo: &Repository) -> StudyPlanLessonRepository {
    StudyPlanLessonRepository::new(repo.pool().clone())
}

#[tauri::command]
pub async fn create_study_plan_lesson(
    input: CreateStudyPlanLessonInput,
    repo: State<'_, Repository>,
) -> Result<StudyPlanLesson, StudyCommandError> {
    repository(&repo).create_lesson(input).await
}

#[tauri::command]
pub async fn get_study_plan_lesson(
    lesson_id: String,
    repo: State<'_, Repository>,
) -> Result<StudyPlanLesson, StudyCommandError> {
    repository(&repo)
        .get_lesson(&lesson_id)
        .await?
        .ok_or_else(|| {
            StudyCommandError::new(
                crate::models::study_source::StudyErrorCode::NotFound,
                "study_plan.error.lesson_not_found",
                false,
            )
        })
}

#[tauri::command]
pub async fn list_study_plan_lessons_for_node(
    plan_version_id: String,
    node_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<StudyPlanLesson>, StudyCommandError> {
    repository(&repo)
        .list_lessons_for_node(&plan_version_id, &node_id)
        .await
}

#[tauri::command]
pub async fn save_study_plan_lesson_checkpoint(
    input: SaveStudyPlanLessonCheckpointInput,
    repo: State<'_, Repository>,
) -> Result<StudyPlanLesson, StudyCommandError> {
    repository(&repo).save_checkpoint(input).await
}
