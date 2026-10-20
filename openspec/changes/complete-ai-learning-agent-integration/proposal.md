## Why

P0: the bounded learning agent exists but cannot be invoked through the production Assistant. Users need source-grounded learning proposals that remain editable and require approval before saving.

## Current Verified Behavior

At `615570ff`, `src/lib/ai/agent/loop.ts:226` exports `runAgentLoop`; repository-wide call-site search finds only agent tests. Bounds, task routing, read/proposal tools and sanitized traces exist. `AssistantPanel.tsx` has conversation-aware request guards and existing tool artifacts, but uses its separate Assistant tool execution path. `propose_link` is a not-available stub; card tools infer source document from global reader state. See [audited baseline](../../planning/ai-learning-completion-audit.md).

## What Changes

- Connect explicit Learning Agent mode and palette actions to the existing Assistant conversation and frozen source scope.
- Surface incremental tool progress, cancellation, citations and bounded partial results.
- Adapt agent candidates to existing preview/edit/validate/approve flows with verified per-candidate source references, duplicate checks and retry-safe persistence.
- Enforce `aiAgent`, provider readiness, endpoint-aware disclosure and billing consent before tool retrieval or generation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-learning-agent`: Assistant invocation, scope binding, proposal handoff and execution lifecycle requirements.

## Scope and Non-goals

Only connect and harden the existing constrained loop. No second chat store, autonomous writes, arbitrary MCP tool execution, scheduler changes or new agent framework. Relationship authoring remains unavailable until the knowledge-relationships change supplies its adapter.

## Impact

Users can request chapter/library cards, edit a subset and save them with source associations. Likely areas: `src/components/assistant/AssistantPanel.tsx`, `src/lib/ai/assistant/conversations/`, `src/lib/ai/agent/`, `src/components/learn/`, `src/commandPalette/registry.tsx`, learning-item/provenance APIs. No new runtime dependency.

## Dependencies

Land initialization task 1.1 and diagnostics task 1.1 contracts first; implementations need not wait for their Settings UIs. Link proposals have an optional dependency on knowledge task 3.4. See [program sequence](../../planning/ai-learning-completion-program.md).

## Compatibility Risks

Assistant legacy tools can write through different authorization paths; agent output must never enter that dispatcher. Static previews currently assume a single source passage; provenance and mixed cloze/batch failures need explicit handling before reuse. Conversation schema changes must preserve v2 records and never resume a run on hydration.

## Definition of Done

Assistant and palette entry tests prove generate → inspect → edit → approve selected → retrieve saved items and source locations. Cancellation, limits, malicious sources, unavailable models, duplicate candidates, multi-document provenance, conversation switches and failed persistence pass. Device/provider evidence remains the cross-platform change's release gate.
