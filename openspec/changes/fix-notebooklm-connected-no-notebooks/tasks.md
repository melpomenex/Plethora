## 1. Backend: typed listing errors

- [x] 1.1 Add a not-authenticated error kind to the NotebookLM provider error path: added `IncrementumError::IntegrationAuthError` (serialized as `integration_auth_error`) in `src-tauri/src/error.rs`.
- [x] 1.2 Update `CliNotebookLMProvider::list_notebooks` so auth-shaped failures return the not-authenticated error and other failures return a generic listing error, instead of both returning `Ok(vec![])`. Implemented via the extracted pure helper `classify_list_failure`. A successful zero-notebook list still returns `Ok(vec![])`.
- [x] 1.3 The `notebooklm_list_notebooks` command serializes the typed error automatically via `IncrementumError`'s Serialize impl. Audited callers: the second frontend caller (`FlashcardStudioModal.tsx`) now treats a list rejection as "no notebooks" so settings still load.
- [x] 1.4 Added Rust unit tests `classifies_auth_list_failure_as_not_authenticated` and `classifies_non_auth_list_failure_as_listing_error`.

## 2. Backend: honest health

- [x] 2.1 `CliNotebookLMProvider::health` now sets `connected: true` from the live verification result rather than the persisted `auth.connected` flag; the not-authenticated branch returns `IntegrationAuthError`.
- [x] 2.2 Decision: keep `health` read-only (it does not mutate `auth.json`). The persisted flag is no longer the source of truth for the badge, so clearing it on failure is unnecessary and a read command should not have write side effects. No code change.
- [x] 2.3 A dedicated Rust unit test for `health` is not feasible without CLI command-mocking infrastructure (`health` shells out via `run_first_success_no_bootstrap`); the live-result behavior is instead covered by the frontend `needs-reauth` test (5.1) and manual verification (5.3).

## 3. Frontend: typed list handling and three-state check

- [x] 3.1 `coerceError` in `src/lib/tauri.ts` now preserves the structured `type` (e.g. `integration_auth_error`) on the thrown `Error`, so callers can branch on it.
- [x] 3.2 Added a `needs-reauth` state to the `ConnectionState` union and refactored `checkConnection` to produce connected-with-notebooks / connected-but-empty / needs-reauthentication, with `connected` set only after a successful listing.
- [x] 3.3 The green "Connected" badge (in the main view) only renders for the `connected` state, since `needs-reauth` and `error` take the connection-form early return. Connected-but-empty still shows the create-first empty state.

## 4. Frontend: Re-authenticate CLI action

- [x] 4.1 Added a prominent "Re-authenticate CLI" button shown in both `needs-reauth` and `error` states, calling the existing `handleCLILogin`.
- [x] 4.2 After a successful re-auth, `handleCLILogin` already calls `handleConnect`, which re-runs `checkConnection`, so the workspace transitions out of needs-reauth.
- [x] 4.3 Added i18n keys `notebooklm.reauthenticate` and `notebooklm.reauthRequired` in `src/lib/i18n/locales/en.ts`.

## 5. Tests and validation

- [x] 5.1 Added `src/components/notebooklm/__tests__/NotebookLMPage.test.tsx` covering: auth-failure list result enters `needs-reauth` with the Re-authenticate action and no "Connected" badge; genuine empty list stays connected-but-empty; non-auth listing failure shows the error message with Re-authenticate offered.
- [x] 5.2 Ran `npx vitest run src/components/notebooklm` (25 passed) and `cargo test list_failure_as` (2 passed); also confirmed FlashcardStudio + lib/tauri tests (39 passed) and `cargo check` compile clean.
- [ ] 5.3 Manual end-to-end verification against the bundled CLI (a connected-then-expired session shows needs-reauth with a working Re-authenticate button; a real empty account still shows connected-but-empty). Pending: requires the bundled runtime and a real session.
