## 1. Research boundary

- [x] 1.1 Verify the model-only prerequisite and implement a separately authorized bounded search/fetch adapter; test the exact transmitted query, refused private/local destinations and redirects, cancellation, quota and absence of hidden retries or library/learner data.
- [x] 1.2 Add optional query preview, endpoint and price/budget disclosure with clear decline/off/error states; verify that ordinary plan generation, lesson and retry never invoke research without separate approval.

## 2. Capture and verification

- [x] 2.1 Persist accepted external evidence snapshots with locator, revision and publisher; test link changes, missing sources, reference navigation and separation of fetched candidates from verified support.
- [x] 2.2 Validate claim and key support independently of search snippets and model output; test missing, contradictory, stale and forged evidence and verify failures stay visibly unverified.
- [x] 2.3 Implement the explicit draft-to-publication path for newly verified question/key/rubric revisions through the existing exam gate; verify prior unverified results retain their original status across reload/export.

## 3. Integration verification

- [x] 3.1 Exercise opt-in, offline failure and successful source verification end to end with controlled fixtures; run privacy and assessment regressions and `npm run bench:check`, and record observed endpoints and blocked cases.
