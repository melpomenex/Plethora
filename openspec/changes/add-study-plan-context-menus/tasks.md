## 1. Curriculum topic and source menus

- [x] 1.1 Add shared context menus to included and removed topic rows; route Open topic, Start lesson, safe Move earlier/later, Lock/Unlock, Remove, and Restore through existing Study Plan state handlers, and verify draft/read-only, lock, and prerequisite cases with focused component tests.
- [x] 1.2 Add source-row menus that expose Open source in the plan-wide list and add Remove link only for editable topic sources; verify each action targets the clicked source and respects the current read-only state.

## 2. Assessment and version menus

- [x] 2.1 Add assessment-card menus for Open, Archive, and the existing guarded Delete unused assessment action; verify menu actions reuse the card handlers, preserve refresh/error behavior, and do not open the assessment merely from right-click.
- [x] 2.2 Add version-row menus only when the current view supplies an available View or Copy to draft action; verify historical versions stay immutable and a current-only row with no action does not open an empty menu.

## 3. Plan Home menus

- [x] 3.1 Add a recommendation-card menu for Continue and Browse path and a due-review-card menu for Review; verify opening either menu has no navigation, progress, or review side effect and the unavailable-count state remains unchanged.

## 4. Cross-view interaction and verification

- [x] 4.1 Verify supported rows and cards open exactly one shared menu, menu actions close it and return focus appropriately, keyboard and mobile-sheet use retain the same applicable actions, and editable fields and blank backgrounds do not open object menus.
- [x] 4.2 Run the focused Study Plan and shared context-menu component tests, then validate the change artifacts with `openspec validate add-study-plan-context-menus --strict`.
