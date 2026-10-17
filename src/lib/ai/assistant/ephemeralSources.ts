/**
 * Live ephemeral viewer capabilities (design D4, task 2.5).
 *
 * Unsaved viewer material (an RSS article, a web page, a not-yet-imported
 * document) may legitimately be used as context, but only through a *live*
 * capability token that names its owner and source type. It never masquerades
 * as a library document and never triggers a database lookup. Capabilities
 * expire when the owning view goes away; an expired/unknown token is refused
 * (fail closed).
 */

export interface LiveViewerCapability {
  ownerToken: string;
  sourceType: string;
  /** Surface that issued it (`reader`, `queue`, `pwa`, ...). */
  ownerSurface: string;
  issuedAt: number;
  /** Optional expiry; the view revokes earlier on teardown when possible. */
  expiresAt?: number;
}

export interface EphemeralContextRequest {
  ownerToken: string;
  sourceType: string;
  /** Content is attached only for a matching live capability. */
  content: string;
  localOnly: true;
}

export class EphemeralCapabilityRegistry {
  private capabilities = new Map<string, LiveViewerCapability>();
  private now: () => number;

  constructor(now?: () => number) {
    this.now = now ?? (() => Date.now());
  }

  issue(capability: Omit<LiveViewerCapability, "issuedAt"> & { issuedAt?: number }): LiveViewerCapability {
    const issued: LiveViewerCapability = {
      ...capability,
      issuedAt: capability.issuedAt ?? this.now(),
    };
    this.capabilities.set(issued.ownerToken, issued);
    return issued;
  }

  /** Revoke on view teardown. */
  revoke(ownerToken: string): void {
    this.capabilities.delete(ownerToken);
  }

  /** Revoke every capability issued by a surface (pane closed). */
  revokeSurface(ownerSurface: string): void {
    for (const [token, capability] of this.capabilities) {
      if (capability.ownerSurface === ownerSurface) this.capabilities.delete(token);
    }
  }

  isLive(ownerToken: string, sourceType: string): boolean {
    const capability = this.capabilities.get(ownerToken);
    if (!capability) return false;
    if (capability.sourceType !== sourceType) return false;
    if (capability.expiresAt !== undefined && capability.expiresAt <= this.now()) {
      this.capabilities.delete(ownerToken);
      return false;
    }
    return true;
  }

  /** Drop expired tokens (also called on read, kept for explicit sweeps). */
  sweep(): number {
    let removed = 0;
    for (const [token, capability] of this.capabilities) {
      if (capability.expiresAt !== undefined && capability.expiresAt <= this.now()) {
        this.capabilities.delete(token);
        removed += 1;
      }
    }
    return removed;
  }
}

export type EphemeralDenial =
  | { allowed: true; capability: LiveViewerCapability }
  | { allowed: false; reason: "expired_or_unknown" | "source_type_mismatch" | "missing_content" };

/**
 * Validate an ephemeral context attachment against the registry. This is the
 * only way unsaved material enters a prompt; a library id is never fabricated
 * for it.
 */
export function authorizeEphemeralContext(
  registry: EphemeralCapabilityRegistry,
  request: EphemeralContextRequest,
): EphemeralDenial {
  if (!request.content.trim()) return { allowed: false, reason: "missing_content" };
  if (!registry.isLive(request.ownerToken, request.sourceType)) {
    return { allowed: false, reason: "expired_or_unknown" };
  }
  return {
    allowed: true,
    capability: {
      ownerToken: request.ownerToken,
      sourceType: request.sourceType,
      ownerSurface: "",
      issuedAt: 0,
    },
  };
}

/**
 * A library source reference must carry exactly one real identity: a library
 * id or a live ephemeral capability. This refuses the "fabricated library id"
 * class of bugs (a viewer title masquerading as a document).
 */
export function hasRealSourceIdentity(source: {
  libraryId?: string;
  ephemeral?: { ownerToken: string; sourceType: string };
}): boolean {
  const hasLibrary = typeof source.libraryId === "string" && source.libraryId.length > 0;
  const hasEphemeral = Boolean(source.ephemeral?.ownerToken);
  return hasLibrary !== hasEphemeral; // exactly one
}
