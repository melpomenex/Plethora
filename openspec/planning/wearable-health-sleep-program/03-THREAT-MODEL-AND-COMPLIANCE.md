# Wearable Health & Learning Platform — Security Threat Model & Compliance Review

**Verification Date:** 2026-11-20  
**Scope:** Complete 17-threat security model (§42), encryption boundaries, AI isolation, and regulatory/platform policy review (§43).

---

## 1. Encryption & Storage Boundaries (Honest Assessment)

| Data Asset | Storage Mechanism | At-Rest Protection | Residual Risks |
|---|---|---|---|
| **Health Vault (`health.db`)** | Dedicated SQLite WAL DB (`<app_data_dir>/health/health.db`) | Plain SQLite protected by OS user filesystem permissions and OS full-disk encryption (FileVault / BitLocker / Android FBE / iOS Data Protection). **Not SQLCipher.** | Local malware running as the same OS user, unencrypted desktop disk backups (Time Machine/rsync), or rooted mobile devices can read `health.db`. |
| **Health OAuth Tokens** | `KeyringIo` (`com.plethora.app.health`) opt-in via `PLETHORA_USE_KEYCHAIN=1`; default AES-256-GCM encrypted file (`<app_data_dir>/health/tokens/*.enc`) | Keychain uses macOS Keychain / Windows Credential Manager / Secret Service when opted in; encrypted fallback uses 16-byte random salt + PBKDF2-HMAC-SHA256 (100k iters) + AES-256-GCM (12-byte nonce). | Encrypted-file fallback key derives from `user@hostname` to avoid OS keychain unlock prompts; same-user local code can derive fallback keys if keychain is off. |
| **OAuth Client Secrets** | Server environment variables (`server/src/routes/v1/healthOAuth.ts`) | Never compiled into or shipped inside Tauri desktop/mobile binaries. | Compromise of the OAuth broker server environment would expose provider client secrets (mitigated by zero server-side health data storage). |
| **Portable Health Bundle (`.plethora-health.enc`)** | User-passphrase encrypted archive | 16-byte random salt + PBKDF2-HMAC-SHA256 (100k iters) + AES-256-GCM + explicit AAD (`plethora-health-export-v1`). | Security depends on user passphrase entropy; recovery is impossible if user loses passphrase. |

---

## 2. Threat Model Matrix (All 17 Required Threats)

| # | Threat | Attack Vector | Implemented Mitigation | Verification |
|---:|---|---|---|---|
| 1 | **Stolen OAuth tokens** | Local file theft or log leakage | Custom `Debug` impl redacts `access_token`/`refresh_token`; tokens stored outside `health.db` & excluded from exports; opt-in OS keyring supported; token revocation endpoint called on disconnect. | Unit test asserting `Debug`/error logs contain no raw tokens; disconnect purge test. |
| 2 | **Confused-deputy authorization** | Attacker triggers OAuth flow under wrong provider or tricks app into attaching wrong user's token | Pending OAuth sessions bind `{ state, provider_id, pkce_verifier, redirect_uri, created_at_ms }` strictly in `HealthOAuthManager` and validate provider match on callback. | Unit test rejecting mismatched `provider_id` callback. |
| 3 | **OAuth state manipulation** | Attacker forges/predicts `state` query param | 32-byte `OsRng` hex-encoded `state`, constant-time/exact lookup, single-use removal on first attempt, 10-minute TTL expiry. | Unit tests for unknown `state`, expired `state`, and replay of consumed `state`. |
| 4 | **Redirect URI hijacking** | Attacker captures authorization code via open redirect or non-loopback listener | Desktop loopback binds strictly to `127.0.0.1:0` with exact matching `redirect_uri`; mobile deep links validate exact `plethora://health/oauth/callback` route and redacts `code=` in `external_open.rs`. | `external_open` redaction test + callback state binding test. |
| 5 | **Compromised provider responses** | Malicious/corrupted JSON returning NaN, negative durations, 1000-hr sleep, XSS strings | Strict serde parsing, finite/range guards (`duration <= 24h`, `end > start`, HRV `0 < v <= 500`), SSRF `validate_url_not_private` on production URLs, React text-node escaping (never `dangerouslySetInnerHTML`). | Malformed & out-of-range provider fixture tests. |
| 6 | **Malicious import files** | XML entity expansion (XXE/billion laughs), oversized CSV, CSV formula injection, corrupted JSON | Streaming `quick-xml` without DTD entity expansion, 50 MB / 500k row hard caps, CSV cell validation & non-executable storage, atomic transaction rollback on parse failure. | Adversarial malformed XML/CSV/oversize unit tests. |
| 7 | **Cross-account data leakage** | User switches Oura/WHOOP/Plethora accounts or re-links a different device | Connections keyed by `provider_id`; `disconnect` requires option to retain or delete provider data; changing account subject hint warns and prevents silent merging without user choice. | Integration test covering provider disconnect + delete vs keep. |
| 8 | **Sync identity collisions** | Different providers reuse numeric/UUID `external_record_id` or two devices collide | Unique constraints are composite `(provider_id, external_record_id)` — never bare `external_record_id`. Canonical episodes generate fresh UUIDs. | Reconciliation & DB constraint tests with identical `external_record_id` across two providers. |
| 9 | **Device theft** | Physical access to unlocked/rooted device | Documented OS FDE/passcode dependency; optional `PLETHORA_USE_KEYCHAIN=1`; zero health data written to unencrypted temp logs or Plethora `plethora.db`. | Security architecture disclosure + log audit. |
| 10 | **Local database access** | Another user/process or cloud backup syncs `plethora.db` containing health metrics | Health tables isolated exclusively in `<app_data_dir>/health/health.db`, NEVER inside `plethora.db`. `BackupManager` and `sync_outbox` cannot read `health.db`. | Integration test inspecting `plethora.db` & `BackupManager` export for zero health tables/rows. |
| 11 | **Plaintext logs** | `tracing::info!` or `tauri-plugin-log` prints sleep timestamps, HRV, or bearer tokens | Custom `Debug` redaction on tokens & credentials; log messages record counts/status codes only, never biometric values or tokens; `external_open.rs` scrubs query tokens. | Code audit + unit tests checking error strings & `Debug` formatting. |
| 12 | **Unauthorized cloud uploads** | Health metrics enter `sync_outbox`, `BackupManager`, `semantic_chunks`, `MEMORY.md`, or `llm_chat` | Zero wiring to `sync/registry.rs`, `BackupManager`, `ai_learning`, or `ai/prompts.rs`. Separate explicit opt-in required for encrypted `.plethora-health.enc` export. | Rust integration test verifying all 5 exfiltration surfaces remain clean. |
| 13 | **Revoked consent** | User revokes HealthKit/Health Connect/OAuth consent, yet background tasks keep syncing or UI keeps querying | `401` / permission-denied immediately sets connection `status = permission_revoked`, halts retries, logs consent revocation, and disables native observer delivery. | Integration test for `401` revocation + native denied permission handling. |
| 14 | **Webhook spoofing** | Attacker POSTs fake WHOOP/Oura webhook payloads to `/v1/health-oauth/:provider/webhook` | Mandatory `X-WHOOP-Signature` HMAC-SHA256 verification using `crypto.timingSafeEqual` over `X-WHOOP-Signature-Timestamp + rawBody` before JSON parse. | Server Vitest/node:test cases for invalid signature & tampered body (`401`). |
| 15 | **Replay attacks** | Attacker replays valid captured webhook or OAuth callback | Webhook timestamp skew rejected if `|now - timestamp| > 300s`; OAuth `state` deleted on first consumption. | Server test rejecting stale webhook timestamps; Rust test rejecting second OAuth callback. |
| 16 | **Sensitive backup exposure** | iCloud Backup (`NSUbiquitous` / app Data dir) backs up HealthKit-derived `health.db` (violating Apple Guideline 5.1.3(ii)) | `plethora-healthkit` executes `excludeHealthDirFromBackup` setting `URLResourceValues.isExcludedFromBackup = true` on `<app_data_dir>/health/` and `health.db`; Android manifest/backup rules exclude `health/`. | Swift plugin implementation + documented iOS build verification check. |
| 17 | **Data deletion failures** | Deleting a provider or wiping all health data leaves stale stage intervals, canonical episodes, tokens, or WAL pages | Cascading SQLite foreign keys + explicit `DELETE` of all health tables + `PRAGMA wal_checkpoint(TRUNCATE); VACUUM;` + removal of token files and keychain entries. | Integration test verifying 0 rows remain across all 12 tables and token store returns `None`. |

---

## 3. Compliance & Regulatory Assessment

### 3.1 Apple HealthKit & App Store Review (Guideline 5.1.3 & 1.4)
- **Permissible Purpose:** Plethora uses sleep duration, timing, heart rate, and HRV strictly to provide personal sleep visualization and educational self-tracking insights ("learning windows" / descriptive statistics) — a wellness/productivity benefit directly for the user.
- **No Medical Claims (Guideline 1.4):** UI and insight copy prohibit diagnostic, therapeutic, or clinical disease claims.
- **iCloud Prohibition (Guideline 5.1.3(ii)):** HealthKit data is stored exclusively in `<app_data_dir>/health/health.db` with `isExcludedFromBackup = true`, NEVER written to iCloud/CloudKit, and blocked from automatic Plethora Cloud sync (`wearable_health_local` has `dataLeavesDevice: false`).
- **Release Blocker / Gating:** Injecting `com.apple.developer.healthkit` requires an Apple Developer provisioning profile and App Review check. `scripts/ios-overrides/healthkit.entitlements.json` defaults to `"enabled": false` until external Apple review & policy sign-off.

### 3.2 Google Health API v4, Health Connect & Google Play Policy
- **Legacy Fitbit API Retired:** Endpoints against `api.fitbit.com` are forbidden (retired late 2026); Plethora targets `https://health.googleapis.com/v4` only.
- **CASA & OAuth Verification:** Google Health API v4 scopes (`googlehealth.sleep.readonly`, etc.) are Restricted, capping unverified projects at 100 test users and requiring annual CASA assessment for production launch. Therefore `google_health` remains in `requires_developer_approval` unless configured with verified client credentials.
- **Health Connect Play Store Rules:** Requires completing Google Play Console **Health Apps** declaration, surfacing an in-app permissions rationale (`ACTION_SHOW_PERMISSIONS_RATIONALE`), handling default 30-day history limits gracefully (`READ_HEALTH_DATA_HISTORY`), and avoiding silent background scraping.

### 3.3 GDPR (Article 9), US State Laws (Washington MHMDA) & HIPAA
- **HIPAA:** As a consumer learning/self-tracking application not acting as or on behalf of a HIPAA Covered Entity (health plan, clearinghouse, or healthcare provider), Plethora is generally **not** a HIPAA-regulated Covered Entity or Business Associate; however, **Washington My Health My Data Act (MHMDA)** and **GDPR Article 9** *do* apply to consumer health/biometric inferences.
- **GDPR Art. 9 & MHMDA Controls Implemented:**
  1. Explicit, granular opt-in consent recorded with timestamps and categories in `health_consent_log` before any ingestion.
  2. Strict purpose limitation (zero advertising, zero data brokerage, zero external LLM ingestion by default).
  3. Complete user portability (JSON / encrypted export) and immediate erasure (`health_delete_provider_data`, `health_wipe_all_data`).
- **Unresolved Legal / Release Blockers (Must Be Checked Before Public Store Distribution):**
  1. Final legal review of published Privacy Policy & Terms for GDPR Art. 9 / Washington MHMDA consumer health disclosures.
  2. Apple App Review confirmation that educational study-correlation insights satisfy HealthKit Guideline 5.1.3(i).
  3. Google Cloud OAuth Verification + annual CASA Tier 2 security assessment if shipping direct Google Health API v4 beyond 100 test users.
  4. Partner approvals from Garmin (Enterprise/Starter), Oura (>10 users), and WHOOP (>10 users).
