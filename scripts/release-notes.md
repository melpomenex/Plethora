### Fixed & Improved

- **Faster SM-20 review scheduling** — the per-review preview path (used every time you grade a card) was spending almost all of its time cloning internal scheduler matrices. Replacing that clone with a purpose-built copy makes each grade evaluation over **25× faster**, so grade previews and multi-grade "what-if" computations return near-instantly even on large collections. Scheduling output is unchanged.
- **Faster Scroll Mode session ordering** — the combined-criterion sort that arranges each Scroll Mode session was recomputing a per-card hash on every comparison. Hoisting that work out of the sort makes session building **~38× faster**, cutting the wait when you open or rebuild a session.
- **Faster file manifest sync** — adding files during sync re-read the sync feature flags twice per entry; reading them once cuts the bulk-add cost roughly in half.
- **Faster large Anki deck import** — looking up each imported card's note was an O(n²) scan that scaled poorly with deck size. Indexing notes by id makes importing a 2,000-card deck **~4× faster**, with larger decks benefiting more.
