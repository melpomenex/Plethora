/**
 * Pinned Study Task execution with explicit route locking and metadata merging.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §10
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T05)
 */

import { runTask } from '../../ai/tasks/runTask';
import { resolveTaskRoute, type AITaskRoute } from '../../ai/tasks/router';
import type {
  AITaskDefinition,
  AITaskResult,
  AITaskRunOptions,
} from '../../ai/tasks/types';
import type { StudyAiPreflight } from './types';
import { classifyRouteDestination, resolveStudyTaskRoute, validatePreflightUnchanged } from './preflight';
import { evaluateStudyPrivacy } from './privacy';
import { StudyApiError } from '../../../api/study-plans';

export interface RunPinnedStudyTaskOptions extends AITaskRunOptions {
  /** Optional pre-resolved route from performStudyAiPreflight */
  preflightRoute?: AITaskRoute | null;
  /** Test override for router */
  resolveRouteFn?: typeof resolveTaskRoute;
}

/**
 * Runs a study AI task with a pinned provider and model route, suppressing
 * any unapproved alternate-provider/cloud fallback in the task layer.
 * Merges primary/selected route metadata with actual run output.
 */
export async function runPinnedStudyTask<I, O>(
  primaryTask: AITaskDefinition<I, O>,
  input: I,
  options: RunPinnedStudyTaskOptions,
  frozenPreflight: StudyAiPreflight
): Promise<AITaskResult<O>> {
  // Fail-closed early cancellation check before preparing any prompts or resolving routes
  if (options.signal?.aborted) {
    throw new StudyApiError({
      code: 'cancelled',
      messageKey: 'study_generation.error.cancelled',
      retryable: false,
    });
  }

  const resolveRoute = options.resolveRouteFn ?? (frozenPreflight.model
    ? (task: AITaskDefinition<never, unknown>) => resolveStudyTaskRoute(task, frozenPreflight.model?.configId)
    : resolveTaskRoute);
  const route: AITaskRoute | null =
    options.preflightRoute ?? (await resolveRoute(primaryTask as unknown as AITaskDefinition<never, unknown>));

  if (!route || !route.provider) {
    throw new StudyApiError({
      code: 'provider_unavailable',
      messageKey: 'study_generation.error.no_provider_available',
      retryable: true,
    });
  }

  // Validate that the resolved provider matches the frozen preflight
  validatePreflightUnchanged(frozenPreflight, route);
  if (frozenPreflight.model || !options.resolveRouteFn) {
    evaluateStudyPrivacy({
      documents: [],
      generationDestination: classifyRouteDestination(route),
      embeddingDestination: typeof frozenPreflight.embeddingDestination === 'object' ? frozenPreflight.embeddingDestination : null,
      cloudDisclosureAccepted: frozenPreflight.cloudDisclosureAccepted,
      costConsentAccepted: frozenPreflight.costConsentAccepted,
    });
  }

  // Execute the pre-resolved task (which may be a reasoning twin) on the pinned provider
  // Passing options.provider explicitly suppresses runTask's internal fallback loop
  const rawResult = await runTask(
    route.task as unknown as AITaskDefinition<I, O>,
    input,
    {
      ...options,
      provider: route.provider,
      ...(frozenPreflight.model && { streaming: false }),
    }
  );

  // Merge the primary route's model-class and fallback metadata because provider injection
  // in runTask otherwise sets fallbackPath to 'none' and ignores twin resolution
  return {
    ...rawResult,
    requestedModelClass: route.requestedModelClass,
    servedModelClass: route.servedModelClass,
    fallbackPath: route.fallbackPath,
  };
}
