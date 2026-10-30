## Context

See [proposal.md](proposal.md) for scope and [investigation.md](investigation.md) for current-revision evidence. Plethora has three separate concepts that currently leak into one another: the user's global priority order, a scheduler's next due date, and the queue's relative ranking of eligible work. Review surfaces also mix complete LearningItems with partial queue DTOs, and the Assistant overloads a document identity with display-only source namespaces.

This change extends existing Rust repository/commands, frontend stores, undo operations, card presentation, source resolvers, provider adapters, and acceptance keys. It does not introduce an alternative scheduler, persistence engine, or AI generator. All implementation tasks remain unchecked.

## Goals / Non-Goals

**Goals:** Make the ranking policy measurable; give every review surface the same canonical card and source semantics; assign one owner to each durable mutation and one owner to advancement; preserve independent scheduling histories, local operation, sync, and user-controlled position.

**Non-Goals:** Retraining FSRS, changing target retention/interval modifiers, treating reading as verified recall, per-index cloze sibling generation, repairing every historical corrupt import automatically, a global integrations redesign, supporting an unavailable native AI backend on another OS, or changing the neural queue's distinct exploratory policy. Neural sessions consume the same card mutations without rewriting their spreading-activation algorithm.

## Decisions

### D1. Preserve positional manual priority and normalize it once

**Canonical durable value:** existing `priority_score` order key allocated by `database/priority_rank.rs`, with higher keys more important. Keep every existing key unchanged. A slider value is a request to move within that order, not an independent importance score. `priority_slider` remains a compatibility/request snapshot; `priority_rating` is a derived compact bucket, never another multiplier. Use `priority_explicitly_set` to distinguish explicit zero from legacy unset values wherever legacy resolution is still needed.

For an active collection snapshot of N presentable documents, text extracts, and cards, let b be the number of keys strictly below the item's key. Define `P = b/(N-1)` for N>1 and P=.5 for N<=1. Equal keys receive equal P; entity identity breaks queue ties without renumbering historical rows. Use the same presentable-element population as priority standing, before due/session/type filtering, so P does not change merely because a session filter changes. Archived/dismissed/suspended items remain excluded according to existing policy. Compute the sorted keys once per ranking snapshot, using sort/binary search rather than one DB query per item. Current rank labels and ranking use that same snapshot. A legacy keyless/invalid row gets neutral P=.5 plus a diagnostic; no batch rewrite on startup.

For video extracts/audio editions without their own supported priority control, inherit their persisted parent document's P, or .5 if no parent rank exists. Do not invent independent stored preference fields for them. Playlist subscription priorities remain an explicitly labeled **1–10 legacy setting**, higher more important; normalize as `(r-1)/9` for temporary playlist candidates. Once a video is an ordinary document, its document order key wins. Subscription priority seeds the rank request for newly imported videos; it does not override a document later reprioritized by the user. This adapter is intentionally distinct from the document's 1–5 bucket.

Priority writes must call the existing entity-specific command, using one rank allocator and transaction for key/request snapshot/derived fields/explicit flag/outbox. Mouse, keyboard, and touch use one frontend commit service. This is one persistence policy with typed entity dispatch, not a new unified table. Preserve inheritance for extracts still following their document; individually reprioritized extracts retain their own key.

**Rejected:** invert all values to match stale help (destroys user intent); use raw key/100 as P (keys encode order, not distance); use slider snapshot indefinitely (disagrees with live rank); multiply the scheduler by priority (couples importance to timing and double-counts); persist a second normalized P (drifts after imports). Labels and help must clearly distinguish percent importance from Position 1 being the top.

### D2. Use one temporal term and one manual term

The initial **product heuristic**, not an empirically fitted FSRS equation, is:

```text
M = 0.8 T + 0.2 P                              M,T,P ∈ [0,1]
d = max(0, (now - due_at).seconds / 86400)       d ∈ [0,∞), finite
O(d) = -expm1(-d / 14)                         O ∈ [0,1]
A = 0.5 + 0.5 O(d)                            due/overdue readiness

Rotational items (documents, text/video extracts):
  T = 0                 if a valid due_at > now
  T = A                 if a valid due_at <= now
  T = 0.5               if genuinely new/no due date, or invalid/missing state

Recall cards:
  R = 1 - r             only when r is a valid scheduler retrievability at now
  T = R                 if future due and R exists; otherwise 0 for future due
  T = max(R, A)         if due and R exists; otherwise A for due
  T = 0.5               if genuinely new/no due date, or invalid/missing state
```

`now` is an explicit UTC instant captured once per pass. Exact equality is due; a timestamp later today is future until it arrives. d uses fractional days, not truncating whole-day arithmetic. Missing due yields O=0 for diagnostics, never maximum overdue. Invalid date/state is recorded as unavailable and takes the stated neutral/future/due fallback; it is not guessed from `item.priority`. For a due card missing memory, its due date remains valid evidence of readiness.

Use a scheduler-provided r evaluated at `now`, including the correct production memory representation. If unavailable, derive r only through the existing recall scheduler with **last review**, elapsed time, interval, and valid memory state; never use elapsed-since-due as elapsed-since-review, never introduce another `.9^...` approximation. If the scheduler cannot evaluate it, use the fallback above. Documents/text/video extracts deliberately use rotation dates without pretending their stability is measured factual recall. Raw stability/difficulty remain available to their scheduler and diagnostics.

The 80/20 split preserves the previous policy's total non-manual/manual allocation while removing the misleading separation of correlated U and O. Eight tenths makes scheduling primary; two tenths allows an important new item to beat modestly late low-priority material. Due readiness starts halfway to saturation: reaching a due date makes work ready without equating it to maximally overdue work. These are explicit initial choices, subject to fixture evaluation, not new unexplained “optimal” constants. There are no automatic coefficient-learning or new user tuning settings in this change.

`max(R,A)` chooses the stronger temporal evidence instead of summing lateness and recall loss as independent facts. Both are monotone for fixed scheduling/manual state as time advances. P changes neither R, O, T, nor any due date. Low stability/high difficulty bonuses and `B=max(5,10-.1d)` are removed **from ranking**; FSRS state and actual ratings remain intact.

The old helper `calculate_fsrs_document_priority` becomes a thin adapter to the shared temporal/manual ranking policy with an explicit clock, or is removed after all queue callers migrate. Engaging queue selection uses that shared ranking helper, while `schedule_item` and `schedule_document_with_fast_stability` continue to own intervals. No helper with hidden `Utc::now()` remains on a supposedly deterministic ranking path.

**Numerical contract:** Check finite floats before arithmetic. Reject NaN/infinite r or r outside [0,1] as unavailable; validate memory before calling the scheduler. Convert timestamp differences without integer negation overflow, clamp negative d to zero, and use `expm1` for near-zero precision. Huge representable positive d saturates safely; floating point may round O to exactly 1. Clamp only final finite rounding noise to [0,1]; a non-finite intermediate produces the documented default and a diagnostic. No database mutation occurs during ranking.

### D3. Choose smooth overdue saturation, with an interpretable scale

| Candidate | Consequence | Decision |
|---|---|---|
| `min(d/14,1)` | Simple, but all lateness after day 14 is indistinguishable and creates a kink | Replace |
| `min(d/30,1)` or 90 | Moves the same hard boundary; lacks a reason for the chosen stop | Reject |
| `1-exp(-d/τ)` | Bounded, strictly increasing in exact arithmetic, no arbitrary cutoff | Choose τ=14 days |
| `d/(d+τ)` or bounded logarithm | Bounded rational curve is viable but has a much longer tail; log needs an additional bounding rule/scale | Reject initially to keep the catch-up horizon explicit |

τ is an **e-folding timescale**: 14 days gives 63.2% of the possible overdue boost; 42 days gives 95.0%, and 90 days 99.84%. Retain two weeks as the familiar initial response scale, not as a ceiling. Old material remains important without unbounded influence. A 300-day item has effectively the same bounded urgency as a 90-day item; precise ancient ordering can use due-date ties/triage rather than increasing score forever.

No archival or automatic postponement is smuggled into lateness. Backlog triage/deferral remains an explicit user action using existing controls. A bounded static score cannot prove fairness under an infinite stream of urgent arrivals. Preserve existing new/review quotas and consume session identities without replacement; validate important-new exposure in those budgets and finite backlog drain. Do not claim universal starvation freedom.

### D4. Make ranking behavior and explanations agree across strategies

DAQE keeps its existing outer weights and penalty/goal terms:

`Score = w_srs*M + w_goal*G + w_energy*E - w_interleave*I - w_friction*F`.

M is in [0,1]; the final score can be negative and is not a probability. At default w_srs=.40, changing P from 0 to 1 changes final score by exactly .08 when other signals are fixed. Existing outer knobs remain the product-level way to change importance of the whole memory/readiness term. Goal models do not receive manual priority as a shortcut to topical relevance.

For SRS-only fallback preserve the **eligibility buckets due, new, future**, but sort within each by the new 10M compatibility score. The fallback must consume the captured clock and same features, not call old document-decay logic. Bare user-priority sorting remains positional P/order-key sorting. Already-selected custom session order remains stable until the user requests rebuilding. Neural exploration keeps its separate policy but uses canonical manual importance and full hydrated records.

`src/utils/reviewUx.ts` priority-vector/Smart Queue consumers must receive the canonical temporal/manual breakdown. Retention risk must not read a score containing P; manual intent must not reread a rating independently of P. Keep the existing five diagnostic dimensions and preset names, but derive retention and overdue diagnostics from T/O and manual intent from P. For an already adaptive-ranked queue, preserve the returned score/order through `buildScrollSessionItems` and filters rather than applying `getPriorityScore` as a second ranking stage. For standalone legacy Smart Queue scoring, combine scheduling via T **once**, manual via P **once**, then the preset's existing time/load signals; collapse the previous retention+overdue weights into a single temporal weight and retain the previous intent weight for P. Tag count is not a second manual-priority value; topical tag relevance belongs to the goal term. This deterministic compatibility mapping requires fixtures for every named preset and updated diagnostic copy. Base vector requirements must be amended with this change (see capability delta).

Tie order is score descending, valid due timestamp ascending (missing after dated items), then stable `(entity_kind, entity_id)` ascending. Do not depend on incoming query order. Preserve established active session position by identity during a refresh; deterministic pool ordering does not authorize moving an in-flight card.

### D5. Require a complete card and one presentation boundary

Add a narrow canonical `ReviewCardContent` presentation component, backed by an extended `src/utils/cloze.ts` parser and the existing sanitized Anki/LaTeX renderer. Move content semantics out of both `ReviewCard` and `FlashcardScrollItem`; retain their layouts, toolbars, timing, assessment UI, and gestures. Do not mount the whole ReviewSession inside Scroll Mode.

At API adapters normalize backend casing/field names into a complete LearningItem. Session composition carries `(entity_kind, entity_id)` separately from queue-entry IDs and display titles. Fetch missing cards by ID using existing bounded full-card reads; batch where available. Never synthesize a reviewable `any` card from a listing DTO or due-only miss. Deleted/suspended rows are removed; transient fetch errors show retry/skip while withholding rating. Non-due cards explicitly included in a custom session are hydrated through get-by-ID, respecting its eligibility policy.

**Cloze precedence and semantics:**

1. Canonical raw source is nonempty cloze_text, otherwise question. Valid brace/bracket markers win over stored ranges.
2. Parse numbered `{{cN::answer}}`, `{{cN::answer::hint}}`, simplified `{{answer}}` / `{{::answer}}`, and recognized legacy `[[cN::answer]]` (including multiline answers). Preserve source formatting. Simplified normalization must avoid allocating an index already used by explicit markers.
3. If marker-free, accept only ordered, nonoverlapping integer ranges within the exact source revision. Treat legacy offsets consistently with their producer; convert Rust byte offsets to frontend UTF-16 offsets when necessary and prove it with non-ASCII fixtures. Ranges crossing markup boundaries cannot be spliced as arbitrary HTML fragments.
4. For legacy text+ranges, reconstruct a lossless marked editing projection and reparse it on save. Do not replace it with marker-free text and silently lose deletion identity. Raw source remains available if reconstruction is unsafe.
5. Malformed markers or unusable ranges on a cloze with nothing safely hideable produce a repair state before review: no plaintext answer leakage, no grading, edit/retry/skip available. Marker-free saves remain allowed with the existing warning; returning to review then requires repair or an explicit conversion to a basic card.
6. Current Plethora semantics hide **all deletions on the persisted card together**, including c1/c2 and repeated indexes. Preserve identifiers through edit/import/export; do not auto-create sibling cards or reset schedules. A future per-index feature needs a separate product decision.

Hidden answers must be absent from rendered review DOM/accessibility labels, tooltips, queue titles/previews, and automatic speech; merely applying CSS visibility is insufficient. Safe previews render blanks/hints; reveal supplies answer text in surrounding context with existing formatting/sanitization. Authoring raw fields are explicitly labeled authoring surfaces and may show answers. Auxiliary AI explanation requests use the actual canonical card source, not the translated card-type label. Explanation generation must not reveal hidden card content onscreen before reveal; preserve intentional user-controlled source navigation.

**Rejected:** another regex per view; trusting any nonempty range array; converting all historical clozes in a migration; inferring Anki sibling semantics from numbered syntax.

### D6. Share occlusion geometry and asset handling

Extract the content-only occlusion primitive already embodied by ReviewCard, reuse coordinate utilities and composer metadata, and consume it through `ReviewCardContent`. Recognition uses interaction metadata even when the underlying item is QA. Resolve one authored source asset, and wrap the actual image content box in a shrink-wrapped positioned container; masks use the same normalized coordinate space. Height/width constraints must not attach masks to letterbox padding. Preserve target-region reveal and reveal-all behavior from Review. The existing opaque-default/authored-color semantics remain in effect.

Asset loading has explicit loading, ready, missing/corrupt, and retry states; failed loads do not turn an occlusion into an unmasked basic card or leave an extra plain image copy. Guard stale async image resolutions when card identity changes. Share the established local-asset/data-URL resolver across native and browser adapters. Validate finite geometry and normalized bounds; malformed geometry blocks review with repair guidance. Test resize and layout changes, not only class names, at desktop/mobile sizes and device scale factors.

### D7. One durable operation owner, one session transition owner

Use existing stores and repository commands behind a small shared mutation coordinator, not a second global review store. ReviewStore owns Review's session; QueueScrollPage owns composed Scroll/Optimal sessions; both use the same pure identity-based transition/reconciliation functions. Presentation emits intents only. The coordinator owns backend calls, validation, mutation IDs, busy state, and canonical results; each session owner consumes the result and advances **once**. Children do not submit then ask parents to submit again.

State contract: normalized entity cache, ordered session entry identities, current identity, reveal state keyed by current identity/content revision, completed/rated IDs, pending operation per entity, deleted-ID barrier, and session/refresh generation. Index is derived from current identity. Remove the independent delayed rendered-index authority; animation observes committed state and cannot change it. No artificial delay or queue reload is used to repair correctness.

Mutations follow validate → commit → reconcile → notify. Edits can retain current optimistic rendering per the base spec, but only one revision may apply/roll back. Per-entity operations serialize: edit/delete disabled during rating; rating/delete disabled during edit; delete disabled during another pending mutation. Synchronous operation tokens block two activations in one render tick. On failure retain the draft/current identity and offer a readable retry; no advancement or fake review occurs.

**Atomic edits:** Extend the existing versioned content operation to accept tags and canonical cloze source/ranges in one transaction, including full old-content snapshot, version insertion, content/tag write, and existing sync outbox/revision update. Missing fields remain untouched; empty strings intentionally clear fields. Scheduling, source links, priority keys, algorithm state, memory, and history are excluded from the patch. Return the committed canonical record; patch all caches/session copies by ID. Do not roll back a successful content write because a separate tag command failed. Legacy API signatures can delegate with optional fields while callers migrate. Extend version restore to the same complete content snapshot semantics without rescheduling.

**Deletion:** Reuse undoable delete/restore and sync tombstones. Capture entity and successor identity before awaiting commit. On successful delete, atomically record deleted barrier, remove every active representation and due-cache entry, choose the next surviving successor (or preceding survivor when deleting the last; complete when empty), clear reveal, and update progress without incrementing review count. Deleting a noncurrent earlier item leaves current identity unchanged. If the current item moved while the delete awaited, do not advance its unrelated replacement. Refresh generations started before a commit are ignored or merged through mutation barriers and content revisions; static custom queues cannot resurrect deleted IDs. Barriers persist for the lifetime of the active/restorable session, until confirmed restore, not merely one render.

Undo restores the canonical record with stable identity/scheduling and removes its barrier only after backend success. Restore its original relative slot if surviving neighbors permit, keeping the user's current identity; if deletion completed the session, reopen at the restored item. Failed undo preserves the deletion state. External deletion/suspension/restore uses the same reconciliation path. Session progress separates reviewed, removed, and remaining counts.

### D8. Share priority commit behavior, including keyboard

Keep `doc.priority` and user remapping, Alt+P default, EPUB forwarding, and current modal Enter support. Build on the existing mobile priority control's draft/commit/deduplication behavior instead of adding another shortcut-specific save. The popup, reader badge, standalone PriorityControl, and queue overlay invoke a typed shared priority operation. Bind identity at opening, read the latest draft synchronously at commit, disable duplicate commits, and patch canonical backend result/standing. Escape cancels without writes. Focus returns to the opener; active overlays own keyboard events so rating/navigation do not fire through them.

A rejected commit keeps the draft open/recoverable and shows a localized error. Switching items while a request is pending cannot apply that result to another entity. Enter/pointer/blur completion cannot issue competing mutations; serialize writes per entity and discard stale completions. Persist/read-back assertions, including explicit zero, determine success. The initial keyboard nonpersistence report remains a reproduction task because its current pointer/shortcut popup paths already converge.

### D9. Playlist drafts, explicit save, and defaults semantics

Use string drafts for the global settings form and each expanded subscription. Numeric typing never persists. Save validates the whole draft, commits one patch, and replaces committed/draft state with the returned row (or a post-commit read bound to that request). Cancel restores the committed snapshot. A failed save retains dirty input and focus, with inline errors and retry. Background load completion cannot replace a dirty draft. One pending save per form, with identity/request guards against late responses. Checkboxes in each form participate in that same Save/Cancel lifecycle for a coherent mental model.

Allowed integer ranges match current intended controls: interval 1–50, legacy priority 1–10, max consecutive 1–5, refresh hours 1–168. Validate in UI and authoritative command/repository boundary; blanks, NaN, infinity, fractions, and out-of-range values fail visibly. No truthiness defaults. Existing invalid stored values are displayed as needing correction, not silently rewritten; queue fallback uses a safe documented default with diagnostics until corrected.

Global defaults apply **only when creating a new subscription**, copied in the creation transaction. Existing subscriptions retain their saved values. Explain “Insert one playlist video after every N non-playlist queue items”; interspersion obeys saved per-subscription interval, global max consecutive, active state, and existing session eligibility. For multiple subscriptions whose slots coincide, order by normalized subscription priority then stable subscription/video identity; count only non-playlist items between slots. No default change reschedules imported videos. New imports seed manual rank from that subscription's priority once; later individual changes win. No mass Apply to existing feature is needed.

Preserve existing settings visual authority and shared form/dialog tokens; use labeled groups “Defaults for new playlists” and per-subscription “This playlist,” a concise saved/dirty state, associated labels/errors, adequate touch targets, and responsive stacking. Register stable settings-search targets for defaults, interval, priority, max consecutive, subscription options and relevant reveal behavior; exclude dynamic user titles from the catalog. Update coverage and translated copy. Browser/PWA may retain its explicitly different import capability; local settings editing cannot require yt-dlp or network, and unavailable controls explain why.

### D10. Separate seen from reviewed for video extracts

Add nullable `first_seen_at` and `last_seen_at` to the video-extract model/storage and supported sync/backup/restore serialization. Opening/playing an extract records seen only after the selected segment opens successfully. It does not increment reps/review_count, change memory, or set a due date. Failed media load remains unseen and gives retry. Status is derived, not stored as an enum: **New** = never seen and review_count=0; **Seen · Not reviewed** = seen with zero reviews; **Reviewed** = at least one committed rating; **Due** is an independent date badge. The “New extract” creation button remains a creation action. Existing rows backfill no invented viewing history; reviewed rows remain Reviewed even without seen timestamps.

Both ordinary lists and dedicated extract sessions expose Again/Hard/Good/Easy for the selected extract, including never-rated extracts. Distinguish these controls from parent-document grading in name, focus, and placement. The dedicated review pool includes new extracts plus scheduled due extracts according to session quotas. Parent and child histories remain independent.

The shared extract-review controller owns submission; VideoExtractCard becomes a controlled presentation emitting `onRate` intent and committed results. Change `rate_video_extract` to return the canonical extract plus review receipt. Add a UUID `operation_id` generated once for each user intent and retained on retry. Persist an append-only video-extract review event with unique operation ID, rating, review time, before/after scheduling state, and source identity in the same local transaction as counter/schedule updates. The append-only event table is the durable local review journal. A repeated operation ID with the same payload returns the receipt; a different payload fails; a new operation serializes against the entity revision. Do not deduplicate by timestamp or rating alone. An uncertain transport failure can retry without another review; two legitimate later reviews with distinct operation IDs remain possible.

Use existing review idempotency/agent acceptance patterns as implementation examples. Do not fabricate historical events from aggregate counts. Forward and browser adapters support the same contract, using the established local data layer where applicable; the current HTTP-only fallback is not evidence of offline capability. Playback of a remote-only video can require network, but locally available metadata/ratings/settings must persist offline. No new service requirement is introduced.

Review receipts survive subsequent extract deletion: retain the immutable source identity and before/after state in the event, using a nullable live-row reference or existing tombstone convention rather than deleting the receipt by cascade. A replay returns the original receipt without recreating a deleted extract; the session reconciles its current absence. Add this case to R12 and the migration rehearsal.

#### D10a. Delivery scope clarified 2026-10-30

The user clarified that cloud sync is not a known/used feature of this workflow. This change delivers local lifecycle persistence and backup/restore; it does not introduce a sync protocol, entity families, server rollout, or cloud dependency. The repository's optional entitlement-gated sync implementation remains unchanged. Video lifecycle data is not claimed to synchronize. If a future sync feature includes these records, the user's selected policy is to preserve immutable receipts and unique-event counters while retaining the latest committed schedule, without replaying grades.

### D11. Freeze typed source identities before AI generation or persistence

Separate `sourceKind`, canonical `documentId`, optional `extractId`/learningItemId, display/context key, content revision, locator, and privacy document IDs in a frozen source envelope. At submit resolve `extract:<id>` or another UI source reference by an explicit typed resolver; the referenced extract's stored parent document is authoritative. Never remove a prefix and guess that the suffix is a document UUID. No display namespace or model-generated source ID may become a foreign key.

Reuse the existing source/context builder, tool parser, Studio creation services, and learning-agent acceptance infrastructure. Provider adapters receive a validated content envelope; they do not each decide lineage. Immediately before saving, authoritative code validates document/collection existence, extract-parent relationship, selected-source permission, and matching source revision or explicit re-resolution. A deleted or changed source produces a recoverable source error, not an unlinked card or full-document fallback. Keep FK enforcement and transactional tree/count/outbox writes.

Both single and batch Chat creation delegate to the same validated card persistence service used by canonical commands. Validate all candidate schemas/types/required content before writes. Batch results identify each candidate's status, persisted ID, and safe error category, with accurate attempted/saved/failed counts. Successful cards survive partial failure; retry only failed candidate identities. Reuse acceptance/proposal identity for safe retries (extend it to Chat/Studio callers, with a per-call batch identity and per-candidate identity) instead of adding another idempotency store. A batch with any failures is visibly partial, not a success message saying all requested cards were created. Mark pending, saved, and failed artifacts distinctly; no persisted ID means no saved badge or Open action.

Learning Agent candidates retain existing preview/validation/user approval. Explicit Chat create intent retains its existing execution policy; a request only to preview does not save. Source capture, schema validation, canonical creation, and receipt semantics are shared despite different acceptance UX. No remotely hosted provider is required to generate using an available local model. Provider unavailability/timeouts leave drafts and make no silent cloud retry. Raw nested MCP JSON/SQLite details stay in diagnostics behind readable errors; do not hide the fact that cards were not saved.

### D12. Resolve selected bodies once for every generation path

Extend the existing canonical `resolveSectionFocusedContext` pipeline and bounded source loaders; do not add a competing agent section parser. `buildAgentSection` becomes asynchronous and accepts a resolved **set** of sections/passages, not the first node's cached `.content`. The same resolver feeds Chat, Learning Agent, Document Q&A, and Studio. Existing live content/provenance/turn epochs remain the authority for revoking stale work.

Priority of explicit scope: selected `#` sections, else an explicit pinned/current passage, else an already-bound section locator; if “this section” has none, open the existing section picker and issue no generation call. Do not infer the visible heading from unrelated text or make the model guess. A selected passage is a bounded passage and is labeled as such rather than rejected for lacking a heading.

Resolve Markdown/HTML headings and PDF/EPUB outline paths against freshly loaded canonical text and content hash; preserve timed transcript sections through their authoritative media loader. Duplicate titles use stable ID/path, not title alone. Parent selection includes its descendants up to the next peer boundary. Multiple selections use document order and deduplicate overlapping ranges; conflicting owning documents fail unless the explicit multi-paper path is selected. Empty, stale, ambiguous, wrong-document, or unavailable text produces an actionable error and zero provider calls. No fallback to offset zero, full document, or a title-only context. Selected-section mode has **zero outside-section neighbor text**, overriding the old Studio neighbor-context allowance for this explicit scope.

Freeze the resolved body/ranges/hash and provenance at submission. Apply provider-specific token budgets to this same envelope after reserving instructions, history and output; preserve each selected section's start and expose the retained/omitted coverage. For multiple sections allocate the available body budget evenly, redistributing unused shares in document order; each selected range must retain its label and nonempty body. If the minimum meaningful nonempty bodies plus required instructions cannot fit, stop with a smaller-scope suggestion and no request. Truncation never inserts unrelated sections; prohibit the old silent 12,000-character slice. No provider adapter may discard scope instructions/metadata or broaden content. Apple Intelligence may need a smaller budget, but that is a tested capacity constraint, not an assumed root cause.

Preserve explicit source privacy/local-only gates. Locally supported providers (e.g. Ollama/on-device) need no OpenRouter configuration. Native Apple and platform-specific on-device availability remains capability-gated. Equivalent scope, provenance, exclusion, and failure behavior is tested with adapter mocks; output wording need not be identical across models.

### D13. Anchor assistant scrolling to user intent and conversation identity

Replace unconditional messages-change scrolling with a small shared scroll-state controller keyed by conversation ID, pane identity, and content revision. Track a visible message anchor plus its pixel offset, an explicit follow-bottom flag, and hydration readiness. “Near bottom” means within 48 CSS px of the bottom; initial conversations start following bottom. User scrolling beyond that threshold disables following; scrolling back or selecting “Latest messages” reenables it. Programmatic restoration must not be mistaken for a user gesture.

Streaming appends stay at bottom only while following. Otherwise preserve the visible anchor/offset and show an unread/latest affordance. Before close/unmount/tab switch store the anchor in the existing conversation UI/session-state layer; restore after the same conversation's messages and layout are ready, including late image/card heights. Restore once per hydration generation; resize/content observation maintains the anchor without a timer loop. If an anchor was removed, use the next surviving message, then bottom for a never-restored conversation. Unrelated provider/control/section changes do not reset scroll. Smooth motion is reserved for explicit Latest navigation; restoration is immediate and respects reduced motion.

Reader position remains owned by the reader's existing locator/progress system. Assistant show/hide/resize preserves that anchor and cannot write a zero progress value before document hydration. Add reader integration cases for HTML/PDF/EPUB/queue context. The reporter's exact top-jump cause remains a reproduction item, but the invariant is resolved here.

## Scheduling comparison and calibration

The following reproduces the old formula with a fixed clock, no FSRS bonus (stability≥10, difficulty≤5), and equal nominal slider/live percentile. Real rank normalization can further change distribution; these isolate the mathematical policy.

| Document, P=.50 | O proposed | T proposed | M current | M proposed |
|---|---:|---:|---:|---:|
| Never rated, no due date | 0 | .500000 | .900000 | .500000 |
| Future due, 7 days away | 0 | 0 | .350000 | .100000 |
| Due exactly now | 0 | .500000 | .600000 | .500000 |
| 1 day overdue | .068937 | .534469 | .621429 | .527575 |
| 7 days overdue | .393469 | .696735 | .750000 | .657388 |
| 14 days overdue | .632121 | .816060 | .900000 | .752848 |
| 30 days overdue | .882681 | .941340 | .837500 | .853072 |
| 90 days overdue | .998385 | .999193 | .712500 | .899354 |
| 300 days overdue | ≈1 | ≈1 | .712500 | ≈.900000 |

Future +7 current B=4, multiplier=1.25, U=.5, O=0: current M=.35. Proposed future T=0 applies to rotational items, not a valid future recall risk.

| Fixed workload example | Current M | Proposed M | Interpretation |
|---|---:|---:|---|
| New important document, slider/rank 75% | .950000 | .550000 | Loses artificial maximum overdue credit |
| 30-day late document, 25% | .656250 | .803072 | No longer becomes less urgent after day 14 |
| 14-day late document, 25% | .726250 | .702848 | Smaller backlog boost than 30-day late peer |
| Due now document, 25% | .487500 | .450000 | Readiness shared, manual rank added once |
| Due now document, 75% | .650000 | .550000 | Difference now exactly .10 for ΔP=.50 |
| New top-ranked document, 100% | 1.000000 | .600000 | Beats 7-day late bottom-ranked document in mixed ranking |
| 7-day late bottom-ranked document, explicit 0% | .650000 | .557388 | Current value uses zero-as-unset helper; proposed respects explicit bottom |
| Future reviewed document +7 days, 100% | .600000 | .200000 | Importance does not create recall or lateness |
| Due card with r=.20, P=.50, O=0 | .500000 | .740000 | Recall risk .8 wins over .5 readiness; manual independent |

The explicit-zero current example has U=1 from the helper's neutral fallback and P=0 in the outer term; this inconsistency is intentional in the comparison, not an endorsed behavior. Card current M=.5*(1-.2)+.2*.5=.5. At identical document due date/P, changing stability/difficulty changes **no proposed rank**, while a later explicit grade can produce a different next due date through the scheduler. Comparisons describe M; other DAQE terms can reorder items, and SRS-only due buckets still precede new items.

Fixture matrix uses lateness `future 30/7/1, due, 1/7/14/30/90/300/100000 days`, manual ranks `0/25/50/75/100`, missing/invalid states, and document/extract/video/card types. Hold P's rank population fixed when testing independence. Test M's P slope .2, bounded finite outputs, temporal monotonicity, saturation, equal-state ordering, and permutation-invariant ties. For realistic finite 1k/10k pools report top-20 overlap, Kendall ordering changes, new/due exposure by priority quintile, and session exhaustion without replacement. Large reordering is expected and must be documented rather than hidden behind baseline updates.

Before implementation acceptance, the fixture judgments must demonstrate: (1) no after-day-14 decline; (2) top-priority new beats bottom-priority seven-day late in mixed ranking with equal other terms; (3) low-priority severely late can beat recently reviewed high-priority material; (4) each enabled new/review budget produces its required class; (5) all finite fixed-pool items drain when repeatedly consumed without replacement. If any fail, revisit the policy openly and update specs/fixtures, not constants until a test happens to pass. Later calibration can compare these offline pairwise judgments and opt-in aggregate queue behavior with the documented .8/.2, τ14 policy; there is no claim of empirical optimality.

## Risks / Trade-offs

- [Queue reordering and new items losing the old artificial overdue maximum] → Publish examples, capture before/after fixture ranks, preserve due dates and explicit session order, and retain existing quotas/triage controls.
- [Priority population drift after import/archive] → This is existing positional semantics; derive P/standing from the same snapshot and never invert or renumber keys as migration.
- [Legacy cloze offsets and HTML] → Lossless adapter, Unicode/HTML fixtures, repair states, no destructive bulk conversion. Never guess a hidden answer from `[...]` alone.
- [Atomic edit touches sync/versioning] → Extend repository transaction/journal patterns; assert unchanged scheduling and complete version restore under failure and offline operation.
- [Concurrent delete/rating/refresh/undo] → Per-entity serialized intents, committed barriers, operation receipts, revision-aware merges, and deferred-promise tests.
- [New event/seen fields across backup/sync/older clients] → Additive nullable fields and backward-compatible import defaults; preserve aggregate histories without fabricating old events.
- [Small models and scoped content] → Explicit bounded coverage or no-call failure; no automatic remote routing or wrong-source fallback.
- [Native prompt/image/keyboard differences] → Replace prompt flow, reuse asset adapters, and require real-runtime acceptance separately from Chromium/jsdom evidence.
- [Performance from per-item rank lookups/full card hydration] → One key snapshot per pass, batch only missing cards, reuse normalized cache/revision signals, and benchmark gates.

## Migration Plan

1. Capture fixtures and backups with priorities, source links, memory state, due dates, and review counts; map overlapping unarchived changes before edits.
   The existing main `priority-vector-improvements` spec is structurally invalid (delta header, no Purpose/Requirements wrapper). Task 1.2 normalizes that wrapper while preserving its old requirement before applying this change's delta. This is an implementation/archive prerequisite, deliberately left outside proposal-phase edits.
2. Ranking version advances in its diagnostics/cache key; invalidate cached rank results only. No mass FSRS recalculation, priority rewrite, due-date rewrite, or review-history conversion. Existing hand-picked sessions keep identities/order until rebuilt.
3. Add video-extract seen columns and a retry-safe review-event table/index through the repository's next migration. Existing seen fields default null. Preserve old counters as the historical aggregate; new events begin at rollout. Include schema/model/API/sync/backup/browser compatibility in the same implementation phase.
4. Extend optional edit payload fields and card-source envelopes; old callers keep valid content-only behavior. Extend version entries to include cloze source/ranges/tags, with old snapshots restoring only fields they actually stored.
5. Playlist defaults start affecting new subscriptions only; old values remain. Invalid saved values require correction and get safe queue diagnostics, not an automatic destructive repair. Legacy 1–10 subscription priority is retained and labeled.
6. Validate source lineage on every new card save; do not silently relink existing invalid cards. A separately initiated repair can use recoverable provenance, with explicit evidence and backup.
7. Rollback ranking/frontend changes independently while keeping the additive schema/events. Never restore an old whole database over newly committed reviews. Older clients must tolerate absent fields and preserve unknown sync fields through supported serialization. If an older client cannot safely round-trip new video state, gate that sync path with a clear compatibility outcome before enabling writes; do not silently discard fields. Deleting event tables is not a rollback step.

## Open Questions

No core policy is deferred. Two evidence follow-ups remain: obtain the reporter's build/reproduction to identify the exact keyboard save failure and determine whether reopen jumps involve conversation, reader, or both. Defaults in D8/D13 already define required behavior regardless of that outcome. Which historical FK rejected S05 is also a diagnostic follow-up; D11 validates every candidate relationship and includes a deterministic reproduction of the confirmed extract-namespace path.
