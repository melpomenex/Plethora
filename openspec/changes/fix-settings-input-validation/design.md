## Context

Users edit numeric configuration options in the settings components (e.g., EPUB reader font size, learning limits, OCR settings). The inputs currently bind their `value` directly to the numeric value from the settings store. In the `onChange` event handlers, these inputs immediately call the store update method using parsing functions like `parseInt(e.target.value) || defaultValue` or `Number(e.target.value)`.
When a user deletes the existing input value to type a new one, the input becomes temporarily empty (an empty string). The parsing handler evaluates this as `NaN` (or `0`) and falls back to a default value, which is then written back to the store. This updates the bound `value` of the input, making it impossible for the user to delete and rewrite values naturally.

## Goals / Non-Goals

**Goals:**
- Enable temporary empty/invalid states in all numeric settings inputs while typing.
- Only apply default fallbacks, clamping, and value restoration when the input loses focus (on blur).
- Provide a reusable `NumericInput` component to standardize this behavior.
- Replace raw `<input type="number" ... />` elements inside the settings pages with the new component.

**Non-Goals:**
- Modifying number inputs outside the settings view (e.g., focus timers, session customizers) that are not part of global settings configuration unless they suffer from the same immediate store update fallback.
- Changing the schema of the settings store.

## Decisions

### Decision 1: Create a Reusable `NumericInput` Component
Create a reusable `NumericInput` component in `src/components/common/UI.tsx` that manages its own local string-based temporary state.
- **Rationale**: Keeping local string state allows the user to have temporary states (e.g., empty string, single minus sign, etc.) without writing back invalid values to the global store.
- **Alternatives considered**: Adding local state hooks to every single settings panel individually. This would lead to massive code duplication and make maintenance difficult.

### Decision 2: Sync and Validate on Blur
- Update `tempValue` local state in `onChange`.
- If the typed value parses to a valid number, propagate the change to the parent immediately so the rest of the application reflects the typed value.
- If the typed value is empty or invalid, do not propagate it to the store.
- On `onBlur`, parse the value. If it is empty or invalid, restore it to the last known valid number. Clamp it to the `min`/`max` boundaries (if provided).
- **Rationale**: This gives a highly responsive typing experience, updates the store as the user types valid digits, and cleans up the input on blur.

## Risks / Trade-offs

- **Risk**: A user leaves an input empty and expects it to be saved as empty/null.
  - **Mitigation**: The settings store schema requires numbers for these fields. An empty/null value is invalid. Restoring the last valid value on blur ensures the settings remain valid.
