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
import { chatWithLLM, PROVIDER_CONFIGS } from '../../../api/llm';
import { useLLMProvidersStore, type LLMProviderConfig } from '../../../stores/llmProvidersStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { providerAllowsKeylessAccess } from '../../../utils/llmProviderUtils';
import { getRoutingProviders } from '../../ai/providers';
import { CloudProvider, PinnedCloudProvider, getActiveCloudConfig } from '../../ai/providers/cloudProvider';
import { sha256 } from './requestHash';

export interface PerformStudyAiPreflightParams {
  primaryTask: AITaskDefinition<never, unknown>;
  documents: StudyPrivacyDocument[];
  sourceExcerptCount: number;
  plannedModelSteps?: number;
  strictLocalOnly?: boolean;
  cloudDisclosureAccepted?: boolean;
  costConsentAccepted?: boolean;
  inspectOnly?: boolean;
  selectedConfigId?: string;
  estimateTokens?: { input: number; output: number };
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

export function isUsableStudyModel(config: LLMProviderConfig): boolean {
  const model = config.model.trim();
  const usesRouterAlias = config.provider === 'openrouter' &&
    (/^openrouter\/(auto|free)$/i.test(model) || model.startsWith('@preset/'));
  return config.enabled && !!model && !usesRouterAlias &&
    (!!config.apiKey.trim() || providerAllowsKeylessAccess(config.provider, config.baseUrl));
}

const pinnedConfigurations = new WeakMap<AITaskRoute['provider'], LLMProviderConfig>();

function pinCloud(config: LLMProviderConfig): PinnedCloudProvider {
  let endpoint: URL;
  try {
    endpoint = new URL(config.baseUrl?.trim() || PROVIDER_CONFIGS[config.provider].baseUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
        endpoint.search || endpoint.hash) {
      throw new Error('Invalid endpoint');
    }
  } catch {
    throw new StudyApiError({ code: 'invalid_input', messageKey: 'study_generation.error.invalid_endpoint', retryable: false });
  }
  const snapshot = { ...config, model: config.model.trim(), baseUrl: endpoint.href.replace(/\/$/, '') };
  const provider = new PinnedCloudProvider(snapshot, {
    chat: (request) => chatWithLLM({ ...request, pinEndpoint: true }),
  });
  pinnedConfigurations.set(provider, snapshot);
  return provider;
}

export async function resolveStudyTaskRoute(
  task: AITaskDefinition<never, unknown>,
  selectedConfigId?: string,
  authorizedProviderId?: string,
): Promise<AITaskRoute | null> {
  if (selectedConfigId) {
    const config = useLLMProvidersStore.getState().providers.find((row) => row.id === selectedConfigId);
    return config && isUsableStudyModel(config)
      ? resolveTaskRoute(task, { providers: [pinCloud(config)] })
      : null;
  }
  const activeConfig = getActiveCloudConfig();
  const candidates = getRoutingProviders().flatMap((provider) => {
    if (provider.kind !== 'cloud') return [provider];
    if (authorizedProviderId && authorizedProviderId !== provider.id) return [];
    return activeConfig && isUsableStudyModel(activeConfig) ? [pinCloud(activeConfig)] : [];
  }).filter((provider) => !authorizedProviderId || provider.id === authorizedProviderId);
  return resolveTaskRoute(task, { providers: candidates });
}

function describeModel(route: AITaskRoute): StudyAiPreflight['model'] {
  const config = pinnedConfigurations.get(route.provider);
  if (!config?.baseUrl) return undefined;
  return {
    configId: config.id,
    provider: PROVIDER_CONFIGS[config.provider].name,
    name: config.modelPricing?.[config.model]?.name || config.model,
    id: config.model,
    endpointOrigin: new URL(config.baseUrl).origin,
    endpointHash: sha256(config.baseUrl),
    reasoningMetadata: config.modelPricing?.[config.model]?.reasoning,
  };
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
  const config = pinnedConfigurations.get(route.provider);
  if (config) return classifyCloudDestination({ provider: config.provider, baseUrl: config.baseUrl, hasApiKey: !!config.apiKey });
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
    strictLocalOnly = useSettingsStore.getState().settings.ai?.strictLocalOnly === true,
    cloudDisclosureAccepted = false,
    costConsentAccepted = false,
    embeddingSettings = null,
    routeOverride,
    resolveRouteFn,
    inspectOnly,
    selectedConfigId,
    estimateTokens,
  } = params;

  let route = routeOverride ?? await (resolveRouteFn
    ? resolveRouteFn(primaryTask)
    : resolveStudyTaskRoute(primaryTask, selectedConfigId));
  if (!route || !route.provider) {
    throw new StudyApiError({
      code: 'provider_unavailable',
      messageKey: 'study_generation.error.no_provider_available',
      retryable: true,
    });
  }
  if (route.provider instanceof CloudProvider && !pinnedConfigurations.has(route.provider)) {
    const config = getActiveCloudConfig();
    if (!config || !isUsableStudyModel(config)) {
      throw new StudyApiError({ code: 'provider_unavailable', messageKey: 'study_generation.error.no_provider_available', retryable: true });
    }
    route = { ...route, provider: pinCloud(config) };
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
    inspectOnly,
  });

  const maximumModelCalls = 2 * Math.max(1, plannedModelSteps);
  const config = pinnedConfigurations.get(route.provider);
  const pricing = config?.modelPricing?.[config.model]?.pricing;

  const preflight: StudyAiPreflight = {
    providerId: route.provider.id,
    model: describeModel(route),
    modelClass: route.servedModelClass,
    reasoningFallback: route.fallbackPath === 'reasoning-fallback',
    estimate: estimateTokens && {
      modelSteps: plannedModelSteps,
      inputTokens: estimateTokens.input,
      outputTokens: estimateTokens.output,
      inputPrice: pricing?.prompt,
      outputPrice: pricing?.completion,
      costUsd: !generationDestination.billable ? 0 : (
        pricing?.prompt != null && pricing.completion != null
          ? (pricing.prompt * estimateTokens.input + pricing.completion * estimateTokens.output) / 1000 +
            (pricing.request ?? 0) * plannedModelSteps
          : undefined
      ),
    },
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
  const currentModel = describeModel(currentRoute);
  const expected = frozenPreflight.model;
  if (frozenPreflight.providerId !== currentRoute.provider.id ||
      (expected && (!currentModel || expected.configId !== currentModel.configId ||
        expected.id !== currentModel.id || expected.provider !== currentModel.provider ||
        expected.endpointHash !== currentModel.endpointHash))) {
    throw new StudyApiError({
      code: 'invalid_state',
      messageKey: 'study_generation.error.provider_changed_on_resume',
      retryable: false,
    });
  }
}
