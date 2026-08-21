## Context

Plethora (formerly Incrementum) is a desktop and mobile knowledge management and spaced repetition application built on Tauri 2.0 (Rust backend, SQLite database) and React 19 / TypeScript frontend.

### Existing Architecture & Problem Audit

During our codebase inspection, we discovered the exact origin of poor and nonsensical tag generation:

1. **The Legacy Heuristic**:
   Identical, rudimentary logic exists in two locations:
   - Rust backend: `suggest_auto_tags` in `src-tauri/src/commands/document.rs` (lines 62-85)
   - TypeScript browser backend: `suggestAutoTags` in `src/lib/browser-backend.ts` (lines 645-662)

   ```rust
   fn suggest_auto_tags(title: &str, content: &str) -> Vec<String> {
       let corpus = format!("{} {}", title.to_lowercase(), content.to_lowercase());
       let mut tags = Vec::new();
       let candidates = [
           ("math", vec!["equation", "theorem", "calculus", "algebra"]),
           ("history", vec!["century", "empire", "war", "revolution"]),
           ("biology", vec!["cell", "protein", "genome", "species"]),
           ("language", vec!["vocabulary", "grammar", "translation", "sentence"]),
           ("computer-science", vec!["algorithm", "compiler", "database", "programming"]),
       ];
       for (tag, keywords) in candidates {
           if keywords.iter().any(|keyword| corpus.contains(keyword)) {
               tags.push(tag.to_string());
           }
       }
       tags.push("auto-tagged".to_string());
       tags
   }
   ```

2. **Why False Positives Occur (Root Causes)**:
   - **Un-tokenized Substring Matching**: `corpus.contains(keyword)` searches for raw character sequences without word boundaries. For example:
     - `war` matches `software`, `hardware`, `warning`, `forward`, `award`, `reward`, `warm`, `towards` → falsely assigning `"history"`.
     - `cell` matches `cancellations`, `excellent`, `miscellaneous`, `cellphone` → falsely assigning `"biology"`.
     - `sentence` matches `death sentence`, `first sentence` → falsely assigning `"language"`.
   - **Single-Word Trigger on Ambiguous Terms**: A single occurrence of `"equation"` or `"function"` anywhere in a 400-page book or non-mathematical essay triggers `"math"`.
   - **Static 5-Tag Taxonomy**: The system only knows 5 hardcoded domains, none of which reflect the user's actual personal taxonomy.
   - **Unconditional Junk Tag**: Every document receives the `"auto-tagged"` string regardless of relevance.
   - **No Frequency / Statistical Scoring**: No TF-IDF, no stopword removal, no length normalization, and no domain co-occurrence evidence thresholds.

3. **Existing Ingestion Invocations**:
   - `import_document` (desktop file import for PDF, EPUB, Markdown, HTML, text) calls `suggest_auto_tags` at line 313.
   - `import_document_from_bytes` (mobile file import) delegates to `import_from_path`, calling `suggest_auto_tags`.
   - `persistWebArticleOutcome` (`src/stores/documentStore.ts:196`) assigns deterministic tags `["web-import", hostname]`.
   - `openTwitterThread` (`src/stores/documentStore.ts:1212`, `src-tauri/src/twitter.rs:1816`) assigns `["x", "twitter", "thread"]`.
   - `import_youtube_video` (`src-tauri/src/youtube.rs:1421`) assigns `["youtube", "video"]`.
   - `import_podcast_audio_file` (`src-tauri/src/commands/podcast.rs:824`) assigns `["podcast", "transcript"]`.
   - Kindle import (`src-tauri/src/kindle_clippings.rs:814`) assigns `["kindle-import"]`.

4. **Tag Storage & Representation**:
   - SQLite tables `documents.tags`, `extracts.tags`, and `learning_items.tags` store tags as JSON arrays of strings (`TEXT NOT NULL DEFAULT '[]'`).
   - The `tags` table (migration 048) stores tag entities with metadata for Tag-Aware Scheduling (TAS).
   - Cross-surface tag editing is unified via `src/lib/tagEditing/` (`addTag`, `removeTag`, `hasTag`, `ITEM_TAGS_UPDATED_EVENT`).

5. **AI Abstraction Infrastructure**:
   - Plethora provides a dual AI stack:
     - Rust: `AIProvider` enum in `src-tauri/src/ai/provider_wrapper.rs` (OpenAI, Anthropic, OpenRouter, DeepSeek, Ollama, and test Mock) and `src-tauri/src/commands/llm.rs`.
     - TypeScript: `src/lib/ai/` task layer (`runTask`, `AITaskDefinition`, `router.ts`, `onDeviceAI.ts` for Android Gemini Nano, `jsonRepair.ts`, and `containment.ts` with `<untrusted_source>` injection protection).

---

## Goals / Non-Goals

**Goals:**
- Provide a robust **Smart Tagging** system that is **ON by default** and works immediately without any user setup or AI keys.
- Implement a two-tier architecture: Tier 1 (local deterministic statistical baseline) + Tier 2 (LLM semantic refinement via configured providers).
- Eliminate all un-tokenized substring matching and false-positive bugs (e.g. `software` -> `history`, `cellphone` -> `biology`, single `equation` -> `math`).
- Strongly prefer the user's existing tag taxonomy over inventing synonyms.
- Automatically normalize and prevent semantic duplicate tags.
- Gate tag assignments on high confidence; prefer assigning 0 tags over assigning inaccurate tags.
- Execute asynchronously post-import so document ingestion is never delayed or failed by tagging.
- Preserve user-created tags as authoritative; manual organization is never automatically destroyed.
- Provide explainability reasons and per-item Retag actions in the UI and Command Palette.

**Non-Goals:**
- Requiring paid cloud providers or mandatory LLM configuration.
- Rewriting Plethora's entire tag storage format or forcing hierarchical tag migrations.
- Building a massive standalone knowledge graph.
- Sending user content to cloud providers without explicit user configuration and consent.
- Silently rewriting or destructive auto-merging of historical user libraries upon upgrade.

---

## Architecture & Data Flow

```text
                        Imported Document / Item
                                   │
                                   ▼
                   Extract Structured Document Text
                    (Title, Headings, TOC, Chunks)
                                   │
                                   ▼
                    Separate Deterministic Metadata
               (Format, Domain, Author, Publication Date)
                                   │
                                   ▼
                 Retrieve Candidate Tags from Library
                (Lexical, Co-occurrence, Popularity)
                                   │
                                   ▼
             ┌───────────────────────────────────────────┐
             │  Tier 1 Baseline Statistical Classifier   │
             │  - Word-boundary tokenization             │
             │  - Stopword filtering                     │
             │  - TF-IDF / BM25 term frequency scoring   │
             │  - Multi-term domain signature thresholds │
             │  - Candidate taxonomy alignment           │
             └─────────────────────┬─────────────────────┘
                                   │
                           Baseline Results
                                   │
                        Is LLM configured & ready?
                                   │
                    ┌──────────────┴──────────────┐
                   YES                            NO
                    │                             │
                    ▼                             │
    ┌───────────────────────────────┐             │
    │ Tier 2 LLM Semantic Task      │             │
    │ - Representative summary      │             │
    │ - Candidate tags in context   │             │
    │ - <untrusted_source> blocks   │             │
    │ - Strict JSON Schema parse    │             │
    │ - JSON repair salvage         │             │
    └───────────────┬───────────────┘             │
                    │                             │
              Refined Output                      │
                    │ (Fall back on error)        │
                    └──────────────┬──────────────┘
                                   ▼
                    Semantic Deduplication & Normalization
                    (Case, Hyphenation, Pluralization)
                                   ▼
                         Confidence Gate & Filter
                 (≥ 0.70 High Confidence, Bounded 3-8 tags)
                                   ▼
                     Persist Document Tags & Provenance
```

---

## Key Decisions

### Decision 1: Two-Tier Classification Architecture
- **Tier 1 (Baseline Local Classifier)**:
  - Implemented in Rust (`src-tauri/src/ai/smart_tagging/baseline.rs`) with a matching TypeScript fallback (`src/lib/smartTagging/baseline.ts`) for browser/PWA mode.
  - **Tokenization & Stopwords**: Splits text on unicode word boundaries and removes common English/multilingual stopwords.
  - **Term Frequency & Salience (TF-IDF / BM25)**: Evaluates term density across document title (weighted 5x), section headings/TOC (weighted 3x), and representative body chunks (weighted 1x).
  - **Multi-Term Domain Evidence Thresholds**: Rather than single-word triggers, broad subjects require composite evidence:
    - `Math`: Requires multiple co-occurring mathematical keywords (e.g. `calculus`, `differential equation`, `linear algebra`, `eigenvalue`, `theorem proof`, `integral`) OR strong title/heading evidence. A passing mention of `"function"` or `"average"` in a programming or history text scores < 0.20 and is rejected.
    - `Biology`: Requires cellular/biological context terms (e.g. `genome`, `protein synthesis`, `mitochondria`, `organism`, `cellular biology`), preventing false positives on `"cancellations"` or `"cellphone"`.
    - `History`: Tokenized word matching prevents matches on `"software"`, `"hardware"`, or `"warning"`. Requires historical framing (e.g. `dynasty`, `century bc`, `historical treaty`, `archaeological`).
    - `Computer Science`: Tokenized matches on algorithms, distributed systems, compilers, data structures, or programming paradigms.
  - **Open-Ended Topic Extraction**: In addition to predefined domain signatures, Tier 1 extracts prominent keyphrases (frequent capitalized noun phrases, repeated multi-word terms) and matches them against the user's existing taxonomy.

- **Tier 2 (LLM-Enhanced Semantic Refinement)**:
  - Uses Plethora's standard AI task framework (`src/lib/ai/tasks/definitions/smartTaggingTask.ts`).
  - System prompt instructs the model to act as a quiet knowledge librarian, prefer existing tags, avoid synonyms, reject incidental mentions, and return strict JSON.
  - Wrapped with `UNTRUSTED_CONTAINMENT_CLAUSE` and `<untrusted_source>` blocks.
  - Validated with Zod schema and sanitized via `jsonRepair.ts`.
  - Gracefully falls back to Tier 1 baseline on timeout, network failure, rate limit, or invalid response.

*Alternatives Considered*:
- *Heavyweight local embedding models (ONNX/BERT/Transformers)*: Rejected because bundling multi-hundred-megabyte model weights into the desktop/mobile app bloats installation size and battery usage. Tier 1 statistical classification is instantaneous, uses negligible RAM, and requires no external downloads.

### Decision 2: Prefer Existing User Taxonomy via Candidate Retrieval
- Before classification, the system queries the user's tag library (`SELECT DISTINCT name, item_count FROM tags`).
- Retrieves top 30 candidate tags based on:
  1. Lexical and n-gram overlap with the document title and headings.
  2. Co-occurrence with already detected keywords.
  3. Frequency and maturity in the user's library.
- The classifier evaluates incoming document concepts against these candidate tags first. If an incoming concept matches an existing tag (e.g. `Machine Learning`), that tag is reused rather than inventing a synonym (e.g. `AI / ML`).

### Decision 3: Semantic Duplicate Prevention & Normalization
- Canonicalization rules applied to all proposed tags:
  - Trim leading/trailing whitespace.
  - Case-insensitive comparison against existing tags (preserving the user's established display casing).
  - Punctuation and hyphenation normalization (e.g. `computer-science` maps to `Computer Science`).
  - Singular / plural normalization (e.g. `Operating Systems` maps to `Operating System` if the singular tag exists).

### Decision 4: Representative Context Assembly for Long Documents
- Never send full 500-page documents to an LLM.
- Build a compact semantic context (bounded to ≤ 3,000 tokens):
  - Document Title, Author, Category, and Format.
  - Table of Contents or Top-Level Headings.
  - Document Description / Abstract (if present in metadata).
  - First 1,500 characters of the document (preface / introduction).
  - Last 1,000 characters of the document (conclusion).
  - Top 20 extracted keywords from the Tier 1 statistical pass.

### Decision 5: Asynchronous Ingestion & Concurrency Control
- Document creation in `import_document` and `persistWebArticleOutcome` immediately returns the created document and updates the UI.
- Post-processing triggers a background job `smartTagDocument(documentId)` with a concurrency limiter (maximum 2 concurrent jobs).
- When classification finishes, it updates `documents.tags` and dispatches `ITEM_TAGS_UPDATED_EVENT`, updating UI chips seamlessly.

### Decision 6: Tag Provenance & Explainability
- Extend `DocumentMetadata` with a `smartTagDetails` structure:
  ```typescript
  export interface SmartTagDetail {
    tag: string;
    provenance: "manual" | "smart-local" | "smart-llm";
    confidence: number;
    reason: string;
    assignedAt: string;
  }
  ```
- Stored within the existing SQLite `documents.metadata` JSON column (non-breaking, zero schema migration risk).
- Authoritative manual tags: If a user manually adds or removes a tag, the action is flagged as `manual`. Automated re-tagging will never re-add a manually deleted tag or remove a manually added tag.

### Decision 7: Settings & Defaults
- In `src/types/settings.ts`:
  ```typescript
  export interface SmartTaggingSettings {
    enabled: boolean;              // default: true
    mode: "automatic" | "suggestions-only"; // default: "automatic"
    maxTagsPerDocument: number;    // default: 6 (clamped 1-12)
    preferExistingTags: boolean;   // default: true
  }
  ```
- In `src/stores/settingsStore.ts`: Default `documents.smartTagging.enabled = true`.
- In `src/components/settings/DocumentsSettings.tsx`: Clean toggle and controls.

---

## Structured Output Schema

The Tier 2 LLM task utilizes the following validated JSON schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "existingTags": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "tag": { "type": "string" },
          "confidence": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
          "reason": { "type": "string" }
        },
        "required": ["tag", "confidence", "reason"]
      }
    },
    "proposedNewTags": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "confidence": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
          "reason": { "type": "string" }
        },
        "required": ["name", "confidence", "reason"]
      }
    }
  },
  "required": ["existingTags", "proposedNewTags"]
}
```

---

## Risks / Trade-offs

- **[Risk] High-volume batch imports (e.g. dragging 100 PDFs) could exhaust system resources.**
  → *Mitigation*: The background queue uses bounded concurrency (max 2 workers) and debounced scheduling. Tier 1 executes in < 5ms per document; Tier 2 (LLM) is throttled.
- **[Risk] User manually removes a tag, but a subsequent retagging pass restores it.**
  → *Mitigation*: Removed tags are recorded in `metadata.smartTagDetails` with a `dismissed: true` tombstone to prevent unwanted re-application.
- **[Risk] Legacy databases have documents with `"auto-tagged"` and incorrect `"math"` tags.**
  → *Mitigation*: We do not alter user databases without consent. We provide a `"Clean up legacy auto-tags"` command and a per-document `"Retag this document"` action.
- **[Risk] Offline mobile device cannot reach cloud LLM.**
  → *Mitigation*: Smart Tagging seamlessly executes Tier 1 baseline locally; import never fails.

---

## Migration Plan

1. **Database Schema**: No destructive schema alterations. `documents.tags` remains `TEXT NOT NULL DEFAULT '[]'`. Tag provenance and reasons are stored in `documents.metadata.smartTagDetails`.
2. **Settings Upgrade**: Existing `settings.json` seamlessly merges default `smartTagging: { enabled: true, mode: 'automatic', ... }` via Zustand persist state migration.
3. **Legacy Clean-up Command**: Provide a safe Command Palette action `Clean up legacy auto-tags` that finds documents containing the legacy literal `"auto-tagged"` and offers one-click reanalysis using the new Smart Tagging engine.
