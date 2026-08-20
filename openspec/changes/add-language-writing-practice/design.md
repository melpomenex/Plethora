## Context

Existing AI provider/streaming APIs and document Q&A can provide correction, while profiles/lexicon/knowledge states supply target words and level. Writing output should be stored as a practice artifact with source/prompt provenance, not as a generic document unless the user saves it.

## Dependencies

- Hard: #1–#4, #17, and existing AI/provider/session contracts.
- Soft: #7, #10, #11, #9, and #20.
- Freeze learner context, correction schema, active-evidence acceptance, and SRS handoff with #17/#11 before implementing shared practice UI.

## Goals / Non-Goals

**Goals:**

- Prompt production from user-selected content/interests and current vocabulary.
- Offer useful, configurable corrections and preserve learner text.
- Record active evidence and make follow-up explicit.

**Non-Goals:**

- Automated grading as objective truth, hidden rewriting, or a language course.
- Sending writing to cloud providers without consent.

## Decisions

1. **Practice artifact.** Store profile, prompt/source anchor, learner text, correction mode, provider/model/version, correction result, timestamps, and evidence decisions. Draft autosave is local/durable per existing pattern.
2. **Correction output schema.** Require learner text, minimal correction, natural alternative (optional), categorized spans/issues, explanations, confidence, and source/provider provenance; plain text fallback remains valid.
3. **Tutor/context reuse.** Use learner-aware tutor context builder and provider registry, with bounded document/lexicon context and explicit cloud consent.
4. **Active evidence requires signal.** A correction/acceptance or explicit self-assessment can add production evidence; merely displaying generated feedback does not mark a word produced successfully.
5. **SRS handoff is explicit.** Offer to memorize a troublesome production error through the shared SRS draft flow; never auto-create cards.

## Risks / Trade-offs

- [Detailed correction overwhelms] → Default important/minimal by profile and let users expand.
- [Models overcorrect stylistic choices] → Label register/naturalness separately, show alternatives, and allow dismiss.
- [Sensitive writing] → Local/BYO first, per-session opt-out, minimal retention/delete/export.
- [Active evidence false positives] → Require learner acceptance/assessment and retain correction confidence/source.

## Migration Plan

1. Add local writing draft/session and prompt modes.
2. Add AI correction through tutor context/provider contract.
3. Add evidence/analytics/SRS handoff and source-specific prompts.

## Open Questions

- Whether to support document-level writing artifacts in Queue.
- How to evaluate active evidence from teacher/model feedback versus learner self-acceptance.
- Default correction language/base-language behavior for bilingual explanations.
