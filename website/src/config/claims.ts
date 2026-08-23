import type { PlatformId } from './platforms.ts';
import claimsDocument from './claims.json' with { type: 'json' };

export type ClaimStatus =
  | 'implemented'
  | 'tested'
  | 'simulator-verified'
  | 'device-verified'
  | 'shipping'
  | 'commercially-release-ready'
  | 'planned'
  | 'mocked'
  | 'platform-limited'
  | 'provider-dependent'
  | 'blocked-external';

export type ClaimSurface =
  | 'homepage'
  | 'features'
  | 'pricing'
  | 'downloads'
  | 'trust'
  | 'audience'
  | 'demo';

export interface ProductClaim {
  id: string;
  statement: string;
  status: ClaimStatus;
  evidencePaths: string[];
  allowedSurfaces: ClaimSurface[];
  public: boolean;
  platforms?: PlatformId[];
  notes?: string;
}

const PUBLIC_PRODUCTION_STATUSES: ClaimStatus[] = [
  'shipping',
  'commercially-release-ready',
  'device-verified',
];

export const CLAIMS: ProductClaim[] = claimsDocument.claims as ProductClaim[];

export function getClaim(id: string): ProductClaim | undefined {
  return CLAIMS.find((claim) => claim.id === id);
}

export function isPublicProductionClaim(claim: ProductClaim): boolean {
  return claim.public && PUBLIC_PRODUCTION_STATUSES.includes(claim.status);
}

export function publicClaimsFor(surface: ClaimSurface): ProductClaim[] {
  return CLAIMS.filter(
    (claim) => isPublicProductionClaim(claim) && claim.allowedSurfaces.includes(surface),
  );
}

/**
 * Resolve a product-fact claim for templates. Throws if the id is missing or
 * not allowed in public copy. Pages MUST use this (or `claimStatement`) instead
 * of interpolating untracked slogans.
 */
export function assertClaim(id: string): ProductClaim {
  const claim = getClaim(id);
  if (!claim) {
    throw new Error(`Unknown product claim: ${id}`);
  }
  if (!isPublicProductionClaim(claim)) {
    throw new Error(
      `Claim "${id}" is not allowed in public copy (public=${claim.public}, status=${claim.status}).`,
    );
  }
  return claim;
}

export function claimStatement(id: string): string {
  return assertClaim(id).statement;
}
