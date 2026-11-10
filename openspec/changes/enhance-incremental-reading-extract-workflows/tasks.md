# Tasks: Enhance Incremental Reading Extract Workflows

## 1. Extract Editor Indentation Controls

- [ ] 1.1 Add Indent and Outdent commands to `ExtractContentEditor.tsx` using `sinkListItem` and `liftListItem`.
- [ ] 1.2 Add `TextIndent` and `TextOutdent` toolbar buttons to `ExtractContentEditor.tsx` with localized tooltips.
- [ ] 1.3 Bind `Tab` (sink) and `Shift+Tab` (lift) keyboard handlers when cursor is inside list elements.
- [ ] 1.4 Add Vitest component test in `src/components/extracts/__tests__/ExtractContentEditor.indent.test.tsx` verifying indentation shortcuts mutate list nesting levels.

## 2. Bidirectional Source Return Navigation

- [ ] 2.1 Add "Return to Source" button to `src/components/extracts/ExtractReaderView.tsx`.
- [ ] 2.2 Wire deep navigation dispatch in `src/components/viewer/DocumentViewer.tsx` to handle CFI, PDF page, and text offset jumps from extracts.
- [ ] 2.3 Add highlight pulse animation when navigating back to source text in viewer.
- [ ] 2.4 Add Vitest test in `src/components/extracts/__tests__/ExtractReaderView.navigation.test.tsx` asserting clicking return to source dispatches correct viewer location.

## 3. Extract Priority Inheritance & Settings Search Coverage

- [ ] 3.1 Add `extractPriorityInheritance` to `UserSettings` in `src/stores/settingsStore.ts`.
- [ ] 3.2 Update `create_extract` in `src-tauri/src/commands/extract.rs` to inherit parent document priority score when enabled.
- [ ] 3.3 Add Extract Priority Inheritance toggle in `src/components/settings/sections/ReviewSettings.tsx`.
- [ ] 3.4 Add stable DOM `id="setting-extract-priority-inheritance"`.
- [ ] 3.5 Register `setting-extract-priority-inheritance` in `src/components/settings/search/settingsSearchCatalog.ts` under `SettingsTab.Review`.
- [ ] 3.6 Add search coverage test in `src/components/settings/search/__tests__/settingsSearchCatalog.test.ts`.
- [ ] 3.7 Run `npm run bench:check` to ensure no performance regression.
