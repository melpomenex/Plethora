## Why

Activating **View all browser saves** fails with `no column found for name: is_local_only` instead of opening the filtered Library. The native capture-summary query omits privacy fields required by the shared document mapper, so any eligible saved document can trigger the failure.

## What Changes

- Correct the native filtered capture-summary projection so it returns the persisted document privacy values expected by the mapper.
- Add regression coverage for browser-extension and share-target listings, including privacy values, filtering, and lightweight summaries.
- Preserve the existing dashboard-to-Library navigation, source filtering, collection scope, and ordering contracts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This repairs existing behavior specified by the in-flight `add-capture-link-shelf` change; it does not introduce a new product requirement.

## Impact

The native SQLite capture repository and its Rust tests are affected. The `get_documents` command and its response shape remain unchanged; no schema migration is expected.
