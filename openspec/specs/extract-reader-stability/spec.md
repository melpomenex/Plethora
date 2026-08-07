# extract-reader-stability Specification

## Purpose
TBD - created by archiving change fix-queue-item-type-scroll-mode. Update Purpose after archive.
## Requirements
### Requirement: Extract reader loads once and holds

Opening an extract from the Queue SHALL fetch the extract once and keep it
rendered. The reader SHALL NOT clear its content and refetch on subsequent
renders of the same extract.

#### Scenario: Extract opens without flicker
- **WHEN** the user clicks an extract in the Queue and the extract reader tab opens
- **THEN** the loading state appears at most once
- **AND** the extract text remains visible and stable, with no repeated blank-then-reload cycle

#### Scenario: Re-render does not refetch
- **WHEN** the extract reader re-renders for an unrelated reason (a parent re-render, a store update, a rating submission)
- **THEN** no additional fetch for the same extract is issued
- **AND** the displayed extract content does not blank out

#### Scenario: Switching extracts refetches
- **WHEN** the reader is given a different extract id
- **THEN** it fetches that extract and replaces the displayed content

### Requirement: Translation function is referentially stable

The `t` function returned by the `useI18n` hook SHALL keep a stable identity
for as long as the active locale is unchanged, so that listing it in a React
hook dependency array does not cause the hook to re-run on every render.

#### Scenario: Stable across renders
- **WHEN** a component using `useI18n` re-renders with the locale unchanged
- **THEN** `t` is the same reference as on the previous render

#### Scenario: Changes with locale
- **WHEN** the user switches the application language
- **THEN** `t` is a new reference and effects depending on it re-run

#### Scenario: Progressive summaries are generated once
- **WHEN** an extract scroll card with progressive disclosure enabled and no stored summaries is displayed
- **THEN** summary generation is requested once, not repeated on every render

