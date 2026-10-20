# Proposed amendment before task 0.4: native document privacy

Status: approved by the user on 2026-10-20; implementation in progress. Tasks 0.1–0.3 provide the
contract/schema foundation; no new capture/import entry or processing worker has
been enabled. Existing unrelated workspace changes are preserved.

## Newly verified gap

The proposal assumed existing document privacy flags were a durable source of
truth that session repositories/workers could reuse. Current source does not
support that assumption:

- `src/types/document.ts` exposes `isLocalOnly` and `isAiExcluded`, and
  `src/lib/ai/assistant/privacyGate.ts:107` checks them on frontend objects.
- `src-tauri/src/models/document.rs` has neither field on Document nor
  DocumentMetadata, and no unknown-field preservation for them. Searches of
  `src-tauri/src/` find no native use of either camelCase or snake_case spelling.
- `src-tauri/src/database/repository.rs:776`, `create_document_tx`, creates the
  document/tree node and unconditionally calls `journal_entity` with its document
  payload. The proposed session creation must reuse this domain helper, but it
  cannot claim authoritative privacy enforcement by reading missing native flags.

This is a source finding, not a claim that audio was observed leaving a device.
No source upload, capture or production database mutation was performed here.

## Recommended concrete change

Insert task **0.3a — persist and enforce document privacy for session sources**
before0.4, and add it as a dependency of0.10/0.11/4.4/4.6:

1. Add authoritative `documents.is_local_only` and `documents.is_ai_excluded`
   booleans through an additive migration. Extend Rust Document/metadata mapping,
   frontend/native DTO round trips, backup and sync payload handling coherently.
   Keep one document policy rather than a competing recording-session privacy flag.
2. Preserve explicit existing frontend restrictions during reconciliation. An
   absent cached value must never overwrite a durable true value. New recording
   sessions default local-only until the user authorizes a remote processing/sync
   choice. Do not pretend old flags dropped before this change can be recovered.
3. Make session creation and source policy persistence atomic through the existing
   document transaction helper. Enforce local-only before source data is journaled
   for remote sync; guard native indexing and every session processing dispatch
   against the current document policy. AI exclusion blocks inference/indexing,
   while local-only permits verified local processing and blocks remote egress.
4. Define explicit restriction changes: revoking remote eligibility prevents new
   dispatch and removes/revokes pending source uploads; it does not claim to erase
   material already delivered remotely. Accepted derived items inherit applicable
   restrictions and remain readable locally. No scheduler/history rewrite.
5. Add native SQL/serialization tests and TS bridge tests for create→restart→read,
   local-only sync-outbox exclusion, AI-excluded indexing, stale-client policy
   reconciliation and denied/offline/missing-consent worker dispatch.

Affected shared boundaries: `models/document.rs`, document repository row and
transaction helpers, sync payload/journal eligibility, canonical indexing,
document API/store privacy round trips and backup. This is wider than merely
adding recording API wrappers, so it should be explicitly reflected in design,
tasks and privacy scenarios before implementing0.4.

## Safe state until enforcement is verified

Keep the new entry points and workers unregistered/unexposed. Retain completed
fixtures and inactive schema changes. Do not represent a source as private based
only on an in-memory field, do not create a duplicate per-session policy to hide
the persistence gap, and do not alter concurrent AI/readiness/reader work to make
the global checks green.
