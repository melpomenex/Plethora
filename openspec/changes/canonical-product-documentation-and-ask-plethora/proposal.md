# Canonical Product Documentation & "Ask Plethora" Contextual Help System

## Why

Plethora is a sophisticated, multi-platform learning operating system combining incremental reading, multi-algorithm spaced repetition (FSRS-6, SM-18, SM-20), multi-engine neural TTS, OCR, AI learning tools, RSS, podcasts, e-ink optimization, and cross-device sync. Today, product documentation is scattered across outdated handbooks, old spec proposals, and implementation-divergent markdown files. Users frequently encounter complex behaviors—such as interval calculations, queue reappearance rules, TTS auto-scrolling requirements, or e-ink contrast toggles—without an authoritative, in-app explanation of *how* or *why* the application behaves as it does.

Furthermore, conventional AI help systems suffer from major anti-patterns: blindly dumping entire manuals into LLM prompts, making expensive remote LLM calls for simple navigation or factual queries, hallucinating non-existent features, and exposing sensitive user documents to help prompts.

This initiative establishes Plethora as a self-explanatory application ("Plethora knows how Plethora works") through two foundational, interdependent pillars:
1. A **canonical, code-verified, machine-readable product knowledge base** with stable hierarchical feature identifiers, structured behavioral rules, platform parity matrices, failure modes, and safe action references.
2. A **cost-conscious, local-first "Ask Plethora" contextual help and explainability system** embedded directly into the Command Palette and contextual UI hooks, resolving queries deterministically without LLMs whenever possible, and using minimal grounded RAG only when natural-language synthesis genuinely adds value.

## What Changes

- **Canonical Product Documentation Corpus (`docs/product/`)**: Establish a structured, version-aware knowledge base covering all active features across reading, queue, scheduling algorithms, review, media, AI, sync, platforms, settings, and UI interactions. Every entry adheres to a strict schema with stable IDs (e.g., `tts.word_highlighting`, `queue.sm20.postpone`).
- **Code-Verified Documentation & Coverage Tooling**: Implement `scripts/docs-validate.mjs` and `scripts/docs-coverage.mjs` to enforce metadata schemas, detect broken cross-references, prevent duplicate IDs, verify allowlisted action IDs against code, and track code-to-doc coverage in CI.
- **Documentation Governance Lifecycle**: Integrate a "Documentation Impact" gate into the OpenSpec workflow and test suite so documentation never drifts from code during future development.
- **Command Palette Intent Routing**: Augment CommandCenter/CommandPalette with a zero-cost local classifier that deterministically categorizes inputs into navigation commands, direct documentation lookups, product-help questions, and document-content AI, supporting an optional explicit `?` prefix.
- **Local-First Hybrid Help Retrieval**: Build a local retrieval layer utilizing lexical search (FTS5/BM25), synonym/alias indexing, metadata filtering, lightweight vector embeddings (or on-device LiteRT/EmbeddingGemma), and contextual app state boosting.
- **Deterministic Zero-Inference Direct Answers**: Surface canonical summaries, exact step-by-step how-tos, and navigation shortcuts immediately without model invocation for common lookups ("Where is TTS speed?", "Open e-ink settings").
- **Grounded "Ask Plethora" AI Task (`askPlethoraTask`)**: Implement a bounded prompt task in `src/lib/ai/` that accepts only the top-k relevant doc chunks (budgeted to ≤1,500 tokens) and minimal structured app state. Strict system prompts and schema validation reject hallucination and honestly report undocumented features.
- **Safe Allowlisted UI Actions in Answers**: Help responses expose verified, typed application action buttons (`[Open E-ink Settings]`, `[Switch to SM-20]`). Generated text is strictly forbidden from invoking arbitrary commands.
- **Contextual "Why?" Explainability Engine**: Implement `useHelpAppContext` and context adapters across the reader, queue, review arena, and settings, allowing one-click contextual inquiries ("Why am I seeing this queue item?", "Why did TTS pause here?").
- **Strict Privacy & Isolation Boundary**: Isolate the product help knowledge base from untrusted user document text and user notes, preventing prompt injection and data exfiltration.
- **Offline & Zero-Config Graceful Degradation**: Ensure complete functionality of full-text documentation browsing, navigation shortcuts, and direct answers when offline or when no LLM provider is configured.

## Capabilities

### New Capabilities
- `canonical-product-documentation`: Authoritative, machine-readable product documentation corpus in `docs/product/` with strict YAML frontmatter, stable hierarchical feature IDs, behavioral rules, platform parity matrices, failure modes, troubleshooting guides, and safe action references.
- `doc-verification-and-coverage`: Automated validation and coverage test suite (`scripts/docs-validate.mjs`, `scripts/docs-coverage.mjs`, schema validation via JSON Schema/Zod, duplicate-ID detection, broken reference checking, registered action validation, CI performance gate).
- `documentation-lifecycle-governance`: Development workflow integration requiring "Documentation Impact" on changes/PRs, index invalidation on build/version changes, and strict no-drift CI checks.
- `ask-plethora-local-retrieval`: Deterministic multi-stage local retrieval engine combining fast lexical/alias search (SQLite FTS5 / BM25), semantic retrieval (local lightweight embedding / on-device LiteRT fallback), hierarchical feature-ID filtering, contextual app state boosting, and zero-inference direct answers.
- `ask-plethora-intent-routing`: Local deterministic intent classifier in CommandCenter/CommandPalette routing queries into navigation commands, direct documentation lookups, product-help questions, and document-content AI without mixing contexts.
- `ask-plethora-palette-ux`: Command Palette integrated UI (and optional explicit `?` prefix) with progressive loading, verified citation badges, interactive safe allowlisted UI action buttons, keyboard navigation, e-ink / high-contrast compliance, and developer diagnostic overlay.
- `ask-plethora-grounded-synthesis`: Bounded, prompt-injection-contained AI Task definition (`askPlethoraTask`) with strict grounding rules, multi-provider support (OpenAI, Anthropic, OpenRouter, Ollama, on-device Gemini Nano), token/resource budgeting, and response caching.
- `contextual-explainability-hooks`: Structured, privacy-preserving application state adapters (`useHelpAppContext`) and universal "Why?" contextual explainability hooks throughout Plethora (reader, queue, review arena, settings).

### Modified Capabilities
- `contextual-palette-actions`: Extended to support product help query resolution, direct answers, citation navigation, and safe UI action triggers directly from help results.

## Impact

- **Documentation**: New structured directory `docs/product/` containing ~200+ code-verified feature documents, taxonomy index, and concept maps.
- **Frontend Architecture**: New modules in `src/features/help/` (`helpRetrieval.ts`, `helpIntent.ts`, `helpContext.ts`, `helpCache.ts`, `HelpResultCard.tsx`, `HelpDevInspector.tsx`); updates to `src/components/search/CommandCenter.tsx`, `src/components/search/GlobalSearch.tsx`, and `src/components/common/CommandPalette.tsx`.
- **AI Task Architecture**: New task `src/lib/ai/tasks/definitions/askPlethoraTask.ts`, schema `src/lib/ai/schemas/askPlethoraAnswer.ts`, and cache manager `src/lib/ai/helpCache.ts`.
- **Backend / Database**: New SQLite virtual table `product_help_fts` in `src-tauri/src/database/` or pre-indexed search bundle generated during Vite build; new Tauri commands in `src-tauri/src/commands/help.rs` for local doc retrieval and offline indexing.
- **Build & CI**: New verification scripts `scripts/docs-validate.mjs` and `scripts/docs-coverage.mjs` wired into `npm run build:check` and GitHub Actions CI workflow.
- **Performance & Cost**: Strict zero-inference path for navigation/lookup queries; RAG prompt context capped at ≤1,500 doc tokens; local index initialization latency <25ms; index storage footprint <3MB.
