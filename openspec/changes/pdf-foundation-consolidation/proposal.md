## Why

Single-page extraction currently returns the complete PDF. Filtering blank pages and reconstructing sparse results by position can move citations to the wrong page.

## What Changes

Correct physical-page extraction and semantic location reconciliation. Establish the canonical reader projection and evidence requirements for rollout.

## Capabilities

### New Capabilities

- `pdf-physical-source-integrity` governs rust PDF processor, semantic chunk diff, Reading Trails, PDF reader flags and canonical cache.

### Modified Capabilities

Existing feature deltas remain in their historical changes. This delta defines the additional PDF contract.

## Impact

Rust PDF processor, semantic chunk diff, Reading Trails, PDF reader flags and canonical cache. See the [program dependency graph and verification matrix](../../planning/pdf-first-class-document-platform/README.md).
