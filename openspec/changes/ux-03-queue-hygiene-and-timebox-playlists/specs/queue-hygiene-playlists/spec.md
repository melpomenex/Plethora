# Specification: Time-Boxed Playlists, Queue Compost Sweep & Leech Refactoring

## ADDED Requirements

### Requirement: Time-budgeted playlist presets slice the queue deterministically and display a completion ring

`TimeboxSessionLauncher` and `buildTimeboxPlaylist` SHALL support presets `15m Quick Sprint` (`15` min), `45m Deep Block` (`45` min), and `10m Audio Commute` (`10` min). Given available queue items and item type time estimates, `buildTimeboxPlaylist` SHALL assemble a finite slice targeting roughly 60% due SRS flashcards, 25% high-priority extracts/documents, and 15% discovery items (backfilling proportionally if one bucket is exhausted; filtering to audio/podcast/TTS-capable items for `10m Audio Commute`) whose cumulative estimated minutes do not exceed the session budget by more than one item. While active, the session chrome SHALL render a `0–100%` SVG completion ring instead of an open-ended due count.

#### Scenario: 15m Quick Sprint slices a finite mixed playlist and updates completion ring
- **GIVEN** a queue containing 120 due flashcards, 30 high-priority extracts, and 20 unread discovery documents
- **WHEN** the user launches `15m Quick Sprint`
- **THEN** `buildTimeboxPlaylist` selects a bounded subset targeting ~15 minutes following the 60/25/15 bucket ratio
- **AND** `[data-timebox-ring]` displays `0%` at item 0 and `50%` halfway through the finite playlist

#### Scenario: Sparse extract bucket backfills from remaining reviews cleanly
- **GIVEN** a queue with 20 due flashcards, 0 extracts, and 0 discovery items
- **WHEN** `buildTimeboxPlaylist(items, { minutes: 15, preset: "quick_sprint" })` runs
- **THEN** it backfills up to the 15-minute budget from due flashcards without returning NaN or empty arrays

---

### Requirement: Triage & Compost Queue Sweep Mode processes stale postponed extracts via rapid keyboard shortcuts

`TriageCompostSweepModal` SHALL collect extracts postponed `>= N` cycles (`postpone_count >= 3`, configurable threshold `minPostpones = 3`) and present them one by one for keyboard triage: `[J]` Keep & Boost (decreases priority slider by 15 points toward urgency `1`), `[K]` Demote to Vault/Someday (snoozes `+90d` and sets priority slider `90`), `[L]` AI Summarize & Drop Source (generates summary note when AI available or falls back cleanly, then archives extract), and `[Backspace]` Delete/Archive extract immediately.

#### Scenario: Rapid J/K/Backspace sweep advances through stale extracts accurately
- **GIVEN** 3 stale extracts with `postpone_count >= 3` loaded into `TriageCompostSweepModal`
- **WHEN** the user presses `j` on item 1, `k` on item 2, and `Backspace` on item 3
- **THEN** item 1 dispatches priority boost (`-15`), item 2 snoozes `+90d` with priority `90`, item 3 archives/deletes, and the sweep completes with a summary receipt

---

### Requirement: Inline Leech Card Refactor Wizard intercepts high-lapse flashcards beside parent extract

During review in `FlashcardScrollItem`, whenever a card's `lapses >= leechThreshold` (default `4`), the system SHALL surface `LeechRefactorWizard` displaying the card beside its parent extract text (when linked) and offering three 1-click remediation actions: **Split into Simpler Clozes** (deterministic sentence/clause split preview + background card creation), **Rewrite via Local AI** (invokes AI card reformulation or shows graceful offline fallback), and **Demote to Reading Extract** (converts/returns focus to parent extract and suspends/archives the failing card). Dismissing the wizard SHALL allow grading the card normally.

#### Scenario: Leech card with 5 lapses opens Refactor Wizard and demotes cleanly
- **GIVEN** an active `FlashcardScrollItem` with `lapses = 5` and a linked parent extract
- **WHEN** the card is rendered in `QueueScrollPage`
- **THEN** `LeechRefactorWizard` renders with the parent extract excerpt alongside the card prompt
- **AND** clicking `Demote to Reading Extract` suspends/postpones the card and invokes the demote callback
