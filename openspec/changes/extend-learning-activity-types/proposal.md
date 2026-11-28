# Proposal: Extend Learning Activity Types

## Why

Plethora's Unified Learning Activity Runtime (`unify-learning-activity-runtime`) establishes a shared, resumable `LearningSession` lifecycle, but real mastery across diverse disciplines requires far more than plain reading and flashcard review. Mathematics depends on worked examples and proof/calculation drills; Computer Science requires code tracing and synthesis; Philosophy thrives on guided reading trails, Socratic dialogue, and argument mapping; Languages rely on dictation, shadowing, translation, and sentence mining; History & Literature combine primary-source reading with synthesis and rubric writing.

Without a typed, capability-negotiated `LearningActivityRegistry` and an explicit security extension boundary, adding new study modalities leads to ad-hoc UI tabs, inconsistent `learning_events` emissions, broken offline/mobile fallbacks, and dangerous privilege creep. This change standardizes a 13-type initial activity catalog, 5 declarative subject templates, capability negotiation, and a strict zero-arbitrary-execution security boundary for future extensions.

## What Changes

- **`LearningActivityRegistry` with Capability Negotiation:** Introduce a typed registry where every activity adapter declares an `ActivityTypeManifest` (capabilities, platform support, privacy policy, target competency dimensions, and lifecycle hooks) and negotiates runtime availability cleanly across desktop, mobile, PWA, offline, and no-AI environments.
- **13 Initial Activity Types:** Register and wire 13 first-party activity adapters covering reading, spaced repetition, extraction, guided trails, Socratic dialogue, formative checks, formal examinations, worked examples, problem-solving drills, read-only code tracing/synthesis, language production practice, synthesis/concept mapping, and exploratory Smart Feed digests.
- **5 Declarative Subject Templates:** Provide built-in subject blueprints (**Mathematics**, **Computer Science**, **Philosophy**, **Languages**, **History & Literature**) that configure recommended activity mixes, competency dimension weights, and default session structures for Learning Goals and Study Plans.
- **Explicit Security Extension Boundary:** Define and enforce a strict sandbox contract for future/third-party activity extensions: declarative manifests + sandboxed Web Worker / isolated iframe (`sandbox="allow-scripts"`, no `allow-same-origin`, no Tauri IPC), zero arbitrary native code execution via privileged Tauri commands, explicit capability grants, privacy redaction, and host-side schema validation of emitted `learning_events`.

## Capabilities

### New Capabilities

- `extensible-learning-activities`: Capability-negotiated `LearningActivityRegistry`, 13 first-party learning activity types, 5 declarative subject templates, and a sandboxed zero-native-exec extension security boundary.

### Modified Capabilities

- None (registers adapters into `unify-learning-activity-runtime` and exposes candidate metadata to `extend-daqe-learning-orchestration` via additive interfaces).

## Dependencies

- `unify-learning-state-and-events` (canonical `learning_events` contract)
- `unify-learning-activity-runtime` (shared `LearningSession` host & resumable state serialization)
- `establish-persistent-learner-model` (5 competency dimensions: `exposure`, `comprehension`, `retention`, `application`, `transfer`)
- `unify-learning-goals-and-study-plans` (goal/plan templates & activity assignment)
- `extend-daqe-learning-orchestration` (heterogeneous activity candidate providers)
- Existing canonical reader (`DocumentViewerWrapper.tsx`), FSRS-7 review, Study Trails, Examinations, and Language Practice modules.

## Non-Goals

- Executing arbitrary user- or plugin-supplied native binaries, shell commands, Python/Node subprocesses, or unrestricted Tauri commands for coding exercises or extensions.
- Building a third-party plugin marketplace or remote extension auto-updater in this phase.
- Duplicating the canonical `DocumentViewerWrapper` reader for reading-based activities.

## Privacy & Security

- **Zero Arbitrary Code Execution:** Privileged Tauri commands MUST NEVER execute untrusted code, shell strings, or arbitrary scripts on behalf of `code_tracing_and_synthesis` or any activity extension. Code tracing/synthesis operates on static analysis, structured trace tables, and read-only rubric/AST checks (or optional sandboxed WASM/Worker with zero host I/O).
- **Sandboxed Extension Boundary:** Any future external activity extension runs inside an isolated Web Worker or iframe (`sandbox="allow-scripts"`, omitting `allow-same-origin` and all Tauri `invoke` bridges) communicating exclusively via a typed `postMessage` capability protocol with payload size and rate limits.
- **Privacy Redaction:** Documents marked `isLocalOnly` or `isAiExcluded` are enforced by capability negotiation (`privacyPolicy`): AI-dependent activities degrade to deterministic alternatives or hide AI steps, and untrusted extensions NEVER receive content from `isLocalOnly` or `isAiExcluded` documents.
- **Canonical Event Validation:** Only the host runtime writes `learning_events` after validating adapter-emitted event payloads against strict schemas; extensions cannot forge formal exam grades or alter FSRS-7 intervals directly.

## Migration & Backward Compatibility

- Purely additive TypeScript registry and declarative templates; zero destructive SQLite schema changes.
- Existing reading, review, guided trail, language practice, and exam workflows continue to work identically via their legacy entry points while also participating in unified `LearningSession`s through their registered adapters.

## Performance

- Activity adapter UI surfaces MUST be dynamically imported (`React.lazy` / chunk-split) so registering 13 activity types does not bloat the initial bundle or violate `scripts/bundle-budgets.json`.
- Registry lookup and capability negotiation MUST complete in `< 2 ms` for all 13 built-in adapters.
- Subject templates are static JSON/TS descriptors loaded on demand when creating or customizing a Learning Goal.

## Rollback / Recovery

- Individual activity types can be disabled via registry feature flags without affecting `LearningSession` persistence; if a persisted session references an unavailable activity type, the runtime skips or offers a safe fallback adapter without crashing.
- Removing or disabling subject templates leaves existing `learning_goals` and `study_plans` intact because template parameters are copied into goal configuration at creation time.

## Impact

- **Frontend Registry & Adapters:** `src/lib/activities/registry.ts`, `src/lib/activities/capabilities.ts`, `src/lib/activities/sandboxBridge.ts`, `src/lib/activities/adapters/*` (13 adapters), `src/lib/activities/templates/*` (5 subject templates).
- **Runtime & DAQE Integration:** `src/lib/sessions/` (adapter launch & resume delegation), `src/stores/daqeRankingClient.ts` (activity metadata for candidate providers).
- **Backend Validation:** `src-tauri/src/commands/learning_events.rs` (activity type allow-list / schema validation on event ingestion).
