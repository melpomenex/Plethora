## Context

See [proposal.md](proposal.md) for motivation. The visual authority is the user's 1586 × 992 attachment, preserved byte-for-byte at [reference/command-palette-target.png](reference/command-palette-target.png), SHA-256 `53a54c937e68a9662a35be256c447299c0877bf30a093d668729cc5668aef6a0`. It defines the palette overlay; the surrounding dashboard is context, not a request to redesign the dashboard.

The surface is an **Operate** interface: a reader or learner opens it to resume work, find content, run a command, capture a thought, or ask about their library.

Current implementation facts:

- `MainLayout` mounts `CommandCenter`, which owns search providers and navigation and renders `GlobalSearch`. Changing only the legacy `CommandPalette` component would not change the live palette.
- `GlobalSearch` owns controlled open state, the input, 150 ms search debounce, URL import, and a global key handler. Its empty-query branch renders recent/saved searches instead of the contextual results returned by `CommandCenter`.
- Search results already carry exact anchors, secondary hits, RSS/podcast targets, help actions, and typed contextual dispatch metadata. These contracts must survive presentation changes.
- `useStartupStore.snapshot.continueReading` is a bounded progress projection. `date_modified` is a modification timestamp, not proof of reading time. `Document` supplies cover, page count, position/CFI, and progress when available. Existing dashboard/card statistics supply eligible card counts; a generic queue due count must not be relabeled as a card count.
- `useAskLibrary` answers questions about user content. `AskPlethoraModal` answers questions from product documentation. The screenshot's library prompts belong to the former.
- `NoteEditor` is scoped to RSS article notes. General note creation needs a small composer and a save adapter using the existing native/browser document APIs.
- The app has theme roles, an existing font system, Phosphor icons, shared modal primitives, phone/tablet presentation rules, and local benchmark/bundle gates. No additional component or animation package is necessary.

## Goals / Non-Goals

**Goals:**

- Make the reference the acceptance target, with measured regions and a reproducible visual fixture.
- Separate presentation, home-data derivation, and action dispatch so search providers do not become coupled to card layouts.
- Keep one input, one open-state owner, one selection model, and one execution path per action across pointer, touch, and keyboard activation.
- Render useful home content immediately from bounded snapshots, then enrich one resume item without waiting for library-wide work.

**Non-Goals:**

- Redesign the app shell, dashboard, readers, review UI, general assistant, or global theme system.
- Introduce a new retrieval/search backend, an AI provider, bulk content extraction, generated summaries on open, or a general-purpose note-management product.
- Reproduce the reference's book, counts, quote, or relative time as hardcoded production data.

## Decisions

### 1. Preserve the existing controller and extract a focused presentation tree

Keep `CommandCenter` responsible for application actions and providers. Refactor `GlobalSearch` into a palette shell with focused children such as `PaletteHome`, `PaletteScopeBar`, `PaletteQuickActions`, `PaletteResumeCard`, `PaletteSuggestions`, and `PaletteResults`. Put shared scope/action/home-model types and pure selectors under `src/commandPalette/`.

Pass a typed home model and callbacks into `GlobalSearch`; presentation components do not call native APIs or inspect unrelated stores. Preserve its public controlled/uncontrolled and standalone-search behavior through optional props where other consumers need it. Keep the shared command registry and stable IDs usable by the legacy component.

**Alternative:** implement the reference directly inside the already large `CommandCenter`. Rejected because it would mix asynchronous provider logic with home composition and make keyboard/action parity harder to test.

### 2. Treat the reference as a measured overlay whose material follows the active theme

The desktop target below is measured from image pixels. At the reference viewport, use 100% zoom and DPR 1 for geometry comparison. These are target dimensions, not a fixed canvas imposed on smaller devices. The reference governs composition, geometry, typography, and hierarchy; the palette's color material comes from the user's chosen theme (see the material contract below), so the reference's black-and-gold appearance is reproduced when the active theme is a gold-on-black theme (e.g. Obsidian Noir) and every other theme yields its own surfaces/accent.

| Region | Reference bounds / dimensions | Build contract |
| --- | --- | --- |
| Overlay panel | x ≈ 376, y ≈ 120; 838 × 738 px | Horizontally centered; approximately 7 px above vertical center; 838 px maximum width; 16 px minimum viewport margin; about 16 px corner radius |
| Search field | x ≈ 389, y ≈ 132; 812 × 61 px | Approximately 12 px shell inset; 60 px field height; 12 px radius; theme-accent focus outline, leading sparkle, trailing platform shortcut |
| Scope row | x ≈ 395, y ≈ 212; about 32 px visual height | Six pills in reference order; selected All uses the theme accent; View all and its shortcut aligned right |
| Quick actions | Heading y ≈ 278; tiles y ≈ 299–443 | Six tiles in one row; 10–12 px gaps; about 130 × 145 px; 40 px icon wells; selected Resume tile outlined with the theme accent |
| Resume section | Heading y ≈ 475; card x ≈ 394, y ≈ 495; 802 × 190 px | Cover left, content/actions center, last-position inset right; aligned inner baselines |
| Cover | x ≈ 414, y ≈ 512; 106 × 156 px | Actual document image with contained crop; approximately 2:3 ratio; preserve footprint on fallback |
| Last-position inset | x ≈ 949, y ≈ 511; 233 × 157 px | Quiet inset, location/time first, real excerpt with a narrow accent leading rule |
| Ask section | Heading y ≈ 720; prompts y ≈ 743 and 795 | Helper sentence beside heading; See examples right; two columns and two rows; prompt height about 42 px; 10–12 px gaps |

**Material contract (theme-derived).** Use palette-scoped CSS semantic roles — surface, raised surface, inset, outline, text, muted text, accent, accent ink, icon — and bind them to the active theme's tokens (`--color-surface-container*`, `--color-outline*`, `--color-foreground`, `--color-muted-foreground`, `--color-primary`, `--color-primary-foreground`, `--color-scrim`, `--shadow-xl`), not to hex literals inside JSX or to fixed black-and-gold values. Under a theme whose colors match the reference (near-black surfaces, amber-gold primary — Obsidian Noir is the calibration theme) the roles reproduce the reference's material; under the default Biolume Abyss the same composition renders in deep-sea/cyan, and light themes render light surfaces with dark text. Opening, resizing, or theming the palette must not switch or mutate the user's global theme. Recompute-dependent shades use `color-mix()` on theme tokens (hover washes, accent washes, skeleton shimmer, scrim), and the variant-appropriate emphasis accent brightens on dark themes and deepens on light ones. Support contrast/monochrome preferences with a scoped accessible treatment while preserving hierarchy. Existing theme fonts remain available; the visual fixture pins the shipped system sans stack so geometry captures stay comparable across themes.

The explicit user reference governs local palette shape and composition. Reuse primitives with scoped variants rather than restyling all dialogs. Scope overrides to a command-hub data attribute; generic `adaptive-search-*`, URL preview, and unrelated modal styles must not acquire palette overrides.

Typography targets: search 18–20 px; section headings 13–14 px semibold; document title 15–16 px semibold; tile titles and descriptions 12 px; metadata/prompt text 11–12 px. Use exact visible reference labels, replace factual values with data, and translate all new labels. Aim for 4.5:1 normal-text contrast and 3:1 large-text/control-state contrast; increasing muted-text readability is an intentional accessibility adjustment. On coarse pointers use 44 × 44 px effective hit areas even where pills are visually smaller.

**Alternative:** reuse the current 42 rem glass-search container with a few new cards. Rejected because its width, vertical density, input, footer, and material differ materially from the reference.

### 3. Make home, browse, search, help, URL import, and composition explicit states

Derive one body mode from input classification, selected exclusive scope, and explicit browse/composer state. Reset to empty input + All/home on a fresh ordinary open. Preserve a caller-provided initial query, such as a section/help entry point. URL detection takes precedence over scope; returning from import restores the previous scope. Existing help prefixes/classification keep their current meaning; ordinary typing never silently becomes an AI request.

| Scope/control | Empty input | Typed input / activation |
| --- | --- | --- |
| All | Reference home, plus applicable contextual section before Quick Actions | Existing mixed ranked search |
| Actions | Applicable contextual actions followed by all available global commands | Matching executable commands; contextual matches retain priority |
| Documents | Bounded recent documents in the active collection | Document title/content hits with existing exact anchors |
| Library | Existing library destinations, collections/tags where supported, and available media destinations | Matching library entities/destinations and RSS/podcast results; preserve their native target metadata |
| Cards | Bounded eligible flashcards/extracts in the active collection | Matching flashcard/extract content; real learning items use the existing item/deck destination, extracts retain source navigation |
| Settings | Existing settings destinations/commands | Matching settings actions/sections |
| View all | Switch to an explicit all-items catalogue with the current input preserved | Browse all available commands and destinations; use the visible platform-specific Ctrl/Cmd+/ shortcut only while the palette is open |
| See all actions | Select Actions; retain the input | Full action catalogue, with no result cap hiding registered commands at empty query |
| See examples | Expand a bounded library-question catalogue within the palette | Selecting an example copies it into the grounded library-assistant composer for review |

Use a separate `PaletteScope`/facet classification; do not pretend “Settings” is a document content type or equate every `Command` result with a global action. Add scope intent to the request boundary and enforce it consistently after provider assembly, including early RSS/podcast/help branches. Preserve existing advanced category/tag/type filters behind an accessible additional-filter affordance in browse/search mode; the default home keeps the reference row uncluttered.

Build command/navigation catalogues independently of the term-dependent search body; the current early empty-term return cannot supply them. Add bounded learning-item lookup for Cards using `src/api/learning-items.ts` and existing destinations, because the current provider only creates Document/Extract hits despite defining a Flashcard result type. Do not fetch all cards just to open All/home. Recent/saved searches remain discoverable in browse/search mode without displacing the reference home; expose Save search only when `onSaveSearch` is supplied.

**Alternative:** add six cosmetic chips while keeping the hidden type filter and existing empty-query branch. Rejected because chips would be ambiguous and catalogue access would still depend on inventing a query.

### 4. Use a shared typed action dispatcher with explicit preconditions

Home tiles and catalogue results use stable action IDs and the same executor. One activation closes or transitions the palette once; callbacks cannot also fire via a window-level Enter listener.

| Reference action | Target and behavior | Missing/unavailable state |
| --- | --- | --- |
| Resume reading | Prefer the active eligible reader with a persisted position; otherwise the most recent unfinished progress item in the active collection. Open through the canonical document/position helper; never inject a search-hit highlight into a normal resume. | Keep tile with an explanatory disabled state; resume region offers Open library or Import document |
| Open recent document | Open the most recently opened eligible document; fall back to latest modified document with honest wording. Same canonical opener. | Explain that the library is empty; offer import |
| Review due cards | Use the existing review-start flow for the active collection/deck; badge comes from the same eligible-card count used by review. | Zero due: omit the due badge and show You're caught up; offer the review/deck overview rather than a fake active review |
| Ask about your library | Open the existing grounded library-assistant composer | Feature unavailable: explain briefly and expose the supported enable/configuration route; no background AI request |
| Open settings | Existing settings tab/section routing | Preserve platform availability checks |
| Create a note | Transition to a minimal title/body composer owned by the palette; focus body | Local save remains available offline; errors preserve the draft |

The resume card's Continue Reading uses the same Resume action. View in Library reveals/selects the same document in its library, without changing its reading position. Its overflow contains Open document details, Copy title, and Copy source link only when a source URL exists; none require a new destructive flow. Menu Escape dismisses the menu before the parent palette.

The six reference slots stay in the same order. If a prerequisite or platform capability is unavailable, the home slot explains why and offers an applicable alternative; the executable catalogue continues to omit unsupported commands in accordance with current gating. Optional sections can disappear when irrelevant, but the frame must remain stable during enrichment.

**Alternative:** give each tile an ad hoc event and navigation implementation. Rejected because current navigation already has multiple paths and would invite click/Enter disagreement.

### 5. Derive a bounded home model and display only supported facts

Use startup progress and collection-scoped snapshots for the initial model. Derive at most one resume candidate and one recent candidate with stable selectors; enrich only the selected resume document from document metadata/cover/position APIs. Do not load extracts, transcripts, embeddings, or PDF/EPUB text across the library when All/home opens.

Use the actual persisted position: page/CFI/scroll/time as appropriate, formatted using existing normalizers. Do not calculate an EPUB page from a percentage. `progressPercent` and startup progress share a normalized 0–100 range. Last read requires an actual reading timestamp; if only modification time exists, label it Last updated. A lightweight collection-keyed recent-opening record can support Open recent document, but its time is labeled Last opened. Record it at the document-open/active-reader boundary, not when merely viewing a palette preview.

Cover fallback is a neutral book/file glyph in the same footprint. Page count, summary, description, and last-position excerpt are displayed only when supplied by actual metadata or a saved passage associated with that location. Do not quote arbitrary start-of-document text as the last-read passage and do not call an LLM to fill missing descriptions. Truncate text visually without losing accessible full titles. If the candidate is archived, deleted, inaccessible, or leaves the active collection, recompute eligibility before execution and show a recoverable message.

Persist the note as a Markdown document in the active collection using the existing `createDocument` and `updateDocumentContent` native/browser adapters and the canonical text-document file/storage convention. Complete content persistence before reporting success; compensate/clean up a partial creation if content save fails. Draft survives failures; double submission is blocked; cancellation performs no save. Success opens the saved document and makes it searchable after the existing refresh/invalidation flow. Keep the composer limited to title, body, Save, and Cancel.

**Alternative:** seed the screenshot title, four-hour timestamp, due badge, and quote in application code. Rejected because a visual sample is not user data.

### 6. Route prompts according to their actual job

Keep the reference heading Ask Plethora and its helper line. The initial four suggestions follow the reference's roles: library themes; summarize the resume document's arguments; related documents for a relevant topic; today's review. Derive document/topic text from eligible user data, with neutral fallbacks.

Library-theme and summary questions hand off the complete prompt and optional document context to the existing `useAskLibrary` composer, prefilled and focused. The user sends from that composer; merely opening the palette or selecting a suggestion must not start a paid/cloud request. Add a typed handoff payload for initial question + document ID; replace timing-dependent bare events for this new handoff with the existing tab/UI-state routing pattern. Related documents selects Documents and submits a real content search. Today's review opens the real due-review/deck overview. Product-help queries retain the product-docs pipeline and are not sent to user-library retrieval.

Respect existing AI exclusion/local-only rules, provider resolution, retrieval-only fallback, and privacy indicators. Configuration/offline failures remain in the established assistant workflow with actionable recovery. Missing resume documents replace the document-specific example with an honest generic library prompt.

**Alternative:** reuse `AskPlethoraModal` for all suggestions because its name matches the screenshot. Rejected because its corpus is product documentation, so it would answer the wrong question.

### 7. Use modal semantics and mode-specific keyboard behavior

Reuse the project's modal/focus primitive or extract the necessary focus lifecycle into the palette without changing unrelated modals. The dialog has an accessible name, input label, inert/background scroll containment, a contained Tab sequence, and focus restoration. Initial focus goes to the input. Provide an accessible Close control inside the dialog; keep it discreet at rest and visibly available on keyboard focus/hover, and always visible for touch. Treat that as an accessibility addition to the reference, not a new toolbar.

- Home: the input retains focus, the first eligible primary action is highlighted, Down/Up selects a stable action sequence, and Enter activates that selection once. Tab reaches scope controls, cards, resume controls, overflow, and prompts in visual order. On actual tile focus, Left/Right moves within the tile row and Up/Down respects its responsive columns; do not hijack text-input Left/Right.
- Results: input focus stays put while Up/Down changes the selected result, Enter executes it, and the row scrolls into view. Announce active title and settled result count. Use valid listbox semantics only if each option is one action; expose secondary-hit controls in a separate detail region rather than nesting interactive controls inside an option.
- Tab-focused native controls own Enter/Space; handlers ignore composition, repeat activation, and keys belonging to textarea/input editing or another open child surface. No global Enter handler may trigger the selected result when a scope chip, menu item, or Save control owns focus.
- Escape first dismisses an open menu or transient examples/filter surface; in URL mode it clears the URL; in note composition it returns to home retaining the unsaved draft; otherwise it closes. Closing by Escape/backdrop/Close restores the invoker. Navigation actions focus the destination rather than bouncing to a disappearing trigger.
- Display Cmd on macOS and Ctrl on Windows/Linux. Preserve global Ctrl/Cmd+K opening, native packaged shortcuts, reader iframe bridging, and caller-injected queries. Ctrl/Cmd+/ is local to the open palette and never steals an editor shortcut while it is closed.

Follow the [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) for containment/restoration and the [combobox guidance](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) when associating the input with results. Do not apply `aria-modal` without enforcing real modal behavior. Use polite announcements for settled states, not every keystroke.

**Alternative:** retain window-wide handling for every Arrow/Enter event. Rejected because the expanded palette now has real focused controls and a multiline composer.

### 8. Adapt the same hierarchy to smaller and shorter viewports

At a usable inner width of at least 780 px, retain six tiles and the three-part resume card. Below that, use three tiles per row and move the excerpt below the main resume content. Below 600 px use two tiles per row; at phone widths use a full-width sheet with safe-area padding, a pinned input/scope area, one body scroller, and one-column suggestions. The chip strip can scroll horizontally; it must keep the selected chip visible and expose all categories without clipping View all out of reach.

Use `100dvh`/the existing app viewport variables so the software keyboard does not cover input or primary controls. Short desktop windows scroll the body instead of shrinking text or producing nested page/panel scrollbars. Page zoom and larger fonts follow the same content-driven breakpoints. Respect reduced motion and reduced-transparency preferences; open/close is a brief opacity transition, not a scale/lift animation, and filtering does not animate card reflow. Disabled and loading states must remain intelligible without color.

### 9. Verify fidelity and behavior with a deterministic fixture

Create a visual fixture with a fixed clock, font, active dashboard, collection, resume metadata, one due card, and the screenshot's representative text lengths. Keep synthetic data confined to the fixture. Compare the overlay at 1586 × 992 against the preserved reference; also capture 1440 × 900, 1280 × 800, a short desktop viewport, 768 × 1024, and 390 × 844. Verify phone software-keyboard behavior in the shipped mobile surface.

Accept the reference viewport only when panel/input/action-row/resume/prompt bounds are within 4 CSS px of the measured target, all required regions exist, and side-by-side inspection of each region confirms comparable type scale, alignment, outline, tonal separation, and icon weight. Keep covers, changing content text/time, and the external dashboard out of the chrome pixel comparison; do not mask missing structural regions, highlight outlines, or unreadable labels. Add explicit functional captures for search, URL import, note composition, first-run, no cards due, unavailable assistant, loading/error, supported-reader context, reduced motion, and large fonts. Functional captures need coherent styling rather than a nonexistent reference image.

Run one batched desktop/mobile inspection, fix material discrepancies together, then confirm in one further batch. Record evidence and any intentional accessibility differences. The quality bar is visual fidelity plus correct flows; passing a pixel comparison cannot excuse a dead control.

Keep the 150 ms query debounce, request-generation guards/cancellation, bounded provider queries, and result caps/virtualization as needed. Empty-home must paint without waiting for enrichment; closing invalidates palette-local async work, and older responses cannot replace a newer scope/query/collection. Exercise a 3,000+ document fixture for open/type responsiveness. Benchmark any new pure ranking/selection logic with seeded data and consumed results, then run local `npm run bench:check`. Do not relax baseline tolerances to hide a regression.

## Risks / Trade-offs

- [The raster does not reveal every source token or font metric] → Preserve it as authority, record measured regions, and compare at its exact viewport. Tune scoped values from rendered evidence; do not claim unmeasurable exact source CSS.
- [Reference microcopy/close affordances can conflict with accessibility] → Preserve the composition while allowing documented contrast, hit-area, focus, and Close-control adjustments.
- [Category labels do not match current result enums] → Add explicit facets and enforce them at provider boundaries; test early-return branches and learning-item destinations.
- [Reading recency/excerpts are missing or stale] → Use accurate fallback labels, omit unsupported facts, and revalidate the target before opening.
- [Assistant event timing can drop the initial prompt] → Carry the prompt/document context in typed state or a tab payload and consume it once in the destination composer.
- [Note creation can partially save] → Use canonical storage conventions, await content persistence, compensate partial records, and retain drafts on failure.
- [A richer home could revive the large-library freeze] → Bounded snapshots, stable selectors, one-item enrichment, lazy card/content queries, and the required local performance gate.
- [Existing independent search consumers share `GlobalSearch`] → Keep new home/controller inputs optional and scope styling; verify standalone and URL-import consumers.

## Migration Plan

Implement the home-model/action contracts first, then scoped presentation, then category/assistant/note integrations and focus behavior. Retain existing search-hit and action metadata through the transition. Ship only after interaction regressions, reference comparison, responsive checks, TypeScript/build checks, and local performance/bundle gates pass. This is a frontend presentation/integration change with no required database schema migration; any small text-storage adapter must use existing document formats. Rollback restores the previous palette composition while retaining ordinary saved Markdown documents and ignoring optional local recent-open/draft records.
