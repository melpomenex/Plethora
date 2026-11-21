## Context

The active reader already emits a page window with XML-like markers. Canonical pages, fallback extraction and OCR presently have separate lifecycles.

## Goals and scope

Compose grounded PDF context per physical page. Connect canonical and OCR projections to search, TTS, extracts, cards, trails, plans and assessments. Follow the [program invariants and verification matrix](../../planning/pdf-first-class-document-platform/README.md).

## Decisions

Resolve per-page evidence in order of anchored selection, canonical body and page-native text. Keep OCR provenance and confidence. A reader-relative request needs evidence from the active page or selection and must surface a missing context failure when these are unavailable. Whole-document retrieval uses its own coverage label. Keep provider and disclosure routing unchanged.

Attach document ID, physical page, quote and optional region to citations and learning artifacts. Build on existing Reading Trail ranking, prerequisite planning and assessment workflows. Filter marginal/reference roles while retaining supplied source evidence. Keep original figure/table/equation crops and expose structured representations only with measured confidence.

## Evidence resolution

Resolve source access before using text or a render. Make active-page, explicit-range, section, selected passage and whole-document coverage explicit. Prefer ready canonical body blocks and fill only the missing pages with page-native text. Order evidence by its relevance to the requested location and trim at block boundaries where possible. Each cited excerpt carries document revision, physical page, quote and optional original geometry. Reject stale resolution after document replacement and fail visibly if the requested evidence is unavailable.

For OCR, record provider class, language, normalized source geometry and confidence per completed page or region. Use the existing OCR routing and explicit disclosure controls. Resume using matching source revision and OCR version. Visible source imagery remains available throughout. Generated explanations may refer to a visual crop selected by the user. Validate returned citations against supplied evidence before attaching navigable references to an answer or assessment.

## Risks and verification

Model citations need locator validation. A partial canonical window must keep fallback text for its other pages. OCR and optional remote analysis must obey existing disclosure settings.

The delta scenarios define the functional gates. Use deterministic fixtures for invariants and record device-dependent verification separately in the program ledger.
