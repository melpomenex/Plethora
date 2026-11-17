## Why

Study Plan topics link to supporting citations. Learners also need a sequence of bounded passages that teach the topic, a way to resume, and a direct path back to source material after a missed question.

## What Changes

- Create and store ordered, source-grounded reading assignments for a saved plan version. Add local backfill and authoring for existing plans.
- Add a shared Study Mode that opens verified passages in the EPUB, PDF, HTML, and Markdown readers and reports the outcome of the actual navigation.
- Add plan, topic, and graph actions. Persist reading activity and offer formative practice and assessment review using existing Study Plan flows.
- Preserve ordinary source opening, learner highlights, assessment artifacts, and versioned source authority.

## Capabilities

### New Capabilities

- `study-reading-assignments` covers versioned passages, local generation, authoring, coverage, and progress.
- `study-trail-reader-navigation` covers reader-side confirmation, temporary boundaries, and resumable Study Mode.
- `study-trail-assessment-review` covers formative practice and historical question evidence.

### Modified Capabilities

## Impact

Study Plan source and activity repositories, Tauri commands, document readers, tab navigation, Study Plan screens, and assessment results. An additive SQLite migration owns trail data under each saved version.
