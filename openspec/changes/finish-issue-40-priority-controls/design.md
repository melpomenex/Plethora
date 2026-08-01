## Context

The parent change `fix-issue-40-library-queue-and-integration-regressions` shipped half of the two priority features from [issue #40](https://github.com/melpomenex/Incrementum/issues/40). This change finishes them with a better UX, and makes the priority value actually drive queue ordering.

**Current priority data model (verified):**

Documents carry two priority columns (both `INTEGER NOT NULL DEFAULT 0`, migration 009, `migrations.rs:386-387`):

- `priority_rating` — integer, intended range 1-5. The "stars."
- `priority_slider` — integer, intended range 0-100. The continuous value.
- `priority_score` — derived column, 0-100, persisted on write.

**Who reads what (the load-bearing facts):**

| Consumer | Reads | For | Live? |
|---|---|---|---|
| `EngagingScheduler::schedule_item` (`engaging_scheduler.rs:161`) → `rate_document_engaging` (`algorithm.rs:318`) | **neither** | document **due date** (`next_reading_date`) | YES — this is the document scheduler (FSRS-6 + engagement layer). Takes no priority input. |
| `calculate_fsrs_document_priority` (`algorithms/mod.rs:230`) → `queue.rs:324,742,832,950` | **`priority_rating`** (1-5) | document **queue ordering** (sort, 0.5×–2.0× multiplier) | YES |
| `calculate_document_priority_score` (`algorithms/mod.rs:199`) → `update_document_priority` (`document.rs:938`) | **both** | derives persisted `priority_score` | YES |
| FSRS / SM-18 / SM-20 flashcard review (`commands/review.rs`) | **neither** | flashcard SRS | YES (unaffected) |

So: **document *due-date* scheduling ignores priority entirely.** Priority only affects *ordering* within a due set, and that ordering currently reads the 1-5 rating, not the slider. The 0-100 slider today flows only into the stored `priority_score`, which nothing in the queue hot path reads. Making the slider authoritative affects ordering only — never when a document becomes due, never flashcards.

**Two pre-existing bugs** (fixed here): `calculate_fsrs_document_priority` clamps to `1..=10` and documents a 2.0× max while the field is 1-5 (`algorithms/mod.rs:226, 241`), so the multiplier tops out ~1.33×; and the bulk-reprioritize path computes `priorityScore = nextRating * 20` locally (`DocumentsView.tsx:919`) instead of the canonical averaging formula, leaving `priority_slider` untouched.

**The two shortcut systems** (unchanged from prior design context): System A `useShortcutStore` (`KeyboardShortcuts.tsx`) — customizable, **the one the reader reads**; System B `keyboardShortcutsStore.ts` — RSS-style, where the lone `Shift+P` `increaseDocumentPriority` lives (`:39`), read only by `DocumentsView.tsx`.

## Goals / Non-Goals

**Goals**

- A continuous 0-100 priority slider (SuperMemo-style) replaces the discrete 1-5 stepper, in all three Documents layouts.
- `Shift+P` opens a popup (slider + number input) that sets priority for the selection — single item or mass-set across a multi-/range-selection.
- The same popup works in the reader for the open document.
- The slider genuinely drives queue ordering — rewired through the FSRS document-priority calc.
- One source of truth for the priority shortcut; the two priority fields stay consistent everywhere.

**Non-Goals**

- Changing document *due-date* scheduling. `EngagingScheduler::schedule_item` is untouched (it takes no priority input anyway).
- Touching flashcard SRS (FSRS/SM-18/SM-20). Priority does not reach it; this change does not add it.
- Introducing a new DB column or migration. `priority_slider` and `priority_rating` already exist; `priority_score` already exists.
- Removing the `priority_rating` field. Code still reads it (and the FSRS calc could fall back to it); instead the backend derives it from the slider so both stay populated.
- Redesigning the reader's existing mouse `PriorityControl` (`PriorityControl.tsx`) beyond letting the shortcut open the same popup. It already writes a 0-100 slider; it stays.

## Decisions

### D1. One continuous-slider popup component, used for single + mass set

Build one popup component: a 0-100 `<input type="range">` + a co-located number input (type a value), with the 5 named presets (Lowest/Low/Normal/High/Highest at 10/30/50/70/90) as quick chips, matching the reader's `PriorityControl` vocabulary. The popup takes a list of target document ids.

- **1 id** → sets that document, closes on commit.
- **N ids** → mass-sets the same value to all; the header reads "Set priority for N documents"; commits report per-item success/failure like other bulk actions (reuse the existing `BulkOperationResult` shape).

Commit semantics: write on explicit confirm (slider drag does not spam N writes mid-drag for the mass case; for the single case, live-preview is fine). Esc / click-outside cancels without writing, leaving the selection intact.

**Alternative rejected — separate up/down increment shortcuts.** The user explicitly wants the popup (slider + typed number), not nudges. Increments also can't mass-set sensibly across documents at different priorities.

**Alternative rejected — a dedicated mass-reprioritize modal vs. the popup.** The popup already supports N ids; a second modal is redundant. The existing bulk "Reprioritize" *button* becomes an alternate opener of the same popup for the current selection.

### D2. Placement: inline control per layout + Shift+P popup everywhere

- **Compact view:** replace the `PriorityStepper` (`DocumentsView.tsx:2670, 2745`) with an inline continuous slider (compact height). The current `−/badge/+` disappears.
- **Grid card** (`LibraryCard`, `:3071-3359`) and **list row** (`:1470-1578`): render the inline continuous slider in the hover footer / priority cell, replacing the read-only `PriorityBadge`.
- **`Shift+P` popup:** available in all three layouts (operates on the selection) and in the reader (operates on the open document). This is the keyboard path and the mass-set path; the inline sliders are the mouse path.

Narrow-width fallback: if the inline slider overflows a tight grid card or list column, render the badge and rely on `Shift+P` — but the default is the inline slider everywhere.

### D3. The shortcut lives in System A; migrate `Shift+P` from System B

The reader honors System A. So the `Shift+P` popup shortcut is registered in System A's `DEFAULT_SHORTCUTS` (`KeyboardShortcuts.tsx`) as e.g. `doc.priority`. The increase-only `increaseDocumentPriority` entry in System B (`keyboardShortcutsStore.ts:39`) is removed, and the `DocumentsView.tsx:987-1009` keydown handler is repointed to System A and reworked to open the popup instead of nudging +1.

**Default preserved:** System A's new entry defaults to `Shift+P`, so users who never rebound it see no change. A user who rebound System B's `Shift+P` loses that custom binding (different persistence key); the CHANGELOG notes the one-time reset.

**Alternative rejected — register in both stores.** Two stores owning one shortcut guarantees drift. One store.

### D4. Rewire `calculate_fsrs_document_priority` to consume the slider

This is the "make it real" decision. Today the function signature takes `priority_rating: i32` and applies it as a 0.5×–2.0× multiplier (`algorithms/mod.rs:240-245, 282`), with a clamp bug (`1..=10` for a 1-5 field).

**Decision:** change the function to take the 0-100 value (pass `priority_slider`, falling back to a slider-derived value from `priority_rating` if `priority_slider == 0` — i.e. legacy rows). Re-derive the multiplier linearly from 0-100: `multiplier = 0.5 + (slider/100.0) * 1.5`, giving 0.5× at 0 and 2.0× at 100. Update the 4 call sites in `queue.rs` (`:324, :742, :832, :950`) to pass the slider.

The 1-10 clamp bug is removed by the rewrite. The multiplier range (0.5×–2.0×) is preserved, so a document at the old "rating 5" (~1.33× today due to the bug, ~2.0× after) will sort a little higher than before — document this as a behavior change.

**Migration of existing rows:** documents created today default to `priority_slider: 0` and `priority_rating: 0`. A 0 slider would mean 0.5× (lowest); to avoid silently demoting everything, treat `slider == 0 && rating == 0` as the neutral midpoint (1.0× / 50) until the user sets a priority. This preserves current "unset = neutral" behavior.

**Alternative rejected — add a settings toggle.** Opt-in adds complexity and splits the user base; the user chose the slider to be authoritative. Ship it as the ordering input and document the change.

### D5. Centralize `slider → rating` derivation in the backend

Add one function (e.g. `rating_from_slider(slider: i32) -> i32`) in `algorithms/mod.rs`, used by:
- `update_document_priority` (`document.rs:929`) — derive `priority_rating` from the passed slider, then compute `priority_score` via the existing canonical formula.
- `update_document` (`document.rs:907` / `repository.rs:1215`) — when a Document comes in, if `priority_slider` changed, re-derive rating + score so the generic path can't desync.
- The bulk path — see D6.

This removes the frontend-only `sliderToRating` (`PriorityControl.tsx:48-55`) as a source of truth; the reader still calls `updateDocumentPriority(id, rating, slider)` but the backend authoritative derivation wins. The TS helper is kept only to display the right badge color.

### D6. Bulk reprioritize + mass-set share one backend path

The `Shift+P` mass-set and the bulk "Reprioritize" button both call a single path that, per id: writes `priority_slider`, derives `priority_rating` + `priority_score` via the canonical formula, and aggregates a `BulkOperationResult` (succeeded/failed + reasons). This replaces `handleBulkReprioritize`'s local `rating*20` score and its `updateDocument({ priorityRating, priorityScore })` that left the slider untouched (`DocumentsView.tsx:919`).

If a bulk command already exists for per-document priority write, reuse it; otherwise add one `bulk_set_document_priority(ids, slider)` in `commands/document.rs` (mirroring the suspend/delete bulk pattern in `queue_bulk.rs`).

## Risks / Trade-offs

- **[Ordering behavior change for all users]** Rewiring the sort to read the slider changes every queue's document order on next build. → Mitigation: only affects *order* of due documents, not *when* due (EngagingScheduler untouched, takes no priority); preserve "unset = neutral" (D4) so default documents don't move to the bottom; run the existing priority tests + a before/after queue snapshot; CHANGELOG entry flagged as behavior change.
- **[Legacy rows with slider=0]** Pre-existing documents may have a slider of 0 and a non-zero rating, or both 0. → Mitigation: D4's fallback (slider==0 ⇒ derive from rating; both 0 ⇒ neutral) handles this without a migration. An optional one-time `priority_score` recompute cleans up the bulk-path drift but isn't required.
- **[Mass-set over a large selection]** Setting 500 documents in one go is N writes. → Mitigation: a single bulk command with one transaction (pattern from `queue_bulk.rs`), not N frontend round-trips; show progress in the popup.
- **[Inline slider overflow in tight layouts]** → Mitigation: D2's narrow-width fallback to badge + `Shift+P`.
- **[Shortcut migration drops custom `Shift+P`]** → Mitigation: default preserved; CHANGELOG note.
- **[Two stores, partial migration]** Only the priority entry moves System B → A. → Accepted; a full RSS-shortcut migration is out of scope and riskier.

## Open Questions

- Confirm the inline continuous slider fits the `LibraryCard` hover footer at the smallest supported card width; if not, finalize the responsive gate threshold. Resolved during implementation by measuring against the existing tag/progress footer rows.
- Decide whether to ship the optional one-time `priority_score` recompute on first launch (cleans up legacy drift) or leave existing rows as-is and let writes fix them incrementally. Leaning toward ship-it-lazily (write-path fix only) to avoid a startup migration.
