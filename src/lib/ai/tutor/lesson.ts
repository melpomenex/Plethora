import type { CardProposal } from '../cards/types';

export type LessonStage =
  | 'diagnose'
  | 'explain'
  | 'analogy'
  | 'example'
  | 'check'
  | 'evaluate'
  | 'remediate'
  | 'consolidate';

export interface LessonTurn {
  role: 'tutor' | 'student';
  stage: LessonStage;
  text: string;
  timestamp: string;
}

export interface LessonSession {
  id: string;
  topic: string;
  conceptId?: string;
  gapId?: string;
  currentStage: LessonStage;
  turns: LessonTurn[];
  diagnosedLevel?: 'beginner' | 'intermediate' | 'advanced';
  detectedMisconceptions: string[];
  proposedCards: CardProposal[];
  isComplete: boolean;
}

export interface LessonInitParams {
  topic: string;
  conceptId?: string;
  gapId?: string;
  initialLevelHint?: 'beginner' | 'intermediate' | 'advanced';
}

/**
 * Creates a structured "Teach Me" lesson session.
 */
export function createLessonSession(params: LessonInitParams): LessonSession {
  const id = `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    topic: params.topic,
    conceptId: params.conceptId,
    gapId: params.gapId,
    currentStage: 'diagnose',
    turns: [
      {
        role: 'tutor',
        stage: 'diagnose',
        text: `Let's master **${params.topic}**. To start at the right depth: how would you describe the core mechanism or purpose in your own words?`,
        timestamp: new Date().toISOString(),
      },
    ],
    diagnosedLevel: params.initialLevelHint,
    detectedMisconceptions: [],
    proposedCards: [],
    isComplete: false,
  };
}

export interface EvaluateResult {
  isCorrect: boolean;
  misconception?: string;
  missingPrerequisite?: string;
  feedback: string;
}

/**
 * Advances the lesson state machine following diagnostic and evaluation feedback.
 */
export function advanceLessonStage(
  session: LessonSession,
  evaluation?: EvaluateResult
): LessonSession {
  let nextStage: LessonStage = session.currentStage;
  const misconceptions = [...session.detectedMisconceptions];

  switch (session.currentStage) {
    case 'diagnose':
      nextStage = 'explain';
      break;
    case 'explain':
      nextStage = 'analogy';
      break;
    case 'analogy':
      nextStage = 'example';
      break;
    case 'example':
      nextStage = 'check';
      break;
    case 'check':
      nextStage = 'evaluate';
      break;
    case 'evaluate':
      if (evaluation?.misconception) {
        misconceptions.push(evaluation.misconception);
        nextStage = 'remediate';
      } else {
        nextStage = 'consolidate';
      }
      break;
    case 'remediate':
      nextStage = 'consolidate';
      break;
    case 'consolidate':
      return { ...session, isComplete: true };
  }

  return {
    ...session,
    currentStage: nextStage,
    detectedMisconceptions: misconceptions,
    isComplete: nextStage === 'consolidate',
  };
}
