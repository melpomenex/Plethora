## 1. Implement Right-Click Handlers in Graph & Sphere Components

- [x] 1.1 Add `onNodeContextMenu` callback to `ObsidianGraphProps` in `ObsidianGraph.tsx` and handle right-click events on the `<canvas>`
- [x] 1.2 Add `onNodeContextMenu` callback to `ObsidianSphereProps` in `ObsidianSphere.tsx` and handle right-click events on the `<canvas>`

## 2. Redesign Selected Node Card in 3D Sphere Component

- [x] 2.1 Update `ObsidianSphere.tsx` state to support inline editing of label, category, tags, and description for the selected node
- [x] 2.2 Design a beautiful glassmorphic detail card showing type, color, connection counts by relationship type, and actions bar (Focus, Open, Edit, Delete)
- [x] 2.3 Implement inline editing inputs and save callback that executes DB update commands (documents, extracts, or flashcards)
- [x] 2.4 Add support for a delete callback in `ObsidianSphere` to trigger node deletion with confirmation dialog

## 3. Wire Up Context Menus and Cards in Pages & Tabs

- [x] 3.1 Import and configure `useContextMenu` in `KnowledgeGraphPage.tsx` and map actions (Open, Focus, Edit, Copy Title, Delete)
- [x] 3.2 Add the `<ContextMenu />` render block in `KnowledgeGraphPage.tsx` and wire context menu events to both `ObsidianGraph` and `ObsidianSphere`
- [x] 3.3 Import and configure `useContextMenu` in `KnowledgeSphereTab.tsx` and map actions (Open, Focus, Edit, Copy Title, Delete)
- [x] 3.4 Add the `<ContextMenu />` render block in `KnowledgeSphereTab.tsx` and wire context menu events to `ObsidianSphere`
- [x] 3.5 Display the redesigned detail card in `KnowledgeSphereTab.tsx` when a node is selected, with focus, open, edit, and delete actions wired up

## 4. Verification & Polish

- [x] 4.1 Verify code compiles correctly with `npm run build` or similar typescript compiler check
- [x] 4.2 Validate visually in the browser subagent that right-click context menu opens on graph and sphere nodes, and stats card renders and saves successfully
