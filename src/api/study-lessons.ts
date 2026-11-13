/**
 * Typed API for versioned Study Plan lessons.
 */

import { invokeCommand } from '../lib/tauri';
import type { LessonStyle } from '../types/studySource';

export interface StudyPlanLesson {
  id: string;
  planId: string;
  planVersionId: string;
  nodeId: string;
  objectiveIndex: number;
  style: LessonStyle;
  knowledgeAuthorityJson: string;
  sourceRevisionSnapshot: string;
  promptText: string;
  answerDraft: string;
  hintCount: number;
  turnCount: number;
  turnStateJson: string;
  revision: number;
  lastTurnRequestId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStudyPlanLessonInput {
  planId: string;
  planVersionId: string;
  nodeId: string;
  objectiveIndex: number;
  style?: LessonStyle;
  knowledgeAuthorityJson?: string;
  sourceRevisionSnapshot?: string;
  promptText?: string;
}

export interface SaveStudyPlanLessonCheckpointInput {
  lessonId: string;
  expectedRevision: number;
  turnRequestId?: string;
  promptText?: string;
  answerDraft?: string;
  hintCount?: number;
  turnCount?: number;
  turnStateJson?: string;
  style?: LessonStyle;
}

export async function createStudyPlanLesson(
  input: CreateStudyPlanLessonInput
): Promise<StudyPlanLesson> {
  return invokeCommand<StudyPlanLesson>('create_study_plan_lesson', { input });
}

export async function getStudyPlanLesson(lessonId: string): Promise<StudyPlanLesson> {
  return invokeCommand<StudyPlanLesson>('get_study_plan_lesson', { lessonId });
}

export async function listStudyPlanLessonsForNode(
  planVersionId: string,
  nodeId: string
): Promise<StudyPlanLesson[]> {
  return invokeCommand<StudyPlanLesson[]>('list_study_plan_lessons_for_node', {
    planVersionId,
    nodeId,
  });
}

export async function saveStudyPlanLessonCheckpoint(
  input: SaveStudyPlanLessonCheckpointInput
): Promise<StudyPlanLesson> {
  return invokeCommand<StudyPlanLesson>('save_study_plan_lesson_checkpoint', { input });
}
