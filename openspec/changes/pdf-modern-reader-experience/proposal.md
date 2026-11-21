## Why

PDF links have no reader-specific destinations and printed labels are missing from navigation. Page and scroll modes already share a virtualized reader.

## What Changes

Route embedded internal destinations through existing navigation. Improve page labels, reader layouts and on-demand navigation tools without a second renderer.

## Capabilities

### New Capabilities

- `pdf-reader-navigation-and-layout` governs pDF page view, destination service, reader toolbar, sidebar, theme CSS and navigation tests.

### Modified Capabilities

Existing feature deltas remain in their historical changes. This delta defines the additional PDF contract.

## Impact

PDF page view, destination service, reader toolbar, sidebar, theme CSS and navigation tests. See the [program dependency graph and verification matrix](../../planning/pdf-first-class-document-platform/README.md).
