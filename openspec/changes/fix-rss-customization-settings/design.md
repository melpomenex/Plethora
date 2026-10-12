## Context

See proposal.md for motivation. The customization panel owns an initially empty draft and never receives effective preferences. RSSReader saves that draft through an API that replaces native localStorage records; Rust HTTP models and database mappings omit reader fields. HTTP filter updates use COALESCE, preventing explicit clears. Global lookup queries are not restricted to global rows.

RSSReader injects reading variables only into its basic preview. Full-content rendering has independent `reader_*` storage, Story uses fixed typography, and Scroll does not receive customization preferences. Layout settings are split between the panel and a separate article layout selector. The modal uses z-50 while mobile navigation uses z-index 1000; the shared dialog token is 1060.

The in-flight `improve-rss-reading-experience` artifacts describe some already-present code but have unchecked tasks. This change owns the complete repair; do not mark unrelated change tasks complete automatically.

## Goals / Non-Goals

**Goals:** Establish a shared, typed preference contract and resolver; preserve existing data; make control effects observable; verify rendering rather than merely checking stored values.

**Non-Goals:** Styling publisher pages inside Original view, introducing popularity analytics or recommendation services, unifying document-reader settings outside RSS, or changing unrelated app overlay layers.

## Decisions

### 1. Shared contract and scoped effective preferences

Keep existing snake_case API fields; add independent `thumbnail_size` (small/large) and `card_height` (compact/normal/tall). Share frontend types, defaults, validation, and normalization outside the panel. Native and HTTP reads resolve defaults → global values → explicit feed overrides. Queries must constrain both feed and user scope, including NULL scopes.

PATCH-style updates distinguish omitted fields (unchanged) from explicit null (clear override; global filters become empty). Local storage merges raw overrides rather than replacing records. Rust deserialization must retain field presence; do not use COALESCE where null is a meaningful clear. Responses return effective preferences. Validate enums, finite numeric ranges, and fractional line height consistently. This is preferable to sending full forms, which can overwrite newer unrelated settings and flatten inheritance.

### 2. One reader preference source

Pass effective preferences into basic preview, full-content, Story, and Scroll. Centralize style mapping; set font size and line height on the actual prose element so typography utilities cannot mask inherited values. Apply width responsively without horizontal overflow and alignment to article text. Theme overrides must cover each app-rendered reading surface and its text colors; System follows the app theme. Original view is externally authored content and receives a short applicability explanation.

Full-content inline controls update the same preferences through the same save path. Remove independent ongoing `reader_*` writes. Migrate legacy typography/width values once into global RSS preferences only when their corresponding RSS values are absent; explicit RSS settings win. Map narrow/normal/wide and normal/relaxed/loose to shared numerical values. Retain sepia/slate/oled as additional values in the shared theme field for the existing full-content palette controls. The main customization panel offers system/light/dark; saving one of those replaces any extra palette choice. This preserves existing palette controls without a competing theme store. Keeping two competing typography stores was rejected because it recreates the reported bug.

### 3. Explicit presentation applicability

Use the following control matrix in UI hints and verification:

| Control | Applicable views |
| --- | --- |
| Filters and sorting | Article lists and Scroll article sequence within the current scope |
| Font, size, line height, width, alignment, theme | Basic preview, full-content, Story, Scroll |
| Author and date visibility | Lists and app-rendered reading metadata |
| Feed icon visibility | Feed metadata where an icon is available |
| Card/List/Compact, density, excerpts, card height, thumbnails | Article list presentations |
| Columns | Magazine and Grid, limited responsively by available width |

Card uses richer image/content presentation; List uses horizontal compact rows; Compact omits image/excerpt. Apply density in each list layout. Card height determines content structure and excerpt line limits, while excerpt length determines text truncation. Thumbnail visibility and size are independent; Small uses a compact image, Large a prominent image. Hidden metadata must not leave separators or empty gaps. Existing layout selection remains, with hints explaining where settings apply. Do not imply columns change the split-pane list.

### 4. Sorting and supported presets

Date: ascending oldest first, descending newest first. Title: ascending A–Z, descending Z–A. Read status: ascending unread first, descending read first, with corresponding labels. Reading time uses plain-text word counts, with ascending shortest first and descending longest first. Use deterministic date/id tie-breaks and stable treatment of missing dates.

Replace Briefing/Deep Dive/Trending with Compact List, Reading List, and Unread First presentation presets. Each writes a documented combination of supported fields; no label claims a 24-hour window, long-form filtering, or popularity. Adding those missing products would unnecessarily expand this repair.

### 5. Draft and save lifecycle

Initialize a fresh draft from effective preferences whenever the modal opens or its scope changes; cancel discards unsaved edits. Protect against stale asynchronous loads after feed switches. Save awaits persistence, disables duplicate submissions, and reports success only after completion; failure retains the draft and exposes retry. Reset is always available and stages a complete reset: clear all filters and apply declared defaults to the current scope. Reset takes effect only on Save.

Range values use numeric conversion preserving decimals. Radio groups have stable unique names rather than their selected value. Labels explain settings that do not apply to the current presentation.

### 6. Shared dialog infrastructure

Use the existing dialog primitive and its overlay layer, with a root portal if necessary to escape tab stacking contexts and transformed ancestors. Backdrop covers and blocks the toolbar. Keep content scrollable within the dynamic viewport and safe-area insets; adapt the fixed-width side tabs on small screens. Reuse established focus trapping, Escape dismissal, and focus restoration. A local z-index bump alone was rejected because ancestor stacking contexts can still trap the dialog.

### 7. Preserve filter inputs across reloads

Parsed article categories currently disappear during SQLite persistence and frontend mapping. Add a JSON category column and carry category arrays through native article ingestion and HTTP/native read models; older records resolve to an empty array until refreshed. This supports the existing category filter rather than introducing a new classification feature.

## Risks / Trade-offs

- [Preference inheritance changes legacy behavior] → Preserve explicit values, test global/feed isolation and clear semantics in both backends.
- [Legacy full-content preferences conflict with RSS settings] → One-time migration with explicit RSS precedence and separate treatment of extra theme palettes.
- [Typography utilities override desired styles] → Browser assertions on computed paragraph font size, line height, alignment, and width across all four reader paths.
- [Responsive columns or longer text make virtualization inaccurate] → Measure affected rows and check scrolling with compact and comfortable densities.
- [Preset relabeling changes familiar text] → Keep supported preset actions and localize their accurate descriptions.

## Migration Plan

1. Add nullable reader and independent layout columns through an additive SQLite migration; extend backend models and update logic.
2. Normalize old records without deriving thumbnail size from excerpt length. Preserve excerpt length and choose defaults for new fields.
3. Run idempotent legacy reader preference migration before resolving global preferences; retain original keys for recovery but stop using them as a competing source.
4. Integrate shared preferences and modal behavior, then run focused tests, browser checks, build checks, and `npm run bench:check`.
5. Rollback can retain additive columns; older clients ignore new fields. Preserve existing preference keys and avoid destructive schema changes. If performance or bundle changes are intentional, update the corresponding baseline with rationale; do not adjust baselines to conceal regressions.
