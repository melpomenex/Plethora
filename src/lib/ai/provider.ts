/**
 * Which inference path serves an AI action: on-device or cloud.
 *
 * One resolver, consulted per call. On-device is preferred on Android when the
 * model is ready and the user has not turned it off; everything else keeps
 * using the configured cloud provider exactly as before. If an on-device call
 * fails after starting, the action is retried through the cloud provider and
 * the user is told the fallback happened.
 */

import { useLLMProvidersStore } from "../../stores/llmProvidersStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { providerAllowsKeylessAccess } from "../../utils/llmProviderUtils";
import { ToastType, useToastStore } from "../../components/common/Toast";
import {
  getOnDeviceRequirementStatus,
  isOnDeviceAiSupportedPlatform,
  type OnDeviceRequirement,
} from "./onDeviceAI";
import { isCancelledError, toAIError } from "./errors";

export type AiPath = "ondevice" | "cloud" | "none";

/**
 * True when at least one enabled cloud provider is usable — it has a key, or it
 * is one of the providers that needs none (Ollama, a local OpenAI-compatible
 * endpoint).
 */
export function hasCloudProvider(): boolean {
  return useLLMProvidersStore
    .getState()
    .providers.some(
      (p) =>
        p.enabled &&
        (p.apiKey.trim().length > 0 || providerAllowsKeylessAccess(p.provider, p.baseUrl))
    );
}

/** Whether the user wants on-device inference when it is available. */
export function prefersOnDevice(): boolean {
  return useSettingsStore.getState().settings.ai.preferOnDevice !== false;
}

/**
 * Decide which path an AI action should take right now for a given requirement.
 *
 * `none` means no AI is possible — callers should hide their AI-assisted
 * controls rather than offer an action that cannot run.
 */
export async function resolveAiPath(
  requirement: OnDeviceRequirement = "prompt"
): Promise<AiPath> {
  if (isOnDeviceAiSupportedPlatform() && prefersOnDevice()) {
    const status = await getOnDeviceRequirementStatus(requirement);
    if (status.status === "available") return "ondevice";
  }
  return hasCloudProvider() ? "cloud" : "none";
}

/** True when some AI path exists for the requirement. Used to gate AI-assisted UI controls. */
export async function isAnyAiAvailable(
  requirement: OnDeviceRequirement = "prompt"
): Promise<boolean> {
  return (await resolveAiPath(requirement)) !== "none";
}

/**
 * Run an AI action on the resolved path, falling back to cloud if the
 * on-device attempt fails after it started.
 *
 * Returns `null` when no path is available at all, so callers can no-op
 * instead of surfacing an error for a feature that simply is not configured.
 */
export async function runAiAction<T>(
  action: {
    /** Runs on-device. Only called when the on-device path was chosen. */
    onDevice: () => Promise<T>;
    /** Runs against the configured cloud provider. */
    cloud: () => Promise<T>;
  },
  /** Short human label used in the fallback toast, e.g. "Summarization". */
  label: string,
  requirement: OnDeviceRequirement = "prompt"
): Promise<T | null> {
  const path = await resolveAiPath(requirement);
  if (path === "none") return null;
  if (path === "cloud") return action.cloud();

  try {
    return await action.onDevice();
  } catch (error) {
    // A cancellation is the user's decision, not a failure to route around —
    // this holds for both `OnDeviceAiError(cancelled)` and unified
    // `AIError(Cancelled)` from the task layer.
    if (isCancelledError(error)) throw error;

    const typed = toAIError(error);
    if (typed.category === "Cancelled") throw typed;

    if (!hasCloudProvider()) throw typed;

    useToastStore.getState().addToast({
      type: ToastType.Info,
      title: `${label} used the cloud provider`,
      message: `On-device AI could not finish (${typed.code}).`,
    });
    return action.cloud();
  }
}
