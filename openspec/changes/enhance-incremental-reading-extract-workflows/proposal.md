## Why

Readers can already extract text and edit indentation, but direct cloze creation and atomic extract-and-reschedule need reliable end-to-end workflows.

## What Changes

- Qualify indentation and exact return-to-source using the current editor and locator adapters.
- Create a cloze directly from source selection and preserve source association without an extract record.
- Add transactional Extract and Reschedule with explicit source date/membership and extract priority/membership.

## Capabilities

### New Capabilities

- `incremental-reading-extract-workflows`.

### Modified Capabilities

This change carries one delta for the capability listed above.

## Impact

Selection menu, cloze and extract dialogs, source locator, queue controls and native/browser persistence. [Highlighting](../fix-document-highlighting/) owns the processed-passage display.

See the [closure plan](../../planning/issue-6-final-closure-plan.md) for issue ownership and dependencies.
