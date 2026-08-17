## ADDED Requirements

### Requirement: Reconstruction outputs the existing canonical schema
Cloud reconstruction SHALL produce pages in the versioned canonical reflow schema (additive fields only) consumed by the existing renderer, selection, highlighting, TTS, and extraction paths. The original document file SHALL never be modified; reconstruction is a reversible per-document overlay.

#### Scenario: Reconstructed page is fully usable
- **WHEN** a cloud-reconstructed page renders
- **THEN** reflow, text selection, highlighting, extract creation, and word-anchor resolution work through existing code paths

#### Scenario: Original preserved
- **WHEN** a user accepts then reverts a reconstruction
- **THEN** the original file hash is unchanged and the original rendering returns

### Requirement: Jobs are page-progressed, resumable, and cancellable
`document_reconstruct` jobs SHALL report per-page progress, checkpoint completion, retain partial results (completed pages usable), resume from the last completed page after failure, and cancel promptly with partial retention.

#### Scenario: Mid-document failure resumes
- **WHEN** a job fails at page 40 of 120
- **THEN** pages 1–39 are usable and a retry resumes at page 40 without re-billing completed pages

### Requirement: Quotas are page-based with pre-flight estimates
Usage SHALL be metered in pages under the `cloud_document_processing` envelope; submissions SHALL present a pre-flight estimate (pages × tier) and a cloud-compute disclosure before running; over-quota submissions reject with `quota_exceeded`.

#### Scenario: Estimate precedes spend
- **WHEN** the user triggers full-document reconstruction
- **THEN** a dialog shows the page count, tier, and quota impact before the job starts

### Requirement: Structure extraction covers hard cases
The pipeline SHALL extract reading order (multi-column), heading hierarchy, tables (structured data), equations (LaTeX/MathML for existing rendering), figures (cropped assets with placement), captions, footnotes, and references — validated by golden fixtures per engine version.

#### Scenario: Two-column reading order correct
- **WHEN** a scanned two-column fixture is reconstructed
- **THEN** extracted reading order matches the golden fixture sequence

#### Scenario: Equations render
- **WHEN** an equation-heavy page is reconstructed
- **THEN** equations render via the existing KaTeX path from extracted LaTeX

### Requirement: Privacy and eligibility rules are enforced
Page rasters and OCR text SHALL leave the device only when the job runs, with disclosure; artifacts SHALL be TTL-deleted (default 7 days); content SHALL NOT appear in server logs; documents flagged exclude-from-AI/cloud SHALL be ineligible for cloud reconstruction (enforced, not just hidden).

#### Scenario: Excluded document rejected
- **WHEN** reconstruction is requested for an exclusion-flagged document
- **THEN** the request is refused with a clear reason and no upload occurs

### Requirement: Suggestions respect calm UX
Automatic improvement offers SHALL appear only from documented low-quality signals (low text coverage, graphical fallback, low OCR confidence), be dismissible, and never interrupt reading or review flows.

#### Scenario: Poor PDF gets one offer
- **WHEN** a user opens an image-only PDF
- **THEN** at most one non-modal reconstruction offer appears, dismissible permanently for that document
