## MODIFIED Requirements

### Requirement: Actions route to concrete remediation

Each gap SHALL offer Explain/Open Source, Teach me, Find/choose material where evidence is missing, Generate Practice, Make Cards, Follow-up Exam or Plan Adjustment when relevant, and Dismiss. Actions SHALL carry the gap's evidence and related permitted sources through the existing reader, tutor, assessment, card proposal and Study Plan draft flows. Existing non-Study gap routes SHALL retain their current behavior. Study Plan assessment gaps SHALL offer a targeted lesson and fresh reassessment in the same plan context, including concept, objective, validated evidence and misconception where present. Source and provider limitations SHALL be visible and SHALL NOT expand retrieval scope. Dismissal SHALL persist; actions SHALL remain optional and SHALL NOT automatically start cloud work, publish a curriculum, create cards or change the scheduler.

#### Scenario: Teach-me carries context
- **WHEN** the user taps Teach me on a gap
- **THEN** the tutor opens pre-loaded with the gap's concept, evidence summary, and related permitted sources, and library retrieval for a Study Plan is restricted to its validated source scope

#### Scenario: Study gap retains its destination
- **WHEN** a learner follows a Study Plan gap through source inspection, targeted lesson and fresh practice or reassessment
- **THEN** the original gap context is restored without manual re-selection and the eligible new result can be inspected there

#### Scenario: Rejected remediation stays non-destructive
- **WHEN** the user dismisses the gap or closes a proposal without accepting
- **THEN** active surfaces honor dismissal and no source, plan, card, review or Queue/FSRS state changes
