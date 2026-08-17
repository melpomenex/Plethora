# Change: Establish Plethora Commercial Product Foundation

> Wave 1 — Commercial Foundation. Depends on `rebrand-incrementum-to-plethora` (naming/prefixes). This change owns the **capability entitlement architecture** that every other Plethora proposal consumes.

## Why

Plethora splits into **Free** (an unusually capable local-first app: all reading, extraction, scheduling, review, local AI/TTS/transcription, BYO-key AI, local backups) and **Pro** (continuously-maintained cloud services, expensive computation, sync, premium intelligence). The monetization philosophy is: **do not paywall reading; paywall augmentation**.

Today the codebase has *no* product-tier concept beyond two fragments: the Express server's `users.subscription_tier` column (default `'free'`, `server/src/db/schema.ts`) and a stub "Upgrade to Pro" panel in `src/components/settings/UserProfilePanel.tsx`. If every feature checked `isPro` directly, we would get scattered booleans that cannot express trials, grants, grandfathering, tier differences, or offline grace. This change establishes a **capability-entitlement architecture** — a centralized registry + resolution service — and wires product configuration, without implementing any paid feature itself.

## What exists today
- `UserProfilePanel.tsx` (email, tier badge, logout, upgrade stub), `LoginModal.tsx`, `src/lib/sync-client.ts` (JWT login/register/verify against `VITE_API_URL || /api`).
- Server: `users.subscription_tier` text column; no entitlement logic.
- Feature-flag precedent: `settings.features` in `settingsStore.ts` (e.g. `selectionInteractionV2`) — local, user-togglable; good UX pattern to reuse for *local* capabilities, but not a monetization system.
- Settings architecture: `settingsStore.ts` (zustand persist v6, deep-merge rehydration), `src/config/defaultSettings.ts`; `src/utils/settingsValidation.ts` is vestigial (no zod).
- No capability registry, no quota model, no environment configuration for a commercial backend.

## What Changes

### 1. Capability registry (single source of truth)
New module `src-tauri/src/entitlements/` + mirrored TS constants in `src/types/entitlements.ts`:
- `CapabilityId` — canonical string enum: `cloud_sync`, `cloud_backup`, `library_intelligence`, `semantic_connections`, `knowledge_graph`, `knowledge_gap_detection`, `adaptive_learning_paths`, `ai_tutoring`, `enhanced_card_generation`, `card_optimizer`, `advanced_analytics`, `cloud_document_processing`, `premium_tts`, `transcription` (Plethora-hosted cloud transcription; local whisper/sherpa stays ungated), `web_capture`, `integrations`, `automation`, `api_access`.
- Each capability declares: id, default plan (free/pro), whether it requires an account, whether it has quotas, and a **local-fallback descriptor** (what still works without it — every capability must degrade to useful Free behavior, never to breakage of reading/review).

### 2. Entitlement resolution service (client)
- `src/stores/entitlementStore.ts` (zustand): holds `EntitlementSnapshot { accountId?, plan, capabilities: Record<CapabilityId, CapabilityState>, fetchedAt, source }` where `CapabilityState = { enabled, reason?, quota?: QuotaState }`.
- Resolution order: **local grants (dev/beta/promo overrides) → cached server snapshot → plan defaults (offline)**. Anonymous users resolve to Free defaults; **nothing about opening/reading local content ever consults entitlements.**
- `useCapability(capabilityId)` hook + `<CapabilityGate capability=… fallback=…>` component for contextual UX (see proposal 21 for the UX surfaces themselves).
- Rust side: `entitlements/mod.rs` with `EntitlementCache` (RwLock, persisted to `settings` KV under `plethora.entitlements`), commands `entitlement_get_snapshot`, `entitlement_refresh`, `entitlement_override_set/clear` (local dev grants), so background Rust workers (indexing, TTS jobs) can check capabilities without IPC round-trips.

### 3. Product configuration & environments
- `src/config/product.ts`: product name, plan display names, storefront config, **capability→plan defaults**, quota defaults (numbers live server-side; this is only offline fallback).
- Environment config: `PLETHORA_API_URL` (Vite `VITE_PLETHORA_API_URL` + Tauri build-time), default `https://api.plethora.app` (placeholder — flagged), with `off`/unreachable treated as "Free defaults, cloud features show unavailable-with-reason".
- Tauri deep-link capability declaration groundwork (custom scheme `plethora://` for OAuth callbacks and store flows — none exists today; `src/routes/auth-callback.tsx` exists for the web localhost:15173 redirect path).

### 4. Entitlement-aware UX infrastructure (plumbing only)
- `CapabilityGate`, `useCapability`, quota meter component primitives (dumb components; proposal 21 styles/places them).
- Extension points: `registerCapabilitySurface(id, {capability, context})` registry so feature teams declare where capabilities surface (for discovery UX later) without coupling.

### 5. Plan model (v1: Free + Pro)
- `PlanId = "free" | "pro"` with forward-compatible grants model: server may return arbitrary capability grants (trials, promo, grandfathered, admin) — the client must render unknown plans/grants gracefully (never `isPro === true` checks).

## Impact

### Affected Specs
- `plethora-entitlements` — New (registry, resolution, offline behavior, no-reading-gate invariant).
- `product-configuration` — New (env config, plan defaults, deep-link groundwork).

### Affected Code Areas
- New: `src-tauri/src/entitlements/`, `src/types/entitlements.ts`, `src/stores/entitlementStore.ts`, `src/hooks/useCapability.ts`, `src/components/common/CapabilityGate.tsx`, `src/config/product.ts`.
- Modified: `src-tauri/src/lib.rs` (manage state + register ~5 commands), `src/stores/index.ts`, `src/components/settings/UserProfilePanel.tsx` (consume snapshot instead of stub), `src/types/settings.ts` (dev overrides under `settings.features` or a new `plethora` section), i18n (6 locales) for capability display names.
- Untouched: all reader/review/scheduling code paths (invariant below).

### Non-goals
- No accounts/auth (proposal 3), no billing (proposal 4), no cloud client (proposal 5), no paywall UX design (proposal 21), no quotas *enforcement* (server-side, proposal 5) — this change defines the contracts they implement.
- No gating of any existing feature.

## Dependencies

### Hard dependencies
- `rebrand-incrementum-to-plethora` (naming, config prefixes).

### Soft dependencies
- Proposal 3 implements `entitlement_refresh` against a real server; until then the store resolves from defaults.

### May run concurrently
- Proposals 3 and 5, **after** the interface-first tasks here land (registry + snapshot types + store skeleton in the first commit).

### Must not start yet
- All capability-*consuming* feature proposals (7–20) until this lands.

## Shared interfaces (owned here — other proposals consume)
- `CapabilityId` registry (list above is canonical; additions require updating this proposal's spec).
- `EntitlementSnapshot` / `CapabilityState` / `QuotaState { used, limit, window, resetsAt }` types.
- Commands `entitlement_get_snapshot`, `entitlement_refresh`; hook `useCapability`; component `CapabilityGate`.
- `src/config/product.ts` + `PLETHORA_API_URL` environment contract.

## Ownership boundaries
- **May modify**: new entitlement modules, `UserProfilePanel`, settings types (additive), `lib.rs` registration block, i18n keys.
- **Must treat as external**: reader/viewer/review components (must not need modification — if a feature proposal wants to edit them, it does so itself), server code (proposal 3/5 own `server/`).

## Collision risks
- `src-tauri/src/lib.rs` command registration (every proposal appends; land registration as one focused commit), `settingsStore.ts`/`src/types/settings.ts`, locale files (append-only discipline).

## Integration contract
- Consumers (proposals 3–21) MUST gate on `useCapability(id)` / Rust `EntitlementCache`, never on plan strings; they receive `CapabilityState { enabled, reason, quota }` and must render a reason when disabled (e.g. `signed_out`, `offline`, `quota_exhausted`, `plan`).

## Testing & acceptance

### Tests
- Unit (TS): resolution order (local grant > cached server > defaults); anonymous → Free defaults; unknown plan/grants render without throwing; snapshot cache persistence + TTL.
- Unit (Rust): `EntitlementCache` persistence, default resolution, override precedence.
- **Invariant test** (critical): a test asserting no module under `src/components/viewer`, `src/pages`, `src/stores/{documentStore,queueStore,reviewStore}` imports the entitlement store — reading/review never consult entitlements.
- Migration test: settings v6 → v7 (new `plethora` section) with deep-merge preservation.

### Acceptance criteria
- A fresh anonymous install behaves identically to today (no dialogs, no cloud calls beyond a lazy optional check).
- Dev override can grant any capability locally (for testing Pro UX without a server).
- `CapabilityGate` renders fallback content when a capability is disabled; quota primitives display `QuotaState`.

### Must remain unchanged
- All existing behavior with no network; existing tests/gates/benchmarks.

## Open questions
1. Final API domain (placeholder `api.plethora.app`).
2. Whether Free tier gets *any* included monthly cloud allowance (e.g. small transcription quota) — plan-default quota numbers deferred to product pricing decisions (server-authoritative anyway).
