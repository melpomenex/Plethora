# Plethora 1.0 — Human Launch Checklist

Only tasks that require a human or an external party belong here. Anything
completable by repository changes is engineering work (see
`PLETHORA_1_0_RC_FINDINGS.md`) and must not be added to this file.

## Legal & business entity

- [ ] Confirm final company/legal name that will appear in store listings and
      legal documents
- [ ] Form the legal entity (e.g. LLC) in the chosen jurisdiction
- [ ] Obtain EIN (US) or local tax registration equivalent
- [ ] Open a business bank account
- [ ] Complete D-U-N-S registration (required for Apple Developer organization
      enrollment)
- [ ] Engage counsel / finalize review of Terms of Service
- [ ] Engage counsel / finalize review of the Privacy Policy against the actual
      data flows (cloud sync, E2EE, AI providers, telemetry opt-in) and publish
      the final policy URL
- [ ] Confirm subscription terms copy (price, period, renewal, cancellation)
      with counsel

## Store enrollments

- [ ] Apple Developer Program — organization enrollment (needs D-U-N-S +
      legal entity)
- [ ] Google Play Console — organization enrollment + merchant account
- [ ] Apple: agree to Paid Applications schedule; set up banking + tax
      (including US tax forms for non-US where applicable)
- [ ] Google: set up tax categories + payout profile
- [ ] Register the final domain (plethora.app or chosen) + configure email
      (support@, legal@, privacy@)

## Subscriptions & payments

- [ ] Create production subscription products (`plethora_pro_monthly` /
      `plethora_pro_annual`) in App Store Connect with final pricing per region
- [ ] Create the same products in Google Play Console with final pricing
- [ ] Configure the backend's store credentials (App Store shared secret /
      notification key, Play service account) in production secrets — no test
      keys
- [ ] Run one real sandbox purchase + cancellation + expiration on each store
      and verify entitlement transitions end-to-end
- [ ] Verify restore-purchases on a second device with a live account

## Store listings & review

- [ ] Produce final app screenshots (phone + tablet, all required sizes) for
      both stores — after the green-theme decision (finding F-31)
- [ ] Write final store listing copy (title, subtitle, description, keywords,
      promotion text) in each supported listing language
- [ ] Record/produce app preview video (optional but recommended)
- [ ] Prepare the App Review demo account + reviewer notes (demo credentials,
      subscription entitlement notes, extension-connection instructions)
- [ ] Prepare Play review notes + data-declaration form answers aligned with
      the Privacy Policy
- [ ] Confirm account-deletion entry point is discoverable in-app for review
      (required by both stores)

## Beta testing

- [ ] Upload RC to TestFlight; distribute to internal + external testers;
      collect at least one round of feedback
- [ ] Upload RC to Play internal + closed testing tracks
- [ ] Exercise real-device spot checks: first-run on a clean device, mobile
      purchase flow, sync between desktop + mobile, browser extension connect
      (these paths are code-verified in-repo but need real hardware/store
      confirmation — finding F-33)

## Release

- [ ] Choose the release date + version number; cut the tagged release
- [ ] Submit for App Review; respond to feedback
- [ ] Start Play staged rollout (e.g. 10% → 50% → 100%)
- [ ] Publish the website/download page with production links
- [ ] Announce (product page, existing users, changelog)

## Post-launch (keep this list short)

- [ ] Monitor store review feedback + crash reports for the first two weeks
- [ ] Verify real subscription webhooks (renewals, refunds, grace) in
      production logs
- [ ] Schedule privacy/security review cadence for cloud services
