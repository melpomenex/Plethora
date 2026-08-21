## Context

Plethora supports Image Occlusion card creation via `ImageOcclusionComposer.tsx` and review via `ReviewCard.tsx`. Currently, when authoring multiple masks on a diagram (e.g. anatomy labels), each generated flashcard only receives its own single target mask (`hiddenRegions: [region]`). During review, all surrounding labels on the source image remain completely uncovered. This leaks surrounding contextual cues and answers to the learner, defeating active recall. Furthermore, when the user clicks "Show Answer", the target mask is removed and all masks disappear.

This design introduces a shared occlusion set architecture where multiple cards generated from a single diagram know their siblings, default to "Hide All, Guess One" review with visually distinguished target styling, reveal only the target on answer, and offer an on-demand "Reveal all labels" toggle.

## Goals / Non-Goals

**Goals:**
- Implement "Hide All, Guess One" as the primary default review experience for Image Occlusion.
- Clearly differentiate the active target region from sibling blocker masks on the front card face.
- Reveal only the target region when "Show Answer" is triggered; keep sibling masks covered.
- Provide a "Reveal all labels" button on the back of the card to inspect full context when desired.
- Store a canonical `occlusionSetId`, `targetRegionId`, and complete `imageOcclusionRegions` list in `LearningItemInteractionMetadata`.
- Support optional "Hide One, Guess One" mode for context-dependent diagrams.
- Ensure 100% backward compatibility with legacy single-mask cards and preserve existing FSRS/SM-x scheduling state.
- Ensure pixel-perfect, responsive percentage-coordinate scaling on desktop, mobile, touch, and dark/light/high-contrast themes.

**Non-Goals:**
- Creating a separate database engine or second scheduler for image cards (all cards remain standard `learning_items`).
- Arbitrary freehand polygon masks in v1 (retains rectangular percentage regions).
- Re-architecting non-image flashcard types.

## Decisions

### 1. Self-contained Sibling Metadata in `LearningItemInteractionMetadata`
- **Decision**: Store `occlusionSetId`, `targetRegionId`, `occlusionMode` ("hide-all" | "hide-one"), and `imageOcclusionRegions` (array of all sibling regions in the set) directly in `interaction_metadata`.
- **Rationale**: Keeps card records fully self-contained for offline operation, Yjs real-time sync, and backup/restore without requiring complex join queries during rapid review sessions.
- **Alternatives Considered**:
  - *Dedicated SQL `occlusion_sets` table joined at query time*: Rejected for review session hot paths to avoid extra joins and schema complexity, though composer can maintain an optional index.
  - *Dynamic runtime grouping by imageAssetId*: Rejected because a single image asset may be used across multiple distinct occlusion authoring sessions with different mask sets.

### 2. Active Target Visual Distinction
- **Decision**: Render the target mask with a prominent active border (`border-2 border-primary` with subtle theme pulse) and a centered `?` icon badge (`w-5 h-5 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center`). Sibling masks render as solid, muted blocker masks (`bg-slate-900/95 dark:bg-slate-950 border border-white/20`).
- **Rationale**: Distinguishes "the thing you need to recall" from "other things being hidden" without leaking any answer text, accessible across colorblindness and dark/light modes.
- **Alternatives Considered**:
  - *Color-only difference (e.g. blue vs gray)*: Rejected because subtle colors fail WCAG accessibility and colorblind usability.
  - *Numbers (1, 2, 3)*: Rejected because number ordering implies an artificial sequence rather than direct spatial diagram recall.

### 3. Review State Machine for Reveal States
- **Decision**: `ReviewCard.tsx` maintains local review state:
  - `front`: Target mask (active style with `?`) + sibling masks (solid blocker).
  - `revealed` (after Show Answer): Target mask unmasked (or subtle highlight boundary showing revealed area + answer text below) + sibling masks STILL solid blocker.
  - `revealAll` (when user clicks "Reveal all labels"): All sibling masks unmasked.
- **Rationale**: Guarantees zero leakage during question & answer phases, while offering seamless full diagram inspection before advancing to the next card.

### 4. Authoring Mode Setting in `ImageOcclusionComposer.tsx`
- **Decision**: Surface a simple radio toggle in the composer:
  - `● Hide other answers` (default: "hide-all", produces N cards where each card masks all regions and tests one)
  - `○ Show other answers` ("hide-one", produces N cards where each card masks only its target)
- **Rationale**: Intuitive wording that avoids jargon for standard users while delivering proper recall mechanics.

## Risks / Trade-offs

- [Risk] Legacy cards lack `targetRegionId` or sibling lists. -> Mitigation: In `ReviewCard.tsx`, if `targetRegionId` is missing, treat the first entry in `imageOcclusionRegions` as the target and render gracefully.
- [Risk] Large diagram images may cause mask drift on responsive layout changes. -> Mitigation: Retain the shrink-wrapped container `w-fit overflow-hidden` where element width matches the rendered bitmap width, using normalized percentage coordinates (0–100%).
- [Risk] Touch target / reveal buttons on mobile might interfere with bottom rating buttons. -> Mitigation: Position the "Reveal all labels" affordance directly below the image frame, well above the SRS rating bar.

## Migration Plan

1. Update TypeScript types in `src/types/learningItemInteractions.ts` with optional `occlusionSetId`, `targetRegionId`, `occlusionMode`, and sibling list.
2. Update `src/utils/occlusion.ts` (`expandRegionsToCards`) to attach sibling and target region identifiers to each card draft.
3. Update `src/components/occlusion/OcclusionComposerHost.tsx` to generate a stable `occlusionSetId` per authoring save and populate card metadata.
4. Update `src/components/review/ReviewCard.tsx` to implement target vs sibling rendering, target-only reveal, and the reveal-all button.
5. Write unit tests in `src/components/review/__tests__/ReviewCard.test.tsx` and `src/utils/__tests__/occlusion.test.ts`.

## Open Questions

- None blocking. Grouped occlusion (linking multiple regions into a single target) can reuse `groupId` on `ImageOcclusionRegion` in a future enhancement.
