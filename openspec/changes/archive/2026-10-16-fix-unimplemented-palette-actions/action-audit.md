# Palette action audit

Audit scope: the effective global catalogue (Actions, View All, typed search), contextual view actions, and registered help actions. Capability gates remain authoritative; supported actions must have visible outcomes. Current runtime validation uses browser/DOM mocks for native services; no native scan, microphone or translation-model hardware result is claimed.

## Confirmed defects and repairs

| Reproduction | Cause | Repair / evidence |
| --- | --- | --- |
| Translate Selection from a reader | Orphan `translate-selection` event | Captured active-reader selection, typed action and passage dialog; selection capture and translation dialog suites |
| Manage/New Queues from a document after slow view loading | Timed delivery, and `/queue` could reopen Scroll Mode | Acknowledged destination request forces queue list; real manager/creation tests after 180 ms delay |
| Manage/New Queues on phone | Only desktop registered listeners | Both layouts use `useSavedQueueActions`; mobile exposes existing manager/customizer |
| Quick Review already active or profiles loaded late | ID-only effect, stale catalogue snapshot | Reactive queue/profile revision; filtered membership/reselection/late-load tests |
| Failed active-profile persistence | Error swallowed after optimistic ID mutation | Commit active ID after successful persistence; failure/retry tests |
| Two Record Lecture entries | Independent Apple/generic registrations | One platform-routed command |
| Search command rejection | Unawaited action; browse/search diverged | Shared executor with rejection feedback and duplicate guard |
| New Queue keyboard operation | Customizer lacked dialog semantics/focus ownership | Dialog role/label and shared focus hook; real dialog tests |
| Ask Library | `/search` alias absent in desktop shell; legacy event reopened same absent route | Existing acknowledged Library Q&A handoff to `/doc-qa` |
| Help settings actions | Query-string paths were passed to exact tab-name lookup | Typed settings-section requests consumed after mount |
| Help reflow/TTS/palette | No handlers for `doc.reflow_toggle`, `toggle-tts`, `open-command-center` | Typed reader actions and the canonical palette-open event |
| Help Flashcard Studio | Event emitted with no Review destination | Acknowledged Review request |
| Help Language / Zen | Unsupported `/language` and `/review?mode=zen` routes | Truthful language settings / card review entry points |

## Effective global catalogue

All rows are available through browse and search subject to capability filtering. Native-only actions require their corresponding runtime. Registry navigation IDs replaced by catalogue IDs are listed as aliases rather than duplicate entries. Queue rows require a loaded current-collection profile for activation; selection translation requires a non-empty active-reader selection. Loading/errors remain visible in queue management.

| Command ID / family | Handler / prerequisite | Observable outcome | Validation |
| --- | --- | --- | --- |
| `new-document` | Documents destination/import picker | File import flow | Destination delivery tests; existing import suites |
| `scan-document` | Android/Apple native vision import, supported native platform | Imported scan or visible failure | Capability fixtures; native execution unavailable here |
| `ask-my-library` | LibraryAskHandoff + Document Q&A | Library question entry | Existing library handoff/hub suites |
| `record-lecture` | One platform-selected capture host | Recording controls/transcription flow | Catalogue platform fixtures; native microphone unavailable here |
| `translate-selection` / `doc.translateSelection` | Active reader, captured passage | Translation dialog/result/setup | Capture + translation dialog suites |
| `tag-untagged-documents` | Smart tagging queue | Enqueue feedback / already-tagged state | Existing smart-tagging tests |
| `cleanup-legacy-auto-tags` | Document updates + tag events | Cleanup result feedback | Code trace; partial failures must be reported |
| `new-flashcard` | Review destination request | Flashcard Studio | Destination tests; ReviewHome studio suites |
| `manage-saved-queues` | Queue list destination | Functional manager | Real dialog integration test |
| `new-saved-queue` | Queue list destination | Functional customizer and persistence | Real dialog test + existing customizer/store suites |
| `switch-queue-*` | Current profile ID, successful persistence | Full saved configuration and filtered queue | Membership, late-data, same-ID, persistence tests |
| `review-browser-imports` | `/needs-review` | Import review workspace | Shell alias code trace |
| `nav-dashboard` | Dashboard tab | Dashboard | Existing shell navigation suites |
| `nav-documents` (`go-documents`) | Documents tab | Library | Existing navigation suites |
| `nav-queue` (`go-queue`) | Recent queue destination | Queue list or recent Scroll Mode | Existing queue navigation behavior preserved |
| `nav-analytics` (`go-analytics`) | Analytics tab | Statistics | Existing navigation suites |
| `nav-settings` (`open-settings`) | Settings tab | Settings | Existing navigation suites |
| `nav-review` (`start-review`) | Review tab | Review workspace | Existing review/navigation suites |
| `nav-image-registry` (`go-image-registry`) | Image registry tab | Images | Existing navigation suites |
| `nav-optimal-queue` (`start-optimal-session`) | Reapply active saved profile, acknowledge ready Queue view, then open Scroll Mode; otherwise open normal Optimal Session | Profile-constrained session | Desktop/phone browser tests inspect real QueueTab handoff data |
| `theme-toggle-variant`, `theme-set-light`, `theme-set-dark`, `theme-next`, `theme-previous`, `theme-switch-*` | Theme context / installed theme | Theme changes | Existing theme/palette suites |
| `toggle-theme` | Shell theme event | Light/dark appearance toggle | Shell handler trace |
| `keyboard-shortcuts` | Shell help event | Shortcuts dialog | Shell handler trace |
| `paste-extract` | UI store dialog | Paste Extract dialog | Existing hub/action suites |
| `import-twitter-video` | Native UI store dialog | X import dialog | Native gate; existing X import tests |
| `start-guided-tour` | Tour replay event | Guided tour | Existing tour/navigation suites |

## Contextual registry inventory

Each action is filtered by its registry prerequisites (format, episode/article target, Vim runtime or selection) and routed to the existing active-view handler. These are browse and typed-search entries. The owner view must be active in the navigation pane. Existing contextual registry/listener tests cover shared dispatch; native playback/download internals remain covered by their subsystem suites.

| ID | Production handler owner | Outcome |
| --- | --- | --- |
| `doc.translateSelection` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.search` | `src/components/settings/KeyboardShortcutsSettings.tsx`, `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.toggleToc` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.nextPage` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.prevPage` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.goToPage` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.zoomIn` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.zoomOut` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.zoomReset` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.createExtract` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.highlightSelection` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.toggleFullscreen` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.toggleVimMode` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.smartTag` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `doc.suggestTags` | `src/components/viewer/DocumentViewer.tsx` | Existing view operation described by action title |
| `rss.search` | `src/components/media/RSSReader.tsx` | Existing view operation described by action title |
| `rss.nextArticle` | `src/components/media/RSSReader.tsx` | Existing view operation described by action title |
| `rss.prevArticle` | `src/components/media/RSSReader.tsx` | Existing view operation described by action title |
| `rss.markRead` | `src/components/media/RSSReader.tsx` | Existing view operation described by action title |
| `rss.markUnread` | `src/components/media/RSSReader.tsx` | Existing view operation described by action title |
| `rss.toggleStar` | `src/components/media/RSSReader.tsx` | Existing view operation described by action title |
| `rss.openOriginal` | `src/components/media/RSSReader.tsx` | Existing view operation described by action title |
| `rss.refreshFeed` | `src/components/media/RSSReader.tsx` | Existing view operation described by action title |
| `rss.markAllRead` | `src/components/media/RSSReader.tsx` | Existing view operation described by action title |
| `rss.cycleViewMode` | `src/components/media/RSSReader.tsx` | Existing view operation described by action title |
| `podcast.search` | `src/components/media/PodcastManager.tsx` | Existing view operation described by action title |
| `podcast.playPause` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `podcast.skipBack` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `podcast.skipForward` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `podcast.markPlayed` | `src/components/media/PodcastManager.tsx` | Existing view operation described by action title |
| `podcast.markUnplayed` | `src/components/media/PodcastManager.tsx` | Existing view operation described by action title |
| `podcast.download` | `src/components/media/PodcastManager.tsx` | Existing view operation described by action title |
| `podcast.refreshFeed` | `src/components/media/PodcastManager.tsx` | Existing view operation described by action title |
| `podcast.toggleTranscript` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `audiobook.playPause` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `audiobook.skipBack` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `audiobook.skipForward` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `audiobook.cycleSpeed` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `audiobook.toggleMute` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `audiobook.toggleChapters` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `audiobook.addBookmark` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `audiobook.toggleTranscript` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `audiobook.toggleSleepTimer` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |
| `audiobook.toggleFullscreen` | `src/components/viewer/AudiobookViewer.tsx` | Existing view operation described by action title |

## Registered help actions

All IDs below are allowlisted, use the shared executor for failures, and are search/help entries. Settings requests wait for SettingsPage; reader actions require an active reader. Navigation and media actions reuse existing tab destinations. No arbitrary action strings execute.

| ID | Handler | Prerequisite / result |
| --- | --- | --- |
| `action.view.dashboard` | `() => dispatchNavigation("/dashboard")` | Go to Dashboard |
| `action.view.queue` | `() => dispatchNavigation("/queue")` | Open Reading Queue |
| `action.view.review` | `() => dispatchNavigation("/review")` | Start Card Review |
| `settings.appearance.eink` | `() => dispatchNavigation("/settings?tab=appearance&panel=eink")` | Open E-ink Settings |
| `settings.appearance.themes` | `() => dispatchNavigation("/settings?tab=appearance")` | Open Theme Settings |
| `settings.learning.algorithm` | `() => dispatchNavigation("/settings?tab=learning&focus=algorithm")` | Configure FSRS-7 |
| `settings.tts.general` | `() => dispatchNavigation("/settings?tab=tts")` | Open TTS Settings |
| `settings.tts.highlighting` | `() => dispatchNavigation("/settings?tab=tts")` | Configure TTS Highlighting |
| `settings.audio.hands_free` | `() => dispatchNavigation("/settings?tab=hands-free")` | Open Hands-Free Audio Settings |
| `settings.sync.cloud` | `() => dispatchNavigation("/settings?tab=sync")` | Open Sync Settings |
| `settings.privacy.billing` | `() => dispatchNavigation("/settings?tab=ai")` | Open AI & Privacy Settings |
| `settings.queue.composition` | `() => dispatchNavigation("/settings?tab=scroll-queue")` | Open Queue Composition |
| `action.reader.toggle_reflow` | `() => dispatchPaletteAction("document-viewer", "doc.toggleReflow")` | Toggle PDF Reflow |
| `action.reader.reflow_toggle` | `() => dispatchPaletteAction("document-viewer", "doc.toggleReflow")` | Toggle PDF Reflow |
| `action.reader.toggle_tts` | `() => dispatchPaletteAction("document-viewer", "doc.toggleTts")` | Toggle Text-to-Speech |
| `action.reader.toggle_vim` | `() => dispatchCustomEvent("palette-action", { view: "document-viewer", actionId: "doc.toggleVimMode" })` | Toggle Vim Reading Mode |
| `action.queue.open` | `() => dispatchNavigation("/queue")` | Open Reading Queue |
| `action.queue.scroll_session` | `() => startPaletteScrollSession()` | Start Scroll Queue Session |
| `action.review.start` | `() => dispatchNavigation("/review")` | Start Card Review |
| `action.review.zen` | `() => dispatchNavigation("/review")` | Enter Zen Review Mode |
| `action.review.flashcard_studio` | `() => requestDestinationAction({ destination: "review", action: "create-card" })` | Open Flashcard Studio |
| `action.language.dictionary` | `() => dispatchNavigation("/settings?tab=language-learning")` | Open Language Dictionary |
| `action.media.podcasts` | `() => dispatchNavigation("/podcast")` | Open Podcasts |
| `action.media.rss` | `() => dispatchNavigation("/rss")` | Open RSS Reader |
| `action.search.knowledge_sphere` | `() => dispatchNavigation("/knowledge-sphere")` | Open 3D Knowledge Sphere |
| `action.search.command_center` | `() => dispatchCustomEvent("command-palette-open")` | Open Command Palette |

## Verification record

- New queue outcome tests initially failed for missing creation-dialog semantics and filtered membership fixtures; after fixes all four pass. Translation dialog tests pass for whole-passage output/provenance, failure/retry/cloud permission, and owner cancellation.
- Shared executor, destination single-consumer/cancellation/supersession, selection snapshot, and saved-store failure/reselection tests pass.
- Browser/layout validation, complete relevant test run, type/lint checks, and benchmark gate are recorded below when finished.

### Integrated acceptance evidence

- `npx playwright test src/visual/palette-actions.visual.spec.ts`: desktop (1440×1000) and phone (390×844), both passed. Uses the production CommandCenter, QueueTab, desktop/mobile queue layouts, manager, customizer, selection dialog, and tab handoff. Only native/backend data is replaced with deterministic fixtures.
- Exercises pointer search → Manage, Actions → New Queue, View All → Quick Review, and keyboard search → Translate Selection. Checks dialog focus, actual filtered rows, provider setup errors, and the palette's Start Optimal Session handoff containing only the selected saved profile's items/types. No real translation request or microphone capture is claimed by this fixture.
- Screenshots: [phone manager](/home/ubuntu/Code/Plethora/.playwright/results/palette-actions-manager-390.png), [phone saved queue](/home/ubuntu/Code/Plethora/.playwright/results/palette-actions-quick-review-390.png), [desktop translation](/home/ubuntu/Code/Plethora/.playwright/results/palette-actions-translation-1440.png). Desktop and phone captures were visually inspected; the existing theme/layout was preserved.
- Broad regression run: **271 tests across 42 files passed**, covering palette/contextual dispatch, saved queue API/store/UI, desktop/mobile queue behavior, help actions, reader selection/language gating, translation/sentence mode, TTS hotkeys, shell navigation, and Scroll Mode rebuilds. Follow-up session and storage tests cover the final repairs, including preservation of an empty custom queue and localStorage quota errors.
- Recording has one command per supported runtime and a retained request that survives lazy host loading; the command/real capture-host mounting tests pass. Android scanning now uses its existing implemented native provider, with the capability-matrix expectation updated accordingly.
- **Native limitation:** no connected native Android or Apple runtime was available. Actual camera scanning, microphone recording, native permissions, and downloaded on-device translation models were not exercised. Capability fixtures, host mounting, translation-provider mocks, and browser behavior were verified instead.
- Mechanical UI scan returned five advisories in existing manager/customizer/mobile styling; none were in the new translation dialog. No visual redesign or unrelated theme/token changes were made.
- Ripwire confirms `getDefaultCommands` retains its existing callable contract. The quality diagnostic retains three consciously reviewed findings: `handleQueue` is a live toolbar-table callback (a static-call-graph false positive), and the manager/desktop queue have recent-edit churn signals. The existing toolbar callback and required queue fixes are retained; no quality baselines or waiver files were changed.

### Final gates

- `npx tsc --noEmit --pretty false`: passed.
- `npx vite build` with the project's production memory setting: passed; existing chunk-size notices remain informational.
- ESLint on every changed/new TypeScript source and test: **0 errors**, 56 existing-style/unused-code advisories across the larger touched modules. New standalone modules have no lint errors.
- `git diff --check`: passed.
- OpenSpec strict validation: passed.
- `npm run bench:check`: **passed**, all **53 benchmarks** compared; bundle budget passed with one PDF worker and **24.4 MB** total output. Faster-than-baseline notices were warnings only. No performance baselines or bundle budgets were changed.
- The final production build and type check ran after the palette session handoff repair. Follow-up browser acceptance passed on desktop and phone with correct saved-session data; the targeted session/limit tests also passed.
- `openspec validate fix-unimplemented-palette-actions --strict`: passed; implementation checklist **20/20 complete**.
