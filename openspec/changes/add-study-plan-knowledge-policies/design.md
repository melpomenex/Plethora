## Context

`CurriculumGenerator.tsx` sends `source-only`; `curriculumValidation.ts` unconditionally validates a library scope. Native plan versions currently store scope JSON, while the publisher validates grounded nodes and their current refs. The C1–C8 [Shared Contracts](../../planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md) require nonempty frozen library scopes. The assessment builder already uses its own versioned source and scoring contracts.

## Goals / Non-Goals

**Goals:** Make invalid combinations unrepresentable at the request boundary, enforce the same authority in the native write/publish path, and preserve the existing source-backed behavior.

**Non-Goals:** Web fetch, durable tutor UI, changes to global concept authority, and a new assessment engine.

## Decisions

1. **Persist authority on each plan version.** Use a tagged union: `source-only` or `source-plus-model-knowledge` with a nonempty frozen scope; `model-only` with no library scope; and a separate manual-without-sources variant with no AI policy. Model-only is never encoded as an empty library filter. Keep authoring method separate; only source outline requires material by construction. Existing explicit values win; legacy source-backed versions without a stored policy keep source-only curriculum behavior, while separately pinned job/assessment policies remain unchanged. An existing version never adopts a new-plan default.
2. **Branch before source preparation.** Preserve the bounded retrieval/hydration/verification pipeline for library modes, with policy-aware structured output. Register a separate model-only task accepting goal, depth, and permitted plan text only. It cannot access library retrieval, embeddings, or search. Both branches share strict DAG validation, stable IDs, expected-head checks, bounded jobs, and editable accept/publish preview. Store the authority discriminant and consented route in job identity/checkpoints.
3. **Validate provenance at the output boundary.** Separate factual claim blocks from non-factual prompts. Use explicit kinds for verified library claims, model supplements, unverified model output, and user-authored text. Resolve library handles to selected, eligible revisions and exact locators; check actual support before assigning the verified label. Reject forged support and show material gaps, visibly attributed conflicts, and stale refs; a ref that opens is not proof that the passage supports the claim. Keep superseded snapshots and prior attempts immutable.
4. **Separate structural validity and assessment trust.** Reuse practice attempts with an explicit unverified trust variant and score display. A plausible key, second model opinion, or lack of hints cannot satisfy independent verification. Unverified results cannot enter demonstrated evidence or a verified exam. “Add sources and verify” makes a new source-backed plan/question draft and uses the existing verified publication path; it never relabels history.
5. **Use one preflight contract across AI actions.** Reuse generation preflight to disclose exact model/provider, separate inference and embedding endpoints, estimates or unavailable state, maximum budget, and actual usage. Check excluded/local-only policy, capabilities, quota, consent and route again before preparation/transmission and each explicit retry/resume. Changing authority creates a reviewable version; changing a route requires fresh preflight without altering authority. Preserve the draft on failure or refusal.

## Risks / Trade-offs

- [Compatibility] → Snapshot and round-trip legacy published versions, jobs and attempt revisions; use policy-specific fixtures at TS and native boundaries.
- [False confidence] → Keep missing support distinct from supplement and unverified content. Reject ambiguous claims conservatively and expose an actionable recovery.
- [Archive overlap] → The adaptive-learning-paths delta includes the existing C2 ordering constraints. Coordinate archive order with C1–C8; refresh overlapping requirements against the merged baseline before archiving this change.

## Migration Plan

Record the amended contract as a versioned companion to the current Shared Contracts before code changes. Add backward-compatible readers before writing new variants; gate new creation if needed during rollout. Disabling new creation leaves versions, drafts and attempts readable; never rewrite old data to simulate rollback.
