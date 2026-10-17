/**
 * Unified Assistant privacy, local-only, and cloud disclosure gate
 * (`enforceAssistantPrivacyAndConsent`).
 *
 * Ensures that `AssistantPanel`, `DocumentQATab`, `QueueScrollPage`,
 * `AskSheet`, and `PwaAssistantButton` enforce the exact same privacy
 * boundaries (`isAiExcluded`, `isLocalOnly`, `strictLocalOnly`, and
 * `ensureCloudAiDisclosure`).
 */

import { requestPaidConsent } from "../../../utils/aiBillingConsent";
import { ensureCloudAiDisclosure } from "../../privacy/cloudAiDisclosure";
import { resolveDestination } from "./turnPolicy";

export interface PrivacySubjectDocument {
  id: string;
  title?: string;
  isAiExcluded?: boolean;
  isLocalOnly?: boolean;
}

export interface EnforceAssistantPrivacyOptions {
  documents?: ReadonlyArray<PrivacySubjectDocument | null | undefined>;
  providerId: string;
  cloudFallback?: boolean;
  model?: string;
  isLocalProvider?: boolean;
  strictLocalOnly?: boolean;
  /** Whether source content is actually being attached to the request. */
  attachingSourceContent?: boolean;
  /**
   * The resolved destination from `turnPolicy.resolveDestination`. When
   * present it wins over the provider-name guess so a remote custom endpoint
   * cannot inherit on-device guarantees from its label (design D4).
   */
  destination?: { locality: "on-device" | "remote"; localityReason?: string };
  /** Configured endpoint, used to resolve locality when `destination` is absent. */
  baseUrl?: string;
}

export interface PrivacyGateResult {
  allowed: boolean;
  /** Whether source content must be stripped (e.g. in Chat scope on an excluded doc when answering a general question). */
  stripSourceContent: boolean;
  reason?:
    | "document_ai_excluded"
    | "local_only_provider_required"
    | "cloud_disclosure_declined"
    | "paid_cloud_consent_declined";
  message?: string;
}

export function isLocalAiProviderId(providerId: string): boolean {
  const normalized = providerId.trim().toLowerCase();
  return (
    normalized === "ollama" ||
    normalized === "apple-foundation" ||
    normalized === "apple-foundation-models" ||
    normalized === "apple-core-ai" ||
    normalized === "gemini-nano" ||
    normalized === "windows-ai" ||
    normalized === "foundry-local" ||
    normalized === "local-decision-engine" ||
    normalized === "ondevice"
  );
}

export async function enforceAssistantPrivacyAndConsent(
  options: EnforceAssistantPrivacyOptions,
): Promise<PrivacyGateResult> {
  // Destination-truth locality: an explicit resolved destination wins; when
  // absent, fall back to endpoint-aware resolution before the legacy name
  // check so `ollama` with a remote baseUrl is treated as remote.
  const resolved =
    options.destination
      ? { locality: options.destination.locality, reason: options.destination.localityReason }
      : resolveDestination({
          providerId: options.providerId,
          model: options.model,
          baseUrl: options.baseUrl,
        });
  const isLocal =
    options.isLocalProvider ??
    (resolved.locality === "on-device" ||
      // Legacy name-based fallback only when no destination evidence exists.
      (options.baseUrl === undefined &&
        options.destination === undefined &&
        isLocalAiProviderId(options.providerId)));
  const docs = (options.documents ?? []).filter(
    (d): d is PrivacySubjectDocument => Boolean(d),
  );
  const attachingSource = options.attachingSourceContent ?? docs.length > 0;

  // 1. Global strict local-only setting
  if (options.strictLocalOnly && !isLocal) {
    return {
      allowed: false,
      stripSourceContent: true,
      reason: "local_only_provider_required",
      message:
        "Strict Local-Only AI mode is enabled. Switch to a local provider (such as Ollama or On-Device AI) or disable Strict Local-Only mode in Settings.",
    };
  }

  // 2. Per-document exclusions when source content is attached
  if (attachingSource && docs.length > 0) {
    const excludedDoc = docs.find((d) => d.isAiExcluded);
    if (excludedDoc) {
      return {
        allowed: false,
        stripSourceContent: true,
        reason: "document_ai_excluded",
        message: `"${excludedDoc.title || excludedDoc.id}" is excluded from AI processing.`,
      };
    }

    const localOnlyDoc = docs.find((d) => d.isLocalOnly);
    if (localOnlyDoc && !isLocal) {
      return {
        allowed: false,
        stripSourceContent: true,
        reason: "local_only_provider_required",
        message: `"${localOnlyDoc.title || localOnlyDoc.id}" is marked Local-Only and cannot be sent to cloud provider "${options.providerId}".`,
      };
    }
  }

  // 3. One-time Cloud AI disclosure modal for non-local providers
  if (!isLocal) {
    const disclosed = await ensureCloudAiDisclosure({
      featureClass: "ai_actions",
      provider: options.providerId,
      isLocal: false,
    });
    if (!disclosed) {
      return {
        allowed: false,
        stripSourceContent: true,
        reason: "cloud_disclosure_declined",
        message: "Cloud AI disclosure was declined.",
      };
    }
  }

  if (!isLocal && options.cloudFallback && !await requestPaidConsent({
    kind: "ai-fallback", provider: options.providerId, model: options.model,
    label: "Use cloud AI for this assistant request",
  })) {
    return { allowed: false, stripSourceContent: true, reason: "paid_cloud_consent_declined",
      message: "Paid cloud AI fallback was not enabled." };
  }

  return {
    allowed: true,
    stripSourceContent: false,
  };
}
