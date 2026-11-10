# LearnHarness — End-to-End Architecture (verified against source)

- **Repository:** https://github.com/amosblomqvist/learnharness
- **Commit SHA:** `da08cb5f7d098598ba963c6689b22054c9f2a5a3`
- **Branch:** `main`
- **Local checkout:** `/tmp/plethora-learnharness-research` (external temp dir, NOT inside Plethora)
- **License:** AGPL-3.0-only. Studied as a design reference; no source copied.
- **Stack:** Next.js 16 (App Router) + Electron 44 desktop host + `@earendil-works/pi-agent-core` 1.4.0 (the "Pi" agent runtime) + TypeBox schemas + `zod`. **Not Tauri, not Rust, not SQLite.**

> **Confidence legend used in this file**
> **VERIFIED** = read from source at the cited anchor.
> **SPEC-ONLY** = asserted in docs/prompts, not confirmed in production code.
> **NOT FOUND** = targeted searches (scope given) did not locate it.
> **INFERENCE** = reasonable conclusion needing confirmation.

---

## 0. Executive summary

LearnHarness is **not** an examination platform. It is an **agent harness for one-to-one Socratic tutoring**.

The four-loop flow (README "How it works"):

1. **Measure** — the *Prober* agent quizzes the learner to bracket where their understanding ends.
2. **Plan** — the *Teacher* agent writes a Mermaid dependency DAG for the session.
3. **Teach** — the Teacher walks the DAG, predicting/explaining/checking per node.
4. **Practice** — a separate *Practitioner* agent poses problems with committed solutions.

Plus a **persistent knowledge graph** of propositions and reasoning chains extracted post-hoc from teacher prose.

**The single most important architectural fact for Plethora:** LearnHarness's "plan" is a **session-scoped, structure-only teaching map**, not a persistent editable curriculum. Its progress is **derived from the transcript at render time**, never stored. `src/core/contracts/plan.ts:36-40` states this explicitly (2026-09-11 pivot): progress fields `currentNodeId`/`doneNodeIds` were *"GONE by design"*.

**Verified absences** (search scope: `src/`, `components/`, `app/`, `docs/`, `tests/`, all `.ts/.tsx/.md`):

| Capability | LearnHarness status | Evidence |
|---|---|---|
| Exam blueprint / configurable exam length | **ABSENT** | `blueprint` → 0 files repo-wide |
| Essay rubrics | **ABSENT** | `rubric` → 0 files repo-wide |
| Cloze questions | **ABSENT** | `cloze` → 0 files repo-wide |
| Long-form essay questions | **ABSENT** | `essay` → 0 files repo-wide |
| Flashcards / SRS scheduling | **ABSENT** | `flashcard` → 0 files; `fsrs` → 0 files repo-wide |
| Persistent multi-document curriculum | **ABSENT** | `curriculum` → 0 files repo-wide |
| Numeric exam scoring / grade report | **ABSENT** | no aggregate score type anywhere; grading is per-question boolean |
| Mastery estimation | **ABSENT** | `mastery` appears only in 4 comments naming a "mastery-trace contract" that is really *id normalization* (`src/core/chains.ts:62-88`) |
| Spaced repetition | **NOT IMPLEMENTED** | only in `docs/archive/vision.md:210,259` and `docs/archive/plan.md:55` as roadmap text |
| Historical examination reporting | **ABSENT** | no exam entity exists; per-session graph coverage stats only |
| Source-linked remediation | **PARTIAL** | graph propositions carry `(chatId, messageId)` provenance, but there is no remediation route |

---

## 1. Agent orchestration

### 1.1 The three agents

`src/agent/teacher-agent.ts` composes **three** agent kinds over one shared native transcript:

| Agent | Factory | Tools | Prompt dir |
|---|---|---|---|
| **Prober** | `createProberAgent` (`teacher-agent.ts:283`) | `probe`/`recall`, `ask_user_question`, `probe_done` + read-only FS, research/PDF, gated graph readers | `src/agent/prompts/prober/` |
| **Teacher** | `createTeacherAgent` (`teacher-agent.ts:293`) | `quiz`/`explain`, `ask_user_question`, `plan_init` + read-only FS, research/PDF/demo/visual, `show_image` | `src/agent/prompts/teacher/` |
| **Practitioner** | `createPracticeAgent` (`teacher-agent.ts:344`) | `problem`, `conclude` only + read-only FS, research/PDF, gated graph readers | `src/agent/prompts/practice/` |

`AgentKind = "prober" | "teacher" | "practice"` (`teacher-agent.ts:54`).

All three are built by `baseAgentOptions` (`teacher-agent.ts:179`), which is where the shared mechanics live:
- system prompt composition (`composeInstructions`, `teacher-agent.ts:77`),
- the **question-stop rule** (`makeQuestionStopper`, `teacher-agent.ts:157`),
- the `convertToLlm` projection (`toLlmMessages`),
- usage collection via `agent.subscribe` on `message_end` (`teacher-agent.ts:262-271`).

### 1.2 Per-turn statelessness (the central pattern)

**VERIFIED.** The persisted `ChatRecord` is the source of truth; a fresh Pi `Agent` is constructed from saved history on **every** POST and discarded at turn end. Documented in the module header (`teacher-agent.ts:29-35`): *"the persisted record is the source of truth, the agent is rebuilt from it every POST and discarded at turn end."*

`docs/architecture.md:23` — *"An application **turn** constructs a fresh native Pi `Agent` from saved history; it can make several model calls and execute tools. It is not an HTTP connection or a single generation."*

Consequence for Plethora: **there is no long-lived agent session state**. Any "plan" or "question in flight" must be reconstructible from the durable record.

### 1.3 Prompt composition

`composeInstructions(kind, switches)` (`teacher-agent.ts:77-84`) delegates to `effectivePromptSegments` in `src/store/prompt-overrides.ts`, which discovers numeric-prefixed `.md` fragments in the agent's directory plus `prompts/shared/`, joined with `\n\n---\n\n`. Each segment can be **overridden** by a user file when the corresponding settings switch is on. Overrides are static-file reads, not request state.

The base is `src/agent/system-prompt.md`; shared fragments are `prompts/shared/{10-voice,15-accuracy,16-mental-model,20-question-tools,25-confidence,30-learner-files,40-formatting}.md`.

> **Reuse for Plethora:** the "segmented prompt with per-segment override" pattern maps onto Plethora's existing task/prompt infrastructure. **Do not** copy the doctrine text (AGPL).

### 1.4 Probing — how the Prober determines what the learner understands

**Flow (VERIFIED):**

1. Session starts → `kind` absent ⇒ teaching (`docs/architecture.md:23`). The handler builds a **Prober** agent.
2. The Prober calls `probe` (a MC quiz with **no** `nodeId`, `question-core.ts:277` `probeQuizInputSchema = quizInputBase`) or `recall` (free-recall, `explainInputBase`).
3. The client answers; the answer is graded deterministically for `probe` and returned to the model.
4. The Prober keeps bracketing until it calls `probe_done`.

**Prober tool set** — `createProberTools(ctx, toolToggles)` in `src/agent/tools.ts`; the `probe`/`recall` tools are the probe-phase counterparts of `quiz`/`explain` (same grading rules, different names so the transcript shows the phase boundary — `question-core.ts:437-448`).

**How responses enter the agent's context:** the client's answer is persisted as the **tool result** for that call (`addToolOutput` per `question-core.ts:8-15`). The model-visible payload is deliberately minimal — `compactAnswerForModel` (`question-core.ts:779-802`) returns **only** what the learner added plus the verdict:

```
{kind, dontKnow?, answers[{index,label}], text?, other?, correct?, confidence?, thinking?, thinkingWhileReading?}
```

The question, options, correct answer, explanation and free-recall commitment are **not** echoed — the model already authored them in the persisted call arguments.

Two distinct **thinking channels** are captured:
- `thinking` — reasoning on the question.
- `readingThinking` / `thinkingWhileReading` — thinking while reading the teaching prose.

**Confidence** is a learner-stated probability 0-100, snapped to `CONFIDENCE_STOPS = [0,30,50,70,90,100]`, default index 2 (=50, a genuine coin flip). Never sent on "I don't know" (`question-core.ts:494-501`, `740-743`).

### 1.5 How the probing phase ends — `probe_done`

`src/agent/tools/probe.ts` — `probeDoneTool` (line 49).

**Input schema** (`src/core/contracts/probe.ts:47-72`, TypeBox):
```
probe_done({
  assessment: {
    strands: [{ strand: string, assessment: string }],  // minItems 1
    summary?: string
  }
})
```
`ProbeStrand` = one dependency strand the lesson will rest on; `assessment` = free-form read of where the learner's edge sits (floor, ceiling, misconceptions, what to build from). **VERIFIED** — the schema is the single source of truth shared by the tool boundary and the UI parse seam (`contracts/probe.ts:40-46`).

**Server-side guards (`probe.ts:65-79`):**
- `hasUnresolvedQuestion(record.messages)` ⇒ refuse: *"A question is still open — resolve it (or let him answer) before concluding the probe."*
- `hasProbeDone(record.messages)` ⇒ refuse: *"The probe is already concluded — probe_done fires exactly once."*

**On success (`probe.ts:80-95`):**
- `ctx.deliver(buildProbeHandoffSteer(ctx.chatId))` queues the **handoff steer** through the wake pipeline (`src/server/jobs.ts`).
- Returns `{ text: PROBE_DONE_ACK_TEXT, details: { ok: true } }` — the assessment lives ONCE, in the call's arguments (durable, streamed live). The agent sees a fixed ack, never an echo. **Context-diet doctrine.**

**Handoff to the Teacher (VERIFIED):** *"A matching successful `probe_done` result selects the teacher and queues a fresh-agent handoff. A bare/refused call does not."* (`docs/architecture.md:72`). The transcript seam is the **first non-failed `probe_done` call + matching successful result**; from that result on, every request constructs the **Teacher** agent. The handoff steer is an *optimization, not a gate* — if queueing fails, the next client message still constructs the teacher off the seam (`probe.ts:83-87`).

**Phase detection:** `src/core/phases.ts` — `phaseAt3`/`phaseAt3Lh` return `"probe" | "plan" | "teach"`.

### 1.6 Teaching — how the Teacher proceeds

The Teacher owns `plan_init` and the two quizzing tools. The flow:

1. `plan_init` writes the map (see §2).
2. For each node the teacher poses questions tagged with `nodeId`.
3. `quiz`/`explain` calls terminate the turn (`questionResult()` returns `terminate: true`, `src/agent/tool-execute.ts:222-233`).
4. The learner's answer arrives as the tool result; the Teacher grades free-recall and explains.

**Teach-cycle question roles** (`question-core.ts:209-248`):
- `type: "predict"` — posed **before** teaching the step; **never** collapses behind the reveal.
- `type: "check"` — posed **after** teaching; collapses behind the "Check your understanding" reveal.
- `questionNeedsReveal(tool, rawInput, phase)` (`question-core.ts:232-235`) is the pure predicate; only `quiz`/`explain` in the `teach` phase can need a reveal.

**Ordering doctrine** (`question-core.ts:154-157`, `250-255`): the required pair (`type`, `nodeId`) **leads** the property order because *"fields generated first get dropped least"* (glm-5.3 dropped trailing fields on long calls). Same for the `explanation` → `correctAnswer` ordering in the base: **reason before you commit the answer**.

### 1.7 How practice sessions start

`ChatRecord.kind === "practice"` selects the Practitioner (`docs/architecture.md:23`, `teacher-agent.ts:334-347`). **No prober→teacher split, no plan tools, no question tools.** Its entire registry is `problem` + `conclude` (`src/agent/tools/practice.ts:223-248`).

### 1.8 How the Practice agent differs from the Teacher

| Aspect | Teacher | Practitioner |
|---|---|---|
| Entry | after `probe_done` | from turn 1 of a `kind:"practice"` session |
| Question tools | `quiz`, `explain` | none |
| Plan tools | `plan_init` | none |
| Problem tools | none | `problem`, `conclude` |
| Extra tools | demo, visual, `show_image` | research, pdf, gated graph readers |
| Free-recall grading | model judges vs committed answer | model judges vs committed `modelSolution` |
| Output style | ordinary prose | ordinary prose (not the explicit output tool) |
| Graph extraction | automatic | **skipped** — *"ordinary practice settlement skips extraction"* (`docs/architecture.md:74`) |

### 1.9 How agent tools are restricted and validated

**Restriction layers:**
- `EnabledTools` (a `Partial<Record<string, boolean>>`) threaded per turn (`teacher-agent.ts:119`); `filterEnabledTools` (`src/core/pending.ts:106-114`) drops any tool explicitly `false`.
- `TOGGLEABLE_TOOLS = ["research","demo","visual","pdf"]` (`pending.ts:87`) — **the definitive toggleable list**. Deliberately **not** toggleable: `quiz`+`ask_user_question` (a prober that can never conclude is a lockout), the learner-filesystem set, plan tools, `probe_done`.
- `WRITABLE_TOOL_KEYS = [...TOGGLEABLE_TOOLS, "explain"]` (`pending.ts:94`) — the `explain` switch arms free-recall quizzing and drops the MC quiz.
- The write side validates against the list; unknown key ⇒ HTTP 400 (`pending.ts:81-86`).
- Graph tools are double-gated: `graph.enabled` **and** `graph-tool` switch. *"the teacher has no graph-reader registry"* (`docs/architecture.md:127`).
- `send_to_user` is only available to Claude-family models (`sendToUserApplies`, `teacher-agent.ts:211`).

**Validation:**
- TypeBox structural validation happens at the tool-call boundary.
- **Argument healing precedes semantic validation**: `healToolRecord` / `withArgumentHeal` (`src/agent/tools/heal.ts`) repairs common model wobble (JSON-encoded strings, copy-syntax debris) before validation. Invalid calls return `invalidInputResult` (`tool-execute.ts:117`) — an error result the model can correct, and the run continues.
- Semantic refinements (`quizInputProblems`, `explainInputProblems`, `askOptionProblems`) run inside `execute`.

**Critical rule (`teacher-agent.ts:157-177`, `makeQuestionStopper`):** a question tool call that **resolved** ends the run; a call that **failed** authoring validation does **not** — the model retries within the same turn. Stop only when *every* question/problem pose in the batch resolved cleanly.

### 1.10 How reasoning models and providers are selected

`src/agent/models.ts` composes Pi providers and app bridges. `docs/architecture.md:154`:
- Strong / Cheap / Vision **slots** have **no factory model pins** — the model catalog resolves them.
- Sessions retain **explicit** choices (`ChatSettings.model = {provider, id}`, `contracts/chat.ts:75-83`); **background roles resolve independently**.
- *"Missing configuration/readiness refuses rather than silently choosing another provider."*
- Background sub-agents are **never** overridden by the user's chat model choice (`contracts/chat.ts:68-74`).
- Provider routes: provider API keys, subscription connections (desktop Electron main holds refresh credentials), Claude Code CLI bridge, and custom OpenAI-compatible endpoints (including a local model server). `docs/custom-providers.md`, `docs/claude-code.md`.
- API environment values override saved keys. Subscription routes do **not** fall back to API billing.

`resolveEngine(role: ModelRole)` at `src/server/chat-handler.ts:153`.

### 1.11 How failed tool calls are handled

- Authoring failure ⇒ `invalidInputResult` ⇒ error result back to the model ⇒ model retries **in the same turn** ⇒ turn does **not** stop.
- Question tools validate & execute **server-side** and return a **synthetic terminating placeholder** (`questionResult()`), *"It stops a clean question pose, including mixed tool batches, but is not saved. The actual learner answer becomes the call's result later."* (`docs/architecture.md:70`)
- Failed tool calls are **repaired** in the provider context projection: `toLlmMessages` *"repairs eligible interrupted tool pairs at the provider boundary"* (`docs/architecture.md:43`). An abort's dangling question call gets an `INTERRUPTED` result (`teacher-agent.ts:236-240`).
- `malformed-question-recovery.test.ts` and `tool-heal.test.ts` cover these paths.

### 1.12 How sessions are resumed

- **Server:** `ChatRecord` on disk; the agent is rebuilt from `toLlmMessages(record.messages)` each turn. `ChatRecord.version` is a schema stamp (`contracts/chat.ts:57-63`); records stamped newer than the build are **refused on read**.
- **Client:** `components/session-core.ts` owns reattachment, bounded 409 recovery, and adoption of canonical state. *"One recovery attachment is allowed after premature EOF/read failure; repeated transport failure shows an error."* (`docs/architecture.md:54`)
- **Question drafts survive optimistic unmount in memory** (`QuestionFormDraft`, `question-core.ts:516-522`). *"Uncertain submissions reconcile the saved record and running state before resending, scoped to the same question occurrence."* (`docs/architecture.md:56`)
- **Provider-response retry is explicit** — preserves failed attempts on disk while omitting the eligible failed tail from temporary model context.
- **Mid-question resume is free**: *"Because the pending question IS a persisted message part, a session can be exited and resumed mid-question for free."* (`question-core.ts:16-17`)

---

## 2. Learning plan implementation

### 2.1 What `plan_init` accepts

`src/agent/tools/plan.ts:52-60` — TypeBox:
```
plan_init({ mermaid: string /* minLength 1 */ })
```
One tool. The whole dependency map is a Mermaid `graph TD` block.

**Author-once protocol** (`plan.ts:26-51`):
- Call **once** right after the probe concludes to present the map.
- Re-call any time the map is wrong — **the new block replaces the tree wholesale**.
- *"Node slugs are permanent — the map tracks nothing between rewrites."*
- Statuses (current / visited / upcoming) are **derived** from the quiz `nodeId` tags; the teacher never declares them.
- The former mutation tools (`add/update/remove node/edge`, `set_current`, `mark_done`) were **deleted by design** (`src/core/plan-tree.ts:128-132`).

Tool description guidance: **"5–15 nodes: a map, not a syllabus — one reasoning step per node, compress."** (`plan.ts:71`). This is direct evidence that LearnHarness plans are **short-lived teaching-session maps**, not curricula.

### 2.2 How the Mermaid graph is parsed

`src/agent/tools/mermaid-plan.ts` — `parseMermaidPlan` (line 77). A **hand-parsed subset**, not the Mermaid runtime.

Supported:
- `graph|flowchart TD|TB|LR|RL|BT` (direction cosmetic; case-insensitive) — `HEADER_RE` line 44.
- `%%` comment lines.
- Node forms: `id`, `id[title]`, `id("title")` — `ENDPOINT_RE` line 55. A surrounding quote pair is stripped from the title.
- Edges: `-->`, `==>`, `-.->` — `ARROW_RE` line 47. Chains `a --> b --> c` expand to consecutive pairs.
- Forward references are fine; duplicate edges dedupe; **the first label a node gets wins**.

**THE ONE STRICT RULE** (`mermaid-plan.ts:13-15, 96-102`): node ids must match `SLUG_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/` — lowercase, joined by hyphens or underscores.

The endpoint regex is **deliberately broad** (`mermaid-plan.ts:52-55`) so every bad id reaches `register()`'s specific slug message rather than dying at the regex layer — a post-mortem fix ("the muscle-protein session").

**All problems are collected**, each prefixed with its 1-based line number (`PlanParseResult.problems`, line 40-42). The teacher fixes and retries (`plan.ts:80-85`).

### 2.3 How nodes are validated

`src/core/plan-tree.ts`:
- `assertValidNode` (line 36): non-empty `id`, non-empty `title`.
- `nodeMap` (line 45): **duplicate node id** ⇒ `PlanTreeError` *"Duplicate node id "X" — node ids must be unique."*
- `requireNode` (line 57): edge endpoint must exist.

### 2.4 How cycles are rejected

`createsCycle(edges, from, to)` (`plan-tree.ts:71-88`) — forward DFS from `to`; if `from` is reachable, the edge closes a loop. `assertValidEdge` (line 91) rejects:
- self-loop (line 95-97),
- duplicate edge (line 98-100),
- cycle (line 101-106), with a message that states the direction semantics: *"'from' must be understood before 'to' — the tree is a DAG."*

`createTree(nodes, edges)` (line 112) validates edges **against already-accepted edges**, so the error names the culprit edge.

### 2.5 How prerequisite edges are represented

`src/core/contracts/plan.ts:22-27`:
```ts
export interface PlanEdge {
  from: string;  // prerequisite node id
  to: string;    // node that depends on `from`
}
```
`from` = prerequisite, `to` = dependent. Mermaid `-->` maps directly (`a --> b` ⇒ from `a`, to `b`).

### 2.6 How stable node identities work

`PlanNode.id` is an **opaque, agent-chosen slug**, *"stable across edits: 'chain-rule-intuition'"* (`contracts/plan.ts:13-15`). There is no UUID, no database key — the slug **is** the identity, and the model must copy it exactly into every `quiz`/`explain` `nodeId`.

`plan_init` returns the validated `nodeIds` plus a binding reminder (`PLAN_NODE_IDS_REMINDER`, `plan.ts:14-15`): *"These are the plan's node ids — the only valid nodeId values for every quiz and explain call from here on."*

**Risk for Plethora:** identity is model-authored and model-copied — exactly the class of thing Plethora must not trust blindly.

### 2.7 How plans are replaced or revised

**Wholesale replacement only.** `plan_init` → parse → `createTree` → `chatStore.saveTree(chatId, next)`. The tree is replaced; `version` resets to 1 (via `createTree`, `plan-tree.ts:125`). `docs/architecture.md:72`: *"The plan is a validated Mermaid DAG, replaceable through `plan_init`."*

There is **no** merge, patch, or incremental edit. Rewriting the map is the only restructuring mechanism.

### 2.8 How plan progress is represented

**Not stored — derived at render time.** `contracts/plan.ts:36-40`:
> *"the tree once carried `currentNodeId` / `doneNodeIds` — progress fields. They are GONE by design: the tree carries structure ONLY; position and visited-ness derive from the transcript at render time (derivePlanStatuses below). There is no done ledger of any kind. No backwards compatibility for old records."*

`derivePlanStatuses(tree, messages)` (`contracts/plan.ts:82-102`) and the native fold `derivePlanStatusesLh` (line 132-149):
- Scans **calls only** (`tool-quiz`/`tool-explain` parts, or native `toolCall` blocks named `quiz`/`explain`).
- `nodeId` not in the current tree ⇒ ignored (a rewrite may have dropped it).
- Consecutive duplicates collapse (several checks on one node = one stay).
- `current` = the node of the most recent tagged call; `visited` = every node in an **earlier** stay (`runs.slice(0, -1)`).
- **Results feed nothing** — a failed check then a move-on still marks visited.
- No fallback current before the first tagged check.

`derivedNodeStatus(statuses, nodeId)` → `"current" | "visited" | "upcoming"` (line 76-80).

`PlanTree.version` "increments on every mutation — lets the UI animate/react to changes" (`contracts/plan.ts:33`), but since the tree is replaced wholesale and carries no mutable progress, this is effectively a re-render signal, **not a curriculum version history**.

### 2.9 How questions reference plan nodes

- Teach-side `quiz` requires `nodeId` (`question-core.ts:258-266`): *"REQUIRED plan-tree node id this question is about — must EXACTLY match one of this session's `plan_init` node slugs (validated at call time; a mismatched id is rejected back to you)."*
- Teach-side `explain` carries the same `nodeId` (`question-core.ts:326-338`).
- **Probe-side** `quiz`/`recall` have **no** `nodeId` and **no** `type` — the map does not exist yet (`question-core.ts:270-277`).
- Validation is per-session, against the **live chat record**, and lives in `src/agent/tools.ts` (the tool's `execute`) — *"the per-session plan-nodeId validation in tools.ts (it reads the live chat record, which this core never touches)"* (`question-core.ts:206-208`).

### 2.10 How the UI renders the plan

- `components/plan-block.tsx` — the inline plan block in the transcript.
- `components/plan-window.tsx` — the popup plan window; `planExists(messages)` (line 39) and `PlanMarginalia` (line 44).
- The panel derives its display from **the LATEST plan tool output in the transcript** plus the derived statuses — *"with no separate state channel"* (`contracts/plan.ts:110-112`).
- `components/mermaid-render.ts` + `mermaid-error.tsx` — client-side Mermaid rendering (the server never renders; `mermaid-plan.ts:8-10`).
- Tests: `tests/plan-tree.test.ts`, `tests/plan-blocks.test.ts`, `tests/plan-window.test.tsx`, `tests/render-plan-block.test.tsx`.

### 2.11 VERDICT — session map, not curriculum

**VERIFIED.** LearnHarness plans are **short-lived teaching-session maps**:
- Scoped to one `ChatRecord` (`ChatRecord.tree`, `contracts/chat.ts:40-41`).
- Structure only; no content, no objectives, no materials, no duration, no mastery.
- Replaced wholesale; no incremental editing API.
- Progress derived from the transcript; no persisted status ledger.
- Tool guidance explicitly says *"a map, not a syllabus"* and caps at 5-15 nodes.
- No UI for user editing of the plan — the learner *sees* the map; the teacher authors it.

**What Plethora must build from scratch:** persistent, user-editable, versioned curricula with node-level content and status.

---

## 3. Question authoring and grading

### 3.1 Which question types exist

| Kind | Tool(s) | Mode | Graded by |
|---|---|---|---|
| `quiz` | `quiz` (teach), `probe` (probe) | single-select or multi-select MCQ | **client, deterministic** |
| `explain` | `explain` (teach), `recall` (probe) | free-text free-recall | **model**, against a committed answer |
| `ask` | `ask_user_question` | options or free text | **not graded** (preference collection) |

`QuestionKind = "quiz" | "ask" | "explain"` (`question-core.ts:407`).
`QuestionMode = "single-select" | "multi-select" | "text"` (line 409).

### 3.2 What schemas are used

**TypeBox** (`typebox` 1.3.27) — not zod (zod is a dependency but the tool contracts use TypeBox).

Shared MCQ base `quizInputBase` (`question-core.ts:158-193`):
```
question: string
options: Array<{ label: string, value?: string }>   // minItems 2
multiSelect?: boolean
explanation: string      // REQUIRED — revealed AFTER answering
correctAnswer: string | string[]   // REQUIRED — the option VALUE(S)
details?: string
```

Teach-side `quizInputObject` (line 256-268) = `{ type: "predict"|"check", nodeId: string, ...quizInputBase }`.
Probe-side `probeQuizInputSchema` = `quizInputBase` (no `type`, no `nodeId`).

Free-recall `explainInputBase` (line 303-318):
```
question: string
correctAnswer: string   // REQUIRED — the FULL answer, reasoning included, COMMITTED before posing
details?: string
```
Teach-side `explainInputObject` (line 326-338) adds `type` + `nodeId`.

`askInputSchema` (line 367-389) — `question`, `details?`, `options?` (minItems 2, keeps `description` — ask is ungraded so there is no correctness to leak), `multiSelect?`.

**Owner ruling on option descriptions** (`question-core.ts:34-38`): the `quiz` option has **NO** `description` field — *"the model reliably used it to leak correctness ('that's not the gradient', 'close but…'), making quizzes answerable by elimination."* The `ask` option keeps `description` — ask is ungraded.

### 3.3 How answer options are validated

`optionProblems(options)` (`question-core.ts:85-103`):
- empty label ⇒ problem.
- resolved key = trimmed `value` falling back to trimmed label; **duplicate resolved key ⇒ problem**.

`quizInputProblems(input)` (line 112-142) — the **full quiz authoring contract**:
1. Option sanity (above).
2. `coerceCorrectAnswer(correctAnswer, keys)` → `unique`; empty or any empty string ⇒ *"correctAnswer is required…"*.
3. Every unique correct value must be a known option key ⇒ *"does not match any option value. Valid values: … Copy the exact value (or label) of the intended option — never a paraphrase or slug."*
4. `unique.length > 1 && multiSelect !== true` ⇒ *"correctAnswer lists N values but multiSelect is not true — a single-select question with several correct answers can never be answered correctly."*

`explainInputProblems` (line 352-357): non-empty `correctAnswer` required — *"commit to the full correct answer BEFORE posing the question."*
`askOptionProblems` (line 106-108): option sanity only.

**Key invariant (`question-core.ts:74-79`):** *"The rules mirror the grading path exactly (normalizeOptions / coerceCorrectAnswer / resolveCorrect), so schema-valid ⇔ gradeable."* An invalid question **never reaches the learner** — the error returns to the teacher as a tool result and the teacher retries.

### 3.4 How correct answers are committed — the precommitted reference-answer principle

**This is LearnHarness's single most transferable design for Plethora.**

**MCQ (`quiz`):**
- The model authors `explanation` **then** `correctAnswer` — *"It is written BEFORE correctAnswer by design: reason it out first, then commit the answer the reasoning supports."* (`question-core.ts:176-181`)
- `correctAnswer` is keyed by **option value, never position** — *"Always pass the value, not a position number — this is self-checking and prevents miscounting."* (line 185-188)
- The tool call **persists** with its arguments. The question part lands in the UI in `input-available` state; **there is no server `execute`** for the teach quiz in the base path — the browser grades and returns the verdict as the tool result (`question-core.ts:8-15`).

**Free recall (`explain`) — the explicit commitment:**
`question-core.ts:291-301`:
> *"The SYCOPHANCY MITIGATION is structural — the model commits to the full correct answer BEFORE posing (the commitment rides the persisted call args, is revealed to the learner on submit, and is restated in the answer result the model grades against; the client never grades free text). ONE committed answer, reasoning included."*

Tool description (`question-core.ts:310-314`):
> *"COMMITTED before the learner ever sees the question. **The commitment is immutable: when his answer returns, grade it strictly against this text — never revise the commitment after seeing his words, and never mark a wrong answer right to be kind.**"*

**Practice (`problem`) — the same law:**
`src/agent/tools/practice.ts:90-92`:
> *"REQUIRED — the full solution, moves in order, committed BEFORE the learner sees the problem. **This IS the reveal — conclude shows it verbatim; never re-author it.**"*

**How the model is prevented from changing its answer:**
1. The commitment lives in the **persisted tool-call arguments**, which the model wrote before the learner spoke.
2. The model-visible answer result is **only** what the learner added (`compactAnswerForModel`, `question-core.ts:779-802`). It does **not** re-supply the correct answer — so there is no fresh "let me reconsider the answer" context.
3. The model-visible payload **does** contain the verdict (`correct`) and the learner's `confidence` — the learner's performance is the new information the model needs.
4. The committed answer is **snapshotted onto the answer record** (`QuestionAnswerData.committed`, `question-core.ts:468`; set at `question-core.ts:745-749`) — so the UI and any later audit see the commitment that was actually in force.
5. For MCQ, grading is **deterministic in the client** — the model never re-grades; it cannot influence correctness.

**What is NOT enforced:** there is no cryptographic or server-side immutability check. The commitment is enforced by (a) persistence order, (b) prompt doctrine, and (c) not echoing the commitment back. A model could still mis-grade free recall against its own commitment. **This is a prompt-level, not a mechanical, guarantee** — an important caveat for Plethora.

### 3.5 Which grades are deterministic

**VERIFIED — deterministic (pure functions, `src/core/question-core.ts`):**

| Function | Line | Behavior |
|---|---|---|
| `normalizeOptions` | 558-581 | trims labels/values, drops empty labels, **throws** on duplicate value |
| `shuffleOptions` | 610-618 | Fisher-Yates, injectable RNG |
| `seededRandom(seed)` | 588-602 | mulberry32 string-seeded — deterministic per `toolCallId` for hydration-safe rendering |
| `coerceCorrectAnswer` | 631-652 | value-preserving cleanup; JSON-array-string coercion; never rewrites a canonical key |
| `resolveCorrect` | 657-676 | value→1-based index; **unknown value ⇒ hard error**, not a silent wrong grade |
| `isCorrect` | 679-684 | **exact-set match** — same count, same indices |
| `buildAnswer` | 708-751 | builds the answer record; grades MCQ; snapshots the commitment |
| `dismissedAnswer` | 768-777 | the ESC-abort record |
| `compactAnswerForModel` | 779-802 | the model-visible projection |
| `optionProblems` / `quizInputProblems` / `explainInputProblems` | 85 / 112 / 352 | authoring validation |

**Not deterministic:** `explain`/`recall` and `practice` grading — both are **model-judged** against the commitment. There is no partial credit, no rubric, no numeric score.

`isCorrect` is a boolean. There is **no** aggregate exam score, no percentage, no grade bands anywhere in LearnHarness.

### 3.6 How free-response grading works

- `explain`/`recall`: the client **never** grades free text (`question-core.ts:745-749`: *"No client grading — the model grades in its reply, against the commitment. The commitment snapshots for the reveal + rendering."*).
- The model grades in its **next turn**, sees `compactAnswerForModel` (the learner's text + thinking + confidence), and produces prose feedback.
- There is **no persisted per-question free-text grade field** beyond the committed answer + the raw learner text. The model's verdict is **prose in the transcript**, not structured data.

> **Plethora implication:** the only structured assessment artifact LearnHarness persists for free response is the *question* (with commitment) and the *learner's answer* — the verdict is unstructured prose. A rubric-based exam grader would need an entirely new structured verdict contract.

### 3.7 How answers are revealed

- MCQ `explanation` — revealed after answering, *"shown whether they got it right or wrong"* (`question-core.ts:176-179`). It is snapped onto the answer record (`QuestionAnswerData.explanation`, line 469) for rendering.
- Free recall `committedAnswer` — *"shown to him on submit"* (`question-core.ts:311-313`), snapped as `committed` (line 468).
- Practice `modelSolution` — revealed verbatim by `conclude` (`practice.ts:90-92`).
- Reveal *gating* for teach-phase checks: `questionNeedsReveal` (`question-core.ts:232-235`) — a `check` collapses behind a "Check your understanding" reveal; a `predict` **never** does (it precedes the teaching and gates it).
- The **client payload omits the answer**: `toClientQuestion` (`question-core.ts:688-697`) returns only `{id, kind, question, context, mode, options}` — **no `correctIndices`, no `committedAnswer`, no `explanation`** (`question-core.ts:424-429` marks them *"NEVER send to the client before answering"*).

### 3.8 How question validity is enforced

Enforced at **three** seams:

1. **Structural** — TypeBox validation at the tool-call boundary.
2. **Semantic (authoring)** — `quizInputProblems` / `explainInputProblems` / `askOptionProblems` inside `execute`; failure ⇒ `invalidInputResult` ⇒ model retries in-turn.
3. **Session-consistency** — teach `nodeId` must match a node in the **live** session plan tree (validated in `src/agent/tools.ts`, reading the chat record).

Additional hardening:
- `parseOptionsIfString` (`question-core.ts:63-72`) — repairs GLM's JSON-encoded-string options. *"the persisted call keeps the raw string, so the dock must coerce again"* — the coercion runs at **both** the server `prepareArguments` and the client display seam.
- `stripModelValueDebris` (`src/core/value-debris.ts`) — copy-syntax healing for `correctAnswer` and practice targets.
- `normalizeQuizType` (`question-core.ts:217-221`) — heals the recorded `"\"predict\""` wobble.
- `components/malformed-question.tsx` + `tests/malformed-question-recovery.test.ts` — the UI seam for a malformed persisted call.

### 3.9 How grading results are communicated back to the teaching agent

Via the **tool result** of the original question call. The learner's answer is appended as that call's result; `compactAnswerForModel` produces the model-facing JSON (`question-core.ts:753-762`).

> *"the tool call already carries everything the model itself authored — the question, every option, the correct answer, the explanation, the explain commitment — so the result returns ONLY what the learner added: his selection or words, the graded verdict, his stated confidence, his note."*

The full graded `QuestionAnswerData` rides `details` for the record and the UI.

**Sibling pending questions:** *"Sibling pending questions are answered without inference until the last is resolved."* (`docs/architecture.md:70`)

### 3.10 How questions survive page reloads or failed requests

**VERIFIED — by construction:**
- *"Because the pending question IS a persisted message part, a session can be exited and resumed mid-question for free."* (`question-core.ts:16-17`)
- The pending-question gate is **derived client state** from the message list (`src/core/pending.ts:116-136`): a `tool-*` part in `input-available` state whose tool name is in `QUESTION_TOOLS = ["quiz","probe","ask_user_question","explain","recall"]` (`pending.ts:53-59`).
- Scan order: messages newest-first, parts forward within a message — *"the model's FIRST unanswered question is the dock subject"* (`pending.ts:25-32`).
- Native callers use `danglingQuestionOf` over `LhMessage[]` (`src/core/native-messages.ts`).
- **`toolQuestionKind(tool)`** (`pending.ts:64-66`) folds `probe`→`quiz`, `recall`→`explain` — the dock is kind-driven.
- Question drafts (selection + thinking + other + text + confidence index) survive **optimistic unmount in memory** via `QuestionFormDraft` (`question-core.ts:516-522`); they are **never written to storage**.
- Failed requests: the failed turn is preserved on disk; the provider context projection omits the eligible failed tail (`docs/architecture.md:56`).

---

## 4. Practice engine

`src/agent/tools/practice.ts` + `src/agent/prompts/practice/{00-base,10-doctrine}.md`.

### 4.1 How problems are generated

The Practitioner model generates them via the `problem` tool:
```
problem({
  statement: string,           // REQUIRED — as the learner sees it (markdown + LaTeX), self-contained
  mode: "recall" | "discrimination" | "composition",   // REQUIRED
  target?: string[],           // OPTIONAL — proposition ids; OMIT when the material is not in the map
  modelSolution: string        // REQUIRED — full solution, committed BEFORE posing
})
```
(`practice.ts:72-93`)

`mode` is the **demand mode** (recall / discrimination / composition) — the closest thing LearnHarness has to a question-type taxonomy for open problems.

### 4.2 Whether solutions are committed before presentation

**YES.** `modelSolution` *"committed BEFORE the learner sees the problem. This IS the reveal — conclude shows it verbatim; never re-author it."* (`practice.ts:90-92`)

It rides the persisted call's arguments and is **hidden from the learner UI** until `conclude` (`practice.ts:101-108`).

### 4.3 How an active problem is tracked

**A turn-scoped in-memory gate**, not a stored field:
```
export interface PracticeGate { problemActive: boolean; }        // practice.ts:59
export function createPracticeGate(ctx): PracticeGate             // practice.ts:65 — seeds ONCE from the record
```
Seeded from `activeProblemOf(record.messages)` (only a **cleanly-posed** problem counts) at construction; the two `execute`s flip the closure.

**The BKT incident (documented, `practice.ts:49-58`):** the gates used to read the **stored** record, but the record freezes at the turn's write-ahead (`persistTurn` lands only at turn END) — so a mid-turn conclude→pose pair could never see each other. Every conclude succeeded against a stale record and every following pose died on *"a problem is already active"* until the model gave up (*"the problem slot is stuck"*).

**Design rule:** one `practiceTools` per turn (the handler builds the agent per request) ⇒ no cross-turn leakage.

**Gating law (`practice.ts:8-10`):** *"an agent cannot pose while a problem is active and cannot conclude with nothing active — `activeProblemOf` is the single fold both gates read."*

### 4.4 How problems conclude

`conclude` tool (`practice.ts:165-220`):
```
conclude({
  outcome: "solved" | "solvedWithHints" | "movedOn" | "surrendered" | "dismissed",
  verdict: string,        // plain-language: what was credited, where it broke
  rung: "R0".."R5" | null,       // hint-ladder rung the problem needed
  missClass: "cue" | "discrimination" | "execution" | "careless" | "structural" | null,
  retest: boolean         // true → mark for a fresh-surface retest before the session ends
})
```

`dismissed` is **synthesized, never authored** by the model (`practice.ts:174`).

`conclude` **reveals the committed solution verbatim** and frees the composer. The turn **continues** so the same reply can pose the next problem — but the tool description says *"The next problem is NEVER posed here: it waits for the learner's explicit go-ahead."* (`practice.ts:204-208`). **The post-conclusion pause is doctrine, not a terminating result** (`docs/architecture.md:74`).

### 4.5 Which outcomes are recorded

`outcome` ∈ {solved, solvedWithHints, movedOn, surrendered, dismissed}; plus `verdict` (prose), `rung` (hint level reached), `missClass`, `retest`.

**These are stored as the tool call's arguments** — persisted in the transcript. `docs/architecture.md:74`: *"Practice outcomes are session evidence, not graph mastery; ordinary practice settlement skips extraction."*

### 4.6 How hints operate

A **hint ladder R0–R5** — the model decides which rung the problem needed and records it at `conclude` time. The ladder doctrine lives in `src/agent/prompts/practice/10-doctrine.md` (the tool descriptions are mechanics-only: *"the theory, the commit-before-pose law, the hint ladder all live in the system prompt"* — `practice.ts:11-14`).

> **Not found:** a deterministic hint generator or a stored hint state machine — the hint content is model-authored prose. `rung` is a **record of which rung was used**, not a controller.

### 4.7 How incorrect reasoning is classified

`missClass` ∈ {`cue`, `discrimination`, `execution`, `careless`, `structural`}, or `null` (no miss). A **single model-authored label per problem** — not a per-error taxonomy, not aggregated, not persisted to any analytics store.

The `conclude` description instructs: *"On a wrong answer: localize the break, DO NOT give the correction."* (`practice.ts:177`)

### 4.8 How retesting works

`retest: boolean` marks the problem for a **fresh-surface retest before the session ends**. It is a **flag**; there is no retest scheduler, no retest queue, no retest record type. The model is expected to honor it in a later turn.

### 4.9 Whether practice uses the knowledge graph

**YES, optionally.** `practice.ts:36-45`:
- `graphNodes?: () => ReadonlyArray<Pick<GraphNode, "id"|"name">>` — the **WHOLE-graph** node list, read fresh per pose. *"targets validate against every proposition, not just the session's picks, so pickless sessions and future graph-tools poses stay valid."*
- `graph?: GraphToolContext` — the map readers behind the same settings gate as the prober's.

**Target normalization (`practice.ts:111-135` + `prepareArguments`):** names silently become ids via `resolveTargetId` (`src/core/chains.ts:70-88`) — exact id first, then case-insensitive name match (ambiguous ⇒ first node in store order). An **explicit empty array is healed away** ⇒ the canonical form is *tagged-or-absent, never `[]`*.

**Untagged problems are legal** (`practice.ts:148-156`): when the material is not in the map, omit `target` entirely — *"if the material is not in the map, omit target entirely"*.

### 4.10 How difficulty adapts

**Weakly, and only via the model.** There is no difficulty estimator, no learner-state model, no numeric mastery. Adaptation is **model-side and prompt-driven**: the model sees the learner's answers, thinking, confidence, the probe assessment, and the graph context, and is instructed to adapt. The `mode` field (recall/discrimination/composition) is the only structured difficulty-adjacent signal, and it is model-chosen.

> **VERIFIED:** no adaptive-difficulty algorithm exists. `docs/architecture.md:74` — *"Practice outcomes are session evidence, not graph mastery."*

### 4.11 Teaching vs Practice vs Examination — the requested distinction

| | **Teaching** | **Practice** | **Examination** |
|---|---|---|---|
| Agent | Teacher | Practitioner | **DOES NOT EXIST** |
| Session kind | absent ⇒ teaching | `kind: "practice"` | — |
| Plan | `plan_init` DAG | none | — |
| Question tool | `quiz`/`explain` | `problem`/`conclude` | — |
| Commitment | `correctAnswer` / `correctAnswer` free text | `modelSolution` | — |
| Grading | client-deterministic (MCQ) / model-judged (free) | model-judged | — |
| Aggregate score | none | none | — |
| Blueprint | none | none | — |
| Rubric | none | none | — |
| Historical reporting | none | none | — |
| Coverage metric | graph coverage (content) | none | — |

**LearnHarness implements Teaching and Practice. It does not implement Examination.**

---

## 5. Knowledge graph and extraction

### 5.1 What a proposition represents

`GraphNode` (`src/core/contracts/graph.ts:126-147`):
- `id` — opaque stable id, store-assigned: `"n_" + nanoid-like`.
- `name` — a **very short label** (glossary headword). *"Presentational only — not unique, not an identity key, never precise: the statement carries the precision."*
- `statement` — *"The minimal proposition — one true, self-contained statement, at full precision. **The IDENTITY ANCHOR**: the auditor recognizes a re-encounter by judgment against this (link-or-create), not by string matching."*
- `aliases` — *"Verbatim phrasings sessions used for this proposition (the identity audit trail — how the world said what the node says)."*
- `provenance: ProvenancePoint[]` — every `(chatId, messageId)` where it came up.
- `createdAt`.

**Proposition rules (`contracts/graph.ts:225-229`):** *"No learner / teacher / session references: misconceptions are stated as the true correction, and **wrongness is never recorded in the graph**."*

### 5.2 How reasoning chains are modeled

`GraphChain` (`contracts/graph.ts:42-54`):
- `id` — `"arg_" + nanoid-like` (store-assigned).
- `premises: string[]` — node ids **jointly** sufficient (*"co-premises within one chain are used TOGETHER"*).
- `conclusion: string` — the implied node id.
- `provenance: ProvenancePoint[]`.
- `createdAt`.

**Chains-primary (2026-09-30):** edges are **NEVER stored**. The derived view rebuilds untyped arrows (premise → implication-node → conclusion) from chains on every read. `GraphSnapshot` carries `nodes`, `propositions`, `edges`, `logicalEdges`, `impLinks`, `chains`, `sessions`, `fileSources`, `nodeSessions`, `clusters`, `positions` (lines 303-347).

**Chains merge by `(premises, conclusion)`** at read time, unioning provenance; the first line's `arg_` id is the identity (`contracts/graph.ts:186-189`).

### 5.3 How source material is ingested

Two paths into the same pipeline:

1. **Session path** — teacher prose from chat messages. `POST /api/graph/coverage/extract`.
2. **Notes import path** — `POST /api/graph/import` feeds text or locally converted PDF Markdown, *"without chat-message anchors"* (`docs/architecture.md:115`).

Notes sources: `NotesSource` (`contracts/graph.ts:93-105`) — `id` is `"src_" + hash of the file path` (**deterministic**, so re-importing the same file re-runs against the same source id and mappings dedupe by it).

Import limits (`docs/architecture.md:115`): files capped at 25 MiB; server aggregate per request also 25 MiB; 26 MiB multipart/proxy bound; up to three in flight; PDF conversion has **no OCR**; skipped image-only pages and scanner caveats are reported.

**Source identity:** *"Source identity hashes the original path/name; safe folder-relative paths can be supplied alongside matching filenames. Renaming or reorganizing a displayed source does not change its identity."* (`docs/architecture.md:117`)

### 5.4 How propositions are extracted

`src/agent/subagents/extraction.ts` (1452 lines) — `createExtractionPipeline` (line 803).

**Pipeline (`docs/architecture.md:96-111`):**
```
SOURCE (teacher prose | imported notes)
  → EXTRACT (extractor subagent)
  → AUDIT (identity auditor)
  → MERGE (deterministic merge + simplification)
  → LEDGERS (graph + coverage)
  → VIEW (canvas + chains view)
```

**Extractor output shape** `SessionFindings` (`contracts/graph.ts:258-262`):
```
{ propositions: ExtractedProposition[], chains: ExtractedChain[] }
```
`ExtractedProposition` (`contracts/graph.ts:215-245`): `id` (extractor-local `"p1"`), `name`, `statement`, `aliases`, optional `messageId`.

**Submit-schema slimming (2026-09-28):** `messages` and `evidence` were **removed** — *"weak models burned their retries on them ('propositions.0: must be object' — the stringified-payload collapse)."*

**The extractor is the ONLY stage that sees the raw source.** *"The extractor is fully trusted (2026-09-27)"* — the auditor **never rejects** (`contracts/graph.ts:282-283`).

**Coverage gating (`docs/architecture.md:107`):** automatic extraction is gated by `graph.enabled` **and** an uncovered-token threshold (default **4096**, minimum **500**). Rendering is a separate switch. Manual extraction/import routes do **not** check the automatic switch.

**Coverage unit (`src/core/coverage.ts`):** *"THE TEACHER'S PROSE IS THE UNIT"* — assistant text blocks and explicit `send_to_user` messages only. Learner messages, thinking, other tool calls/results, and quiz blocks are **invisible** to coverage.
- `messageViewLines(message, mid)` (line 38-51) — the shared seam: `TEACHER [mid] <text>`.
- `messageFingerprint` (line 77-81) — sha256 of role + view lines.
- `coverageOf(messages, entries, chatId)` (line 115-150) — *"uncovered" is derived (fingerprint the current transcript, diff) — never dual-tracked.*
- `batchRuns(slots, uncovered, budget)` (line 159-177) — greedy consecutive fill, **a message is never split**; an over-budget message rides alone.
- `batchTag(batch)` (line 188-192) — deterministic hash of member fingerprints — the idempotency key so re-running the same batch after a crash dedupes.

**Scheduling (`docs/architecture.md:109`):** *"The pipeline batches oldest uncovered messages without splitting one message. Trigger and batch budgets are distinct: **current app wiring does not inject the configurable trigger value as the batch budget**."* Each source's batches run serially; cross-source work can overlap under a background-LLM semaphore. A process-wide FIFO lock serializes audit through merge. These registries survive module entries through `globalThis`, **not separate server processes**.

### 5.5 Whether an auditor validates extracted knowledge

**YES — an identity auditor, but only for identity.**

`AuditVerdicts` (`contracts/graph.ts:284-286`):
```
{ links: IdentityLink[] }   // IdentityLink = { id: string, linkTo: string }
```
The auditor sees **propositions and the current graph, NOT source passages or chains** (`docs/architecture.md:111`). It submits **identity links** (link-or-create) via graph-exploration tools (`find` / `list_sessions` / `list_propositions`).

**The auditor NEVER rejects** and **never mints edges** (`contracts/graph.ts:278-283`). The graph connects across sources **solely through identified equivalences**.

**Equivalence bias (`contracts/graph.ts:265-270`):** *"paraphrases, rewordings, and compressions of the same claim MERGE — do not create a duplicate because the wording differs."*

**Important limitation:** there is **no factual correctness auditor**. The extractor is *"fully trusted"*. A hallucinated proposition enters the graph. **This is a critical risk for Plethora — see §5.12.**

### 5.6 How duplicates are reconciled

The **deterministic merger** (`src/core/graph.ts`) applies the verdicts:
- resolves identities and chain endpoints,
- **unions provenance**,
- **deduplicates arguments** (chains merge by `(premises, conclusion)`),
- **simplifies redundant chains** (ancestry-cover / prefer-fewest-premises; `droppedChains` counter, `contracts/graph.ts:65-71`),
- **checkpoints coverage after graph writes**.

`src/core/proposition-candidates.ts` (169 lines) and `src/core/graph-deletion.ts` support this.

### 5.7 How source identity is maintained

`ProvenancePoint` (`contracts/graph.ts:77-83`): `{ chatId, messageId }` — message-granular. For imports, `chatId` is a `"src_…"` notes-source id and `messageId` is `""` (chat-level).

`messageId` stamping (2026-10-13): the extractor copies the teacher passage's message id from the view's `TEACHER [id]` label; the submit seam **validates it against the CURRENT batch**; the merger stamps it into the node's provenance point — *"so NO persisted shape or format version changes (GraphNode / ProvenancePoint untouched)"*.

### 5.8 How conflicting or repeated knowledge is represented

- **Repeated** — merged by the auditor's identity verdict; provenance unions; aliases accumulate.
- **Conflicting** — **NOT FOUND.** There is no contradiction representation, no conflict flag, no supersession mechanism. A contradictory proposition is simply a *different* proposition and both live in the graph.
- Graph node deletion cascades: *"A chain referencing a dead node dies with it (full death cascades through every referencing chain)"* (`contracts/graph.ts:39-41`).
- Deleting a **source** removes its graph contributions while preserving knowledge supported elsewhere (`docs/architecture.md:121`).

### 5.9 How extraction jobs recover

- *"Failed stages leave material uncovered; completed chunks and usage survive later failure/abort."* (`docs/architecture.md:111`)
- *"Ordered ledger operations are not an atomic multi-file transaction."* (same)
- Coverage is checkpointed **after** graph writes; re-running the same batch produces the same `batchTag` refs and dedupes.
- `ExtractionRunUsage` (`contracts/chat.ts:92-110`) is an **append-only usage log** on the chat record, appended when the run ends — *"success or failure, because money was spent either either way"*.
- `abortExtraction(chatId)` (`extraction.ts:708`) and `extractionStatuses()` (line 699) expose running pipelines.
- Restart recovery: *"restart recovery restores known pending obligations and can respawn unfinished workers"* (`docs/architecture.md:84`).

### 5.10 Does the graph track knowledge or the learner's understanding?

**KNOWLEDGE ONLY. This is explicit and load-bearing.**

`src/core/contracts/graph.ts:9-11`:
> *"The graph is an extraction of the reasoning chains from all teaching sessions (and imported notes) — **NOTHING else: no quiz outcomes, no understanding assessments (2026-09-27 cleanup)**."*

README: *"It stores the ideas and their connections, **not ratings of your ability**."*

`docs/architecture.md:96`: *"The graph records objective propositions and jointly-entailing reasoning chains, not learner understanding levels."*

**Therefore: LearnHarness has NO mastery model, NO knowledge-gap detection, NO per-learner mastery estimation.** The word "mastery" appears only in a comment naming the *practice-target id normalization* contract (`src/core/chains.ts:62`, `native-messages.ts:280`, `practice.ts:37,114`, `components/practice-cards.tsx:30`) — **not** a mastery model.

### 5.11 Do coverage and mastery differ in LearnHarness?

**Yes, trivially**: coverage = *"have these teacher-prose messages been extracted into the graph"* (a **content** metric). There is no mastery metric to confuse it with. **Plethora must be careful not to inherit this confusion.**

### 5.12 Risk transfer note

The extractor is **fully trusted** with no factual auditor, and contradictions are unrepresented. **Any Plethora design that ingests propositions from a model and then uses them to build curricula or exams must add a verification layer LearnHarness does not have.**

---

## 6. Persistence and lifecycle

### 6.1 Storage model

**JSON files, not SQLite.** `docs/architecture.md:133-146`:

| Data | Files |
|---|---|
| Conversations, plans, usage, image snapshots | `chats/*.json` |
| Worker computation and delivery obligations | `jobs/*.json` |
| Propositions, chains, checkpoints, coverage | `graph/{nodes,chains,sessions,coverage}.jsonl` |
| Sources, organization, positions, render preferences | JSON maps under `graph/` |
| Preferences and prompt overrides | `settings.json`, `prompts/` |
| Keys and custom-endpoint binding | separate `auth.json`, selected by `LH_AUTH_FILE` |

Config: `config.ts` anchors immutable prompt assets to the app root; mutable state to `LH_DATA_DIR` (default repo `data/`). Storage ports are semantic interfaces in `src/core/ports.ts`.

**Durability caveats (`docs/architecture.md:144`):** *"Adapters use synchronous filesystem operations. JSONL reads skip corrupt/invalid lines; graph derivation merges repeated assertions. Some replacements use temp-file rename, but ordinary whole-file writes are not database transactions. Same-event-loop serialization is not cross-process locking or crash atomicity. Use **one server owner per data/auth profile**."*

### 6.2 Conversation creation

`app/chat/new/page.tsx` → `POST /api/chats` → `src/server/chats.ts`. The title derives from the first learner message via `titleFromPrompt` (`contracts/graph.ts:368-384`) — a word-boundary-safe truncation at `TITLE_MAX_CHARS = 72`.

### 6.3 Agent reconstruction

`src/server/chat-handler.ts:171` `handleChatRequest` / line 200 `handleChatInput`.

Per `docs/architecture.md:39`: *"[chat-handler.ts] resolves readiness, waits for compaction, re-reads durable truth, and claims per-chat liveness. A competing turn gets **409**. Accepted input is saved before inference; subscription automatic inputs can instead remain staged until dispatch admission. The HTTP response acknowledges admission, while `GET /api/chats/:id/stream` carries replay/live events and a terminal state."*

**Per-chat liveness** ⇒ one turn at a time per chat. The UI may not answer a question while a turn is in flight (`teacher-agent.ts:150-153`).

### 6.4 Message persistence

Two projections from the stored record (`docs/architecture.md:41-44`):
- `toLlmMessages` (`src/core/native-messages.ts`, 937 lines) — strips app metadata, flattens model-facing markers, applies the active compaction cut, **repairs eligible interrupted tool pairs** at the provider boundary.
- `projectView` (`src/core/view.ts`, 490 lines) — derives UI messages, question/problem docks, artifacts. *"It is not the stored format or provider wire."*

**Pi seeds the system prompt/tools at construction; that synthetic system message is not persisted.** New turns therefore get current instructions. *"The app does not use the AI SDK's client-transcript replacement or `addToolOutput` loop."* (`docs/architecture.md:46`)

### 6.5 Pending questions

Derived from the persisted record, never stored as a separate entity. See §3.10.

### 6.6 Question submission

Client → `POST /api/chats/:id` (or the chat route) → the answer becomes the **tool result** for the pending call → persisted with the turn.

*"Question drafts survive optimistic unmount in memory. Uncertain submissions reconcile the saved record and running state before resending, scoped to the same question occurrence."* (`docs/architecture.md:56`)

### 6.7 Background jobs

`src/server/jobs.ts` (768 lines) + `src/agent/subagents/runner.ts` + `src/store/jobs.ts` + `src/core/contracts/jobs.ts`.

- Research, PDF, demo, and visual tools persist jobs, acknowledge dispatch, and start independent workers.
- **Worker completion and session delivery are separate.** The worker saves its outcome and pending-delivery metadata **before** queueing a marker.
- Delivery: *"by steering a live agent at a native boundary or waking an idle, eligible session."*
- *"Pending questions, pause, consent, or admission races can hold delivery."*
- *"Only computing workers are abortable."*
- *"A marker in the **saved conversation** acknowledges delivery—not HTTP acceptance or visibility in a stream."*
- *"Reconciliation avoids replaying saved results; restart recovery restores known pending obligations and can respawn unfinished workers. Legacy terminal jobs without delivery metadata are not guessed into replay. Deleting a session discards its obligations."*

**Explicitly not a transactional queue:** *"This is single-process coordination over JSON files, not a transactional queue or exactly-once provider execution."* (`docs/architecture.md:86`)

### 6.8 Failed requests

- *"Accepted input is saved before inference"* → a failed turn leaves the input on disk.
- *"Failed input writes refuse inference; failed reply writes are surfaced before the terminal and do not masquerade as successful empty turns."* (`docs/architecture.md:48`)
- *"A memory-only failure notice can inform reattaching views without fabricating saved transcript content."*
- Cleanup releases liveness.

### 6.9 Session resumption

See §1.12. Also `src/server/turn-recovery.ts`, `src/server/turn-liveness.ts`, `src/server/commit-positions.ts`.

### 6.10 Partial output

*"Settlement persists new native messages, plan snapshots, and usage, **including partial output on abort**."* (`docs/architecture.md:48`)

### 6.11 Cancellation

- Explicit abort is separate from browser disconnect (`docs/architecture.md:54`).
- `src/agent/subagents/aborts.ts`, `components/abort-turn-dialog.tsx`, `src/core/native-messages.ts` synthesizes an `INTERRUPTED` result for an abort's dangling question call (`teacher-agent.ts:236-240`).
- Aborted messages are **not billed**: *"A cancelled call is not a billed step (partial/estimated usage on an aborted message is not money spent)"* (`teacher-agent.ts:266-267`).

### 6.12 Crash recovery

- Schema-stamped records; newer-than-build records refused on read (`contracts/chat.ts:57-63`).
- Golden fixtures exercise compatibility (`tests/fixtures/golden-data/`, `tests/golden-fixtures.test.ts`).
- Job restart recovery (`docs/architecture.md:84`).
- Atomic writes: `src/store/atomic-write.ts` + `tests/atomic-write.test.ts`, `tests/store-writes-atomic.test.ts`.

### 6.13 Model context management

- `src/core/compaction.ts` + `src/server/compaction.ts` — compaction; `docs/compaction-accounting.md`.
- `src/core/context-usage.ts` — token accounting (chars/4 estimate: `viewTokens`, `coverage.ts:68-70`).
- `src/core/prompt-segments.ts`, `src/agent/prompt-segments.ts` — context slimming doctrine (see the `PROBE_DONE_ACK_TEXT` / `CONCLUDE_ACK_TEXT` pattern).

### 6.14 What is useful for Plethora's existing architecture

| LearnHarness pattern | Plethora relevance |
|---|---|
| Persisted-transcript-as-source-of-truth; agent rebuilt per turn | ✅ Directly usable — Plethora already persists conversations |
| Tool-call arguments as the durable commitment record | ✅ **Directly applicable to exam answer keys** |
| Client grades deterministic MCQ; model never re-grades | ✅ Directly usable for MCQ/multi-select |
| Tool-boundary semantic validation with model-retry | ✅ Directly usable — Plethora already has schema validation |
| Derived progress (no stored status ledger) | ⚠️ Adopt the *principle* (derive what can be derived) but Plethora exams NEED stored attempts |
| `batchTag` idempotency for resumable extraction | ✅ Directly applicable to resumable exam generation |
| Per-chat liveness (409 on concurrent turn) | ⚠️ Plethora needs a different model for exam attempts |
| JSON file storage, single-owner | ❌ Plethora uses SQLite — **do not port** |

---

## 7. LearnHarness UI

Next.js App Router + React 19. Routes under `app/`:

| Route | Purpose |
|---|---|
| `app/page.tsx` | Home / minimal home / session list |
| `app/chat/new/page.tsx` | New session (model pick, kind, graph picks) |
| `app/chat/[id]/page.tsx` | The session (teach / practice surface) |
| `app/settings/page.tsx` | Settings (providers, prompts, tools, graph) |
| `app/api/chat/route.ts` | `POST /api/chat` — the turn admission endpoint |
| `app/api/chats/[id]/stream/route.ts` | `GET` — replay/live event stream + terminal state |
| `app/api/chats/[id]/steer/route.ts` | `POST` — steer a live agent (handoff, job delivery) |
| `app/api/graph/route.ts` | `GET` — the graph snapshot |
| `app/api/graph/import/route.ts` | `POST` — notes import |
| `app/api/graph/coverage/extract/route.ts` | `POST` — manual extraction |
| `app/api/graph/nodes/[id]/route.ts` | node detail/delete |
| `app/api/events/route.ts` | window-level notification stream |

**UI components (the ones Run B must understand):**

| Component | Role |
|---|---|
| `components/chat.tsx` | The main session surface; composes dock, blocks, composer |
| `components/question-dock.tsx` | `QuestionDock` (line 102), `QuestionDockBar` (line 191) — the question UI + composer gate |
| `components/answered-card.tsx` | The answered question card (rendering) |
| `components/malformed-question.tsx` | Recovery UI for a malformed persisted call |
| `components/plan-block.tsx` / `components/plan-window.tsx` | Plan rendering; `planExists` (39), `PlanMarginalia` (44) |
| `components/practice-dock.tsx` | `PracticeDock` (52) — the practice problem surface |
| `components/practice-cards.tsx` | `ProblemCard` (58), `ConcludeCard` (96), `ThinkingCard` (292) |
| `components/confidence-rail.tsx` | The 0-100 confidence slider |
| `components/reading-thinking.tsx` | The "thinking while reading" channel |
| `components/graph-view.tsx` | `GraphView` (927), `GraphChromeRow` (840) — the knowledge graph canvas |
| `components/chain-table.tsx` | The chains browser (stored truth, not the canvas image) |
| `components/graph-context-card.tsx` | The picked-graph context injected at session start |
| `components/extraction-coverage.tsx` | Coverage UI |
| `components/notes-import.tsx` / `notes-import-queue.ts` | Notes import UI |
| `components/new-session.tsx` / `start-session.ts` / `minimal-home.tsx` | Session creation |
| `components/session-core.ts` | Reattachment, 409 recovery, canonical-state adoption |
| `components/sidebar.tsx`, `top-bar.tsx`, `model-picker.tsx`, `model-catalog.ts` | Chrome + provider/model selection |
| `components/phase-divider.tsx` | probe/plan/teach phase separators |
| `components/queued-steers.tsx` | Shows queued handoff/job steers |
| `components/server-events.tsx` | Window-level event subscription |
| `components/jobs-context.ts` | Background job state |

**Data flow (teach):**
```
Browser input → POST /api/chat → validate + save input → server-owned Agent run
  → PiEngine stream → tools (quiz/explain/plan_init) → synthetic question placeholder (terminate)
  → settle: save native messages + tree snapshot + usage
  → GET /api/chats/:id/stream: replay + live events → SessionModel → projectView → UI
Browser answers → POST answer → persisted as the call's tool result → next turn
```

---

## 8. LearnHarness limitations — explicit classification

| Requested capability | Status | Evidence |
|---|---|---|
| Persistent multi-document curricula | **ABSENT** | `curriculum` → 0 files; plan is session-scoped (`contracts/plan.ts:40-41`) |
| Independently editable study plans | **ABSENT** | plan rewritten wholesale by the model only (`plan.ts:26-51`); no user edit API |
| Configurable examination lengths | **ABSENT** | `blueprint` → 0 files; one question per turn by contract (`question-core.ts:160-161`) |
| Mixed-format examinations | **ABSENT** | one question per turn; no exam container |
| Cloze testing | **ABSENT** | `cloze` → 0 files repo-wide |
| Essay examination rubrics | **ABSENT** | `rubric` → 0 files repo-wide |
| Formal numeric grading | **ABSENT** | `isCorrect` is boolean; no aggregate score type |
| Historical examination reporting | **ABSENT** | no exam entity; graph coverage stats only |
| Long-term mastery estimation | **ABSENT** | graph excludes understanding (`contracts/graph.ts:9-11`) |
| Source-linked remediation | **PARTIAL** | propositions carry `(chatId,messageId)` provenance; no remediation route or UI |
| Flashcard scheduling integration | **ABSENT** | `flashcard` → 0 files; `fsrs` → 0 files repo-wide |
| Diagnostic probing | **PRESENT** | Prober agent + `probe_done` assessment (`tools/probe.ts`) |
| Agent-based teaching | **PRESENT** | Teacher agent, plan DAG, predict/check cycle |
| Prerequisite dependency graphs | **PRESENT (session-scoped)** | `PlanTree` + `createTree` DAG validation (`core/plan-tree.ts`) |
| Adaptive practice | **PARTIAL** | `problem.mode` taxonomy + hint ladder + `missClass` + `retest`; **no** algorithm |
| Precommitted correct answers | **PRESENT (strong)** | `quiz.correctAnswer`, `explain.correctAnswer`, `problem.modelSolution` |
| Structured question validation | **PRESENT (strong)** | `quizInputProblems` / `explainInputProblems` / `askOptionProblems` |
| Targeted feedback | **PRESENT** | `conclude.verdict` + `missClass` localization |
| Knowledge extraction | **PRESENT** | extractor → auditor → deterministic merger (`subagents/extraction.ts`) |
| Session persistence & recovery | **PRESENT** | JSON stores + schema stamps + job recovery |

---

## 9. Adopt / Adapt / Reject matrix

### ADOPT (patterns to carry into Plethora directly)

| # | Pattern | LearnHarness anchor | Why it transfers |
|---|---|---|---|
| A1 | **Commit the answer key before posing** | `question-core.ts:310-314` (explain), `practice.ts:90-92` (problem), `question-core.ts:176-181` (quiz ordering) | The single highest-value anti-sycophancy pattern. Plethora's exam generator needs a *mechanical* version (a stored, immutable answer-key row) |
| A2 | **Schema-valid ⇔ gradeable** | `question-core.ts:74-79` | Plethora's exam question bank must validate at the generation boundary using the *same* rules the grader uses |
| A3 | **Key by value, never by position** | `question-core.ts:185-188`, `resolveCorrect` 657-676 | Plethora: `correctOptionIds` keyed by stable option ids; unknown key ⇒ hard error, never a silent wrong grade |
| A4 | **Exact-set match for multi-select** | `isCorrect` 679-684 | Directly reusable as Plethora's deterministic multi-select grader |
| A5 | **Unknown option value ⇒ hard error** | `resolveCorrect` 670-672 | Prevents silent mis-grades from model typos |
| A6 | **Deterministic shuffle seeded by a stable id** | `seededRandom` 588-602, `shuffleOptions` 610-618 | Hydration-safe, reproducible option order in Plethora's exam UI |
| A7 | **Tool-boundary semantic validation + model retry** | `quizInputProblems` + `invalidInputResult` | Plethora: generation task returns structured problems → repair task |
| A8 | **Idempotent batch tag for resumable work** | `batchTag` 188-192 | Plethora: resumable exam generation without duplicate questions |
| A9 | **Answer not sent to the client before answering** | `toClientQuestion` 688-697 | Plethora: the exam answer key must not ship to the client before submission |
| A10 | **Derived progress where derivable** | `derivePlanStatuses` 82-102 | Plethora: derive exam progress from persisted attempts rather than duplicating state |
| A11 | **Don't echo the model-facing payload** | `compactAnswerForModel` 779-802 | Plethora: keep grading context small; send only what the grader needs |
| A12 | **Segmented prompt with per-segment override** | `composeInstructions` 77-84 | Plethora already has a task/prompt layer — mirror the override seam |
| A13 | **Two distinct thinking channels** | `thinking` vs `readingThinking` | Plethora: reasoning-on-question vs reasoning-while-studying are different evidence |
| A14 | **Confidence as a graded signal** | `CONFIDENCE_STOPS` 500 | Plethora: confidence × correctness gives a calibration signal for gap analysis |

### ADAPT (right idea, different implementation required)

| # | Pattern | LearnHarness | Plethora adaptation |
|---|---|---|---|
| B1 | **Probing → plan → teach → practice** | 4-phase agent loop | Plethora: keep the *diagnostic-first* idea, but as a **task pipeline** over persisted artifacts (assessment → curriculum → exam), not a chat agent loop |
| B2 | **Prerequisite DAG with cycle rejection** | `createTree` / `createsCycle` | Plethora: adapt the DAG validation for a **persistent** curriculum; add real node ids, content, and statuses |
| B3 | **Precommitted free-response answer** | `explain.correctAnswer` | Plethora: needs a **rubric** + structured verdict, not a prose string. Adapt the immutability, add the rubric contract |
| B4 | **Practice hint ladder + miss classification** | `conclude.rung`, `conclude.missClass` | Plethora: adapt as a **misconception taxonomy** feeding gap analysis — but persist it structurally |
| B5 | **Knowledge graph of propositions + chains** | `GraphNode` / `GraphChain` | Plethora: adapt to a **source-grounded** proposition store with document/extract provenance — Plethora already has richer source anchors than `(chatId,messageId)` |
| B6 | **Auditor for identity, deterministic merger** | extractor → auditor → merger | Plethora: adapt the *pipeline shape* (extract → validate → merge), but **add factual verification** — LearnHarness's extractor is fully trusted |
| B7 | **Coverage ledger (append-only, fingerprinted)** | `coverage.ts` | Plethora: adapt for "which source passages have been converted into questions" |
| B8 | **Per-turn agent rebuild from persisted transcript** | `teacher-agent.ts:29-35` | Plethora: no equivalent need (task-based, not chat-based) — but adopt the *durability-first* principle |
| B9 | **Background job with independent completion + delivery** | `src/server/jobs.ts` | Plethora: adapt to its own job/task infra (see `02-PLETHORA-CURRENT-ARCHITECTURE.md`) |

### REJECT (do not carry into Plethora)

| # | Pattern | Why |
|---|---|---|
| C1 | **Mermaid as the authoring format** | Free-text authoring is exactly the "models should not be trusted blindly" surface. Plethora should use a **structured schema** (JSON) with schema-validated output. The mermaid idea (models are fluent in it) can be retained only as an *optional import path*, not the canonical store |
| C2 | **Model-authored node slugs as identity** | `PlanNode.id` is a model-copied string. Plethora needs server-assigned stable ids |
| C3 | **Wholesale plan replacement** | Fine for a session map; fatal for a persistent curriculum with history |
| C4 | **Derived-only progress** | Plethora exams need **persisted** attempts and results |
| C5 | **Fully-trusted extractor** | Plethora generates exams from it — hallucinated propositions become exam questions |
| C6 | **No factual-conflict representation in the graph** | Plethora needs a way to record and surface contradictions |
| C7 | **JSON file storage / single-owner process** | Plethora is SQLite + Tauri; not portable |
| C8 | **Chat-centric product model** | LearnHarness's *unit of work* is a conversation. Plethora's unit of work must be an **artifact** (curriculum, exam, attempt) |
| C9 | **Free-text free-recall graded by prose only** | Plethora needs structured verdicts + rubrics + history |
| C10 | **Copying any AGPL source or prompt text** | AGPL-3.0-only. Only the *design ideas* are reusable; all code and prompt text must be independently authored |

---

## 10. Source anchors — quick index

| Concern | File | Symbol / line |
|---|---|---|
| Agent construction | `src/agent/teacher-agent.ts` | `baseAgentOptions` 179, `createProberAgent` 283, `createTeacherAgent` 293, `createPracticeAgent` 344 |
| Question stop rule | `src/agent/teacher-agent.ts` | `makeQuestionStopper` 157 |
| Prompt composition | `src/agent/teacher-agent.ts` | `composeInstructions` 77 |
| Probe seam | `src/agent/tools/probe.ts` | `probeDoneTool` 49 |
| Probe schema | `src/core/contracts/probe.ts` | `probeDoneInputSchema` 47, `PROBE_DONE_ACK_TEXT` 93 |
| Plan authoring | `src/agent/tools/plan.ts` | `planTools` 62, `planInitInput` 52 |
| Mermaid parser | `src/agent/tools/mermaid-plan.ts` | `parseMermaidPlan` 77, `SLUG_RE` 45 |
| DAG validation | `src/core/plan-tree.ts` | `createTree` 112, `createsCycle` 71, `assertValidEdge` 91 |
| Plan contracts | `src/core/contracts/plan.ts` | `PlanNode` 13, `PlanEdge` 22, `derivePlanStatuses` 82, `derivePlanStatusesLh` 132 |
| Question schemas | `src/core/question-core.ts` | `quizInputBase` 158, `quizInputObject` 256, `explainInputBase` 303, `explainInputObject` 326, `askInputSchema` 367 |
| Quiz validation | `src/core/question-core.ts` | `optionProblems` 85, `quizInputProblems` 112, `explainInputProblems` 352 |
| Deterministic grading | `src/core/question-core.ts` | `normalizeOptions` 558, `shuffleOptions` 610, `seededRandom` 588, `coerceCorrectAnswer` 631, `resolveCorrect` 657, `isCorrect` 679 |
| Answer build/compact | `src/core/question-core.ts` | `buildAnswer` 708, `dismissedAnswer` 768, `compactAnswerForModel` 779, `toClientQuestion` 688 |
| Reveal law | `src/core/question-core.ts` | `questionNeedsReveal` 232, `normalizeQuizType` 217 |
| Confidence | `src/core/question-core.ts` | `CONFIDENCE_STOPS` 500 |
| Tool result helpers | `src/agent/tool-execute.ts` | `serverExecute` 196, `questionResult` 222, `problemResult` 240, `concludeResult` 256, `invalidInputResult` 117 |
| Pending question gate | `src/core/pending.ts` | `QUESTION_TOOLS` 53, `toolQuestionKind` 64, `filterEnabledTools` 106, `TOGGLEABLE_TOOLS` 87 |
| Practice tools | `src/agent/tools/practice.ts` | `problemInputObject` 72, `problemTool` 97, `concludeInputObject` 165, `concludeTool` 199, `createPracticeGate` 65 |
| Target resolution | `src/core/chains.ts` | `resolveTargetId` 70 |
| Graph contracts | `src/core/contracts/graph.ts` | `GraphNode` 126, `GraphChain` 42, `ProvenancePoint` 77, `NotesSource` 93, `ExtractedProposition` 215, `AuditVerdicts` 284, `GraphSnapshot` 303 |
| Coverage | `src/core/coverage.ts` | `messageViewLines` 38, `messageFingerprint` 77, `coverageOf` 115, `batchRuns` 159, `batchTag` 188 |
| Extraction pipeline | `src/agent/subagents/extraction.ts` | `createExtractionPipeline` 803, `extractionStatuses` 699, `abortExtraction` 708 |
| Chat record | `src/core/contracts/chat.ts` | `ChatRecord` 30, `ChatSettings` 75, `CURRENT_CHAT_VERSION` 66 |
| Turn orchestration | `src/server/chat-handler.ts` | `handleChatRequest` 171, `handleChatInput` 200, `resolveEngine` 153 |
| Phases | `src/core/phases.ts` | `phaseAt3` 63, `phaseAt3Lh` 166, `teachStepIndex` 115 |
| UI — question | `components/question-dock.tsx` | `QuestionDock` 102, `QuestionDockBar` 191 |
| UI — plan | `components/plan-window.tsx` | `planExists` 39, `PlanMarginalia` 44 |
| UI — practice | `components/practice-cards.tsx` | `ProblemCard` 58, `ConcludeCard` 96 |
| UI — graph | `components/graph-view.tsx` | `GraphView` 927 |
| Tests | `tests/` | `question-core.test.ts`, `question-tools.test.ts`, `plan-tree.test.ts`, `probe-done.test.ts`, `practice-flow.test.ts`, `practice-record.test.ts`, `extraction.test.ts`, `coverage.test.ts`, `malformed-question-recovery.test.ts`, `tool-heal.test.ts`, `golden-fixtures.test.ts` |
