# Design: Smart Organization of Browser Extension Imports

## Context

The repository has one mature Smart Tagging implementation, but its queue is document-shaped and in-memory. Browser capture is native-Rust-led: `browser_sync_server.rs` writes documents, extracts, and learning items directly, then emits save events. The frontend currently listens to the document event only to reload and toast. Browser payloads contain raw context, but the shape and budget are not suitable as a stable classifier contract. Existing operational labels are also mixed into semantic tags.

The design therefore separates four concerns: durable capture, bounded evidence, canonical classification, and user review. The browser endpoint must remain fast and safe even when the frontend is suspended or no LLM is configured.

## Goals / Non-Goals

### Goals

- Organize every browser-created target type through the existing canonical classifier and policy.
- Preserve the semantic taxonomy as user-facing content while retaining complete capture provenance separately.
- Make source context useful for child items without copying stale or irrelevant source tags.
- Recover from event loss, retries, offline operation, and partial extension versions.
- Give users a fast virtual review workflow with explicit authority over every final tag.
- Keep the protocol bounded, local-first, and backwards-compatible with older extension payloads.

### Non-Goals

- Replacing or retraining the Smart Tagging model, taxonomy, or confidence policy.
- Making browser saves synchronous with an LLM, embedding generation, or review UI.
- Building a mandatory inbox, a new browser sync transport, or a cloud tagging service.
- Automatically rewriting every historical browser import in the first release.
- Rebuilding audio playback, media sessions, or any native lock-screen behavior.

## Decisions

### 1. Use a shared typed target contract

Add a `SmartTagTarget`/organization envelope with `targetType` (`document`, `extract`, `learning-item`), target ID, optional `documentId`/`extractId`, semantic input fields, capture provenance, and a stable content/source fingerprint. Keep the public queue API compatible with `runSmartTagging(documentId)` while adding target-aware scheduling underneath. The target adapter reads and writes each existing model through its existing API rather than creating a parallel tag store.

The browser server marks a newly saved target with `organization.status = queued` and emits a typed save event containing the target identity and context summary. A Tauri-side frontend listener schedules it. On startup and after browser-sync refresh, a reconciliation query finds browser-created targets still marked `queued`, `running` past lease expiry, or missing an organization result and schedules them. This metadata-based recovery avoids a new job table while making WebView event loss recoverable.

### 2. Define a bounded capture-context envelope

The extension adds optional structured fields while retaining the existing `context` string for compatibility. The envelope contains page title, canonical URL/domain, author, heading path, bounded surrounding text, caption/alt text, content kind, selector/range when useful, source document ID, and source semantic tags when known. The content script extracts only the nearest relevant heading/paragraph context; the background script enforces a total budget before transport; Rust validates lengths, URL/origin, and request size again.

The classifier context builder treats all browser text as untrusted evidence. It caps each field and the total serialized context, removes control noise, and never permits captured instructions to alter tagging policy or user settings.

### 3. Reuse canonical classification and make inheritance evidence-based

The target adapter calls the existing baseline candidate retrieval, normalization, domain signatures, policy, and Tier 2 task path. For a child item, evidence is ranked: item title/question/answer, nearby selection text and heading path, source document title/author/domain, then source tags. Source tags are candidate evidence, not a copy set. A tag is inherited only when it survives canonicalization, policy, duplicate checks, and a relevance/confidence decision; provenance records `source-inherited` separately from `smart-local` and `smart-llm`.

### 4. Separate operational provenance from semantic tags

New browser-created records store a typed `captureProvenance` and `organization` object in the model’s existing JSON field: source, item type, source URL, captured time, source document ID, extension/schema version, and organization status/reason. Explicit payload tags are written as manual tags. Known generated labels are no longer emitted as semantic tags on the new path; old records remain readable and are not silently rewritten. A later explicit cleanup can migrate only unambiguous generated labels.

### 5. Make review virtual and provenance-preserving

Reviewability is derived from organization status, confidence band, unresolved conflicts, and user correction state. The view queries documents, extracts, and learning items rather than moving them into a separate inbox. Actions call the existing tag-editing primitives, write manual provenance or dismissed tombstones, and clear only the relevant review reason. Bulk actions use the same per-item authorization checks and are idempotent.

### 6. Keep the browser path asynchronous and local-first

The Rust save handler commits the capture before scheduling organization. Local baseline tagging can run without an LLM. If Tier 2 is disabled, offline, rate-limited, or fails, the item remains saved with a deterministic result or an explicit reviewable state. The queue is bounded and deduplicated by target plus fingerprint; user edits win over late classifier output.

### 7. Treat preference learning as an optional deterministic phase

If enabled after the core workflow is stable, repeated explicit corrections and accepted suggestions create user-visible aliases or preference hints in a local store. The memory is applied only after canonicalization and confidence policy, never learns from silent non-action, never changes the global taxonomy, and has reset/export semantics. If the signal volume or UX is insufficient, the capability is left feature-gated and documented rather than silently enabled.

## Risks / Trade-offs

- A browser event can still arrive before the frontend listener is ready. Status-based reconciliation reduces loss but adds a scan on startup and requires a clear lease/terminal-state contract.
- Source tags may be stale or overly broad. Ranking them behind item-local evidence and recording inheritance provenance makes the trade-off visible and reversible.
- Removing operational tags can surprise code that currently filters on them. The first release should keep a compatibility reader and migrate only new writes; a cleanup command can be explicit.
- More context improves relevance but increases payload and privacy exposure. Field caps, total budgets, local processing, and redaction of unnecessary page text are mandatory.
- Multiple model stores make atomic cross-record updates difficult. Each target is updated independently and reconciled by stable identity; no cross-target transaction is required.
- Preference memory can amplify a mistaken correction. It is optional, evidence-thresholded, user-resettable, and never allowed to override a manual tag or dismissal.

## Migration Plan

1. Add optional metadata/context fields and readers; older extension payloads continue to save normally.
2. Add target-aware queueing and event/reconciliation without changing existing document Smart Tagging behavior.
3. Change new browser writes to structured provenance and add the virtual review query/actions.
4. Add compatibility display/filtering for historical operational labels; offer any migration as an explicit user action.
5. Enable deterministic preference memory only after the core acceptance suite passes, behind a setting/feature flag.

Rollback is additive: disabling the organizer leaves saved records and existing semantic tags intact, and queued status can be ignored by older clients.

## Open Questions

- Should the reconciliation scan use a new native list command or extend existing document/extract/learning-item list APIs?
- Where should the cross-item virtual view live in the current navigation: a dedicated view, command-palette route, or both?
- Should optional preference aliases live in settings JSON or a small local table with explicit reset/export support?
- Can the browser extension resolve a stable source document ID, or should the native server resolve it from canonical URL/title before persistence?
