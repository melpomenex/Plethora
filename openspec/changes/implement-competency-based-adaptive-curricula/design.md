# Design: Competency-Based Adaptive Curricula

## Context

Plethora's Study Plans already implement versioned plans with compare-and-swap (CAS) revision locks (`study_plan_repository.rs`), deterministic Kahn/MinHeap topological ordering (`src/lib/study-plans/topology.ts`), Sugiyama graph layout (`src/lib/study-plans/graph/layout.ts`), source validation (`src/lib/study-plans/sourceValidation.ts`), and guided reading range resolution (`src/lib/study-plans/reading/resolveReadingRange.ts`).

This design evolves Study Plans into competency-based adaptive curricula while reusing all existing canonical infrastructure (AD-01: no parallel curriculum subsystem).

## Goals / Non-Goals

### Goals
- Support 7 typed conceptual relationship kinds between curriculum nodes/concepts with explicit semantics for DAG ordering vs associative navigation.
- Persist provenance, confidence, uncertainty flags, and user corrections/bypasses on every relationship edge.
- Enforce strict acyclicity on `requires` edges while allowing non-blocking associative/contrastive/alternative relationships.
- Reuse verified 5-dimension competency projections from `establish-persistent-learner-model` (and optional diagnostic placement) to drive non-destructive adaptive progression (`demonstrated_prior`, `ready`, `recommended_next`, `bypassed`, `needs_grounding_repair`).
- Detect and recover from drifted or missing source anchors without hallucinating ungrounded content or violating `is_local_only` / `is_ai_excluded` privacy boundaries.

### Non-Goals
- Mutating FSRS-7 item intervals from curriculum progression changes.
- Auto-deleting nodes or historical study records when a learner skips ahead via prior evidence.
- Requiring cloud AI for curriculum adaptation, cycle validation, or grounding verification.

## Architecture & Domain Model

### 1. Rich Typed Conceptual Relationships

Every edge in a curriculum graph carries a `relationship_type` drawn from a closed 7-value taxonomy:

| `relationship_type` | Directed Semantics (`source -> target`) | Enforces Acyclicity? | Affects Prerequisite Gating? | Primary Use |
|---|---|---|---|---|
| `requires` | `target` requires prior understanding of `source` | **Yes (hard DAG invariant)** | Yes (soft/advisory if uncertain, bypassable always) | Topological ordering, readiness calculation, remediation prerequisite lookup |
| `builds_upon` | `target` deepens or extends `source` | No (warning on cycle) | Advisory ordering hint only | Scaffolded learning progression & concept lineage |
| `related_to` | Conceptual association between `source` and `target` | No | No | Lateral exploration & Knowledge Atlas links |
| `example_of` | `source` is a concrete instance/case of `target` | No | No | Application/comprehension scaffolding |
| `contrasts_with` | `source` and `target` highlight key distinctions or misconceptions | No | No | Discrimination practice & misconception repair |
| `applies` | `source` applies `target` in a practical context | No | No | Application/transfer activity routing |
| `alternative_explanation_of` | `source` explains `target` from another source/modality/level | No | No | Dimension-targeted remediation fallback when comprehension stalls |

### 2. Provenance, Uncertainty, and Non-Blocking Bypass

Every relationship edge stores:
- `provenance`: `'manual' | 'source_explicit' | 'ai_inferred' | 'imported'`
- `confidence`: `REAL` in `[0.0, 1.0]` (`1.0` for `manual` and `source_explicit` by default; model-supplied or calibrated score for `ai_inferred`)
- `is_uncertain`: `INTEGER` (`0 | 1`) — automatically `1` when `provenance = 'ai_inferred'` and `confidence < 0.75`, or when the source anchor cannot be verified.
- `evidence_anchor_json`: nullable JSON pointing to verified `(document_id, passage_hash, range_locator)` supporting why the relationship exists.
- `user_override_state`: `'none' | 'bypassed' | 'confirmed' | 'retyped' | 'rejected'`
- `bypass_reason`: nullable text recorded when the learner bypasses a prerequisite.
- `updated_at`: RFC-3339 timestamp.

**Non-Blocking Guarantee:**
- Even for a high-confidence `requires` edge, Plethora NEVER permanently locks a learner out of a node.
- High-confidence unmet `requires` edges render as an advisory prerequisite gate with a one-click **"Bypass prerequisite"** action (optionally capturing a reason such as "Already know this" or "Not needed for my goal") and **"Edit / Correct link"** action (confirm, retype to `builds_upon`/`related_to`, or reject/remove).
- Uncertain (`is_uncertain = 1`) AI-inferred `requires` edges NEVER gate progression at all; they render as a dashed advisory indicator ("Suggested prerequisite — uncertain") and allow immediate entry while offering one-click confirm/retype/dismiss.

### 3. Cycle Validation & Deterministic Graph Ordering

- `src/lib/study-plans/topology.ts` and `src-tauri/src/database/study_plan_repository.rs` validate cycles strictly over the active `requires` subgraph (excluding edges with `user_override_state = 'rejected'`).
- Attempting to insert or retype an edge into `requires` that introduces a cycle returns a structured `StudyResult` error (`CYCLE_DETECTED`) containing the exact cycle path of node IDs so the UI can highlight the conflicting loop.
- Non-`requires` edges (`builds_upon`, `related_to`, `example_of`, `contrasts_with`, `applies`, `alternative_explanation_of`) are permitted to form bidirectional or cyclic structures in the conceptual graph without invalidating topological order.
- Topological tie-breaking uses `builds_upon` as a secondary soft preference when `requires` in-degrees are equal, falling back to deterministic stable ordering (`position`, `id`).

### 4. Diagnostic Placement & Non-Destructive Adaptive Progression

Adaptive progression is computed as a **read-through overlay** combining:
1. The published Study Plan DAG (`requires` + `builds_upon` edges).
2. Canonical 5-dimension competency projections (`competency_projections` from `establish-persistent-learner-model`) mapped to each node's linked `concept_id`(s).
3. Optional diagnostic placement results (assessments with `purpose = 'diagnostic'` from `unify-assessment-evidence-and-remediation`).
4. Explicit learner overrides (`curriculum_node_overrides`: `manual_skip`, `manual_unskip`, `pinned_next`, `bypassed_prerequisites`).

**Node Readiness States:**
- `demonstrated_prior`: All linked concepts meet the curriculum's readiness threshold from verified prior evidence (e.g., comprehension & retention above configured threshold with `evidence_status = 'sufficient'`, never from page-view `exposure` alone or unverified `model-only` chats). The node is marked skippable/compactable; it is NEVER deleted and remains one click away for review.
- `ready`: All active non-uncertain `requires` prerequisites are either completed, `demonstrated_prior`, or learner-bypassed.
- `advisory_blocked`: One or more high-confidence `requires` prerequisites are unmet; learner can still enter via one-click bypass.
- `completed`: Learner completed the node in this plan/goal.
- `needs_grounding_repair`: One or more primary source anchors for the node failed verification.

**Optional Diagnostic Flow:**
- When starting a Study Plan or structured Learning Goal, Plethora checks for existing prior evidence first.
- If concepts have `insufficient-evidence` / `unknown` competency, Plethora MAY offer an **optional** short diagnostic ("Check what you already know — ~3 min") that the learner can dismiss immediately to start from the first node.
- Completing a diagnostic records `diagnostic` evidence into the canonical learner model and immediately recomputes the adaptive progression overlay.

### 5. Source-Grounding Verification & Recovery

Every source-grounded curriculum node and guided reading segment references `(document_id, anchor_locator, passage_fingerprint)`.
- On plan open, node launch, or source edit event, `sourceValidation.ts` + `resolveReadingRange.ts` verify:
  1. The `document_id` still exists and is accessible.
  2. The `anchor_locator` resolves to a valid range, or fuzzy re-anchoring via `passage_fingerprint` finds an exact/high-similarity match in the updated document.
- If exact resolution fails and fuzzy re-anchoring succeeds, Plethora updates the resolved range non-destructively and logs a grounding recovery event.
- If the source document was deleted or the passage no longer exists, the node transitions to `needs_grounding_repair` with three explicit recovery actions:
  1. **Re-anchor** to another passage in an existing local source.
  2. **Switch to an `alternative_explanation_of` source** already linked in the library.
  3. **Convert to ungrounded learner note** (explicitly labelled ungrounded; never silently fabricated as source-grounded).
- Privacy rule: `is_local_only` and `is_ai_excluded` documents are verified purely via local deterministic text/fingerprint matching and NEVER sent to cloud AI for re-anchoring.

## Database Schema (Migration `172_adaptive_curricula_and_remediation`)

Coordinated with `unify-assessment-evidence-and-remediation` in a single atomic SQLite migration `172_adaptive_curricula_and_remediation`:

1. **Extend curriculum relationship metadata** (additive columns on `study_plan_prerequisites` or new `curriculum_concept_edges` table synced with plan versions):
   - `relationship_type TEXT NOT NULL DEFAULT 'requires' CHECK (relationship_type IN ('requires','builds_upon','related_to','example_of','contrasts_with','applies','alternative_explanation_of'))`
   - `provenance TEXT NOT NULL DEFAULT 'imported' CHECK (provenance IN ('manual','source_explicit','ai_inferred','imported'))`
   - `confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0)`
   - `is_uncertain INTEGER NOT NULL DEFAULT 0`
   - `evidence_anchor_json TEXT`
   - `user_override_state TEXT NOT NULL DEFAULT 'none' CHECK (user_override_state IN ('none','bypassed','confirmed','retyped','rejected'))`
   - `bypass_reason TEXT`
   - `updated_at TEXT NOT NULL`
2. **New table `curriculum_node_overrides`**:
   - `id TEXT PRIMARY KEY`
   - `plan_id TEXT NOT NULL`
   - `node_id TEXT NOT NULL`
   - `override_kind TEXT NOT NULL CHECK (override_kind IN ('manual_skip','manual_unskip','pinned_next','grounding_converted'))`
   - `reason TEXT`
   - `created_at TEXT NOT NULL`
   - `updated_at TEXT NOT NULL`
   - `UNIQUE(plan_id, node_id, override_kind)`
3. **New table `curriculum_grounding_checks`**:
   - `id TEXT PRIMARY KEY`
   - `plan_id TEXT NOT NULL`
   - `node_id TEXT NOT NULL`
   - `source_document_id TEXT`
   - `status TEXT NOT NULL CHECK (status IN ('verified','reanchored','drifted','missing_source','converted_ungrounded'))`
   - `last_checked_at TEXT NOT NULL`
   - `detail_json TEXT`

All new tables include indexes on `(plan_id, node_id)` and register with `journal_entity` where sync-eligible, respecting `document_privacy.rs`.

## Risks & Trade-offs

- **Risk: Visual clutter in Study Plan Graph with 7 edge types.**
  - *Mitigation:* Default graph view shows `requires` (solid directed arrows, dashed if uncertain) and `builds_upon` (subtle secondary arrows), with a clean edge-layer filter toggle to reveal associative edges (`related_to`, `example_of`, `contrasts_with`, `applies`, `alternative_explanation_of`).
- **Risk: Over-eager adaptive skipping when learner only skimmed a document.**
  - *Mitigation:* `demonstrated_prior` strictly requires non-exposure competency evidence (`comprehension`, `retention`, or `application` above threshold with `sufficient` evidence status); page-view `exposure` alone NEVER triggers `demonstrated_prior`.
- **Risk: Dual TS/Rust drift on cycle detection.**
  - *Mitigation:* Shared test vectors verify identical `CYCLE_DETECTED` and topological ordering results between `src/lib/study-plans/topology.ts` and `src-tauri/src/database/study_plan_repository.rs`.
