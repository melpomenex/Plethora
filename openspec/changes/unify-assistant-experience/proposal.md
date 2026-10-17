## Why

Plethora already shares an Assistant turn engine, but readers still encounter separate histories and inconsistent source behavior across its sidebar, research workspace, selection sheet, and PWA. Consolidating conversation ownership and evidence handling will let readers ask naturally, inspect trustworthy sources, and continue the same discussion across layouts and supported devices without understanding AI internals.

## What Changes

- Introduce one versioned conversation repository and turn controller, retaining responsive sidebar, workspace, and mobile presentations. Make Document Q&A the expanded research presentation of that conversation while preserving its NotebookLM editor and study workflows.
- Replace mandatory top-level mode selection with visible, removable context attachments and secondary strict-source controls. Keep Chat, Document, and Library semantics; deterministic routing distinguishes optional context from an explicit restriction.
- Preserve structured citations, validated quotes, original reference numbers, exact locators, evidence coverage, and tool artifacts through every adapter and saved conversation. Provide claim-linked source inspection and reading-position return.
- Consolidate selection Ask into the existing global mobile host after parity gates, preserving deliberate gestures, overlay/Back ownership, compact composer, dictation, and reading flow. Adapt the optional PWA surface to the same contract.
- Reuse the existing `ai_conversations` / `ai_messages` database tables with additive schema extensions. Import raw legacy sidebar/Q&A records without existing retention caps; preserve drafts, attachments, saved responses, and rollback originals. Existing ephemeral selection/PWA state can be captured only while alive, not recovered after it was already discarded.
- Extend the existing encrypted Plethora Pro delta sync for eligible conversations, rather than restoring removed Yjs infrastructure. Keep local-only conversations local; show cross-device availability only after capability/enrollment checks and actual acknowledgment.
- Add capability-aware streaming, actual lifecycle events, transport-aware cancellation, retry identity, bounded context preparation, privacy revalidation, and measurable performance gates.

### Evidence and product outcomes

The [current-state audit](audit.md) is anchored to HEAD `70915a122cc0a17bd49e098fbea7e5e41e70d379` and identifies local working-tree differences. Confirmed defects include sidebar citation loss, its unfiltered Document RAG executor, selection citation loss after validation, incomplete citation numbering/locator preservation, fail-open missing metadata, and an empty conversation sync timer. Earlier claims that grounded Q&A sends no history or that Rust document filters still union FTS hits are no longer accurate.

Success means all 30 journeys in [validation.md](validation.md) pass: no silent broadening, no lost recoverable history/drafts, verified navigable citations on every supported presentation, stable thread identity during navigation, and responsive large-source interaction. Proposed latency targets are acceptance budgets, not measurements.

### Boundaries and relationships

This is a proposal only. It does not replace providers, indexing, viewers, the command registry, learning tools, or the app design system; add a voice-chat product; or redesign unrelated reader/navigation UI. Readwise's [document chat](https://docs.readwise.io/reader/guides/ghostreader/chat) and [Global Ghostreader](https://docs.readwise.io/reader/guides/ghostreader/global) inform the benchmark of reading flow, library conversation, and source links; this is not an interface clone or a claim of platform parity.

Build on `unify-assistant-conversation-and-video-context` and `update-mobile-assistant-composer`, both implemented but unarchived; coordinate remaining physical-device gates with `mobile-assistant-gesture-haptics`. Reuse the archived selection Ask, library-workspace, tool-reliability, RAG, and exact-navigation work. [audit.md](audit.md) records specification ownership and archive order so this change does not duplicate pending capability definitions.

## Capabilities

### New Capabilities

- `assistant-conversation-lifecycle`: Canonical IDs, durable drafts/messages/turns, surface-independent lifecycle, non-destructive migration, cancellation/retry, and progressive execution.
- `assistant-context-routing`: Deterministic attachment/restriction precedence, frozen source plans, general dialogue, position-aware planning, history reference resolution, and authorization.

### Modified Capabilities

- `document-qa-workspace`: Sidebar/workspace continuity and canonical palette handoffs, preserving existing research editing.
- `selection-aware-assistant`: Durable selection handoff and exact historical selection provenance.
- `library-qa`: Attachment-led scope semantics and shared citations across answer presentations.
- `ai-library-rag`: Validated citation identity/locators and fail-closed source eligibility throughout retrieval/generation.
- `mobile-ask-sheet`: Selection presentation through the existing global host with partial reading interaction, draft continuity, and native-input parity.
- `plethora-sync`: Encrypted, capability-gated canonical conversation replication with deterministic concurrent turns and privacy boundaries.
- `assistant-conversation-scopes`: Attachment-led presentation of the preserved Chat/Document/Library policies, replacing the superseded top-level mode buttons.

## Impact

Frontend: `src/components/assistant/`, `src/components/tabs/{DocumentQATab,useDocumentQaWorkspace,documentQaSessions,DocumentQASources}`, `src/features/documentQa/`, `src/stores/documentQAStore.ts`, `src/commandPalette/libraryAskHandoff.ts`, palette hosts, response rendering, selection entry points, viewer context publishers, and existing speech hooks. Shared engine changes stay under `src/lib/ai/assistant/` and existing task/retrieval adapters.

Native: additive database migrations and repository/command methods, plus `src-tauri/src/sync/{types,registry,journal,payload,wire,merge,bootstrap,full_state}` and existing encrypted transport. The existing server's `server/src/routes/v1/sync.ts` table-kind allowlist must accept the new encrypted entity families before rollout. No separate backend or new RAG index is proposed. Browser storage implements the same repository contract without claiming unsupported native sync.

Major risks are raw-data migration and quota failure, mixed-version sync, privacy changes affecting historical answers, provider capability differences, exact-location ambiguity, and native keyboard/gesture behavior. Additive storage, checkpointed import, independent rollout flags, explicit sync capability negotiation, and native-device acceptance gates bound those risks; see [design.md](design.md).
