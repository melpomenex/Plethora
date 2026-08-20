## Context

The app has `assistantContext`, AI provider abstractions, document Q&A/retrieval, on-device AI proposals, and adaptive tutoring. The language tutor should construct a compact state packet and retrieve relevant source/examples, then use the existing provider stream/persistence/error paths.

## Dependencies

- Hard: #1, #3, #4, and existing AI/provider/retrieval/assistant contracts.
- Soft: #7, #9, #10, #18, #22; direct coordination with `implement-plethora-teach-me-adaptive-ai-tutoring` and `add-ondevice-ai-learning-system`.
- Freeze `LearnerContextPacket`, provider/privacy, session, and correction contracts before #18/#22 modify AI context files.

## Goals / Non-Goals

**Goals:**

- Make tutor responses adapt to profile, real lexicon, current material, and interests.
- Keep lexical targeting approximate/configurable and corrections useful rather than overwhelming.
- Preserve source attribution and user control over cloud data.

**Non-Goals:**

- A fixed percentage promise, standalone language model, human tutors, social marketplace, or canned course tree.

## Decisions

1. **Versioned compact learner context.** Build a packet containing profile languages/level, sampled known/learning/difficult objects, current document/sentence, recent interests, activity summary, and context budgets. Use ranked samples and counts, never full lexicon dumps.
2. **Retrieval before generation.** Retrieve source passages/examples/grammar encounters and lexical candidates through existing indexing APIs; label library-grounded, generated, and general knowledge separately.
3. **Soft lexical target.** A configurable target band (for example approximately 95% familiar vocabulary) guides generation/retrieval; it is not a hard grammatical constraint and must be reported as an estimate.
4. **Correction policy.** Modes are minimal/meaning-blocking, important, and detailed. Output distinguishes grammar, morphology, spelling, word choice, register, unnatural phrasing, and meaning.
5. **Provider ladder/privacy.** Use local/on-device/BYO/hosted providers via existing registry, disclose data flow, cap context, cache safe artifacts, and offer opt-out. Core profile/lexicon works without AI.
6. **Session persistence.** Persist tutor conversation/session metadata and source references, not hidden prompts or unnecessary full learner dumps.

## Risks / Trade-offs

- [Context can expose sensitive library data] → Explicit scope/opt-out, minimum snippets, provider disclosure, and redaction settings.
- [Model ignores lexical target] → Validate/output telemetry as advisory, retrieve target words explicitly, and never claim guaranteed coverage.
- [Tutor duplicates existing AI] → Reuse assistant/provider/session components and specialize only context/routing.
- [Stale learner state] → Timestamp/version context and refresh selected samples per turn.

## Migration Plan

1. Add language tutor context builder and mode/session contract behind existing AI settings.
2. Add document/sentence entry points and profile-aware prompts/output validation.
3. Integrate active/passive evidence, writing, generation, and adaptive tutor flows.

## Open Questions

- Which learner-state fields are safe to sync into hosted tutor sessions.
- Default recent-content window and sample sizes per model context budget.
- Whether tutor conversations should be separate from generic assistant history.
