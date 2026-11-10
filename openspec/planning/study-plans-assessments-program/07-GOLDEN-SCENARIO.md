# Study Plans and Assessments — Controlled Golden Scenario

**Status:** normative Change 8 verification design, not a record that the scenario has run.  
**Purpose:** one reproducible operating-systems journey through C1–C8, using synthetic source material and scripted providers. Ordinary unit, integration and E2E runs MUST NOT perform live paid inference. Real-model and physical-device qualification are separate, explicit activities below.

The acceptance result is not merely “a workflow completed.” It is a set of durable artifacts, exact scores, evidence states, navigation calls, provider-call boundaries and scheduler-isolation assertions. A UI snapshot without the corresponding SQLite and negative-path assertions is insufficient.

## 1. Harness and comparison rules

- Start with a fresh native temporary SQLite database and a fresh fixture library. Run the same fixture twice; normalized snapshots and all points/evidence calculations must be identical.
- `FIX_CLOCK` starts at `2026-01-05T09:00:00.000Z`. All attempts occur on that UTC date and the final evidence computation is at `2026-01-05T12:00:00.000Z`; consequently every `ageDays` is zero and every recency multiplier is exactly `1`. Advance only the fixture clock, never read wall time in a pure function.
- Names such as `PLAN`, `A`, `N1`, `Q1` and `SSR-PDF-FAULT` below are **fixture aliases**. Rust still assigns the contracted `sp_`, `spv_`, `spn_`, `ssr_`, `ab_`, `abr_`, `aq_`, `aqr_`, `ea_`, `er_`, `ers_`, `eg_`, `sgj_`, `le_` and `lg_` identities. The harness stores an alias→actual-id map and never asks a model to mint a durable id.
- Model-visible handles are local to one task input: `n1…n5`, `s1…s8`, `o1…o8` and criterion handles. The application resolves them to application-owned identities. Dynamic ids, RFC 3339 timestamps and `slotKey = sha256(blueprintRevisionId + four-digit slot index)` are normalized through the alias map before snapshot comparison.
- Fixture document revisions are SHA-256 content hashes calculated from the checked-in fixture bytes, not hashes supplied by a model. Excerpt hashes are calculated from the exact hydrated substring. Fingerprints and canonical JSON are independently checked against the algorithms in `02-SHARED-CONTRACTS.md`; a second run must produce the same values.
- The ordinary provider is an in-process fake registered through the normal task registry/router. It is keyed by `(taskId, requestHash, stepKey, attemptCount)`, not by prompt substring. Unexpected requests fail the test. The call journal records task, route classification, payload classes, consent snapshot and count, but no secrets or raw learner/source text in test logs.
- Deny external network access in the ordinary E2E harness. “Local fake” is test plumbing, not proof that an arbitrary real provider is local. Destination classification tests use explicit synthetic device, loopback, LAN, remote and unknown endpoint configurations.
- Before step 1, seed one unrelated scheduled card, review history and Queue state (`SCHEDULER_SENTINEL`). Canonically snapshot its learning item, FSRS fields, rating/review rows, due state and Queue priority/membership. Also install spies on scheduling commands, especially `submit_review`.
- Negative/failure scripts run against a transactionally isolated clone of the named step unless explicitly part of the golden path. They cannot contaminate the main expected scores.
- “Offline pass” means saved artifacts, local sources, objective scoring and history work with both provider and network unavailable. Subjective non-exact answers remain pending/manual rather than becoming automatically wrong.

### Layer notation

- **unit:** pure quota, DAG, projection, scoring, rubric aggregation, evidence folding and validators with fixed inputs.
- **integration:** real native repositories/SQLite plus API/task orchestration, using temporary sources and the fake provider.
- **E2E:** the reachable native UI workflow, still using the fake provider and controlled clock.
- **manual:** human observation or a real provider/device. Manual qualification never substitutes for the automated assertion in the same row.

## 2. One synthetic operating-systems corpus

The future C8 fixture pack should live under one test-fixture directory and contain a small valid text-PDF, a deterministic EPUB with one XHTML chapter, and a small supported local-video file with deterministic transcript/extract rows. The PDF has a text layer; this golden scenario does not pretend to exercise OCR. All prose is synthetic and belongs to this fixture design.

| Alias / seeded document id | Kind and deterministic content | Exact evidence used by the scenario |
|---|---|---|
| `OS-PDF` / `doc_fixture_os_pdf` | Five-page text PDF, `Synthetic Operating Systems Notes`. Fixed metadata and bytes. | **Page 1:** `Study processes before scheduling, address translation, and semaphores. Study address translation and the TLB before page-fault handling.` **Page 2:** `A process is an executing program. The operating system gives each process an address space and schedules its threads on the CPU.` **Page 3:** `A context switch saves the current thread's CPU state and restores the next thread's CPU state. The scheduler chooses which runnable thread runs next.` **Page 4:** `A translation lookaside buffer (TLB) caches page-table translations. A TLB miss does not necessarily mean a page fault: the page may still be resident and discoverable through a page-table walk.` **Page 5:** `On a page fault, the processor traps to the operating system. If the referenced page is valid but not resident, the OS loads it from backing storage, updates the page table, and restarts the faulting instruction.` |
| `OS-VIDEO` / `doc_fixture_os_video` | Local video, `Synthetic Scheduling Lecture`, plus two persisted transcript extracts. Codec/container support is qualified on a physical device, not inferred from a database test. | Extract `vext_fixture_rr`, segment `seg_fixture_rr`, **70.000–99.000 seconds:** `Round Robin gives each runnable thread a time quantum. When the quantum expires, the thread moves to the back of the ready queue. A shorter quantum can improve responsiveness but adds more context-switch overhead.` Extract `vext_fixture_fcfs`, segment `seg_fixture_fcfs`, **300.000–325.000 seconds:** `First Come First Served runs the first arriving job to completion. Round Robin rotates runnable jobs through fixed quanta.` |
| `OS-EPUB` / `doc_fixture_os_epub` | EPUB, `Synthetic Synchronization Worked Examples`, fixed `ch01.xhtml`. | **CFI-range paragraph:** `A binary semaphore used as a mutex starts at one. For a bounded buffer with N slots, initialize empty=N, full=0, and mutex=1. A producer performs wait(empty), then wait(mutex), appends the item, performs signal(mutex), and finally signal(full). Reversing the first two waits can deadlock: if the buffer is full, the producer holds mutex while waiting for empty, so the consumer cannot acquire mutex to remove an item.` |

### Durable source-ref manifest

The fixture builder stores the following aliases with `schemaVersion: 1`, exact excerpt/hash/revision and the contracted locator shape. Each excerpt is the full quoted sentence/paragraph above unless a question explicitly uses a shorter exact substring.

| Handle and alias | Document / locator | Used for |
|---|---|---|
| `s1` / `SSR-PDF-PREREQ` | PDF page 1 + quote/hint | Plan prerequisite evidence |
| `s2` / `SSR-PDF-PROCESS` | PDF page 2 + first-sentence quote/hint | N1, Q1 |
| `s3` / `SSR-PDF-CONTEXT` | PDF page 3 + quote/hint | N2 supporting evidence |
| `s4` / `SSR-PDF-TLB` | PDF page 4 + complete two-sentence quote/hint | N3, Q3 |
| `s5` / `SSR-PDF-FAULT` | PDF page 5 + complete quote/hint | N4, Q4 |
| `s6` / `SSR-VIDEO-RR` | `extractId=vext_fixture_rr`, seconds 70/99 + `seg_fixture_rr` | N2, Q2, practice and tutor |
| `s7` / `SSR-VIDEO-FCFS` | `extractId=vext_fixture_fcfs`, seconds 300/325 + `seg_fixture_fcfs` | N2, Q6, follow-up |
| `s8` / `SSR-EPUB-SEM` | EPUB CFI range + paragraph quote | N5, Q5 |

`EPUB_CFI_RANGE` is a checked-in concrete CFI-range string generated against the fixed XHTML and verified by the existing EPUB locator parser. The alias in this design is not permission to substitute a chapter URL or page number. If the fixture text changes, the builder must deliberately regenerate and review that manifest value.

### Fixture-specific navigation subcases

These are separate assertions, not one imaginary generic media jump:

- **PDF:** the adapter supplies the existing exact PDF page locator plus quote/hint. Q4 opens page 5 and highlights the fault excerpt. A changed PDF revision resolves `stale`; coarse opening is allowed only with the mismatch label. A deleted PDF preserves historical results/excerpts but returns `missing` with navigation disabled.
- **EPUB:** Q5 resolves the stored CFI **range**, then verifies the quote. Missing/malformed CFI fails source-ref validation. A bare chapter link, a PDF-style page number or quote-only success is not an exact EPUB pass.
- **Local video:** Q2/the scheduling gap open `OS-VIDEO` with `focusedVideoExtractId=vext_fixture_rr` and the seconds+segment snapshot. The test spies on the adapter and asserts that generic local-video `initialJump` is **not** supplied or treated as proof of a seek. The physical-device check additionally observes extract focus and playback at 70 seconds.
- **Audio/YouTube variants:** neither is covered by running the local-video case. If enabled, each is a separately seeded fixture variant with its own source type and exact seconds+segment locator. A skipped variant is reported as unqualified, never replaced with `focusedVideoExtractId` or a generic timestamp assertion.
- **Ambiguous/unsupported variants:** duplicated PDF quote occurrences without a structural locator return `ambiguous_source`; a bare semantic chunk id without live hydration is rejected; a text-less scanned-PDF variant reports insufficient/coarse evidence rather than inventing OCR text.

## 3. Concepts, curriculum proposal and edits

Seed these existing concepts and confirmed `concept_links` before generation. Plan approval reads them but does not write new global links.

| Plan alias / model handle | Existing concept id and label | Learning objectives | Evidence |
|---|---|---|---|
| `N1` / `n1` | `concept_fixture_os_process` — Processes and threads | Distinguish an executing process from a stored program. | s1, s2 |
| `N2` / `n2` | `concept_fixture_os_scheduling` — CPU scheduling | Compare FCFS and Round Robin; predict quantum-expiration behavior. | s1, s3, s6, s7 |
| `N3` / `n3` | `concept_fixture_os_tlb` — Address translation and TLBs | Explain the TLB and distinguish a TLB miss from a page fault. | s1, s4 |
| `N4` / `n4` | `concept_fixture_os_page_fault` — Page-fault handling | Sequence handling of a valid, non-resident page. | s1, s5 |
| `N5` / `n5` | `concept_fixture_os_semaphores` — Bounded-buffer semaphores | Initialize and order semaphore operations for a bounded buffer. | s1, s8 |

The prerequisite edges are `N1→N2`, `N1→N3`, `N3→N4` and `N1→N5`, each backed by s1 and mapped to a pre-existing confirmed concept link. The fake decompose response proposes exactly the five nodes/objectives/evidence handles above. The fake prerequisite response proposes exactly those four handle pairs. Application reconciliation assigns node/source ids and semantic keys; neither response contains a durable id, collection query, SQL, path, tool name or new concept id.

The curriculum fake is split into `decompose:0000` (five nodes, eight handles, well below batch caps) and `prerequisites:0001`. The user moves N2 to position 1 and N4 to position 3, giving the valid final sequence **`[N1,N2,N3,N4,N5]`**. Both moves are within their DAG bounds. The user locks N2 and adds `Predict FCFS completion time` to N2's objectives, making it user-modified. Cycle, self-edge, dangling-node, duplicate-node, out-of-range reorder and stale-CAS variants must all fail without a partial save.

The plan goal is exactly:

> Explain and apply process scheduling, address translation, page-fault handling and bounded-buffer synchronization using only the selected course material.

Title: `Operating Systems — Synthetic Golden Plan`; depth: `foundational`; knowledge policy for generated papers: `source-only`. The optional diagnostic is skipped: no inference, empty attempt or evidence row is created by skipping.

## 4. Initial mixed examination fixture

### Configuration, quotas and slots

`A-BLUEPRINT` uses the published plan version and frozen three-document scope, `mode=exam`, `requestedCount=6`, `timeLimitSeconds=null`, no excluded fingerprints, and explicit `pointsByKind={single-select:1,multi-select:2,cloze:2,short-answer:4,essay:5}`. These intentional point weights override the defaults within the allowed integer bounds. It uses these integer distribution weights:

| Dimension | Weights | Exact allocated counts |
|---|---|---|
| Topic, in published plan order | N1:1, N2:2, N3:1, N4:1, N5:1 | `[1,2,1,1,1]` |
| Kind, in contractual stable order | single-select:2, multi-select:1, cloze:1, short-answer:1, essay:1 | `[2,1,1,1,1]` |
| Difficulty | 1:0, 2:1, 3:2, 4:2, 5:1 | `{2:1,3:2,4:2,5:1}` |

Independent largest-remainder allocation and proportional-remaining slot construction produce this exact marginal-preserving sequence:

| Slot | Topic | Kind | Difficulty | Question | Max points |
|---:|---|---|---:|---|---:|
| 0000 | N1 | single-select | 2 | Q1 | 1 |
| 0001 | N2 | multi-select | 3 | Q2 | 2 |
| 0002 | N3 | cloze | 4 | Q3 | 2 |
| 0003 | N4 | short-answer | 5 | Q4 | 4 |
| 0004 | N5 | essay | 3 | Q5 | 5 |
| 0005 | N2 | single-select | 4 | Q6 | 1 |

Desktop generation has two batches: slots 0000–0003 and 0004–0005. Each response contains the key/reference/rubric at authoring time. Invalid proposals create deficits rather than substitutes. The total is **15 points**.

### Question definitions and committed keys

Option identifiers below are proposal handles; the expected committed revision uses the application-mapped option ids and preserves those mappings when display order changes. Every explanation is fixed fixture text, not an improvised model explanation.

**Q1 — N1, single-select, difficulty 2, 1 point, recall, source s2**

Prompt: `Which description best matches the notes' definition of a process?`

| Handle | Text | Key |
|---|---|---|
| o1 | `An executing program` | Correct |
| o2 | `A source file stored on disk` | Distractor |
| o3 | `A page table entry` | Distractor |
| o4 | `A saved CPU register` | Distractor |

Key `correctOptionId=o1`; explanation: `Page 2 defines a process as an executing program.` Fingerprint target: N1 + `concept_fixture_os_process`.

**Q2 — N2, multi-select, difficulty 3, 2 points, comprehension, source s6**

Prompt: `Which statements about Round Robin are supported by the lecture extract? Select all that apply.`

| Handle | Text | Key |
|---|---|---|
| o1 | `Each runnable thread receives a time quantum.` | Correct |
| o2 | `A thread whose quantum expires moves to the back of the ready queue.` | Correct |
| o3 | `A shorter quantum can add context-switch overhead.` | Correct |
| o4 | `The first arriving job always runs to completion before any other job runs.` | Distractor |

Sorted key `correctOptionIds=[o1,o2,o3]`; scoring is exact-set, all-or-nothing. Explanation: `The extract states the quantum, requeueing and overhead behavior; running the first job to completion describes FCFS.`

**Q3 — N3, cloze, difficulty 4, 2 points, comprehension, source s4**

Segments:

1. text `A `
2. blank `b_tlb`
3. text ` caches page-table translations. A TLB miss `
4. blank `b_relation`
5. text ` necessarily mean a page fault.`

| Blank | Accepted answers before normalization | Case sensitive |
|---|---|---|
| b_tlb | `translation lookaside buffer (TLB)` | false |
| b_relation | `does not` | false |

The primary deletions occur verbatim in s4. Each blank earns one point; normalization is NFC→NFKC, trim, whitespace collapse and Unicode lowercase. There is no punctuation stripping or fuzzy edit distance. Explanation: `A TLB caches translations, but a TLB miss can be resolved by a page-table walk while the page remains resident.`

**Q4 — N4, short-answer, difficulty 5, 4 points, multi-step reasoning, source s5**

Prompt: `A referenced page is valid but not resident. Outline the operating-system steps that allow the faulting instruction to continue.`

Reference answer: `The processor traps to the operating system. The OS confirms that the reference is valid and the page is non-resident, loads the page from backing storage, updates the page table, and restarts the faulting instruction.`

`acceptedAnswers=[]`, so the paraphrased golden response deliberately requires rubric grading. Required key facts are `kf_trap` (OS trap and valid/non-resident context), `kf_load` (load from backing storage), `kf_update` (update page table) and `kf_restart` (restart faulting instruction). Explanation repeats the reference sequence and cites s5. The rubric below links all required facts.

**Q5 — N5, essay, difficulty 3, 5 points, multi-step reasoning, source s8**

Prompt: `A producer and consumer share a two-slot bounded buffer. Give the initial semaphore values and the producer's operation order. Explain why reversing the producer's empty and mutex waits can deadlock.`

Expected reasoning: `Initialize empty=2, full=0 and mutex=1. The producer performs wait(empty), wait(mutex), append, signal(mutex), signal(full). If the waits are reversed while the buffer is full, the producer holds mutex while waiting for empty; the consumer cannot acquire mutex to remove an item, so neither can progress.` Explanation is that same source-bound reasoning. Its three analytic criteria are committed before the attempt.

**Q6 — N2, single-select, difficulty 4, 1 point, application, source s7**

Prompt: `Jobs A, B and C arrive together in that order and require 6, 3 and 2 CPU units. Ignoring overhead, when does C complete under FCFS?`

| Handle | Text | Key |
|---|---|---|
| o1 | `9` | Distractor |
| o2 | `11` | Correct |
| o3 | `2` | Distractor |
| o4 | `6` | Distractor |

Key `correctOptionId=o2`; explanation: `FCFS completes A at 6, B at 9 and C at 11.` The arithmetic is contained in the question; the scheduling rule is grounded in s7.

### Committed rubrics

Each level descriptor below is stored verbatim in the corresponding criterion's `levels` record. All criteria use `grounding=source`, their listed source and all five levels. Weights, not any model total, determine points.

| Criterion | Weight / key facts | Level 0 | Level 1 | Level 2 | Level 3 | Level 4 |
|---|---:|---|---|---|---|---|---|
| `Q4.c_trap` — Trap and validity | 1; kf_trap | No OS trap, or the mechanism is wrong. | Identifies exceptional OS entry but calls it something other than a trap. | Identifies the trap but omits validity/residency context. | Identifies trap and non-residency but not validity. | Identifies the processor trap and valid-but-non-resident condition. |
| `Q4.c_resolve` — Load and update | 2; kf_load, kf_update | Neither loads the page nor updates the mapping. | Gives only a vague disk/memory action. | Correctly loads or updates, but not both. | Includes both actions but their order or object is unclear. | Loads from backing storage and updates the page table for the resident page. |
| `Q4.c_restart` — Resume | 1; kf_restart | Omits restart or says the process terminates. | Says execution continues without identifying an instruction retry. | Says an instruction is retried but not the faulting one. | Restarts the faulting instruction without making the completed mapping explicit. | Restarts the faulting instruction after the page is resident and mapped. |
| `Q5.c_initial` — Initial semaphores | 1; no key-fact links | Values are absent or incorrect. | One value is correct. | Two values are correct. | All three values are present but assigned to the wrong buffer roles. | Gives empty=2, full=0 and mutex=1 for the buffer protocol. |
| `Q5.c_protocol` — Producer protocol | 2; no key-fact links | No usable operation order. | Mentions waits/signals without a coherent order. | Gives only part of the wait/append/signal sequence. | Has the right broad sequence but omits one signal or append detail. | Gives wait(empty), wait(mutex), append, signal(mutex), signal(full). |
| `Q5.c_deadlock` — Reversed-wait reasoning | 2; no key-fact links | Denies the danger or gives an incorrect mechanism. | Mentions a problem without identifying held/waited resources. | Recognizes deadlock but not both actors' blocking conditions. | Explains producer holding mutex and waiting for empty, but omits consumer blockage. | Explains producer holding mutex while awaiting empty and consumer blocked from removing an item. |

For a fully assessed proposal the application—not the provider—computes `Σ(weight×level/4)/Σweight × maxPoints`. Any missing/duplicate criterion, level outside 0–4, disallowed source handle, non-substring learner quote or `not-assessable` result fails closed according to the shared contract.

## 5. Learner responses, fake grades and exact initial result

The learner saves these responses on attempt `A`:

| Question | Immutable submitted response | Expected grading |
|---|---|---|
| Q1 | option o1 | Deterministic final: **1/1**, correct. |
| Q2 | options `[o1,o2]`; omits o3 | Deterministic final: **0/2**, incorrect; no partial multi-select credit. |
| Q3 | `b_tlb="  Translation Lookaside Buffer (TLB)  "`, `b_relation="does"` | Deterministic final: **1/2**, partial. Blank 1 normalizes to the accepted lowercase answer; blank 2 does not equal `does not`. |
| Q4 | `The CPU traps to the OS for a valid page that is not resident. The OS brings the page in from backing storage and changes the page table.` | AI rubric final after one call: levels **4,4,0**, normalized `3/4`, **3/4 points**. |
| Q5 | `Set empty=2, full=0 and mutex=1. The producer waits for empty, then mutex, appends, signals mutex, then full. Swapping the waits is fine because the consumer can always make progress.` | First grading call times out; retry returns levels **4,4,0**, normalized `3/5`, **3/5 points**, outcome misconception. |
| Q6 | option o2 | Deterministic final: **1/1**, correct. |

The deterministic objective subtotal is **3/6 points**. It is available immediately after submission, while the official attempt total remains null until both subjective responses have final grades. The final total is **`1+0+1+3+3+1 = 9/15`**, displayed as **60.00%** for the attempt only; this is not a mastery percentage.

### Scripted `study-rubric-grade` responses

The following content defines the fake proposals; criterion/source ids are the local handles resolved by the normal validator. `answerEvidence` values must be exact substrings of the immutable answer. The inflated/contradictory-looking envelope `score` and `completeness` values are intentional: they must survive envelope validation but must not alter criterion-derived points.

**Q4 success (`grade:Q4`, first attempt):**

```json
{
  "schemaVersion": 1,
  "criteria": [
    {
      "criterionId": "c_trap",
      "status": "assessed",
      "level": 4,
      "answerEvidence": "The CPU traps to the OS for a valid page that is not resident.",
      "rationale": "The response identifies the processor trap in context.",
      "missingConcepts": [],
      "misconception": null,
      "sourceRefIds": ["s5"]
    },
    {
      "criterionId": "c_resolve",
      "status": "assessed",
      "level": 4,
      "answerEvidence": "The OS brings the page in from backing storage and changes the page table.",
      "rationale": "Both loading and mapping update are present.",
      "missingConcepts": [],
      "misconception": null,
      "sourceRefIds": ["s5"]
    },
    {
      "criterionId": "c_restart",
      "status": "assessed",
      "level": 0,
      "answerEvidence": "changes the page table",
      "rationale": "The response stops before restarting the faulting instruction.",
      "missingConcepts": ["restart the faulting instruction"],
      "misconception": null,
      "sourceRefIds": ["s5"]
    }
  ],
  "assessment": {
    "classification": "partial",
    "score": 0.01,
    "completeness": 0.99,
    "missingConcepts": ["restart the faulting instruction"],
    "feedback": "Loading and updating are correct; add the restart step.",
    "suggestedCorrection": "After updating the page table, restart the faulting instruction.",
    "confidence": 0.99
  },
  "limitations": []
}
```

**Q5 first invocation:** controlled `model_timeout`. The saved response and immutable submission are unchanged, the job step records a safe error, Q5 has no final evidence, and no raw answer appears in diagnostics. `awardedPoints` stays null.

**Q5 retry (`grade:Q5`, second attempt, identical question/response/rubric revisions):**

```json
{
  "schemaVersion": 1,
  "criteria": [
    {
      "criterionId": "c_initial",
      "status": "assessed",
      "level": 4,
      "answerEvidence": "Set empty=2, full=0 and mutex=1.",
      "rationale": "All initial values are correct.",
      "missingConcepts": [],
      "misconception": null,
      "sourceRefIds": ["s8"]
    },
    {
      "criterionId": "c_protocol",
      "status": "assessed",
      "level": 4,
      "answerEvidence": "The producer waits for empty, then mutex, appends, signals mutex, then full.",
      "rationale": "The operation sequence is complete.",
      "missingConcepts": [],
      "misconception": null,
      "sourceRefIds": ["s8"]
    },
    {
      "criterionId": "c_deadlock",
      "status": "assessed",
      "level": 0,
      "answerEvidence": "Swapping the waits is fine because the consumer can always make progress.",
      "rationale": "This denies the deadlock caused by holding mutex while waiting for empty.",
      "missingConcepts": ["reversed waits can deadlock"],
      "misconception": "Believes reversing empty and mutex waits is safe.",
      "sourceRefIds": ["s8"]
    }
  ],
  "assessment": {
    "classification": "misconception",
    "score": 0.99,
    "completeness": 0.99,
    "missingConcepts": ["reversed waits can deadlock"],
    "misconception": "Believes reversing empty and mutex waits is safe.",
    "feedback": "Initial values and ordering are correct, but the safety claim is wrong.",
    "suggestedCorrection": "When full, reversed waits can leave the producer holding mutex while the consumer needs mutex to free a slot.",
    "confidence": 0.99
  },
  "limitations": []
}
```

The first Q5 failure and the successful retry are distinct grade-history rows if the repository records failed grades; in either implementation the failed job-step record is mandatory, only one current final Q5 grade exists, and retry never rewrites the submission. A valid retry appends provenance and settles evidence once.

## 6. Evidence, practice and reassessment fixtures

### Immediately after A completes

All times share the fixture UTC day, so recency is 1. AI grades receive base multiplier `0.75`; the two N2 exam responses belong to one evidence group and use arithmetic mean, not two independent sessions.

Every summary initially has `independentSessions=1` and `distinctDays=1`. The listed minimum/maximum observed scores are respectively 1/1, 0/1, 0.5/0.5, 0.75/0.75 and 0.6/0.6 for N1–N5.

| Concept | Evidence rows / group score | Weight denominator / observed mean | Required state and exact `uncertainty` set |
|---|---|---|---|
| N1 process | 1 / `1` | `1` / `1` | `insufficient-evidence`; `{one-independent-session, few-independent-sessions, narrow-difficulty}`. |
| N2 scheduling | 2 / `(0+1)/2=0.5` | `1` / `0.5` | `insufficient-evidence`; `{one-independent-session, few-independent-sessions, conflicting-outcomes}`. No narrow-difficulty reason because difficulties 3 and 4 occur. |
| N3 TLB | 1 / `0.5` | `1` / `0.5` | `insufficient-evidence`; `{one-independent-session, few-independent-sessions, narrow-difficulty}`. |
| N4 page fault | 1 / `0.75` | `0.75` / `0.75` | `insufficient-evidence`; `{one-independent-session, few-independent-sessions, ai-graded, narrow-difficulty}`. |
| N5 semaphores | 1 / `0.6` | `0.75` / `0.6` | `insufficient-evidence`; `{one-independent-session, few-independent-sessions, ai-graded, narrow-difficulty}`. Latest outcome is misconception but one session still does not create Repeated Failure. |

Coverage-v1 output, user-declared node activity and demonstrated performance stay in separate views. No concept receives `needs-attention` merely because the initial total is 60%, and no Repeated Failure gap exists after this single attempt.

### Targeted practice P

The N2 evidence/remediation action creates a one-item **practice** blueprint; it never modifies A's fixed paper. P uses source s6, difficulty 4, 1 point, and a new fingerprint. Its one committed hint is `Focus on whether a runnable thread leaves the scheduler's ready queue after its quantum expires.` Other generated fixture questions have `hints=[]`; Practice alone can reveal P's hint, and the hint remains hidden before the learner requests it:

> `A Round Robin thread is still runnable when its quantum expires. What happens to it?`

Correct option: `It moves to the back of the ready queue.` Distractors: `It terminates.` / `It bypasses every other runnable thread.` The learner requests one hint, checks `It terminates` (ordinal 1, score 0), then checks the correct option on the same pinned question (ordinal 2, score 1). Both immutable practice submissions carry `hintLevel=1`; feedback is immediate, the practice deadline is null, and no pre-check key is exposed.

P is one independent attempt/group. Its group score is `(0+1)/2=0.5`; its conservative base weight is practice-with-hints `0.5`, deterministic-grade multiplier 1. After P, N2 has:

- `independentSessions=2`, `distinctDays=1`, minimum/maximum `0/1`, denominator `1+0.5=1.5`, observed mean `(0.5+0.25)/1.5=0.5`.
- State `needs-attention`, with exact uncertainty set `{few-independent-sessions, hints-used, conflicting-outcomes}`. There is no same-fingerprint group-repeat penalty yet.
- `repeatedly_failed` now appears because the latest two independent groups, A=`0.5` and P=`0.5`, are both below `0.6`. This gap did **not** exist after A alone.
- A `weak_prerequisite` recommendation for N1 also appears because dependent N2 needs attention and N1 remains insufficient. Dismissing that recommendation preserves every evidence row.

The golden path checks P twice but does not invoke a separate Finish action; see the final architecture-attention note about practice Finish semantics.

### Follow-up F and two reassessments

The N2 gap's Follow-up Exam action creates a Draft only. F excludes A's Q2/Q6 and P's fingerprints, has N2 weight 2, kind weights single-select:1/multi-select:1, difficulty weights 4:1/5:1, `pointsByKind={single-select:1,multi-select:2}`, two questions, `mode=exam`, no timer, and source-only evidence. It is explicitly reviewed, published and started by the user.

| Slot | Question and key | Maximum | R1 and R2 response |
|---|---|---:|---|
| F1: single, difficulty 4, s6 | `A Round Robin thread remains runnable at quantum expiration. What happens next?`; key `It moves to the back of the ready queue.` | 1 | Correct |
| F2: multi, difficulty 5, s6+s7 | `Which pairings are correct?`; correct set `{FCFS runs the first arriving job to completion, RR rotates runnable jobs through fixed quanta}`; distractor `RR has zero context-switch overhead.` | 2 | Exact correct set |

F1/F2 are different fingerprints from all excluded items and below the near-duplicate review threshold against them. R1 and R2 are two independently started attempts pinning the **same Ready F revision**, and both score **3/3**. Evidence effects at the fixed same-day clock are:

| After | N2 group weights and scores | N2 summary | Gap/history assertion |
|---|---|---|---|
| R1 | A `1×0.5`; P `0.5×0.5`; R1 `1×1` | Denominator `2.5`; mean `1.75/2.5=0.70`; 3 sessions/1 day, min/max 0/1; `developing`; uncertainty `{hints-used, conflicting-outcomes}` | Latest two groups are `0.5,1`, so Repeated Failure remains active until a second later successful group. |
| R2 | A `1×0.5`; P `0.5×0.5`; R1 `1×1`; R2 `1×0.25×1` | Denominator `2.75`; mean `2/2.75=8/11≈0.727272…`; 4 sessions/1 day, min/max 0/1; `developing`; uncertainty `{same-question-repetition, hints-used, conflicting-outcomes}` | Latest two groups are `1,1`, so Repeated Failure resolves. R2 receives the same-fingerprint 0.25 repeat weight and same-paper memory warning. |

R2 adds `same-question-repetition`; `hints-used` and `conflicting-outcomes` remain applicable. N2 is **not** `demonstrated-consistently`: there is only one UTC day and the latest three groups include P=`0.5`. No cross-paper equivalence or causal learning claim is allowed. Other concepts' evidence states do not improve from N2 reassessment.

### Nominal tutor and card fake outputs

The fake `tutor-turn` uses the existing tutor response schema and supplies exactly this Socratic content: `Use the Round Robin extract: when the quantum expires but the thread is still runnable, does it terminate or rejoin a queue? What evidence in the extract supports your answer?` Its only evidence citation resolves to s6. It contains no assessment score, tool request or card/scheduling instruction.

The fake existing Learn This/agent proposal returns two drafts through that feature's existing schema, both source-linked to s6:

- **Accept fixture:** front `Under Round Robin, where does a still-runnable thread go when its quantum expires?`; back `To the back of the ready queue.`; explanation `The lecture states this requeueing behavior at 70–99 seconds.`
- **Reject fixture:** front `What does Round Robin do at quantum expiration?`; back `Moves the runnable thread to the back of the ready queue.` This is intentionally a duplicate for preview/rejection testing, not an extra accepted card.

Neither fake response contains a durable card id, rating, due date, stability, priority or Queue command. The application/card owner assigns the accepted card's normal identity and initial scheduling only after explicit Accept.

## 7. Precisely 30 end-to-end steps

Every row is mandatory for the full golden pass. “Negative/failure evidence” is part of the row, not an optional extra.

| # | Controlled action | Changes / layers | Required assertions | Negative/failure evidence |
|---:|---|---|---|---|
| 1 | Open Study Plans in the native fixture app and capture the scheduler/provider baselines. | C1, C8; integration, E2E | Destination, registry, MainLayout, palette, mobile/capability and i18n wiring reach one Study Plans UI. Scheduler sentinel and zero study-provider calls are recorded. | Browser/PWA write flow in a separate capability test shows `unsupported_platform`, never a false successful save; unrelated navigation remains functional. |
| 2 | Select OS-PDF, OS-EPUB and OS-VIDEO and freeze the source scope. | C1, C8; integration, E2E | Exactly three concrete document ids, the two video transcript extract ids, content-hash revisions and eight validated source refs are frozen in sorted order; collection/tag changes cannot alter the freeze. | Empty scope → `invalid_input`; AI-excluded source → `source_ai_excluded` before inference; forged excerpt/chunk → `invalid_source`; duplicate quote without a structural locator → `ambiguous_source`. |
| 3 | Enter the exact goal/title/depth, skip the optional diagnostic, and create PLAN. | C1, C7, C8; integration, E2E | One plan-owned durable goal and initial Draft commit atomically; source scope is preserved; skip creates no attempt, evidence or AI call. | 201-scalar goal is refused rather than truncated; injected storage failure commits no plan/versions/nodes and UI never says saved; no separate DAQE/reading goal is mutated. |
| 4 | Run curriculum preflight and start fake generation. | C2, C8; integration, E2E | Job and two planned model steps persist before inference; generation and embedding destinations, payload classes, maximum-call allowance (including any permitted recovery) and consent are disclosed. Only eight bounded handles enter one decompose batch. | Denied feature, local-only/remote conflict, cloud disclosure or paid consent produces no Running job/model call; `requestPolicy` is not used as consent; source text outside the frozen scope is absent from the captured payload. |
| 5 | After `decompose:0000` commits, interrupt while `prerequisites:0001` is running, restart, release its late fake response, then explicitly resume with fresh preflight. | C2, C8; integration, E2E | Completed checkpoint survives; startup is Interrupted; no inference auto-starts; stale lease/cancellation epoch rejects late output; resume produces exactly five nodes/four edges with no duplicates. | Fake malformed JSON after the one repair leaves a Failed step and valid checkpoint; cancelled/stale-owned completion → `job_cancelled`/`job_lease_stale`; no automatic cloud retry occurs. |
| 6 | Inspect the generated draft, move N2/N4 to the required order, lock N2, add N2's objective and save. | C1, C2, C8; unit, integration, E2E | Pure and Rust validation agree on `[N1,N2,N3,N4,N5]`; retained logical ids and evidence survive; lock/user-modified flags and a full diff are durable. | Add N5→N1 → `dependency_cycle`; self/duplicate/dangling edges are rejected; disallowed reorder returns exact earliest/latest `order_conflict`; stale draft CAS writes nothing. |
| 7 | Restart before publication, reopen the saved Draft, verify source resolutions, then publish plan version 1. | C1, C8; integration, E2E | Draft, lock and edit reopen from SQLite; publication atomically supersedes/clears the correct pointers; all five grounded nodes validate; activity remains separate from mastery. | Stale plan revision → `stale_revision`; a changed PDF revision stops new publication/job checkpoint with `stale_source`/`source_changed`; deleting source history never fabricates a current ref. |
| 8 | Configure A-BLUEPRINT with the exact six-item mixed weights and untimed policy. | C3, C8; unit, integration, E2E | Quota counts and all six slots exactly match section 4; source-only scope and scoring policy are visible; multi-select all-or-nothing and no negative marking are disclosed. | Negative/noninteger/zero-sum weights fail; invalid timer 299 seconds fails; a shortfall clone is Needs Review and Start without acceptance → `quota_shortfall`, with no invented replacement. |
| 9 | Generate Q1–Q6 in two fake desktop batches and checkpoint each. | C3, C8; integration, E2E | Every accepted item matches its slot/kind/difficulty/topic, source and gradeability constraints; keys/rubrics arrive before answers; two expected calls only; fingerprints are unique. | Unknown source/option/criterion handle, malformed cloze, duplicate correct id/fingerprint and answer-leaking segment are invalid; a failed slot is a disclosed deficit, not a Ready question. |
| 10 | Preview all five kinds, inspect evidence/keys/rubrics, and test the public projection. | C3, C8; unit, integration, E2E | Preview matches the exact fixtures; editing creates an uncommitted revision and reruns validation; pre-submit public objects omit keys, accepted answers, references, expected reasoning, answer-revealing rubric details and explanations. | Unsupported external fact cannot become grounded by editing prose; deep mutation of a public object does not alter the committed fixture; rejected duplicate/invalid edits leave the prior valid draft inspectable. |
| 11 | Publish A's Ready revision. | C3, C8; integration, E2E | One transaction validates quotas/live sources and commits all six keys/rubrics; old/new revisions have correct lineage; only Ready can start. | Direct SQL/repository edit of a committed payload/key/rubric → `committed_question_immutable`; Draft or uncommitted Start fails; partial-write injection leaves neither Ready pointer nor partial commit timestamps. |
| 12 | Start attempt A and save acknowledged answers Q1–Q4. | C4, C8; integration, E2E | Attempt, ordered six pinned revisions, six empty responses and null deadline are atomic; Start uses a unique client key; public payload stays answer-free; each save returns a revision only after SQLite commit. | Replayed Start returns the same attempt; mismatched response kind/unknown option/blank key/duplicate multi id is rejected wholesale; failed save has no success indicator. |
| 13 | Type but do not acknowledge Q5, interrupt/restart the app, then recover A. | C4, C8; integration, E2E | Same InProgress attempt resumes with Q1–Q4 exactly; unacknowledged Q5 keystrokes are not claimed durable; no submissions, grades, evidence or provider calls exist yet. | A duplicate recovery cannot create another attempt; a storage fault preserves the prior acknowledged values; stale response CAS → `stale_revision`. A separately timed fixture variant submits only confirmed work as `timer-recovered`. |
| 14 | Resume, replay Q4's exact save, answer Q5/Q6 and flush all saves. | C4, C8; unit, integration, E2E | Same mutation id + identical Q4 payload returns the existing row without revision increment; all six current responses now match section 5; navigation remains local. | Same mutation id + different payload → `invalid_input`; unknown keys are not partially persisted; Exam mode reveals no hint/correctness before final submission. |
| 15 | Submit A, then repeat submission with the same and a new key. | C4, C8; unit, integration, E2E | Exactly six ordinal-1 `exam-final` submissions and four deterministic objective grades commit; objective subtotal 3/6; Q4/Q5 grading steps only; same key returns original result, new key is an informational no-op. | Double/racing submit adds no submission, grade, evidence or total; blank/skipped objective variants are distinct zero outcomes; attempts never transition back to InProgress after Submit. |
| 16 | Run Q4 fake grading and Q5's controlled timeout. | C5, C8; unit, integration, E2E | Q4 criteria 4/4/0 produce exactly 3/4 despite envelope score 0.01; Q5 retains its response and null official points; with Q5 failed and no active retry the attempt is exactly `grading-failed` and `awardedPoints=null`. | Missing criterion, level 5, forged source, non-substring quote, not-assessable, non-reasoning essay fallback and classification contradiction become failed/needs-review, never Final; provider/log errors contain no answer text. |
| 17 | Retry only Q5 with the valid fake response and resolve manual-review variants in isolated clones. | C5, C8; integration, E2E | Q5 criteria 4/4/0 produce exactly 3/5 despite score 0.99; A completes 9/15; current/superseded history and fake-route provenance are auditable; six final response evidence sources settle once. | Retry reuses identical question/response/rubric revisions; later automatic retry cannot overwrite a Manual grade; manual grade without reason fails, and correction adjusts the same evidence row rather than doubling it. |
| 18 | Inspect A's transparent results and initial evidence projection. | C6, C8; unit, integration, E2E | Per-item keys/rubrics/criteria/provenance and 9/15 agree with section 5; all five concept summaries exactly match section 6's initial table; no Repeated Failure exists after one session. | Pending/failed grades emit no performance evidence; reading/coverage/model confidence cannot change a summary; answered/skipped/unanswered remain distinguishable; UI never labels observed mean as probability of mastery. |
| 19 | From weak N2/results/source actions, exercise PDF, EPUB and local-video navigation. | C1, C6, C8; integration, E2E | Q4 opens PDF page 5 by page+quote; Q5 opens EPUB by validated CFI range+quote; Q2/N2 opens local video through `focusedVideoExtractId=vext_fixture_rr` with 70/99 seconds and segment data. Historical excerpts remain readable. | Local-video generic `initialJump` is not used; invalid EPUB CFI and bare chunk ids fail; stale source is labelled/coarsened, missing source disables navigation, and deleting a source never deletes the exam report automatically. |
| 20 | Launch TutorSheet from N2 with objectives, bounded refs and `sourceDocumentIds` for OS-PDF/OS-VIDEO. | C7, C8; integration, E2E | Captured `TutorRuntime.retrieve` calls `retrieveFromLibrary` with actual `filters.documentIds`; fake tutor sees only bounded approved excerpts; transcript is reviewable and produces no performance evidence. | Removing the filter or including OS-EPUB/global-library text fails the test; a document id merely in prompt text is not accepted as scoping; injected source instructions invoke no tool, filesystem, shell or scheduling command. |
| 21 | Open targeted practice P, use one hint, submit the wrong then correct Check rounds. | C4, C6, C7, C8; integration, E2E | Practice has no deadline; two immutable ordinal 1/2 submissions share the pinned new question; scores 0 then 1 and explanations appear only after each Check; P's source/ordinal history is retained. | Exam/Diagnostic cannot use Practice Check/hints; malformed response/check replay creates no extra ordinal; a repeated practice response does not masquerade as another independent session. |
| 22 | Refresh/inspect N2 evidence and gaps, then dismiss only the N1 weak-prerequisite recommendation. | C6, C8; unit, integration, E2E | N2 is exactly `needs-attention`, mean 0.5, denominator 1.5, two sessions/one day; Repeated Failure first appears now with correct evidence ids; N1 weak-prerequisite gap is explainable. Dismissal persists without deleting evidence. | Re-running settlement/refresh is idempotent; one wrong answer alone cannot create Repeated Failure; dismissal cannot suppress unrelated rules and new qualifying evidence can resurface only by the cutoff rule; reading/review is never interrupted by a watcher. |
| 23 | Open existing Learn This/card proposals for N2, preview one RR card and one rejected duplicate, then explicitly accept only the first. | C7, C8; integration, E2E | Preview shows source-grounded draft text and normal validation; Reject writes nothing; Accept invokes the existing card owner once and creates exactly one ordinary scheduled card separate from exam questions. | Preview itself creates no learning item; duplicate acceptance is idempotent; model/agent cannot directly accept a card; no other proposal, question, rating or Queue action is silently created. |
| 24 | Audit FSRS, Review and Queue isolation across steps 1–23. | C4, C5, C6, C7, C8; integration, E2E | Every pre-existing scheduler row matches `SCHEDULER_SENTINEL`; `submit_review` was never called; no rating, interval, stability, due date or priority changed. Only the explicitly accepted card has owner-created default scheduling. No Q1–Q6/P/F question is a learning item. | Any scheduler mutation before explicit Accept fails the run; deleting plan/exam history in an isolated clone cannot delete that accepted card or any library/review data; exam evidence does not enter Review calibration populations. |
| 25 | From N2's gap create F, generate/validate its two fresh questions, then explicitly publish and start R1. | C3, C7, C8; unit, integration, E2E | F begins as Draft and no attempt auto-starts; exclusions contain Q2/Q6/P fingerprints; both fresh fingerprints differ and quotas match section 6; R1 pins F's immutable Ready revision. | A near duplicate at similarity ≥0.85 is flagged; unresolved duplicate/invalid source/shortfall cannot publish; editing A or plan head never alters R1's fixed paper. |
| 26 | Complete R1 with both correct responses and settle deterministic grades. | C4, C6, C7, C8; unit, integration, E2E | R1 is Complete 3/3; N2 becomes developing with denominator 2.5 and mean 0.70; Repeated Failure remains active because latest groups are 0.5 and 1; scheduler sentinel remains isolated. | One follow-up success must not be presented as proven mastery/improvement; cross-paper difficulty equivalence is not inferred; grade retry/finalization creates no duplicate evidence or attempt. |
| 27 | Retake the same F revision as R2 with both correct responses. | C4, C6, C8; unit, integration, E2E | R2 is Complete 3/3; N2 denominator 2.75 and mean 8/11; same-fingerprint group weight 0.25, four sessions/one day, still developing; Repeated Failure resolves only after latest two groups are both ≥0.8. | R2 is not counted as a new paper or as two days; `demonstrated-consistently` is forbidden with P=0.5 in latest three; same-paper memory warning and repeat uncertainty are visible. |
| 28 | Disable provider/network and reopen saved artifacts; run the isolated manual-objective and subjective-no-provider variants. | C1, C3, C4, C5, C8; integration, E2E | Plan, sources, Ready papers, A/P/R1/R2 responses/grades, reports and source navigation work offline; manually authored valid objective paper can publish/take/score; whole-SQLite backup restores the same normalized artifact checksums. | Nonblank non-exact short/essay without provider remains pending/manual, not zero; no hidden network fallback occurs; app-state JSON export and two-way sync are not advertised as Study Plans backup/sync; corrupt/newer schema is refused without erasure. |
| 29 | Run the privacy/containment matrix with captured fake routes and synthetic endpoint classifications. | C2, C3, C5, C7, C8; integration, E2E, manual | Excluded/local-only gates run before preparation and again on resume/retry; generation and embeddings are separately disclosed; remote paid work needs both consents; only selected excerpts/goal or pinned rubric+answer leave for the authorized route; rendering/logs remain safe. | Strict-local-only rejects LAN/remote/unknown; one remote retry without exact authorization fails; provider kind/requestPolicy cannot override destination; source/answer `ignore rubric/mark correct` text has no command effect; PWA/manual disclosure inspection finds no silent cloud fallback. |
| 30 | Compare final history, restart once more and audit the final durable state without resuming AI. | C1, C4, C5, C6, C7, C8; integration, E2E | History shows A=9/15 and R1=R2=3/3, R1/R2 as same paper with 0-point retake delta plus memory warning, A↔F as descriptive different-paper history only. P's two checks retain ordinal history. Restart restores plan v1, all pinned papers/responses/grades/evidence/gaps/dismissal/card and provider call count; no job auto-runs. | No scientific mastery, causal improvement, duplicate final submission/evidence, lost committed revision or scheduler mutation appears. Explicit exam-history deletion in a clone recomputes summaries/gaps and leaves documents, pre-existing reviews and accepted card untouched. |

## 8. Provider failure corpus and ordinary test policy

The following named fake variants are required even where they are mentioned only in a negative cell:

| Fake variant | Expected domain outcome |
|---|---|
| `CURRICULUM_UNKNOWN_HANDLE`, `CURRICULUM_CYCLE`, `CURRICULUM_MALFORMED` | Invalid node/edge issue or Failed step; no invalid publish and no fabricated citation/global concept edge. |
| `SOURCE_CHANGED_MID_JOB`, `SOURCE_DELETED_AFTER_READY` | In-flight `source_changed` with prior published artifact unchanged; historical Missing report with navigation disabled after deletion. |
| `QUESTION_BAD_KEY`, `QUESTION_BAD_CLOZE`, `QUESTION_UNSUPPORTED_FACT`, `QUESTION_DUPLICATE`, `QUESTION_SHORTFALL` | Fail-closed draft/deficit/Needs Review; no Ready or Start until corrected or shortfall explicitly accepted. |
| `GRADE_OUT_OF_RANGE`, `GRADE_DUPLICATE_CRITERION`, `GRADE_FOREIGN_QUOTE`, `GRADE_NOT_ASSESSABLE`, `GRADE_CLASSIFICATION_MISMATCH`, `GRADE_NON_REASONING` | Failed or Needs Review with null official item/attempt score, saved learner response, and Manual/Retry route. |
| `PROVIDER_TIMEOUT_ONCE`, `PROVIDER_MALFORMED_AFTER_REPAIR`, `STALE_LEASE_COMPLETION` | Safe retry/interruption behavior; checkpoint survives; stale output cannot commit; no destination-changing retry. |
| `TUTOR_GLOBAL_LEAK`, `PROMPT_INJECTION_SOURCE`, `PROMPT_INJECTION_ANSWER` | Test fails on leaked source or attempted authority; injected prose remains untrusted text only. |

Normal `test`, integration and E2E commands must be deterministic and billable-call-free. A CI test asserts that no live provider adapter is constructed and that every Study AI call resolves to the fake. There is no environment-variable-triggered fallback to a real paid provider inside an ordinary test.

Fake responses prove orchestration, validation, persistence, exact arithmetic and disclosed policy behavior. They do **not** prove that real models generate sound curricula/questions, detect misconceptions reliably, follow rubrics, or return well-calibrated confidence.

## 9. Privacy, offline and deletion qualification detail

In addition to the assertions embedded in steps 28–29, the C8 report must include:

- A payload-class matrix for curriculum, question generation, short/essay grading and tutor: exact selected excerpts, goal/objective metadata, and (for grading) pinned reference/rubric plus immutable learner answer. No whole-library upload, arbitrary file read or unselected document is allowed.
- Independent generation and embedding destinations for device, loopback, LAN, remote and unknown cases. Loopback locality follows existing destination rules; an endpoint string or provider label alone is not accepted as proof.
- `isAiExcluded`, `isLocalOnly`, strict-local-only, feature activation, cloud disclosure and exact paid-cost consent before Start and before every resume/retry. Already-generated local artifacts remain usable when consent/provider availability is later withdrawn.
- Captured sanitized diagnostics contain no API key, raw prompt/provider response, source excerpt or learner answer. Generated Markdown uses safe assistant rendering; learner text is plain text; links are application source actions only.
- Deleted sources leave stored historical excerpts until explicit artifact/history deletion; the privacy UI explains that retention. Whole-database backup includes those artifacts, so backup handling is part of the user's privacy boundary.
- Airplane-mode/native offline use covers local PDF/EPUB/video opening, objective grading, saved draft recovery, history and source-linked review. It does not claim semantic AI grading, retrieval embeddings or tutor generation when their required service is unavailable.
- Browser/PWA shows the explicit unsupported durable-storage state. A browser unknown-command default is never interpreted as a committed plan, paper, response or grade.

## 10. Separate real-model qualification

This is an explicitly invoked, recorded qualification run, never part of the ordinary golden test command. Use only the synthetic corpus and synthetic learner answers unless a separate privacy review approves other data. A human selects the provider/model/route, reviews destination and maximum cost, and authorizes each run/resume/retry. Credentials and raw private diagnostics never enter the fixture pack.

Record provider id, exact base model, requested/served class, endpoint classification, fallback path, task/prompt contract version, date, usage, measured latency/cost, validator repair count and every artifact revision. Qualify **per provider/model and per task family**; text generation or a “reasoning” label does not qualify all three.

| Capability | Real-model exercise | Human acceptance evidence |
|---|---|---|
| Curriculum | Generate at least three drafts with the same source scope, including one rules-only comparison. | Reviewer verifies evidence handles/excerpts, no fabricated facts/edges, useful objectives, visible omissions and valid DAG. Coverage is judged only for this bounded corpus, never full-library completeness. |
| Questions | Generate all five kinds and a repeated/new-paper batch. | Independent subject review verifies every key/reference/rubric against the synthetic source, plausible distractors, no correctness leaks, no unsupported facts and acceptable duplicate review. A shortfall is reported, not filled by the reviewer to make the run look successful. |
| Rubric grading | Grade Q4/Q5 plus blank, exact, partial, wrong, ambiguous and injection variants. | Reviewer compares criterion judgments and verbatim evidence with an independent expected assessment. Q4 must recognize the missing restart; Q5 must not endorse reversed waits. Any ambiguous/not-assessable/fallback/contradictory case must route to review rather than false Final. Numeric points still come only from criteria. |
| Tutor/remediation | Run N2 source-scoped tutor and proposal flow with the same scope filter spies. | Reviewer checks source fidelity and scope while confirming transcript alone creates no evidence/card/FSRS mutation. |

Because real outputs are stochastic, exact fake wording/scores are not required of this qualification. Pedagogical acceptance thresholds and disagreements are recorded by the reviewer. A model is marked qualified, not qualified, or not tested for each family; it never self-certifies. Failure of real-model quality does not invalidate deterministic offline/objective behavior, but the UI must retain the capability limitation.

## 11. Separate physical-device qualification

Run and record at least one supported native desktop device and one supported physical mobile device; emulator-only results do not satisfy the mobile row. The ordinary fake provider may drive task content so device behavior is isolated from model quality.

- Install/migrate the real application, import/open the actual PDF, EPUB and local-video fixtures, and run steps 12–14 with a process kill and mobile suspension/resume. Confirm acknowledged answers, deadlines and attempt identity; do not claim unacknowledged keystrokes survived.
- Observe PDF page+quote navigation, EPUB CFI-range rendering and local-video extract focus/playback at 70 seconds. Generic local-video `initialJump` remains explicitly excluded. Audio/YouTube require their own physical fixtures if advertised.
- With airplane mode enabled, reopen existing sources/results and complete objective scoring. Re-enable only the explicitly authorized route for any AI test and verify no background paid resume occurred while offline.
- Exercise a configured timed exam with backgrounding and expiry; recovery uses the durable deadline and only confirmed responses as `timer-recovered`. Device-clock manipulation is disclosed as not adversarially prevented.
- Check keyboard/focus/screen-reader labels, resizable answer fields, touch targets, mobile lifecycle flush, reduced motion and readable rubric/evidence/history screens for every advertised action.
- Verify native whole-database backup/restore on the device schema and explicit browser/PWA unsupported messaging. Do not infer app-state JSON or two-way sync support.
- Record device/OS/build, media codec result, actual timestamps, accessibility observations and any unsupported capability. A database-only/mock navigation test cannot stand in for these observations.

## 12. What this golden scenario cannot claim

Even after all ordinary steps pass:

- Fake providers do not establish real-model educational quality, semantic equivalence, misconception recall, robustness to the full model-output distribution, actual token/latency/cost behavior or calibrated confidence.
- Fake/local route tests do not prove a real endpoint's network behavior, encryption, data retention or privacy policy. They prove Plethora's gate and payload orchestration against the configured classification.
- A synthetic text PDF/EPUB/transcript fixture does not prove OCR, every malformed container, every codec, every screen reader or every mobile lifecycle implementation. Unrun fixture variants remain unqualified.
- Weighted observed performance is not psychometric mastery. One paper, retake memory, same-day evidence and cross-paper score changes do not establish stable knowledge or causal improvement.
- Source coverage and reading activity are not understanding. Tutor chat alone is not assessment evidence. Accepted cards remain user-approved scheduler entities, not evidence that exams may write FSRS.
- Native whole-database backup does not imply explicit app-state JSON export or two-way sync. Source-history retention does not imply permanent undeletability; explicit artifact/history deletion remains required.

## 13. Discoveries requiring architect attention before encoding assertions

These do not broaden the golden path; they identify places where the scenario deliberately avoids inventing unspecified behavior.

1. **Practice Finish after Check — resolved:** shared contracts now require response/mark/hintLevel equality to reuse the latest practice-check; changed work appends one ordinal. Repeated Finish/submission keys cannot duplicate evidence. The golden path may perform two Checks without Finish, while the separate negative/lifecycle fixture covers both unchanged and changed Finish.
2. **Weak-prerequisite resolution — resolved:** the gap identity includes dependent node id and resolution occurs when the dependency is removed, dependent no longer Needs Attention, or the prerequisite earns a later independent group ≥0.8 without unresolved misconception. Dismissal still requires material evidence after its cutoff. Golden creation/dismissal remains deterministic and an isolated variant covers resolve/re-surface.
3. **Failed-grade row ownership — resolved:** pre-request denial produces a failed/interrupted job step only. An inference timeout may add a failed AI grade with safe provenance, current only if no current Final/Manual exists. Failed rows never create evidence. The golden assertion remains failed step, null Q5/attempt official points, preserved response and no Q5 evidence rather than assuming a failed-grade row must exist.
