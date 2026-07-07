## Context

The system has a 2D knowledge graph page (`KnowledgeGraphPage.tsx`) using HTML5 `<canvas>` rendering in `ObsidianGraph.tsx` and a 3D sphere component in `ObsidianSphere.tsx`. Currently:
1. Right-clicking a node triggers the browser's default context menu.
2. Selecting a node in the 3D Knowledge Sphere displays a minimal overlay showing only the name, type, number of connections, and a "Focus View" button. There is no edit option, delete option, or connection breakdown display.

## Goals / Non-Goals

**Goals:**
- Add a custom context menu for nodes in both the 2D Knowledge Graph and 3D Knowledge Sphere, consistent with the app's standard context menu layout (`ContextMenu` component).
- Redesign the detail overlay card in the 3D Knowledge Sphere to be a rich stats and actions card, supporting inline metadata editing and database updates.
- Wire up node actions (Focus, View/Open tab, Edit drawer/inline, and Delete node with confirmation) to both the context menus and the sphere detail card.

**Non-Goals:**
- Changing the physics rendering or 3D canvas rendering algorithms of either visualization.
- Supporting context menus for edges or empty space.

## Decisions

### 1. Intercepting Right-Clicks via `onContextMenu`
We will register an `onContextMenu` handler on the `<canvas>` elements of both `ObsidianGraph.tsx` and `ObsidianSphere.tsx`.
- **Why**: Canvas elements do not have separate HTML elements for nodes. Clicks must be mapped back to node coordinates using existing mouse cursor tracking. Both visualizers already track `hoveredNode` on mouse movement. If a right-click occurs, we check if `hoveredNode` is non-null. If so, we prevent default behavior and trigger `onNodeContextMenu(node, position)`.
- **Alternatives considered**: Adding invisible overlay div elements over nodes. This was rejected because coordinates change continuously due to zoom, pan, physics, and rotation.

### 2. Context Menu Integration
We will use the app's existing `ContextMenu` hook (`useContextMenu`) and component (`<ContextMenu />`) from `src/components/common/ContextMenu.tsx`.
- **Why**: Reusing this component ensures consistent appearance, theme styling, support for submenus, keyboard handlers, and standard styling (e.g. Red for Danger/Delete).
- **Actions in menu**:
  - **Open**: Opens item in new tab.
  - **Focus View**: Animates camera/pan to focus on node.
  - **Edit Details**: Activates edit mode in the sphere card, or opens the side drawer in the graph page.
  - **Copy Title**: Copies label to clipboard.
  - **Delete (Danger)**: Launches confirmation dialog.

### 3. Sphere Selected Node Detail Card
In `ObsidianSphere.tsx`, we will replace the simple selected node tooltip overlay (lines 691-728) with a beautiful Glassmorphic card that features:
- Detailed type icon, colored label, and category metadata.
- Grouped connection stats (e.g. reference, contains, related, derived).
- Actions bar: Focus (Target), View (ArrowSquareOut), Edit (Pencil), Delete (Trash).
- Inline editing mode: When "Edit" is clicked, text inputs for title, category, tags, and description are shown. Saving makes database updates (via document, extract, or flashcard API) and triggers a refresh callback.

## Risks / Trade-offs

- **[Risk]** Context menus triggering at page edges could be cut off.
  - *Mitigation*: The `ContextMenu` component already handles bounds check relative to window dimensions.
- **[Risk]** Sphere state updates causing rotation jumps or loss of current camera orientation.
  - *Mitigation*: When refreshing sphere data after inline edits or deletion, keep current rotation (`rotationRef.current` and `zoomRef.current`) intact.
