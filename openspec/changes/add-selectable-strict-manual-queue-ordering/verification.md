# Verification Plan: Selectable Strict Manual Queue Ordering

## Automated Test Suites

### T01: Strict Manual Monotonicity Suite (Rust)
- File: `src-tauri/src/algorithms/daqe/__tests__/strict_manual_tests.rs`
- Invariant: When `QueueOrderingMode::StrictManual` is passed, items are ordered monotonically by canonical priority $P$ descending ($1.0 \to 0.0$).
- Counterexample Protection: A future document with $P = 0.95$ MUST strictly sort ahead of an overdue card with $P = 0.40$.

### T02: Variety Guard Bypass Suite (TypeScript)
- File: `src/utils/__tests__/queueScrollOrder.strict.test.ts`
- Invariant: In `strict-manual` mode, passing 10 consecutive documents with high priority outputs all 10 documents before any lower-priority items.
- Check: Verify `deferred.length === 0` when `strictManual === true`.

### T03: Settings Search Coverage Gate
- File: `src/components/settings/search/__tests__/settingsSearchCatalog.test.ts`
- Command: `npm test src/components/settings/search`
- Assertion: `setting-queue-ordering-mode` must be present in the catalog, have a non-empty keyword list, link to `SettingsTab.Review`, and match user search queries.

## Performance Benchmark Gate

- Command: `npm run bench:check`
- Assert that ranking 4,000 items in `strict-manual` mode executes in under 8ms (faster than DAQE due to skipping multi-term matrix calculation).
