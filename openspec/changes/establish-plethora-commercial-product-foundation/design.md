# Design: Capability Entitlements Architecture

## Context

24 proposals will introduce Free/Pro behavior. Without a central design, each would invent `isPro` checks. The architecture must support: monthly/annual subscriptions, trials, student plans, promos, grandfathered users, beta access, lifetime licenses, usage grants, admin entitlements — without client changes per model. It must also keep the app fully useful offline and unsubscribed.

## Core decisions

### D1 — Capabilities, not plans, are the client-side unit
The client never branches on plan identity. It asks *"is capability X enabled, and with what quota/reason?"*. Plans are a server-side concept that *maps to* capability grants. This lets any future plan/trial/grant ship server-side only.

### D2 — Snapshot model, not per-feature calls
One `EntitlementSnapshot` (all capabilities + quotas) fetched at login/refresh/app-start (lazy, non-blocking) and cached:
- TS: `entitlementStore` (zustand) for UI; persisted to localStorage under `plethora-entitlements` with `fetchedAt`.
- Rust: `EntitlementCache` (RwLock) persisted in the `settings` KV table (`plethora.entitlements`), because background workers (semantic indexer, TTS job runner) must check capabilities without frontend involvement.
- Refresh triggers: app focus, after auth events, after billing events, manual, TTL (default 15 min when online; snapshot also carries server `expiresAt`).

### D3 — Offline grace
If the cached snapshot is stale/expired and the server is unreachable, the snapshot stays active for a **grace window (default 72h)** with `source: "grace"`. After grace, *cloud* capabilities degrade to their local fallback (defined per capability); local reading/review are unaffected regardless. Revocation while online takes effect within one refresh.

### D4 — Free-tier floor is structural
The registry entry for every capability carries `localFallback`. Feature proposals must implement the fallback, making "app useless when unsubscribed/offline" structurally impossible. An architecture test enforces that reader/review core stores never import entitlements at all.

### D5 — Quotas are server-authoritative, client-advisory
`QuotaState { used, limit, window, resetsAt }` renders in UI; enforcement happens server-side (proposal 5). Client-side pre-flight checks avoid wasted work but are never the enforcement boundary.

### D6 — Local dev grants
`settings.plethora.overrides: Record<CapabilityId, boolean>` (dev/beta/promo codes redeemed locally) resolve *above* the server snapshot for capabilities the server marks overridable — sufficient for developing Pro UX without backend, and for future promo grants.

## Module layout

```
src-tauri/src/entitlements/
  mod.rs        // CapabilityId registry (mirror of TS), EntitlementCache, commands
  snapshot.rs   // EntitlementSnapshot/CapabilityState/QuotaState serde types
src/types/entitlements.ts      // canonical registry + types (TS source of truth for UI)
src/stores/entitlementStore.ts // resolution order, cache, TTL, events
src/hooks/useCapability.ts
src/components/common/CapabilityGate.tsx
src/config/product.ts          // plan defaults, env, deep-link constants
```

## Resolution algorithm (client)

```
resolve(cap):
  if override[cap] defined -> override
  else if snapshot && (fresh || within grace) -> snapshot[cap]
  else -> freeDefaults[cap]
CapabilityState = { enabled, reason?, quota? }
reason ∈ { "plan", "signed_out", "offline", "quota_exhausted", "region", "unavailable" }
```

## Data changes
- No SQLite migration (settings KV reuse). Settings store version 6 → 7 adds optional `plethora: { overrides }` section (additive, deep-merge safe).
- localStorage: new `plethora-entitlements` key (follows rebrand prefix contract).

## Relationship to servers
`entitlement_refresh` calls `GET /v1/entitlements` (contract owned by proposal 3, transport by proposal 5). This change ships with a built-in default snapshot generator (Free defaults) so it is fully functional standalone.

## Testing strategy
- Pure-unit resolution tests (order, grace, unknown-grants tolerance).
- Architecture invariant tests (import-graph assertions) — pattern already used by `src/__tests__/noRealtimeSync.test.ts`.
- Rust tests for cache persistence/precedence.
