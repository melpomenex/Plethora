## 1. Mobile EPUB Cover Rendering

- [x] 1.1 Update the mobile `LibraryCard` to fit and center EPUB covers within the existing frame, preserving aspect ratio; verify the full portrait cover remains visible without changing the frame dimensions.
- [x] 1.2 Disable hover zoom for EPUB covers on mobile while preserving current desktop and non-EPUB behavior; verify touch interaction does not enlarge or crop the EPUB cover.

## 2. Regression Coverage

- [x] 2.1 Add or update Documents view component coverage for mobile EPUB fit, disabled hover zoom, and unchanged desktop/non-EPUB presentation; verify the targeted component test passes.
- [x] 2.2 Verify the EPUB cover presentation contract with `openspec validate fix-epub-cover-scaling --strict`.
