## Context

Plethora has an established haptics subsystem consisting of:
- A first-party native Tauri plugin (`src-tauri/plugins/plethora-haptics/`) for Android and iOS providing semantic platform effects (`selection`, `activation`, `threshold`, `commit`, `success`, `warning`, `error`, `completion`, `celebration`).
- A web fallback driver (`BrowserHapticsDriver`) utilizing `navigator.vibrate`.
- A centralized feedback orchestrator (`src/lib/feedback/orchestrator.ts`), admission governor (`admission.ts`), and policy registry (`policy.ts`).
- User settings in `settingsStore` (`haptics.enabled`, `haptics.intensity`).

While flashcard review routes grading through `review.card-graded`, document review in Queue mode (`QueueScrollPage.tsx` and `DocumentViewer.tsx`) bypasses feedback emission upon rating. Furthermore, the floating Rating Orbs (`ScrollOverlayControls.tsx` and `DocumentViewer.tsx`) lack physical press micro-haptics, tactile edge-docking detents, and grade-differentiated motor response.

See `proposal.md` for user motivation and problem context.

## Goals / Non-Goals

**Goals:**
- Provide tactile haptic feedback whenever a document is rated in Queue, whether via floating Rating Orbs or keyboard shortcuts.
- Establish grade-differentiated tactile sensations across all rating grades:
  - Rating 1 ("Again"): heavy warning/reject resistance pulse (`warning`)
  - Rating 2 ("Hard"): firm resistance snap (`commit`)
  - Rating 3 ("Good"): crisp, buoyant success confirmation pulse (`success`)
  - Rating 4 ("Easy"): uplifting celebratory double-pulse (`celebration`)
  - Dismiss: sharp clip (`activation`)
- Deliver micro-haptic depression ticks on `pointerdown`/`touchstart` for Rating Orbs to create a physical mechanical sensation.
- Provide magnetic edge-docking threshold detents when dragging the floating Rating Orbs rail.
- Emit celebratory haptic bursts upon crossing Queue session review milestones (5, 10, etc.) or clearing the queue.
- Route all tactile interactions through the feedback orchestrator and policy registry, honoring user settings and hardware constraints.

**Non-Goals:**
- Modifying FSRS algorithm formulas or backend scheduling data contracts.
- Introducing continuous vibration during regular document scrolling or text reading.
- Changing desktop audio behaviors or bypassing existing sound preferences.

## Decisions

### 1. Dedicated Feedback Events & Dynamic Grade Resolution
Add dedicated typed events to `src/lib/feedback/events.ts` and `FEEDBACK_POLICY_REGISTRY` in `src/lib/feedback/policy.ts`:
- `queue.document-rated`: Emitted upon rating a document in Queue with payload `{ rating: number; grade?: number; documentId?: string; sessionOffset?: number }`.
- `queue.orb-pressed`: Emitted on touch-down/pointer-down on an orb with payload `{ orbType: "again" | "hard" | "good" | "easy" | "dismiss" }`. Policy maps to `selection` effect (8ms / subtle tick) with a 50ms cooldown.
- `queue.orbs-docked`: Emitted when the floating orb rail finishes dragging and docks at a screen edge (`left`, `right`, `top`, `bottom`). Policy maps to `activation`.
- `queue.orbs-drag-threshold`: Emitted when dragging crosses into a new edge quadrant. Policy maps to `threshold`.

*Dynamic Grade Policy*: In `orchestrator.ts`, when `queue.document-rated` is dispatched, the orchestrator inspects `payload.rating`:
- `rating === 1` → triggers `warning` effect
- `rating === 2` → triggers `commit` effect
- `rating === 3` → triggers `success` effect
- `rating === 4` → triggers `celebration` effect

*Alternatives considered*:
- Single uniform `commit` effect for all grades: Rejected because distinct tactile signatures communicate scheduling outcomes immediately without requiring visual verification.
- Hardcoding direct driver calls in UI components: Rejected because it bypasses policy suppression, admission rate-limiting, and testing harnesses.

### 2. Rating Orb Touch Lifecycle & Micro-Haptics
In both `ScrollOverlayControls.tsx` and `DocumentViewer.tsx`:
- Attach `onPointerDown` to Rating Orb buttons: emits `queue.orb-pressed` and triggers active physical depression visuals (`active:scale-95`).
- Ensure touch cancel / drag-out semantics: if pointer leaves the orb area before release, the rating action is cancelled, preventing accidental submissions.
- Attach `onClick` / `onPointerUp`: commits the rating and triggers `queue.document-rated`.

### 3. Magnetic Snapping & Drag Detents
In `ScrollOverlayControls.tsx`:
- During `handleMove` of the floating orbs rail, track the projected snap target (`newPosition`).
- When `newPosition` changes from the previous projected position, emit `queue.orbs-drag-threshold` to fire a magnetic snap detent.
- During `handleUp`, emit `queue.orbs-docked` when snapping into the finalized edge.

### 4. Queue Session Milestones
In `QueueScrollPage.tsx`:
- When rating increments `itemsReviewedThisSession`, check milestone thresholds (e.g., multiples of 5 or 10). If crossed, layer a delayed celebratory milestone feedback (`review.progress-milestone` or `review.streak-milestone`).
- When the last queue item is processed, emit `review.session-completed`.

## Risks / Trade-offs

- **[Risk] High-frequency orb tapping leading to motor queue buildup or delays**:
  → *Mitigation*: The feedback orchestrator and `HapticAdmission` enforce strict single-in-flight concurrency and cooldown windows. Stale requests are dropped immediately.

- **[Risk] Touch-down haptics triggering during scroll attempts**:
  → *Mitigation*: The floating orbs rail is an explicit floating overlay with `pointer-events-auto` isolated from the document scroll viewport. Pointer events on orbs stop propagation.

- **[Risk] iOS / Android hardware variations in haptic motor strength**:
  → *Mitigation*: Semantic effect mappings in native drivers translate into platform-idiomatic primitives (e.g. `UIImpactFeedbackGenerator` styles on iOS and `HapticFeedbackConstants` on Android), respecting `settings.haptics.intensity`.
