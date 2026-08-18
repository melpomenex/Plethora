# Change notes — fix-legacy-issue-44-regressions

## Triage coverage audit (task 12.5)

Every UNRESOLVED / PARTIALLY FIXED row of the proposal's triage matrix
shipped code plus a regression test:

| Bug | Shipped at root cause | Regression coverage |
| --- | --- | --- |
| 01 Universe centering | `shouldFollowUpdatedHome` pure gate + scope-tween in `engine.setData`; `datasetKey` on both hosts; core-based `layout.center` | `cameraFit.test.ts` (follow-home cases), `layout.test.ts` (core center + rim-inclusive bounds) |
| 02 NotebookLM empty list | fail-closed `parse_notebook_list`; exit-0-non-JSON errors; `verify_cli_session` on strategies 1/2 and `notebooklm_connect`; 20s/45s timeouts + Retry | 8 Rust tests (faked CLI), NotebookLMPage timeout/empty tests |
| 03 `#` mentions | id tokens + `sectionForToken`; raw query history; popup loading/unavailable states; normalized matching with named duplicates; pseudo-document resolution | sectionIndex normalization tests, DocumentQATab chip-survival/history test, SectionMentionPopup state tests |
| 04 OCR | startup `ensure_processor_initialized`; provider preflight + install guidance; language threading; PDF all-failed semantics; dead stubs deleted; settings push | 3 Rust tests + OCRSettings/cold-start frontend tests |
| 05 Due All | forecast counts extracts/video + leading overdue bucket; uniform default-collection scoping across all four item types; import collection threading | repo + queue.rs scoping tests, forecast test, import test |
| 06 search teardown | surgical mark unwrap on every effect run; `selectedText` memo dep | `MarkdownViewer.search.test.tsx` (5), V2 selection suites green |
| 07 redirectors | table-driven unwrap in `handleBridgeNavigate`; Tauri watchdog + un-gated blocked state; pre-existing `initialUrl` render-loop fixed | `searchRedirectors.test.ts` (8), `WebBrowserTab.watchdog.test.tsx`, proxy Rust tests green |
| 08/12 extract editor | one shared editor (create + edit); `html_content` write path; focus-safe annotations (mousedown-preserve, Cmd/Ctrl+B/I/U); markdown rendering in reading surfaces | `CreateExtractDialog.parity.test.tsx` (9), `RichContentRenderer.markdown.test.tsx`, Rust html_content roundtrip |
| 09 image ingest | dialog-level paste routing; drop handling (dialog + registry); full-resolution embeds | paste/drop/full-res cases in the parity suite |
| 10 decks | `ensureDecksExist` on studio save + assistant tool-call decks; disposition below | store picker↔manager parity test |
| 11 category | `ItemCategoryEditor` in the queue popover and Library context menu; dedicated `clear_document_category`; analytics groups document categories | `ItemCategoryEditor.test.tsx` (5), Rust set/preserve/clear + analytics tests |

Security configuration is unchanged (no edits to `tauri.conf.json`, the
iframe sandbox attribute set, or `web_proxy.rs`); redirector targets flow
through the existing `isSafeWebUrl` + per-hop proxy validation. No CI test
requires a live third-party service (manual tasks 2.6/7.4 are the only
real-service checks).

## Bug 10 disposition ("Default Deck" at card creation but not in Deck Manager)

**The literal artifact never existed in this repository.** A pickaxe search
across the full commit history (`git log -S "Default Deck" --all`) finds no
commit that ever created, seeded, or referenced a `"Default Deck"` entity.
Decks are virtual tag filters in one shared zustand store
(`src/stores/studyDeckStore.ts`) read identically by the studio picker and
Deck Manager, so the reported creation-vs-manager divergence cannot occur
through the current code paths.

The adjacent real gap is hardened instead: cards saved with a deck reference
(studio picker tags, the transient `:deck` seed, and `deck:` tags — including
assistant tool-call tags) now materialize the corresponding `StudyDeck` via
the existing `ensureDecksExist` in the same save action
(`FlashcardStudioModal.handleSaveSelected`, `AssistantPanel`'s saved-cards
effect), and a regression test pins the picker↔manager parity invariant
(`studyDeckStore.test.ts` — "materializes a new deck referenced at
card-save time"). No synthetic default deck is introduced (design D10): the
app's model is "No deck" plus real user decks. Decks remain per-device
localStorage state (documented behavior, unchanged).

## Bug 07 manual verification record (task 7.4)

Live Google/DuckDuckGo/Bing result-click verification against the real
engines requires the running app and is intentionally not CI. Known scope:
the unwrap table covers `google.com/url?q=`, `google.com/imgres?imgurl=`,
`duckduckgo.com/l/?uddg=`, and `bing.com/ck/a?u=a1<base64url>`; unknown
redirectors degrade to today's behavior plus the new blocked-frame watchdog.

## Manual tasks outstanding

- 1.5 — Universe scope-switch reframing on the running app (all hosts).
- 2.6 — NotebookLM login → list → empty-account → expired-session against
  the real bundled CLI; re-pin `notebooklm-py` past `0.8.0rc1` only when a
  stable release ships.
- 6.4 — Reader search teardown repro (note → AI action → search → clear →
  AI action) with selection-interaction V2 on and off.
- 7.4 — Live search-engine result clicks in the embedded browser.
- 8.6 — Extract funnel divergence replay (select-text vs lightbulb extract,
  then attach an image and bold text to each).
