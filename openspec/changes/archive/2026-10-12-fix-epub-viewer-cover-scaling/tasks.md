## 1. Cover Detection and Viewport Dimensions

- [x] 1.1 Implement `isEpubCoverSection(contents)` helper in `src/components/viewer/EPUBViewer.tsx` that inspects section index, href/idref patterns, calibre metadata, and element hierarchy to identify cover pages.
- [x] 1.2 Inject reader viewport dimensions (`--epub-viewport-height`, `--epub-viewport-width`) into content document root in `applyContentOverrides` and propagate updates on viewer container resize.

## 2. Cover and Media Styling Rules

- [x] 2.1 Add `body.epub-cover-page` styling in `#epub-override-styles` to eliminate reading padding, center the cover container, and bound `img` and `svg` with `object-fit: contain` within viewport bounds.
- [x] 2.2 Add safe viewport bounds (`max-height: calc(var(--epub-viewport-height, 100vh) - 5rem) !important; object-fit: contain !important;`) to standard `img` and `svg` elements in `#epub-override-styles` to prevent in-chapter figures from overflowing.
- [x] 2.3 Add SVG normalization in the content hook to ensure `<svg>` elements have valid `viewBox` and `preserveAspectRatio="xMidYMid meet"` attributes.

## 3. Testing and Verification

- [x] 3.1 Add unit tests in `src/components/viewer/__tests__/EPUBViewer.test.tsx` verifying cover section detection, `.epub-cover-page` application, and image/SVG viewport bounding styles.
- [x] 3.2 Add unit tests in `src/components/viewer/__tests__/EPUBViewer.test.tsx` verifying SVG cover normalization (viewBox synthesis and aspect ratio preservation).
- [x] 3.3 Run the test suite and performance benchmark check (`npm test`, `npm run bench:check`) to verify that all tests pass without regressions.
