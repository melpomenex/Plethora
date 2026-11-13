## Context

C7 already defines bounded, source-scoped tutoring, a diagnostic blueprint/attempt, and a draft-only adaptation adapter. The creation form and generator expose diagnostic slots; the plan route needs a verified end-to-end entry. This change consumes the authority union and provenance validators from `add-study-plan-knowledge-policies`.

## Goals / Non-Goals

**Goals:** Reuse TutorSession/TutorSheet and assessment behavior while giving Study Plans a durable lesson boundary.

**Non-Goals:** A separate diagnostic engine, a new scoring system, global tutor changes, or a second source of learner progress.

## Decisions

1. **Persist lesson state natively.** Key the session by its stable ID plus plan version, node and objective; store policy/source revision snapshot, style, turn state, prompt, answer draft, hint count, and pinned route/budget metadata. Store learner text locally under existing privacy controls. Checkpoint at user actions and validated responses; use expected revisions and turn/request IDs to reconcile interrupted sends and protect against two clients advancing one session. Restore the last committed state without automatic inference.
2. **Keep pedagogical strategy in a small state machine.** Reuse the tutor runtime and bound actions to activate, probe, interpret, scaffold, check and handoff. Guided starts with one question; Explain + Check starts with a short explanation; Challenge starts with application. Each supports direct explanation and optional confidence/reasoning. Two unproductive probes or three hint steps offer explain-and-check or pause; no retry loop or hidden “continue” model call.
3. **Reuse policy, validate before render.** Library-backed retrieval uses only current eligible refs in the pinned scope; stale refs block the affected action and offer a reviewed revision rather than a silent rebind. Mixed material is separated inline; model-only has no retrieval adapter. Do not pass an empty filter into existing library retrieval. A resumed route revalidates source revisions, data destinations, consent and budget. If blocked, the saved lesson and permitted offline reading remain available.
4. **Bridge to existing attempts.** Preview offers Take Diagnostic or Skip after a provisional map. Source-backed uses C7's 4–12 item path and final-result adapter; only an accepted adaptation becomes a draft diff. Model-only may offer a clearly unverified ability probe without creating demonstrated evidence or applying an evidence-based reorder. The final lesson check is formative; “Practice independently” starts a separate, explicitly chosen assessment route with its own provenance and committed question revision.

## Risks / Trade-offs

- [Restart mid-turn] → Preserve submitted learner input and retry explicitly; a late/duplicate response cannot commit a second turn.
- [Changed plan] → Display the pinned and current version; offer the current version as a new lesson. Do not mix old evidence or quietly rewrite the transcript.
- [Accessibility and small screens] → Keep prompt, composer and escape actions discoverable; use announced async states, restore focus, and make dictation optional where supported.

## Migration Plan

Add session storage without modifying existing tutor or attempt history. Legacy plans can start a fresh lesson using their mapped authority. Disabling the new entry keeps saved sessions readable.
