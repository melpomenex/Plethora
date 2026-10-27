## Context

See `proposal.md`. `get_documents` routes both `browser-extension` and `share-target` to `Repository::list_capture_summaries`. The initial capture query identifies eligible IDs; the second query fetches summaries and passes each row to `Repository::row_to_document`. That mapper requires `is_local_only`, `is_ai_excluded`, and `privacy_version`, but the second query selects none of them. The existing migrated-database test calls this same summary path.

## Goals / Non-Goals

**Goals:** Make both filtered native listings satisfy the mapper's contract and preserve stored privacy state without loading document bodies.

**Non-Goals:** Change capture eligibility, navigation, database schema, privacy policy, or browser-backend behavior.

## Decisions

1. Select all three actual privacy columns in the capture-summary query. This preserves values and allows the existing mapper to fail visibly for a genuine contract mismatch. Defaulting missing columns in the mapper would hide future projection errors and could incorrectly weaken privacy settings.
2. Exercise the real migrated SQLite schema and repository listing for each supported capture source. Assert non-default privacy values as well as default values, selection and lightweight payload behavior. The existing shelf-only query tests cannot catch the summary mapper mismatch.
3. Keep eligibility, chunking and ordering unchanged, including filtering before Library pagination. Tests should include mixed capture sources and collections so the fix does not accidentally broaden the results.

## Risks / Trade-offs

- [A future field added to the mapper could again be missing from this projection] → Maintain a real-schema regression test that executes each source-filtered summary path.
- [False defaults could mask private data settings] → Assert stored non-default values, including `privacy_version`, survive the query.

## Migration Plan

Ship the query correction with the application; the existing schema already supplies these columns and no database migration is needed. Rollback restores the prior binary and its existing listing failure; no data transformation occurs.
