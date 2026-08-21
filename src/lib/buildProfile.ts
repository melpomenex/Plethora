/**
 * Build profile — single source of truth for the compile-time build profile.
 *
 * Injected by Vite (`vite.config.ts` `define`):
 *   __PLETHORA_BUILD_PROFILE__: JSON.stringify(process.env.PLETHORA_BUILD_PROFILE ?? 'development')
 *
 * Valid values: 'development' | 'sideload' | 'store'. Default 'development'.
 * An invalid value throws at module load (fail fast, never silently degrade).
 *
 * Consumers (read-only): Proposal B (billing-backend assertion) and
 * Proposal D (capability gating) import BUILD_PROFILE / isStoreProfile() /
 * isDevelopmentProfile() from this module. Do not duplicate the constant.
 */

declare const __PLETHORA_BUILD_PROFILE__: string | undefined;

export type BuildProfile = "development" | "sideload" | "store";

const VALID_PROFILES: readonly BuildProfile[] = ["development", "sideload", "store"];

/**
 * Parse a raw injected profile value. `undefined`/empty → 'development'
 * (the default for every local dev and un-annotated CI build). Invalid
 * values throw — a store/sideload mislabel must never pass silently.
 */
export function parseBuildProfile(value: string | undefined | null): BuildProfile {
  if (value === undefined || value === null || value === "") return "development";
  const normalized = value.trim().toLowerCase();
  if (!(VALID_PROFILES as readonly string[]).includes(normalized)) {
    throw new Error(
      `Invalid PLETHORA_BUILD_PROFILE "${value}". Expected one of: ${VALID_PROFILES.join(", ")}.`
    );
  }
  return normalized as BuildProfile;
}

export const BUILD_PROFILE: BuildProfile = parseBuildProfile(
  typeof __PLETHORA_BUILD_PROFILE__ === "undefined" ? undefined : __PLETHORA_BUILD_PROFILE__
);

/** True only for App Store distribution builds (PLETHORA_BUILD_PROFILE=store). */
export function isStoreProfile(): boolean {
  return BUILD_PROFILE === "store";
}

/** True for the default development profile (dev server, simulator, CI). */
export function isDevelopmentProfile(): boolean {
  return BUILD_PROFILE === "development";
}
