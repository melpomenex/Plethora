## Context

The NotebookLM CLI integration shells out to a bundled `notebooklm-py` runtime to check auth and list notebooks. Two backend behaviors combine to produce the "Connected but no notebooks" symptom reported in issue #44:

1. **`CliNotebookLMProvider::list_notebooks` swallows every error into `Ok(vec![])`** (`src-tauri/src/notebooklm.rs:1429-1453`). Auth failures (`is_auth_error`, `notebooklm.rs:3063`), runtime failures, and non-JSON output all return an empty list. The frontend cannot distinguish a genuinely empty account from a broken or expired session.
2. **`health` reports `connected: auth.connected`**, a persisted flag set when the user first connected or logged in (`notebooklm.rs:1414`, set by `persist_cli_auth_state` at `2888` and `notebooklm_connect` at `3236`). It is not the result of the live `auth check --json` verification, which itself only proves cookie presence (`cookies_present && sid_cookie`), not that the session is usable for API calls.

On the frontend, `NotebookLMPage.checkConnection` (`src/pages/NotebookLMPage.tsx:89-135`) treats a returned empty array as healthy; its `catch (listError)` branch (`:119-126`) is effectively dead for the CLI provider because listing never rejects. The earlier `fix-issue-44-bugs` change added empty-state messaging (`:111-117`) but could not fix detection, since the backend reports the failure as an empty list. The existing `handleCLILogin` (`:173-195`) and its Sign In button (`:651-669`) are the recovery mechanism, but nothing routes the user there because no needs-reauth state is ever entered.

## Goals / Non-Goals

**Goals:**
- Make a NotebookLM listing failure observable: a failed or unauthenticated `list` MUST NOT be indistinguishable from an empty account.
- Make the "Connected" badge honest: it MUST reflect a live, usable session, not a persisted flag.
- Give the user a one-click recovery path (Re-authenticate CLI) exactly when the session is bad.
- Add tests that lock in the error-recovery states so this regression cannot return silently.

**Non-Goals:**
- Changing the credential/login mechanism (still browser-based Google OAuth via the CLI).
- Upgrading or re-pinning the `notebooklm-py` runtime version.
- Altering the mock provider's behavior (it continues to return its canned data).
- Auto-refreshing auth in the background; re-authentication remains user-initiated.

## Decisions

### Decision 1: `list_notebooks` propagates a typed not-authenticated error instead of returning an empty list
`CliNotebookLMProvider::list_notebooks` will branch on failure: auth-shaped errors (per the existing `is_auth_error` classifier) return a typed not-authenticated error; other failures return a generic listing error. Success with zero notebooks still returns `Ok(vec![])`. This is the load-bearing change: it makes the failure observable to the Tauri command and the frontend.

- **Why over alternatives:** The alternative is to keep returning `[]` and add a separate "verify session" call before listing. Rejected because it doubles CLI invocations (latency, more failure modes) and introduces a race between verify and list. Surfacing the real error from the single list call is simpler and authoritative.
- **Error type:** Extend the existing `AppError` (e.g. an `IntegrationError` variant carrying a `kind` such as `NotAuthenticated` vs `ListingFailed`), or a small provider-specific enum mapped at the command boundary. The `notebooklm_list_notebooks` command maps the typed error to a structured value the frontend can switch on.

### Decision 2: `health` reports the live verification result, not the persisted flag
`CliNotebookLMProvider::health` will set `connected` from the outcome of the verification it already runs (`auth check --json` / `status`), instead of echoing `auth.connected`. The persisted flag remains useful as a hint but is no longer the source of truth for the badge.

- **Why:** This is what makes "Connected" mean "usable right now." Keeping the persisted flag as the badge value is the original defect.
- **Trade-off:** A previously-connected user with an expired session will now correctly see a non-connected/needs-reauth state instead of a green badge. That is the desired correction, and the new Re-authenticate action makes it cheap to recover.

### Decision 3: Frontend three-state outcome with a reachable Re-authenticate action
`checkConnection` produces one of three outcomes after the health + list pair:
- **connected (with notebooks)** — select active/first notebook, show workspace.
- **connected, empty** — healthy new account; show the create-first empty state (no alarm).
- **needs-reauthentication** — listing failed due to auth (or `health` reports not connected despite a persisted flag); show a clear message and a prominent **Re-authenticate CLI** button that calls the existing `handleCLILogin`. The green "Connected" badge MUST NOT render in this state.

Non-auth listing failures route to the existing `error` state with the real message, plus the same Re-authenticate action as a convenience.

- **Why over alternatives:** Surfacing a distinct third state (rather than reusing the generic error state) lets the UI tailor the message and primary action to the most common cause (expired auth) without hiding genuine errors.

### Decision 4: Defense-in-depth frontend cross-check
Even with honest `health`, the frontend treats `connected && notebooks.length === 0` combined with a list-error signal as needs-reauth rather than trusting either signal alone. This guards against the two CLI invocation paths (`health` uses `run_first_success_no_bootstrap`, `list` uses `run_first_success`) disagreeing.

## Risks / Trade-offs

- **[Other call sites assume `list` never errors]** → Audit callers of `notebooklm_list_notebooks` and `list_notebooks`; update the Tauri command and frontend to handle `Err`. The mock provider is unchanged, so mock-backed tests and flows keep returning data.
- **[`is_auth_error` is broad]** (matches "auth", "login", "401", "session", etc.) → A non-auth error could be misclassified as auth. Mitigation: misclassification still surfaces the failure (as needs-reauth), which is recoverable; a generic listing error still routes to the error state with Re-authenticate available. Net behavior is strictly better than silent-empty.
- **[Honest health adds perceived flakiness]** → Users who were silently broken will now visibly see needs-reauth. Mitigation: clear messaging and one-click re-auth; this is the intended correction, not a regression.
- **[Latency of an extra verification]** → `health` already runs `auth check`; this decision reuses that result rather than adding a new call. Existing 12s timeout still bounds it.
- **[Two unarchived changes touch `notebooklm-status-handling`]** → Both this change and `fix-issue-44-bugs` add requirements to the same capability. OpenSpec deltas compose, so both archive cleanly; this change's requirements are stricter and supersede the sibling's intent.

## Open Questions

- Should detecting needs-reauth proactively clear the persisted `auth.connected` flag so other surfaces (e.g. any feature gate reading it) also correct themselves? Likely yes, to be settled during implementation.
- Should the structured error surface a `helpUrl` or hint beyond the existing `notebooklm.signInFirst` message? Defer; current copy is sufficient for v1.
