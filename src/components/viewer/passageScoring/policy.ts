/**
 * Serving-policy resolution for passage scoring (task 2.2).
 *
 * Two independent facts are resolved before any passage leaves the device:
 *  - which provider/model actually serves the classifier (identity + model
 *    revision participate in the cache key), and
 *  - where that destination processes text (`classifyCloudDestination`).
 *
 * Automatic remote scoring is denied by default. It requires a separate,
 * scoped, finite authorization created explicitly (never implied by the
 * feature flag, prior Assistant use, or a keyless/remote endpoint).
 */

import {
  APPLE_CORE_AI_PROVIDER_ID,
  APPLE_FOUNDATION_PROVIDER_ID,
  CLOUD_PROVIDER_ID,
  FOUNDRY_LOCAL_PROVIDER_ID,
  LOCAL_DECISION_ENGINE_PROVIDER_ID,
  ON_DEVICE_PROVIDER_ID,
  WINDOWS_SYSTEM_PROVIDER_ID,
  type AIProvider,
} from "../../../lib/ai/providers";
import { getActiveCloudConfig } from "../../../lib/ai/providers/cloudProvider";
import {
  classifyCloudDestination,
  classifyNativeDestination,
  type DestinationClassification,
} from "../../../lib/ai/features/destinations";
import type { ProviderClass } from "../../../lib/ai/features/types";
import { passageClassificationTask } from "../../../lib/ai/tasks/definitions/passageClassificationTask";
import { resolveTaskRoute } from "../../../lib/ai/tasks/router";
import { sha256Short } from "./hash";
import { PASSAGE_CLASSIFIER_REVISION_PREFIX } from "./identity";
import { PASSAGE_HOUR_CLASSIFICATION_LIMIT, type PassagePolicyIdentity } from "./types";

/**
 * Classifier policy revision: prompt text + schema shape + output envelope.
 * Any prompt/schema edit changes every cache key, so a stale verdict cannot
 * be reused under new instructions.
 */
export const PASSAGE_CLASSIFIER_VERSION = `${PASSAGE_CLASSIFIER_REVISION_PREFIX}:${sha256Short(
  [
    passageClassificationTask.id,
    passageClassificationTask.systemInstruction,
    passageClassificationTask.schema?.json ?? "",
    String(passageClassificationTask.maxOutputTokens),
    String(passageClassificationTask.timeoutMs),
  ].join("\u0000"),
  24
)}`;

export interface ResolvedPassageScoringPolicy extends PassagePolicyIdentity {
  readonly provider: AIProvider;
  readonly providerId: string;
  readonly providerClass: ProviderClass;
  readonly destination: DestinationClassification;
  /** True when text is processed off-device. */
  readonly remote: boolean;
  /** Remote automatic work is authorized (local is always authorized). */
  readonly authorized: boolean;
  /** Safe reason key when not authorized. */
  readonly denialReasonKey?: string;
}

export type PassagePolicyResolution =
  | { status: "ready"; policy: ResolvedPassageScoringPolicy }
  | { status: "unavailable"; reasonKey: string }
  | { status: "denied-remote"; policy: ResolvedPassageScoringPolicy; reasonKey: string };

function providerClassFor(provider: AIProvider, configProvider?: string): ProviderClass {
  switch (provider.id) {
    case ON_DEVICE_PROVIDER_ID:
      return "android-nano";
    case APPLE_FOUNDATION_PROVIDER_ID:
    case APPLE_CORE_AI_PROVIDER_ID:
      return "apple-native";
    case WINDOWS_SYSTEM_PROVIDER_ID:
      return "windows-system";
    case FOUNDRY_LOCAL_PROVIDER_ID:
      return "foundry-local";
    case CLOUD_PROVIDER_ID:
      return configProvider === "ollama" ? "ollama-local" : "configured-external";
    case LOCAL_DECISION_ENGINE_PROVIDER_ID:
      return "ollama-local";
    default:
      return provider.kind === "cloud" ? "configured-external" : "unknown";
  }
}

/**
 * Session override for the model actually reported by a provider (e.g. a
 * cloud gateway serving `baseModelName` different from the requested model).
 * Once observed, the rest of the session uses the real identity for lookups.
 */
const servingRevisionOverrides = new Map<string, string>();

function overrideKey(providerId: string, requestedRevision: string): string {
  return `${providerId}\u0000${requestedRevision}`;
}

export function recordObservedServingRevision(
  providerId: string,
  requestedRevision: string,
  actualRevision: string
): void {
  if (!actualRevision || actualRevision === requestedRevision) return;
  servingRevisionOverrides.set(overrideKey(providerId, requestedRevision), actualRevision);
}

export function getObservedServingRevision(
  providerId: string,
  requestedRevision: string
): string {
  return servingRevisionOverrides.get(overrideKey(providerId, requestedRevision)) ?? requestedRevision;
}

/** Clear session overrides (tests / sign-out / provider removal). */
export function resetObservedServingRevisions(): void {
  servingRevisionOverrides.clear();
}

/* ------------------------------------------------------------------------- */
/* Explicit remote authorization                                             */
/* ------------------------------------------------------------------------- */

export interface PassageRemoteScoringAuthorization {
  /** Stable id for revocation/UI correlation. */
  readonly id: string;
  /** Exact provider id this grant applies to. */
  readonly providerId: string;
  /** Destination locality observed when the grant was created. */
  readonly locality: DestinationClassification["locality"];
  /** Source scope: a document id, `rss:<articleId>`, or `"*"`. */
  readonly sourceScope: string;
  /** Finite automatic classification budget (must be > 0). */
  readonly maxClassifications: number;
  readonly grantedAt: number;
}

interface StoredRemoteAuthorization extends PassageRemoteScoringAuthorization {
  used: number;
}

let remoteAuthorization: StoredRemoteAuthorization | null = null;
const authorizationListeners = new Set<() => void>();
const usageListeners = new Set<
  (usage: { id: string; used: number; maxClassifications: number }) => void
>();

/**
 * Subscribe to grant/revocation changes so an active controller can stop
 * queued remote work instead of waiting for the next idle tick.
 */
export function subscribePassageScoringAuthorization(listener: () => void): () => void {
  authorizationListeners.add(listener);
  return () => authorizationListeners.delete(listener);
}

/**
 * Subscribe to consumed remote units. Used to persist the allowance so a
 * restart cannot silently refill it; it never grants or revokes anything.
 */
export function subscribePassageRemoteScoringUsage(
  listener: (usage: { id: string; used: number; maxClassifications: number }) => void
): () => void {
  usageListeners.add(listener);
  return () => usageListeners.delete(listener);
}

function notifyAuthorizationChange(): void {
  for (const listener of authorizationListeners) listener();
}

/**
 * Create a scoped, finite remote-scoring grant. Returns the normalized grant
 * (with the original finite budget) or null for invalid input. `used` seeds
 * already-consumed units when rehydrating a persisted grant.
 */
export function grantPassageRemoteScoringAuthorization(
  input: PassageRemoteScoringAuthorization,
  used = 0
): PassageRemoteScoringAuthorization | null {
  if (!Number.isFinite(input.maxClassifications) || input.maxClassifications <= 0) return null;
  // A remote grant can never exceed the local foreground-hour envelope.
  if (input.maxClassifications > PASSAGE_HOUR_CLASSIFICATION_LIMIT) return null;
  if (!input.providerId || !input.sourceScope) return null;
  const maxClassifications = Math.floor(input.maxClassifications);
  remoteAuthorization = {
    ...input,
    maxClassifications,
    used: Math.min(
      maxClassifications,
      Math.max(0, Number.isFinite(used) ? Math.floor(used) : 0)
    ),
  };
  notifyAuthorizationChange();
  return {
    id: input.id,
    providerId: input.providerId,
    locality: input.locality,
    sourceScope: input.sourceScope,
    maxClassifications,
    grantedAt: input.grantedAt,
  };
}

export function getPassageRemoteScoringAuthorization(): {
  readonly authorization: PassageRemoteScoringAuthorization;
  readonly used: number;
  readonly remaining: number;
} | null {
  if (!remoteAuthorization) return null;
  return {
    authorization: remoteAuthorization,
    used: remoteAuthorization.used,
    remaining: Math.max(0, remoteAuthorization.maxClassifications - remoteAuthorization.used),
  };
}

export function revokePassageRemoteScoringAuthorization(id?: string): void {
  if (!id || remoteAuthorization?.id === id) {
    remoteAuthorization = null;
    notifyAuthorizationChange();
  }
}

export function resetPassageScoringPolicyForTests(): void {
  remoteAuthorization = null;
  servingRevisionOverrides.clear();
  notifyAuthorizationChange();
}

function remoteAuthorizationAllows(
  providerId: string,
  locality: DestinationClassification["locality"],
  sourceScope: string
): boolean {
  const stored = remoteAuthorization;
  if (!stored) return false;
  if (stored.providerId !== providerId) return false;
  if (stored.locality !== locality) return false;
  if (stored.sourceScope !== "*" && stored.sourceScope !== sourceScope) return false;
  return stored.used < stored.maxClassifications;
}

/** Consume one remote unit atomically; false when no scoped grant remains. */
export function consumePassageRemoteAuthorization(
  providerId: string,
  locality: DestinationClassification["locality"],
  sourceScope: string
): boolean {
  const stored = remoteAuthorization;
  if (!stored) return false;
  if (!remoteAuthorizationAllows(providerId, locality, sourceScope)) return false;
  stored.used += 1;
  for (const listener of usageListeners) {
    listener({
      id: stored.id,
      used: stored.used,
      maxClassifications: stored.maxClassifications,
    });
  }
  return true;
}

/* ------------------------------------------------------------------------- */
/* Resolution                                                                */
/* ------------------------------------------------------------------------- */

export interface ResolvePassageScoringPolicyOptions {
  /** Injectable providers for tests/fixtures. */
  providers?: AIProvider[];
  /** Source scope for a remote grant check (document id / rss:<id>). */
  sourceScope?: string;
}

function nativeModelIdentity(provider: AIProvider): string {
  return provider.id;
}

/**
 * Resolve the classifier route before any cache lookup or generation.
 * `provider` is pinned into the run options by the caller so `runTask` can
 * never silently fall back to a different (possibly remote) destination.
 */
export async function resolvePassageScoringPolicy(
  options: ResolvePassageScoringPolicyOptions = {}
): Promise<PassagePolicyResolution> {
  let route;
  try {
    route = await resolveTaskRoute(
      passageClassificationTask,
      options.providers ? { providers: options.providers } : {}
    );
  } catch {
    return { status: "unavailable", reasonKey: "ai.passageScoring.unavailableModel" };
  }
  if (!route) {
    return { status: "unavailable", reasonKey: "ai.passageScoring.unavailableModel" };
  }

  const provider = route.provider;
  let requestedModel = nativeModelIdentity(provider);
  let destination: DestinationClassification;
  let providerClass: ProviderClass;

  if (provider.kind === "cloud") {
    const config = getActiveCloudConfig();
    if (!config) {
      return { status: "unavailable", reasonKey: "ai.passageScoring.unavailableModel" };
    }
    requestedModel = `${config.provider}:${config.model}`;
    providerClass = providerClassFor(provider, config.provider);
    destination = classifyCloudDestination({
      provider: config.provider,
      baseUrl: config.baseUrl,
      hasApiKey: config.apiKey.trim().length > 0,
    });
  } else {
    providerClass = providerClassFor(provider);
    destination = classifyNativeDestination(providerClass);
  }

  const requestedRevision = getObservedServingRevision(provider.id, requestedModel);
  const remote = destination.sendsOffDevice;
  const scope = options.sourceScope ?? "*";
  const authorized =
    !remote || remoteAuthorizationAllows(provider.id, destination.locality, scope);
  const denialReasonKey = authorized ? undefined : "ai.passageScoring.remoteAuthorizationRequired";

  const policy: ResolvedPassageScoringPolicy = {
    classifierVersion: PASSAGE_CLASSIFIER_VERSION,
    servingRevision: `${provider.id}\u0000${requestedRevision}`,
    providerClass,
    capabilityRevision: `${PASSAGE_CLASSIFIER_VERSION}:${provider.id}:${requestedModel}`,
    provider,
    providerId: provider.id,
    destination,
    remote,
    authorized,
    denialReasonKey,
  };

  if (!authorized) {
    return { status: "denied-remote", policy, reasonKey: denialReasonKey! };
  }
  return { status: "ready", policy };
}
