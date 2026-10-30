## MODIFIED Requirements

### Requirement: Blend user-set priority rating into userIntent dimension
Priority diagnostics SHALL derive userIntent from canonical positional importance P on the 0–100 display scale. The compact rating SHALL remain a derived label and SHALL NOT be blended again as an independent preference. Temporal/retention evidence SHALL exclude manual importance; overdue SHALL be a diagnostic of the same temporal signal rather than a second independent manual or scheduling contribution. Legacy standalone preset scoring SHALL combine temporal evidence once and P once; adaptive-ranked queues SHALL NOT be reranked by this legacy vector.

#### Scenario: High-rated item without tags scores higher than unrated item with tags
- **WHEN** item A has greater canonical importance than item B, whose extra tags do not change its manual rank
- **THEN** A has greater userIntent regardless of tag count

#### Scenario: Both signals combine for maximum intent
- **WHEN** an item has top manual rank and many tags
- **THEN** userIntent remains bounded at 100 and tags do not add another manual-priority contribution

#### Scenario: Unrated items remain neutral
- **WHEN** no canonical manual-priority evidence is available
- **THEN** userIntent is neutral at 50 rather than inferred from scheduling or tag count

#### Scenario: Legacy preset compatibility
- **WHEN** any named legacy preset scores the same temporal/manual fixture
- **THEN** its combined retention/overdue weights apply to temporal evidence once, its intent weight applies to P once, and no later pass compounds that score
