## Why

In the Documents view, editing tags via `CompactTagEditor` opens a popover that is too transparent in multiple themes (notably dark and glass variants), causing document card titles, metadata, and buttons to visibly bleed through the editor surface and severely degrade legibility and contrast.

Concurrently, Plethora currently only treats X/Twitter URLs in the Command Palette as video download targets (`TwitterImportDialog` / `importTwitterVideo`), which fails for standard text posts, multi-post threads, and research material. Furthermore, on mobile devices (Android / iOS / PWA), sharing an X/Twitter link via the system share sheet routes through generic web article scraping, which fails on X's dynamic client-rendered pages. Users need a frictionless way to paste or share an X/Twitter URL into the application and immediately enter an interactive learning and research workspace with Plethora's existing reading, extraction, flashcard, and scoped AI capabilities without requiring a cumbersome upfront import ceremony.

## What Changes

- **Tag Editor Readability & Opacity**:
  - Update `CompactTagEditor` and `ItemTagEditor` to render on a solid, opaque foreground surface using Plethora's semantic surface/popover tokens (`bg-popover`, `border-border`, solid background layering).
  - Ensure high-contrast presentation for tag chips (`bg-muted/80`, clear borders, accessible delete icon buttons), tag input, and active focus rings across all light and dark themes.
  - Fix stacking context and z-index isolation so document cards, images, badges, and sibling elements cannot bleed through or overlap the tag editor.

- **Command Palette X/Twitter Thread Recognition**:
  - Extend `useURLDetector` and `GlobalSearch` to contextually classify canonical X/Twitter status URLs (`https://x.com/.../status/...`, `https://twitter.com/.../status/...`, `www` variants, and query strings).
  - Augment Command Palette results with an immediate contextual action: **X Thread** — `Open and analyze this thread` (with author handle, display name, and snippet when available).
  - Enable instant keyboard activation (Enter) to open the thread directly into Plethora's document reader surface.

- **Mobile Share Sheet Ingestion**:
  - Extend `useShareTarget.ts` and `shareTarget.ts` so that incoming share intents on Android, iOS, and PWA containing X/Twitter links bypass generic HTML scraping and route directly into the X thread ingestion and reading experience.
  - Surface a mobile-optimized transition toast ("Opening X thread...") with an instant "Open & Analyze" action navigating directly to the reader.

- **First-Class X Reader & Scoped AI Learning Tools**:
  - Re-use and adapt Plethora's existing reader / viewer infrastructure (`DocumentViewer`, `DocumentViewerWrapper`, `AssistantPanel`, `SelectionPopup`, `SelectionActionsSheet`) for normalized X posts and multi-post threads.
  - Extend the backend/client X fetch pipeline to retrieve and normalize complete post threads (author details, multi-post thread sequence, timestamps, full note_tweet text, media, quoted posts, reply scoping).
  - Provide a scoped contextual analysis sidebar (desktop) and bottom tool surface (mobile) with dedicated tools:
    - **Summary**: Strict thread-level summary without knowledge-base leakage.
    - **Insights**: Structured analysis of central claims, key takeaways, evidence, and tensions.
    - **Ask**: Scoped conversational Q&A preserving individual post boundaries and citations.
    - **Extracts**: Selection-based and whole-post extraction reusing Plethora's `Extract` schema and linking back to the source URL.
    - **Flashcards**: Manual card creation and AI-assisted candidate card generation with preview, edit, and approve-before-saving workflow.
  - Support non-blocking loading, graceful degradation when AI is unavailable, and optional "Save to Documents" persistence.

## Capabilities

### New Capabilities

- `tag-editor-readability`: Ensures all compact tag editor popovers and inline tag editing surfaces have an opaque background, proper theme tokens, high contrast, correct z-index hierarchy, and keyboard accessibility.
- `x-thread-analysis`: Enables pasting X/Twitter post and thread links into the Command Palette or sharing them via the mobile share sheet to immediately open and analyze them inside Plethora's reader with thread-scoped summary, insights, Q&A, extracts, and flashcard generation.

### Modified Capabilities

- `contextual-palette-actions`: Command palette supports contextual URL action detection and direct reader dispatch for recognized X/Twitter thread URLs alongside existing view actions.

## Impact

- **Frontend Components**:
  - `src/components/common/CompactTagEditor.tsx` & `ItemTagEditor.tsx`
  - `src/components/search/GlobalSearch.tsx`, `CommandCenter.tsx`, `ImportPreview.tsx`
  - `src/components/viewer/DocumentViewer.tsx`, `DocumentViewerWrapper.tsx`
  - `src/components/assistant/AssistantPanel.tsx`
  - `src/components/viewer/SelectionPopup.tsx`, `SelectionActionsSheet.tsx`
- **Hooks & Utilities**:
  - `src/hooks/useURLDetector.ts`, `src/hooks/useURLMetadata.ts`
  - `src/hooks/useShareTarget.ts`, `src/lib/shareTarget.ts`
  - `src/utils/assistantContext.ts`
- **Backend & Models**:
  - `src-tauri/src/twitter.rs` (extend beyond video to fetch and normalize full post threads via GraphQL/syndication)
  - `src/api/documents.ts` / `src/api/ai.ts` (thread normalization and metadata types)
- **Styles & Themes**:
  - `src/index.css`, `src/contexts/ThemeContext.tsx`, `src/themes/builtin.ts` (popover surface tokens and opacity enforcement)
