# Change: Implement Plethora Cloud Privacy, Security, Data Export, and Account Deletion

> Wave 1/4 — spans the suite (architecture lands early with 3/5; account-deletion completeness gates 23). Touches server (with 3/5) and app UX.

## Why

Privacy and portability are product features, not compliance chores: a documented privacy architecture (what leaves the device, when, why, where stored, how long, who else sees it, what's deletable), robust account deletion, device revocation, data export, sensitive-document handling, secure logs/credentials, and auditability. App Store / Play **require** in-app account deletion and accurate privacy declarations — this change makes those true statements.

## What exists today
- **Local security**: keychain-gated secret storage with AES-256-GCM file fallbacks (AI keys, OAuth tokens, planned account tokens); SSRF guard; backup encryption (AES-256-GCM + PBKDF2); E2E sync crypto design (6); no telemetry in the desktop app (Vercel Analytics only on web); content-free logging norms emerging in 5.
- **Export**: app-state export (`.incrementum`→`.plethora` per rebrand), Anki/Plethora/mnemosyne deck exports, collection archives, `StatisticsExport`; Obsidian/Anki integrations.
- **Server**: nothing privacy-relevant beyond auth; no data map, no deletion flows, no audit log; `REQUIRE_PAID_FILE_SYNC` legacy flag; deprecated routes removed by 5.
- **Docs**: no privacy document exists (docs/ has none).

## What Changes

### 1. Privacy architecture & disclosure (product-wide)
- **Data map** (`docs/PRIVACY_ARCHITECTURE.md` + a live in-app version): per feature — what data leaves the device, when, why, destination, retention, encryption state, third-party model provider involvement, what metadata the service retains, what the user can delete, what stays local. Maintained as the source for store privacy labels (23) and marketing claims. Features: sync (6 — zero-knowledge), AI cloud tiers (7/12/13/14/15), reconstruction (16), TTS (17), transcription (18), capture (19), API/webhooks (20), telemetry (this change), crash reporting (this change).
- **In-app privacy center** (Settings → Privacy): plain-language disclosure per feature with per-feature enable/disable where meaningful (extends the AI-exclusion flag into a general "cloud eligibility" control), AI-provider disclosure (which provider, what's sent), telemetry policy display, and links to export/delete tools.
- **Sensitive-document handling**: per-document "local only" flag (superset of 7's AI-exclusion) enforced across ALL cloud paths (7, 16, 17, 18, 19) — one flag, centrally queried, tested centrally here.

### 2. Account deletion & data removal
- **In-app deletion flow** (required by stores): Settings → Account → Delete account: explicit multi-step consent distinguishing **cloud data** (deleted: inbox, capture, synced ciphertext, jobs, usage records per retention schedule) from **local data** (never touched without a separate explicit opt-in checkbox "also erase this device's library"); confirmation via signed request; status visible; completion verifiable.
- Server: cascading deletion with verification job (per-store requirements: within 30 days, including backups per documented schedule); anonymized aggregates retained only where irreversibly de-identified (documented); deletion receipt (audit record without content).
- **Device revocation**: 3's registry surfaced here with clear semantics (locks device out of cloud, local data intact).

### 3. Export & portability
- **Unified export** (local, Free): full library archive (documents + extracts + cards + scheduling + settings + metadata) in an open, documented format — evolving the existing app-state export into a versioned, documented schema (`.plethora` archive); per-collection export; deck exports unchanged.
- **Cloud-held data export**: `export` job kind (20) completeness contract: inbox items, capture history, usage records, webhook config — machine-readable.
- Import round-trip tests guarantee export→fresh-install-import fidelity (the ultimate portability proof).

### 4. Telemetry policy & crash handling
- **Opt-in, minimal telemetry** (default OFF): anonymous usage counters (feature used, error class, duration bucket) — no content, no titles, no URLs, no identifiers beyond a rotating install id; documented; toggleable; in web mode replaces/augments Vercel Analytics consent posture.
- **Crash/error reporting** (opt-in): stack traces + error class via the log pipeline (`tauri-plugin-log` + Rust panic hooks; server error reporting per 24) — content-free by construction (scrubbers for paths/strings), tested.
- **Secure logs**: extend content-scrubbing rules to all cloud-client logs; verified by scans (patterns from 5).

### 5. Credentials, secrets, auditability
- Secrets inventory + rotation runbook (`docs/SECURITY.md`): keychain entries, server provider keys (5), minisign keys, store credentials; the committed Android keystore incident (rebrand rotates it) documented as the anti-pattern.
- **Audit log** (server): security-relevant events (login, device add/revoke, token create/rotate, deletion, webhook config change, quota kill-switch) — who/when/what-class, never content; user-visible "account activity" view.
- **Backup handling**: cloud backups (BYO providers) documented as user-controlled (not Plethora-accessible); server backups follow the deletion schedule.

### 6. Compliance-oriented design
- GDPR/CCPA-style rights mapped to mechanisms (access=export, erasure=deletion, portability=export formats, transparency=data map) — documented matrix; DSR runbook for the operator. No legal conclusions made in-code.

## Impact

### Affected Specs
- `privacy-data-control` — New (data map, privacy center, local-only flag, deletion semantics, export contracts, telemetry policy, audit log).

### Affected Code Areas
- `docs/{PRIVACY_ARCHITECTURE,SECURITY}.md`; settings Privacy tab + account deletion flow; local-only flag plumbing (central helper consumed by 7/16/17/18/19); export evolution (`appStateExport.ts`); telemetry opt-in module (client) + endpoint; server deletion cascade + audit log + export completeness; i18n.

### Non-goals
- No legal determination (flagged for counsel), no SOC2/ISO certification work (operational, later), no anonymous-usage analytics default-on, no third-party consent-management platform.

## Dependencies

### Hard dependencies
- 3 (accounts/devices to delete/revoke), 5 (server framework, retention knobs). Soft: every cloud proposal consumes the local-only flag + disclosure entries (contract-first early task).

### May run concurrently
- Everything after its interface-first task (the flag + disclosure schema land in milestone 1).

### Must not start yet
- 23's privacy labels (need the final data map).

## Shared interfaces
- `isCloudEligible(document)` central helper + the "local only" document flag (single source; 7's AI-exclusion migrates onto it); privacy-disclosure registry (feature → data-flow descriptor rendered in the privacy center and docs); deletion/export job contracts; telemetry event schema (content-free, versioned).

## Ownership boundaries
- **May modify**: privacy center UI, deletion flows, export module, telemetry module, server deletion/audit, docs.
- **Must treat as external**: each feature's cloud paths (they consume the flag/disclosure registry; this change audits enforcement centrally), sync crypto (6), billing (4).

## Collision risks
- Settings tabs (many proposals — append-only); `appStateExport.ts` (rebrand already touches extension naming — sequence after); server routes (with 3/5/19/20 — deletion cascade owned here).

## Integration contract
- Feature proposals register disclosure entries and call `isCloudEligible`; deletion/export completeness enforced by tests owned here across all server stores (jobs, inbox, webhooks, usage, sync ciphertext).

## Testing & acceptance

### Tests
- Local-only flag: enforcement matrix across every cloud path (7/16/17/18/19) — one central test suite hitting each registered path with a flagged document (paths must self-register for the audit test).
- Deletion: cascade completeness (every server store enumerated vs deleted set — schema-driven test that fails when a new content-bearing table lacks deletion handling); local-data preservation when the opt-in checkbox is off; multi-step consent state machine.
- Export: round-trip fidelity (library → export → fresh import → counts/scheduling/positions equal); cloud-export completeness vs contract.
- Telemetry/crash: opt-in default-off tests; content-absence scans (fuzzed inputs with document-like strings → nothing leaks); scrubber unit tests.
- Audit log: events fire for the enumerated actions; no content fields.
- Secure logs: scans across client and server fixtures.

### Acceptance criteria
- A user can see (in-app) exactly what leaves their device per feature, flag any document local-only and observe enforcement, export everything (local + cloud-held), delete their account with cloud data verifiably removed and local data intact by default, and opt into/out of telemetry; audit trail exists for security events; docs match reality (data map CI-checked against disclosure registry).

### Must remain unchanged
- Default telemetry-off posture; existing export formats' importability; BYO backup behavior.

## Open questions
1. Telemetry default posture final call (default-off assumed; product may revisit).
2. Deletion retention schedule details vs backup cycles (operator runbook).
3. Jurisdiction-specific DSA/DMCA contact infrastructure (ops, not code).
