# Plethora Commercial Store Release Checklist

Comprehensive release verification checklist for Apple App Store (iOS/iPadOS/macOS) and Google Play Store (Android) submissions.

---

## 1. Identity & Build Target Configuration
- [ ] **Bundle IDs & Application Identifiers**:
  - iOS / macOS: `com.plethora.app`
  - Android: `com.plethora.app`
- [ ] **Version Alignment**:
  - `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` share identical `version` (e.g. `2.7.0`).
  - Android `versionCode` monotonically incremented.
- [ ] **Store Build Flags**:
  - `REQUEST_INSTALL_PACKAGES` stripped from Android Play builds.
  - Sideload self-updater disabled in store builds; App Store and Play Store manage application binary updates.

---

## 2. Privacy, Security & Data Safety Declarations
- [ ] **Apple Privacy Nutrition Labels**:
  - **Data Linked to You**: Email Address (Account / Authentication).
  - **Data Not Linked to You**: Crash & Diagnostic Counters (Performance monitoring).
  - **Zero-Knowledge Encryption**: Explicit disclosure that user study materials, books, flashcards, and notes are client-encrypted with AES-256-GCM.
- [ ] **Google Play Data Safety Form**:
  - Data encrypted in transit (TLS 1.3).
  - Data deletion mechanism: Yes (In-app Account Deletion via `DELETE /v1/auth/account`).
- [ ] **App Store Guideline 5.1.1(v) Compliance**:
  - In-app account deletion is accessible within `Settings > Account > Delete Account`.
  - Cascading deletion permanently erases cloud databases across all 12 tables within 30 seconds.

---

## 3. In-App Purchase & Billing Verification
- [ ] **StoreKit 2 & Google Play Billing 6+ Integration**:
  - Products configured: `plethora_pro_monthly`, `plethora_pro_annual`.
  - Monthly / annual prices rendered dynamically from store localized pricing APIs.
  - **Restore Purchases**: Tested and verified functional in sandbox environments.
  - Free trial (14-day) transitions into active subscription without data disruption.
- [ ] **Monetization Invariants**:
  - Local library reading, highlighting, offline search, and spaced repetition review remain 100% free and functional without any subscription.

---

## 4. App Store Review Support & Test Accounts
- [ ] **Demo Credentials**:
  - Dedicated review tester account: `appstore-review@plethora.app` / `play-review@plethora.app`.
  - Pro entitlement active on review account with seeded sample library.
- [ ] **Review Notes**:
  - Clear explanation of optional cloud AI features vs offline local-first reader capabilities.
  - Socratic AI tutoring and RAG citation flow demonstrations provided in review attachments.

---

## 5. Pre-Release Smoke Verification
- [ ] Physical device smoke test on Android (minSdk 24, targetSdk 36).
- [ ] Physical device smoke test on iOS (iOS 16+).
- [ ] Offline airplane-mode reader and card review verification.
- [ ] All automated CI gates green (`npm run test:run`, `cargo test`, `npm run bench:check`, `npm run build:check`, `npm run test:scripts`).
