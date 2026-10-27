## 1. Native capture summaries

- [x] 1.1 Add a migrated-SQLite regression test for browser-extension and share-target summary listings with mixed sources and collections; verify eligible rows are returned in the existing order and excluded rows stay excluded.
- [x] 1.2 Assert summaries preserve both non-default and default `is_local_only`, `is_ai_excluded`, and `privacy_version` values while omitting document content and large article metadata; confirm the test exposes the current missing-column error.
- [x] 1.3 Select the three persisted privacy fields in the capture-summary query and verify the regression test passes without changing the shared mapper or eligibility logic.

## 2. Validation

- [x] 2.1 Run the native capture repository tests, including the existing filtered-Library test, and record their results.
- [x] 2.2 Verify the dashboard's View all browser saves opens the filtered all-library view with saved documents and no command error in a native app, or document any environment limitation.
- [x] 2.3 Run `npm run bench:check` and record the result as required by repository instructions.
