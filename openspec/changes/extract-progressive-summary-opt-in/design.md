## Context

See `proposal.md` for motivation. The mechanics that constrain the design:

- The automatic call lives in `ExtractScrollItem`'s mount effect
  (`src/components/review/ExtractScrollItem.tsx:84-109`): if
  `max_disclosure_level > 0` and no `progressive_summaries` are cached, it calls
  `generateProgressiveSummaries`. There is exactly one automatic call site; the Tauri
  command (`src-tauri/src/commands/ai.rs:599`) has no other caller.
- Settings are persisted in `localStorage` through the zustand `persist` middleware
  (`src/stores/settingsStore.ts:1594`), not in the backend `settings` table. The backend
  therefore cannot read this toggle without new plumbing.
- Disclosure state is per extract: `max_disclosure_level` (rows default to 3 at creation
  via `Extract::new` and two sync/import paths) and `progressive_disclosure_level`,
  advanced by `submit_extract_review` only on rating 3/4
  (`src-tauri/src/commands/extract_review.rs:70-77`).
- Display is derived in `getDisplayContent()` and branches on the translated string
  `"Full content"` (`ExtractScrollItem.tsx:399`), which only matches in English.

## Goals / Non-Goals

**Goals:**

- One global, default-off switch that controls every automatic extract summary call.
- Disabled means full, editable text — nothing hidden, no badge, no levels.
- New extracts start with disclosure off; the dialog's selected value is the stored one.
- One consistent level vocabulary in the card, so a state is never shown as two levels.
- Keep the change reversible: turning the setting back on restores the old behavior for
  extracts that still have levels or cached summaries.

**Non-Goals:**

- Redesigning progressive disclosure itself, or removing per-extract levels.
- Backend-enforced preference storage or settings sync across devices (consistent with
  every other `aiControls` field today).
- A manual "summarize this extract now" action. The Tauri command stays available, but
  no new UI is added for it.
- Migrating existing extracts to `max_disclosure_level = 0`.

## Decisions

### Decision: the setting lives in Settings → AI → Summarization as an `aiControls` field

Add `aiControls.extractProgressiveSummaries: boolean` (default `false`) and a fourth row
in the existing Summarization sub-section (`AIProviderSettings.tsx:739-814`), labelled
"Generate AI summaries for extracts during review". The section description changes from
"Automatically summarize long extracts" to cover both summarization behaviors.

Alternatives considered:

- *A new Reading/Queue settings section* — more discoverable from where the behavior is
  seen, but it splits AI cost controls from the AI section and needs new navigation.
- *A `features` flag (kill switch)* — features are product-availability gates; this is a
  user preference with a normal default.

The field name avoids collision with the existing `autoSummarize` (auto-summarize long
extracts at capture time), which is a different feature and stays untouched.

### Decision: gate in the reviewer, not in the backend command

`ExtractScrollItem` reads the store directly (`useSettingsStore.getState()`), like
`handleAutoSummarization` does today, and skips the effect when the setting is off. The
Tauri command is left as-is; it already returns cached summaries and validates
`max_level > 0`.

Alternatives considered:

- *Pass the preference into the command* — duplicates a frontend-only preference on the
  wire for every call.
- *Persist the preference to the backend `settings` table and enforce there* — correct in
  theory, but would introduce a second source of truth for a single `aiControls` flag and
  diverge from the rest of the AI settings. Revisit if a backend-initiated summarizer is
  ever added.

### Decision: model the display as an explicit state machine, extracted for testing

Replace `getDisplayContent()`'s implicit fall-through with a pure helper
`resolveExtractDisplay(input)` in `src/lib/extractDisclosure.ts`, returning
`{ text, kind: "full" | "summary" | "partial", levelLabel }`, where `kind` replaces the
string comparison against `t("extractScrollItem.fullContent")`.

Rules:

1. `settingOff || maxLevel <= 0` → `full`.
2. `stage = clamp(progressive_disclosure_level, 0, maxLevel - 1)`.
3. `stage < ceil(maxLevel / 2)` → summary with cached entry `stage`.
4. `stage === maxLevel - 1` → `full` (the final stage is always the full extract).
5. otherwise → `partial` with fraction `(stage - aiLevels + 1) / (maxLevel - aiLevels)`.

This makes one-based stage numbering authoritative for both the header badge
(`Level {stage + 1}/{maxLevel}`) and the content badge (`AI Summary - Level {stage + 1}/{maxLevel}`),
so the `Level 0/3` vs `Level 1/3` split disappears. For `maxLevel = 3` the stages become
summary, summary, full — the old 50% text step collapses into the final stage because the
second half is a single step. For larger maximums the partial steps remain, with a clean
`1/n … n/n` progression instead of `(i+1)/(n+1)`.

Alternatives considered:

- *Keep indices and only change the header to `current + 1`* — leaves a `3/3` header over
  half-revealed text, which contradicts the spec's final-stage rule.
- *Keep the string comparison* — breaks the editable branch in every non-English locale.

### Decision: an extract with disclosure off renders exactly like one with `maxLevel = 0`

When the setting is off, the card shows the full text, hides the summary badge, and hides
the `Level x/y` header badge. Stored `max_disclosure_level` and cached
`progressive_summaries` are not mutated, so re-enabling the setting restores the previous
state without regeneration.

### Decision: flip the creation default to zero, leave schema defaults alone

`Extract::new` (and the two hardcoded `max_disclosure_level: 3` call sites in
`src-tauri/src/generator/mod.rs:217` and `src-tauri/src/browser_sync_server.rs:2237`)
change to `0`. The SQL column default of 3 and the read fallback stay: every insert binds
an explicit value, so they only affect rows created before this change, which must keep
their current behavior.

`CreateExtractDialog` sends the raw selector value (`0` included) on both create and
update instead of `progressiveLevel > 0 ? progressiveLevel : undefined`. `create_extract`
and `update_extract` already do `if let Some(level)`, so `Some(0)` is applied correctly and
the update path can finally disable disclosure.

## Risks / Trade-offs

- **[Users who liked the old default lose automatic summaries]** → The toggle is one
  click away in the same section, existing cached summaries are still displayed when
  enabled, and no data is deleted. Release notes must call this out as a default change.
- **[`maxLevel = 3` no longer has a partial-reveal step]** → Intentional: the last stage
  is full text, which is what `3/3` should mean. Users with 4–6 levels keep partial steps.
- **[The setting is device-local]** → Same limitation as every other `aiControls` entry;
  it is also the safer failure mode (a new device will not summarize until asked).
- **[Other code may create extracts and expect the 3-level default]** → The two hardcoded
  call sites are covered by the change; tests asserting `max_disclosure_level: 3` on
  creation must be updated deliberately (they should assert `0`).
- **[A stale cached summary keeps being shown after the user edits the extract text]** →
  Pre-existing behavior, unchanged by this change; the toggle does not make it worse.

## Migration Plan

1. Ship the default change and the gate together. Existing rows keep their stored levels
   and cached summaries; the setting off means no new AI calls.
2. No data migration and no destructive backfill. Rollback is a code revert; the only
   visible regression would be the reappearance of automatic summarization.
3. Update the release notes: "AI summaries for extracts are now opt-in (Settings → AI →
   Summarization)."

## Open Questions

None. The remaining choices (exact row copy, whether to rename the section description)
are cosmetic and do not change specs or tasks.
