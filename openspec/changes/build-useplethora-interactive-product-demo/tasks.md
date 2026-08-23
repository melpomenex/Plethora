## 1. Machine and data

- [x] 1.1 Implement `DemoState` + `DEMO_HAPPY_PATH` transitions in `website/src/components/demo/machine.ts` with unit tests for every legal transition and clamp-on-invalid.
- [x] 1.2 Curated content JSON for five kinds; copy from C fixtures when present.
- [x] 1.3 Restart control returns to `library` and emits `demo_restart`.

## 2. UI

- [x] 2.1 Phone frame with iOS/Android chrome and toggle; UA default.
- [x] 2.2 Stages: library grid, item, reader/media, passage selection (predetermined hit target), explain panel (canned grounded text), Remember this, card, review front/back, grades, schedule note, complete.
- [x] 2.3 No control without a handler; disabled states explained.
- [x] 2.4 Mount in `HomeDemoSlot` via lazy island; optional `/demo` route reuses the same component.

## 3. A11y and motion

- [x] 3.1 Keyboard: arrows/enter for primary path documented in a visible “Keyboard” hint.
- [x] 3.2 Screen-reader alternative list + live region.
- [x] 3.3 Reduced-motion CSS; no Peck.
- [x] 3.4 Focus visible on all demo buttons.

## 4. Analytics and fallback

- [x] 4.1 Emit `demo_start` / `demo_stage` / `demo_complete` / `demo_restart` through A’s analytics wrapper (no-op when disabled).
- [x] 4.2 Noscript/static fallback using C images or the HTML list.
- [x] 4.3 Code-split: demo chunk not in critical path of first paint.

## 5. Validation

- [x] 5.1 Unit tests for machine; component test for toggle + restart.
- [x] 5.2 `openspec validate build-useplethora-interactive-product-demo --strict`.
