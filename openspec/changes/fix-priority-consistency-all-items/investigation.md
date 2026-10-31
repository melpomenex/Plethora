# Priority consistency investigation

This is a partial inventory. The tasks remain unchecked until their stated
coverage and verification are complete.

| Displayed item | Existing persistent identity | Current priority path |
| --- | --- | --- |
| Document | `documents.id` | Document slider, explicit flag, and rank key; shared typed commit supports it. |
| Extract | `extracts.id` | Own rank key; parent score is copied on creation and matching scores are cascaded. Scroll Queue currently displays the key as a slider. |
| Flashcard | `learning_items.id` | Own slider, explicit flag, and rank key; Scroll Queue now uses the shared typed commit. |
| Video extract | `video_extracts.id` | Queue currently inherits the parent document's priority signal; the segment has no independent priority fields. |
| Playlist video | `documents.id` | Queue playlist entries reference an imported document, although their displayed queue ID is the playlist row ID. |
| RSS article | `rss_articles.id` | Independent article record without user-priority fields; Scroll Queue uses relevance and/or publication date. |
| Podcast episode | `podcast_episodes.id` | Independent episode record without user-priority fields; Scroll Queue takes episode queue order. |

Sources: `src/pages/QueueScrollPage.tsx` (item assembly and current priority),
`src-tauri/src/database/repository.rs` (extract cascade),
`src-tauri/src/commands/rss.rs` and `src-tauri/src/models/podcast.rs` (feed
models), and `src-tauri/src/commands/queue.rs` (video extracts and playlist
videos). Queue bulk resolution currently accepts untyped IDs and chooses the
first matching table, so it cannot disambiguate cross-type ID collisions.

Extract rank keys cannot recover the exact saved slider: `key_for_slider` selects
a gap in the current global population and stores its midpoint; different
population sizes or positions can map slider values to the same gap. Parent
inheritance is currently inferred by score equality within a tolerance. A
nullable persisted slider can distinguish future explicit values, including zero,
from inheritance, but legacy scores cannot reveal every historical override.
Migration and sync must preserve rank keys and handle this ambiguity.

The user selected priority within feed ordering, with relevance, chronology, or
episode order retained as the fallback. Feed items do not join the global rank
population merely to display their priority.
