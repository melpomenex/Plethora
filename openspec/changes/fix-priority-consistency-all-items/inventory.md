# Priority inventory and readback analysis

## Entry points

| Surface | How priority is edited | Persistent target |
| --- | --- | --- |
| Scroll Queue (`QueueScrollPage`) | `doc.priority` shortcut, overlay indicator, inspectors | Typed target from the displayed row |
| Review queue (`ReviewQueueView`) | `doc.priority` shortcut, per-row indicator, inspector | Typed target from the selected/visible rows |
| Document library (`DocumentsView`) | Row/inspector popup, `doc.priority` shortcut, rating shortcut | `documents.id` |
| Document reader (`DocumentViewer`, `DocumentViewerWrapper`) | `doc.priority` shortcut (including forwarded iframe event), priority control | `documents.id` |
| Queue bulk actions (`BulkActionBar` / queue store) | Bulk priority slider | One typed batch of row targets |
| Legacy `/queue` route (`src/routes/queue.tsx`) | Inline document-only rating/slider | `documents.id` (route is not mounted by the app router; documents-only by construction) |

## Displayed item type → stable priority identity

| Displayed type | Queue row identity | Persistent identity | Storage |
| --- | --- | --- | --- |
| Document | `id` / `documentId` | document id | `documents.priority_slider`, `priority_rating`, `priority_score`, `priority_explicitly_set` |
| Playlist video | `id` = video id, `documentId` = parent doc | parent document id (canonical document is the priority-bearing entity) | document priority columns |
| Extract | `extractId` (falls back to row id) | `extracts.id` **not** `document_id` | `extracts.priority_slider` (new), `priority_score` rank key |
| Learning item / flashcard | `learningItemId` (falls back to row id) | `learning_items.id` | `learning_items.priority_slider`, `priority_score`, `priority_explicitly_set` |
| Video extract | `entityId` (falls back to row id) | `video_extracts.id` | `queue_external_priorities(kind='video-extract')` |
| RSS article | `entityId` or `rss-` prefixed row id | `rss_articles.id` | `queue_external_priorities(kind='rss-article')`; orders inside RSS slots |
| Podcast episode | `podcastEpisode.id` | `podcast_episodes.id` | `queue_external_priorities(kind='podcast-episode')`; orders inside podcast slots |

`resolveQueuePriorityTarget()` in `src/services/priority/priorityCommit.ts` is the
shared frontend resolver. The backend equivalent is `QueuePriorityTarget` /
`bulk_update_typed_item_priorities`, which writes only the table named by the
target kind, so equal ids in different tables cannot collide.

The Scroll Queue also shows documents reached through a video extract. Those
rows carry `videoExtractId`; the resolver uses it instead of the parent document.

## Extract rank keys versus user sliders

- `extracts.priority_score` is a **queue order key** produced by
  `database::priority_rank::key_for_slider`; it is not a 0–100 slider value and
  different sliders can select the same key.
- Migration `134_extract_priority_slider` adds nullable
  `extracts.priority_slider`. `NULL` means "inherited or legacy", `0` is a real
  committed zero.
- Migration `135_queue_external_priorities` adds the durable per-item store for
  RSS articles, podcast episodes, and video extracts.
- `resolve_display_slider` / `PriorityPopulationSnapshot` provide the
  authoritative readback. Queue rows expose it as `priority_display_slider` so
  UI surfaces never reinterpret `priority_score` as a slider.
- Inheritance: an extract with a null slider displays the parent document's
  resolved display value while its rank key still matches the parent. When a
  user sets the extract, the slider becomes explicit and parent cascades stop
  touching it (`cascade_document_priority` filters on `priority_slider IS NULL`).
- Legacy fallback: `priority_slider > 0` wins, then the legacy 1–5 rating maps
  to 10/30/50/70/90, then the neutral 50. Explicit zero always reads back 0.

Exact slider readback is therefore possible for every item type without
rewriting existing rank keys or globally recomputing legacy rows.
