### Added

- **Neural review ("Go neural")** — an optional exploratory mode built on SuperMemo's spreading activation. While reading in Scroll Mode, click "Go neural" to build a fresh review sequence that spreads outward from the current document, card, or extract through five kinds of connections: concept groups (your tags), inter-element references, descendants, semantic similarity (via your RAG embeddings), and parent/siblings. Closer connections surface earlier; the queue refills automatically as you work through it. Exit returns you to exactly where you were — neural review never touches your priority queue or scheduling.
- **SuperMemo priority queue** — every document, extract, and card now sits in one ranked priority queue, just like SuperMemo. Priority is a *position*, not a stored value: setting 70% moves an item to the 70% mark of your collection, and the percentage shifts naturally as your library grows. Cards gain the same 0–100 priority control as documents, and the priority popup shows each element's live rank ("Position X of N"). Bulk-setting many items to the same percentage arranges them in order rather than creating ties.
- **Auto-postpone** — when outstanding material exceeds a session's capacity, the lowest-priority surplus is postponed automatically, with settings for the capacity, priority threshold, and difficulty bias.
- **Card search in the Documents view** — searching now returns matching flashcards in a "Cards" result group alongside documents, using the same query grammar (`text`, `tag:`). `tag:` matching is now substring-based, so `tag:occlusion` finds `image-occlusion`.
- **Maintained "Browser Extension" deck** — cards imported from the browser extension are now surfaced in the Deck Manager through an auto-maintained deck, with provenance tags preserved when moving cards between decks.
- **Composition sliders** — Scroll Mode composition is set with Documents / Extracts / Flashcards sliders instead of a single flashcard percentage, and the help text clarifies that sliders control *count* while priority controls *order*.
- **Scroll Mode keyboard shortcuts** — Space reveals a flashcard's answer; the 1–4 number keys rate the current item.
- **Performance benchmark gate** — a CI gate compares every benchmark suite against recorded baselines (anchor-normalized to survive runner-class differences) and enforces a bundle budget, guarding against silent regressions.

### Fixed & Improved

- **Scroll Mode skipped flashcards/extracts** — residual wheel momentum or a queued swipe event arriving after advancing onto a card would flash it and immediately skip it; flashcards and extracts now require an explicit rating or dismissal.
- **Dismissed documents reappeared in Scroll Mode** — Dismiss advanced the item but a later rebuild re-inserted it; the documents store is now patched immediately so the dismissed item stays gone.
- **"All flashcards sequentially" queue bug** — a flashcard-leaning filter no longer degrades Scroll Mode to sequential cards; the document pool is topped up from the wider store and ordered by priority.
- **`#` section index froze Scroll Mode on open** — the section-tree build now runs on first input focus instead of document open, so opening a large EPUB no longer stalls.
- **Enter did nothing in input modals** — the priority popup and other input-driven custom modals now confirm on Enter (Confirm dialogs stay click-only).
- **Dismissible "viewed this session" badge** — the Due Today progress badge can now be hidden with a dismiss button; it reappears only once more items are viewed.
- **Document count drift** — `extract_count` / `learning_item_count` only ever grew; they are now maintained by triggers and a one-time repair, so the "has extracts/has cards" signals stay accurate across deletes and cascades.
- **OpenRouter pricing** — provider pricing is normalized to USD per 1K tokens for correct cost accounting.
- **EPUB rendition crash** — the rendition task queue is stopped before teardown to avoid a `_display` crash.
- **RAG retrieval state** — retrieval now reports hits / no-match / empty-index explicitly instead of failing silently, and the database open path is hardened.
