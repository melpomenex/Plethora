## 1. Section Extraction Heuristics & Autocomplete UI

- [x] 1.1 Implement section extraction logic with fallback markdown and numeric heading heuristics in a utility module.
- [x] 1.2 Add `#` character trigger, autocomplete popup panel, and list filtering in `DocumentQATab.tsx`.
- [x] 1.3 Update `buildMultiDocumentContext` to extract and limit LLM context strictly to the selected section.

## 2. Brave Search backend commands

- [x] 2.1 Update key management commands (`set_api_key`, `get_masked_api_key`, `remove_api_key`) in Rust to support the `"brave"` provider.
- [x] 2.2 Implement the `brave_web_search` Tauri command in Rust to query the Brave Search API and return results.
- [x] 2.3 Register `brave_web_search` command in `src-tauri/src/lib.rs`.

## 3. Brave Settings & Web Search integration

- [x] 3.1 Update `src/components/settings/AISettings.tsx` to add Brave API key input, testing, and display masking.
- [x] 3.2 Add a Web Search toggle and status indicator in `DocumentQATab.tsx` query input area.
- [x] 3.3 Integrate Brave Search results into the prompt context in `handleSendMessage` in `DocumentQATab.tsx`.
