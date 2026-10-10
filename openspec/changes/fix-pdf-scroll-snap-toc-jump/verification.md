# Reader positioning investigation and verification

Date: 2026-10-10. Starting revision: `f1a6a7873fe77293818f58f00087bb9c27e36e25`.
Implementation changes and regression tests accompany this report. No device validation has been performed.

## Reproduction

The new regression tests were run against the original EPUBViewer/PDFViewer from the starting revision, then the working implementation was restored. Both selected reproductions failed on the original code:

- PDFViewer navigation integration, “navigates independently to multiple headings on the currently displayed page”: selecting the first heading expected scrollTop 100; actual scrollTop was 0. The current implementation reaches 100 and the next same-page heading reaches 600.
- EPUB reflow integration, “never resizes after wheel input or scroll-driven relocation alone”: the original code unexpectedly called resize once after relocation. The current implementation does not schedule that redisplay.

These are automated reproductions in jsdom with deterministic geometry and mocked document engines. They do not reproduce physical Android inertia or renderer behavior. Temporary command output is in `/tmp/reader-baseline.log` (exit 1, as expected).

## Root causes and corrections

Line references in the “original” column refer to the starting revision; implementation references refer to this working tree.

| Cause | Original evidence | Correction / current evidence |
| --- | --- | --- |
| Continuous EPUB scrolling also became a page turn | EPUBViewer.tsx:1640 and :1647 called next/prev from vertical iframe flicks while using the continuous manager. | EPUBViewer.tsx:1548 gates vertical turns to genuine paginated mode; input inside the iframe document interrupts ownership. Horizontal gestures and selection remain available. |
| Scroll relocation triggered a later EPUB redisplay | EPUBViewer.tsx:1114–1135 installed a 600 ms quiet-period resize, and :1932 forced another initial resize. Resizing uses rendition.location unless a fresh CFI is supplied. | EPUBViewer.tsx:1060 resizes only on host geometry changes. epubNavigation.ts:84 guards internal window resize with live CFI and defers TOC-time resize to the target heading. Guards install after async manager creation at EPUBViewer.tsx:1283. |
| EPUB anchor fallbacks and engine queues could lose authority | EPUBViewer.tsx:2859 used the wrong fallback spine collection (`items`), then fell back to chapter index/URL navigation. There was no identity on asynchronous TOC work. EPUB.js rendition.js:306 resolves the previous display deferred before its actual section work finishes. | epubNavigation.ts:5 resolves ID/name fragments to real heading CFIs using spineItems; missing headings fail without chapter-only success. :34 queues real display work and rejects stale queued/in-flight scroll writes, including paginated turns. EPUBViewer.tsx:2800 checks the same ticket after every await and aligns the mounted heading after font/image readiness. |
| Same-page PDF TOC depended on a page-number change | PDFViewer.tsx:3543 populated pendingNavRef and called onPageChange. The applying effect around :3199 relied on page-number dependencies, so another heading on the same page did not trigger it. | PDFViewer.tsx:3300 claims a unique request before lookup. :3006 applies on request revision and actual viewport/slot readiness, independently of page-number updates, then verifies clamped arrival in a frame. |
| PDF reflow navigated to the containing page | Original PDFViewer handleTocClick used scrollReflowToPage and discarded heading coordinates. | pdfTocDestination.ts:48 compares transformed PDF source regions/rectangles; PDFViewer.tsx reflow navigation effect scrolls the corresponding rendered block with 16 px padding. Delayed analysis reruns only the active request. |
| PDF restoration and settling could override later input | PDFViewer.tsx:2213 loaded saved positions from an effect that reran; :3194 and later code clamped to restoredPageRef during a time window. :3111–3149 completed settle polling even on timeout. :2644 restored percentage snapshots after resize. | PDFViewer.tsx:1350 permanently revokes initial authority on real input; :2253 runs standalone restoration once. :2558 preserves a live PDF source point on actual fit resize. TOC completion requires actual arrival, with no timeout claiming success. |
| Parent and child both retried old PDF positions | DocumentViewer.tsx:3980–4031 verified with coarse tolerances and repeatedly advanced restoreRequestId every 200 ms; :3513 reset restoration on tab visibility recovery. | DocumentViewer.tsx:3544 resets only for a new document. :3818 receives child arrival verification; :7807 disables the child's competing saved-position fetch. Same-page navigation-start cancels the parent immediately. PDF tab reactivation no longer replays saved state. |
| Virtualization replaced known geometry with estimates | Original PDFViewer cleared per-page viewport/scale refs when unmounting; spacer/offset calculations used fallback sizes afterward. | PDFViewer.tsx:771 retains normalized measured heights separately from mounted views. pdfNavigationStability.ts:59 builds cached prefix offsets, reused for spacers and page detection. |
| TTS could mistake direct iframe gestures or a pending TOC for follow-owned scrolling | The follow hook observed outer scroll/touch behavior with arrival grace; iframe input does not bubble to the host. PDF highlight rendering also had a separate viewport-follow write. | useSpokenWordFollow.ts observes iframe documents and cancels queued follow on direct input and scoped navigation-start. PDF highlighting leaves following to this controller. Re-center resumes follow; only a successfully settled latest TOC invokes host TTS anchor synchronization. |

## Ownership and readiness

`src/lib/readerNavigation.ts` supplies four states: initial-restoration, user-scroll, toc-navigation, idle. Every new action advances an identity and aborts resource waits. Once input or navigation revokes initial restoration, settling cannot re-enable it. Viewport writers check identity rather than waiting for a lockout to expire.

EPUB readiness is section display completion, font readiness, image load/error above the destination, then mounted heading alignment. PDF readiness is real destination page geometry at the requested scale, or a ready semantic page and mounted reflow block. Manual input invalidates those requests before late callbacks can write. Existing persistence/context debounces remain; they are not navigation-settle criteria.

## Automated regression coverage

- `readerNavigation.test.ts`: authority transitions, permanent restore revocation, direct iframe input.
- `epubNavigation.test.ts`: exact/encoded fragments, missing anchors, queued and in-flight cancellation, image load/abort, live resize CFI, deferred target resize, paginated turn supersession.
- `EPUBViewer.test.tsx`: asynchronous manager startup, actual iframe vertical flicks in both modes, horizontal flick preservation, plus existing reader/selection/theme tests.
- `EPUBViewer.reflow.test.tsx`: geometry-driven resize and no relocation/quiet-period redisplay.
- `PDFViewer.navigation.test.tsx`: same-page headings, rapid requests, backward/forward input cancellation, delayed virtualization, exact reflow blocks, delayed analysis/cancellation, stale parent restore, reopen restoration, late saved-position cancellation, and zoom-readiness transforms.
- `pdfTocDestination.test.ts`: XYZ null axes, all fit destination types, scale/quarter-turn transforms, canonical/prototype source block mapping, fit zoom.
- `pdfNavigationStability.test.ts`: mixed page-height prefix offsets and existing stability contracts.
- `useSpokenWordFollow.test.ts`: touch/iframe interruption, navigation-start interruption, follow/Re-center, existing playback and visibility behavior.
- Broad viewer suites include PDF bookmarks, canonical/reflow geometry, selection, persistence helpers and reader wrapper tests.

The viewport tests use deterministic engine contracts rather than a physical PDF.js/EPUB.js renderer. Rotation tests verify delegation to viewport transforms; visual accuracy on rotated/cropped source files still needs device execution. The reopen test supplies saved positions to the API contract; real backend storage round trips remain device/integration verification.

## Command results

| Command | Result |
| --- | --- |
| `npx vitest run src/components/viewer/__tests__ src/hooks/__tests__/useSpokenWordFollow.test.ts src/utils/__tests__/epubWordHighlight.test.ts src/utils/vim/__tests__/formatNavigation.test.ts` | Passed: 56 files, 361 tests. Existing act warnings remain. An earlier broad run had a timing failure in unchanged ImageSaveOverlay; isolated and subsequent broad runs passed. |
| `npx tsc --noEmit` | Blocked by unchanged `src/stores/__tests__/queueAdaptiveLoad.test.ts:65`, TS2493 (empty spy call tuple indexed at 0). No changed-file TypeScript errors in the completed check; this unchanged file has no working diff. |
| ESLint on changed TypeScript files | Passed, 0 errors, 30 warnings in existing large viewer code. |
| `NODE_OPTIONS=--max-old-space-size=8192 npx vite build` | Passed: production build completed. Existing chunk-size/externalization warnings remain. |
| `npm run bench:check` | Passed: 50 calibrated benchmarks compared; bundle gate passed (entry 5 KB, one PDF worker, total 24.2 MB). Three warnings report older baselines slower than current measurements (article import, DOM tabs, rain). No regression, baseline or budget relaxation. |
| `npx openspec validate <change> --strict` for the PDF, EPUB and TTS changes | Passed for all three amended changes. |
| `ripwire src --quality-delta --legend=compact` | Gating 0. Minor existing-function increases and new adapter complexity are reported, not suppressed. Root-directory scan included ignored vendored C++ and produced an unrelated clone gate; rerunning against src avoids that unrelated corpus. |
| `ripwire src --edit-check=EPUBViewer.tsx:handleTocClick` | Unchanged arity, no incompatible callers reported. PDF useCallback navigation is not indexed as a standalone symbol by this analyzer; component regression tests cover its contract. |
| `git diff --check` | Passed. |
| `adb devices -l` | Empty device list. No installation or real-device execution performed. |

## Android verification matrix — ALL PENDING

Record device model, Android version, WebView package/version, APK revision, display mode and orientation before each run. Use a normal phone WebView and, when available, an e-ink Android device for paginated navigation. Do not change these rows to pass without actually running them.

| Mode / fixture | Steps and expected result | Status |
| --- | --- | --- |
| EPUB continuous, several headings in one chapter | Choose each heading, including encoded #fragment and named anchors; heading appears with small padding. Rapid A/B/A ends at A. | Pending |
| EPUB continuous, image-heavy/slow chapter | Jump across chapters while resources load; touch-scroll both directions before readiness. No older display/resize returns to the old location. Repeat with font size changes and rotation. | Pending |
| EPUB continuous native touch | Long vertical drags and inertia stay continuous; do not cause next/prev page turns. Horizontal edge swipe retains Android back behavior. | Pending |
| EPUB paginated / e-ink | Genuine vertical flicks still turn pages; TOC reaches the heading's correct column/page. New TOC supersedes a loading page turn. Selection/link activation does not turn pages. | Pending |
| PDF fixed, several headings on one page | Select two same-page XYZ/FitH destinations and rapidly alternate them; each has a distinct arrival, latest wins. | Pending |
| PDF fixed, cropped/rotated/zoomed pages | Exercise XYZ null coordinates and explicit zoom, Fit/B/H/BH/V/BV/R at 0/90/180/270 degrees. Confirm actual heading, visible padding and fit geometry. | Pending |
| PDF fixed, long mixed-size virtualized document | Jump to an unmounted distant page, then interrupt with forward/backward input. Delayed canvas/text layers and unmount/remount preserve the current location. Resize a side panel and rotate after scrolling. | Pending |
| PDF reflow, semantic headings and OCR pages | TOC reaches the matching block, including multiple headings on one page. Navigate before analysis completes, rapidly change target, then interrupt. Missing blocks must not claim successful page-only arrival. | Pending |
| PDF reflow, assets/font changes | Navigate while images/OCR assets render; adjust font/line-height/margins and rotate. Current reading block remains legitimate, with no replay of old navigation. | Pending |
| Both formats, saved positions/bookmarks | Scroll/jump, wait for persistence, close/reopen, switch tabs/background/foreground. Restore the latest legitimate location once; subsequent backward/forward scroll remains free. Open bookmarks and passage citations. | Pending |
| Both formats, selection/back gestures | Drag Android selection handles, open selection actions, save/bookmark, use horizontal system back and volume/tap navigation. No unexpected page turn or stale correction. | Pending |
| Both formats, TTS | Follow while playing; touch or TOC interrupts pending follow immediately. Verify latest TOC rebases playing/paused/stopped anchors without autoplay from stopped. Re-center resumes follow, highlighting and selection survive. | Pending |

The implementation and automated verification are complete subject to the command results above. Native Android positioning, touch arbitration, inertia, renderer timing and storage round trips remain unverified. Keep task 3.2 open and do not archive this change as device-validated.
