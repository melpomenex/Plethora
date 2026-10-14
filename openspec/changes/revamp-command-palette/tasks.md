## 1. Palette contracts and catalogue boundaries

- [x] 1.1 Define typed scope, mode, home-data, suggestion, and stable action-ID contracts under `src/commandPalette/`; verify TypeScript accepts the controller/presentation boundary and rejects invalid scopes/action IDs.
- [x] 1.2 Extract available command/navigation catalogues from the term-dependent `CommandCenter` search flow without duplicating registry actions; verify empty Actions/View all reaches every available command and preserves platform gating.
- [x] 1.3 Add optional home/controller inputs to `GlobalSearch` while preserving standalone controlled/uncontrolled search and URL-import behavior; verify existing consumers render and the current GlobalSearch tests still pass.

## 2. Accurate bounded home data

- [x] 2.1 Derive the eligible resume candidate from active-reader position and bounded startup progress in the active collection; verify candidate precedence, completed/archived/deleted exclusions, normalized progress, and persisted PDF/EPUB/media location with focused selector tests.
- [x] 2.2 Add collection-keyed recent-opening tracking at the document-open/active-reader boundary and an accurately worded modification-time fallback; verify metadata edits and palette previews do not falsely replace the recently opened target.
- [x] 2.3 Enrich only the chosen resume document with real cover/metadata/position/passage data and accurate timestamp labels; verify missing cover/summary/passage fallbacks, stale target rejection, and that All/home never initiates bulk content or card loading.
- [x] 2.4 Source the review badge and caught-up state from the review workflow's eligible card set; verify count/target agreement for active collection/deck and zero-due behavior.

## 3. Reference composition and local styling

- [x] 3.1 Build the scoped overlay shell and 60 px search field with sparkle, platform shortcut, accessible label, and discreet Close control; verify reference panel/input geometry at 1586 × 992 and that global theme/other dialogs remain unchanged.
- [x] 3.2 Build the six exclusive scope pills and aligned View all control; verify exact reference ordering, selected styling, focus visibility, and reachability of every chip.
- [x] 3.3 Build the six Quick Actions tiles with reference icons, descriptions, due badge, and gold selected treatment; verify row dimensions/icon weight against the preserved reference and visible unavailable/caught-up variants.
- [x] 3.4 Build the three-part Resume reading card with cover footprint, metadata, primary/secondary actions, position inset, and conditional overflow items; verify bounds/alignment and a missing-metadata fixture without fabricated values.
- [x] 3.5 Build Ask Plethora heading/helper/See examples and the two-by-two prompt grid; verify reference spacing, text hierarchy, icon tones, and the generic replacement for a missing resume document.

## 4. Category browsing and existing search modes

- [x] 4.1 Implement home/catalogue/search/help/URL/composer transitions and ordinary-open versus explicit-prefill behavior; verify reset, scope preservation, caller queries, clearing input, and URL Escape restoration with interaction tests.
- [x] 4.2 Classify results using palette facets and enforce scope across main, RSS, podcast, section, and help branches; verify mixed All, Documents, Actions, Library, and Settings result eligibility and retention of destination/exact-hit metadata.
- [x] 4.3 Add bounded learning-item lookup and activation for Cards alongside existing extract search; verify real flashcard content is found, the correct item/deck opens, extracts retain source jumps, and All/home does not fetch all cards.
- [x] 4.4 Implement View all, See all actions, expanded examples, advanced filters, and recent/saved-search access; verify complete action discovery with empty input, input preservation, and no Save search control when saving is unsupported.

## 5. Application actions and contextual integration

- [x] 5.1 Route Resume, recent-open, settings, and due-review actions through the shared executor and existing navigation/review handlers; verify click/Enter parity, exactly-once execution, and visible destination focus.
- [x] 5.2 Implement View in Library and the document overflow's details/copy actions; verify the same document is revealed without modifying position, missing source links are omitted, and menu Escape returns to the palette.
- [x] 5.3 Render “Actions in this view” ahead of general home content in supported views and expose the full applicable set in Actions; verify PDF/EPUB/Markdown, RSS, podcast, audiobook, and split-pane targeting against existing contextual dispatch tests.
- [x] 5.4 Keep existing section/command/RSS/podcast/help/primary-hit/secondary-hit routing intact through the new result presentation; verify exact jump/highlight parity and that secondary activation does not also fire its parent.

## 6. Durable quick note capture

- [x] 6.1 Build the minimal title/body/Save/Cancel composer with session-recoverable draft state; verify body focus, native multiline editing, Escape return, cancellation without persistence, and draft resumption.
- [x] 6.2 Implement Markdown persistence through existing document adapters and canonical native/browser text storage, including partial-save cleanup and submission locking; verify successful content survives reload, failed saves retain the draft without orphaned/duplicate documents, and supported local saves work offline.
- [x] 6.3 Refresh/invalidate library and search after saving and open the resulting document; verify active-collection ownership and that the new note appears in a subsequent real document search.

## 7. Library-assistant and suggestion handoff

- [x] 7.1 Add typed initial-prompt/document-context handoff to the existing grounded library-assistant composer; verify prompt/context survive navigation and are consumed once without timers or an automatic model request.
- [x] 7.2 Wire library-theme and summary suggestions to prefill, related-document suggestions to Documents search, and today's-review suggestions to the review/deck overview; verify each visible suggestion's actual outcome and generic fallbacks.
- [x] 7.3 Preserve product-help retrieval, assistant configuration/fallbacks, local-only and AI-excluded eligibility, and privacy indicators; verify help/library corpus separation, unavailable-assistant recovery, and no model/network request merely from palette opening or prompt selection.

## 8. Focus selection and accessible interaction

- [x] 8.1 Implement modal focus entry, containment, inert/background-scroll behavior, Close, and restoration using existing primitives; verify Tab/Shift+Tab cycles, backdrop/Escape/Close dismissal, and destination focus after navigation.
- [x] 8.2 Implement input-owned action/result selection and tile navigation with focused-control-aware key handling; verify Arrow/Enter behavior, chip/menu/button Enter ownership, input caret movement, IME composition, and no duplicated activation.
- [x] 8.3 Expose valid result semantics and secondary-hit detail controls with settled-state announcements; verify keyboard access, selected-result announcement, result counts, and no interactive descendants inside single-action listbox options.
- [x] 8.4 Preserve packaged/native Ctrl/Cmd+K, reader iframe entry, and existing injected queries, and implement palette-local Ctrl/Cmd+/ with platform-correct hints; verify the shortcut/event regression suites and that closed-palette editor shortcuts are untouched.

## 9. Responsive and incomplete-data states

- [x] 9.1 Reflow six/three/two-column tiles, stack resume details, and use single-column phone prompts with safe-area-aware sheet/pinned header/body scrolling; verify 1440 × 900, 1280 × 800, short desktop, 768 × 1024, and 390 × 844 captures without inaccessible controls or page-level horizontal overflow.
- [x] 9.2 Implement first-use, no-resume, zero-due, no-results, enrichment/search error, unavailable capability, and offline states; verify actionable recovery, preserved query/draft, stable loading footprints, and no hardcoded reference data in production.
- [x] 9.3 Add translated labels/relative times, full accessible titles, 44 px coarse-pointer hit areas, readable contrast, and reduced-motion/transparency/monochrome support; verify long/translated text, 200% zoom, focus/contrast checks, and software-keyboard behavior on a shipped mobile surface.
- [x] 9.4 Invalidate palette-local work for close, scope/query changes, and collection changes while preserving useful shared caches; verify deliberately out-of-order responses cannot replace current targets/results or reopen the palette.

## 10. Visual and regression acceptance

- [x] 10.1 Create deterministic visual fixtures with fixed clock/font/data and keep them separate from production stores; verify the dashboard home has all target regions and produce reference/region comparisons plus desktop/mobile/state captures.
- [x] 10.2 Inspect all captures in one batch, fix material differences together, and confirm in one further batch; verify all required reference bounds are within 4 CSS px, every action is usable, and record evidence plus intentional accessibility adjustments in `validation.md`.
- [x] 10.3 Run focused selector/controller/interaction tests, `src/components/search/__tests__/GlobalSearch.test.tsx`, shared-command/shortcut/event regressions, contextual-action dispatch tests, and exact-hit tests; verify relevant suites pass and document any unrelated pre-existing failures separately.
- [x] 10.4 Verify open/type behavior with at least 3,000 documents and add deterministic pure-logic benchmarks for newly introduced ranking/selection work using `seededRandom`, void bodies, and consumed results; run `npm run bench:check` and record results, adding justified baseline entries only for new or intentionally changed measured behavior.
- [x] 10.5 Run TypeScript, targeted lint, `npm run build:check`, and the applicable visual suite; verify local build/bundle checks pass, then run `openspec validate revamp-command-palette --type change --strict --no-interactive` and keep task status/evidence accurate.

## 11. Theme adoption follow-up

- [x] 11.1 Bind every palette material role (surface, raised, inset, outline, text, muted text, accent, accent ink, icon, scrim, shadow, hover washes) to the active theme's semantic tokens in `src/index.css`, replacing the fixed black-and-gold values; verify the default Biolume Abyss material, a light theme (Snow), and the reference-matching Obsidian Noir all render correctly.
- [x] 11.2 Update the visual fixture to apply real themes (`ThemeProvider`) with a pinned fixture font and a theme-switch control; verify 1586 × 992 captures for default, Obsidian Noir, Snow, and Golden Hour themes plus two committed snapshot baselines.
- [x] 11.3 Update the change spec and design to record that the reference governs composition/geometry while material derives from the chosen theme; verify `openspec validate --strict --no-interactive` passes.
