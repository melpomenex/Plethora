## Why

Opening an extract in the Queue silently calls the AI provider to generate progressive
disclosure summaries, then replaces the extract text with a compressed summary. Nothing
in Settings asks for this and nothing explains it: the card renders `AI Summary - Level
1/3` next to a `Level 0/3` badge, so the user sees their highlight shrink and two
different "levels" for the same state. New extracts are created with
`max_disclosure_level = 3` even though the extract dialog shows `0` selected, so every
user is opted into a metered, latency-bearing AI call they never requested. Automatic
AI use must be opt-in.

## What Changes

- Add a global setting **"Generate AI summaries for extracts during review"** in
  Settings → AI → Summarization, **default off**. When off, the Queue / Scroll Mode
  extract view never calls the AI provider for summaries and renders the extract's full
  content, editable, exactly as a non-disclosure extract does today.
- Refuse automatic summary generation unless the setting is on **and** the extract has
  `max_disclosure_level > 0` **and** no cached `progressive_summaries`.
- New extracts SHALL default to `max_disclosure_level = 0` (progressive disclosure off),
  matching what the extract dialog displays. Existing extracts keep their stored value
  so enabling the setting later restores their configured behavior.
- Fix per-extract disabling: choosing level `0` in the extract create/edit dialog SHALL
  persist `0` instead of sending `undefined` (which the backend currently ignores).
- Remove the string-compare on the translated "Full content" label in the reveal
  renderer so the editable branch is reachable in every locale.
- No new AI call is ever made implicitly when the setting is off; the Tauri command
  stays available for explicit invocations.

## Capabilities

### New Capabilities
- `extract-progressive-disclosure`: how an extract card renders in Queue / Scroll Mode —
  when AI progressive summaries may be generated, what is shown when they are disabled,
  and how disclosure levels are configured, defaulted, and persisted.

### Modified Capabilities
- `summarization-controls`: adds the extract progressive-summary opt-in toggle (default
  off) to the Summarization settings sub-section and states that it gates automatic
  generation.

## Impact

- **Frontend**: `src/stores/settingsStore.ts` (new `aiControls` field + default),
  `src/components/settings/AIProviderSettings.tsx` (Summarization section row),
  `src/components/review/ExtractScrollItem.tsx` (gate the mount effect, redefine the
  no-summary branch, drop the localized-string comparison),
  `src/components/extracts/CreateExtractDialog.tsx` (send `0`, default the selector to
  the stored value).
- **Backend**: `src-tauri/src/models/extract.rs` (`Extract::new` default 3 → 0),
  `src-tauri/src/generator/mod.rs`, `src-tauri/src/browser_sync_server.rs` (same
  hardcoded 3), `src-tauri/src/commands/ai.rs` (keep the command; document the
  precondition; no automatic caller). Schema defaults and existing rows are untouched.
- **Sync / archive**: no wire-format change — `max_disclosure_level` and
  `progressive_summaries` already round-trip.
- **Tests**: extract scroll item rendering cases (setting off, on with cached
  summaries, mid-generation), settings default/migration test, dialog 0-persistence
  test. No benchmark should regress; `npm run bench:check` still applies.
