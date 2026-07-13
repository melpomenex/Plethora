## Why

An audit of every rating button and "Train Intelligence" button in the app confirmed that **all handlers are fully wired to real backend commands** — there are zero stubs or no-ops. The problem is not functionality, it is **UX quality and consistency**: hardcoded English strings in an otherwise fully i18n'd app, a visible cosmetic bug (`FloppyDisk` rendered as a button label), inconsistent feedback patterns (some buttons play sound/haptic/pulse, others silently fire), and missing affordances (undo, already-trained state, empty states). These gaps undermine the otherwise polished feel of two of the app's core interaction loops: spaced-repetition review and RSS intelligence training.

## What Changes

### Bugs & correctness
- **Fix `ManageTrainingView.tsx:137`**: the bulk-save button renders the literal string `"FloppyDisk"` as its label instead of a localized "Save".

### i18n coverage (the app supports en/zh/de/es/fr/ja)
- Localize all hardcoded strings in `TrainingMenu.tsx`, `ManageTrainingView.tsx`, `SiteBySiteTraining.tsx`, and the quick-train titles/toasts in `RSSScrollMode.tsx`.
- Localize hardcoded English toast messages: `"Liked"`, `"Disliked"`, `"Cannot train"`, `"Article has no author or tags"`, `"Training on {type}: {value}"`, `"Training failed"`.

### Feedback & polish consistency
- Bring every "Train Intelligence" interaction up to the same multi-layered feedback standard already set by `RSSScrollMode.handleQuickTrain` (sound + haptic + visual pulse + toast): `TrainingMenu` and `SiteBySiteTraining` currently fire-and-forget with zero user feedback.
- Add **undo** support: when a quick-train or training-menu action creates a classifier, show a toast with an "Undo" action that calls `removeClassifier`.
- Show **already-trained state**: if the current article's author/tag is already a classifier (like or dislike), reflect that on the thumbs buttons (filled vs. outline) so the user sees what they've already taught the system.

### UX improvements
- **TrainingMenu**: group like/dislike actions into clear positive/negative visual pairs; add hover previews of the value being trained (e.g. tooltip showing the author name); add disabled-state explanation for items without an author/tag.
- **RatingButtons**: add `aria-pressed`/keyboard `focus-visible` ordering improvements; ensure the interval-preview text is visible on mobile (currently `hidden md:block`).
- **ManageTrainingView**: add empty state ("No training yet — use 👍/👎 on articles to teach your intelligence"); add success confirmation after bulk save; animate group expand/collapse.

### Capabilities

#### New Capabilities
- `intelligence-training-ux`: the end-to-end UX of the RSS intelligence training system — quick-train buttons, context menu, walkthrough mode, manage-training view, feedback, undo, already-trained indicators, and i18n coverage.

#### Modified Capabilities
- `document-rating`: the rating-buttons UX (interval preview visibility, keyboard/focus ordering, accessibility) is being modified at the requirement level to cover mobile visibility and consistent feedback.

## Impact

**Files modified:**
- `src/components/media/TrainingMenu.tsx` — i18n, feedback, grouped layout, undo
- `src/components/media/ManageTrainingView.tsx` — fix "FloppyDisk" bug, i18n, empty state, save confirmation
- `src/components/media/SiteBySiteTraining.tsx` — i18n, feedback (sound/haptic), undo, completion state
- `src/components/media/RSSScrollMode.tsx` — i18n titles/toasts, already-trained visual state, undo toast
- `src/components/review/RatingButtons.tsx` — mobile interval preview visibility, keyboard/focus polish
- `src/lib/i18n/locales/en.ts` (and zh, de, es, fr, ja) — new translation keys

**No backend changes** — all Tauri commands (`submit_review`, `add_rss_classifier`, `remove_rss_classifier`, `recompute_all_intelligence_scores`) remain unchanged. This is a purely frontend UX change.

**No breaking changes.**
