## Context

Knowledge policy introduces a distinct source-free execution path and an unverified self-check. Study Web Research extends that path with a separate trust and consent boundary; a Document Q&A research preference cannot authorize it.

## Goals / Non-Goals

**Goals:** Keep network access scoped to a reviewed request and make externally supported claims and answer keys reproducible.

**Non-Goals:** Autonomous browsing, sending selected library contents or prior answers, or treating search snippets/model output as verified.

## Decisions

1. **Authorize bounded queries explicitly.** Show editable query, destinations, budget and disclosure before sending. Use a constrained search/fetch adapter separate from ordinary model tasks. The request contains only the approved query and required provider metadata; do not include library data, learner responses, transcripts or credentials. Bound fetches, bytes, time, redirects and retries. Reject disallowed destinations and private/local addresses, including after redirect; fetched text is untrusted data.
2. **Separate candidates, accepted sources and verified claims.** Store accepted snapshots with canonical URL, publisher, fetch time, revision/hash, locator and bounded excerpt. Validate reference identity and actual support; show uncertainty and conflicting evidence, and link to the pinned excerpt and live page distinctly. Page changes require explicit revalidation for new use; historical citations remain revisioned. A failed fetch leaves the model-only preview usable.
3. **Reuse the existing exam publication gate.** For a user-requested verification draft, adapt independently verified external evidence to the same validation requirements for question text, key and rubric; resolve each reference to the pinned source. Require explicit review and a newly committed revision. If a required item lacks supported authority or the source is disputed, block verified publication. Never promote an existing attempt or rewrite its trust.

## Risks / Trade-offs

- [Unexpected transmission] → Verify exact outgoing payload and endpoint on every new run or resumed search; turning off Research prevents further fetches.
- [Link rot and low-quality sources] → Keep revisioned snapshots, enforce verification separately from acceptance, and use unverified status when evidence is insufficient.
- [Unbounded dependency cost] → Reuse an existing eligible search adapter where it satisfies request isolation and budgets; require capability checks and fail with an actionable state otherwise.

## Migration Plan

Roll out disabled by default. No migration of existing model-only plans is needed. Turning off the feature preserves accepted snapshots and historical assessment provenance while disabling new network actions.
