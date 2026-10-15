## Context

Currently, Document Q&A allows querying one or more documents. However, this feeds the entire document content (truncated to token limit) into the LLM context. There is no way to narrow down the context to a specific section (e.g., a single chapter or section heading) except by typing it manually or relying on semantic retrieval. We need a targeted `#` autocomplete trigger to select a specific section of the document.
In addition, we need a way to supplement the chatbot context with real-time web search results using a user-configured Brave Search API key.

## Goals / Non-Goals

**Goals:**
- Implement `#` trigger in Document Q&A to autocomplete and select a specific document section.
- Implement robust heading and TOC heuristic parser to split documents into sections.
- Store Brave Search API key securely in the OS keychain.
- Integrate Brave Search API to search the web and feed results into the LLM context.
- Add settings UI for Brave Search key configuration and testing.

**Non-Goals:**
- Creating a full search engine interface; we only need to inject search results into the LLM context.
- Indexing web results into the local database vector store.

## Decisions

### 1. Section Extraction Heuristics
We will implement an extractor in a frontend helper (e.g., `src/utils/sectionUtils.ts` or extending `src/utils/chapterUtils.ts`).
- First, look for standard Markdown headings: lines starting with `#` to `######`.
- Second, look for lines starting with numbers/hierarchical numbering: `1. `, `1.1 `, `Chapter X`, `Section Y`.
- Third, check if there's an explicit "Table of Contents" block and match those titles against document lines.
- Segment the document content: text between heading A and heading B belongs to section A.

### 2. Autocomplete Trigger (`#`) in Document Q&A
- Just like the `@` trigger, when the cursor follows `#`, show a dropdown.
- Retrieve the headings/sections of the active document.
- When selected, insert a token like `#{section-index}` or `#{Section Title}`.
- Replace `#{Section Title}` with a badge in `formatInputForDisplay` (e.g., `#Section Title`).
- In `handleSendMessage`, parse the token, load the corresponding section text, and send only that section text as the document context.

### 3. Brave Search Key Keychain Storage
We will update `set_api_key`, `get_masked_api_key`, and `remove_api_key` in `src-tauri/src/commands/ai.rs` to allow `"brave"` as a valid provider key.
This stores it securely in the OS keychain using `AIKeyStore`.

### 4. Brave Search API Integration in Rust
We will add a new Rust command `brave_web_search(query: String)` in `src-tauri/src/commands/ai.rs` (or a new file).
It fetches the key from keychain, queries `https://api.search.brave.com/res/v1/web/search?q=<query>`, parses the JSON, and returns structured search results.

### 5. Web Search Toggle in Document Q&A
- Add a "Web Search" button/toggle to the input bar in `DocumentQATab.tsx`.
- When enabled, `handleSendMessage` will first query `brave_web_search(query)` if the Brave API key is configured.
- It will format the search results as:
  ```
  Web Search Results:
  - Title: [Title](URL)
    Snippet: [Snippet]
  ```
  And prepend this to the user prompt or append to system prompt.

## Risks / Trade-offs

- **Section Size**: Some sections might be too large or too small.
  * *Mitigation*: We will truncate sections if they exceed the max tokens window, similar to the existing document truncation.
- **Brave API Rate Limits**: Brave free/basic API keys have rate limits.
  * *Mitigation*: We will only trigger search when web search is explicitly toggled ON by the user.
