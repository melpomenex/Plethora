### Added

- **DeepSeek LLM provider** — DeepSeek (`deepseek-chat`, `deepseek-reasoner`) is now a selectable Assistant chat provider, routed through the existing OpenAI-compatible request path (the same approach used for Gemini). DeepSeek's automatic prompt-cache hit/miss token counts are surfaced end-to-end, and cache hits are priced at the discounted cache-read rate in the model picker.
- **Configurable flashcard generation count** — Flashcard Studio's chat generation previously always produced ~7 cards regardless of context size, and the extract auto-generation path silently discarded its count option. A new "Flashcard generation target" setting (a fixed count or auto/density-based, scaling with the size of the selected context) is surfaced in both the Studio and AI settings, and the resolved target is threaded through the chat system prompt and the Rust extract-generation path.

### Fixed & Improved

- **Accurate deck totals and state breakdown in Review Home** — Deck rows previously read "0 due" whenever nothing was currently due, indistinguishable from an empty deck. Stats are now computed from the full learning-item set (total/due/new/learning/review) via a shared `computeDeckStats` helper so the deck list and deck-picker modal always agree, and an explicit "No cards yet" state is rendered for empty decks.
- **Live model refresh surfaces real errors instead of silently falling back** — A failed live model refresh used to silently fall back to a stale hardcoded model list. It now surfaces the real error instead of masking it with an outdated list.
