import { useEffect, useState } from 'react';
import { getAssessmentBlueprintRevision } from '../../../api/assessment-blueprints';
import { getStudyAttemptSources, getStudyReadingTrail } from '../../../api/study-reading';
import { matchQuestionPassage } from '../../../lib/study-plans/reading/matchQuestionPassage';
import type { AssessmentQuestionRevision } from '../../../types/assessmentQuestions';
import type { ExamAttempt, GradeRecord } from '../../../types/assessmentSessions';
import type { StudyReadingAssignment } from '../../../types/studyReading';
import type { StudySourceResolution } from '../../../types/studySource';

interface AttemptReadingContext {
  attemptId: string;
  modelOnly: boolean;
  assignments: StudyReadingAssignment[];
  sources: StudySourceResolution[];
}

export function useAttemptReadingContext(attempt: ExamAttempt) {
  const { id, blueprintRevisionId, submittedAt, status } = attempt;
  const submitted = Boolean(submittedAt && status !== 'in-progress' && status !== 'cancelled');
  const [context, setContext] = useState<AttemptReadingContext | null>(null);

  useEffect(() => {
    if (!blueprintRevisionId) return;
    let stale = false;
    async function load() {
      const blueprint = await getAssessmentBlueprintRevision(blueprintRevisionId).catch(() => null);
      if (stale) return;
      const modelOnly = blueprint?.revision?.config?.knowledgePolicy === 'model-only';
      if (modelOnly || !submitted) {
        setContext({ attemptId: id, modelOnly, assignments: [], sources: [] });
        return;
      }
      const planId = blueprint?.blueprint?.planId;
      const versionId = blueprint?.revision?.planVersionId;
      const [sources, trail] = await Promise.all([
        getStudyAttemptSources(id).catch(() => []),
        planId && versionId ? getStudyReadingTrail(planId, versionId).catch(() => null) : null,
      ]);
      if (!stale) setContext({ attemptId: id, modelOnly, sources: sources ?? [], assignments: trail?.manifest?.assignments ?? [] });
    }
    void load();
    return () => { stale = true; };
  }, [blueprintRevisionId, id, submitted]);

  return context?.attemptId === id ? context : null;
}

export function questionReadingProps(
  context: AttemptReadingContext | null,
  question: AssessmentQuestionRevision,
  grade: GradeRecord | null,
) {
  if (!context || grade?.state !== 'final' || !question.committedAt) return {};
  const evidence = context.sources.filter(({ ref }) => question.question.sourceRefIds?.includes(ref.id));
  const missed = grade.outcome === 'incorrect' || grade.outcome === 'partial';
  return {
    evidence,
    readingAssignment: missed ? matchQuestionPassage(question, context.assignments, evidence) : undefined,
  };
}
