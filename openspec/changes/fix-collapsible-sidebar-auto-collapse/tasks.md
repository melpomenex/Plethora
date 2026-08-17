## 1. Core Toolbar Collapse Logic

- [x] 1.1 Update `handlePointerLeave` in `src/components/Toolbar.tsx` to schedule collapse on pointer leave regardless of whether a child button holds click focus
- [x] 1.2 Add blur and collapse cleanup on toolbar button actions so activating an item immediately collapses the rail
- [x] 1.3 Add active tab synchronization in `src/components/Toolbar.tsx` to auto-collapse the toolbar rail whenever tabs or views switch
- [x] 1.4 Add outside click/pointerdown dismissal in `src/components/Toolbar.tsx` to collapse the rail when clicking anywhere outside

## 2. Testing and Verification

- [x] 2.1 Update existing tests in `src/components/__tests__/Toolbar.test.tsx` and add test cases for pointer leave after button click
- [x] 2.2 Add test cases for auto-collapse on tab / view navigation in `src/components/__tests__/Toolbar.test.tsx`
- [x] 2.3 Add test cases for outside click dismissal and keyboard navigation in `src/components/__tests__/Toolbar.test.tsx`
- [x] 2.4 Run test suite (`npm test`) and performance gate (`npm run bench:check`) to verify correctness
