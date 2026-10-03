/**
 * Where the decision-model credential actually lives, and how to check it.
 *
 * The picker collects configuration; this resolves it into a client and reports
 * on it. Kept separate from the component so the endpoint resolution is testable
 * without rendering anything — and because there are now two callers (the
 * settings picker and the queue's status line) that must resolve identically.
 */

import {
  DECISION_SPINE_ID,
  JEV_PROVIDER_ID,
  NO_DECISION_MODEL_ID,
  OPENAI_DECISIONS_PROVIDER_ID,
  OPENROUTER_DECISIONS_PROVIDER_ID,
  baseUrlFor,
  modelFor,
  type DecisionModelConfig,
} from "../../lib/daqe/decisionModelOptions";
import {
  getMaskedApiKey,
  type DecisionKeyProvider,
} from "../../api/ai";
import type { SystemOneClientOptions } from "../../lib/daqe/systemOne";

/** Which keychain slot a provider's credential lives in, or `null` for none. */
export function decisionKeyProviderFor(providerId: string): DecisionKeyProvider | null {
  switch (providerId) {
    case JEV_PROVIDER_ID:
      return "jev";
    case "clef":
      return "clef";
    case OPENROUTER_DECISIONS_PROVIDER_ID:
      return "openrouter";
    case OPENAI_DECISIONS_PROVIDER_ID:
      return "openai";
    default:
      return null;
  }
}

/**
 * A readiness stand-in.
 *
 * `setupGaps` asks only whether a credential *exists*. Nothing beyond the
 * keychain adapter is available synchronously, so the client builder takes the
 * same boolean — the secret is read from the keychain on demand, at call time,
 * and never lives in the settings object.
 */
const KEY_PRESENT = "stored-in-keychain";

export interface DecisionModelSelection {
  providerId: string;
  config: DecisionModelConfig;
}

/**
 * Build a System One client for the current selection.
 *
 * Returns `null` when the selection cannot produce one — no provider, the spine
 * (which routes through the AI layer rather than this protocol), or the
 * deterministic fallback. Callers treat `null` as "there is nothing to test",
 * which is the honest answer rather than a probe that would fail.
 */
export async function buildDecisionClient(
  selection: DecisionModelSelection,
): Promise<SystemOneClientOptions | null> {
  const { providerId, config } = selection;
  if (providerId === NO_DECISION_MODEL_ID || providerId === DECISION_SPINE_ID) return null;

  const baseUrl = baseUrlFor(providerId, config);
  if (!baseUrl) return null;

  // Laya and a generic laya-serve need no bearer token; the remote providers do,
  // and one that is missing is a configuration failure the probe should report
  // rather than a client that 401s on a missing header.
  const keyProvider = decisionKeyProviderFor(providerId);
  let apiKey: string | undefined;
  if (keyProvider && config.allowRemote) {
    const masked = await getMaskedApiKey(keyProvider).catch(() => null);
    if (masked) apiKey = keyProvider;
  }

  return {
    baseUrl,
    // A masked value is a stand-in for presence; the real secret stays in the
    // keychain. Providers that need no key (local servers) get none.
    ...(apiKey ? { apiKey } : {}),
    ...(modelFor(providerId, config) ? { model: modelFor(providerId, config) } : {}),
    timeoutMs: 10_000,
  };
}

/**
 * Assemble the selection from the stored settings.
 *
 * Kept next to {@link buildDecisionClient} so there is exactly one place that
 * knows how the two halves fit together.
 */
export function selectionFromSettings(daqe: {
  decisionModelProviderId: string | null;
  decisionApiKeySet: boolean;
  decisionEngine?: { baseUrl: string; model: string; timeoutMs?: number } | null;
  openrouterDecisionModelId: string | null;
  clefDecisionModelId?: string | null;
  openaiDecisionModelId?: string | null;
  cloudflareAccountId: string | null;
  allowRemoteDecisionModel: boolean;
}): DecisionModelSelection {
  return {
    providerId: daqe.decisionModelProviderId ?? NO_DECISION_MODEL_ID,
    config: {
      apiKey: daqe.decisionApiKeySet ? KEY_PRESENT : undefined,
      baseUrl: daqe.decisionEngine?.baseUrl,
      openrouterModelId: daqe.openrouterDecisionModelId ?? undefined,
      clefModelId: daqe.clefDecisionModelId ?? undefined,
      cloudflareAccountId: daqe.cloudflareAccountId ?? undefined,
      allowRemote: daqe.allowRemoteDecisionModel,
    },
  };
}
