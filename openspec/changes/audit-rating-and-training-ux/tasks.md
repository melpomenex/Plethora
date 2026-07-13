## 1. Fix Bugs

- [x] 1.1 Fix `ManageTrainingView.tsx:137` — replace the literal `"FloppyDisk"` button label with a localized "Save" string (keep the icon).
- [x] 1.2 Verify no other literal icon-name-as-label bugs exist in the training/rating surfaces.

## 2. i18n — Add Translation Keys

- [x] 2.1 Add `training.*` keys to `src/lib/i18n/locales/en.ts`: menu header (`trainIntelligence`), `likeAuthor`, `dislikeAuthor`, `likeKeyword`, `dislikeKeyword`, `likeTag`, `keywordInputPlaceholder`, `showMoreLikeThis`, `showLessLikeThis`, `trainIntelligenceTitle`.
- [x] 2.2 Add `manageTraining.*` keys to `en.ts`: `title`, `searchPlaceholder`, `save`, `pendingCount`, `saveSuccess`, `emptyState`, `noResults`, `switchToDislike`, `switchToLike`.
- [x] 2.3 Add `siteBySite.*` keys to `en.ts`: `complete`, `completeDescription`, `done`, `dislike`, `like`, `skip`, `articleProgress`, `feedProgress`.
- [x] 2.4 Add train toast/error/undo keys to `en.ts` under `training.*` namespace (`trainLiked`, `trainDisliked`, `trainDetail` with `{type}`/`{value}` params, `cannotTrain`, `cannotTrainDesc`, `trainFailed`, `trainUndone`, `undo`).
- [x] 2.5 Copy all new keys into `zh.ts`, `de.ts`, `es.ts`, `fr.ts`, `ja.ts` with appropriate translations.

## 3. Shared Feedback Infrastructure

- [x] 3.1 Create `src/hooks/useTrainFeedback.ts` — a hook that encapsulates: sound selection (like vs. dislike), haptic trigger, and toast display with undo action. It accepts the classifier params, calls `addClassifier`, and on success shows a toast with an "Undo" button that calls `removeClassifier(id)`.
- [x] 3.2 The hook SHALL respect the existing `uiSoundEffects` user setting (check notification/settings store) before playing sounds.
- [x] 3.3 Add a `getTrainedSentiment(feedId, type, value)` memoized selector to `classifiersStore` that returns `"like"` | `"dislike"` | `null` for a given value.

## 4. Apply Shared Feedback to All Training Entry Points

- [x] 4.1 Refactor `RSSScrollMode.handleQuickTrain` to use `useTrainFeedback` (replacing inline sound/haptic/pulse logic, keeping the button-pulse visual state local).
- [x] 4.2 Update `TrainingMenu.handleTrain` to use `useTrainFeedback` so it gains sound + haptic + toast-with-undo (currently fires silently).
- [x] 4.3 Update `SiteBySiteTraining.handleTrain` to use `useTrainFeedback` so it gains sound + haptic + toast (currently fires silently), then advances.

## 5. Already-Trained State Indicator

- [x] 5.1 In `RSSScrollMode.tsx`, derive the trained sentiment for the current article (author or tag) via `getTrainedSentiment`.
- [x] 5.2 Apply filled/active styling to the thumbs-up button when trained sentiment is `"like"`, and to thumbs-down when `"dislike"`, using the existing `trainPulse` color classes as the active style.
- [x] 5.3 Ensure that when the user trains a different sentiment on an already-trained article, the indicator updates immediately after the write resolves.

## 6. ManageTrainingView Polish

- [x] 6.1 Add empty state: when `!isLoading && classifiers.length === 0 && !searchQuery && !filterType`, show a centered message with an icon and the `manageTraining.emptyState` text guiding users to use 👍/👎 on articles.
- [x] 6.2 Add success toast on `handleBulkSave` completion using `manageTraining.saveSuccess`.
- [x] 6.3 Replace all hardcoded strings in ManageTrainingView with i18n calls (`title`, `searchPlaceholder`, filter type labels, group headers, tooltips).
- [x] 6.4 Add a subtle expand/collapse transition animation to `ClassifierGroup`.

## 7. TrainingMenu & SiteBySiteTraining i18n

- [x] 7.1 Replace all hardcoded strings in `TrainingMenu.tsx` with i18n calls (header, item labels, keyword placeholder, tooltips).
- [x] 7.2 Replace all hardcoded strings in `SiteBySiteTraining.tsx` with i18n calls (header labels, button labels, completion screen).

## 8. RatingButtons Mobile & Accessibility

- [x] 8.1 Make the interval-preview text visible on mobile in `RatingButtons.tsx` — remove the `hidden md:block` class and use a responsive font size so it fits the smaller mobile button.
- [x] 8.2 Verify the keyboard focus ring (`focus-visible:ring-4`) renders correctly and tab order follows Again → Hard → Good → Easy.
- [x] 8.3 Add `aria-pressed` semantics where applicable, and ensure screen-reader labels include the interval info on mobile too.

## 9. Verification

- [x] 9.1 TypeScript compiles cleanly (`tsc --noEmit` — 0 errors) across all modified files.
- [x] 9.2 ESLint passes with 0 errors on all modified files (2 pre-existing warnings in RSSScrollMode unrelated to this change).
- [x] 9.3 Code review: all 3 training entry points delegate to `useTrainFeedback` (sound + haptic + toast-with-undo); TrainingMenu closes via `onSuccess`; SiteBySite advances via `onSuccess`.
- [x] 9.4 Code review: no remaining hardcoded English in TrainingMenu, ManageTrainingView, SiteBySiteTraining, or RSSScrollMode training controls (all use `t()` calls).
- [x] 9.5 Code review: `useTrainFeedback` delegates sounds to `soundService` which checks `soundEnabled` internally (soundService.ts:356); `supportsHaptics()` gates haptic.
- [ ] 9.6 **Manual runtime test (user)**: run `npm run dev` (or `npm run tauri dev`) and verify: (a) each training entry point gives sound+haptic+pulse+toast+undo, (b) language switch shows translations, (c) ManageTrainingView empty state + save confirmation, (d) mobile interval previews visible, (e) sound toggle off suppresses sounds, (f) already-trained indicator reflects state.
