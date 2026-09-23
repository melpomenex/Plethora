## 1. OPML Import UX and Integration

- [ ] 1.1 Add `onImportOPML` callback to `RSSDashboardProps` in [RSSDashboard.tsx](src/components/media/RSSDashboard.tsx) and trigger it when clicking the "Import OPML" button.
- [ ] 1.2 Update [RSSReader.tsx](src/components/media/RSSReader.tsx) dashboard rendering to pass the `handleImportOPML` handler to the `RSSDashboard` component.
- [ ] 1.3 Update the signature and return value of `importOpmlAuto` in [rss.ts](src/api/rss.ts) to return `{ count: number; feeds?: Feed[] }`. If using the HTTP backend, make it return the count returned from the backend endpoint.
- [ ] 1.4 Refactor `handleImportOPML` in [RSSReader.tsx](src/components/media/RSSReader.tsx) to handle the new return object from `importOpmlAuto`, showing the correct alert message count of imported feeds for both Tauri and HTTP modes.
- [ ] 1.5 Throttle feed fetching in Tauri mode inside `handleImportOPML` by importing feeds sequentially in a `for...of` loop instead of `Promise.all`.

## 2. Sidebar Folder/Category Navigation

- [ ] 2.1 Add `selectedFolderId` state in [RSSReader.tsx](src/components/media/RSSReader.tsx).
- [ ] 2.2 Add click handlers to folder and category headers inside `groupedFeeds.sections.map(...)` in [RSSReader.tsx](src/components/media/RSSReader.tsx) sidebar to select/toggle `selectedFolderId` and reset `selectedFeed`.
- [ ] 2.3 Reset `selectedFolderId` when clicking individual feeds, the global "All" button, search, or other filter modes.
- [ ] 2.4 Update the article filtering `useEffect` in [RSSReader.tsx](src/components/media/RSSReader.tsx) to aggregate and display items from all feeds nested under the folder/category when `selectedFolderId` is set.
- [ ] 2.5 Add visual active state highlighting and style tweaks for selected folder/category headers in [RSSReader.tsx](src/components/media/RSSReader.tsx).
