# Mobile haptic interaction inventory

Audited 2026-10-09 against local and `origin/HEAD` revision `7976f42b1d9f4ddc8d61d800f680d250bf76d4e4`. The revision still matches the planning audit. The working tree now contains the OpenSpec change and its uncommitted implementation; the native plugin pins `tauri-plugin = 2.6.3` and `tauri = 2.11.5`. `AGENTS.md` requires committing directly to `main`, and `plethoraNativeBackEnabled` still defaults false in `src-tauri/gen/android/app/build.gradle.kts`; native Back remains opt-in. Paths below are repository-relative.

## Delivery and legacy call-site audit

The following exhausts the production direct vibration sites and calls to the imported legacy `vibrate` helper found by `rg -n 'navigator\.vibrate|\bvibrate\(' src`. Test doubles and comments are excluded from the migration count.

| Site | Current behavior / problem | Required disposition | Validation |
| --- | --- | --- |
| `src/utils/soundService.ts`, former `supportsHaptics`, `vibrate` | Previously coupled audio to browser API detection and millisecond patterns. | Hardware API and patterns removed; audio service now handles audio only. | A04, A06–A09, A21; production scan |
| `src/hooks/useHapticFeedback.ts`, `trigger` | Previously called sound and vibration under one sound preference. | Retains sound/visual compatibility behavior; it no longer performs hardware output. Named interaction owners are only partially migrated. | A01, A03, A10; A12–A16 |
| `src/hooks/useSwipeGestures.ts`, `SwipeableItem.tsx` | Previously pulsed before calling a swipe action. | Generic recognizer and wrapper no longer output hardware feedback; committed action owners remain to be migrated. | A10, A17; D10 |
| `src/hooks/useRatingJoystick.ts`, `handleTouchMove` | Previously pulsed on all zone changes, including entering the null zone. | Emits only non-null transitions with gesture ID and ordinal through synchronous policy admission. | A10, A14; D07 |
| `src/hooks/useLongPress.ts`, timeout | Previously pulsed before callback. | Direct output removed; accepted menu/context owners still need typed activation events. | A10, A15; D09/D10 |
| `src/hooks/useTrainFeedback.ts` | Previously pulsed before the write. | Emits `library.training-committed` only after classifier persistence; training sounds remain independent. | A10, A20; D14 |
| `src/components/media/RSSScrollMode.tsx` | Local helper pulsed on swipes and favorite. | Local direct output removed; persisted favorite/read outcomes are not yet centralized. | A10, A20; D14 |
| `src/components/common/Toast.tsx`, `useToast.error` | Previously called legacy error vibration from the toast helper. | Hardware output removed; sound remains. Owned error/toast token handoff is not yet implemented. | A10, A20, A22; D17 |
| `src/lib/feedback/orchestrator.ts`, haptic delivery | Previously haptic delivery depended on sound role and awaited unrelated capability work. | Independent haptic preferences/effects and synchronous admission are implemented; full event ownership and scenario coverage remain outstanding. | A01, A05, A09–A11, A22 |
| `src/lib/navigationFeedback.ts`, completion adapter | Legacy click was gated by `notifications.feedbackSoundsEnabled`. | Emits `navigation.back-completed` through independent haptic policy while preserving completion/defer/suppress IDs. | A10, A19, A22; D13 |

`SwipeableItem.tsx` no longer calls a recognizer output helper. The first-party plugin now exists in `src-tauri/plugins/plethora-haptics/`.

The final production scan finds browser API output only in `src/lib/feedback/haptics/browserDriver.ts`. Native platform execution and broad owner migration still require their listed build, integration, and device gates.

### Every `useHapticFeedback` consumer found

`src/components/review/{ReviewSession,ReviewFeedback,ZenReviewMode,FlashcardScrollItem,ArenaChoiceRail,AlgorithmArenaDecision,MemoryHorizon}.tsx`, `src/components/viewer/selectionInteraction/DictionaryPeek.tsx`, `src/components/common/ConfirmDialog.tsx`, and `src/components/extracts/DeleteConfirmDialog.tsx`.

ReviewSession emits completion/streak in handlers; ReviewFeedback emits the same types when mounted; ReviewComplete separately emits domain completion and delayed streak feedback. FlashcardScrollItem and ZenReviewMode emit pre-submit clicks. Arena and MemoryHorizon selection feedback must share selection identities with their parent. DictionaryPeek emits whenever its target effect runs, even when opening was not an explicit long-press. ConfirmDialog and DeleteConfirmDialog must not acknowledge opening a destructive confirmation as if deletion succeeded.

`useLongPress` consumers found: `useSurfaceMenu.ts`, `DocumentsView.tsx`, `PodcastManager.tsx`, `MobileQueueView.tsx`. The surface-menu layer already handles movement cancellation and swallowed trailing clicks; preserve that behavior.

## Interaction-to-effect and ownership contract

All effects are foreground-only, require enabled preferences/capability, and pass the shared admission limits in design §Decisions 6. A dash means deliberate silence. Rows sharing one operation share its feedback identity; they are not invitations to emit at every layer.

### Identity and success-boundary crosswalk

The `interactionId` is an opaque, nonempty ID of at most 128 characters and is created at the accepted user action, then passed through component/store/toast handoffs. Do not derive it from content text. The registry combines `eventId` and `interactionId` with `step` for reservation/dedup. Use the following stable operation identities; allocate a new visit/gesture/operation token when the user begins a genuinely new action.

| Inventory event family | Operation identity and successful boundary | Validation |
| --- | --- | --- |
| Review reveal / grade / options | `review:{sessionId}:{cardId}:{visitId}:reveal`, `...:grade`, `...:option:{choiceId}`; reveal after hidden→shown, grade after persisted commit, choice only after changed selection. Current owner: `reviewStore.showAnswer`, committed non-final grading, and `selectArenaChoice`; covered by `src/stores/__tests__/reviewStore.test.ts`. | A10, A12, A13 |
| Joystick / gesture / pull threshold | `gesture:{gestureId}:grade:{transitionOrdinal}`, `gesture:{gestureId}:context`, `gesture:{gestureId}:refresh-armed`; accepted non-null grade transition, visible accepted context activation, and first threshold crossing respectively. | A14, A15, A18 |
| Reader saves / bookmark / tool | `reader:{operationId}:save`, `reader:{operationId}:bookmark`, `reader:{operationId}:tool:{toolId}`; after persistence succeeds or actual mode changes. Toast receives same operation ID and handled-channel token. | A10, A16 |
| Queue / Library / bulk action | `action:{operationId}:commit`, `action:{operationId}:result`; after committed mutation, with one result per batch (partial=warning, total failure=error). | A10, A17, A20 |
| Navigation / Back / sheet | Existing Back transition ID as `navigation:{transitionId}:back`; `navigation:{operationId}:tab|destination|sheet`; only accepted destination/transition completion. | A19 |
| Import / training / media task | Existing job/feedback operation ID as `task:{operationId}:result`; after foreground user-requested commit/completion, once per batch. | A20 |
| Toast / critical incident | Existing handled operation ID or stable incident ID as `feedback:{incidentId}:{result}`; only meaningful unowned foreground outcomes, once per incident. | A10, A20, A22 |
| Settings / capabilities / passive events | No interaction ID and no perform request. Configuration is keyed by driver session and revision; capability reads are cached. | A01–A09 |

For all families, pending, rejected, cancelled, unchanged, automatic, repeated-render and background paths do not cross a success boundary and remain silent. Error/warning effects are emitted only by the owner that knows the operation failed; generic toast helpers reuse that identity rather than infer a second result.

| Interaction | Event / effect | Sole owner and relevant existing paths | Completion criterion / silence rule |
| --- | --- | --- | --- |
| Explicit answer reveal, including scroll and Zen | `review.answer-revealed` / activation | `showAnswer` in `src/stores/reviewStore.ts`, shared by ReviewSession, scroll, Zen and keyboard flows | One hidden→shown transition per card visit; silent repeated reveal/remount. |
| Four-/six-grade tap, keyboard or accessible activation | `review.card-graded` / commit | Successful non-final commit branch in `src/stores/reviewStore.ts`; final card is left to session completion | One accepted persisted submission, including Arena confirmation; no success while pending or failed. |
| Joystick detent | `review.grade-boundary-crossed` / selection | `src/hooks/useRatingJoystick.ts` | One per meaningful accepted non-null grade transition, not movement frames, dead zone or cancel. |
| Arena option / interval choice | `review.option-selected` / selection | `selectArenaChoice` in `src/stores/reviewStore.ts`, called by `ArenaChoiceRail.tsx`, `AlgorithmArenaDecision.tsx`, and `MemoryHorizon.tsx` | Actual changed choice; selecting same choice and custom interval typing are silent. Commit owned above. |
| Quick review and scroll review ratings | `review.card-graded` / commit | `QuickReviewWidget.tsx` callback host, `ReviewQueueView.tsx`, `FlashcardScrollItem.tsx` host | Same success rule for alternative mobile modes; child button does not emit too. |
| Last review commits | `review.session-completed` / completion | Review store completion branch / queue session owner; `ReviewComplete.tsx` presents and plays existing sound only | Nonempty completed session, once by session ID; replace final-card commit effect with completion. |
| New streak target or personal best | `review.streak-milestone` / celebration | Committed session milestone calculation, keyed by streak date/value | Newly crossed day targets 10, 20, 30… or new longest streak; not every card while value is divisible by ten. Replace completion when coincident. |
| Review-count milestone | `review.progress-milestone` / celebration | Session owner at crossed counts 25, 50, 100, then multiples of 100 | Crossing only; final-session effect takes precedence. `ReviewFeedback.tsx` is visual-only. |
| Word long-press / dictionary peek | `reader.context-activated` / activation | `useSelectionInteraction.ts` accepted explicit intent; `DictionaryPeek.tsx` consumes activation ID | One custom activation after visible peek/menu; lookup refresh, target updates, native text menu and selection handles silent. |
| Document/Queue/Library context long-press | `interaction.context-activated` / activation | `useSurfaceMenu.ts` accepted visible menu; row-specific owner where not using it | Same activation token as recognizer; no second sheet-open effect. |
| Highlight created | `reader.annotation-saved` / success | `src/hooks/useToastExtract.ts` after `createExtract`, viewer-specific save path where independent | One confirmed save across PDF/EPUB/HTML/Markdown/RSS; success toast carries handled token. |
| Extract / cloze / vocabulary card saved | `reader.annotation-saved` / success | `useInlineExtraction.ts`, `DocumentViewer.tsx`, `DictionaryPeek.tsx`, `CreateExtractDialog.tsx` | After successful persistence; one event across dialog, helper and viewer callback. |
| Annotation color/edit/delete | `reader.annotation-saved` / success; delete `action.committed` / commit | `HighlightLayer.tsx` / extract dialog commit owner | Only saved mutation; color hover and dialog opening silent. |
| Bookmark added / removed | `reader.bookmark-saved` / success; removal `action.committed` / commit | `src/components/position/BookmarkManager.tsx` | After API succeeds; reading-position autosave silent. |
| Meaningful reading tool selection | `reader.tool-selected` / selection | `SelectionActionBar.tsx`, `SelectionActionsSheet.tsx`, `DocumentViewer.tsx` accepted mode change | Changing highlight/selection/reading mode; invoking save delegates to save owner. Copy, pronounce, scroll and page progression silent. |
| Queue swipe postpone / suspend | `review.card-action` / commit (or error) | `MobileQueueView.tsx` action handler and shared `src/components/review/queueActions.ts` | After accepted mutation, one operation token; `SwipeableItem.tsx` is visual/recognizer only. Partial swipe/cancel silent. |
| Queue action sheet / mark done / undo | `review.card-action` / commit | Shared queue action owner | One committed operation; action-sheet presentation caused by long-press shares activation token. |
| Selection-mode activation | `queue.selection-mode-entered` / activation | `MobileQueueView.tsx` and document selection mode host | One false→true transition; if same long-press opens mode, activation replaces menu cue. |
| Select/deselect row in active mode | `queue.selection-changed` / selection | Selection handler in `MobileQueueView.tsx`, `DocumentsView.tsx` | Actual selection change, bounded; no pulses for programmatic select-all items. |
| Bulk suspend/delete/tag/move | `action.committed` / success | Queue/Documents bulk operation handler | One batch result, not per item; partial failure produces one warning, total failure error. |
| Pull-to-refresh threshold | `queue.refresh-armed` / threshold | `src/components/mobile/PullToRefresh.tsx` | First threshold crossing only per touch lifecycle; retreat/re-cross does not repeat. New gesture resets latch. |
| Refresh completion / failure | success silent; `action.failed` / error on failure | PullToRefresh owning async operation | Threshold supplies sufficient tactile success; meaningful refresh failure once. No initial pull/release spinner pulse. |
| Primary tab change / More destination | `navigation.primary-tab-selected` / selection | `MobileNavigation.tsx` after active destination changes | Actual user-requested tab activation; same tab/programmatic restore silent. More panel opening silent. |
| Application Back | `navigation.back-completed` / selection | Existing `src/lib/navigationFeedback.ts` completion adapter | Only `.complete()`; preserve native ACK, dirty-confirm defer/suppress, transition IDs. Root, block, pending, cancellation silent. |
| Significant reader/source destination | `navigation.destination-opened` / activation | `DocumentViewer.tsx` / `ExtractReader.tsx` explicit source-return handler | Successful user destination change where no primary-tab/Back cue applies; ordinary links/page turns/search result traversal silent by default. |
| Sheet snap / drawer interaction | `interaction.sheet-committed` / activation | Registered user sheet action owner, including `SelectionActionsSheet.tsx` | Explicit meaningful detent only when no context/Back/save event owns it; automatic layout/drag frames/dismiss animation silent. No new drawer gesture. |
| Single/batch document import | `import.completed` / success; `import.failed` / error | Existing `src/stores/documentStore.ts` import feedback owner | Foreground user import once per operation/batch; no per-file or background feed refresh vibration. |
| Document rename/move/delete/export | `action.committed` / commit or success | `DocumentsView.tsx` committed command handler / `DocumentViewer.tsx` rename | Confirmed mutation or completed explicit export; confirmations/cancel silent. |
| Feed/subscription/favorite/queue add | `library.action-committed` / commit | `RSSReader.tsx`, `PodcastManager.tsx`, `MediaLibrary.tsx`, RSS favorite commit handler | User mutation succeeded; choose shared store or handler, never both. |
| Content training like/dislike, including swipe | `library.training-committed` / success | `src/hooks/useTrainFeedback.ts` | Successful classifier/feedback write once; RSS gesture does not also emit. Failed writes error; empty input no success. |
| Media play/pause/seek/speed | — | `MediaLibrary.tsx`, `PodcastManager.tsx`, player paths | Ordinary playback commands and continuous scrub silent; changed discrete study mode selection uses selection only. |
| Save media clip / explicit download | `action.committed` / success | `ClipExtractor.tsx`, owning download completion | One persisted clip / explicit download outcome; progress/time polling/transcript word highlighting silent. |
| Transcription/source conversion/manual synthesis | Existing transcription events or `task.completed` / completion; failure error | Existing job feedback owner / `DocumentViewer.tsx` conversion result | Visible significant user-requested task only, once per job; not background auto-transcription or streamed fragments. |
| Search / AI answers | —; `action.failed` / error only significant explicit failure | `GlobalSearch.tsx`, `SearchResults.tsx`, assistant commit owner | Query typing, result focus and token generation silent; persisting generated cards uses saved-action owner. |
| Focus phase complete | `focus.phase-completed` / completion | Existing focus event owner | Visible task completion under its own timer controls and independent haptic preference; no background app-driver vibration. |
| Toast success/warning/error compatibility | `feedback.confirmed`, `feedback.warning`, `feedback.error` / matching effect | `src/components/common/Toast.tsx` helper adapter | Unowned important foreground action only; handled token prevents duplication. Info/progress/autosave toasts silent. |
| Data-critical warning/error | Existing sync/recovery event / warning or error | Existing feedback orchestrator | Visible critical result once per incident; no haptic retries on persistence/log failure. |
| Delete confirmation | — | `ConfirmDialog.tsx`, `DeleteConfirmDialog.tsx` | Opening/closing is silent unless successful Back owns dismissal; committed deletion owns output. |

## Audit completion rules

Each integration task must record the actual owner, identity source, async success boundary and test for its rows. Scan aliases/imports as well as string matches. At completion only `src/lib/feedback/haptics/browserDriver.ts` may call the browser vibration API; no component/hook/audio module may perform hardware output. All listed `useHapticFeedback` consumers must be migrated or retained as explicitly policy-governed compatibility wrappers. New unlisted micro-interactions default to silence until a policy and owner are added.
