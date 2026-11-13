import type { StudyPlanDetail } from '../../types/learningPaths';
import type { StudySourceResolution } from '../../types/studySource';
import { tutorTurnTask } from '../ai/tasks/definitions/tutorTask';
import { verifyAssessmentSourceRevisions } from './assessments/generationCoordinator';
import { refreshCurriculumScope } from './generation/curriculumPreflight';
import { performStudyAiPreflight, type StudyPreflightResult } from './generation/preflight';

export async function prepareLessonHelp(
  version: StudyPlanDetail['version'],
  sources: Record<string, StudySourceResolution>,
  approval?: { route: StudyPreflightResult['route']; transfer: boolean; cost: boolean },
) {
  const { knowledgeAuthority, sourceScope } = version;
  const libraryBacked = knowledgeAuthority.kind === 'library';
  if (knowledgeAuthority.kind === 'manual' || (libraryBacked && !sourceScope)) {
    throw new Error('studyPlans.lesson.helpNeedsSources');
  }
  const live = sourceScope && libraryBacked ? await refreshCurriculumScope(sourceScope) : null;
  const refs = live ? await verifyAssessmentSourceRevisions(live, sources) : [];
  if (libraryBacked && refs.length === 0) throw new Error('studyPlans.lesson.helpNeedsSources');
  const documentIds = new Set(refs.map((ref) => ref.documentId));
  const prepared = await performStudyAiPreflight({
    primaryTask: tutorTurnTask,
    documents: (live?.resolvedDocuments ?? [])
      .filter((doc) => documentIds.has(doc.documentId))
      .map((doc) => ({ id: doc.documentId, isAiExcluded: doc.isAiExcluded, isLocalOnly: doc.isLocalOnly })),
    sourceExcerptCount: refs.length,
    plannedModelSteps: 1,
    inspectOnly: !approval,
    routeOverride: approval?.route,
    cloudDisclosureAccepted: approval?.transfer,
    costConsentAccepted: approval?.cost,
  });
  return {
    ...prepared,
    excerpts: refs.slice(0, 4).map((ref) => ref.excerpt),
  };
}
