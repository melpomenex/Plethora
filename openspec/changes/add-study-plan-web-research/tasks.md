## 1. Research boundary

- [x] 1.1 Replace the synthetic fetch fallback with live bounded Brave search and public-page capture; enforce the exact approved query, private/local destination and redirect refusal, byte/time/result limits, cancellation, and no hidden retries or library/learner data.
- [x] 1.2 Add the opt-in query review and disclosure UI in AI Knowledge Only plans, with clear decline, unavailable-provider, loading, offline/error, and saved-source states; ordinary generation, lessons, and retries must never invoke research.

## 2. Capture and verification

- [x] 2.1 Persist accepted evidence snapshots in app storage linked to the plan/version, expose their locator, revision and publisher for review/navigation, and keep fetched candidates distinct from accepted and verified support.
- [ ] 2.2 Validate claim and key support independently of search snippets and model output; test missing, contradictory, stale and forged evidence and verify failures stay visibly unverified.
- [x] 2.3 Let assessment questions cite accepted external snapshots and enforce explicit evidence review through the existing publication gate for new question/key/rubric revisions; preserve the trust status of prior attempts.

## 3. Integration verification

- [ ] 3.1 Exercise the complete Study Plans UI-to-provider-to-snapshot-to-assessment-publication path with controlled fixtures; verify offline failure, consent isolation, and that old attempts keep their original trust status.
