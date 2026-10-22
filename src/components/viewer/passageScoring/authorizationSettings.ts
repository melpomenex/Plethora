/**
 * Settings ⇄ policy bridge for remote passage scoring (blocker #8).
 *
 * Responsibilities:
 *  - describe the *active* cloud destination so Settings can offer a grant
 *    only when scoring would really leave the device;
 *  - create/revoke the persisted grant together with the runtime authorization;
 *  - rehydrate the runtime authorization from persisted settings before every
 *    policy resolution (a restart is not a new permission);
 *  - persist consumed units (device-local, capped) without rewriting the
 *    Settings document on every classification.
 *
 * The enforcement itself stays in `policy.ts`; this module never decides
 * whether a passage may be sent, it only mirrors an explicit user choice.
 */

import { useSettingsStore } from "../../../stores/settingsStore";
import { getActiveCloudConfig } from "../../../lib/ai/providers/cloudProvider";
import { CLOUD_PROVIDER_ID } from "../../../lib/ai/providers";
import { classifyCloudDestination } from "../../../lib/ai/features/destinations";
import {
  PASSAGE_REMOTE_GRANT_MAX,
  normalizePassageRemoteScoringSetting,
  samePassageRemoteScoringSetting,
  type PassageRemoteScoringSetting,
  type PassageRemoteScoringSettingLocality,
} from "../../../lib/ai/passageScoringConsent";
import {
  getPassageRemoteScoringAuthorization,
  grantPassageRemoteScoringAuthorization,
  revokePassageRemoteScoringAuthorization,
  subscribePassageRemoteScoringUsage,
} from "./policy";

/** `localStorage` key for consumed units. Deliberately not part of Settings. */
export const PASSAGE_REMOTE_USAGE_STORAGE_KEY = "plethora.passage-scoring.remote-usage";

/** Source scope used by the Settings control: every source the user reads. */
export const PASSAGE_REMOTE_DEFAULT_SCOPE = "*";

export interface RemotePassageScoringTarget {
  /** Provider id the runtime policy will report for this destination. */
  readonly providerId: string;
  readonly locality: PassageRemoteScoringSettingLocality;
  /** True when the destination processes text off-device. */
  readonly offDevice: boolean;
  /** Provider family for user-facing copy (e.g. "ollama"). */
  readonly provider: string;
}

/**
 * Resolve the destination that automatic scoring would actually use right now.
 * Null when no cloud route is configured at all. A loopback destination is
 * reported with `offDevice: false`: it already counts as on-device and needs no
 * grant.
 */
export function remotePassageScoringTarget(): RemotePassageScoringTarget | null {
  const config = getActiveCloudConfig();
  if (!config) return null;
  const destination = classifyCloudDestination({
    provider: config.provider,
    baseUrl: config.baseUrl ?? null,
    hasApiKey: config.apiKey.trim().length > 0,
  });
  return {
    providerId: CLOUD_PROVIDER_ID,
    locality: destination.locality,
    offDevice: destination.sendsOffDevice,
    provider: config.provider,
  };
}

function readUsage(id: string): number {
  if (typeof localStorage === "undefined") return 0;
  try {
    const raw = localStorage.getItem(PASSAGE_REMOTE_USAGE_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { id?: unknown; used?: unknown };
    if (parsed?.id !== id) return 0;
    const used = Number(parsed.used);
    if (!Number.isFinite(used) || used < 0) return 0;
    return Math.floor(used);
  } catch {
    return 0;
  }
}

function writeUsage(id: string, used: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      PASSAGE_REMOTE_USAGE_STORAGE_KEY,
      JSON.stringify({ id, used: Math.max(0, Math.floor(used)) })
    );
  } catch {
    // Storage unavailable only loses restart accounting, never permission.
  }
}

function clearUsage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(PASSAGE_REMOTE_USAGE_STORAGE_KEY);
  } catch {
    // Ignore blocked storage.
  }
}

/** Push one persisted grant into the runtime authorization. */
function applySettingToPolicy(setting: PassageRemoteScoringSetting): void {
  grantPassageRemoteScoringAuthorization(
    {
      id: setting.id,
      providerId: setting.providerId,
      locality: setting.locality,
      sourceScope: setting.sourceScope,
      maxClassifications: setting.maxClassifications,
      grantedAt: setting.grantedAt,
    },
    readUsage(setting.id)
  );
}

/**
 * Make the runtime authorization match persisted settings. Safe and cheap to
 * call before every policy resolution.
 */
export function syncRemoteAuthorizationFromSettings(): void {
  const stored = normalizePassageRemoteScoringSetting(
    useSettingsStore.getState().settings.ai.remotePassageScoring
  );

  if (!stored) {
    if (getPassageRemoteScoringAuthorization()) revokePassageRemoteScoringAuthorization();
    return;
  }

  const active = getPassageRemoteScoringAuthorization();
  if (
    active &&
    samePassageRemoteScoringSetting(active.authorization, stored) &&
    active.used === readUsage(stored.id)
  ) {
    return;
  }
  applySettingToPolicy(stored);
}

function newGrantId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `passage-remote-${cryptoApi.randomUUID()}`;
  }
  return `passage-remote-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface GrantRemotePassageScoringOptions {
  maxClassifications: number;
  sourceScope?: string;
}

/**
 * Create an explicit, scoped, finite grant. Returns null when there is no
 * off-device destination to authorize (nothing to consent to) or the quota is
 * invalid. Never widens an existing grant silently: a new grant starts a new
 * allowance with fresh usage.
 */
export function grantRemotePassageScoring(
  options: GrantRemotePassageScoringOptions
): PassageRemoteScoringSetting | null {
  const target = remotePassageScoringTarget();
  if (!target || !target.offDevice) return null;

  const quota = Math.min(PASSAGE_REMOTE_GRANT_MAX, Math.floor(options.maxClassifications));
  if (!Number.isFinite(quota) || quota <= 0) return null;

  const setting = normalizePassageRemoteScoringSetting({
    id: newGrantId(),
    providerId: target.providerId,
    locality: target.locality,
    sourceScope: options.sourceScope?.trim() || PASSAGE_REMOTE_DEFAULT_SCOPE,
    maxClassifications: quota,
    grantedAt: Date.now(),
  });
  if (!setting) return null;

  clearUsage();
  useSettingsStore.getState().updateSettingsCategory("ai", {
    remotePassageScoring: setting,
  });
  applySettingToPolicy(setting);
  return setting;
}

/** Revoke the persisted grant and stop any queued remote work immediately. */
export function revokeRemotePassageScoring(): void {
  useSettingsStore.getState().updateSettingsCategory("ai", {
    remotePassageScoring: null,
  });
  clearUsage();
  revokePassageRemoteScoringAuthorization();
}

export interface RemotePassageScoringUsage {
  readonly allowed: number;
  readonly used: number;
  readonly remaining: number;
}

/** Current allowance for UI copy; null when no grant is configured. */
export function getRemotePassageScoringUsage(): RemotePassageScoringUsage | null {
  const setting = normalizePassageRemoteScoringSetting(
    useSettingsStore.getState().settings.ai.remotePassageScoring
  );
  if (!setting) return null;
  const used = Math.min(setting.maxClassifications, readUsage(setting.id));
  return {
    allowed: setting.maxClassifications,
    used,
    remaining: Math.max(0, setting.maxClassifications - used),
  };
}

let persistenceInstalled = false;
let removeUsageListener: (() => void) | null = null;

/**
 * Install the one usage → storage listener. Idempotent; the reader calls it
 * when it builds its dependencies so consumption is persisted even when the
 * Settings panel was never opened this session.
 */
export function ensureRemoteAuthorizationPersistence(): void {
  if (persistenceInstalled) return;
  persistenceInstalled = true;
  removeUsageListener = subscribePassageRemoteScoringUsage(({ id, used }) => {
    const setting = normalizePassageRemoteScoringSetting(
      useSettingsStore.getState().settings.ai.remotePassageScoring
    );
    if (!setting || setting.id !== id) return;
    writeUsage(id, used);
  });
}

/** Test-only: detach the listener and reset the device-local usage row. */
export function resetRemoteAuthorizationPersistenceForTests(): void {
  removeUsageListener?.();
  removeUsageListener = null;
  persistenceInstalled = false;
  clearUsage();
}
