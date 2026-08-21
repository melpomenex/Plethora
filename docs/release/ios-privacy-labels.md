# iOS App Store Privacy Nutrition Label Mapping

> Change C (`complete-ios-apple-privacy-compliance`) task 3.3.
>
> Source of truth: `src/lib/privacy/disclosureRegistry.ts` (`labelMapping` fields).
> Generated questionnaire draft: `src/lib/privacy/labelMapping.ts` → snapshot-tested in
> `src/lib/privacy/__tests__/labelMapping.test.ts`. A test asserts every registry id appears in
> this document — keep the three in sync.
>
> Labels are entered MANUALLY in App Store Connect; this document is the reproducible checklist.

## 1. Questionnaire answers (folded, per data type)

| ASC data type | Linked to identity | Used for tracking | Purposes | Contributing disclosures |
|---|---|---|---|---|
| `User Content` | Yes | No | App Functionality | `cloud_sync`, `cloud_backup`, `cloud_ai_intelligence`, `cloud_document_processing`, `cloud_tts`, `cloud_transcription`, `cloud_web_capture` |
| `Purchases` | Yes | No | App Functionality | `store_transactions` |
| `Usage Data` | **No** | No | Analytics | `web_analytics` |

**Tracking answer for the ASC "tracking" question: No.** Plethora does not track users across
apps/websites; no tracking domains; the privacy manifest declares `NSPrivacyTracking = false`.

## 2. Per-disclosure traceability

| Registry id | Label answer(s) | Evidence pointer |
|---|---|---|
| `cloud_sync` | User Content · linked · app_functionality | E2E-encrypted sync payloads to Plethora relay — `docs/PRIVACY_ARCHITECTURE.md` §2 |
| `cloud_backup` | User Content · linked · app_functionality | Encrypted backup vault — `docs/PRIVACY_ARCHITECTURE.md` §2 |
| `cloud_ai_intelligence` | User Content · linked · app_functionality | Document excerpts/embeddings to AI gateway/providers — `docs/PRIVACY_ARCHITECTURE.md` §2; consent UX in Privacy Center |
| `cloud_document_processing` | User Content · linked · app_functionality | Ephemeral cloud OCR/reconstruction — `docs/PRIVACY_ARCHITECTURE.md` §2 |
| `cloud_tts` | User Content · linked · app_functionality | Sentence text to neural TTS endpoints — `docs/PRIVACY_ARCHITECTURE.md` §2 |
| `cloud_transcription` | User Content · linked · app_functionality | Audio segments to Whisper clusters — `docs/PRIVACY_ARCHITECTURE.md` §2 |
| `cloud_web_capture` | User Content · linked · app_functionality | Capture queue items — `docs/PRIVACY_ARCHITECTURE.md` §2 |
| `store_transactions` | Purchases · linked · app_functionality | StoreKit 2 signed transaction records forwarded over TLS; minimal accounting records, not user-deletable (rationale in registry) — ⏳ finalize against Proposal B's landed implementation |
| `web_analytics` | Usage Data · NOT linked · analytics | Vercel Analytics, web/PWA builds only (`!isTauri()` gate in `src/main.tsx`), cookieless/aggregated |
| `telemetry_crash_reporting` | *(no label row — nothing collected)* | Corrected disclosure: no crash/telemetry SDK ships; zero egress. Verified by `privacyCompleteness.test.ts` dependency sweep |

## 3. Entry procedure (manual, reproducible)

1. Open App Store Connect → App → Privacy → Edit.
2. Answer "Do you or your third-party partners track?" → **No**.
3. Enter the rows from §1 exactly (data type → linked → purposes).
4. Cross-check each row against §2 evidence pointers; if a flow changed, update
   `disclosureRegistry.ts` first, regenerate the draft, update this doc, and let the tests
   (`privacyCompleteness.test.ts`, `labelMapping.test.ts`) verify consistency.
5. Re-run after any registry change: `npx vitest run src/lib/privacy/__tests__/labelMapping.test.ts src/__tests__/privacyCompleteness.test.ts`.

## 4. Pending finalization

- `store_transactions` wording is contingent on Proposal B's landed StoreKit implementation
  (retention/destination strings may shift slightly; the label answer "Purchases · linked ·
  app functionality" is stable).
- If a crash reporter ships under a future proposal, add its row here AND update
  `telemetry_crash_reporting` before it ever transmits.
