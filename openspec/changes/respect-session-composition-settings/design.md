## Context

Two controls decide what an Optimal Session contains, and they disagree by default.

**Control A — composition shares.** `settings.scrollQueue.composition`
(`{ documents: 60, extracts: 15, flashcards: 25 }`), rendered as three sliders in
`ScrollQueueSettings.tsx`. `composeSession` in `src/pages/queueScrollBudget.ts` turns them
into per-type counts, and its arithmetic is sound — the existing tests in
`queueScrollBudget.test.ts` show it holding a 55% flashcard share against a real
`{371, 6, 1037}` pool.

**Control B — item-type toggles.** `settings.smartQueue.sessionItemTypes`, three checkboxes
behind the Customize Queue modal. `ReviewQueueView` derives `effectiveItemTypes` and passes
it to `QueueScrollPage`, which applies it twice: `gateScrollItemsByType` drops the source
items, and `zeroUncheckedTargets` (`QueueScrollPage.tsx:321`) forces the corresponding
share to 0.

The failure chain for the reported bug:

1. `defaultSettings.smartQueue.sessionItemTypes` is
   `{ documents: true, extracts: false, learningItems: false }` (`settingsStore.ts:826`).
2. `effectiveItemTypes` (`ReviewQueueView.tsx:434`) only overrides that with all-true when
   the user has never customized **and** the filter is `due-all`. Every other filter mode
   yields documents-only.
3. `zeroUncheckedTargets` zeroes the flashcard and extract targets.
4. `composeSession` returns a documents-only allocation — correctly, from targets that no
   longer resemble what the user set.

So the sliders are not broken; they are overruled by an invisible control with a
contradictory default. Nothing in the UI reports the override.

A second, smaller effect is worth fixing in the same pass. `orderScrollItemsByCombinedCriterion`
(`src/utils/queueScrollOrder.ts:228`) adds `proportionWeight × tanh(imbalance)` to pull
toward equal topic (documents/extracts) and item (flashcards) placement. At the default
weight of 15 against engagement scores that span roughly 5–13, that bias dominates priority
as soon as the imbalance reaches 1 — the order alternates topic/item near-strictly, no
matter what the sliders say. A 60/40 session's counts are 60/40, but its first stretch reads
50/50 and its tail is pure documents. "Follow the setting" has to mean the perceived mix,
not only the totals.

## Goals / Non-Goals

**Goals:**

- One control decides Optimal Session membership: the composition shares. 0% excludes.
- A user setting 60 / 0 / 40 gets a 60:40 document:flashcard session, in counts and in the
  order they scroll through.
- Defaults that agree with each other for a new user.
- When a share cannot be filled, say so instead of silently reweighting.

**Non-Goals:**

- Redesigning the Customize Queue modal or merging it with Queue Settings. The toggles keep
  their job (filtering the Queue list) and their place.
- Changing the sequential / queue-list Scroll Mode path. That session is a replay of the
  visible list, so the list's filters legitimately govern it.
- Touching `composeSession`'s allocation arithmetic. It already does the right thing.
- Per-session or per-filter composition profiles.

## Decisions

### 1. The composition shares are authoritative for the optimal path; the toggles are authoritative for the list

**Chosen:** delete `zeroUncheckedTargets`. In the optimal branch of `buildScrollItems`,
derive the type gate from the composition itself — a type participates iff its share > 0 —
and pass `settings.scrollQueue.composition` to `composeSession` unmodified. The sequential
branch keeps `gateScrollItemsByType(…, activeTabQueueData.itemTypes)` exactly as it is.

**Why:** the two controls express the same intent at different resolutions; the slider is
strictly more expressive (0 is "off", and it also says how much). Keeping both as veto gates
guarantees they can contradict. Splitting them by entry point is the only division that
matches what each session *is*: the list session replays what the user sees, the optimal
session is composed from scratch.

**Alternatives considered:**

- *Fix only the default (`sessionItemTypes` → all true).* One line, and it does fix the
  reported case. Rejected as the whole fix: any user who ever unchecked Flashcards is back in
  the bug, with no way to discover the cause. It stays as part of decision 3, not instead of it.
- *Make the toggles a hard mask over the sliders and surface them together.* Keeps both
  controls but makes the override visible. Rejected: two controls for one decision is the
  defect, and this preserves it while adding UI.
- *Delete the toggles entirely, 0% is the only "off".* Cleanest end state. Rejected for now:
  they are load-bearing for the Queue list, which has no composition concept.

This supersedes the archived `queue-item-type-routing` requirement for the optimal entry
point; the delta spec narrows it and moves those scenarios to `session-composition`.

### 2. The proportion bias targets the configured ratio instead of parity

**Chosen:** `CombinedSortConfig` gains a target ratio (topic share in `[0, 1]`, derived from
the composed counts: `(documents + extracts) / total`). The imbalance term compares placed
counts against that target instead of against each other, measured in placed-item units so
the 0.5 default reproduces the historical parity terms exactly:

```
topicImbalance = max(0, placed − topicsPlaced / targetTopicShare)
itemImbalance = max(0, placed − itemsPlaced / (1 − targetTopicShare))
```

with the existing `tanh` shaping and weight. At `targetTopicShare = 0.5` both terms collapse
to `max(0, itemsPlaced − topicsPlaced)` / `max(0, topicsPlaced − itemsPlaced)` — today's
arithmetic exactly — so the Queue list's `QUEUE_LIST_SORT_CONFIG` call site is unaffected.
A single-type session gets a target of 1 or 0, where both imbalance terms short-circuit
and priority alone orders the session. (The alternative `targetTopicShare × placed −
topicsPlaced` was rejected: at 0.5 it is exactly half of today's terms, silently weakening
the bias everywhere, including the Queue list.)

**Why:** the bias already exists and already has the right shape; it is aimed at the wrong
target. Deriving the target from the composed counts rather than the raw sliders means
scarcity is handled for free — if flashcards fall short, the counts already reflect that and
the ordering follows.

**Alternatives considered:**

- *Leave ordering alone; counts are the contract.* Rejected: the user's report is about what
  they see, and a session whose head is 50/50 and whose tail is pure documents does not read
  as 60/40 at any point.
- *Deterministic round-robin interleave at the configured ratio.* Exact mix in every window,
  but it overrides priority — which is the ordering principle the rest of the queue is built
  on. The bias keeps priority primary.

### 3. Defaults are aligned, saved selections are not touched

`defaultSettings.smartQueue.sessionItemTypes` becomes all-true. `sessionItemTypesCustomized`
already distinguishes "never touched" from "deliberately set", so a saved selection survives
untouched — the migration surface is only users who never opened the modal, whose Queue list
gains extracts and flashcards. That matches what the `due-all` special-case in
`effectiveItemTypes` was already trying to express; with the default fixed, that special case
can go, and every filter mode starts from the same honest default.

### 4. Shortfalls are reported

`composeSession` returns the per-type shortfall (`requested − allocated`) alongside the
counts. `selectByQuotaInOrder` already returns a shortfall in the same shape, so the concept
and the field names exist. `ScrollQueueSettings` renders a one-line note naming the short
type and how many items it could supply.

**Why:** with the toggles no longer able to explain an absent type, the remaining reason a
type goes missing is scarcity — and that reason is currently invisible. This is the smallest
change that keeps the control honest.

### 5. Rating/removal does not rebuild the established session

The queue-build effect keeps `isRating` as a dependency so entering the rating/removal lock
cancels any in-flight asynchronous build. It records the previous lock state and skips both
effect runs while locked and the first run that releases the lock. That release is not a new
session input: `advanceAfterRemoval` has already removed the studied item in place and exposed
its queued successor.

This matters because recomposing on unlock restarts the proportion-aware greedy sort from an
empty prefix. In a 50/0/50 session, removing the leading document can expose the flashcard that
was next, then the unlock rebuild starts a fresh 50/50 order and puts another document at index
zero. The user sees the flashcard briefly and then a document, even though no second navigation
occurred. A later genuine source/settings dependency change while idle still rebuilds normally.

## Risks / Trade-offs

- **A user who unchecked Flashcards to hide them everywhere now sees them in Optimal
  Sessions.** → The behaviour change is called out as breaking in the proposal; the
  composition panel gains a "0% excludes this type" hint so the new control is discoverable
  at the moment it matters. The Queue list still respects their toggle.
- **New users see a busier Queue list** (extracts and flashcards, where before it was
  documents-only). → This is the intended correction: the previous default silently
  contradicted the shipped composition defaults. Customize Queue still narrows it in one click.
- **The ratio-targeted bias could weaken the variety guard at extreme settings** (e.g. 95/5:
  long document runs are now correct rather than broken up). → `MAX_SAME_TYPE_CONSECUTIVE`
  still applies in `orderScrollItemsByPriority`; for the combined-criterion sort, the extreme
  setting is the user's explicit request and long runs are the faithful reading of it.
- **`composeSession`'s signature changes** (counts → counts + shortfall). → Three call sites,
  all in `QueueScrollPage`, plus the benchmark in `queueScrollBudget.bench.ts` which reads
  `{ documents, extracts, flashcards }` by destructuring and keeps working.
- **The two Scroll Mode entry points now behave differently.** → This is deliberate and
  spec'd, but it is a real cognitive cost. Mitigated by the entry points already being named
  differently ("Scroll Mode" vs "Start Optimal Session") and by the list session visibly
  replaying the list.

## Migration Plan

No data migration. `sessionItemTypes` is a settings default change guarded by the existing
`sessionItemTypesCustomized` flag; persisted user selections deserialize unchanged. Rollback
is a revert — no schema or stored-shape change to undo.

## Open Questions

- Should the composition panel show a live preview of the composed counts ("~180 documents,
  ~120 flashcards") rather than only a shortfall note? Deferred: the shortfall note is what
  the bug requires, a preview is a separate improvement.
- Should the Customize Queue toggles eventually be replaced by the shares in the Queue list
  too, collapsing the two controls entirely? Deferred until this change has proven the
  slider-as-single-control model in the session path.
