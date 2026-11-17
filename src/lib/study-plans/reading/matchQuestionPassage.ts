import type { AssessmentQuestionRevision } from '../../../types/assessmentQuestions';
import type { StudyReadingAssignment } from '../../../types/studyReading';
import type { StudySourceResolution } from '../../../types/studySource';

export function matchQuestionPassage(
  question: AssessmentQuestionRevision,
  assignments: StudyReadingAssignment[],
  evidence: StudySourceResolution[],
) {
  const refs = new Set(question.question.sourceRefIds ?? []);
  let best: StudyReadingAssignment | undefined;
  let bestScore = 0;
  for (const assignment of assignments) {
    const score = assignment.sourceRefIds.filter((id) => refs.has(id) && evidence.some(({ ref, status }) =>
      status === 'current' && ref.id === id && ref.documentId === assignment.documentId &&
      ref.revision === assignment.documentRevision,
    )).length;
    if (score > bestScore) {
      best = assignment;
      bestScore = score;
    }
  }
  return best;
}
