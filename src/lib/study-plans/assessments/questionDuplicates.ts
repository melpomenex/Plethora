/**
 * Assessment Question Deduplication and Repeat Screening.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §5
 * - openspec/changes/generate-study-plan-examinations/
 */

import type { AssessmentQuestionRevision } from '../../../types/assessmentQuestions';
import type { FieldIssue } from '../../../types/learningPaths';
import {
  computeQuestionFingerprint,
  isNearDuplicateQuestion,
  DUPLICATE_SIMILARITY_THRESHOLD,
} from './questionFingerprint';

export interface DuplicateReport {
  exactDuplicates: Array<{
    fingerprint: string;
    questionRevisionIds: string[];
  }>;
  nearDuplicates: Array<{
    questionIdA: string;
    questionIdB: string;
    similarity: number;
  }>;
  excludedRepeats: Array<{
    fingerprint: string;
    questionRevisionId: string;
  }>;
  issues: FieldIssue[];
}

/**
 * Screens a collection of question revisions for exact duplicates, near-duplicates,
 * and matches against an excluded fingerprints list (e.g. for retakes).
 */
export function screenQuestionDuplicates(
  revisions: AssessmentQuestionRevision[],
  excludedFingerprints: string[] = [],
  nearDuplicateThreshold: number = DUPLICATE_SIMILARITY_THRESHOLD
): DuplicateReport {
  const issues: FieldIssue[] = [];
  const excludedSet = new Set(excludedFingerprints);

  // 1. Exact Fingerprint Grouping
  const fpToRevisions = new Map<string, string[]>();
  const excludedRepeats: Array<{ fingerprint: string; questionRevisionId: string }> = [];

  for (const rev of revisions) {
    const fp = rev.fingerprint || computeQuestionFingerprint(rev.question);

    const existing = fpToRevisions.get(fp);
    if (existing) {
      existing.push(rev.id);
    } else {
      fpToRevisions.set(fp, [rev.id]);
    }

    if (excludedSet.has(fp)) {
      excludedRepeats.push({
        fingerprint: fp,
        questionRevisionId: rev.id,
      });
      issues.push({
        path: `questions.${rev.id}.fingerprint`,
        code: 'excluded_question_repeat',
        messageKey: 'study.assessment.error.excluded_question_repeat',
      });
    }
  }

  const exactDuplicates: Array<{ fingerprint: string; questionRevisionIds: string[] }> = [];
  for (const [fp, ids] of fpToRevisions.entries()) {
    if (ids.length > 1) {
      exactDuplicates.push({ fingerprint: fp, questionRevisionIds: ids });
      issues.push({
        path: `questions.duplicateFingerprint.${fp}`,
        code: 'duplicate_question_fingerprint',
        messageKey: 'study.assessment.error.duplicate_question_fingerprint',
      });
    }
  }

  // 2. Near-Duplicate Pairwise Screening
  const nearDuplicates: Array<{ questionIdA: string; questionIdB: string; similarity: number }> = [];

  for (let i = 0; i < revisions.length; i++) {
    for (let j = i + 1; j < revisions.length; j++) {
      const revA = revisions[i];
      const revB = revisions[j];

      // Near-duplicate comparison only makes sense within the same question kind
      if (revA.question.kind === revB.question.kind) {
        const { isDuplicate, similarity } = isNearDuplicateQuestion(
          revA.question,
          revB.question,
          nearDuplicateThreshold
        );

        if (isDuplicate) {
          nearDuplicates.push({
            questionIdA: revA.id,
            questionIdB: revB.id,
            similarity,
          });
          issues.push({
            path: `questions.nearDuplicate.${revA.id}.${revB.id}`,
            code: 'near_duplicate_question',
            messageKey: 'study.assessment.error.near_duplicate_question',
          });
        }
      }
    }
  }

  return {
    exactDuplicates,
    nearDuplicates,
    excludedRepeats,
    issues,
  };
}
