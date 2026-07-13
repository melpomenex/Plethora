## 1. Add graph entry to options menu

- [x] 1.1 In `src/components/media/RSSReader.tsx`, add a "Semantic Graph" item to the options menu dropdown (the gear menu at ~line 1643-1728), placing it near "Discover Sites" / "Manage Training". On click it calls `setSemanticGraphOpen(true)` and `setShowOptionsMenu(false)`. Use the `Graph` icon already imported, matching the styling of neighboring items.
- [x] 1.2 Add the menu label — prefer a `rssReader.semanticGraph` i18n key with an English fallback; if the neighboring hardcoded items ("Manage Training", "Discover Sites") aren't localized in this menu, a hardcoded "Semantic Graph" string is acceptable for consistency.

## 2. Remove the persistent graph card

- [x] 2.1 Delete the "Semantic Graph Action Card" block in `RSSReader.tsx` (lines ~1827-1851): the outer gradient `div`, the title/icon row, the batch-count badge, and the "Open Graph Visualization" button.
- [x] 2.2 Confirm the `Graph` and `Brain` icon imports are still used elsewhere (the menu item still uses `Graph`); remove `Brain` from the import list only if it becomes unused.

## 3. Relocate the article-batch badge to the sidebar header

- [x] 3.1 In the sidebar header row (near the options gear, ~line 1643), add a compact inline badge that renders only when `rssStudy.selectedRssItems.length > 0`: shows the count plus a `×` clear button calling `rssStudy.clearBatch()`. Reuse the styling intent of the old badge (orange-tinted, tiny text) but minimal — no card chrome.
- [x] 3.2 Verify the badge does not crowd the gear/sync buttons on narrow sidebar widths; collapse or hide gracefully if needed.

## 4. Verify entry points and behavior

- [x] 4.1 Confirm `SemanticGraphPanel` still mounts once (unchanged) at `RSSReader.tsx:2774-2791` and opens from the new menu item.
- [x] 4.2 Confirm the RSS dashboard stat tile (`RSSDashboard.tsx:155-170`) still opens the overlay via `onOpenSemanticGraph` — no changes needed, just verify it still works.
- [x] 4.3 Manually verify: sidebar no longer shows the graph card, feed list has more vertical space, graph opens from the gear menu, batch badge appears/clears correctly.

## 5. Type-check and lint

- [x] 5.1 Run the project's type-check / build (e.g. `npm run build` or the existing check script) and fix any unused-import or type errors introduced by the card removal.
