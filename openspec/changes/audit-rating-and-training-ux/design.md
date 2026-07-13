## Context

The app has two core interaction loops that depend on button-driven user input:

1. **Spaced-repetition review ratings** — `RatingButtons.tsx` emits Again/Hard/Good/Easy, wired through `submitRating` → `submitReview` → Tauri `submit_review` (FSRS scheduler). Fully functional.
2. **RSS intelligence training** — three entry points (quick-train thumbs in `RSSScrollMode`, context menu `TrainingMenu`, walkthrough `SiteBySiteTraining`) plus a management view (`ManageTrainingView`). All wired through `addClassifier` → `add_rss_classifier` command and `recompute_all_intelligence_scores`. Fully functional.

An exhaustive audit confirmed **zero stub or no-op handlers**. Every button traces to a real backend write. The problem is purely UX quality:

- **i18n gap**: `TrainingMenu`, `ManageTrainingView`, `SiteBySiteTraining`, and the quick-train strings in `RSSScrollMode` use hardcoded English. The rest of the app supports 6 languages.
- **Feedback inconsistency**: `RSSScrollMode.handleQuickTrain` is the gold standard — it plays a distinct sound for like vs. dislike, fires haptic, pulses the button visually, and shows a toast. But `TrainingMenu.handleTrain` and `SiteBySiteTraining.handleTrain` fire silently with no feedback at all.
- **Cosmetic bug**: `ManageTrainingView.tsx:137` renders `"FloppyDisk"` as the save button's text label.
- **Missing affordances**: no undo, no already-trained indicator, no empty states.

## Goals / Non-Goals

**Goals:**
- Achieve 100% i18n coverage across all rating and training surfaces (6 languages).
- Unify feedback to the gold standard: every training action gives immediate multi-sensory confirmation (sound + haptic + visual + toast).
- Add undo to every training action so mistakes are recoverable.
- Show already-trained state on thumbs buttons so users can see what the system has learned.
- Fix the `FloppyDisk` label bug.
- Add empty states and success confirmations to `ManageTrainingView`.
- Improve mobile experience for `RatingButtons` (interval preview visibility).

**Non-Goals:**
- No backend/Rust command changes — purely frontend.
- No new classifier types or scoring algorithm changes.
- No redesign of the overall layout or information architecture — polish only.
- No new languages beyond the existing 6 (en/zh/de/es/fr/ja).

## Decisions

### Decision 1: Shared `useTrainFeedback` hook for consistent feedback

**Choice**: Extract a `useTrainFeedback()` hook that encapsulates the gold-standard feedback pattern (sound selection, haptic, visual pulse, toast with undo) and is consumed by all three training entry points.

**Why**: `RSSScrollMode` currently owns the feedback logic inline. Duplicating it into `TrainingMenu` and `SiteBySiteTraining` would be copy-paste. A shared hook ensures consistency and makes future changes (e.g. a settings toggle for sounds) a single-point edit.

**Alternatives considered**:
- *Apply feedback inside the `classifiersStore.addClassifier` action*: rejected because the store shouldn't own UI concerns (sounds, toasts). The store is already consumed by non-UI code paths (batch recompute).
- *Per-component inline implementation*: rejected due to drift risk.

### Decision 2: Undo via toast action calling `removeClassifier`

**Choice**: After a successful `addClassifier`, show a toast with an "Undo" button that calls `removeClassifier(id)` with the newly-created classifier's ID. The toast auto-dismisses after 6 seconds (longer than the default 3s) to give undo time.

**Why**: This is the simplest undo model — no transaction log, no state snapshots. The classifier is created optimistically and removed if the user taps undo. The `addClassifier` action already returns the created classifier object with its ID.

**Alternatives considered**:
- *Optimistic local state with deferred commit*: rejected — adds complexity to the store for marginal benefit.
- *Confirmation dialog before creating*: rejected — interrupts the fast training flow, which is the core UX value.

### Decision 3: Already-trained indicator via `classifiers` store lookup

**Choice**: Derive a `getTrainedSentiment(feedId, type, value)` selector from the existing `classifiers` array. Thumbs buttons in `RSSScrollMode` use it to show filled (already-trained) vs. outline (not trained) state, and to highlight which sentiment was previously chosen.

**Why**: The `classifiers` store already loads all classifiers and recomputes on change. A memoized selector is cheap (classifier lists are typically < 500 items). This makes the training state visible without any new backend query.

**Alternatives considered**:
- *New backend query `is_trained(feed_id, type, value)`*: rejected — unnecessary round-trip for data already in memory.

### Decision 4: i18n key namespacing

**Choice**: Add keys under existing namespaces:
- `training.*` for TrainingMenu and general training UI
- `manageTraining.*` for ManageTrainingView
- `siteBySite.*` for SiteBySiteTraining
- Extend existing `rss.*` for the RSSScrollMode quick-train titles/toasts

**Why**: Matches the existing convention in `en.ts` where each component/domain has a prefix namespace.

### Decision 5: Feedback sound/haptic respect existing user settings

**Choice**: The `useTrainFeedback` hook checks the existing `uiSoundEffects` user setting (referenced in `notificationSettings.uiSoundEffectsDesc`) before playing sounds, and the existing `triggerHaptic` utility (which already no-ops on unsupported platforms).

**Why**: Users who disabled sound effects for card ratings should also not hear training sounds. This respects their preference without a new setting.

## Risks / Trade-offs

- **[Risk] Sound fatigue** → Training is a rapid-fire action (users may train 10+ articles in a session). Playing a sound every time could get annoying. **Mitigation**: sounds respect the existing `uiSoundEffects` toggle; the like/dislike sounds are short (< 200ms) and distinct from each other so they function as informative feedback, not noise.
- **[Risk] Undo race condition** → If the user undoes a classifier while a `recomputeScores` is in-flight, the score might briefly reflect the pre-undo state. **Mitigation**: `removeClassifier` triggers its own `recomputeScores` after deletion, so the final state converges. Acceptable for a non-critical personalization score.
- **[Risk] i18n translation quality** → Auto-generating translations for 5 non-English languages risks awkward phrasing. **Mitigation**: use the same concise UI-label patterns already established in the locale files; for ambiguous terms, use the English loan-word convention already present (e.g. the app already uses "Like"/"Dislike" equivalents consistently).
- **[Trade-off] Already-trained lookup on every render** → Computing trained state for the current article adds a memoized lookup per scroll position. **Mitigation**: memoize on `[feedId, type, value]`; classifier arrays are small. Negligible cost.
