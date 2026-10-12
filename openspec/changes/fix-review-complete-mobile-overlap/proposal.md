## Why

On mobile, the Review Complete content can extend behind the fixed bottom navigation. The final actions, including returning to the Review Home, are clipped or partly obscured, so users cannot reliably reach them.

## What Changes

- Keep Review Complete content vertically scrollable when it is taller than the available mobile viewport.
- Reserve enough space after the final action for the mobile navigation bar and device safe area.
- Apply the same completion layout behavior to both review completion entry points while preserving the existing desktop layout and actions.

## Capabilities

### New Capabilities

- `review-completion-mobile-layout`: Specifies that mobile Review Complete content remains scrollable and its final actions can be brought fully above fixed bottom navigation.

### Modified Capabilities

None.

## Impact

- Review completion wrappers in `src/components/review/ReviewSession.tsx` and `src/routes/review.tsx`, plus shared completion layout styling if needed.
- Responsive component or viewport coverage for the mobile completion screen.
- No API, persistence, or dependency changes.
