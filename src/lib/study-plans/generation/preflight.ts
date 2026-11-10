/**
 * Endpoint-aware Study AI Preflight calculation and verification.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §10
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T05)
 */

import {
  classifyCloudDestination,
  classifyNativeDestination,
  classifyEmbeddingDestination,
  type DestinationClassification,
} from '../../ai/features/destinations';
import { resolveTaskRoute, type AITaskRoute } from '../../ai/tasks/router';
import type { AITaskDefinition } from '../../ai/tasks/types';
import type { StudyAiPreflight } from './types';
import { evaluateStudyPrivacy, type StudyPrivacyDocument } from './privacy';
import { StudyApiError } from '../../../api/study-plans';

export interface PerformStudyAiPreflightParams {
  primaryTask: AITaskDefinition<never, unknown>;
  documents: StudyPrivacyDocument[];
  sourceExcerptCount: number;
  plannedModelSteps?: number;
  strictLocalOnly?: boolean;
  cloudDisclosureAccepted?: boolean;
  costConsentAccepted?: boolean;
  embeddingSettings?: {
    provider: string;
    ollamaBaseUrl?: string | null;
    hasApiKey?: boolean;
  } | null;
  /** Test override or explicit injection */
  routeOverride?: AITaskRoute | null;
  resolveRouteFn?: typeof resolveTaskRoute;
}

export interface StudyPreflightResult {
  preflight: StudyAiPreflight;
  route: AITaskRoute;
}

const ON_DEVICE_PROVIDER_IDS = new Set([
  'ondevice',
  'gemini-nano',
  'apple-foundation',
  'apple-foundation-models',
  'apple-core-ai',
  'windows-ai',
  'foundry-local',
  'local-decision-engine',
]);

/**
 * Classifies an active route's provider into a destination classification
 * without relying on providerKind or LlmRequestPolicy.
 */
export function classifyRouteDestination(route: AITaskRoute): DestinationClassification {
  const providerId = route.provider.id.trim().toLowerCase();
  if (ON_DEVICE_PROVIDER_IDS.has(providerId) || route.provider.kind === 'ondevice') {
    return classifyNativeDestination('apple-native');
  }

  return classifyCloudDestination({
    provider: route.provider.id,
    baseUrl: (route.provider as { baseUrl?: string | null }).baseUrl ?? null,
    hasApiKey: (route.provider as { hasApiKey?: boolean }).hasApiKey ?? false,
  });
}

/**
 * Performs full Study AI preflight:
 * - Resolves model route and twin reasoning fallback
 * - Classifies generation and embedding destinations separately
 * - Enforces privacy boundaries, document exclusions, and cost consents
 * - Computes maximumModelCalls = 2 × plannedModelSteps
 */
export async function performStudyAiPreflight(
  params: PerformStudyAiPreflightParams
): Promise<StudyPreflightResult> {
  const {
    primaryTask,
    documents,
    sourceExcerptCount,
    plannedModelSteps = 2,
    strictLocalOnly = false,
    cloudDisclosureAccepted = false,
    costConsentAccepted = false,
    embeddingSettings = null,
    routeOverride,
    resolveRouteFn = resolveTaskRoute,
  } = params;

  const route = routeOverride ?? (await resolveRouteFn(primaryTask));
  if (!route || !route.provider) {
    throw new StudyApiError({
      code: 'provider_unavailable',
      messageKey: 'study_generation.error.no_provider_available',
      retryable: true,
    });
  }

  const generationDestination = classifyRouteDestination(route);

  let embeddingDestination: DestinationClassification | null = null;
  if (embeddingSettings) {
    embeddingDestination = classifyEmbeddingDestination({
      provider: embeddingSettings.provider,
      ollamaBaseUrl: embeddingSettings.ollamaBaseUrl,
      hasApiKey: embeddingSettings.hasApiKey,
    });
  }

  // Enforce privacy boundaries fail-closed
  const privacyResult = evaluateStudyPrivacy({
    documents,
    generationDestination,
    embeddingDestination,
    strictLocalOnly,
    cloudDisclosureAccepted,
    costConsentAccepted,
  });

  const maximumModelCalls = 2 * Math.max(1, plannedModelSteps);

  const preflight: StudyAiPreflight = {
    providerId: route.provider.id,
    generationDestination,
    embeddingDestination,
    featureAllowed: privacyResult.allowed,
    documentIds: documents.map((doc) => doc.id),
    sourceExcerptCount,
    sendsSourceOffDevice: generationDestination.sendsOffDevice,
    sendsAnswersOffDevice: false,
    billable: privacyResult.billable,
    cloudDisclosureAccepted,
    costConsentAccepted,
    maximumModelCalls,
  };

  return { preflight, route };
}

/**
 * Validates that an existing frozen preflight matches the current resolved provider.
 * Used during job resume / retry.
 */
export function validatePreflightUnchanged(
  frozenPreflight: StudyAiPreflight,
  currentRoute: AITaskRoute
): void {
  if (frozenPreflight.providerId !== currentRoute.provider.id) {
    throw new StudyApiError({
      code: 'invalid_state',
      messageKey: 'study_generation.error.provider_changed_on_resume',
      retryable: false,
    });
  }
}
