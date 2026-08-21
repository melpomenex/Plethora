## 1. Deletion Flow Rewrite (no B dependency — can start Wave 1)

- [x] 1.1 Replace the single `modal.confirm` with a dedicated multi-step deletion component: plain-language scope description (cloud data deleted; local library retained; Apple subscription NOT cancelled), export-before-delete offer wired to `GET /v1/auth/export`, explicit confirmation step.
- [x] 1.2 Fix the failure path: on API failure show an explicit error with retry and remain signed in; remove the silent sign-out-on-failure behavior; success and failure toasts/messages unambiguous.
- [ ] 1.3 Post-deletion behavior: local session cleared, sync cleanly disabled, app continues in local-only mode; verify relaunch state and document the second-device expectation.
  > Implemented + unit-tested (`DeleteAccountFlow` success path clears the session via `signOut()` and resets
  > `syncStore` to clean local-only state). Second-device expectation: other devices' sessions/tokens are revoked
  > server-side by the cascade, so their next authed action/refresh fails with 401 and they transition to
  > signed-out local mode (covered by `accountStore.refresh` 401 test); their local libraries are retained.
  > Remaining: physical/simulator relaunch verification — deferred to §4.2 execution.
- [x] 1.4 Server: make deletion response semantics explicit (success vs failure codes); extend `accountDeletionAndExport.test.ts` accordingly.
- [x] 1.5 Ensure the Settings entry is discoverable within two taps from Settings root (reviewer test); keep the Privacy-tab link.
  > Settings → Account tab → "Delete Account…" opens the flow directly; the Privacy-tab destructive card also
  > opens the same component. Section numbering untouched.
- [x] 1.6 **Documentation correction:** annotate the false `[x]` items in `implement-plethora-cloud-privacy-security-data-export-and-account-deletion/tasks.md` (2.1 retention/receipt/job; 2.2 multi-step flow) and in `implement-plethora-accounts-authentication-and-entitlements/tasks.md` (1.4 OAuth stubs; 2.1 Rust auth claims) as superseded/corrected by this and related changes.

## 2. Sign-In Integrity

- [x] 2.1 Remove the offline mock-login fallback in `accountStore.ts` (`signIn` catch path); network errors produce an error state with retry; add regression tests proving no session is fabricated on failure.
  > Removed from both `signIn` and `register`; failures set an explicit retryable `error`, stay signed out, and
  > throw so `LoginModal` surfaces them. Regression tests assert no session/tokens on network failure and 401.
- [x] 2.2 Gate/remove the Rust mock sign-in path (`src-tauri/src/plethora_auth`) for production builds using the agreed build-profile mechanism; dev builds keep it with explicit labeling.
  > Gated on Change A's `build_profile::is_store_profile()` via `mock_sign_in_allowed(profile)` — store builds get
  > a state-preserving no-op (nothing fabricated; the frontend owns real server-authenticated session state);
  > development/sideload keep clearly-labeled `dev-mock-*` credentials. `cargo check`: no new errors (pre-existing
  > sherpa/tts failures unchanged). Store-profile runtime verification deferred to §4.2 device build.
- [ ] 2.3 Verify token refresh/logout/multi-device flows on iOS: expired access token → silent refresh; revoked device → clean sign-out on next action; document behaviors.
  > Unit-covered (`accountStore.test.ts`): silent refresh rotates tokens; refresh 401 (revoked family / deleted
  > elsewhere) → awaited clean sign-out to local mode; refresh network failure keeps offline session; revoke-device
  > propagates server-side and updates registry. Logout revokes the server session. Remaining: iOS
  > simulator/device execution — deferred to §4.2 matrix runs.

## 3. Subscription Lifecycle UX (integrates with B)

- [ ] 3.1 Subscription status display in `UserProfilePanel` + Settings Account: Free/Pro, renewal date, grace/billing-issue state — consuming B's verified snapshot read-only.
- [ ] 3.2 Restore Purchases button with spinner/result/error states wired to B's `restorePurchases`; place per App Store conventions (account/paywall surfaces).
- [ ] 3.3 Manage Subscription action on iOS wired to B's `storekit_manage_subscriptions`.
- [ ] 3.4 Entitlement-loss presentation: expired/refunded/revoked → downgrade notice with resubscribe path; grace state shows billing-issue messaging without locking the user out mid-state.
- [ ] 3.5 Deletion dialog subscription awareness per design §2: when subscribed, show the "Apple subscription continues until cancelled" warning with a direct manage-subscription action; verify copy never implies Apple billing was cancelled.

## 4. Lifecycle Scenarios (matrix → evidence)

- [ ] 4.1 Document the full scenario matrix (create; local-only use; sign-in/out; refresh; multi-device; free→Pro sandbox; relaunch persistence; second-device restore; expiration; refund/revocation; grace; manage/cancel via Apple; deletion incl. export; post-deletion login rejection; second-device post-deletion) in `docs/release/ios-account-lifecycle.md`.
- [ ] 4.2 Execute the matrix in sandbox on iOS simulator + physical device where applicable; hand results to Proposal G for evidence recording. Levels: automated tests pass + simulator verified + physical-device verified (deletion and purchase scenarios).
- [ ] 4.3 Verify deletion + active-sandbox-subscription combined behavior against B's retained-records design; record what remains server-side and confirm copy accuracy.
