# Tasks

## Implementation

- [x] Audit Android/billing/server/release (agent fleet)
- [x] Create OpenSpec proposal and design
- [x] Implement `plethora-playbilling` native plugin (BillingClient 7.1.1)
- [x] Wire `PlayBillingProvider` TypeScript bridge
- [x] Wire `billingStore` Play init/listener/restore
- [x] Server acknowledgement + binding hardening
- [x] Production API URL contract (`api.useplethora.com`)
- [x] Store profile build gate for API URL
- [x] Client + server automated tests
- [x] Play Console runbook
- [ ] Deploy server migration to production VPS (manual)
- [ ] Play Console subscription + RTDN setup (manual)
- [ ] Internal Testing E2E on physical device (manual)

## Verification

- [x] Server unit tests
- [x] Client billing unit tests
- [x] Rust plugin compiles
- [ ] Android store AAB build (requires SDK + keystore)
- [ ] Adversarial post-implementation review
