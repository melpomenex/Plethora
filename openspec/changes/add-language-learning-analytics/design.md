## Context

Existing analytics commands aggregate reading/review activity, while the new lexicon will provide durable occurrences and evidence. The dashboard must avoid counting cached renders as encounters and must distinguish passive recognition from active production.

## Dependencies

- Hard: #1, #3, and #4.
- Soft: #10 coverage, #11 SRS, #13 alignment, #19 shadowing, #20 dictation, and #22 writing.
- Coordinate with `implement-plethora-knowledge-health-and-advanced-learning-analytics`; all later evidence producers must consume the metric catalog/event contract.

## Goals / Non-Goals

**Goals:**

- Answer trend questions with reproducible definitions and profile scope.
- Reuse existing events/analytics architecture and avoid loading raw occurrences into the UI.
- Support eventual coverage/difficulty and SRS retention metrics without making them prerequisites for reading.

**Non-Goals:**

- A social leaderboard, wellness diagnosis, or new scheduler.
- Claiming active knowledge from reading alone.

## Decisions

1. **Metric catalog with explicit definitions.** Register metric IDs, source events, units, denominator, profile scope, and validity/unknown state rather than scattering formulas in components.
2. **Daily/profile aggregates.** Materialize bounded daily aggregates for fast charts; retain raw source evidence under lexicon/practice retention policies. Recompute idempotently by event cursor/version.
3. **Profile and document dimensions.** All language metrics require profile ID; document-level views include source type and language. Generic analytics queries remain unchanged when no profile filter is supplied.
4. **Coverage as optional input.** Coverage/difficulty metrics appear only when the coverage projection is current; analytics label stale/pending rather than substituting misleading zero.
5. **Privacy controls.** Provide retention/export/delete controls and do not send raw passages to analytics providers; local analytics remain functional offline.

## Risks / Trade-offs

- [Definitions drift] → Version metric formulas and expose “as of”/data freshness.
- [Backfill expensive] → Incremental cursors, background jobs, and bounded recompute windows.
- [Small samples distort rates] → Show denominators/confidence and suppress rates below a minimum sample.
- [Practice features arrive later] → Keep active/passive dimensions nullable and add evidence adapters.

## Migration Plan

1. Add metric catalog and profile-scoped aggregate schema.
2. Backfill only available generic reading/listening/lookup events; label historical coverage limits.
3. Add live lexicon/state event ingestion and later practice evidence.

## Open Questions

- Default streak definition across reading/listening/practice.
- Whether lookup rate counts cached dictionary re-views or only user-initiated lookup events.
- Which aggregate retention is appropriate for local storage.
