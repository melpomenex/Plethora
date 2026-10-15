## ADDED Requirements

### Requirement: Canonical capability registry exists
The system SHALL define a canonical capability registry mirroring `src/types/entitlements.ts` and `src-tauri/src/entitlements/mod.rs` with (at minimum) these ids: `cloud_sync`, `cloud_backup`, `library_intelligence`, `semantic_connections`, `knowledge_graph`, `knowledge_gap_detection`, `adaptive_learning_paths`, `ai_tutoring`, `enhanced_card_generation`, `card_optimizer`, `advanced_analytics`, `cloud_document_processing`, `premium_tts`, `transcription`, `web_capture`, `integrations`, `automation`, `api_access`. Each registry entry SHALL declare: default plan, account requirement, quota applicability, and a local-fallback descriptor. Additions to the registry SHALL be made in this spec's owning change or a spec modification.

#### Scenario: Registry parity between TS and Rust
- **WHEN** the TS and Rust registries are compared in a parity test
- **THEN** the sets of capability ids are identical

### Requirement: Entitlement snapshots resolve deterministically
The client SHALL resolve capability state in this precedence: (1) local overrides (`settings.plethora.overrides`), (2) a cached server `EntitlementSnapshot` that is fresh or within the offline grace window, (3) Free-plan defaults. Anonymous or offline users SHALL resolve to Free defaults without errors. Unknown plans or grants in a server snapshot SHALL NOT cause failures — unknown capabilities render as disabled with reason `unavailable`.

#### Scenario: Anonymous user gets Free defaults
- **WHEN** no account is signed in
- **THEN** every capability resolves per its Free default, and local reading/review functionality is unaffected

#### Scenario: Stale snapshot within grace remains active
- **WHEN** the device is offline and the cached snapshot is 48 hours old (grace default 72h)
- **THEN** cloud capabilities remain enabled with `source: "grace"`; after grace they degrade to their local fallback rather than erroring

### Requirement: Reading and review never consult entitlements
No module under the readers, viewers, queue, review-session, or scheduling core SHALL import the entitlement store or check capability state. This SHALL be enforced by an automated architecture test (import-graph assertion in the pattern of `src/__tests__/noRealtimeSync.test.ts`).

#### Scenario: Invariant test fails on violation
- **WHEN** a commit adds an entitlement import to `src/stores/reviewStore.ts` or `src/components/viewer/DocumentViewer.tsx`
- **THEN** the architecture test fails

### Requirement: Background workers can check capabilities in Rust
The Rust `EntitlementCache` SHALL persist the latest snapshot in the `settings` KV table and expose `entitlement_get_snapshot`, `entitlement_refresh`, and `entitlement_override_set/clear` commands so Rust background workers (indexers, job runners) can gate cloud work without frontend IPC.

#### Scenario: Indexer consults cache without UI
- **WHEN** a background worker calls the cache for `library_intelligence` while the UI is closed
- **THEN** it receives the same resolved state the UI would

### Requirement: Capability gating UX primitives exist
A `useCapability(capabilityId)` hook SHALL return `{ enabled, reason, quota }` and a `CapabilityGate` component SHALL render children when enabled and a fallback (with a machine-readable reason) when disabled. Feature components SHALL consume these primitives instead of plan checks; no production code SHALL branch on plan identity strings.

#### Scenario: Disabled capability renders fallback with reason
- **WHEN** `CapabilityGate` wraps a Pro feature while signed out
- **THEN** the fallback renders with reason `signed_out`, and no error is thrown for unknown capabilities
