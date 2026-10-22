/**
 * Persisted authorization for automatic passage scoring that leaves the device
 * (change `complete-reader-extract-worthiness-integration`, blocker #8).
 *
 * The runtime enforcement lives in
 * `src/components/viewer/passageScoring/policy.ts`: remote automatic scoring is
 * denied until a scoped, finite grant exists. This module owns the *persisted*
 * shape so the grant survives restarts, without importing React, a store or a
 * provider.
 *
 * A grant is:
 *  - provider-scoped (`providerId` + observed `locality`),
 *  - source-scoped (`"*"` or one document id / `rss:<articleId>`), and
 *  - finite (`maxClassifications`, never more than the local hourly cap).
 *
 * Consumed units are device-local accounting, not part of the permission, and
 * are stored separately (see `remoteAuthorizationSettings.ts`) so reading does
 * not rewrite the Settings document on every classification.
 */

import type { DestinationLocality } from "./features/destinations";

/** One grant may never exceed the local foreground-hour envelope. */
export const PASSAGE_REMOTE_GRANT_MAX = 60;

/** Selectable allowances. Finite by construction — no "unlimited" option. */
export const PASSAGE_REMOTE_GRANT_QUOTAS = [10, 25, 60] as const;

export type PassageRemoteScoringSettingLocality = DestinationLocality;

export interface PassageRemoteScoringSetting {
  /** Stable id for revocation/UI correlation. */
  readonly id: string;
  /** Exact provider id the user authorized (e.g. the configured cloud route). */
  readonly providerId: string;
  /** Destination locality observed when the grant was created. */
  readonly locality: PassageRemoteScoringSettingLocality;
  /** Source scope: a document id, `rss:<articleId>`, or `"*"`. */
  readonly sourceScope: string;
  /** Finite automatic classification budget (1–60). */
  readonly maxClassifications: number;
  /** Unix epoch ms when the grant was created. */
  readonly grantedAt: number;
}

const LOCALITIES: readonly PassageRemoteScoringSettingLocality[] = [
  "device",
  "loopback",
  "lan",
  "remote",
  "unknown",
];

function isLocality(value: unknown): value is PassageRemoteScoringSettingLocality {
  return typeof value === "string" && (LOCALITIES as readonly string[]).includes(value);
}

function clampQuota(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  if (rounded <= 0) return null;
  return Math.min(PASSAGE_REMOTE_GRANT_MAX, rounded);
}

/**
 * Repair a persisted/imported grant, or return null when it cannot describe a
 * real permission. Invalid data is dropped rather than coerced into a broader
 * grant: a corrupt blob must never authorize cloud scoring.
 */
export function normalizePassageRemoteScoringSetting(
  value: unknown
): PassageRemoteScoringSetting | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Record<keyof PassageRemoteScoringSetting, unknown>>;

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const providerId = typeof raw.providerId === "string" ? raw.providerId.trim() : "";
  const sourceScope = typeof raw.sourceScope === "string" ? raw.sourceScope.trim() : "";
  const maxClassifications = clampQuota(raw.maxClassifications);
  if (!id || !providerId || !sourceScope || maxClassifications === null) return null;
  if (!isLocality(raw.locality)) return null;

  const grantedAt =
    typeof raw.grantedAt === "number" && Number.isFinite(raw.grantedAt)
      ? Math.max(0, Math.floor(raw.grantedAt))
      : 0;

  return {
    id,
    providerId,
    locality: raw.locality,
    sourceScope,
    maxClassifications,
    grantedAt,
  };
}

/** True when two grants describe the same permission. */
export function samePassageRemoteScoringSetting(
  a: PassageRemoteScoringSetting | null | undefined,
  b: PassageRemoteScoringSetting | null | undefined
): boolean {
  if (!a || !b) return a === b;
  return (
    a.id === b.id &&
    a.providerId === b.providerId &&
    a.locality === b.locality &&
    a.sourceScope === b.sourceScope &&
    a.maxClassifications === b.maxClassifications &&
    a.grantedAt === b.grantedAt
  );
}
