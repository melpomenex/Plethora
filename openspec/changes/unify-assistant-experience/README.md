# Unified Plethora Assistant proposal

Change: `unify-assistant-experience`. Planning status: 4/4 artifacts complete; strict validation passed. Implementation: **38/56 tasks complete** (Phases 0–3 done; Phases 4–6 implemented where verifiable in this environment; Phases 7–8 remainder annotated with concrete gates), with 18 tasks annotated OUTSTANDING/PARTIAL and reasons in [tasks.md](tasks.md). All rollout flags (`assistantCanonicalConversations`, `assistantContextAttachments`, `assistantCitationParity`, `assistantUnifiedSelectionEntry`, `assistantTurnStreaming`, `assistantConversationSync`) remain default-off. Audit: original HEAD `70915a122cc0a17bd49e098fbea7e5e41e70d379`; unrelated work moved HEAD to `42510d8cfb9aea18408a24e5fa6c4cc46163018e` during writing, with relevant boundary comparison recorded in the audit. No production source edits were made by this proposal task.

## Artifact index

- [proposal.md](proposal.md): problem, outcomes, capabilities, scope and impact.
- [audit.md](audit.md): current runtime/storage paths, confirmed gaps A1–A10, flags, corrected older findings, evidence limits and the task-0.2 implementation recheck ledger.
- [baseline.md](baseline.md): task-0.3 recording protocol, verified environment facts and provider/OS/WebView capability matrix.
- [fixtures/README.md](fixtures/README.md): task-0.4 legacy storage fixture corpus (generator, manifest, shapes).
- [design.md](design.md): canonical ownership/data, routing, context budgets/privacy, citations/navigation, presentation, streaming, encrypted sync, migration and rollback.
- [tasks.md](tasks.md): 56 dependency-ordered tasks, each with verification and staged rollout gates.
- [validation.md](validation.md): 30 complete user journeys, platform/test layers, proposed measurement budgets, actual proposal verification and the 2026-10-17 implementation session ledger (commands + results + outstanding gates).
- [baseline.md](baseline.md): recording protocol, verified environment facts, provider/OS/WebView capability matrix.
- [reconciliation.md](reconciliation.md): exact follow-on requirement replacements and ownership/landing order for unarchived predecessor capabilities.
- [.openspec.yaml](.openspec.yaml): generated change metadata.

## Specification deltas

- [assistant-conversation-lifecycle](specs/assistant-conversation-lifecycle/spec.md): new durable lifecycle, migration, turn control, performance and learning-action contract.
- [assistant-context-routing](specs/assistant-context-routing/spec.md): new attachment/restriction/position/history/authorization contract.
- [document-qa-workspace](specs/document-qa-workspace/spec.md): same-conversation expansion, palette handoff and desktop continuity.
- [selection-aware-assistant](specs/selection-aware-assistant/spec.md): durable selection handoff and edited-passage provenance.
- [library-qa](specs/library-qa/spec.md): source policy and shared inline citations with exact navigation/return.
- [ai-library-rag](specs/ai-library-rag/spec.md): evidence preservation and fail-closed retrieval/privacy boundaries.
- [mobile-ask-sheet](specs/mobile-ask-sheet/spec.md): existing-host consolidation, partial/expanded behavior, native navigation and dictation.
- [plethora-sync](specs/plethora-sync/spec.md): eligible encrypted conversation replication and deterministic conflicts.

## Verification and next step

`openspec validate unify-assistant-experience --strict` passes. `openspec status --change unify-assistant-experience` reports 4/4 planning artifacts complete. Existing focused audit tests passed: 17 files / 205 tests; these are not feature acceptance tests. See validation.md for exact commands and remaining native/provider/performance gates.

Run `/opsx:apply unify-assistant-experience` or ask to implement. Begin with task 0.1's predecessor reconciliation and source/baseline recheck; do not implement an old competing session/Yjs plan.
