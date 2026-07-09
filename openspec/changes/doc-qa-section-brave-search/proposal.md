## Why

Currently, when users query documents in Document Q&A, the entire document (or a generic chunk) is sent to the LLM, which can be token-inefficient and lacks granular focus. Furthermore, the chatbot is restricted to document contents or local knowledge, without real-time web search capabilities to inform answers.

## What Changes

- **Section Focus in Q&A**: Introduce a `#` character trigger in the Document Q&A textarea that shows an autocomplete popup of all chapters/sections/headings in the active document. Selecting a section limits the context injected to only that specific section.
- **TOC and Heading Heuristics**: If the document has no explicit table of contents, parse its contents dynamically using markdown headings and numbering structures to extract sections.
- **Brave Search Integration**: Allow users to configure a Brave Search API key in Settings.
- **Web Search context injection**: When configured, allow the chatbot to perform real-time Brave Web Search queries based on the user's prompt (or automatic trigger) and feed web search results directly into the chatbot context.

## Capabilities

### New Capabilities
- `document-qa-section-focus`: Select document section with `#` trigger to feed only that section to the chatbot context.
- `brave-search-rag-context`: Configure Brave search key and query web results for better context in Document Q&A.

### Modified Capabilities
<!-- None -->

## Impact

- **Frontend**:
  - `src/components/tabs/DocumentQATab.tsx` (add `#` trigger, autocomplete panel, and update context builder).
  - `src/components/settings/AISettings.tsx` (add Brave API key input and test connection logic).
  - `src/api/ai.ts` (API methods for Brave key keychain storage and Brave search).
- **Backend (Tauri)**:
  - `src-tauri/src/commands/ai.rs` (update key storage commands to allow storing/retrieving the Brave search key).
  - Add a Tauri command or Rust backend implementation to query Brave Search API securely.
