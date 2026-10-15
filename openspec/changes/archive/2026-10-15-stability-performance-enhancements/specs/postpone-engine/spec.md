## MODIFIED Requirements

### Requirement: Document postponement uses topic parameters
Documents SHALL be treated as topics in the postpone algorithm. The system SHALL use `topicIncrease`, `topicMinIncrease`, `topicMaxIncrease`, `topicCap`, and `topicFloor` parameters instead of item parameters when computing the interval increase for documents. When a document has an `interval_modifier` other than 1.0, the computed postpone interval increase SHALL be multiplied by the modifier before application.

#### Scenario: Document postponed with topic parameters
- **WHEN** a document has priority 70, days since review 14, topicIncrease 40, topicMinIncrease 1, topicMaxIncrease 200, topicCap 180, topicFloor 1
- **THEN** the ratio is 1.4, raw increase is `round(14 * 1.4) - 14 = 6`, priority factor is 1, final increase is 12, and the new reading date is shifted by 12 days

#### Scenario: Document with interval modifier postponed
- **WHEN** a document has `interval_modifier = 0.5` and the postpone algorithm computes a 12-day increase
- **THEN** the applied increase SHALL be 6 days (12 * 0.5, rounded)
