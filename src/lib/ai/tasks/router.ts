/**
 * Model-class router (design D3).
 *
 * Canonical task policy:
 *   fast      — passage classification, extract-worthiness, tagging
 *   full      — card generation, explanation, RAG answers, occlusion
 *   reasoning — difficult tutoring, math, complex assessment
 *
 * Today Gemini Nano serves every class identically (ML Kit exposes one
 * model); the router still resolves and records the class per request so a
 * future per-class provider needs no task changes. Reasoning tasks declare a
 * `reasoningFallback` task executed when no reasoning-capable provider exists.
 */

import { getRoutingProviders } from "../providers";
import type { AIModelCapabilities, AIProvider } from "../providers/types";
import { getTaskDefinition } from "./registry";
import type { AITaskDefinition, AITaskFallbackPath, AITaskModelClass } from "./types";

export interface AITaskRoute {
  /** The task that will actually execute (differs under reasoning fallback). */
  task: AITaskDefinition<never, unknown>;
  provider: AIProvider;
  requestedModelClass: AITaskModelClass;
  servedModelClass: AITaskModelClass;
  fallbackPath: AITaskFallbackPath;
}

/** Ordered candidate providers; injectable for tests. */
export type ProviderSource = () => AIProvider[];

const defaultProviderSource: ProviderSource = () => getRoutingProviders();

async function capabilitiesOf(provider: AIProvider): Promise<AIModelCapabilities | null> {
  try {
    return await provider.getCapabilities();
  } catch {
    return null;
  }
}

/**
 * Resolve which task executes on which provider.
 *
 * - `options.kind` forces a provider kind: the caller already resolved
 *   availability (`runAiAction` / legacy adapters), so no capability filter
 *   is applied — generation failures surface as typed errors for the caller's
 *   own fallback logic.
 * - Reasoning tasks prefer a provider that declares `reasoning`; when none
 *   does, the task's declared `reasoningFallback` task executes instead of
 *   failing (design D3).
 */
export async function resolveTaskRoute(
  task: AITaskDefinition<any, any>,
  options: {
    kind?: "ondevice" | "cloud";
    providers?: AIProvider[];
    providerSource?: ProviderSource;
  } = {}
): Promise<AITaskRoute | null> {
  const source = options.providerSource ?? defaultProviderSource;
  const candidates = options.providers ?? source();

  if (candidates.length === 0) return null;

  if (options.kind) {
    const forced = candidates.filter((p) => p.kind === options.kind);
    if (forced.length === 0) return null;
    return {
      task: task as AITaskDefinition<never, unknown>,
      provider: forced[0],
      requestedModelClass: task.modelClass,
      servedModelClass: task.modelClass,
      fallbackPath: "none",
    };
  }

  const caps = await Promise.all(candidates.map(capabilitiesOf));

  if (task.modelClass === "reasoning") {
    for (let i = 0; i < candidates.length; i++) {
      const capability = caps[i];
      if (capability?.reasoning && capability.textGeneration) {
        return {
          task: task as AITaskDefinition<never, unknown>,
          provider: candidates[i],
          requestedModelClass: "reasoning",
          servedModelClass: "reasoning",
          fallbackPath: "none",
        };
      }
    }

    // No reasoning-capable provider: execute the declared fallback task
    // instead of failing (design D3).
    if (task.reasoningFallback) {
      const fallbackTask = getTaskDefinition(task.reasoningFallback);
      if (fallbackTask) {
        const fallbackRoute = await resolveTaskRoute(fallbackTask, {
          providers: candidates,
        });
        if (fallbackRoute) {
          return {
            ...fallbackRoute,
            requestedModelClass: "reasoning",
            fallbackPath: "reasoning-fallback",
          };
        }
        return null;
      }
    }
  }

  const usable = candidates.findIndex((_, i) => caps[i]?.textGeneration === true);
  if (usable >= 0) {
    return {
      task: task as AITaskDefinition<never, unknown>,
      provider: candidates[usable],
      requestedModelClass: task.modelClass,
      servedModelClass: task.modelClass,
      fallbackPath: "none",
    };
  }

  return null;
}
