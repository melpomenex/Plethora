## Purpose

Allow explicit external research for AI Knowledge Only plans while preserving separate consent, verified provenance, and historical attempt trust.

## ADDED Requirements

### Requirement: Research is a separate authorized action

AI Knowledge Only SHALL make external research opt-in and disabled by default. Each bounded request SHALL disclose the query, destination and cost or limits before transmission and exclude library text and prior learner answers. Declining or turning off research SHALL preserve the baseline plan and prevent new requests. A failed or interrupted research request SHALL be recoverable without silent search or paid fallback.

#### Scenario: AI Knowledge Only without research consent
- **WHEN** a learner generates or resumes a plan without authorizing research
- **THEN** no search or fetch request is sent and model-only output remains available as unverified

### Requirement: External support is revisioned and claim-specific

The learner SHALL be able to inspect candidate external sources, accept a bounded snapshot, and open the exact evidence locator with publisher and revision details. Fetched or accepted content SHALL be distinct from verified support. Unsupported claims and conflicting sources SHALL remain visible and SHALL NOT be silently treated as verified. Changed sources SHALL require revalidation before new verified use while preserving historical snapshots.

#### Scenario: Search result does not support the claim
- **WHEN** a search snippet suggests an answer but the captured source does not substantiate it
- **THEN** the claim remains unverified and the citation is not presented as independent support

### Requirement: Research cannot retroactively verify attempts

Externally sourced exam publication SHALL require explicit verification and acceptance of new question, key and rubric revisions against adequate independent authority. Invalid, stale or disputed evidence SHALL block verified publication. Existing attempts and evidence SHALL retain their original trust status.

#### Scenario: A prior unverified topic gains valid references
- **WHEN** the learner accepts verified sources and publishes a newly verified question revision
- **THEN** the new revision can be used for future verified attempts and all older results remain unverified
