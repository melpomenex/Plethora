## Why

On mobile devices, two key interaction flows in Plethora suffer from layout and presentation failures:
1. When a user long-presses a document in Documents view and selects "Create Audio Edition", the generation dialog (`CreateAudioEditionDialog`) renders inside an unportaled parent container with missing flex min-height constraints (`min-h-0`). On mobile screens or viewports constrained by mobile navigation and safe areas, the modal grows larger than the viewport, centers vertically off-screen, and cannot be scrolled to reach either the top controls or the bottom action buttons.
2. The "Edit tags" popover triggered from `CompactTagEditor` is positioned absolute inside nested stacking contexts (such as virtualized list rows with CSS `transform` or cards). On mobile, subsequent rows paint directly over the popover, and because popover background tokens/surfaces lack guaranteed full opacity and scrims, the menu appears translucent and visually jumbled with whatever content lies behind it.

## What Changes

- **Portal and Responsive Sizing for Audio Edition Dialog**: Wrap `CreateAudioEditionDialog` in `createPortal(..., document.body)` so it renders at top-level stacking context above the mobile shell navigation (`.mobile-bottom-nav`). Ensure the outer overlay has proper overflow handling (`overflow-y-auto`, `p-2 sm:p-4`, `max-h-[100dvh]`), and ensure the inner flex container includes `min-h-0` on its scrollable body (`overflow-y-auto`) so the dialog contents shrink and scroll properly on small screens. Also support mobile responsive layouts (such as bottom sheet or scrollable full-screen presentation on small devices) and wire "Create Audio Edition" into grid mode document card long-press menu alongside list mode.
- **Stacking-Context-Safe, Opaque Tag Editor**: Update `CompactTagEditor` to render its edit popover/sheet using a portal or responsive overlay when opened, ensuring a solid opaque background (with `bg-popover`, explicit opaque background color, and subtle backdrop scrim or containment) and `z-[9999]` stacking context that prevents underlying cards, rows, or transforms from bleeding or drawing over the tag editor interface.

## Capabilities

### New Capabilities
- `audio-edition-generation-dialog`: Requirements for the responsive rendering, portaling, viewport containment, and touch-scroll behavior of the audio edition creation dialog across desktop and mobile devices.
- `compact-tag-editor`: Requirements for the stacking-isolated, fully opaque, and mobile-friendly presentation of the compact tag editing popover/sheet.

### Modified Capabilities

## Impact

- `src/components/audio/CreateAudioEditionDialog.tsx`: Dialog portaling to `document.body`, outer overlay scrolling, `min-h-0` flex scroll containment, responsive padding and grid layout for mobile.
- `src/components/common/CompactTagEditor.tsx`: Portaled popover / sheet presentation, stacking context isolation, solid opaque background, dismiss handling.
- `src/components/documents/DocumentsView.tsx`: Context menu accessibility for audio edition creation across both list and card views.
- Test suites: Unit tests in `CreateAudioEditionDialog.test.tsx`, `CompactTagEditor.test.tsx`, and `DocumentsView.test.tsx`.
