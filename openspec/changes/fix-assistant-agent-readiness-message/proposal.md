## Why

Toggling **Learn** (the Learning Agent mode) in the Assistant on mobile can surface a raw translation key instead of a sentence:

> Learning Agent is unavailable: ai.limitation.lexicalRetrieval

Two independent defects combine:

1. `AssistantPanel` reads the first *limitation* of the readiness row and passes it
   un-translated into the mode-unavailable notice
   (`src/components/assistant/AssistantPanel.tsx:600-605`, consumed at
   `:3708`, `:3717`, `:4300`). `limitations` are disclosure notes for a row that
   is **ready** (e.g. "lexical evidence only"); they are not blocking reasons.
2. Because `t()` returns its argument when a lookup misses
   (`src/lib/i18n/index.ts:149`), any un-translated key is rendered verbatim. Mobile
   additionally reports a lexical-fallback limitation because embeddings are
   unavailable there, so the leak appears on every non-ready mobile row rather than
   only when the translation is missing.

The visible failure is worse than a cosmetic one: the notice names an unrelated
degradation ("lexical retrieval") as the reason the Learning Agent cannot start,
while the actual blocker (provider/model/download/setup dependency) is never shown.

## What Changes

- Derive the blocked-mode reason from the **first unmet dependency** of the feature
  readiness row (`dependencies[].reasonKey`), not from `limitations`.
- Translate the reason before it reaches the notice; a limitation may still be shown
  as a secondary, translated disclosure, never as the blocking reason.
- Keep deterministic fallback copy (`assistant.agent.modeBlocked`) when no reason key
  exists, and keep the notice's `{reason}` placeholder contract.
- Add regression tests for: non-ready row **with** a limitation, translated reason,
  raw-key absence, and mobile (`Learn`) presentation parity.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-learning-agent`: readiness/limitation messaging for entering the agent mode is
  specified — the blocking reason comes from the unmet dependency and every rendered
  readiness string is localized.

## Scope and non-goals

In scope: the Assistant composer mode toggle (desktop and mobile presentations), the
`agentUnavailableReason` derivation, and the copy contract for readiness/limitation
keys. Not in scope: changing probe results, adding a new recovery route, altering the
agent's execution budget, or translating every AI readiness string that already uses
`t()`.

## Impact

`src/components/assistant/AssistantPanel.tsx` (reason derivation + translation) and
its tests. No schema, provider, or Settings changes. The existing
`assistant.mode.unavailable` copy keeps its `{reason}` placeholder, so other locales
are unaffected.

## Compatibility risks

A dependency list can contain a `reasonKey` for a *satisfied* dependency; the fix must
select only unmet states (`missing`/`unsupported`/`unknown`/`checking`) and preserve
the previous fallback when none is present, so a ready row can never regress into a
blocked notice.

## Definition of Done

With a non-ready readiness row that also reports `ai.limitation.lexicalRetrieval`, the
mode toggle shows a translated blocking reason, never a dotted key, on both the mobile
(`Learn`) and desktop (`Learning Agent`) presentations; a ready row with the same
limitation stays enterable; the full Assistant test suite passes.
