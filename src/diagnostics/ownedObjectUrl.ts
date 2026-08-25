/**
 * Owned object-URL registry (change eliminate-long-running-memory-growth,
 * task 3.1 / design D5).
 *
 * `URL.createObjectURL` sites previously each owned their revoke; the
 * audio-edition path owned none. This wrapper gives every blob URL an owner
 * category (+ optional owner id) and exact accounting: live counts and byte
 * estimates grouped by owner, so leak assertions ("owner's live URLs are 0
 * after dispose") become invariants and a soak can attribute growth to an
 * owner.
 *
 * Invariants:
 *   - The registry stores `{ url, owner, ownerId, bytes, created }` ONLY —
 *     never the Blob/ArrayBuffer. The URL already pins the payload in the
 *     browser; retaining it again would double-count and re-leak.
 *   - Inert in production: when the diagnostics gate is off, URLs are still
 *     created/revoked (functionality is unchanged) but nothing is recorded
 *     and no stack is captured — zero bookkeeping writes (spec
 *     "A production configuration installs none of the surface").
 *   - The dev/test-only allocation-site ring is capped (ALLOCATION_RING_MAX).
 */

import { isDiagnosticsEnabled } from "./gate";

export interface OwnedObjectUrlOptions {
  /** Owner category, e.g. "tts-synthesis", "tts-cache-hit", "edition-section". */
  owner: string;
  /** Distinguishes entries within an owner (cache key, section id, ...). */
  ownerId?: string;
}

interface RegistryEntry {
  url: string;
  owner: string;
  ownerId?: string;
  bytes: number;
  created: number;
}

/** Documented maximum for the dev/test allocation-site ring. */
export const ALLOCATION_RING_MAX = 32;

const registry = new Map<string, RegistryEntry>();
const allocationSites: string[] = [];

/** Last-N allocation sites (dev/test only; bounded ring). */
export function getAllocationSites(): readonly string[] {
  return allocationSites;
}

/**
 * Create an object URL and record its ownership. Recording happens only when
 * the diagnostics gate is on; the URL is created either way.
 */
export function createOwnedObjectUrl(blob: Blob, options: OwnedObjectUrlOptions): string {
  const url = URL.createObjectURL(blob);
  if (isDiagnosticsEnabled()) {
    registry.set(url, {
      url,
      owner: options.owner,
      ownerId: options.ownerId,
      bytes: blob.size,
      created: Date.now(),
    });
    if (allocationSites.length >= ALLOCATION_RING_MAX) allocationSites.shift();
    allocationSites.push(`${options.owner}:${options.ownerId ?? ""}`);
  }
  return url;
}

/** Revoke an owned URL (removes the record). Unknown URLs are a no-op. */
export function revokeOwnedObjectUrl(url: string): void {
  registry.delete(url);
  URL.revokeObjectURL(url);
}

/** Revoke-on-replace helper: revoke the previous URL, return the new one. */
export function replaceOwnedObjectUrl(
  previousUrl: string | undefined | null,
  blob: Blob,
  options: OwnedObjectUrlOptions,
): string {
  if (previousUrl) revokeOwnedObjectUrl(previousUrl);
  return createOwnedObjectUrl(blob, options);
}

/**
 * Revoke every URL owned by `owner` (optionally narrowed to one ownerId) —
 * the "fully disposed owner leaves zero live URLs" operation. Returns the
 * number revoked.
 */
export function revokeAllOwnedObjectUrls(owner: string, ownerId?: string): number {
  let revoked = 0;
  for (const [url, entry] of registry) {
    if (entry.owner !== owner) continue;
    if (ownerId !== undefined && entry.ownerId !== ownerId) continue;
    registry.delete(url);
    URL.revokeObjectURL(url);
    revoked += 1;
  }
  return revoked;
}

export interface OwnedObjectUrlStats {
  total: { count: number; bytes: number };
  byOwner: Record<string, { count: number; bytes: number }>;
}

/** Live URL counts + byte estimates, grouped by owner. */
export function getOwnedObjectUrlStats(): OwnedObjectUrlStats {
  const byOwner: Record<string, { count: number; bytes: number }> = {};
  let count = 0;
  let bytes = 0;
  for (const entry of registry.values()) {
    const bucket = (byOwner[entry.owner] ??= { count: 0, bytes: 0 });
    bucket.count += 1;
    bucket.bytes += entry.bytes;
    count += 1;
    bytes += entry.bytes;
  }
  return { total: { count, bytes }, byOwner };
}

/** Number of live registry entries (O(1); used by tests and the snapshot). */
export function getOwnedObjectUrlCount(): number {
  return registry.size;
}

/** Recorded byte estimate for one owned URL (0 when unrecorded/off). */
export function getOwnedObjectUrlBytes(url: string): number {
  return registry.get(url)?.bytes ?? 0;
}

/** Test-only: drop all records without revoking (fixture isolation). */
export function resetOwnedObjectUrlRegistryForTests(): void {
  registry.clear();
  allocationSites.length = 0;
}
