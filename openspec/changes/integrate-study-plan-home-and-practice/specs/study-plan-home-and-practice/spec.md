## Purpose

Give learners a daily Study Plan destination that connects the next lesson, independent practice, weak objectives, and ordinary scheduled reviews.

## ADDED Requirements

### Requirement: Plan Home explains the next action

Plan Home SHALL show a primary Continue action for a resumable or recommended eligible objective, a reason for the recommendation, and a distinct due-review action with a real count or an unavailable state. It SHALL present the ordered path, prerequisite relations, source status, separate coverage/activity/demonstrated evidence, and recent evidence-supported focus areas. Learners SHALL be able to browse other topics and see actionable blocked or completed states. The primary action and due-review status SHALL be usable on desktop and mobile.

#### Scenario: Prerequisite precedes a weak dependent topic
- **WHEN** an available prerequisite is the reason a recommended topic cannot start
- **THEN** Continue identifies the prerequisite and explains its relationship without hiding the dependent topic

#### Scenario: Reading without checked evidence
- **WHEN** a learner marks material read but completes no eligible assessment
- **THEN** coverage/activity update independently and Plan Home still reports no demonstrated evidence

### Requirement: Entry and return routes preserve context

Plan cards SHALL support Continue. Reader document/selection and library collection/tag actions SHALL start creation with editable preselected material. Weak-result actions SHALL open the targeted plan lesson. Lesson, practice, and reassessment SHALL carry stable plan/version/topic/objective context and restore the prior location on return; changes or stale context SHALL be surfaced for resolution.

#### Scenario: Collection membership changes
- **WHEN** a learner freezes a collection-backed scope and the collection changes later
- **THEN** the published plan and saved attempt retain the original resolved membership until a reviewed update

### Requirement: Remediation leads to a fresh independent check

From final eligible evidence, a learner SHALL be able to inspect a weak objective, study it, and select scoped practice or reassessment. Practice SHALL offer supported difficulty and recall/application/transfer options, record hints and repeated checks, and preserve committed item revisions. A fresh check SHALL use new item fingerprints; a same-paper retake SHALL be clearly identified. Only eligible finalized checked results SHALL enter demonstrated evidence, with assistance and provenance visible. Exam and diagnostic attempts SHALL withhold hints and correctness feedback before submission.

#### Scenario: Learner checks a misconception in a different problem
- **WHEN** the learner studies a gap and requests a fresh reassessment
- **THEN** the same objective is tested with a new item, and the result returns to the original gap with its grading status and limitations

### Requirement: Review proposals reuse existing scheduling

A learner SHALL be able to preview, edit, dismiss or accept eligible card candidates linked to the plan, objective and available provenance. Acceptance SHALL create ordinary learning items once per candidate. Only normal review activity SHALL supply scheduler ratings. A proposal or lesson SHALL NOT modify due dates, legacy Queue priority or review history.

#### Scenario: Accepted candidate is retried
- **WHEN** the app retries acceptance after losing its acknowledgement
- **THEN** the existing card is returned without a duplicate or an extra review rating
