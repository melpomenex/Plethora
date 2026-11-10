## Why

The AI Learning Agent is a core capability of Plethora, enabling users to generate flashcards, explore related material, and synthesize conceptual relationships. However, brittle tool argument validation currently causes the agent to abort when models pass natural parameter aliases (e.g., `query` or `search` instead of `topic`, screenshot 04), on-device models trigger unexplained safety blocks on standard medical study texts like Shingles (`safety_blocked`, screenshot 08), and flashcard batch creation encounters SQLite foreign key errors (code 787, orig_05). Hardening tool parameter normalization, safety degradation paths, and source lineage is vital for reliable study assistance.

## What Changes

- Implement robust tool parameter normalization in `readonly.ts` and `relationshipAdapter.ts` supporting common LLM parameter aliases (`topic`, `query`, `search`, `concept`, `text`) and stripping benign unexpected fields instead of aborting.
- Add intelligent safety degradation in `FmBridgeCore.swift` and `onDeviceAI.ts`: detect `safety_blocked` errors, display a user-friendly explanatory alert, and provide an automatic or one-click fallback to the secondary local model (Ollama) or authorized cloud provider.
- Validate and resolve document and extract foreign keys before executing batch card creation transactions, preventing SQLite 787 errors.
- Ensure pinned document sections and highlighted passages are strictly injected into the LLM system prompt context.
- Add Settings search coverage for AI safety fallback configuration (`setting-ai-safety-fallback`).

## Capabilities

### New Capabilities

- `ai-learning-actions-and-card-quality`: Resilient tool argument normalization, graceful safety block recovery, and verified source lineage for AI-generated study artifacts.

### Modified Capabilities

- `assistant-tool-reliability`: Resilient parameter parsing, partial-result recovery, and safe retry semantics.
- `settings-search-coverage`: Register AI safety fallback in the settings search catalog.

## Impact

- **Frontend**: `src/lib/ai/agent/tools/readonly.ts`, `src/lib/ai/agent/tools/relationshipAdapter.ts`, `src/lib/ai/agent/loop.ts`, `src/features/summary/useDocumentSummary.ts`.
- **Backend / Native**: `src-tauri/src/database/cards.rs`, `src-tauri/native/apple-ai/FmBridgeCore.swift`, `src-tauri/src/commands/ai.rs`.
- **Invariants**: Tool execution remains strictly bounded by token budgets and approved capabilities. On-device privacy preferences are strictly preserved unless cloud fallback is explicitly authorized.
