/**
 * Explicit Learning Agent mode handoff (task 2.4).
 *
 * The command palette must OPEN the existing Assistant in Learning Agent mode
 * without sending a request. There is already exactly one Assistant
 * conversation/lifecycle; this module only carries the "select the mode"
 * intent to whichever existing presentation is mounted (desktop reader/queue
 * panel or the mobile Assistant host).
 *
 * No request text, no inference, no conversation is created here.
 */

import { useSettingsStore } from "../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { hasCloudProvider } from "../provider";
import { isOnDeviceAiSupportedPlatform } from "../onDeviceAI";
import { isAppleOsPlatform } from "../apple/capabilities";
import { isWindowsDesktop } from "../windows/capabilities";

export const LEARNING_AGENT_MODE_EVENT = "plethora:learning-agent-mode";

export interface LearningAgentModeRequest {
  intentId: string;
  requestedAt: number;
}

type Listener = (request: LearningAgentModeRequest | null) => void;

let pending: LearningAgentModeRequest | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(pending);
}

/** Request the existing Assistant enter Learning Agent mode (no inference). */
export function requestLearningAgentMode(): LearningAgentModeRequest {
  pending = {
    intentId: `learning-agent-mode:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    requestedAt: Date.now(),
  };
  emit();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<LearningAgentModeRequest>(LEARNING_AGENT_MODE_EVENT, {
        detail: pending,
      })
    );
  }
  return pending;
}

/** Consume once; a presentation that handles it clears the pending request. */
export function consumeLearningAgentMode(): LearningAgentModeRequest | null {
  const next = pending;
  pending = null;
  return next;
}

export function peekLearningAgentMode(): LearningAgentModeRequest | null {
  return pending;
}

export function subscribeLearningAgentMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook. */
export function resetLearningAgentModeForTests(): void {
  pending = null;
  listeners.clear();
}

export type LearningAgentAvailabilityReason =
  | "ready"
  | "feature-disabled"
  | "no-provider"
  | "setup-required";

/**
 * Synchronous palette/entry availability. Provider readiness (model download,
 * index) is probed when the mode opens; this only hides the action when the
 * feature is off or no route exists at all.
 */
export function learningAgentAvailability(): {
  available: boolean;
  reason: LearningAgentAvailabilityReason;
} {
  if (useSettingsStore.getState().settings.features?.aiAgent === false) {
    return { available: false, reason: "feature-disabled" };
  }
  const providers = useLLMProvidersStore.getState().providers;
  const configured = providers.some(
    (provider) =>
      provider.enabled &&
      (provider.apiKey.trim().length > 0 ||
        provider.provider === "ollama" ||
        Boolean(provider.baseUrl?.trim()))
  );
  if (
    configured ||
    hasCloudProvider() ||
    isOnDeviceAiSupportedPlatform() ||
    isAppleOsPlatform() ||
    isWindowsDesktop()
  ) {
    return { available: true, reason: "ready" };
  }
  return { available: false, reason: "no-provider" };
}

/** Copy shown beside a disabled mode so the user can recover. */
export const LEARNING_AGENT_AVAILABILITY_MESSAGES: Record<
  Exclude<LearningAgentAvailabilityReason, "ready">,
  string
> = {
  "feature-disabled": "Learning Agent is turned off in Settings → AI.",
  "no-provider": "No AI provider is configured.",
  "setup-required": "AI setup is not finished yet.",
};
