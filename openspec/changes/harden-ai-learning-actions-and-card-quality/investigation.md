# Technical Investigation: AI Learning Actions & Card Quality

## 1. Problem Evidence

1. **Screenshot 04**: The Learning Agent stopped with:
   `Error in learning_agent: topic parameter is required`
   The LLM called `get_related_material` but supplied the prompt using a synonym parameter name.
2. **Screenshot 08**: Summarizing text regarding Shingles symptoms caused Apple Intelligence (`FmBridgeCore.swift`) to return an unhandled guardrail rejection (`safety_blocked`), halting the feature.
3. **Screenshot 07**: Document summarization failure produced a generic error toast without troubleshooting options or provider failover.
4. **Orig_05**: Assistant Chat flashcard creation failed with SQLite code 787 (`FOREIGN KEY constraint failed`).
5. **Orig_12**: Pinned section context in the reader was dropped when invoking the Learning Agent.

## 2. Root Cause Analysis

1. **Rigid Tool Schemas (`src/lib/ai/agent/tools/readonly.ts:480`)**:
   `rejectUnknownParams(raw, ["topic"], "get_related_material")` immediately throws an error if any other parameter exists. LLMs frequently augment tool calls with reasoning or use `query`. This rigidness made the agent fragile.
2. **Apple Intelligence Guardrails (`src-tauri/native/apple-ai/FmBridgeCore.swift:184`)**:
   Apple Foundation Models have conservative guardrails around medical terminology (such as shingles or rash). `FmBridgeCore.swift` did not translate this into a structured fallback response, leaving the UI to interpret it as an unhandled exception.
3. **Schema Mapping Mismatch (`src-tauri/src/database/cards.rs:412`)**:
   The table `learning_items` requires `document_id TEXT NOT NULL REFERENCES documents(id)`. When an extract was targeted, the caller supplied `extract.id` into `document_id`. Since no document existed with that ID, SQLite threw error 787.

## 3. Remediation Strategy

- Implement parameter aliasing and permissive parsing for benign fields.
- Wrap native model errors in typed `safety_blocked` envelopes with actionable recovery UI.
- Resolve parent document UUIDs before creating extract-linked cards in SQLite.
