/**
 * Strict Privacy, Exclusion, and Consent Gate for Study AI Features.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §10
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T05)
 */

import type { DestinationClassification } from '../../ai/features/destinations';
import { StudyApiError } from '../../../api/study-plans';

export interface StudyPrivacyDocument {
  id: string;
  title?: string;
  isAiExcluded?: boolean;
  isLocalOnly?: boolean;
}

export interface StudyPrivacyEvaluationParams {
  documents: ReadonlyArray<StudyPrivacyDocument>;
  generationDestination: DestinationClassification;
  embeddingDestination?: DestinationClassification | null;
  strictLocalOnly?: boolean;
  cloudDisclosureAccepted?: boolean;
  costConsentAccepted?: boolean;
}

export interface StudyPrivacyEvaluationResult {
  allowed: boolean;
  sendsOffDevice: boolean;
  billable: boolean;
}

/**
 * Evaluates whether AI operations on selected study documents are permissible
 * given destination classifications, document privacy flags, and user consent.
 *
 * Fail-closed: Throws a typed StudyApiError if any boundary is violated.
 */
export function evaluateStudyPrivacy(
  params: StudyPrivacyEvaluationParams
): StudyPrivacyEvaluationResult {
  const {
    documents,
    generationDestination,
    embeddingDestination,
    strictLocalOnly = false,
    cloudDisclosureAccepted = false,
    costConsentAccepted = false,
  } = params;

  // 1. Any document excluded from AI entirely
  const excludedDoc = documents.find((doc) => doc.isAiExcluded === true);
  if (excludedDoc) {
    throw new StudyApiError({
      code: 'source_ai_excluded',
      messageKey: 'study_plan.error.source_ai_excluded',
      retryable: false,
      fieldIssues: [
        {
          path: `documents[${excludedDoc.id}]`,
          code: 'source_ai_excluded',
          messageKey: 'study_plan.error.source_ai_excluded',
        },
      ],
    });
  }

  const sendsOffDevice =
    generationDestination.sendsOffDevice || (embeddingDestination?.sendsOffDevice ?? false);
  const billable =
    generationDestination.billable || (embeddingDestination?.billable ?? false);

  // 2. Strict local mode enforcement
  if (strictLocalOnly && sendsOffDevice) {
    throw new StudyApiError({
      code: 'privacy_denied',
      messageKey: 'study_plan.error.strict_local_required',
      retryable: false,
    });
  }

  // 3. Document local-only requirement
  const localOnlyDoc = documents.find((doc) => doc.isLocalOnly === true);
  if (localOnlyDoc) {
    if (generationDestination.sendsOffDevice) {
      throw new StudyApiError({
        code: 'privacy_denied',
        messageKey: 'study_plan.error.local_only_generation_required',
        retryable: false,
        fieldIssues: [
          {
            path: `documents[${localOnlyDoc.id}]`,
            code: 'local_only_required',
            messageKey: 'study_plan.error.local_only_generation_required',
          },
        ],
      });
    }
    if (embeddingDestination?.sendsOffDevice) {
      throw new StudyApiError({
        code: 'privacy_denied',
        messageKey: 'study_plan.error.local_only_embedding_required',
        retryable: false,
        fieldIssues: [
          {
            path: `documents[${localOnlyDoc.id}]`,
            code: 'local_only_required',
            messageKey: 'study_plan.error.local_only_embedding_required',
          },
        ],
      });
    }
  }

  // 4. Cloud disclosure gate for off-device destinations
  const requiresDisclosure =
    generationDestination.requiresDisclosure ||
    (embeddingDestination?.requiresDisclosure ?? false);
  if (requiresDisclosure && !cloudDisclosureAccepted) {
    throw new StudyApiError({
      code: 'privacy_denied',
      messageKey: 'study_plan.error.cloud_disclosure_required',
      retryable: false,
    });
  }

  // 5. Cost authorization gate for billable destinations
  const requiresCostConsent =
    generationDestination.requiresCostConsent ||
    (embeddingDestination?.requiresCostConsent ?? false);
  if (requiresCostConsent && !costConsentAccepted) {
    throw new StudyApiError({
      code: 'cost_consent_required',
      messageKey: 'study_plan.error.cost_consent_required',
      retryable: false,
    });
  }

  return {
    allowed: true,
    sendsOffDevice,
    billable,
  };
}
