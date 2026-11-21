## Context

The existing public text shape is a vector of page slots. Both semantic and structural consumers enumerate it. PDF.js already supplies page geometry to the canonical Rust model.

## Goals and scope

Correct physical-page extraction and semantic location reconciliation. Establish the canonical reader projection and evidence requirements for rollout. Follow the [program invariants and verification matrix](../../planning/pdf-first-class-document-platform/README.md).

## Decisions

Keep dense one-based extraction slots. Handle parser failures explicitly and isolate blocking extraction. Use the page API from the already locked pdf-extract crate. Keep content-keyed semantic IDs compatible while refreshing stored locator metadata even when ordinals match. Explicitly qualify duplicate passage identity and legacy repair before changing persisted source identifiers.

Use the existing versioned canonical cache for geometry, confidence and anchors. Consumers use compatible page projections with native text covering gaps. Treat viewport transforms and PDF-origin rectangles as distinct coordinate spaces. Keep old user-authored locators readable through quote and geometry resolution.

## Source contract and migration

Persist document ID and source revision alongside the physical page number. Store a page label as display metadata. A page text projection carries ordered blocks, source kind and any stable word IDs or PDF-space regions. PDF.js owns viewport conversion. PDF-space coordinates remain independent of zoom, device scale and the current page orientation.

Store a derived source version with the indexed projection when the index begins consuming canonical and OCR pages. On upgrade, identify legacy chunks by projection version and mark their derived index state stale. Rebuild from the authorized source only. Preserve authored locators, then re-resolve against revision, page, quote and geometry. Keep ambiguous matches explicit. When identical passages occur on multiple pages, retain a per-occurrence identity and verify any alias from a legacy content-only ID before navigation.

Keep one owner for each cached page representation. The scheduler needs a nearby analysis window and a small recency window for context. The persisted cache can satisfy subsequent requests after eviction. Consumer text, words and regions must share the source revision. The original view stays usable during rebuild, cache misses and parser failures.

## Risks and verification

Parser timeouts cannot cancel a running blocking thread. Benchmark page-tree traversal and defer eager operations with large files. Keep rollout overrides and make the default policy explicit against the real device gates.

The delta scenarios define the functional gates. Use deterministic fixtures for invariants and record device-dependent verification separately in the program ledger.
