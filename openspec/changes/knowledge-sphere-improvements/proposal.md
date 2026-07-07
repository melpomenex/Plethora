## Why

Currently, the knowledge graph and knowledge sphere (3D globe) have limited interactivity when interacting with nodes (documents, extracts, flashcards). Users cannot perform standard context actions (like opening items, editing their metadata, center-focusing, or deleting them) directly from the visualizers via a right-click menu, nor does the knowledge sphere provide a rich card containing node statistics, metadata, and quick actions upon selection. Enhancing these aspects will make the knowledge tools much more powerful, intuitive, and consistent with other parts of the application (e.g. the podcast manager).

## What Changes

- **Full Right-Click Context Menu**: Implement custom right-click context menus for items/nodes in both the 2D Knowledge Graph (`ObsidianGraph`) and 3D Knowledge Sphere (`ObsidianSphere`), integrating with the application's existing `ContextMenu` system.
- **Rich Stats & Action Card**: Replace the simple selected node tooltip/panel in the Knowledge Sphere with a highly polished glassmorphic detail card showing statistics (connected node counts by type), metadata (category, tags, etc.), and actions (Focus view, Open/View item, Edit details, Delete item).
- **Interactive Niceties**: Smooth focus animations, visually striking color coding, metadata editing directly from the stats card, and visual indicators.

## Capabilities

### New Capabilities
- `knowledge-sphere-right-click-and-stats`: Right-click context menus for the 2D Knowledge Graph and 3D Knowledge Sphere, and a rich metadata/statistics detail card for selected items in the 3D Sphere.

### Modified Capabilities

## Impact

- **UI Components**:
  - `src/components/graph/ObsidianGraph.tsx`: Add custom `contextmenu` event handling, cursor/hover detection for right clicks, and trigger callbacks.
  - `src/components/graph/ObsidianSphere.tsx`: Add right-click handlers for sphere node intersection, trigger callbacks, and a premium card layout for selected nodes showing connections breakdown, metadata, and action buttons.
  - `src/components/tabs/knowledge/KnowledgeSphereTab.tsx`: Integrate context menu rendering and handlers for the standalone sphere tab.
  - `src/pages/KnowledgeGraphPage.tsx`: Integrate context menu rendering and handlers for the main graph/sphere page.
