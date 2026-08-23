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
import { getAppleIntelligenceSnapshot, isAppleOsPlatform } from "./apple/capabilities";
import { isCancelledError, toAIError } from "./errors";
import { requestPaidConsent } from "../../utils/aiBillingConsent";
import { ensureCloudAiDisclosure } from "../../lib/privacy/cloudAiDisclosure";
import { getActiveCloudConfig } from "./providers/cloudProvider";
import { t } from "../i18n";

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
 * Policy mapping (do not add a third overlapping boolean):
 *
 * | preferOnDevice | allowCloudFallback | Meaning |
 * | true           | false              | Use Nano when ready; on-device failure does not auto-retry paid cloud |
 * | true           | true               | Prefer Nano; explicit paid-cloud retry allowed |
 * | false          | *                  | Use the configured provider (`CloudProvider`, including keyless Ollama) |
 *
 * `CloudProvider.kind` is `"cloud"` even for Ollama/localhost. Privacy chrome
 * MUST use `providerAllowsKeylessAccess` / `sendsTextOffDevice`, not `kind`.
 */
export function allowCloudFallback(): boolean {
  return useSettingsStore.getState().settings.ai.allowCloudFallback === true;
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
  if (prefersOnDevice()) {
    if (isOnDeviceAiSupportedPlatform()) {
      const status = await getOnDeviceRequirementStatus(requirement);
      if (status.status === "available") return "ondevice";
    }
    if (isAppleOsPlatform()) {
      const snap = await getAppleIntelligenceSnapshot();
      const fmReady = snap.foundationModels.status === "available";
      const visionReady = snap.visionDocuments.status === "available";
      if (requirement === "image-prompt") {
        if (visionReady || fmReady) return "ondevice";
      } else if (fmReady) {
        return "ondevice";
      }
    }
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
 * Whether the configured cloud provider is billable. Ollama and local
 * OpenAI-compatible endpoints are free/local (never a billable fallback target);
 * every other configured cloud provider bills an external API.
 */
export function cloudProviderIsPaid(): boolean {
  const config = getActiveCloudConfig();
  if (!config) return false;
  return !providerAllowsKeylessAccess(config.provider, config.baseUrl);
}

/**
 * Gate the on-device → cloud automatic retry (ai-billing-safety #14).
 * Returns true when the retry may proceed:
 * - a free/local cloud target (Ollama / local endpoint) is never billable, so
 *   it proceeds — the caller still shows the informational toast (never silent);
 * - a paid cloud target proceeds when the user has explicitly opted in via the
 *   persisted `allowCloudFallback` flag;
 * - otherwise the paid retry surfaces the `ai-fallback` consent surface; a
 *   denial returns false and the operation stops with feedback.
 */
export async function requestCloudFallback(
  label: string,
  isPaid: boolean = cloudProviderIsPaid()
): Promise<boolean> {
  if (!isPaid) return true;
  const settings = useSettingsStore.getState().settings;
  if (settings.ai?.allowCloudFallback === true) return true;
  return requestPaidConsent({
    kind: "ai-fallback",
    provider: "cloud",
    label,
  });
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
  if (path === "cloud") {
    // Change C §4.3: one-time cloud-AI disclosure before any content leaves
    // the device. Local/keyless destinations (Ollama, localhost endpoints)
    // are exempt; an already-acknowledged provider class proceeds silently;
    // a denial stops the action with feedback (fail closed).
    const config = getActiveCloudConfig();
    const isLocal = config
      ? providerAllowsKeylessAccess(config.provider, config.baseUrl)
      : false;
    const disclosed = await ensureCloudAiDisclosure({
      featureClass: "ai_actions",
      provider: config?.provider ?? "cloud",
      isLocal,
    });
    if (!disclosed) {
      useToastStore.getState().addToast({
        type: ToastType.Warning,
        title: `${label} stayed off the cloud`,
        message: t("paid.fallbackBlocked"),
      });
      return null;
    }
    return action.cloud();
  }

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

    // ai-billing-safety #14: an on-device failure must NOT silently retry on a
    // paid cloud provider. The retry is gated by explicit consent — the
    // persisted `allowCloudFallback` flag, or the ai-fallback consent surface
    // (the in-app re-enable path). A denial stops the action with feedback.
    if (!(await requestCloudFallback(label))) {
      useToastStore.getState().addToast({
        type: ToastType.Warning,
        title: `${label} stayed on-device`,
        message: t("paid.fallbackBlocked"),
      });
      throw typed;
    }

    useToastStore.getState().addToast({
      type: ToastType.Info,
      title: `${label} used the cloud provider`,
      message: `On-device AI could not finish (${typed.code}).`,
    });
    return action.cloud();
  }
}
