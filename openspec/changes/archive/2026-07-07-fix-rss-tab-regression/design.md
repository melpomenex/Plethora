## Context

There has been a regression in the RSS Tab within the app:
1. OPML import triggers the wrong callback (`onOpenAddFeed`) from the dashboard, leading to an input dialog without a file picker.
2. In HTTP backend mode, `importOpmlAuto` returns `[]` causing the success alert to display `0` imported feeds, even if the backend successfully imported them.
3. In Tauri mode, `handleImportOPML` runs `Promise.all` over all feeds to fetch and sync them concurrently, which causes timeouts/failures when importing large OPML files.
4. Top-level folder headers and categories in the sidebar are not selectable/clickable; clicking them does not load nested feed articles.

## Goals / Non-Goals

**Goals:**
- Connect the "Import OPML" button in the dashboard to `handleImportOPML` directly.
- Display the correct count of imported feeds in the alert message for both Tauri and HTTP backend modes.
- Implement sequential feed fetching during Tauri OPML imports to prevent network/IPC overloading.
- Enable selecting folder/category headers in the sidebar to view all their articles collectively.

**Non-Goals:**
- Modifying backend Rust parser implementation logic.
- Rewriting the complete layout of the RSS reader.

## Decisions

### 1. Connecting OPML Button via callback
- **Decision**: Add `onImportOPML` to `RSSDashboardProps` and call it on click of the OPML button. In `RSSReader.tsx`, pass `handleImportOPML` to the dashboard.
- **Rationale**: Reusing `onOpenAddFeed` is wrong because subscribing to a URL is a separate flow from importing a local file.

### 2. Standardize `importOpmlAuto` return format
- **Decision**: Change `importOpmlAuto` to return the count of imported feeds or standard feeds, or update `handleImportOPML` to correctly read the imported count from `importOpmlAuto` response. Since `importOpmlViaHttp` returns `{ imported: number; errors: string[] }`, we will let `importOpmlAuto` return `{ count: number; feeds?: Feed[] }`.
- **Rationale**: Standardizing the return value makes it easy for the UI to display the exact number of imported feeds.

### 3. Sequential Fetching in Tauri OPML Import
- **Decision**: Replace `Promise.all` map with a sequential `for...of` loop when fetching feeds in Tauri mode.
- **Rationale**: Large OPML files can have 100+ feeds. Sequential fetches prevent CPU, network, and database connection locking.

### 4. Interactive Sidebar Folders and Categories
- **Decision**:
  - Add `selectedFolderId` state in `RSSReader.tsx`.
  - When a folder/category header is clicked, set `selectedFolderId` to its ID and clear `selectedFeed`.
  - Update article filtering `useEffect` to aggregate articles from all feeds nested under the selected folder/category.
  - Apply active highlights and pointer styles to the folder headers in the sidebar.

## Risks / Trade-offs

- **Risk**: Sequential OPML imports in Tauri could take longer for very large files.
  - *Mitigation*: The UI will display a loading spinner/indicator or success alert with count after completion.
