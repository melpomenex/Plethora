## Validation

- Before the fix, the existing native `filtered_library_uses_all_collections_and_omits_article_bodies` test failed with `Database(ColumnNotFound("is_local_only"))` against a freshly migrated database.
- The new `capture_summaries_preserve_privacy_and_filter_across_collections` test likewise failed with that error before the fix. Afterward, `cargo test --lib database::capture_repository::tests -- --test-threads=1` passed all 4 tests.
- `npx vitest run src/components/analytics/__tests__/BrowserCaptureShelf.test.tsx --reporter=dot`: 7 tests passed, including dashboard navigation coverage.
- Native interactive verification of the rebuilt app was not available: computer-use access in this session does not expose native applications. The installed app is a separate, older build and cannot verify the changed source.
- `npm run bench:check`: first run failed with 19 benchmark budget regressions during concurrent dependency compilation. A second run while the application test target was compiling reduced this to one failure, `ankiImport/convert-2000-notes`. A final run after compilation finished still failed on that benchmark: measured cost 2.252 against a limit of 2.189. The gate remains failed; no benchmark baselines were changed.
- `node scripts/check-bundle-budget.mjs`: passed separately (the failed benchmark gate did not reach this step).
