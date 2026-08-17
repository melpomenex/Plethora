# Implementation Tasks

## 1. Interface-first (unblocks proposals 3–5 in parallel)
- [ ] 1.1 `src/types/entitlements.ts`: CapabilityId registry + EntitlementSnapshot/CapabilityState/QuotaState types + free defaults
- [ ] 1.2 Rust mirror `src-tauri/src/entitlements/{mod,snapshot}.rs` + parity test
- [ ] 1.3 `entitlementStore.ts` skeleton with resolution order + persistence (`plethora-entitlements`)
- [ ] 1.4 Contract note in `openspec/planning/plethora-transformation-roadmap.md` cross-referenced from proposals 3/5

## 2. Rust service
- [ ] 2.1 `EntitlementCache` (RwLock + settings KV persistence) + TTL/grace logic
- [ ] 2.2 Commands `entitlement_get_snapshot`, `entitlement_refresh` (server transport stub → real in proposal 3), `entitlement_override_set/clear`
- [ ] 2.3 Register in `lib.rs`; unit tests (persistence, precedence, unknown-grant tolerance)

## 3. Frontend plumbing
- [ ] 3.1 `useCapability` hook + `CapabilityGate` + quota meter primitives (unstyled)
- [ ] 3.2 `src/config/product.ts` (plan defaults, `PLETHORA_API_URL`/`VITE_PLETHORA_API_URL`, deep-link constants `plethora://`)
- [ ] 3.3 Settings v6→v7: optional `plethora.overrides` section (deep-merge safe) + migration test
- [ ] 3.4 `UserProfilePanel.tsx` consumes snapshot (replaces stub tier badge)

## 4. Guardrails
- [ ] 4.1 Architecture invariant test: viewer/pages/core stores import no entitlements
- [ ] 4.2 Capability display names in 6 locales (append-only)

## 5. Validation
- [ ] 5.1 `npm run test:run`, `cargo test --lib`, `npm run build:check`, `npm run bench:check`
- [ ] 5.2 Manual: anonymous cold start identical to pre-change behavior (no new dialogs/network failures offline)
