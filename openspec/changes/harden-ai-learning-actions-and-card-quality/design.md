# Architectural Design: Harden AI Learning Actions & Card Quality

## Problem Diagnosis

### 1. Brittle Tool Parameter Validation
In `src/lib/ai/agent/tools/readonly.ts:479-483`:
```ts
const errors = [
  ...rejectUnknownParams(raw, ["topic"], "get_related_material"),
];
const topic = requireString(raw, "topic", errors, { maxLength: 400 });
if (errors.length > 0) return { ok: false, errors };
```
LLMs frequently call `get_related_material` with `{ "query": "..." }`, `{ "search": "..." }`, `{ "concept": "..." }`, or `{ "topic": "...", "context": "..." }`.
Because `rejectUnknownParams` rejects any key not in `["topic"]`, and `requireString` strictly demands the literal key `"topic"`, valid queries are rejected with:
`Error in learning_agent: topic parameter is required` (`screenshot_04`).

### 2. Apple Intelligence Medical Safety Blocking
In `src-tauri/native/apple-ai/FmBridgeCore.swift:184`:
When processing standard medical topics (such as varicella-zoster / shingles pathology, epidemiology, and symptoms), Apple Foundation Models frequently return an error classification `safety_blocked` or `guardrail_violation`.
Currently, this bubbles up as an uncaught failure toast in `useDocumentSummary.ts` (`screenshot_07`, `screenshot_08`), leaving the user stranded with no output and no explanation.

### 3. Flashcard Lineage & SQLite Foreign Key 787
When generating cards from an extract in Chat, the assistant tool historically passed the extract's UUID into the `document_id` field of `learning_items`. Because SQLite enforces `FOREIGN KEY (document_id) REFERENCES documents(id)`, the insertion threw code 787 (`FOREIGN KEY constraint failed`), aborting the entire batch.

## Architectural Solutions

### 1. Resilient Parameter Normalization
We replace rigid key requirements with an intelligent parameter normalizer:
```ts
export function extractStringParam(
  raw: Record<string, unknown>,
  canonicalName: string,
  aliases: readonly string[],
  errors: string[],
  options?: { maxLength?: number; required?: boolean }
): string | undefined {
  for (const key of [canonicalName, ...aliases]) {
    const val = raw[key];
    if (typeof val === "string" && val.trim().length > 0) {
      const trimmed = val.trim();
      if (options?.maxLength && trimmed.length > options.maxLength) {
        return trimmed.slice(0, options.maxLength);
      }
      return trimmed;
    }
  }
  if (options?.required) {
    errors.push(`${canonicalName} parameter is required (acceptable aliases: ${aliases.join(", ")})`);
  }
  return undefined;
}
```
In `get_related_material`, we accept `["query", "search", "concept", "term", "text"]` as valid aliases for `topic`, and ignore harmless auxiliary fields like `context` or `reasoning`.

### 2. Graceful Safety Fallback Architecture
We introduce a typed safety outcome in `onDeviceAI.ts`:
```ts
export type GenerationResult =
  | { status: "success"; text: string }
  | {
      status: "safety_blocked";
      provider: "apple-ai" | "ollama" | "cloud";
      reason: string;
      allowedFallbackProviders: string[];
    }
  | { status: "error"; error: string };
```
When `safety_blocked` is returned:
1. The assistant panel renders an educational notice:
   *"The on-device Apple Intelligence model declined to process this medical text due to built-in safety filters."*
2. An actionable action button is offered:
   *"Retry with Local Ollama"* or *"Retry with Plethora Cloud (Encrypted)"*.
3. If the user enabled automatic safety fallback in Settings, the agent automatically retries with the secondary provider without user intervention.

### 3. Canonical Lineage Resolution
Before inserting into `learning_items`:
1. Check if `source_id` is an extract ID.
2. If so, query `extracts.document_id` to resolve the root parent document UUID.
3. Populate `learning_items.document_id = parent_doc_id` and `learning_items.extract_id = extract_id`.
4. Wrap batch creation in a transaction that collects successes and reports specific failed indices, rather than aborting the entire batch.
