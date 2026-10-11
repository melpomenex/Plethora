## Context

See `proposal.md` for the user-facing problem and scope. On mobile, the Documents view's library dashboard renders documents in horizontal `LibraryCard` cards with a wide, fixed-height cover frame. Its cover image currently uses `object-cover` plus a group hover scale. The card already receives `isMobile`, and the document model exposes `fileType`, so the mobile EPUB cover can be fitted without changing URL storage or the backend extraction pipeline.

## Goals / Non-Goals

**Goals:**
- Keep current mobile card and cover-frame dimensions.
- Show the full EPUB cover centered in the mobile card and preserve its source aspect ratio.
- Prevent the mobile EPUB cover from scaling on touch hover.
- Leave desktop cover handling and non-EPUB mobile covers unchanged.

**Non-Goals:**
- Changing cover extraction, persistence, or image downscaling.
- Redesigning the Documents view card layout.

## Decisions

### Apply a mobile-only EPUB fit rule in `LibraryCard`

For mobile EPUB cards, use `object-contain` so the whole portrait cover is centered in the existing wide frame. Omit the `group-hover:scale-105` transform for that mobile EPUB case. Keep the current `object-cover` and hover transform for desktop cards and non-EPUB mobile cards.

This keeps the change local to the mobile card presentation, respects the existing frame bounds, and avoids altering stored covers. Resizing or rewriting images during extraction was considered, but it would affect persistence and would not prevent the current mobile card's crop and hover zoom.

## Risks / Trade-offs

- **[Portrait covers occupy less horizontal area in the wide mobile card frame]** → This is the expected result of showing the complete cover without distortion; the existing frame and card layout remain unchanged.
- **[Desktop and mobile presentation could drift if their conditional styles diverge]** → Cover tests will assert the mobile EPUB-specific rule and preserve desktop behavior for regression safety.

## Migration Plan

No data migration is needed. Existing saved EPUB cover URLs use the new display rule the next time the mobile library dashboard renders them. Reverting the frontend change restores the previous fit behavior without affecting stored data.
